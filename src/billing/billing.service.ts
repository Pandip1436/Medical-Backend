import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PaymentMode, Prisma } from '@prisma/client';
import { INVOICE_CREATED, InvoiceCreatedPayload } from '../events/invoice-events';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: EventEmitter2,
  ) {}

  // Schedule H, H1, and X are prescription-only drugs under the Drugs &
  // Cosmetics Rules. Walk-in/retail sales require a current valid prescription
  // on record. WHOLESALE customers are licensed distributors (they hold a
  // Drug License) so the retail prescription requirement is waived for them.
  private async assertPrescriptionForScheduledItems(
    tx: Prisma.TransactionClient,
    items: Array<{ productId: string; productName: string }>,
    customerId: string | null | undefined,
    billingType?: string,
  ) {
    if (!items.length) return;

    // Wholesale distributors are licensed — no retail prescription required.
    if (billingType && billingType.toUpperCase() === 'WHOLESALE') return;

    const productIds = items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, schedule: true },
    });
    const scheduledProducts = products.filter(
      (p) => p.schedule === 'H' || p.schedule === 'H1' || p.schedule === 'X',
    );
    if (scheduledProducts.length === 0) return;

    if (!customerId) {
      const names = scheduledProducts.map((p) => p.name).join(', ');
      throw new BadRequestException(
        `Schedule H/H1/X drugs (${names}) cannot be sold to a walk-in customer — record the customer and their prescription first.`,
      );
    }

    const activeRx = await tx.prescription.findFirst({
      where: {
        customerId,
        isActive: true,
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      select: { id: true },
    });
    if (!activeRx) {
      const names = scheduledProducts.map((p) => p.name).join(', ');
      throw new BadRequestException(
        `Cannot dispense ${names} — customer has no active, non-expired prescription on file.`,
      );
    }
  }

  // Validate batch + decrement stock for one invoice line. Blocks expired batches
  // and insufficient stock. Also fires LOW_STOCK alerts. Reused by create() and
  // convertToInvoice().
  private async deductStockForItem(
    tx: Prisma.TransactionClient,
    item: {
      productId: string;
      productName: string;
      batchId: string;
      batchNumber: string;
      quantity: number;
    },
    branchId?: string,
  ) {
    const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
    if (!batch) {
      throw new NotFoundException(
        `Batch ${item.batchNumber} for product ${item.productName} not found`,
      );
    }
    // Refuse expired stock — pharmacies cannot legally dispense it.
    const expiry = new Date(batch.expiryDate);
    expiry.setHours(23, 59, 59, 999);
    if (expiry < new Date()) {
      throw new BadRequestException(
        `Cannot sell ${item.productName} from batch ${item.batchNumber}: expired on ${new Date(batch.expiryDate).toLocaleDateString('en-IN')}`,
      );
    }
    if (batch.quantity < item.quantity) {
      throw new BadRequestException(
        `Insufficient stock for ${item.productName} in batch ${item.batchNumber}. Available: ${batch.quantity}`,
      );
    }
    await tx.batch.update({
      where: { id: batch.id },
      data: { quantity: batch.quantity - item.quantity },
    });
    const updatedProduct = await tx.product.update({
      where: { id: item.productId },
      data: { totalStock: { decrement: item.quantity } },
      select: {
        id: true,
        name: true,
        totalStock: true,
        minStock: true,
        branchId: true,
      },
    });
    const isLow =
      updatedProduct.totalStock <= 0 ||
      (updatedProduct.minStock > 0 &&
        updatedProduct.totalStock <= updatedProduct.minStock);
    if (isLow) {
      // Layered suppression: mirror notifications.service suppressionClauses()
      // so post-sale alerts respect the user's prior actions (read / resolve /
      // snooze) and don't keep re-firing every time the same product drops.
      const now = new Date();
      const dedupSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const resolvedSince = new Date(now.getTime() - 30 * 86_400_000);
      const readSince = new Date(now.getTime() - 3 * 86_400_000);
      const alreadyNotified = await tx.notification.findFirst({
        where: {
          type: 'LOW_STOCK',
          message: { contains: `[productId:${updatedProduct.id}]` },
          OR: [
            { isRead: false, resolvedAt: null, snoozedUntil: null },
            { isRead: false, resolvedAt: null, snoozedUntil: { gt: now } },
            { resolvedAt: { gte: resolvedSince } },
            { isRead: true, resolvedAt: null, createdAt: { gte: readSince } },
            { createdAt: { gte: dedupSince } },
          ],
        },
      });
      if (!alreadyNotified) {
        const stockLabel =
          updatedProduct.totalStock <= 0
            ? 'is out of stock'
            : `has only ${updatedProduct.totalStock} units left (min: ${updatedProduct.minStock})`;
        await tx.notification.create({
          data: {
            type: 'LOW_STOCK',
            title: 'Low Stock Alert',
            message: `${updatedProduct.name} ${stockLabel}. [productId:${updatedProduct.id}]`,
            actionUrl: `/inventory/product-history?productId=${updatedProduct.id}`,
            branchId: updatedProduct.branchId ?? branchId ?? null,
          },
        });
      }
    }
  }

  async create(
    createInvoiceDto: CreateInvoiceDto,
    userId: string,
    branchId?: string,
    userRole?: string,
  ) {
    // Configurable: how many unsettled credit invoices a customer can have
    // before a new credit sale needs admin approval. Set MAX_PENDING_CREDIT
    // in the environment to override; default 3.
    const maxPendingCredit = Number(process.env.MAX_PENDING_CREDIT ?? 3);
    // User-initiated drafts skip every side effect — no stock deduction, no
    // ledger update, no loyalty, no notifications, no credit-limit check.
    // The draft only becomes "real" when finalizeDraft() runs.
    const isDraft = createInvoiceDto.status === 'DRAFT';
    const created = await this.prisma.$transaction(async (tx) => {
      // 1. Credit limit check — behaviour differs by role. Skipped for drafts
      // (a draft hasn't extended credit to anyone yet).
      if (
        !isDraft &&
        createInvoiceDto.type === 'INVOICE' &&
        createInvoiceDto.paymentMode === 'CREDIT' &&
        createInvoiceDto.customerId
      ) {
        const pendingCount = await tx.invoice.count({
          where: {
            customerId: createInvoiceDto.customerId,
            status: { in: ['UNPAID', 'PARTIAL'] },
          },
        });
        if (pendingCount >= maxPendingCredit) {
          if (userRole === 'PHARMACIST') {
            // Save as DRAFT, then queue approval — stock NOT deducted yet.
            // Stock is reserved at approval-execution time after re-validating
            // availability (see ApprovalsService.executeApprovedAction).
            const invoiceNumber = await this.numbering.nextNumber(
              tx,
              'INV',
              branchId ?? null,
            );
            const draftInvoice = await tx.invoice.create({
              data: {
                invoiceNumber,
                type: createInvoiceDto.type,
                billingType: createInvoiceDto.billingType,
                branchId,
                customerId: createInvoiceDto.customerId ?? null,
                customerName: createInvoiceDto.customerName,
                doctorName: createInvoiceDto.doctorName ?? null,
                salespersonId: createInvoiceDto.salespersonId ?? null,
                salespersonName: createInvoiceDto.salespersonName ?? null,
                subtotal: createInvoiceDto.subtotal,
                productDiscount: createInvoiceDto.productDiscount ?? 0,
                taxableAmount: createInvoiceDto.taxableAmount ?? createInvoiceDto.subtotal,
                cgst: createInvoiceDto.cgst ?? 0,
                sgst: createInvoiceDto.sgst ?? 0,
                igst: createInvoiceDto.igst ?? 0,
                deliveryCharge: createInvoiceDto.deliveryCharge ?? 0,
                roundOff: createInvoiceDto.roundOff ?? 0,
                grandTotal: createInvoiceDto.grandTotal,
                paymentMode: 'CREDIT',
                status: 'DRAFT',
                amountPaid: 0,
                changeReturned: 0,
                createdById: userId,
                // Optional CRM Lead link — populated when the invoice is
                // created via "Create Invoice" from the lead detail panel.
                ...(createInvoiceDto.leadId && { leadId: createInvoiceDto.leadId }),
                items: {
                  create: createInvoiceDto.items.map(item => ({
                    productId: item.productId,
                    productName: item.productName,
                    batchId: item.batchId,
                    batchNumber: item.batchNumber,
                    expiryDate: new Date(item.expiryDate),
                    quantity: item.quantity,
                    rate: item.rate,
                    mrp: item.mrp,
                    amount: item.amount,
                    gstPercent: item.gstPercent ?? 0,
                    discountPercent: item.discountPercent ?? 0,
                  })),
                },
              } as any,
            });

            await this.approvalsService.createRequest({
              type: 'CREDIT_BILL',
              payload: { invoiceId: draftInvoice.id, invoiceNumber, pendingCount, customerId: createInvoiceDto.customerId, customerName: createInvoiceDto.customerName, grandTotal: createInvoiceDto.grandTotal },
              requestedById: userId,
              branchId,
              refId: draftInvoice.id,
            });

            return { approvalRequested: true, approvalRequestId: draftInvoice.id, invoiceId: draftInvoice.id, invoiceNumber, status: 'DRAFT' };
          }

          // ADMIN: hard block (should not happen since admin bypasses, but safety net)
          throw new BadRequestException(
            `Customer has ${pendingCount} unpaid credit invoice(s). Please collect payment before adding more credit sales.`,
          );
        }
      }

      // 2. Generate unique invoice/quotation number (atomic, FY-aware)
      const isQuotation = createInvoiceDto.type === 'QUOTATION';
      const invoiceNumber = await this.numbering.nextNumber(
        tx,
        isQuotation ? 'QTN' : 'INV',
        branchId ?? null,
      );

      // 3. Validate and deduct stock — only for actual invoices, not quotations,
      // and not for drafts. Stock is reserved at finalization time for drafts,
      // at conversion time for quotations.
      if (!isQuotation && !isDraft) {
        // Block dispensing of Schedule H/H1/X drugs without a valid prescription
        // on file before we touch any stock. Wholesale customers are exempt.
        await this.assertPrescriptionForScheduledItems(
          tx,
          createInvoiceDto.items,
          createInvoiceDto.customerId ?? null,
          createInvoiceDto.billingType,
        );
        for (const item of createInvoiceDto.items) {
          await this.deductStockForItem(tx, item, branchId);
        }
      }

      // 3. Create the Invoice and InvoiceItems
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: createInvoiceDto.type,
          billingType: createInvoiceDto.billingType,
          branchId,
          customerId: createInvoiceDto.customerId,
          customerName: createInvoiceDto.customerName,
          doctorName: createInvoiceDto.doctorName,
          subtotal: createInvoiceDto.subtotal,
          productDiscount: createInvoiceDto.productDiscount,
          taxableAmount: createInvoiceDto.taxableAmount,
          cgst: createInvoiceDto.cgst,
          sgst: createInvoiceDto.sgst,
          igst: createInvoiceDto.igst || 0,
          deliveryCharge: createInvoiceDto.deliveryCharge ?? 0,
          roundOff: createInvoiceDto.roundOff,
          grandTotal: createInvoiceDto.grandTotal,
          paymentMode: createInvoiceDto.paymentMode,
          paymentDetails: createInvoiceDto.paymentDetails,
          status: createInvoiceDto.status,
          amountPaid: createInvoiceDto.amountPaid,
          changeReturned: createInvoiceDto.changeReturned,
          salespersonId: createInvoiceDto.salespersonId ?? null,
          salespersonName: createInvoiceDto.salespersonName ?? null,
          createdById: userId,
          // Optional CRM Lead link — see DTO comment.
          ...(createInvoiceDto.leadId && { leadId: createInvoiceDto.leadId }),
          items: {
            create: createInvoiceDto.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent,
              gstPercent: item.gstPercent,
              amount: item.amount
            }))
          }
        },
        include: {
          items: true
        }
      });

      // 4. If CREDIT or SPLIT payment and customer exists, update outstanding ledger.
      // Skipped for drafts — outstanding isn't extended until the draft is finalized.
      if (!isDraft && (createInvoiceDto.paymentMode === 'CREDIT' || createInvoiceDto.paymentMode === 'SPLIT') && createInvoiceDto.customerId) {
        const amountAddedToCredit = createInvoiceDto.grandTotal - createInvoiceDto.amountPaid;

        if (amountAddedToCredit > 0) {
          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { currentOutstanding: { increment: amountAddedToCredit } }
          });
        }
      }

      // 5. Award loyalty points (1 point per ₹100) for non-quotation invoices.
      // Skipped for drafts — points accrue at finalize-time.
      if (!isDraft && createInvoiceDto.type === 'INVOICE' && createInvoiceDto.customerId) {
        const pointsEarned = Math.floor(Number(createInvoiceDto.grandTotal) / 100);
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
        }
      }

      // 6. Auto-create a PAYMENT_DUE notification for new credit invoices.
      // Skipped for drafts — nothing's due yet.
      if (!isQuotation && !isDraft && createInvoiceDto.paymentMode === 'CREDIT') {
        const outstanding = Number(createInvoiceDto.grandTotal) - Number(createInvoiceDto.amountPaid);
        await tx.notification.create({
          data: {
            type: 'PAYMENT_DUE',
            title: 'Payment Due',
            message: `Invoice ${invoiceNumber} for ${createInvoiceDto.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${invoice.id}]`,
            actionUrl: `/customers/invoices/detail?id=${invoice.id}`,
            branchId: branchId ?? null,
          },
        });
      }

      return invoice;
    });

    // Fire AFTER the transaction commits. Listeners (WhatsApp send,
    // payment-QR creation) run async — they must not block invoice creation.
    // Skip the emit when `created` is the approval-redirect path: that path
    // saves the invoice as DRAFT and queues an ApprovalRequest, so there is
    // no real invoice to send out yet. The listener gates on type / status /
    // outstanding for the normal-invoice path.
    if (!('approvalRequested' in created)) {
      const payload: InvoiceCreatedPayload = {
        invoiceId: created.id,
        branchId: created.branchId ?? null,
        customerId: created.customerId ?? null,
        type: created.type as InvoiceCreatedPayload['type'],
        status: created.status as InvoiceCreatedPayload['status'],
        grandTotal: Number(created.grandTotal),
        amountPaid: Number(created.amountPaid),
      };
      this.events.emit(INVOICE_CREATED, payload);
    }
    return created;
  }

  // Public helper so the manual `POST /:id/send-whatsapp` controller endpoint
  // can re-fire the listener flow for an existing invoice.
  emitInvoiceCreatedById(invoiceId: string) {
    return this.prisma.invoice.findUnique({ where: { id: invoiceId } }).then((inv) => {
      if (!inv) throw new NotFoundException('Invoice not found');
      const payload: InvoiceCreatedPayload = {
        invoiceId: inv.id,
        branchId: inv.branchId ?? null,
        customerId: inv.customerId ?? null,
        type: inv.type as any,
        status: inv.status as any,
        grandTotal: Number(inv.grandTotal),
        amountPaid: Number(inv.amountPaid),
      };
      this.events.emit(INVOICE_CREATED, payload);
      return { ok: true, queued: inv.invoiceNumber };
    });
  }

  // Match the customers/suppliers pattern: legacy plain-array path when no
  // skip/take, paginated { data, total, hasMore } when either is provided.
  async findAll(
    query?: string,
    customerId?: string,
    branchId?: string,
    type?: string,
    filters?: {
      status?: string;
      paymentMode?: string;
      salespersonId?: string;
      from?: string;
      to?: string;
    },
    skip?: number,
    take?: number,
  ) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (type) where.type = type;
    if (query) {
      where.OR = [
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (filters?.status) where.status = filters.status;
    if (filters?.paymentMode) where.paymentMode = filters.paymentMode;
    if (filters?.salespersonId) where.salespersonId = filters.salespersonId;
    if (filters?.from || filters?.to) {
      where.date = {};
      if (filters.from) where.date.gte = new Date(filters.from);
      if (filters.to) {
        // Make the `to` boundary inclusive of the entire day.
        const toEnd = new Date(filters.to);
        toEnd.setHours(23, 59, 59, 999);
        where.date.lte = toEnd;
      }
    }

    const paginated = typeof skip === 'number' && typeof take === 'number';

    if (!paginated) {
      // Legacy callers (NewSale, dashboard, customer detail) — keep the
      // lightweight array contract. Capped at 200 to avoid runaway responses.
      return this.prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { date: 'desc' },
        take: 200,
      });
    }

    const safeTake = Math.min(Math.max(take!, 1), 100);
    const safeSkip = Math.max(skip!, 0);

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { date: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data,
      total,
      hasMore: safeSkip + data.length < total,
    };
  }

  // Global summary across all invoices (optionally scoped to a branch). Kept
  // unfiltered so the top stat cards stay stable as the user types in the
  // search box below.
  async summary(branchId?: string) {
    const base: any = { type: 'INVOICE' };
    if (branchId) base.branchId = branchId;

    const [totalInvoices, totalAmountAgg, paidCount, outstandingAgg] = await Promise.all([
      this.prisma.invoice.count({ where: base }),
      this.prisma.invoice.aggregate({
        where: base,
        _sum: { grandTotal: true },
      }),
      this.prisma.invoice.count({ where: { ...base, status: 'PAID' } }),
      this.prisma.invoice.findMany({
        where: { ...base, status: { in: ['UNPAID', 'PARTIAL'] } },
        select: { grandTotal: true, amountPaid: true },
      }),
    ]);

    const outstandingAmount = outstandingAgg.reduce(
      (sum, inv) => sum + (Number(inv.grandTotal) - Number(inv.amountPaid)),
      0,
    );

    return {
      totalInvoices,
      totalAmount: Number(totalAmountAgg._sum.grandTotal ?? 0),
      paidCount,
      outstandingAmount,
      outstandingCount: outstandingAgg.length,
    };
  }

  async findOne(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, createdBy: { select: { name: true } } }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async convertToInvoice(id: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.invoice.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!quotation) throw new NotFoundException('Quotation not found');
      if (branchId && quotation.branchId && quotation.branchId !== branchId) {
        throw new NotFoundException('Quotation not found');
      }
      if (quotation.type !== 'QUOTATION') {
        throw new BadRequestException(
          'Only QUOTATION type records can be converted',
        );
      }

      // Reserve real stock now — quotations don't reserve, so on conversion
      // we run the same validate-and-decrement logic as a fresh invoice.
      // Throws if any batch is expired, missing, or under-stocked.
      await this.assertPrescriptionForScheduledItems(
        tx,
        quotation.items.map((i) => ({ productId: i.productId, productName: i.productName })),
        quotation.customerId ?? null,
        quotation.billingType,
      );
      for (const item of quotation.items) {
        await this.deductStockForItem(
          tx,
          {
            productId: item.productId,
            productName: item.productName,
            batchId: item.batchId,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
          },
          branchId,
        );
      }

      const invoiceNumber = await this.numbering.nextNumber(
        tx,
        'INV',
        branchId ?? null,
      );
      return tx.invoice.update({
        where: { id },
        data: { type: 'INVOICE', invoiceNumber, status: 'PAID' },
        include: { items: true },
      });
    });
  }

  // ── Draft lifecycle ──────────────────────────────────────────
  // Drafts are user-initiated parked sales: created via POST /billing with
  // status=DRAFT, re-saved via PATCH :id/save-draft, finalized via
  // PATCH :id/finalize. Stock, ledger, loyalty, notifications only run at
  // finalize time — see create() for the corresponding guards.

  private async _verifyDraft(tx: Prisma.TransactionClient, id: string, branchId?: string) {
    const existing = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw new NotFoundException('Draft not found');
    if (branchId && existing.branchId && existing.branchId !== branchId) {
      throw new NotFoundException('Draft not found');
    }
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `Invoice ${existing.invoiceNumber} is not a draft (current status: ${existing.status})`,
      );
    }
    return existing;
  }

  // Re-save the draft's contents (items + totals + customer + payment intent
  // selection) without finalizing. Status stays DRAFT. No side effects.
  async saveDraft(id: string, dto: CreateInvoiceDto, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this._verifyDraft(tx, id, branchId);

      // Replace items wholesale — simpler than diffing and matches how the
      // frontend sends the full item set every save.
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

      return tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName,
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: dto.subtotal,
          productDiscount: dto.productDiscount ?? 0,
          taxableAmount: dto.taxableAmount ?? dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          deliveryCharge: dto.deliveryCharge ?? 0,
          roundOff: dto.roundOff ?? 0,
          grandTotal: dto.grandTotal,
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          amountPaid: dto.amountPaid ?? 0,
          changeReturned: dto.changeReturned ?? 0,
          // Status pinned to DRAFT — finalization goes through finalizeDraft().
          status: 'DRAFT',
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent ?? 0,
              gstPercent: item.gstPercent ?? 0,
              amount: item.amount,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  // Finalize a draft into a real invoice. Runs the side effects that create()
  // skipped: prescription check, stock deduction, ledger, loyalty, notification.
  // The DTO's status must be a final state (PAID / UNPAID / PARTIAL) — drafts
  // can't "finalize" themselves into another draft.
  async finalizeDraft(id: string, dto: CreateInvoiceDto, branchId?: string) {
    if (dto.status === 'DRAFT') {
      throw new BadRequestException('Finalize requires a non-DRAFT status (PAID / UNPAID / PARTIAL).');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await this._verifyDraft(tx, id, branchId);

      // Prescription + stock — same validators a fresh invoice goes through.
      await this.assertPrescriptionForScheduledItems(
        tx,
        dto.items,
        dto.customerId ?? null,
        dto.billingType,
      );
      for (const item of dto.items) {
        await this.deductStockForItem(tx, item, branchId);
      }

      // Replace items, flip status, write final payment fields.
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      const finalized = await tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName,
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: dto.subtotal,
          productDiscount: dto.productDiscount ?? 0,
          taxableAmount: dto.taxableAmount ?? dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          deliveryCharge: dto.deliveryCharge ?? 0,
          roundOff: dto.roundOff ?? 0,
          grandTotal: dto.grandTotal,
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          amountPaid: dto.amountPaid ?? 0,
          changeReturned: dto.changeReturned ?? 0,
          status: dto.status,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent ?? 0,
              gstPercent: item.gstPercent ?? 0,
              amount: item.amount,
            })),
          },
        },
        include: { items: true },
      });

      // Outstanding ledger update — same logic as create()'s non-draft path.
      if (
        (dto.paymentMode === 'CREDIT' || dto.paymentMode === 'SPLIT') &&
        dto.customerId
      ) {
        const owed = dto.grandTotal - (dto.amountPaid ?? 0);
        if (owed > 0) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { currentOutstanding: { increment: owed } },
          });
        }
      }

      // Loyalty — 1 point per ₹100, only for type=INVOICE rows.
      if (existing.type === 'INVOICE' && dto.customerId) {
        const points = Math.floor(Number(dto.grandTotal) / 100);
        if (points > 0) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { loyaltyPoints: { increment: points } },
          });
        }
      }

      // PAYMENT_DUE notification for credit finalizations.
      if (existing.type === 'INVOICE' && dto.paymentMode === 'CREDIT') {
        const outstanding = Number(dto.grandTotal) - Number(dto.amountPaid ?? 0);
        await tx.notification.create({
          data: {
            type: 'PAYMENT_DUE',
            title: 'Payment Due',
            message: `Invoice ${existing.invoiceNumber} for ${dto.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${existing.id}]`,
            actionUrl: `/customers/invoices/detail?id=${existing.id}`,
            branchId: existing.branchId ?? branchId ?? null,
          },
        });
      }

      return finalized;
    });
  }

  // ── Edit an UNPAID / PARTIAL invoice ─────────────────────────
  // Lets staff fix items/quantities/rates/customer/payment-mode on a real
  // invoice that the customer hasn't fully paid yet. Inside one transaction
  // we reverse the original side effects (stock, customer outstanding,
  // loyalty) and reapply them with the new figures. PAID/RETURNED/CANCELLED
  // invoices are not editable here — they're financially closed. Drafts go
  // through saveDraft/finalizeDraft instead.
  async editUnpaidInvoice(
    id: string,
    dto: CreateInvoiceDto,
    userId: string,
    branchId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id },
        include: { items: true, creditNotes: { select: { id: true } } },
      });
      if (!existing) throw new NotFoundException('Invoice not found');
      if (branchId && existing.branchId && existing.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }
      if (existing.type !== 'INVOICE') {
        throw new BadRequestException(
          'Only invoices can be edited here. Use the quotation flow for quotations.',
        );
      }
      // PAID / UNPAID / PARTIAL are all editable. CANCELLED is excluded
      // because the invoice has been formally wound down; RETURNED is
      // excluded because a credit note now carries its financial counterweight
      // (and the credit-notes check below would catch that anyway). DRAFT
      // has its own saveDraft / finalizeDraft flow and never reaches here
      // via this endpoint in normal use.
      if (
        existing.status !== 'PAID' &&
        existing.status !== 'UNPAID' &&
        existing.status !== 'PARTIAL'
      ) {
        throw new BadRequestException(
          `Cannot edit invoice ${existing.invoiceNumber}: status is ${existing.status}. CANCELLED / RETURNED invoices are financially closed.`,
        );
      }
      // Block edits on invoices that already have a credit note — those
      // are financially entangled with another document.
      if (existing.creditNotes.length > 0) {
        throw new BadRequestException(
          `Invoice ${existing.invoiceNumber} has a credit note linked to it and can no longer be edited.`,
        );
      }

      // Don't allow the new grand total to fall below what's already been
      // collected — that would put the business in a refund situation we
      // aren't equipped to settle automatically.
      const alreadyPaid = Number(existing.amountPaid);
      if (dto.grandTotal < alreadyPaid - 0.01) {
        throw new BadRequestException(
          `New grand total (₹${dto.grandTotal.toFixed(2)}) is less than the amount already collected (₹${alreadyPaid.toFixed(2)}). Issue a credit note for the difference instead.`,
        );
      }

      // 1) Restore stock from the existing items.
      for (const old of existing.items) {
        await tx.batch.update({
          where: { id: old.batchId },
          data: { quantity: { increment: old.quantity } },
        });
        await tx.product.update({
          where: { id: old.productId },
          data: { totalStock: { increment: old.quantity } },
        });
      }

      // 2) Reverse the old customer-side ledger entries.
      if (existing.customerId) {
        const oldOutstanding = Number(existing.grandTotal) - alreadyPaid;
        if (oldOutstanding > 0) {
          await tx.customer.update({
            where: { id: existing.customerId },
            data: { currentOutstanding: { decrement: oldOutstanding } },
          });
        }
        const oldPoints = Math.floor(Number(existing.grandTotal) / 100);
        if (oldPoints > 0) {
          await tx.customer.update({
            where: { id: existing.customerId },
            data: { loyaltyPoints: { decrement: oldPoints } },
          });
        }
      }

      // 3) Snapshot "before" for the audit log (after we have everything we
      // need from `existing` but before we mutate items / invoice).
      const beforeSnapshot = {
        invoiceNumber: existing.invoiceNumber,
        customerId: existing.customerId,
        customerName: existing.customerName,
        doctorName: existing.doctorName,
        salespersonId: existing.salespersonId,
        salespersonName: existing.salespersonName,
        billingType: existing.billingType,
        subtotal: Number(existing.subtotal),
        productDiscount: Number(existing.productDiscount),
        taxableAmount: Number(existing.taxableAmount),
        cgst: Number(existing.cgst),
        sgst: Number(existing.sgst),
        igst: Number(existing.igst),
        deliveryCharge: Number(existing.deliveryCharge),
        roundOff: Number(existing.roundOff),
        grandTotal: Number(existing.grandTotal),
        paymentMode: existing.paymentMode,
        status: existing.status,
        amountPaid: Number(existing.amountPaid),
        items: existing.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          batchId: it.batchId,
          batchNumber: it.batchNumber,
          quantity: it.quantity,
          mrp: Number(it.mrp),
          rate: Number(it.rate),
          discountPercent: Number(it.discountPercent),
          gstPercent: Number(it.gstPercent),
          amount: Number(it.amount),
        })),
      };

      // 4) Wipe old items and validate the new ones (prescription + stock).
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await this.assertPrescriptionForScheduledItems(
        tx,
        dto.items,
        dto.customerId ?? null,
        dto.billingType,
      );
      for (const item of dto.items) {
        await this.deductStockForItem(tx, item, branchId);
      }

      // 5) Recompute status from the new totals + the (preserved) amountPaid.
      // amountPaid carries forward — we never touch money already collected.
      const newGrandTotal = Number(dto.grandTotal);
      const newStatus =
        alreadyPaid + 0.01 >= newGrandTotal
          ? 'PAID'
          : alreadyPaid > 0
            ? 'PARTIAL'
            : 'UNPAID';

      // 6) Write the updated invoice and recreate items.
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName,
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: dto.subtotal,
          productDiscount: dto.productDiscount ?? 0,
          taxableAmount: dto.taxableAmount ?? dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          deliveryCharge: dto.deliveryCharge ?? 0,
          roundOff: dto.roundOff ?? 0,
          grandTotal: dto.grandTotal,
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          status: newStatus,
          // amountPaid intentionally NOT overwritten — it's the running tally
          // of what the customer actually handed over and lives independently
          // of the invoice's billed amount.
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent ?? 0,
              gstPercent: item.gstPercent ?? 0,
              amount: item.amount,
            })),
          },
        },
        include: { items: true },
      });

      // 7) Reapply the customer-side ledger entries based on the new figures.
      if (dto.customerId) {
        const newOutstanding = newGrandTotal - alreadyPaid;
        if (newOutstanding > 0) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { currentOutstanding: { increment: newOutstanding } },
          });
        }
        const newPoints = Math.floor(newGrandTotal / 100);
        if (newPoints > 0) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { loyaltyPoints: { increment: newPoints } },
          });
        }
      }

      // 8) Write the audit row.
      const afterSnapshot = {
        invoiceNumber: updated.invoiceNumber,
        customerId: updated.customerId,
        customerName: updated.customerName,
        doctorName: updated.doctorName,
        salespersonId: updated.salespersonId,
        salespersonName: updated.salespersonName,
        billingType: updated.billingType,
        subtotal: Number(updated.subtotal),
        productDiscount: Number(updated.productDiscount),
        taxableAmount: Number(updated.taxableAmount),
        cgst: Number(updated.cgst),
        sgst: Number(updated.sgst),
        igst: Number(updated.igst),
        deliveryCharge: Number(updated.deliveryCharge),
        roundOff: Number(updated.roundOff),
        grandTotal: Number(updated.grandTotal),
        paymentMode: updated.paymentMode,
        status: updated.status,
        amountPaid: Number(updated.amountPaid),
        items: updated.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          batchId: it.batchId,
          batchNumber: it.batchNumber,
          quantity: it.quantity,
          mrp: Number(it.mrp),
          rate: Number(it.rate),
          discountPercent: Number(it.discountPercent),
          gstPercent: Number(it.gstPercent),
          amount: Number(it.amount),
        })),
      };
      await tx.invoiceEditAudit.create({
        data: {
          invoiceId: id,
          editedById: userId,
          branchId: existing.branchId ?? branchId ?? null,
          before: beforeSnapshot as Prisma.InputJsonValue,
          after: afterSnapshot as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  async collectPayment(id: string, amountReceived: number, paymentMode: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (branchId && invoice.branchId && invoice.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }

      const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);
      if (outstanding <= 0) {
        throw new BadRequestException('Invoice is already fully paid');
      }
      if (amountReceived <= 0) {
        throw new BadRequestException('Payment amount must be greater than zero');
      }

      const newAmountPaid = Number(invoice.amountPaid) + amountReceived;
      const stillDue = Number(invoice.grandTotal) - newAmountPaid;
      const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          amountPaid: newAmountPaid,
          paymentMode: paymentMode as PaymentMode,
          status: newStatus,
        },
        include: { items: true },
      });

      // Update customer outstanding and create a Payment record
      if (invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentOutstanding: { decrement: amountReceived } },
        });

        const receiptNumber = await this.numbering.nextNumber(
          tx,
          'RCPT',
          invoice.branchId ?? branchId ?? null,
        );
        await tx.payment.create({
          data: {
            receiptNumber,
            customerId: invoice.customerId,
            invoiceId: id,
            amount: amountReceived,
            paymentMode,
            branchId: invoice.branchId ?? null,
          },
        });
      }

      return updated;
    });
  }

  async update(id: string, data: any, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    return this.prisma.invoice.update({ where: { id }, data });
  }

  async remove(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    // Block hard-delete of any invoice that has financial impact (paid, partly
    // paid, on credit, returned). Safe to physically remove:
    //  - CANCELLED invoices (already wound down)
    //  - QUOTATION drafts (never reserved stock)
    //  - INVOICE drafts (user-abandoned, no stock/ledger impact since drafts
    //    skip every side effect — see create() guards)
    const deletable = invoice.status === 'CANCELLED'
      || invoice.status === 'DRAFT';
    if (!deletable) {
      throw new BadRequestException(
        `Cannot delete invoice ${invoice.invoiceNumber} (status: ${invoice.status}). Cancel it first; deletion is reserved for cancelled invoices and unconverted quotations.`,
      );
    }
    return this.prisma.invoice.delete({ where: { id } });
  }

  // ── Tally XML Export ─────────────────────────────────────
  async exportTallyXml(fromDate?: string, toDate?: string, branchId?: string): Promise<string> {
    const where: any = { type: 'INVOICE' };
    if (branchId) where.branchId = branchId;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }
    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'asc' },
    });

    const vouchers = invoices.map((inv) => {
      const dateStr = new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '');
      const ledgerEntries = inv.items.map((item) => `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${this.escXml(item.productName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${Number(item.amount).toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`).join('');

      return `
    <VOUCHER VCHTYPE="Sales" ACTION="Create">
      <DATE>${dateStr}</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${this.escXml(inv.invoiceNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${this.escXml(inv.customerName)}</PARTYLEDGERNAME>
      <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${this.escXml(inv.customerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${Number(inv.grandTotal).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      ${ledgerEntries}
    </VOUCHER>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${vouchers.join('')}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  }

  private escXml(str: string): string {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ── CSV Export ────────────────────────────────────────────
  async exportCsv(fromDate?: string, toDate?: string, branchId?: string): Promise<string> {
    const where: any = { type: 'INVOICE' };
    if (branchId) where.branchId = branchId;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }
    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'asc' },
    });

    const rows = [
      'Invoice No,Date,Customer,Payment Mode,Subtotal,Discount,Taxable,CGST,SGST,Grand Total,Status',
    ];
    for (const inv of invoices) {
      rows.push([
        inv.invoiceNumber,
        new Date(inv.date).toLocaleDateString('en-IN'),
        `"${inv.customerName}"`,
        inv.paymentMode,
        Number(inv.subtotal).toFixed(2),
        Number(inv.productDiscount).toFixed(2),
        Number(inv.taxableAmount).toFixed(2),
        Number(inv.cgst).toFixed(2),
        Number(inv.sgst).toFixed(2),
        Number(inv.grandTotal).toFixed(2),
        inv.status,
      ].join(','));
    }
    return rows.join('\n');
  }
}
