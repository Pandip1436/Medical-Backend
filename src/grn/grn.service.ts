import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateGrnDto } from './dto/create-grn.dto';

// GRN create/edit run many sequential writes (item + batch + stock per line,
// plus PO/supplier recompute and audit) inside one interactive transaction.
// Over Neon's pooler the default 5s timeout is easily exceeded on multi-line
// GRNs, surfacing as P2028 ("transaction not found / closed"). Give them more
// headroom; maxWait covers waiting for a free pool connection.
const GRN_TX_OPTIONS = { maxWait: 15000, timeout: 60000 } as const;

@Injectable()
export class GrnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  /** Derive a GRN's payment status from how much has been paid vs the invoice. */
  private derivePaymentStatus(
    amountPaid: number,
    invoiceAmount: number,
  ): 'UNPAID' | 'PARTIAL' | 'PAID' {
    if (invoiceAmount <= 0 || amountPaid >= invoiceAmount - 0.01) return 'PAID';
    if (amountPaid <= 0.01) return 'UNPAID';
    return 'PARTIAL';
  }

  async create(createGrnDto: CreateGrnDto, branchId?: string) {
    const effectiveBranchId = branchId ?? createGrnDto.branchId;
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate unique GRN number (atomic per branch+FY)
      const grnNumber = await this.numbering.nextNumber(
        tx,
        'GRN',
        effectiveBranchId ?? null,
      );

      // 1b. If linked to a PO, validate that no item over-receives the
      // remaining ordered qty across all GRNs for that PO.
      if (createGrnDto.poId) {
        await this.validatePoOverReceipt(
          tx,
          createGrnDto.poId,
          createGrnDto.items,
        );
      }

      // 2. Create the GRN Header record (no items yet — items are created next
      // so each batch can carry its grnItemId).
      const isReplacement = createGrnDto.isReplacement === true;
      const grn = await tx.gRN.create({
        data: {
          grnNumber,
          poId: createGrnDto.poId,
          supplierId: createGrnDto.supplierId,
          supplierName: createGrnDto.supplierName,
          supplierInvoiceNo: createGrnDto.supplierInvoiceNo,
          supplierInvoiceDate: new Date(createGrnDto.supplierInvoiceDate),
          supplierInvoiceAmount: createGrnDto.supplierInvoiceAmount,
          totalAmount: createGrnDto.totalAmount,
          status: createGrnDto.status,
          branchId: effectiveBranchId,
          isReplacement,
        },
      });

      // 3. Create items + batches + stock increments (shared with editGrn).
      await this.applyGrnItems(
        tx,
        grn.id,
        createGrnDto.items,
        createGrnDto.supplierId,
      );

      // 3.5 Record the payable + any payment captured at receive time.
      // Outstanding rises by the FULL invoice amount; an initial payment (paid
      // in full or partial at GRN time) is booked as a SupplierPayment credit,
      // so the NET increase to outstanding is just the unpaid portion. This
      // keeps the ledger double-entry (GRN debit + payment credit). Replacement
      // GRNs are stock-back, never a payable.
      const invoiceAmount = Number(createGrnDto.supplierInvoiceAmount) || 0;
      const initialPaid = isReplacement
        ? 0
        : Number(createGrnDto.amountPaid ?? 0);
      if (initialPaid > invoiceAmount + 0.01) {
        throw new BadRequestException(
          `Amount paid (₹${initialPaid.toFixed(2)}) exceeds the GRN invoice amount (₹${invoiceAmount.toFixed(2)})`,
        );
      }

      if (!isReplacement && invoiceAmount > 0) {
        await tx.supplier.update({
          where: { id: createGrnDto.supplierId },
          data: { currentOutstanding: { increment: invoiceAmount } },
        });
      }

      if (initialPaid > 0) {
        const paymentNumber = await this.numbering.nextNumber(
          tx,
          'SPAY',
          effectiveBranchId ?? null,
        );
        await tx.supplierPayment.create({
          data: {
            paymentNumber,
            supplierId: createGrnDto.supplierId,
            grnId: grn.id,
            amount: initialPaid,
            paymentMode: createGrnDto.paymentMode ?? 'CASH',
            branchId: effectiveBranchId ?? null,
          },
        });
        await tx.supplier.update({
          where: { id: createGrnDto.supplierId },
          data: { currentOutstanding: { decrement: initialPaid } },
        });
      }

      // Stamp the GRN's payment state (derived from paid vs invoice amount).
      await tx.gRN.update({
        where: { id: grn.id },
        data: {
          amountPaid: initialPaid,
          paymentStatus: isReplacement
            ? 'PAID'
            : this.derivePaymentStatus(initialPaid, invoiceAmount),
        },
      });

      // 4. Update PO status and PurchaseOrderItem.receivedQty
      if (createGrnDto.poId) {
        await this.recomputePo(tx, createGrnDto.poId);
      }

      return tx.gRN.findUnique({
        where: { id: grn.id },
        include: { items: true },
      });
    }, GRN_TX_OPTIONS);
  }

  /**
   * Create the GRN line items and, for each, spawn its Batch (carrying the
   * grnItemId back-reference) and increment Product.totalStock / latest rates.
   * Shared by create() and editGrn() so the stock-write path lives in one place.
   * The GRN header (grnId) must already exist.
   */
  private async applyGrnItems(
    tx: Prisma.TransactionClient,
    grnId: string,
    items: CreateGrnDto['items'],
    supplierId: string,
  ) {
    for (const item of items) {
      // mfgDate is no longer captured at the form level — fall back to today
      // when missing so the non-nullable DB column stays populated.
      const mfgDate = item.mfgDate ? new Date(item.mfgDate) : new Date();
      const expiryDate = new Date(item.expiryDate);

      const grnItem = await tx.gRNItem.create({
        data: {
          grnId,
          productId: item.productId,
          productName: item.productName,
          orderedQty: item.orderedQty,
          receivedQty: item.receivedQty,
          freeQty: item.freeQty,
          batchNumber: item.batchNumber,
          mfgDate,
          expiryDate,
          purchaseRate: item.purchaseRate,
          mrp: item.mrp,
        },
      });

      const addedStock = item.receivedQty + item.freeQty;
      if (addedStock > 0) {
        await tx.batch.create({
          data: {
            productId: item.productId,
            batchNumber: item.batchNumber,
            mfgDate,
            expiryDate,
            quantity: addedStock,
            mrp: item.mrp,
            purchaseRate: item.purchaseRate,
            supplierId,
            grnItemId: grnItem.id,
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: {
            totalStock: { increment: addedStock },
            purchaseRate: item.purchaseRate, // Update to latest purchase rate
            mrp: item.mrp, // Update to latest MRP
          },
        });
      }
    }
  }

  /**
   * Validate that the incoming items don't over-receive the PO's remaining qty.
   * `excludeGrnId` lets an edit ignore the GRN being edited so its own old
   * contribution isn't double-counted against the remaining.
   */
  private async validatePoOverReceipt(
    tx: Prisma.TransactionClient,
    poId: string,
    items: CreateGrnDto['items'],
    excludeGrnId?: string,
  ) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po) throw new BadRequestException('Linked Purchase Order not found');

    const priorGrns = await tx.gRN.findMany({
      where: {
        poId,
        ...(excludeGrnId ? { id: { not: excludeGrnId } } : {}),
      },
      include: { items: true },
    });
    const priorByProduct: Record<string, number> = {};
    for (const g of priorGrns) {
      for (const gi of g.items) {
        priorByProduct[gi.productId] =
          (priorByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
      }
    }
    const requiredByProduct: Record<string, number> = {};
    for (const pi of po.items) requiredByProduct[pi.productId] = pi.requiredQty;

    for (const item of items) {
      const required = requiredByProduct[item.productId];
      if (required === undefined) continue; // direct-add line not on PO — allowed
      const alreadyReceived = priorByProduct[item.productId] ?? 0;
      const remaining = Math.max(0, required - alreadyReceived);
      const incoming = item.receivedQty + item.freeQty;
      if (incoming > remaining) {
        throw new BadRequestException(
          `Cannot receive ${incoming} of ${item.productName}: only ${remaining} remaining on PO (ordered ${required}, already received ${alreadyReceived})`,
        );
      }
    }
  }

  /**
   * Recompute a PO's per-item receivedQty and overall status from the current
   * set of GRNs linked to it.
   */
  private async recomputePo(tx: Prisma.TransactionClient, poId: string) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po) return;

    const allGrns = await tx.gRN.findMany({
      where: { poId },
      include: { items: true },
    });
    const receivedByProduct: Record<string, number> = {};
    for (const g of allGrns) {
      for (const gi of g.items) {
        receivedByProduct[gi.productId] =
          (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
      }
    }
    for (const pi of po.items) {
      const totalReceived = receivedByProduct[pi.productId] ?? 0;
      if (totalReceived !== pi.receivedQty) {
        await tx.purchaseOrderItem.update({
          where: { id: pi.id },
          data: { receivedQty: totalReceived },
        });
      }
    }
    const allFulfilled = po.items.every(
      (pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty,
    );
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
    });
  }

  /**
   * Edit an existing GRN in place. Only allowed while none of the GRN's batches
   * have been touched (sold / returned / stock-adjusted) — otherwise stock can't
   * be reconciled safely and the caller is told to use a Purchase Return /
   * Stock Adjustment instead. Reverses the old stock + payables, reapplies the
   * new items, recomputes any linked PO, and writes a before/after audit row.
   */
  async editGrn(
    id: string,
    dto: CreateGrnDto,
    userId: string,
    userName: string,
    branchId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Load existing GRN + items (+ branch guard, mirroring findOne).
      const existing = await tx.gRN.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!existing) throw new NotFoundException('Purchase Received record not found');
      if (branchId && existing.branchId && existing.branchId !== branchId) {
        throw new NotFoundException('Purchase Received record not found');
      }

      // 2. Untouched check — has any batch from this GRN moved? Counting
      // references in the four tables that touch a batch is the truth source
      // (Batch.quantity == received would be a false negative on sold-then-
      // returned).
      const grnBatches = await tx.batch.findMany({
        where: { grnItemId: { in: existing.items.map((i) => i.id) } },
        select: { id: true },
      });
      const batchIds = grnBatches.map((b) => b.id);
      if (batchIds.length > 0) {
        const [sold, customerReturns, purchaseReturns, adjustments] =
          await Promise.all([
            tx.invoiceItem.count({ where: { batchId: { in: batchIds } } }),
            tx.creditNoteItem.count({ where: { batchId: { in: batchIds } } }),
            tx.purchaseReturnItem.count({
              where: { batchId: { in: batchIds } },
            }),
            tx.stockAdjustmentLog.count({
              where: { batchId: { in: batchIds } },
            }),
          ]);
        if (sold + customerReturns + purchaseReturns + adjustments > 0) {
          throw new BadRequestException(
            `Cannot edit PR ${existing.grnNumber}: its stock has already moved (sold, returned, or adjusted). Reverse it with a Purchase Return or Stock Adjustment instead.`,
          );
        }
      }

      // 3. PO over-receipt re-validation against the NEW payload, ignoring this
      // GRN's old contribution so sibling GRNs on the same PO are respected.
      if (existing.poId) {
        await this.validatePoOverReceipt(tx, existing.poId, dto.items, id);
      }

      // 4. Snapshot "before" for the audit log.
      const before = this.snapshotGrn(existing);

      // Editing the invoice amount below what's already been paid would imply a
      // supplier overpayment / refund — refuse and tell the user to handle that
      // via a Purchase Return (REFUND) or by reversing the payment first. Keeps
      // outstanding from silently going negative (mirrors the debit-note guard).
      const existingPaid = Number(existing.amountPaid);
      if (
        !existing.isReplacement &&
        existingPaid > Number(dto.supplierInvoiceAmount) + 0.01
      ) {
        throw new BadRequestException(
          `Cannot set PR invoice amount to ₹${Number(dto.supplierInvoiceAmount).toFixed(2)}: ₹${existingPaid.toFixed(2)} has already been paid. Reverse the payment or raise a Purchase Return (REFUND) first.`,
        );
      }

      // 5. Reverse old stock + payables. Safe to delete batches outright because
      // the untouched check above proved nothing references them.
      for (const old of existing.items) {
        const oldStock = old.receivedQty + old.freeQty;
        if (oldStock > 0) {
          await tx.product.update({
            where: { id: old.productId },
            data: { totalStock: { decrement: oldStock } },
          });
        }
      }
      await tx.batch.deleteMany({
        where: { grnItemId: { in: existing.items.map((i) => i.id) } },
      });
      await tx.gRNItem.deleteMany({ where: { grnId: id } });
      if (
        !existing.isReplacement &&
        Number(existing.supplierInvoiceAmount) > 0
      ) {
        await tx.supplier.update({
          where: { id: existing.supplierId },
          data: {
            currentOutstanding: { decrement: existing.supplierInvoiceAmount },
          },
        });
      }

      // 6. Reapply new items + header (supplier / PO linkage stay fixed).
      await this.applyGrnItems(tx, id, dto.items, existing.supplierId);
      await tx.gRN.update({
        where: { id },
        data: {
          supplierInvoiceNo: dto.supplierInvoiceNo,
          supplierInvoiceDate: new Date(dto.supplierInvoiceDate),
          supplierInvoiceAmount: dto.supplierInvoiceAmount,
          totalAmount: dto.totalAmount,
          status: dto.status,
          // amountPaid is preserved (payments are unchanged by an edit); only
          // re-derive the payment status against the new invoice amount.
          paymentStatus: existing.isReplacement
            ? 'PAID'
            : this.derivePaymentStatus(
                existingPaid,
                Number(dto.supplierInvoiceAmount),
              ),
        },
      });
      if (!existing.isReplacement && dto.supplierInvoiceAmount > 0) {
        await tx.supplier.update({
          where: { id: existing.supplierId },
          data: {
            currentOutstanding: { increment: dto.supplierInvoiceAmount },
          },
        });
      }

      // 7. Recompute the linked PO from the new item set.
      if (existing.poId) await this.recomputePo(tx, existing.poId);

      // 8. Audit before/after.
      const updated = await tx.gRN.findUnique({
        where: { id },
        include: { items: true },
      });
      await tx.grnEditLog.create({
        data: {
          grnId: id,
          editedById: userId,
          editedByName: userName,
          branchId: existing.branchId,
          before,
          after: updated ? this.snapshotGrn(updated) : Prisma.JsonNull,
        },
      });

      return updated;
    }, GRN_TX_OPTIONS);
  }

  /** JSON-safe snapshot of a GRN + its items for the edit audit log. */
  private snapshotGrn(grn: {
    grnNumber: string;
    poId: string | null;
    supplierId: string;
    supplierName: string;
    supplierInvoiceNo: string;
    supplierInvoiceDate: Date;
    supplierInvoiceAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    status: string;
    isReplacement: boolean;
    items: Array<{
      productId: string;
      productName: string;
      orderedQty: number;
      receivedQty: number;
      freeQty: number;
      batchNumber: string;
      mfgDate: Date;
      expiryDate: Date;
      purchaseRate: Prisma.Decimal;
      mrp: Prisma.Decimal;
    }>;
  }): Prisma.InputJsonValue {
    return {
      grnNumber: grn.grnNumber,
      poId: grn.poId,
      supplierId: grn.supplierId,
      supplierName: grn.supplierName,
      supplierInvoiceNo: grn.supplierInvoiceNo,
      supplierInvoiceDate: grn.supplierInvoiceDate.toISOString(),
      supplierInvoiceAmount: Number(grn.supplierInvoiceAmount),
      totalAmount: Number(grn.totalAmount),
      status: grn.status,
      isReplacement: grn.isReplacement,
      items: grn.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        orderedQty: it.orderedQty,
        receivedQty: it.receivedQty,
        freeQty: it.freeQty,
        batchNumber: it.batchNumber,
        mfgDate: it.mfgDate.toISOString(),
        expiryDate: it.expiryDate.toISOString(),
        purchaseRate: Number(it.purchaseRate),
        mrp: Number(it.mrp),
      })),
    };
  }

  async findAll(
    query?: string,
    branchId?: string,
    page?: number,
    pageSize?: number,
  ) {
    const where: Prisma.GRNWhereInput = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { grnNumber: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: query, mode: 'insensitive' } },
      ];
    }
    const include = {
      items: true,
      purchaseReturns: { include: { items: true } },
    } satisfies Prisma.GRNInclude;
    const orderBy = {
      date: 'desc' as const,
    } satisfies Prisma.GRNOrderByWithRelationInput;

    // Backwards-compatible: if no page is requested, return the full array as
    // before so existing FE callers keep working.
    if (!page || page < 1) {
      return this.prisma.gRN.findMany({ where, include, orderBy });
    }
    const safeSize = Math.min(Math.max(pageSize ?? 20, 1), 200);
    const [items, total] = await Promise.all([
      this.prisma.gRN.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.gRN.count({ where }),
    ]);
    return { items, total, page, pageSize: safeSize };
  }

  async reverseShortDeliveryStockDeduction() {
    // Find PurchaseReturns whose reason indicates short delivery (no physical
    // goods) AND that haven't already been reversed. The stockReversedAt flag
    // makes this idempotent — re-running won't double-add stock.
    const allReturns = await this.prisma.purchaseReturn.findMany({
      include: { items: true },
    });
    const shortReturns = allReturns.filter(
      (pr) =>
        /short.*delivery|short.*supply/i.test(pr.reason ?? '') &&
        !pr.stockReversedAt,
    );

    let batchesFixed = 0;
    let productsFixed = 0;
    const fixed: Array<{ debitNoteNo: string; reason: string; items: number }> =
      [];
    const skipped = allReturns.filter(
      (pr) =>
        /short.*delivery|short.*supply/i.test(pr.reason ?? '') &&
        pr.stockReversedAt,
    ).length;

    for (const pr of shortReturns) {
      for (const item of pr.items) {
        // Re-add to batch
        const batch = await this.prisma.batch.findUnique({
          where: { id: item.batchId },
        });
        if (batch) {
          await this.prisma.batch.update({
            where: { id: item.batchId },
            data: { quantity: { increment: item.returnedQty } },
          });
          batchesFixed++;
        }
        // Re-add to product totalStock
        await this.prisma.product
          .update({
            where: { id: item.productId },
            data: { totalStock: { increment: item.returnedQty } },
          })
          .catch(() => {});
        productsFixed++;
      }
      // Mark this DN as reversed so a re-run won't add the qty again.
      await this.prisma.purchaseReturn.update({
        where: { id: pr.id },
        data: { stockReversedAt: new Date() },
      });
      fixed.push({
        debitNoteNo: pr.debitNoteNo,
        reason: pr.reason,
        items: pr.items.length,
      });
    }

    const skipNote =
      skipped > 0 ? ` Skipped ${skipped} already-reversed debit note(s).` : '';
    return {
      message:
        `Reversed stock deduction for ${shortReturns.length} short-delivery debit note(s). ` +
        `${batchesFixed} batch updates, ${productsFixed} product stock updates.${skipNote}`,
      fixed,
      skipped,
    };
  }

  async backfillPoStatusWithDebitNotes() {
    // Recompute every PO's status considering both GRN deliveries AND short-delivery debit notes
    const pos = await this.prisma.purchaseOrder.findMany({
      include: { items: true },
    });
    let updated = 0;
    for (const po of pos) {
      const allGrns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true, purchaseReturns: { include: { items: true } } },
      });
      if (allGrns.length === 0) continue;

      const receivedByProduct: Record<string, number> = {};
      const debitedByProduct: Record<string, number> = {};
      for (const g of allGrns) {
        for (const gi of g.items) {
          receivedByProduct[gi.productId] =
            (receivedByProduct[gi.productId] ?? 0) +
            gi.receivedQty +
            gi.freeQty;
        }
        for (const pr of g.purchaseReturns ?? []) {
          if (/short|excess/i.test(pr.reason ?? '')) {
            for (const pi of pr.items) {
              debitedByProduct[pi.productId] =
                (debitedByProduct[pi.productId] ?? 0) + pi.returnedQty;
            }
          }
        }
      }
      const allFulfilled = po.items.every(
        (pi) =>
          (receivedByProduct[pi.productId] ?? 0) +
            (debitedByProduct[pi.productId] ?? 0) >=
          pi.requiredQty,
      );
      const expected = allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
      if (
        po.status !== expected &&
        po.status !== 'CLOSED' &&
        po.status !== 'DRAFT'
      ) {
        await this.prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: expected },
        });
        updated++;
      }
    }
    return {
      message: `PO status backfill (with debit notes) complete. ${updated} POs updated.`,
    };
  }

  async backfillSupplierOutstanding() {
    // Recompute each supplier's outstanding from scratch:
    // outstanding = sum(GRN.supplierInvoiceAmount where !isReplacement)
    //             - sum(PurchaseReturn.totalAmount where settlementMode = 'ADJUST')
    //             - sum(SupplierPayment.amount)
    const suppliers = await this.prisma.supplier.findMany();
    let updated = 0;
    for (const s of suppliers) {
      const grns = await this.prisma.gRN.findMany({
        where: { supplierId: s.id },
      });
      const grnSum = grns.reduce(
        (acc, g) =>
          acc + (g.isReplacement ? 0 : Number(g.supplierInvoiceAmount)),
        0,
      );
      const adjustReturns = await this.prisma.purchaseReturn.findMany({
        where: { supplierId: s.id, settlementMode: 'ADJUST' },
      });
      const adjustSum = adjustReturns.reduce(
        (acc, r) => acc + Number(r.totalAmount),
        0,
      );
      const payments = await this.prisma.supplierPayment.findMany({
        where: { supplierId: s.id },
      });
      const paidSum = payments.reduce((acc, p) => acc + Number(p.amount), 0);
      const expected = Math.max(0, grnSum - adjustSum - paidSum);
      if (Number(s.currentOutstanding) !== expected) {
        await this.prisma.supplier.update({
          where: { id: s.id },
          data: { currentOutstanding: expected },
        });
        updated++;
      }
    }
    return {
      message: `Supplier outstanding backfill complete. ${updated} suppliers updated.`,
    };
  }

  async backfillGrnOrderedQty() {
    // For each PO, walk through GRNs in chronological order and set
    // each GRN item's orderedQty = remaining qty at the time of that delivery
    const pos = await this.prisma.purchaseOrder.findMany({
      include: { items: true },
    });
    let updated = 0;
    for (const po of pos) {
      const grns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true },
        orderBy: { date: 'asc' },
      });
      if (grns.length === 0) continue;

      // Track running received qty per product
      const cumulativeReceived: Record<string, number> = {};
      const requiredByProduct: Record<string, number> = {};
      for (const pi of po.items) {
        requiredByProduct[pi.productId] = pi.requiredQty;
      }

      for (const grn of grns) {
        for (const gi of grn.items) {
          const required = requiredByProduct[gi.productId] ?? gi.orderedQty;
          const alreadyReceived = cumulativeReceived[gi.productId] ?? 0;
          const expectedThisDelivery = Math.max(0, required - alreadyReceived);
          if (expectedThisDelivery !== gi.orderedQty) {
            await this.prisma.gRNItem.update({
              where: { id: gi.id },
              data: { orderedQty: expectedThisDelivery },
            });
            updated++;
          }
          cumulativeReceived[gi.productId] =
            alreadyReceived + gi.receivedQty + gi.freeQty;
        }
      }
    }
    return { message: `Backfill complete. ${updated} GRN items updated.` };
  }

  async backfillPoReceivedQty() {
    // Find all POs that have linked GRNs
    const pos = await this.prisma.purchaseOrder.findMany({
      include: { items: true },
    });
    let updated = 0;
    for (const po of pos) {
      const allGrns = await this.prisma.gRN.findMany({
        where: { poId: po.id },
        include: { items: true },
      });
      if (allGrns.length === 0) continue;
      const receivedByProduct: Record<string, number> = {};
      for (const g of allGrns) {
        for (const gi of g.items) {
          receivedByProduct[gi.productId] =
            (receivedByProduct[gi.productId] ?? 0) +
            gi.receivedQty +
            gi.freeQty;
        }
      }
      for (const pi of po.items) {
        const totalReceived = receivedByProduct[pi.productId] ?? 0;
        if (totalReceived !== pi.receivedQty) {
          await this.prisma.purchaseOrderItem.update({
            where: { id: pi.id },
            data: { receivedQty: totalReceived },
          });
          updated++;
        }
      }
      const allFulfilled = po.items.every(
        (pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty,
      );
      const expectedStatus = allFulfilled
        ? 'FULLY_RECEIVED'
        : 'PARTIALLY_RECEIVED';
      if (
        po.status !== expectedStatus &&
        po.status !== 'CLOSED' &&
        po.status !== 'DRAFT'
      ) {
        await this.prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: expectedStatus },
        });
      }
    }
    return { message: `Backfill complete. ${updated} PO items updated.` };
  }

  async backfillBatchGrnItemId() {
    // Link existing batches to the GRN line that created them, matching by
    // (productId, batchNumber, expiryDate, supplierId). One-time pass for
    // batches created before the grnItemId column existed.
    const grns = await this.prisma.gRN.findMany({ include: { items: true } });
    let linked = 0;
    let unmatched = 0;
    for (const grn of grns) {
      for (const item of grn.items) {
        const already = await this.prisma.batch.findFirst({
          where: { grnItemId: item.id },
        });
        if (already) continue;
        const candidate = await this.prisma.batch.findFirst({
          where: {
            grnItemId: null,
            productId: item.productId,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            supplierId: grn.supplierId,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (candidate) {
          await this.prisma.batch.update({
            where: { id: candidate.id },
            data: { grnItemId: item.id },
          });
          linked++;
        } else {
          unmatched++;
        }
      }
    }
    return {
      message: `Batch→GRN backfill complete. ${linked} batches linked, ${unmatched} GRN items had no matching unlinked batch.`,
    };
  }

  async findOne(id: string, branchId?: string) {
    const grn = await this.prisma.gRN.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!grn) throw new NotFoundException('Purchase Received record not found');
    if (branchId && grn.branchId && grn.branchId !== branchId) {
      throw new NotFoundException('Purchase Received record not found');
    }
    return grn;
  }

  // "View Bill" — for each line of this PE, trace the batches it created
  // (Batch.grnItemId) and report how many units were SOLD (InvoiceItem.batchId)
  // and RETURNED (CreditNoteItem.batchId, APPROVED credit notes only), with the
  // underlying sale invoices + returns so the UI can list and link them.
  async findBillDetail(id: string, branchId?: string) {
    const grn = await this.prisma.gRN.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            batches: { select: { id: true, batchNumber: true, quantity: true } },
          },
        },
      },
    });
    if (!grn) throw new NotFoundException('Purchase Received record not found');
    if (branchId && grn.branchId && grn.branchId !== branchId) {
      throw new NotFoundException('Purchase Received record not found');
    }

    const batchIds = grn.items.flatMap((it) => it.batches.map((b) => b.id));

    const [saleItems, returnItems] = await Promise.all([
      batchIds.length
        ? this.prisma.invoiceItem.findMany({
            where: { batchId: { in: batchIds } },
            include: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  date: true,
                  customerName: true,
                  customerId: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      batchIds.length
        ? this.prisma.creditNoteItem.findMany({
            where: { batchId: { in: batchIds }, creditNote: { status: 'APPROVED' } },
            include: {
              creditNote: {
                select: {
                  id: true,
                  creditNoteNo: true,
                  invoiceId: true,
                  date: true,
                  customerName: true,
                  customerId: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Index sale/return rows by the batch they came from.
    const salesByBatch = new Map<string, any[]>();
    for (const si of saleItems) {
      const arr = salesByBatch.get(si.batchId) ?? [];
      arr.push({
        invoiceId: si.invoice.id,
        invoiceNumber: si.invoice.invoiceNumber,
        date: si.invoice.date,
        customerName: si.invoice.customerName,
        customerId: si.invoice.customerId,
        quantity: si.quantity,
        amount: si.amount,
      });
      salesByBatch.set(si.batchId, arr);
    }
    const returnsByBatch = new Map<string, any[]>();
    for (const ri of returnItems) {
      const arr = returnsByBatch.get(ri.batchId) ?? [];
      arr.push({
        creditNoteId: ri.creditNote.id,
        creditNoteNo: ri.creditNote.creditNoteNo,
        invoiceId: ri.creditNote.invoiceId,
        date: ri.creditNote.date,
        customerName: ri.creditNote.customerName,
        customerId: ri.creditNote.customerId,
        returnedQty: ri.returnedQty,
        amount: ri.amount,
      });
      returnsByBatch.set(ri.batchId, arr);
    }

    // One row per PE line item (its batchNumber lives on the item); aggregate
    // sold/returned across the item's batch(es) — usually exactly one.
    const items = grn.items.map((it) => {
      const itemBatchIds = it.batches.map((b) => b.id);
      const sales = itemBatchIds.flatMap((bid) => salesByBatch.get(bid) ?? []);
      const returns = itemBatchIds.flatMap((bid) => returnsByBatch.get(bid) ?? []);
      return {
        productId: it.productId,
        productName: it.productName,
        batchNumber: it.batchNumber,
        expiryDate: it.expiryDate,
        receivedQty: it.receivedQty + (it.freeQty ?? 0),
        currentStock: it.batches.reduce((s, b) => s + b.quantity, 0),
        unitsSold: sales.reduce((s, x) => s + x.quantity, 0),
        unitsReturned: returns.reduce((s, x) => s + x.returnedQty, 0),
        sales,
        returns,
      };
    });

    return { grnId: grn.id, grnNumber: grn.grnNumber, items };
  }
}
