import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalType } from '@prisma/client';

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

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
        actionUrl: '/admin/approvals',
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
  async approve(id: string, reviewedById: string, reviewNote?: string) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');

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
        actionUrl: '/admin/approvals',
        branchId: req.branchId ?? null,
      },
    });

    return updated;
  }

  // ── Admin rejects ──────────────────────────────────────────
  async reject(id: string, reviewedById: string, reviewNote: string) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');

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
        actionUrl: '/admin/approvals',
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
        // Draft invoice already exists — just finalize it (flip to CREDIT status)
        if (refId) {
          await this.prisma.invoice.update({
            where: { id: refId },
            data: { status: 'CREDIT' },
          });
          // Update customer outstanding
          const invoice = await this.prisma.invoice.findUnique({ where: { id: refId } });
          if (invoice?.customerId) {
            await this.prisma.customer.update({
              where: { id: invoice.customerId },
              data: { currentOutstanding: { increment: invoice.grandTotal } },
            });
          }
        }
        break;
      }

      case 'SALES_RETURN': {
        // Re-execute the credit note creation from stored payload
        const creditNoteNo = `CN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await this.prisma.$transaction(async (tx) => {
          // Restore stock for each item
          for (const item of payload.items ?? []) {
            await tx.batch.update({ where: { id: item.batchId }, data: { quantity: { increment: item.returnedQty } } });
            await tx.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.returnedQty } } });
          }
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
              settlementMode: payload.settlementMode ?? 'REFUND',
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

      case 'PURCHASE_RETURN': {
        const debitNoteNo = `DN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const settlementMode = payload.settlementMode ?? 'REFUND';
        // ADJUST is auto-settled at create; otherwise honour requested status (default SENT)
        const initialStatus = settlementMode === 'ADJUST'
          ? 'SETTLED'
          : (payload.status ?? 'SENT');
        // Short delivery = no physical stock to deduct (goods never arrived)
        const isShortDelivery = /short.*delivery|short.*supply/i.test(payload.reason ?? '');
        await this.prisma.$transaction(async (tx) => {
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
          // ADJUST: decrement supplier outstanding (we owe them less now)
          if (settlementMode === 'ADJUST') {
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
