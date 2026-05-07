import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { POStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

// Allowed PO status transitions. CLOSED is reachable from anything; the
// auto-received states (PARTIALLY_RECEIVED / FULLY_RECEIVED) are set by the
// GRN flow and not by client PATCH calls — but we allow them here too in case
// an admin needs to correct state manually.
const PO_STATUS_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: ['SENT', 'CLOSED'],
  SENT: ['ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
  ACKNOWLEDGED: ['PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
  PARTIALLY_RECEIVED: ['FULLY_RECEIVED', 'CLOSED'],
  FULLY_RECEIVED: ['CLOSED'],
  CLOSED: [],
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async create(
    createPurchaseOrderDto: CreatePurchaseOrderDto,
    userId: string,
    branchId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Verify supplier exists (and is in scope of caller's branch when branch-scoped)
      const supplier = await tx.supplier.findUnique({
        where: { id: createPurchaseOrderDto.supplierId },
      });
      if (!supplier) throw new BadRequestException('Supplier not found');
      if (branchId && supplier.branchId && supplier.branchId !== branchId) {
        throw new BadRequestException('Supplier not available in this branch');
      }

      // Verify all referenced products exist
      const productIds = Array.from(
        new Set(createPurchaseOrderDto.items.map((i) => i.productId)),
      );
      const foundProducts = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (foundProducts.length !== productIds.length) {
        const foundSet = new Set(foundProducts.map((p) => p.id));
        const missing = productIds.filter((id) => !foundSet.has(id));
        throw new BadRequestException(
          `Unknown product id(s): ${missing.join(', ')}`,
        );
      }

      const poNumber = await this.numbering.nextNumber(
        tx,
        'PO',
        branchId ?? null,
      );

      return tx.purchaseOrder.create({
        data: {
          poNumber,
          branchId,
          supplierId: createPurchaseOrderDto.supplierId,
          supplierName: createPurchaseOrderDto.supplierName,
          totalAmount: createPurchaseOrderDto.totalAmount,
          status: createPurchaseOrderDto.status,
          expectedDelivery: createPurchaseOrderDto.expectedDelivery
            ? new Date(createPurchaseOrderDto.expectedDelivery)
            : null,
          createdBy: userId,
          items: {
            create: createPurchaseOrderDto.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              requiredQty: item.requiredQty,
              lastPurchaseRate: item.lastPurchaseRate,
              expectedRate: item.expectedRate,
              remarks: item.remarks,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  async findAll(
    query?: string,
    branchId?: string,
    page?: number,
    pageSize?: number,
  ) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { poNumber: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
      ];
    }
    const include = { items: true } satisfies Prisma.PurchaseOrderInclude;
    const orderBy = {
      date: 'desc' as const,
    } satisfies Prisma.PurchaseOrderOrderByWithRelationInput;

    // Backwards-compatible: if no page is requested, return the full array as
    // before so existing FE callers keep working.
    if (!page || page < 1) {
      return this.prisma.purchaseOrder.findMany({ where, include, orderBy });
    }
    const safeSize = Math.min(Math.max(pageSize ?? 20, 1), 200);
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { items, total, page, pageSize: safeSize };
  }

  async findOne(id: string, branchId?: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');
    if (branchId && po.branchId && po.branchId !== branchId) {
      throw new NotFoundException('Purchase Order not found');
    }
    return po;
  }

  async update(
    id: string,
    updatePurchaseOrderDto: UpdatePurchaseOrderDto,
    branchId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existingPo = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!existingPo) throw new NotFoundException('Purchase order not found');
      if (branchId && existingPo.branchId && existingPo.branchId !== branchId) {
        throw new NotFoundException('Purchase order not found');
      }

      // Whitelist status transitions when status is being changed
      if (
        updatePurchaseOrderDto.status &&
        updatePurchaseOrderDto.status !== existingPo.status
      ) {
        const allowed = PO_STATUS_TRANSITIONS[existingPo.status] ?? [];
        if (!allowed.includes(updatePurchaseOrderDto.status)) {
          throw new BadRequestException(
            `Cannot transition PO from ${existingPo.status} to ${updatePurchaseOrderDto.status}`,
          );
        }
      }

      if (updatePurchaseOrderDto.items) {
        // Delete existing items and recreate
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: updatePurchaseOrderDto.supplierId,
          supplierName: updatePurchaseOrderDto.supplierName,
          totalAmount: updatePurchaseOrderDto.totalAmount,
          status: updatePurchaseOrderDto.status,
          expectedDelivery: updatePurchaseOrderDto.expectedDelivery
            ? new Date(updatePurchaseOrderDto.expectedDelivery)
            : undefined,
          ...(updatePurchaseOrderDto.items && {
            items: {
              create: updatePurchaseOrderDto.items.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                requiredQty: item.requiredQty,
                lastPurchaseRate: item.lastPurchaseRate,
                expectedRate: item.expectedRate,
                remarks: item.remarks,
              })),
            },
          }),
        },
        include: { items: true },
      });
    });
  }

  async remove(id: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Purchase order not found');
      if (branchId && existing.branchId && existing.branchId !== branchId) {
        throw new NotFoundException('Purchase order not found');
      }
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.delete({ where: { id } });
    });
  }
}
