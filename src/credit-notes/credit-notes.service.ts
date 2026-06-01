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

      // CREDIT mode ("Adjust Against Outstanding"): apply the credit to BOTH
      // the customer's outstanding AND the source invoice's amountPaid so the
      // per-invoice balances reconcile with the customer-level number.
      //
      // Allocation order:
      //   1. The source invoice (cn.invoiceId) — the invoice the CN was
      //      created against. Standard accounting practice.
      //   2. If the source invoice can't absorb the full CN amount (already
      //      fully paid, or remaining balance < CN amount), the leftover
      //      cascades FIFO to the customer's other UNPAID / PARTIAL invoices.
      //   3. Anything still leftover stays as customer-level credit
      //      (currentOutstanding goes negative — we owe them future credit).
      //
      // currentOutstanding is decremented by the full CN amount up front;
      // step (1) + (2) then sync each invoice's amountPaid so the sum of
      // open-invoice balances stays in lockstep with currentOutstanding.
      const settledAt = finalSettlementMode === 'CREDIT' ? new Date() : null;
      if (finalSettlementMode === 'CREDIT' && cn.customerId) {
        await tx.customer.update({
          where: { id: cn.customerId },
          data: { currentOutstanding: { decrement: cn.totalAmount } },
        });

        let remaining = Number(cn.totalAmount);

        // Helper: apply as much of `remaining` as the invoice can absorb,
        // update its amountPaid/status, and shrink `remaining` accordingly.
        // Skips CANCELLED (financially void) but is fine to call on PAID
        // invoices — they'll just contribute 0 and pass through.
        const applyToInvoice = async (invoice: {
          id: string;
          grandTotal: any;
          amountPaid: any;
          status: string;
        }) => {
          if (remaining <= 0.01) return;
          if (invoice.status === 'CANCELLED') return;
          const grand = Number(invoice.grandTotal);
          const currentPaid = Number(invoice.amountPaid);
          const room = grand - currentPaid;
          if (room <= 0.01) return; // already fully paid — nothing to absorb
          const apply = Math.min(remaining, room);
          const newPaid = currentPaid + apply;
          const newStatus: 'PAID' | 'PARTIAL' | 'UNPAID' =
            newPaid >= grand - 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'UNPAID';
          await tx.invoice.update({
            where: { id: invoice.id },
            // Don't overwrite RETURNED — set below when cumulative returns
            // reach grandTotal and takes precedence over PAID.
            data: {
              amountPaid: newPaid,
              ...(invoice.status !== 'RETURNED' ? { status: newStatus } : {}),
            },
          });
          remaining -= apply;
        };

        // 1. Try the source invoice first.
        if (cn.invoice) {
          await applyToInvoice(cn.invoice);
        }

        // 2. Cascade leftover credit to the customer's other open invoices,
        //    oldest first. Excludes the source (already handled) and only
        //    touches financial INVOICEs (not quotations or drafts).
        if (remaining > 0.01) {
          const openInvoices = await tx.invoice.findMany({
            where: {
              customerId: cn.customerId,
              type: 'INVOICE',
              status: { in: ['UNPAID', 'PARTIAL'] },
              id: { not: cn.invoiceId },
            },
            orderBy: { date: 'asc' },
            select: {
              id: true,
              grandTotal: true,
              amountPaid: true,
              status: true,
            },
          });
          for (const inv of openInvoices) {
            if (remaining <= 0.01) break;
            await applyToInvoice(inv);
          }
        }
        // Anything still in `remaining` stays as customer-level credit
        // (currentOutstanding already decremented). Next credit purchase
        // will use it up.
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

  async findAll(query?: string, customerId?: string, branchId?: string, status?: string) {
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
    // Phone joined live from the Customer relation so the list can render
    // "name + phone" rows for disambiguation. Same pattern as billing's findAll.
    const rows = await this.prisma.creditNote.findMany({
      where,
      include: {
        reviewedBy: { select: { id: true, name: true } },
        customer: { select: { phone: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ ...r, customerPhone: r.customer?.phone ?? null }));
  }

  async findOne(id: string, branchId?: string) {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id },
      include: {
        items: true,
        invoice: true,
        reviewedBy: { select: { id: true, name: true } },
        customer: { select: { phone: true } },
      },
    });
    if (!cn) throw new NotFoundException('Credit note not found');
    if (branchId && cn.branchId && cn.branchId !== branchId) {
      throw new NotFoundException('Credit note not found');
    }
    return { ...cn, customerPhone: cn.customer?.phone ?? null };
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

  // Returns every still-returnable line for a customer, flattened across all
  // their invoices. Each row stays bound to its source invoice + batch because
  // a credit note references exactly one invoice and returnable qty is capped
  // per (invoiceId, productId, batchId) — see create(). Powers the
  // customer-first Sales Returns flow. Only lines with remaining > 0 are
  // emitted; already-returned qty counts APPROVED + PENDING_REVIEW (REJECTED
  // excluded — those goods never went back).
  async getReturnableItemsByCustomer(customerId: string, branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customerId,
        type: 'INVOICE',
        status: { notIn: ['DRAFT', 'CANCELLED', 'RETURNED'] },
        ...(branchId ? { branchId } : {}),
      },
      include: { items: true },
      orderBy: { date: 'desc' },
    });

    // One query for all prior returns on this customer's CNs. Key by
    // invoiceId::productId::batchId so each invoice line is capped on its own
    // (validation in create() is per-invoice).
    const priorReturns = await this.prisma.creditNoteItem.findMany({
      where: {
        creditNote: {
          customerId,
          status: { in: ['PENDING_REVIEW', 'APPROVED'] },
          ...(branchId ? { branchId } : {}),
        },
      },
      select: {
        productId: true,
        batchId: true,
        returnedQty: true,
        creditNote: { select: { invoiceId: true } },
      },
    });
    const priorByKey = new Map<string, number>();
    for (const r of priorReturns) {
      const k = `${r.creditNote.invoiceId}::${r.productId}::${r.batchId}`;
      priorByKey.set(k, (priorByKey.get(k) ?? 0) + r.returnedQty);
    }

    const rows = invoices.flatMap((inv) =>
      inv.items.map((item) => {
        const alreadyReturned =
          priorByKey.get(`${inv.id}::${item.productId}::${item.batchId}`) ?? 0;
        const remaining = item.quantity - alreadyReturned;
        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.date,
          invoiceItemId: item.id,
          productId: item.productId,
          productName: item.productName,
          batchId: item.batchId,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          soldQty: item.quantity,
          alreadyReturned,
          remaining,
          mrp: item.mrp,
          rate: item.rate,
          discountPercent: item.discountPercent,
          gstPercent: item.gstPercent,
        };
      }),
    );

    return rows
      .filter((r) => r.remaining > 0)
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) ||
          b.invoiceDate.getTime() - a.invoiceDate.getTime(),
      );
  }
}
