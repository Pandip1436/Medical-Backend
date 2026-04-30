import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  async create(dto: CreatePurchaseReturnDto, userId: string, userBranchId?: string, userRole?: string) {
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

    return this.prisma.$transaction(async (tx) => {
      // Inherit branchId from the linked GRN if available, fall back to user branch
      let branchId: string | null = userBranchId ?? null;
      if (dto.grnId) {
        const grn = await tx.gRN.findUnique({ where: { id: dto.grnId }, select: { branchId: true } });
        if (grn) {
          if (userBranchId && grn.branchId && grn.branchId !== userBranchId) {
            throw new NotFoundException('GRN not found');
          }
          branchId = grn.branchId ?? userBranchId ?? null;
        }
      }

      // Short delivery = goods never arrived → no physical stock to deduct.
      // All other reasons (damaged, expiry, wrong, quality, excess, recall) involve
      // physical goods being returned, so stock IS deducted.
      const isShortDelivery = /short.*delivery|short.*supply/i.test(dto.reason ?? '');

      for (const item of dto.items) {
        if (isShortDelivery) continue; // skip stock movement for short delivery
        const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
        if (!batch) {
          throw new NotFoundException(`Batch ${item.batchNumber} for ${item.productName} not found`);
        }
        if (batch.quantity < item.returnedQty) {
          throw new BadRequestException(
            `Insufficient stock to return for ${item.productName} batch ${item.batchNumber}. Available: ${batch.quantity}`,
          );
        }
        await tx.batch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity - item.returnedQty },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { decrement: item.returnedQty } },
        });
      }

      const debitNoteNo = `DN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const settlementMode = dto.settlementMode ?? 'REFUND';

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
          notes: dto.notes,
          createdById: userId,
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
      if (settlementMode === 'ADJUST') {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { currentOutstanding: { decrement: dto.totalAmount } as any },
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
  private async recomputePoStatus(tx: any, poId: string) {
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
        receivedByProduct[gi.productId] = (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
      }
      for (const pr of g.purchaseReturns ?? []) {
        if (/short|excess/i.test(pr.reason ?? '')) {
          for (const pi of pr.items) {
            debitedByProduct[pi.productId] = (debitedByProduct[pi.productId] ?? 0) + pi.returnedQty;
          }
        }
      }
    }

    const allFulfilled = po.items.every(
      (pi: any) =>
        ((receivedByProduct[pi.productId] ?? 0) + (debitedByProduct[pi.productId] ?? 0)) >= pi.requiredQty
    );

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
    });
  }

  findAll(query?: string, branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { debitNoteNo: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.purchaseReturn.findMany({ 
      where, 
      orderBy: { date: 'desc' }, 
      take: 50,
      include: { items: true, grn: true }
    });
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

  async updateStatus(id: string, status: any, branchId?: string) {
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
  async linkReplacementGrn(id: string, replacementGrnId: string, branchId?: string) {
    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!pr) throw new NotFoundException('Purchase return not found');
    if (branchId && pr.branchId && pr.branchId !== branchId) {
      throw new NotFoundException('Purchase return not found');
    }
    if ((pr as any).settlementMode !== 'REPLACEMENT') {
      throw new BadRequestException('This debit note does not use Replacement settlement');
    }

    return this.prisma.purchaseReturn.update({
      where: { id },
      data: {
        replacementGrnId,
        status: 'SETTLED',
      } as any,
      include: { items: true },
    });
  }
}
