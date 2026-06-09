import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarrierService } from './carriers/carrier.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { AddDeliveryEventDto } from './dto/add-delivery-event.dto';

// Human-readable labels for status — used when auto-generating event notes.
const STATUS_LABEL: Record<DeliveryStatus, string> = {
  BOOKED: 'Shipment booked',
  DISPATCHED: 'Dispatched from origin',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_HUB: 'Arrived at hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned to origin',
};

const deliveryInclude = {
  events: { orderBy: { occurredAt: 'asc' as const } },
} satisfies Prisma.DeliveryTrackingInclude;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carrier: CarrierService,
  ) {}

  // Build a compact, human-readable item summary from the invoice lines so the
  // delivery desk sees what's in the parcel without joining back to billing.
  private buildOrderSummary(
    items: { productName: string; quantity: number }[],
  ): string {
    if (!items.length) return '';
    return items
      .map((i) => `${i.productName} ×${i.quantity}`)
      .join(', ');
  }

  // Enable courier tracking for an invoice. Idempotent: if a delivery record
  // already exists for the invoice it's returned as-is (the toggle simply
  // re-opens the existing tracking record rather than duplicating it).
  async createFromInvoice(
    dto: CreateDeliveryDto,
    userId: string,
    branchId?: string,
  ) {
    const existing = await this.prisma.deliveryTracking.findUnique({
      where: { invoiceId: dto.invoiceId },
      include: deliveryInclude,
    });
    if (existing) {
      if (branchId && existing.branchId && existing.branchId !== branchId) {
        throw new NotFoundException('Delivery not found');
      }
      return existing;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        items: { select: { productName: true, quantity: true } },
        customer: { select: { phone: true, address: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.type !== 'INVOICE') {
      throw new BadRequestException(
        'Courier tracking can only be enabled on invoices',
      );
    }

    return this.prisma.deliveryTracking.create({
      data: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        mobileNumber: invoice.customer?.phone ?? null,
        deliveryAddress: invoice.customer?.address ?? null,
        orderSummary: this.buildOrderSummary(invoice.items),
        status: 'BOOKED',
        branchId: invoice.branchId ?? branchId ?? null,
        createdById: userId,
        // Seed the timeline with the booking event.
        events: {
          create: {
            status: 'BOOKED',
            note: STATUS_LABEL.BOOKED,
          },
        },
      },
      include: deliveryInclude,
    });
  }

  async findAll(
    q?: string,
    status?: string,
    branchId?: string,
    opts?: {
      skip?: number;
      take?: number;
      from?: string;
      to?: string;
      courier?: string;
    },
  ) {
    // `baseWhere` carries the always-on filters (branch / search / date). The
    // two facets — status and courier — are layered on top. Each facet's counts
    // reflect every filter EXCEPT itself, so the numbers stay truthful as the
    // user drills in (the standard faceted-filter behaviour).
    const baseWhere: Prisma.DeliveryTrackingWhereInput = {};
    if (branchId) baseWhere.branchId = branchId;
    // Filter by booked date (createdAt). `from`/`to` are ISO strings; invalid
    // values are ignored rather than throwing.
    const fromDate = opts?.from ? new Date(opts.from) : undefined;
    const toDate = opts?.to ? new Date(opts.to) : undefined;
    const createdAt: Prisma.DateTimeFilter = {};
    if (fromDate && !isNaN(fromDate.getTime())) createdAt.gte = fromDate;
    if (toDate && !isNaN(toDate.getTime())) createdAt.lte = toDate;
    if (createdAt.gte || createdAt.lte) baseWhere.createdAt = createdAt;
    if (q) {
      baseWhere.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { trackingId: { contains: q, mode: 'insensitive' } },
        { courierName: { contains: q, mode: 'insensitive' } },
        { mobileNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    // "Dispatched" isn't a user-facing status — it folds into "In Transit".
    // So selecting In Transit matches both IN_TRANSIT and DISPATCHED rows.
    const statusWhere: Prisma.DeliveryTrackingWhereInput =
      status === 'IN_TRANSIT'
        ? { status: { in: ['IN_TRANSIT', 'DISPATCHED'] as DeliveryStatus[] } }
        : status && status in STATUS_LABEL
          ? { status: status as DeliveryStatus }
          : {};
    const courierWhere: Prisma.DeliveryTrackingWhereInput = opts?.courier
      ? { courierName: opts.courier }
      : {};

    const where: Prisma.DeliveryTrackingWhereInput = {
      ...baseWhere,
      ...statusWhere,
      ...courierWhere,
    };

    const [items, total, statusGrouped, courierGrouped] = await Promise.all([
      this.prisma.deliveryTracking.findMany({
        where,
        include: deliveryInclude,
        orderBy: { updatedAt: 'desc' },
        skip: opts?.skip,
        take: opts?.take,
      }),
      this.prisma.deliveryTracking.count({ where }),
      // Status counts reflect every filter except status (so + courier).
      this.prisma.deliveryTracking.groupBy({
        by: ['status'],
        where: { ...baseWhere, ...courierWhere },
        _count: { _all: true },
      }),
      // Courier counts reflect every filter except courier (so + status).
      this.prisma.deliveryTracking.groupBy({
        by: ['courierName'],
        where: { ...baseWhere, ...statusWhere },
        _count: { _all: true },
      }),
    ]);

    // status → count map (+ `ALL` total across statuses) for the filter chips.
    const statusCounts: Record<string, number> = {};
    let allCount = 0;
    for (const g of statusGrouped) {
      statusCounts[g.status] = g._count._all;
      allCount += g._count._all;
    }
    // Fold DISPATCHED into IN_TRANSIT so the chip count matches the folded
    // workflow (Dispatched is not shown as its own filter row).
    if (statusCounts.DISPATCHED) {
      statusCounts.IN_TRANSIT = (statusCounts.IN_TRANSIT ?? 0) + statusCounts.DISPATCHED;
      delete statusCounts.DISPATCHED;
    }
    statusCounts.ALL = allCount;

    // courierName → count map. Null couriers (not yet assigned) are bucketed
    // under the `ALL` total but not listed as a selectable courier.
    const courierCounts: Record<string, number> = {};
    let allCourier = 0;
    for (const g of courierGrouped) {
      allCourier += g._count._all;
      if (g.courierName) courierCounts[g.courierName] = g._count._all;
    }
    courierCounts.ALL = allCourier;

    return { items, total, statusCounts, courierCounts };
  }

  async findOne(id: string, branchId?: string) {
    const delivery = await this.prisma.deliveryTracking.findUnique({
      where: { id },
      include: deliveryInclude,
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (branchId && delivery.branchId && delivery.branchId !== branchId) {
      throw new NotFoundException('Delivery not found');
    }
    return delivery;
  }

  async findByInvoice(invoiceId: string, branchId?: string) {
    const delivery = await this.prisma.deliveryTracking.findUnique({
      where: { invoiceId },
      include: deliveryInclude,
    });
    // Return null (not 404) when none exists — the invoice detail page polls
    // this to decide whether the courier toggle is on.
    if (!delivery) return null;
    if (branchId && delivery.branchId && delivery.branchId !== branchId) {
      return null;
    }
    return delivery;
  }

  async update(id: string, dto: UpdateDeliveryDto, branchId?: string) {
    const current = await this.findOne(id, branchId);

    const data: Prisma.DeliveryTrackingUpdateInput = {
      courierName: dto.courierName,
      trackingId: dto.trackingId,
      mobileNumber: dto.mobileNumber,
      deliveryAddress: dto.deliveryAddress,
      receiptName: dto.receiptName,
      ocrText: dto.ocrText,
    };
    if (dto.dispatchDate) data.dispatchDate = new Date(dto.dispatchDate);
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'DELIVERED') data.deliveredAt = new Date();
    }

    // A manual status change records a matching timeline event so the history
    // stays consistent with the headline status.
    const statusChanged = dto.status && dto.status !== current.status;

    return this.prisma.deliveryTracking.update({
      where: { id },
      data: {
        ...data,
        ...(statusChanged
          ? {
              events: {
                create: {
                  status: dto.status as DeliveryStatus,
                  note: STATUS_LABEL[dto.status as DeliveryStatus],
                },
              },
            }
          : {}),
      },
      include: deliveryInclude,
    });
  }

  async addEvent(id: string, dto: AddDeliveryEventDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.deliveryTracking.update({
      where: { id },
      data: {
        // The headline status always tracks the most-recently-added event.
        status: dto.status,
        ...(dto.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        events: {
          create: {
            status: dto.status,
            location: dto.location,
            note: dto.note ?? STATUS_LABEL[dto.status],
            ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
          },
        },
      },
      include: deliveryInclude,
    });
  }

  // "Check Tracking Status" action. Validates the tracking id, then — when a
  // carrier API is configured (AfterShip) — pulls live checkpoints and merges
  // any new ones into the timeline, advancing the headline status. When no
  // carrier key is configured (or the lookup fails) it falls back to the saved
  // timeline and reports `liveIntegration: false` so the UI stays honest.
  async checkStatus(id: string, branchId?: string) {
    const delivery = await this.findOne(id, branchId);
    if (!delivery.trackingId) {
      throw new BadRequestException('Add a tracking ID before checking status');
    }

    // No provider key loaded in the running process.
    if (!this.carrier.isConfigured()) {
      return {
        delivery,
        liveIntegration: false,
        reason: 'not_configured',
        checkedAt: new Date().toISOString(),
      };
    }

    const result = await this.carrier.fetchTracking(delivery.trackingId, {
      courierName: delivery.courierName,
      slug: delivery.carrierSlug,
    });

    // Provider is configured, but the carrier lookup failed (courier couldn't
    // be resolved, or the API errored) → fall back to the saved timeline but
    // tell the UI it was a lookup failure, not a missing key.
    if (!result) {
      return {
        delivery,
        liveIntegration: false,
        reason: 'lookup_failed',
        provider: this.carrier.providerName(),
        checkedAt: new Date().toISOString(),
      };
    }

    // Merge: insert only checkpoints we haven't imported before (deduped by
    // externalId). The DB unique index (deliveryId, externalId) is the backstop
    // against races. Manual events (externalId NULL) are untouched.
    const existing = new Set(
      delivery.events.map((e) => e.externalId).filter((x): x is string => !!x),
    );
    const fresh = result.checkpoints.filter((c) => !existing.has(c.externalId));

    if (fresh.length > 0) {
      await this.prisma.deliveryEvent.createMany({
        data: fresh.map((c) => ({
          deliveryId: delivery.id,
          status: c.status,
          location: c.location,
          note: c.note,
          occurredAt: c.occurredAt,
          externalId: c.externalId,
        })),
        skipDuplicates: true,
      });
    }

    // Re-anchor the genesis "Booked" event to the carrier's actual pickup time
    // when that predates our in-system booking (e.g. the courier toggle was
    // enabled after the parcel was already dispatched). Keeps the timeline in
    // chronological order — Booked first, then the real checkpoints.
    if (result.checkpoints.length > 0) {
      const earliest = result.checkpoints.reduce(
        (min, c) => (c.occurredAt < min ? c.occurredAt : min),
        result.checkpoints[0].occurredAt,
      );
      const genesis = delivery.events.find(
        (e) => e.status === 'BOOKED' && !e.externalId,
      );
      if (genesis && genesis.occurredAt.getTime() > earliest.getTime()) {
        await this.prisma.deliveryEvent.update({
          where: { id: genesis.id },
          data: { occurredAt: new Date(earliest.getTime() - 60_000) },
        });
      }
    }

    // Advance the headline status to the carrier's latest, and stamp the sync.
    const updated = await this.prisma.deliveryTracking.update({
      where: { id: delivery.id },
      data: {
        carrierSlug: result.slug,
        lastSyncedAt: new Date(),
        ...(result.latestStatus ? { status: result.latestStatus } : {}),
        // Use the carrier's actual delivery time, not the sync time.
        ...(result.delivered ? { deliveredAt: result.deliveredAt ?? new Date() } : {}),
      },
      include: deliveryInclude,
    });

    return {
      delivery: updated,
      liveIntegration: true,
      provider: this.carrier.providerName(),
      newCheckpoints: fresh.length,
      checkedAt: new Date().toISOString(),
    };
  }

  // "Check All" — bulk-refresh every active shipment that has a tracking ID, in
  // one click. Targets non-terminal deliveries (not yet Delivered/Returned) so
  // we don't waste carrier calls on finished parcels. Runs sequentially to stay
  // within the carrier's rate limits; per-item failures are counted, not fatal.
  async checkAll(branchId?: string) {
    const where: Prisma.DeliveryTrackingWhereInput = {
      trackingId: { not: null },
      status: { notIn: ['DELIVERED', 'RETURNED'] },
    };
    if (branchId) where.branchId = branchId;

    const targets = await this.prisma.deliveryTracking.findMany({
      where,
      select: { id: true },
      take: 200, // safety cap
    });

    let checked = 0;
    let updated = 0;
    let totalNewCheckpoints = 0;
    let failed = 0;
    for (const t of targets) {
      try {
        const res = await this.checkStatus(t.id, branchId);
        checked++;
        const n = (res as { newCheckpoints?: number }).newCheckpoints ?? 0;
        if (n > 0) {
          updated++;
          totalNewCheckpoints += n;
        }
      } catch {
        failed++;
      }
    }

    return {
      liveIntegration: this.carrier.isConfigured(),
      provider: this.carrier.providerName(),
      total: targets.length,
      checked,
      updated,
      totalNewCheckpoints,
      failed,
      checkedAt: new Date().toISOString(),
    };
  }

  // Wipe the timeline and reset the delivery to a fresh "Booked" state — used to
  // clear a messy/duplicated event log before re-syncing from the carrier.
  async clearTimeline(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    await this.prisma.deliveryEvent.deleteMany({ where: { deliveryId: id } });
    return this.prisma.deliveryTracking.update({
      where: { id },
      data: {
        status: 'BOOKED',
        deliveredAt: null,
        lastSyncedAt: null,
        events: { create: { status: 'BOOKED', note: 'Shipment booked' } },
      },
      include: deliveryInclude,
    });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    await this.prisma.deliveryTracking.delete({ where: { id } });
    return { success: true };
  }
}
