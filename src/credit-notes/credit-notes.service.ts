import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { ApproveCreditNoteDto } from './dto/approve-credit-note.dto';
import { RejectCreditNoteDto } from './dto/reject-credit-note.dto';

@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  /**
   * Files a credit note for a sales return. The CN is created in
   * `PENDING_REVIEW` status — none of the settlement side effects fire yet:
   *
   *  - Stock is **not** restored (goods are physically held but not yet
   *    inspected; a falsely-claimed return shouldn't put bad/damaged units
   *    back on shelves before staff has verified them).
   *  - Customer `currentOutstanding` is **not** decremented even when the
   *    chosen settlement is CREDIT — the credit isn't real until the goods
   *    are accepted.
   *  - The source invoice's status is **not** flipped to RETURNED until
   *    enough approved returns accumulate (otherwise a not-yet-approved
   *    return prematurely locks the invoice from further legitimate returns).
   *
   * All of those execute in `approve()` instead. Reviewer can override the
   * chosen `settlementMode` at approve-time via the detail page.
   *
   * This unifies the pharmacist and admin paths — the old behavior of
   * pharmacist→ApprovalRequest, admin→synchronous-execute is retired. Both
   * roles file CNs the same way; reviewers (ADMIN) approve from the CN
   * detail page.
   */
  async create(dto: CreateCreditNoteDto, userId: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: dto.invoiceId },
        include: { items: true, customer: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (branchId && invoice.branchId && invoice.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }

      // Cap each line at (sold qty - already-returned). Count BOTH approved
      // CNs and not-yet-approved (PENDING_REVIEW) CNs so two back-to-back
      // submissions on the same invoice line can't both pass validation,
      // then both restore stock on approve and double-count.
      const priorReturns = await tx.creditNoteItem.findMany({
        where: {
          creditNote: {
            invoiceId: invoice.id,
            status: { in: ['PENDING_REVIEW', 'APPROVED'] },
          },
        },
        select: { productId: true, batchId: true, returnedQty: true },
      });
      const priorByKey = new Map<string, number>();
      for (const r of priorReturns) {
        const k = `${r.productId}::${r.batchId}`;
        priorByKey.set(k, (priorByKey.get(k) ?? 0) + r.returnedQty);
      }

      for (const item of dto.items) {
        const invoiceItem = invoice.items.find(
          (i) => i.productId === item.productId && i.batchId === item.batchId,
        );
        if (!invoiceItem) {
          throw new BadRequestException(
            `Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`,
          );
        }
        const alreadyReturned =
          priorByKey.get(`${item.productId}::${item.batchId}`) ?? 0;
        const remaining = invoiceItem.quantity - alreadyReturned;
        if (item.returnedQty > remaining) {
          throw new BadRequestException(
            `Cannot return ${item.returnedQty} of ${item.productName}: only ${remaining} unreturned (sold ${invoiceItem.quantity}, already returned/pending ${alreadyReturned})`,
          );
        }
      }

      const creditNoteNo = await this.numbering.nextNumber(
        tx,
        'CN',
        invoice.branchId ?? branchId ?? null,
      );
      const settlementMode = dto.settlementMode ?? 'REFUND';

      const creditNote = await tx.creditNote.create({
        data: {
          creditNoteNo,
          branchId: invoice.branchId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          reason: dto.reason,
          subtotal: dto.subtotal,
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          totalAmount: dto.totalAmount,
          settlementMode,
          // PENDING_REVIEW until a reviewer approves on the detail page.
          // status defaults to PENDING_REVIEW in the schema; setting
          // explicitly for clarity.
          status: 'PENDING_REVIEW',
          // settledAt stays null regardless of settlementMode. CREDIT used
          // to auto-settle on create — moved to approve().
          settledAt: null,
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
              rate: it.rate,
              gstPercent: it.gstPercent,
              amount: it.amount,
            })),
          },
        },
        include: { items: true },
      });

      // Notify admins in the branch that a new CN is awaiting review. Mirror
      // the approval-notification pattern used elsewhere in the codebase
      // (approvals.service.ts:38-44) — write directly to the Notification
      // table so we don't have to inject NotificationsService for one call.
      await tx.notification.create({
        data: {
          type: 'APPROVAL',
          title: 'Credit Note Awaiting Review',
          message: `${creditNoteNo} (${invoice.customerName}, ₹${Number(dto.totalAmount).toFixed(2)}) — inspect returned goods and approve or reject. [creditNoteId:${creditNote.id}]`,
          actionUrl: `/billing/credit-notes?id=${creditNote.id}`,
          branchId: invoice.branchId ?? branchId ?? null,
        },
      });

      return creditNote;
    });
  }

  /**
   * Approve a PENDING_REVIEW credit note. Executes all the side effects
   * `create()` used to do synchronously:
   *
   *   - Restore stock (batch.quantity + product.totalStock).
   *   - If final mode is CREDIT: decrement customer.currentOutstanding and
   *     stamp settledAt = now.
   *   - If REFUND or REPLACEMENT: leave settledAt = null. Final cash-refund
   *     receipt / replacement-invoice issuance is still manual downstream;
   *     same as the pre-feature behavior for those modes.
   *   - If cumulative APPROVED returns ≥ invoice total: flip invoice to
   *     RETURNED. (PENDING_REVIEW CNs don't count here — only approvals
   *     should be able to close out an invoice.)
   *
   * Reviewer can override the recorded settlementMode via opts.settlementMode.
   * That happens before the side-effect dispatch, so the override is what
   * actually drives stock/balance changes.
   */
  async approve(
    id: string,
    reviewerUserId: string,
    opts: ApproveCreditNoteDto,
    branchId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cn = await tx.creditNote.findUnique({
        where: { id },
        include: { items: true, invoice: true },
      });
      if (!cn) throw new NotFoundException('Credit note not found');
      if (branchId && cn.branchId && cn.branchId !== branchId) {
        throw new NotFoundException('Credit note not found');
      }
      if (cn.status !== 'PENDING_REVIEW') {
        throw new BadRequestException(
          `Credit note is already ${cn.status.toLowerCase()} — only pending reviews can be approved`,
        );
      }

      const finalSettlementMode = opts.settlementMode ?? cn.settlementMode;

      // Restore stock (was lines 113-120 of the old create()).
      for (const item of cn.items) {
        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: { increment: item.returnedQty } },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { increment: item.returnedQty } },
        });
      }

      // CREDIT mode: apply the credit to outstanding now (was lines 170-173
      // of the old create()).
      const settledAt = finalSettlementMode === 'CREDIT' ? new Date() : null;
      if (finalSettlementMode === 'CREDIT' && cn.customerId) {
        await tx.customer.update({
          where: { id: cn.customerId },
          data: { currentOutstanding: { decrement: cn.totalAmount } },
        });
      }

      const updated = await tx.creditNote.update({
        where: { id },
        data: {
          status: 'APPROVED',
          settlementMode: finalSettlementMode,
          settledAt,
          reviewedById: reviewerUserId,
          reviewedAt: new Date(),
          reviewNote: opts.reviewNote ?? null,
        },
        include: { items: true, invoice: true },
      });

      // Check if the invoice is now fully returned. Count only APPROVED CNs
      // (including the one we just approved) so a not-yet-reviewed return
      // doesn't prematurely close the invoice.
      const totalReturnedSoFar = await tx.creditNote.aggregate({
        where: { invoiceId: cn.invoiceId, status: 'APPROVED' },
        _sum: { totalAmount: true },
      });
      const returned = Number(totalReturnedSoFar._sum.totalAmount ?? 0);
      if (returned >= Number(cn.invoice.grandTotal)) {
        await tx.invoice.update({
          where: { id: cn.invoiceId },
          data: { status: 'RETURNED' },
        });
      }

      return updated;
    });
  }

  /**
   * Reject a PENDING_REVIEW credit note. Records who rejected it and why;
   * does NOT touch inventory, customer balance, or invoice status. The CN
   * row stays as a historical record of the failed return claim.
   */
  async reject(
    id: string,
    reviewerUserId: string,
    dto: RejectCreditNoteDto,
    branchId?: string,
  ) {
    const cn = await this.prisma.creditNote.findUnique({ where: { id } });
    if (!cn) throw new NotFoundException('Credit note not found');
    if (branchId && cn.branchId && cn.branchId !== branchId) {
      throw new NotFoundException('Credit note not found');
    }
    if (cn.status !== 'PENDING_REVIEW') {
      throw new BadRequestException(
        `Credit note is already ${cn.status.toLowerCase()} — only pending reviews can be rejected`,
      );
    }

    return this.prisma.creditNote.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerUserId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote,
      },
      include: { items: true, invoice: true },
    });
  }

  findAll(query?: string, customerId?: string, branchId?: string, status?: string) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (query) {
      where.OR = [
        { creditNoteNo: { contains: query, mode: 'insensitive' } },
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.creditNote.findMany({
      where,
      include: {
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, branchId?: string) {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id },
      include: {
        items: true,
        invoice: true,
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (!cn) throw new NotFoundException('Credit note not found');
    if (branchId && cn.branchId && cn.branchId !== branchId) {
      throw new NotFoundException('Credit note not found');
    }
    return cn;
  }

  // Returns already-returned quantity per (productId, batchId) for an invoice.
  // Counts APPROVED + PENDING_REVIEW credit notes so the FE can clamp the
  // input qty before the user submits, and back-to-back submissions on the
  // same line cannot exceed sold qty. REJECTED rows are excluded — the goods
  // never went back so the units are still available for re-return.
  async getReturnedQtyByInvoice(invoiceId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, branchId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }

    const rows = await this.prisma.creditNoteItem.findMany({
      where: {
        creditNote: {
          invoiceId,
          status: { in: ['PENDING_REVIEW', 'APPROVED'] },
        },
      },
      select: { productId: true, batchId: true, returnedQty: true },
    });

    const totals = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.productId}::${r.batchId}`;
      totals.set(k, (totals.get(k) ?? 0) + r.returnedQty);
    }

    return Array.from(totals.entries()).map(([key, alreadyReturned]) => {
      const [productId, batchId] = key.split('::');
      return { productId, batchId, alreadyReturned };
    });
  }
}
