import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalType } from '@prisma/client';
import { DocumentNumberingService } from '../common/services/document-numbering.service';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  // ── Create a pending request ───────────────────────────────
  async createRequest(opts: {
    type: ApprovalType;
    payload: Record<string, any>;
    requestedById: string;
    branchId?: string;
    refId?: string;
  }) {
    const request = await this.prisma.approvalRequest.create({
      data: {
        type: opts.type,
        payload: opts.payload,
        requestedById: opts.requestedById,
        branchId: opts.branchId ?? null,
        refId: opts.refId ?? null,
      },
      include: { requestedBy: { select: { id: true, name: true, role: true } } },
    });

    // Fire an APPROVAL notification for admins in the branch
    await this.prisma.notification.create({
      data: {
        type: 'APPROVAL',
        title: 'Approval Required',
        message: `${request.requestedBy.name} requested approval for ${opts.type.replace(/_/g, ' ').toLowerCase()}.`,
        actionUrl: `/admin/approvals/detail?id=${request.id}`,
        branchId: opts.branchId ?? null,
      },
    });

    return request;
  }

  // ── List requests (admin sees all, others see own) ─────────
  findAll(opts: { branchId?: string; status?: string; type?: string; userId?: string; role?: string }) {
    const where: any = {};
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.status) where.status = opts.status;
    if (opts.type) where.type = opts.type;
    // Non-admins only see their own requests
    if (opts.role !== 'ADMIN') where.requestedById = opts.userId;

    return this.prisma.approvalRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ── Admin approves ─────────────────────────────────────────
  async approve(id: string, reviewedById: string, reviewNote?: string, reviewerBranchId?: string) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');
    // Branch isolation: an admin tied to a branch can only review requests
    // from the same branch. Admins without a branchId (super-admin / multi-
    // branch) can review anything.
    if (reviewerBranchId && req.branchId && reviewerBranchId !== req.branchId) {
      throw new ForbiddenException(
        'You cannot approve a request from a different branch',
      );
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });

    // Execute the approved action
    await this.executeApprovedAction(req.type, req.payload as Record<string, any>, req.refId, req.branchId);

    // Notify requestor
    await this.prisma.notification.create({
      data: {
        type: 'APPROVAL',
        title: 'Request Approved',
        message: `Your ${req.type.replace(/_/g, ' ').toLowerCase()} request has been approved.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
        actionUrl: `/admin/approvals/detail?id=${id}`,
        branchId: req.branchId ?? null,
      },
    });

    return updated;
  }

  // ── Admin rejects ──────────────────────────────────────────
  async reject(id: string, reviewedById: string, reviewNote: string, reviewerBranchId?: string) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');
    if (reviewerBranchId && req.branchId && reviewerBranchId !== req.branchId) {
      throw new ForbiddenException(
        'You cannot reject a request from a different branch',
      );
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById, reviewedAt: new Date(), reviewNote },
    });

    // If there was a draft invoice created, cancel it
    if (req.type === 'CREDIT_BILL' && req.refId) {
      await this.prisma.invoice.update({
        where: { id: req.refId },
        data: { status: 'CANCELLED' },
      }).catch(() => {});
    }

    // Notify requestor
    await this.prisma.notification.create({
      data: {
        type: 'APPROVAL',
        title: 'Request Rejected',
        message: `Your ${req.type.replace(/_/g, ' ').toLowerCase()} request was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
        actionUrl: `/admin/approvals/detail?id=${id}`,
        branchId: req.branchId ?? null,
      },
    });

    return updated;
  }

  // ── Count pending (for badge) ──────────────────────────────
  countPending(branchId?: string) {
    return this.prisma.approvalRequest.count({
      where: { status: 'PENDING', ...(branchId ? { branchId } : {}) },
    });
  }

  // ── Execute the actual action after approval ───────────────
  private async executeApprovedAction(
    type: ApprovalType,
    payload: Record<string, any>,
    refId: string | null,
    branchId: string | null,
  ) {
    switch (type) {
      case 'NEW_CUSTOMER': {
        await this.prisma.customer.create({ data: { ...payload, branchId: branchId ?? null } as any });
        break;
      }

      case 'CREDIT_BILL': {
        // Re-validate stock NOW (between request and approval, other sales
        // may have depleted the batches). If anything's short or expired,
        // throw — the request stays approved-but-failed and admin sees the
        // error; pharmacist must raise a new request.
        if (!refId) break;
        await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id: refId },
            include: { items: true },
          });
          if (!invoice) throw new NotFoundException('Draft invoice not found');
          if (invoice.status !== 'DRAFT') {
            throw new BadRequestException(
              `Draft invoice already in status ${invoice.status}`,
            );
          }
          // Re-check Schedule H/H1/X prescription requirement at approval
          // time — if the customer's Rx expired between request and approval,
          // we can't legally dispense.
          const productSchedules = await tx.product.findMany({
            where: { id: { in: invoice.items.map((i) => i.productId) } },
            select: { id: true, name: true, schedule: true },
          });
          const needsRx = productSchedules.filter(
            (p) => p.schedule === 'H' || p.schedule === 'H1' || p.schedule === 'X',
          );
          if (needsRx.length > 0) {
            if (!invoice.customerId) {
              throw new BadRequestException(
                `Cannot approve: Schedule H/H1/X drugs require a registered customer with a valid prescription.`,
              );
            }
            const activeRx = await tx.prescription.findFirst({
              where: {
                customerId: invoice.customerId,
                isActive: true,
                OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
              },
              select: { id: true },
            });
            if (!activeRx) {
              const names = needsRx.map((p) => p.name).join(', ');
              throw new BadRequestException(
                `Cannot approve: customer has no active prescription for ${names}.`,
              );
            }
          }
          for (const item of invoice.items) {
            const batch = await tx.batch.findUnique({
              where: { id: item.batchId },
            });
            if (!batch) {
              throw new BadRequestException(
                `Batch ${item.batchNumber} for ${item.productName} no longer exists`,
              );
            }
            if (new Date(batch.expiryDate) < new Date()) {
              throw new BadRequestException(
                `Cannot approve: batch ${item.batchNumber} of ${item.productName} has expired`,
              );
            }
            if (batch.quantity < item.quantity) {
              throw new BadRequestException(
                `Cannot approve: insufficient stock for ${item.productName} batch ${item.batchNumber}. Available ${batch.quantity}, needed ${item.quantity}`,
              );
            }
            await tx.batch.update({
              where: { id: batch.id },
              data: { quantity: batch.quantity - item.quantity },
            });
            await tx.product.update({
              where: { id: item.productId },
              data: { totalStock: { decrement: item.quantity } },
            });
          }
          await tx.invoice.update({
            where: { id: refId },
            data: { status: 'UNPAID' },
          });
          if (invoice.customerId) {
            await tx.customer.update({
              where: { id: invoice.customerId },
              data: {
                currentOutstanding: { increment: invoice.grandTotal },
              },
            });
          }
        });
        break;
      }

      case 'SALES_RETURN': {
        // Re-execute the credit note creation from stored payload, with the
        // same cumulative-return guard the direct create flow uses.
        await this.prisma.$transaction(async (tx) => {
          const creditNoteNo = await this.numbering.nextNumber(
            tx,
            'CN',
            branchId,
          );
          // Re-validate cumulative returned qty per (productId, batchId) so a
          // prior credit note that landed between request + approval doesn't
          // let us over-restore stock.
          if (payload.invoiceId) {
            const invoice = await tx.invoice.findUnique({
              where: { id: payload.invoiceId },
              include: { items: true },
            });
            if (!invoice) throw new NotFoundException('Invoice not found');
            const priorReturns = await tx.creditNoteItem.findMany({
              where: { creditNote: { invoiceId: invoice.id } },
              select: { productId: true, batchId: true, returnedQty: true },
            });
            const priorByKey = new Map<string, number>();
            for (const r of priorReturns) {
              const k = `${r.productId}::${r.batchId}`;
              priorByKey.set(k, (priorByKey.get(k) ?? 0) + r.returnedQty);
            }
            for (const item of payload.items ?? []) {
              const sold = invoice.items.find(
                (i) => i.productId === item.productId && i.batchId === item.batchId,
              );
              if (!sold) {
                throw new BadRequestException(
                  `Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`,
                );
              }
              const alreadyReturned =
                priorByKey.get(`${item.productId}::${item.batchId}`) ?? 0;
              const remaining = sold.quantity - alreadyReturned;
              if (item.returnedQty > remaining) {
                throw new BadRequestException(
                  `Cannot approve return: only ${remaining} of ${item.productName} unreturned (sold ${sold.quantity}, already returned ${alreadyReturned})`,
                );
              }
            }
          }
          // Restore stock for each item
          for (const item of payload.items ?? []) {
            await tx.batch.update({ where: { id: item.batchId }, data: { quantity: { increment: item.returnedQty } } });
            await tx.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.returnedQty } } });
          }
          const cnSettlementMode = payload.settlementMode ?? 'REFUND';
          await (tx as any).creditNote.create({
            data: {
              creditNoteNo,
              invoiceId: payload.invoiceId,
              invoiceNumber: payload.invoiceNumber,
              customerId: payload.customerId,
              customerName: payload.customerName,
              reason: payload.reason,
              subtotal: payload.subtotal,
              cgst: payload.cgst ?? 0,
              sgst: payload.sgst ?? 0,
              igst: payload.igst ?? 0,
              totalAmount: payload.totalAmount,
              settlementMode: cnSettlementMode,
              settledAt: cnSettlementMode === 'CREDIT' ? new Date() : null,
              createdById: payload.createdById,
              branchId: branchId ?? null,
              items: { create: payload.items.map((i: any) => ({
                productId: i.productId,
                productName: i.productName,
                batchId: i.batchId,
                batchNumber: i.batchNumber,
                expiryDate: new Date(i.expiryDate),
                returnedQty: i.returnedQty,
                rate: i.rate,
                amount: i.amount,
                gstPercent: i.gstPercent ?? 0,
              })) },
            },
          });
          if (payload.settlementMode === 'CREDIT' && payload.customerId) {
            await tx.customer.update({
              where: { id: payload.customerId },
              data: { currentOutstanding: { decrement: payload.totalAmount } },
            });
          }
        });
        break;
      }

      case 'INVENTORY_ADJUSTMENT' as any: {
        // Re-execute the bulk stock adjustment from stored payload. We re-load
        // each batch fresh (don't trust quantities captured at submit time —
        // they may have moved between request and approval) and re-issue an
        // ADJ document number atomically.
        const items = (payload.items as Array<{
          productId: string;
          batchId: string;
          adjustedQty: number;
          reason: string;
        }>) ?? [];
        await this.prisma.$transaction(async (tx) => {
          const adjustmentNo = await this.numbering.nextNumber(
            tx,
            'ADJ' as any,
            branchId,
          );
          for (const item of items) {
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            if (!product) {
              throw new NotFoundException(`Product ${item.productId} not found`);
            }
            if (branchId && product.branchId && product.branchId !== branchId) {
              throw new BadRequestException(
                `Product ${product.name} belongs to a different branch`,
              );
            }
            const batch = await tx.batch.findFirst({
              where: { id: item.batchId, productId: item.productId },
            });
            if (!batch) {
              throw new NotFoundException(`Batch ${item.batchId} not found`);
            }
            const diff = item.adjustedQty - batch.quantity;
            await tx.batch.update({
              where: { id: batch.id },
              data: { quantity: item.adjustedQty },
            });
            await tx.product.update({
              where: { id: product.id },
              data: { totalStock: { increment: diff } },
            });
            await (tx as any).stockAdjustmentLog.create({
              data: {
                adjustmentNo,
                productId: product.id,
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                userId: payload.requestedById ?? '',
                userName: payload.requestedByName ?? 'Unknown',
                reason: item.reason,
                previousQty: batch.quantity,
                adjustedQty: item.adjustedQty,
                diff,
                branchId: product.branchId ?? branchId ?? null,
              },
            });
          }
        });
        break;
      }

      case 'PURCHASE_RETURN': {
        const settlementMode = payload.settlementMode ?? 'REFUND';
        // ADJUST is auto-settled at create; otherwise honour requested status (default SENT)
        const initialStatus = settlementMode === 'ADJUST'
          ? 'SETTLED'
          : (payload.status ?? 'SENT');
        // Short delivery = no physical stock to deduct (goods never arrived)
        const isShortDelivery = /short.*delivery|short.*supply/i.test(payload.reason ?? '');
        await this.prisma.$transaction(async (tx) => {
          const debitNoteNo = await this.numbering.nextNumber(
            tx,
            'DN',
            branchId,
          );
          if (!isShortDelivery) {
            for (const item of payload.items ?? []) {
              await tx.batch.update({ where: { id: item.batchId }, data: { quantity: { decrement: item.returnedQty } } });
              await tx.product.update({ where: { id: item.productId }, data: { totalStock: { decrement: item.returnedQty } } });
            }
          }
          await (tx as any).purchaseReturn.create({
            data: {
              debitNoteNo,
              grnId: payload.grnId,
              supplierId: payload.supplierId,
              supplierName: payload.supplierName,
              reason: payload.reason,
              subtotal: payload.subtotal,
              cgst: payload.cgst ?? 0,
              sgst: payload.sgst ?? 0,
              igst: payload.igst ?? 0,
              totalAmount: payload.totalAmount,
              status: initialStatus,
              settlementMode,
              // Auto-flag short-delivery DNs as already-reversed so the admin
              // sweep can never re-apply stock to them.
              stockReversedAt: isShortDelivery ? new Date() : null,
              createdById: payload.createdById,
              branchId: branchId ?? null,
              items: { create: payload.items.map((i: any) => ({
                productId: i.productId,
                productName: i.productName,
                batchId: i.batchId,
                batchNumber: i.batchNumber,
                expiryDate: new Date(i.expiryDate),
                returnedQty: i.returnedQty,
                purchaseRate: i.purchaseRate,
                amount: i.amount,
                gstPercent: i.gstPercent ?? 0,
              })) },
            },
          });
          // ADJUST: decrement supplier outstanding (we owe them less now).
          // Re-check at approval-time: between request and approval, other
          // payments may have settled the outstanding. Block if the adjustment
          // would push outstanding negative.
          if (settlementMode === 'ADJUST') {
            const supplier = await tx.supplier.findUnique({
              where: { id: payload.supplierId },
              select: { currentOutstanding: true, name: true },
            });
            const currentOutstanding = Number(supplier?.currentOutstanding ?? 0);
            if (Number(payload.totalAmount) > currentOutstanding + 0.01) {
              throw new BadRequestException(
                `ADJUST debit note (₹${Number(payload.totalAmount).toFixed(2)}) exceeds supplier "${supplier?.name}" outstanding (₹${currentOutstanding.toFixed(2)}). The outstanding may have been settled since the request was raised.`,
              );
            }
            await tx.supplier.update({
              where: { id: payload.supplierId },
              data: { currentOutstanding: { decrement: payload.totalAmount } as any },
            });
          }

          // Short-delivery debit notes close the PO financial gap → recompute PO status
          if (/short|excess/i.test(payload.reason ?? '') && payload.grnId) {
            const grn = await tx.gRN.findUnique({
              where: { id: payload.grnId },
              select: { poId: true },
            });
            if (grn?.poId) {
              const po = await tx.purchaseOrder.findUnique({
                where: { id: grn.poId },
                include: { items: true },
              });
              if (po) {
                const allGrns = await tx.gRN.findMany({
                  where: { poId: grn.poId },
                  include: { items: true, purchaseReturns: { include: { items: true } } },
                });
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
                  where: { id: grn.poId },
                  data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
                });
              }
            }
          }
        });
        break;
      }
    }
  }
}
