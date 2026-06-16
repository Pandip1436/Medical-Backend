import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { ApproveCreditNoteDto } from './dto/approve-credit-note.dto';
import { RejectCreditNoteDto } from './dto/reject-credit-note.dto';
import { syncPaymentDueForInvoice } from '../notifications/payment-due-sync';

@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    // Circular: ApprovalsService also injects CreditNotesService (its
    // SALES_RETURN executor calls createPendingReview). Resolved via forwardRef.
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Gate 1 — Super-Admin authorization. A non-super-admin's credit note is
   * filed as a SALES_RETURN ApprovalRequest and only becomes a real
   * PENDING_REVIEW credit note once a Super Admin approves it (the approvals
   * executor calls `createPendingReview`). A Super Admin filing one skips the
   * gate and creates the PENDING_REVIEW CN directly, as before.
   */
  async create(
    dto: CreateCreditNoteDto,
    userId: string,
    branchId?: string,
    isSuperAdmin = false,
  ) {
    if (isSuperAdmin) {
      return this.createPendingReview(dto, userId, branchId);
    }
    // Enrich the stored payload with display fields so the Approvals page can
    // render the request (Customer / Invoice # / Amount / Settlement / Reason).
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      select: {
        invoiceNumber: true,
        customerName: true,
        customerId: true,
        branchId: true,
        customer: { select: { id: true, phone: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    const req = await this.approvals.createRequest({
      type: 'SALES_RETURN',
      payload: {
        ...dto,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        // Carry the customer id + phone so the Approvals detail can link to the
        // customer and show their number for the reviewer.
        customerId: invoice.customerId ?? invoice.customer?.id ?? null,
        customerPhone: invoice.customer?.phone ?? null,
        createdById: userId,
      },
      requestedById: userId,
      branchId: invoice.branchId ?? branchId,
    });
    return { approvalRequested: true, approvalRequestId: req.id };
  }

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
   * Reached directly when a Super Admin files the CN, or from the SALES_RETURN
   * approval executor once a Super Admin approves a non-super-admin's request.
   * This is the single source of truth for turning a return into a real
   * PENDING_REVIEW credit note (Gate 2 — product review/settlement — happens
   * later via `approve()`).
   */
  async createPendingReview(dto: CreateCreditNoteDto, userId: string, branchId?: string) {
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
      const cnCustomer = invoice.customerId
        ? await tx.customer.findUnique({ where: { id: invoice.customerId }, select: { phone: true } })
        : null;
      await tx.notification.create({
        data: {
          type: 'APPROVAL',
          title: 'Credit Note Awaiting Review',
          // Lead with the customer (and phone, to disambiguate same-named
          // customers); the credit-note number follows.
          message: `${invoice.customerName}${cnCustomer?.phone ? ` (${cnCustomer.phone})` : ''} — Credit Note ${creditNoteNo} (₹${Number(dto.totalAmount).toFixed(2)}) awaiting review. [creditNoteId:${creditNote.id}]`,
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

      // Guard: "Adjust Against Outstanding" (CREDIT) only makes sense when the
      // customer actually owes money. For a fully-settled customer (no open
      // balance — e.g. a cash sale), a return must be refunded in cash/UPI so it
      // posts to the customer ledger, not converted into an open-ended store-
      // credit advance. Computed LIVE from open invoices rather than the
      // denormalised currentOutstanding cache (which can drift) so the guard is
      // trustworthy.
      // Live outstanding for the customer, computed from open invoices. Drives
      // both the CREDIT guard below and the adjust-vs-refund split when the
      // return value exceeds what the customer owes.
      let liveOutstanding = 0;
      if (finalSettlementMode === 'CREDIT') {
        if (cn.customerId) {
          const openAgg = await tx.invoice.aggregate({
            where: {
              customerId: cn.customerId,
              type: 'INVOICE',
              status: { in: ['UNPAID', 'PARTIAL'] },
            },
            _sum: { grandTotal: true, amountPaid: true },
          });
          liveOutstanding =
            Number(openAgg._sum.grandTotal ?? 0) -
            Number(openAgg._sum.amountPaid ?? 0);
        }
        if (liveOutstanding <= 0.01) {
          throw new BadRequestException(
            'This customer has no outstanding balance to adjust against. Settle this return as a Refund (cash/UPI) so it posts to the customer ledger, instead of Credit / Adjustment.',
          );
        }
      }

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
      // Split rule: only the portion of the return value that the customer
      // actually owes is adjusted against the outstanding; any EXCESS (return
      // worth more than the balance) is paid back to the customer as a cash
      // Refund rather than parked as open-ended store credit. So:
      //     adjustable = min(returnValue, liveOutstanding)   → reduces balance
      //     excess     = returnValue − adjustable            → refunded
      //
      // Allocation of the adjustable part:
      //   1. The source invoice (cn.invoiceId) — the invoice the CN was
      //      created against. Standard accounting practice.
      //   2. Leftover cascades FIFO to the customer's other UNPAID / PARTIAL
      //      invoices, oldest first.
      // currentOutstanding is decremented by `adjustable` (landing at ~0, never
      // negative); step (1)+(2) sync each invoice's amountPaid so the sum of
      // open-invoice balances stays in lockstep with currentOutstanding.
      // CREDIT and REFUND both settle at approval; REPLACEMENT stays unsettled
      // until the replacement invoice is issued.
      const settledAt =
        finalSettlementMode === 'CREDIT' || finalSettlementMode === 'REFUND'
          ? new Date()
          : null;
      const creditAdjustable = Math.min(Number(cn.totalAmount), liveOutstanding);
      const creditExcess = Number(cn.totalAmount) - creditAdjustable;
      if (finalSettlementMode === 'CREDIT' && cn.customerId) {
        await tx.customer.update({
          where: { id: cn.customerId },
          // Only knock off what they owe — the excess is refunded below.
          data: { currentOutstanding: { decrement: creditAdjustable } },
        });

        let remaining = creditAdjustable;

        // Helper: apply as much of `remaining` as the invoice can absorb,
        // update its amountPaid/status, and shrink `remaining` accordingly.
        // Skips CANCELLED (financially void) but is fine to call on PAID
        // invoices — they'll just contribute 0 and pass through.
        const applyToInvoice = async (invoice: {
          id: string;
          grandTotal: any;
          amountPaid: any;
          status: string;
          customerName?: string | null;
          invoiceNumber?: string | null;
          date?: Date | null;
          customerId?: string | null;
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
          // Sync the Payment Due reminder: credit absorbed into this invoice
          // may have cleared it (resolve) or just lowered the balance (refresh).
          await syncPaymentDueForInvoice(tx, {
            id: invoice.id,
            status: invoice.status === 'RETURNED' ? 'RETURNED' : newStatus,
            grandTotal: invoice.grandTotal,
            amountPaid: newPaid,
            date: invoice.date,
            customerName: invoice.customerName,
            invoiceNumber: invoice.invoiceNumber,
            customerId: invoice.customerId,
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
              // Carried so syncPaymentDueForInvoice can refresh a still-due
              // reminder's amount when credit only partially clears the invoice.
              customerName: true,
              invoiceNumber: true,
              date: true,
              customerId: true,
            },
          });
          for (const inv of openInvoices) {
            if (remaining <= 0.01) break;
            await applyToInvoice(inv);
          }
        }

        // Excess: the return was worth more than the customer owed. Pay the
        // surplus back as a cash/bank Refund (same treatment as a Refund-mode
        // return) instead of leaving an open-ended store-credit advance. The
        // @unique on Refund.creditNoteId is safe here — a CN is either CREDIT
        // or REFUND, never both, so only one Refund row is ever created.
        if (creditExcess > 0.01) {
          const invoiceMode = cn.invoice.paymentMode;
          const refundMode =
            opts.refundMode ??
            (['CASH', 'CARD', 'UPI'].includes(invoiceMode) ? invoiceMode : 'CASH');
          const refundNumber = await this.numbering.nextNumber(
            tx,
            'REF',
            cn.branchId ?? branchId ?? null,
          );
          await tx.refund.create({
            data: {
              refundNumber,
              creditNoteId: cn.id,
              customerId: cn.customerId,
              invoiceId: cn.invoiceId,
              amount: creditExcess,
              paymentMode: refundMode,
              branchId: cn.branchId,
              createdById: reviewerUserId,
            },
          });
        }
      }

      // REFUND mode ("Refund to Customer"): record the cash/bank payout as a
      // real Refund transaction so the money-out is visible in the Cash Book
      // (cash mode) and the customer ledger. We do NOT touch currentOutstanding
      // — a refund is given on an already-settled invoice, so what the customer
      // owes is unchanged. Payout method defaults to the invoice's original mode
      // when it's a real money mode (CASH/CARD/UPI), else CASH; only CASH
      // refunds reach the Cash Book. The @unique on creditNoteId makes a retried
      // approve fail loudly rather than double-pay.
      if (finalSettlementMode === 'REFUND') {
        const invoiceMode = cn.invoice.paymentMode;
        const refundMode =
          opts.refundMode ??
          (['CASH', 'CARD', 'UPI'].includes(invoiceMode) ? invoiceMode : 'CASH');
        const refundNumber = await this.numbering.nextNumber(
          tx,
          'REF',
          cn.branchId ?? branchId ?? null,
        );
        await tx.refund.create({
          data: {
            refundNumber,
            creditNoteId: cn.id,
            customerId: cn.customerId,
            invoiceId: cn.invoiceId,
            amount: cn.totalAmount,
            paymentMode: refundMode,
            branchId: cn.branchId,
            createdById: reviewerUserId,
          },
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
        // Invoice fully returned — there's nothing left to owe, so clear its
        // Payment Due reminder.
        await syncPaymentDueForInvoice(tx, {
          id: cn.invoiceId,
          status: 'RETURNED',
          grandTotal: cn.invoice.grandTotal,
          amountPaid: cn.invoice.amountPaid,
          customerId: cn.customerId,
        }, reviewerUserId);
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

  async findAll(
    query?: string,
    customerId?: string,
    branchId?: string,
    status?: string,
    opts?: { from?: string; to?: string; skip?: number; take?: number },
  ) {
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
    if (opts?.from || opts?.to) {
      where.date = {};
      if (opts.from) where.date.gte = new Date(opts.from);
      if (opts.to) {
        const toEnd = new Date(opts.to);
        toEnd.setHours(23, 59, 59, 999);
        where.date.lte = toEnd;
      }
    }

    const include = {
      reviewedBy: { select: { id: true, name: true } },
      customer: { select: { phone: true } },
    } as const;
    // Phone joined live from the Customer relation so the list can render
    // "name + phone" rows for disambiguation. Same pattern as billing's findAll.
    const mapPhone = (r: any) => ({ ...r, customerPhone: r.customer?.phone ?? null });

    const paginated = typeof opts?.skip === 'number' && typeof opts?.take === 'number';
    if (!paginated) {
      // Legacy callers — lightweight array, capped at 100.
      const rows = await this.prisma.creditNote.findMany({
        where,
        include,
        orderBy: { date: 'desc' },
        take: 100,
      });
      return rows.map(mapPhone);
    }

    const safeTake = Math.min(Math.max(opts!.take!, 1), 100);
    const safeSkip = Math.max(opts!.skip!, 0);
    const [rows, total] = await Promise.all([
      this.prisma.creditNote.findMany({
        where,
        include,
        orderBy: { date: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.creditNote.count({ where }),
    ]);
    const data = rows.map(mapPhone);
    return { data, total, hasMore: safeSkip + data.length < total };
  }

  async findOne(id: string, branchId?: string) {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id },
      include: {
        items: true,
        invoice: true,
        reviewedBy: { select: { id: true, name: true } },
        customer: {
          select: {
            id: true, name: true, phone: true, alternatePhone: true,
            email: true, address: true, gstin: true, type: true,
          },
        },
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
