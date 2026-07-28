import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalType } from '@prisma/client';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { isAdminRole } from '../common/roles.util';
import { syncPaymentDueForInvoice } from '../notifications/payment-due-sync';
import { CreditNotesService } from '../credit-notes/credit-notes.service';

// Builds the "<customer> (<phone>) — " prefix for approval notifications when
// the request payload carries customer fields (e.g. SALES_RETURN stamps both
// customerName and customerPhone). The Notifications list parses this prefix to
// populate the Customer column; returns '' when no name is present so other
// approval types degrade gracefully to a plain message.
function approvalCustomerLead(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, any>;
  const name = typeof p.customerName === 'string' ? p.customerName.trim() : '';
  if (!name) return '';
  const phone = typeof p.customerPhone === 'string' ? p.customerPhone.trim() : '';
  return `${name}${phone ? ` (${phone})` : ''} — `;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    // Circular: CreditNotesService injects ApprovalsService (CN create files a
    // SALES_RETURN request). Resolved via forwardRef.
    @Inject(forwardRef(() => CreditNotesService))
    private readonly creditNotes: CreditNotesService,
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
    if (!isAdminRole(opts.role)) where.requestedById = opts.userId;

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
  async approve(
    id: string,
    reviewedById: string,
    reviewNote?: string,
    reviewerBranchId?: string,
    reviewerIsSuperAdmin = false,
  ) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');
    // Credit-note (sales return) authorization is reserved for Super Admins.
    if (req.type === 'SALES_RETURN' && !reviewerIsSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can approve credit-note returns');
    }
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

    // Execute the approved action. Retried on a document-number collision —
    // safe here specifically because executeApprovedAction's numbering-
    // generating branches each run inside their own self-contained
    // transaction, so a failed attempt leaves no partial state (unlike this
    // outer approve() method, which is NOT itself transactional and must not
    // be retried wholesale — the approvalRequest.update just above has
    // already committed by this point).
    await this.numbering.retryOnCollision(() =>
      this.executeApprovedAction(req.type, req.payload as Record<string, any>, req.refId, req.branchId),
    );

    // Notify requestor. Lead with the customer (+ phone) when the payload
    // carries them — the Notifications list parses "<name> (<phone>) — <rest>"
    // to fill the Customer column (mirrors the awaiting-review notification).
    await this.prisma.notification.create({
      data: {
        type: 'APPROVAL',
        title: 'Request Approved',
        message: `${approvalCustomerLead(req.payload)}Your ${req.type.replace(/_/g, ' ').toLowerCase()} request has been approved.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
        actionUrl: `/admin/approvals/detail?id=${id}`,
        branchId: req.branchId ?? null,
      },
    });

    return updated;
  }

  // ── Admin rejects ──────────────────────────────────────────
  async reject(
    id: string,
    reviewedById: string,
    reviewNote: string,
    reviewerBranchId?: string,
    reviewerIsSuperAdmin = false,
  ) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');
    if (req.type === 'SALES_RETURN' && !reviewerIsSuperAdmin) {
      throw new ForbiddenException('Only a Super Admin can reject credit-note returns');
    }
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
      // Clear any Payment Due reminder for the cancelled invoice (defensive —
      // a draft credit bill usually has none yet, so this is normally a no-op).
      await syncPaymentDueForInvoice(this.prisma, {
        id: req.refId,
        status: 'CANCELLED',
        grandTotal: 0,
        amountPaid: 0,
      }, reviewedById).catch(() => {});
    }

    // Notify requestor (lead with customer + phone when available — see approve()).
    await this.prisma.notification.create({
      data: {
        type: 'APPROVAL',
        title: 'Request Rejected',
        message: `${approvalCustomerLead(req.payload)}Your ${req.type.replace(/_/g, ' ').toLowerCase()} request was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
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
        // Gate 1 cleared by a Super Admin → turn the stored return payload into
        // a real PENDING_REVIEW credit note. `createPendingReview` re-runs the
        // return-cap validation (so two pending requests on the same line can't
        // both overshoot) and emits the "Credit Note Awaiting Review"
        // notification, entering Gate 2 (product review / settlement).
        // The payload carries the full CN dto plus enrichment fields
        // (invoiceNumber/customerName/createdById); createPendingReview only
        // reads the dto fields, so the extras are harmlessly ignored.
        const p = payload as any;
        await this.creditNotes.createPendingReview(p, p.createdById ?? '', branchId ?? undefined);
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
          notes?: string;
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
            // totalStock is reconciled from SUM(batches) after the loop (below)
            // rather than incremented by this diff — see the H2/M1 fix note.
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
                notes: item.notes ?? null,
                branchId: product.branchId ?? branchId ?? null,
              },
            });
          }
          // Reconcile each affected product's totalStock from the actual SUM of
          // its batch quantities (inside this tx), instead of incrementing by a
          // diff read before the write. Prevents drift / negative stock under a
          // concurrent sale. (H2 + M1 fix.)
          const affectedProductIds = Array.from(new Set(items.map((i) => i.productId)));
          for (const pid of affectedProductIds) {
            const agg = await tx.batch.aggregate({
              where: { productId: pid },
              _sum: { quantity: true },
            });
            await tx.product.update({
              where: { id: pid },
              data: { totalStock: agg._sum.quantity ?? 0 },
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
