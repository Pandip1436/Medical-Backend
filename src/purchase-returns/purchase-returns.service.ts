import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PurchaseReturnStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { rankByRelevance } from '../common/search-rank.util';

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async create(
    dto: CreatePurchaseReturnDto,
    userId: string,
    userBranchId?: string,
    userRole?: string,
  ) {
    // PHARMACIST and INVENTORY_MANAGER must request approval
    if (userRole === 'PHARMACIST' || userRole === 'INVENTORY_MANAGER') {
      const req = await this.approvalsService.createRequest({
        type: 'PURCHASE_RETURN',
        payload: { ...dto, createdById: userId },
        requestedById: userId,
        branchId: userBranchId,
      });
      return { approvalRequested: true, approvalRequestId: req.id };
    }

    return this.numbering.retryOnCollision(() =>
      this.createInternal(dto, userId, userBranchId),
    );
  }

  private async createInternal(dto: CreatePurchaseReturnDto, userId: string, userBranchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Inherit branchId from the linked GRN if available, fall back to user branch
      let branchId: string | null = userBranchId ?? null;
      if (dto.grnId) {
        const grn = await tx.gRN.findUnique({
          where: { id: dto.grnId },
          select: { branchId: true },
        });
        if (grn) {
          if (userBranchId && grn.branchId && grn.branchId !== userBranchId) {
            throw new NotFoundException('Purchase Received record not found');
          }
          branchId = grn.branchId ?? userBranchId ?? null;
        }
      }

      // Short delivery = goods never arrived → no physical stock to deduct.
      // All other reasons (damaged, expiry, wrong, quality, excess, recall) involve
      // physical goods being returned, so stock IS deducted.
      const isShortDelivery = /short.*delivery|short.*supply/i.test(
        dto.reason ?? '',
      );

      for (const item of dto.items) {
        if (isShortDelivery) continue; // skip stock movement for short delivery
        const batch = await tx.batch.findUnique({
          where: { id: item.batchId },
        });
        if (!batch) {
          throw new NotFoundException(
            `Batch ${item.batchNumber} for ${item.productName} not found`,
          );
        }
        // H4: the batch must actually belong to the product on this line.
        // Without this a mismatched payload would decrement batch X's quantity
        // while debiting product Y's totalStock, drifting BOTH products' stock.
        if (batch.productId !== item.productId) {
          throw new BadRequestException(
            `Batch ${item.batchNumber} does not belong to ${item.productName}.`,
          );
        }
        // Atomic, race-safe decrement (mirrors the sale path): the
        // `quantity >= qty` guard makes this one conditional UPDATE, so two
        // concurrent returns can't both pass a stale check and over-return.
        const dec = await tx.batch.updateMany({
          where: { id: batch.id, quantity: { gte: item.returnedQty } },
          data: { quantity: { decrement: item.returnedQty } },
        });
        if (dec.count === 0) {
          const fresh = await tx.batch.findUnique({
            where: { id: batch.id },
            select: { quantity: true },
          });
          throw new BadRequestException(
            `Insufficient stock to return for ${item.productName} batch ${item.batchNumber}. Available: ${fresh?.quantity ?? 0}`,
          );
        }
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { decrement: item.returnedQty } },
        });
      }

      const debitNoteNo = await this.numbering.nextNumber(tx, 'DN', branchId);
      const settlementMode = dto.settlementMode ?? 'REFUND';

      // Strip a "Settlement Preference: ..." prefix the FE used to splice into
      // the notes string — the structured `settlementMode` field is the source
      // of truth now. (Defensive: harmless if the FE has already stopped doing it.)
      const cleanedNotes =
        (dto.notes ?? '')
          .replace(/^\s*Settlement(?: Preference)?:\s*[^\n;|]*[\s|;]*/i, '')
          .trim() || undefined;

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          debitNoteNo,
          branchId,
          grnId: dto.grnId,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          reason: dto.reason,
          subtotal: dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          totalAmount: dto.totalAmount,
          status: dto.status ?? 'DRAFT',
          settlementMode,
          notes: cleanedNotes,
          createdById: userId,
          // Short-delivery DNs created with the new code never deducted stock,
          // so mark them as already-reversed. Prevents the admin sweep from
          // ever incrementing stock for these (would be a phantom +qty).
          stockReversedAt: isShortDelivery ? new Date() : null,
          items: {
            create: dto.items.map((it) => ({
              productId: it.productId,
              productName: it.productName,
              batchId: it.batchId,
              batchNumber: it.batchNumber,
              expiryDate: new Date(it.expiryDate),
              returnedQty: it.returnedQty,
              purchaseRate: it.purchaseRate,
              gstPercent: it.gstPercent,
              amount: it.amount,
            })),
          },
        },
        include: { items: true },
      });

      // ADJUST: reduce supplier outstanding immediately (we owe them less now). Mark settled.
      // Reject if the adjustment would push outstanding below zero — that
      // means we're claiming a credit larger than what we owe, which should
      // be split into two transactions (settle outstanding + record an
      // advance/refund) rather than silently going negative.
      if (settlementMode === 'ADJUST') {
        const supplier = await tx.supplier.findUnique({
          where: { id: dto.supplierId },
          select: { currentOutstanding: true, name: true },
        });
        const currentOutstanding = Number(supplier?.currentOutstanding ?? 0);
        if (Number(dto.totalAmount) > currentOutstanding + 0.01) {
          throw new BadRequestException(
            `ADJUST debit note (₹${Number(dto.totalAmount).toFixed(2)}) exceeds supplier "${supplier?.name}" outstanding (₹${currentOutstanding.toFixed(2)}). Use REFUND mode for the excess, or split into two notes.`,
          );
        }
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { currentOutstanding: { decrement: dto.totalAmount } },
        });
        await tx.purchaseReturn.update({
          where: { id: purchaseReturn.id },
          data: { status: 'SETTLED' },
        });
      }

      // If this is a short-delivery debit note, recompute the linked PO status
      // (the gap is now financially closed — PO can move to FULLY_RECEIVED)
      if (/short|excess/i.test(dto.reason ?? '') && dto.grnId) {
        const grn = await tx.gRN.findUnique({
          where: { id: dto.grnId },
          select: { poId: true },
        });
        if (grn?.poId) {
          await this.recomputePoStatus(tx, grn.poId);
        }
      }

      return purchaseReturn;
    });
  }

  // Recompute PO status considering both GRN deliveries AND short-delivery debit notes
  private async recomputePoStatus(tx: Prisma.TransactionClient, poId: string) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po) return;

    const allGrns = await tx.gRN.findMany({
      where: { poId },
      include: { items: true, purchaseReturns: { include: { items: true } } },
    });

    // Per-product totals: received via GRN + covered via short-delivery debit notes
    const receivedByProduct: Record<string, number> = {};
    const debitedByProduct: Record<string, number> = {};
    for (const g of allGrns) {
      for (const gi of g.items) {
        receivedByProduct[gi.productId] =
          (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
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

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
    });
  }

  async findAll(query?: string, branchId?: string, skip?: number, take?: number) {
    const where: Prisma.PurchaseReturnWhereInput = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { debitNoteNo: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
      ];
    }

    const paginated = typeof skip === 'number' && typeof take === 'number';
    const safeTake = paginated ? Math.min(Math.max(take, 1), 100) : undefined;
    const safeSkip = paginated ? Math.max(skip, 0) : undefined;

    // With a search query, rank debit-note-NUMBER matches ahead of supplierName-
    // only matches, then slice for pagination (ranking must be global). Debit
    // notes are low-volume, so fetching the full match set is cheap.
    if (query) {
      const matches = await this.prisma.purchaseReturn.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { items: true, grn: true },
      });
      const ranked = rankByRelevance(matches, query, (r) => [r.debitNoteNo]);
      const total = ranked.length;
      const rows = paginated
        ? ranked.slice(safeSkip!, safeSkip! + safeTake!)
        : ranked;
      return paginated
        ? { data: rows, total, hasMore: (safeSkip ?? 0) + rows.length < total }
        : rows;
    }

    // No cap in the non-paginated path anymore — the old `take: 50` silently
    // hid every debit note older than the newest 50 (unsearchable). Callers
    // that want pages pass skip/take; everyone else gets the full set.
    if (!paginated) {
      return this.prisma.purchaseReturn.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { items: true, grn: true },
      });
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: safeSkip,
        take: safeTake,
        include: { items: true, grn: true },
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);
    return { data, total, hasMore: (safeSkip ?? 0) + data.length < total };
  }

  async findOne(id: string, branchId?: string) {
    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true, supplier: true, grn: true },
    });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    return pr;
  }

  async updateStatus(
    id: string,
    status: PurchaseReturnStatus,
    branchId?: string,
  ) {
    const pr = await this.prisma.purchaseReturn.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    // REFUND being marked SETTLED → supplier paid us back, no impact on outstanding.
    // (Outstanding for REFUND is unaffected since payment to supplier was netted by their refund cheque)
    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status },
    });
  }

  // Called after a replacement GRN is confirmed — links the GRN and marks return SETTLED
  async linkReplacementGrn(
    id: string,
    replacementGrnId: string,
    branchId?: string,
  ) {
    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    if (pr.settlementMode !== 'REPLACEMENT') {
      throw new BadRequestException(
        'This debit note does not use Replacement settlement',
      );
    }

    // Validate the replacement GRN: must exist, must be in the caller's branch
    // scope, must belong to the same supplier, and must be flagged isReplacement.
    const replacementGrn = await this.prisma.gRN.findUnique({
      where: { id: replacementGrnId },
    });
    if (!replacementGrn) {
      throw new BadRequestException('Replacement PR not found');
    }
    if (
      branchId &&
      replacementGrn.branchId &&
      replacementGrn.branchId !== branchId
    ) {
      throw new BadRequestException('Replacement PR is not in this branch');
    }
    if (replacementGrn.supplierId !== pr.supplierId) {
      throw new BadRequestException(
        'Replacement GRN supplier does not match the debit note supplier',
      );
    }
    if (!replacementGrn.isReplacement) {
      throw new BadRequestException(
        'Linked GRN is not flagged as a replacement receipt',
      );
    }

    return this.prisma.purchaseReturn.update({
      where: { id },
      data: {
        replacementGrnId,
        status: 'SETTLED',
      },
      include: { items: true },
    });
  }
}
