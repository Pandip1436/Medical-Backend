import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';
import { PaymentMode, Prisma, InvoiceStatus } from '@prisma/client';
import { INVOICE_CREATED, InvoiceCreatedPayload } from '../events/invoice-events';
import { InvoiceCreatedListener } from '../events/invoice-created.listener';
import { syncPaymentDueForInvoice } from '../notifications/payment-due-sync';

// Round to 2 decimal places before persisting any rupee/percent column. The
// frontend often hands us raw IEEE-754 products like 5.399999999999999 which,
// once written to a Decimal column as-is, leak into Tally/GSTR exports.
// Centralised here so every write path (create, draft, finalize, edit) gets
// the same treatment.
function r2(n: number | null | undefined): number {
  if (n === null || n === undefined) return 0;
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// Mirror of r2 for invoice line items — keeps quantity as an integer and
// rounds every Decimal field. Also snapshots a non-zero mrp when the caller
// hands us 0 (see findItemMrpFallback). Kept inline so the create/draft/
// finalize/edit paths share one shape.
function normalizeItem(item: CreateInvoiceItemDto, mrpFallback: number) {
  const mrp = r2(item.mrp);
  return {
    productId: item.productId,
    productName: item.productName,
    // batchId/batchNumber/expiryDate are filled by deductStockForItem (including
    // FEFO auto-selection) before this runs on the stock-deducting paths; the
    // fallbacks only apply to quotation/draft lines that never reserve stock.
    batchId: item.batchId ?? '',
    batchNumber: item.batchNumber ?? '',
    expiryDate: item.expiryDate ? new Date(item.expiryDate) : new Date(),
    quantity: item.quantity,
    mrp: mrp > 0 ? mrp : r2(mrpFallback),
    rate: r2(item.rate),
    discountPercent: r2(item.discountPercent),
    gstPercent: r2(item.gstPercent),
    amount: r2(item.amount),
  };
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: EventEmitter2,
    private readonly invoiceCreatedListener: InvoiceCreatedListener,
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
      batchId?: string;
      batchNumber?: string;
      quantity: number;
      // Unit sale rate — when present, validated against the chosen batch's
      // mrp / purchaseRate guardrails below.
      rate?: number;
      mrp?: number;
      expiryDate?: string | Date;
      // Set by the UI once the operator accepted the below-cost warning for
      // this line. Lets an intentional loss sale through the cost floor below.
      allowBelowCost?: boolean;
    },
    branchId?: string,
  ) {
    // 1. Resolve the batch. An explicit batchId wins; otherwise auto-pick via
    //    FEFO (First-Expiry-First-Out): the oldest UNEXPIRED batch of this
    //    product that still holds enough stock to cover the line, scoped to the
    //    caller's branch so a sale can't pull another branch's stock.
    let batch = item.batchId
      ? await tx.batch.findUnique({ where: { id: item.batchId } })
      : null;

    if (item.batchId && !batch) {
      throw new NotFoundException(
        `Batch ${item.batchNumber ?? item.batchId} for product ${item.productName} not found`,
      );
    }

    if (!batch) {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      batch = await tx.batch.findFirst({
        where: {
          productId: item.productId,
          quantity: { gte: item.quantity },
          expiryDate: { gte: startToday },
          ...(branchId ? { product: { branchId } } : {}),
        },
        // FEFO: earliest expiry first, then oldest received.
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      });
      if (!batch) {
        throw new BadRequestException(
          `No unexpired batch of ${item.productName} has enough stock to cover ${item.quantity} unit(s).`,
        );
      }
    }

    // 2. Refuse expired stock — pharmacies cannot legally dispense it. (FEFO
    //    already filters on expiry; this guards the explicit-batchId path.)
    const expiry = new Date(batch.expiryDate);
    expiry.setHours(23, 59, 59, 999);
    if (expiry < new Date()) {
      throw new BadRequestException(
        `Cannot sell ${item.productName} from batch ${batch.batchNumber}: expired on ${new Date(batch.expiryDate).toLocaleDateString('en-IN')}`,
      );
    }

    // 3. Price guardrails against THIS batch:
    //    - Selling ABOVE the batch MRP is a HARD block (MRP is the legal ceiling
    //      under the Drugs Price Control Order — non-negotiable).
    //    - Selling BELOW the batch's purchase cost is a SOFT guard: it's a
    //      legitimate business call (clearance, matching a dropped market price,
    //      draining old costly stock). The UI shows a "below cost" warning and,
    //      once the operator accepts it, sends allowBelowCost=true. We only
    //      reject when that acknowledgement is absent (e.g. an API / quotation
    //      caller) so a typo can't silently sell at a loss. The floor is also
    //      skipped when purchaseRate is unset (0) on legacy batches.
    if (item.rate !== undefined && item.rate !== null) {
      const rate = Number(item.rate);
      const batchMrp = Number(batch.mrp);
      const batchCost = Number(batch.purchaseRate);
      if (Number.isFinite(rate) && Number.isFinite(batchMrp) && rate > batchMrp + 0.01) {
        throw new BadRequestException(
          `Sale price (₹${rate.toFixed(2)}) for ${item.productName} exceeds batch ${batch.batchNumber} MRP (₹${batchMrp.toFixed(2)}).`,
        );
      }
      if (
        Number.isFinite(rate) &&
        Number.isFinite(batchCost) &&
        batchCost > 0 &&
        rate < batchCost - 0.01 &&
        !item.allowBelowCost
      ) {
        throw new BadRequestException(
          `Sale price (₹${rate.toFixed(2)}) for ${item.productName} is below batch ${batch.batchNumber} purchase cost (₹${batchCost.toFixed(2)}). Confirm the below-cost sale to proceed.`,
        );
      }
    }

    // 4. Atomic, race-safe decrement. The `quantity >= qty` guard in the WHERE
    //    turns read-then-write into one conditional UPDATE, so two concurrent
    //    sales of the same batch can't both pass a stale availability check and
    //    oversell. count === 0 means another sale drained it first.
    const dec = await tx.batch.updateMany({
      where: { id: batch.id, quantity: { gte: item.quantity } },
      data: { quantity: { decrement: item.quantity } },
    });
    if (dec.count === 0) {
      const fresh = await tx.batch.findUnique({
        where: { id: batch.id },
        select: { quantity: true },
      });
      throw new BadRequestException(
        `Insufficient stock for ${item.productName} in batch ${batch.batchNumber}. Available: ${fresh?.quantity ?? 0}`,
      );
    }

    // 5. Snapshot the resolved batch back onto the line so the InvoiceItem
    //    records the batch actually shipped (critical when FEFO auto-selected
    //    it for a line that arrived without a batchId).
    item.batchId = batch.id;
    item.batchNumber = batch.batchNumber;
    item.expiryDate = batch.expiryDate;
    if (!(Number(item.mrp) > 0)) item.mrp = Number(batch.mrp);

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

  // Look up MRP from the chosen batch (preferred — that's what was on the
  // strip at sale time) or the product master (fallback) so we can snapshot
  // a sane mrp onto InvoiceItem even when the frontend forgets to send one.
  // Returns 0 only when neither row has an mrp on file.
  private async resolveItemMrpFallbacks(
    tx: Prisma.TransactionClient,
    items: Array<{ productId: string; batchId?: string; mrp?: number }>,
  ): Promise<Map<string, number>> {
    const fallbacks = new Map<string, number>();
    const batchIds = Array.from(
      new Set(
        items
          .filter((i) => !(Number(i.mrp) > 0) && i.batchId)
          .map((i) => i.batchId!)
          .filter(Boolean),
      ),
    );
    const productIds = Array.from(
      new Set(
        items
          .filter((i) => !(Number(i.mrp) > 0))
          .map((i) => i.productId)
          .filter(Boolean),
      ),
    );
    if (batchIds.length === 0 && productIds.length === 0) return fallbacks;
    const [batches, products] = await Promise.all([
      batchIds.length
        ? tx.batch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, mrp: true, productId: true },
          })
        : Promise.resolve([] as Array<{ id: string; mrp: any; productId: string }>),
      productIds.length
        ? tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, mrp: true },
          })
        : Promise.resolve([] as Array<{ id: string; mrp: any }>),
    ]);
    const productMrp = new Map<string, number>(
      products.map((p) => [p.id, Number(p.mrp ?? 0)]),
    );
    const batchMrp = new Map<string, number>(
      batches.map((b) => [b.id, Number(b.mrp ?? 0)]),
    );
    for (const it of items) {
      const k = `${it.productId}::${it.batchId ?? ''}`;
      const fromBatch = it.batchId ? batchMrp.get(it.batchId) ?? 0 : 0;
      const fromProduct = productMrp.get(it.productId) ?? 0;
      fallbacks.set(k, fromBatch > 0 ? fromBatch : fromProduct);
    }
    return fallbacks;
  }

  // Pull the right fallback for a single item using the same key shape
  // resolveItemMrpFallbacks uses.
  private mrpFallbackFor(
    fallbacks: Map<string, number>,
    item: { productId: string; batchId?: string },
  ): number {
    return fallbacks.get(`${item.productId}::${item.batchId ?? ''}`) ?? 0;
  }

  // Public entry point — retries the whole operation on a document-number
  // collision (rare now that numbers are branch-scoped unique; see
  // DocumentNumberingService.retryOnCollision). Safe to retry wholesale:
  // everything below runs inside one transaction plus a post-commit event
  // emit, so a failed attempt leaves no partial state to double-apply.
  async create(
    createInvoiceDto: CreateInvoiceDto,
    userId: string,
    branchId?: string,
    userRole?: string,
  ) {
    return this.numbering.retryOnCollision(() =>
      this.createInternal(createInvoiceDto, userId, branchId, userRole),
    );
  }

  private async createInternal(
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
    // ledger update, no notifications, no credit-limit check.
    // The draft only becomes "real" when finalizeDraft() runs.
    const isDraft = createInvoiceDto.status === 'DRAFT';
    // Admins are exempt from the pending-credit cap — they can extend credit
    // regardless of how many invoices a customer already has unsettled.
    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
    const created = await this.prisma.$transaction(async (tx) => {
      // 1. Credit limit check — behaviour differs by role. Skipped for drafts
      // (a draft hasn't extended credit to anyone yet) and for admins.
      if (
        !isDraft &&
        !isAdmin &&
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
            const mrpFallbacks = await this.resolveItemMrpFallbacks(tx, createInvoiceDto.items);
            const draftInvoice = await tx.invoice.create({
              data: {
                invoiceNumber,
                type: createInvoiceDto.type,
                billingType: createInvoiceDto.billingType,
                branchId,
                customerId: createInvoiceDto.customerId ?? null,
                customerName: (createInvoiceDto.customerName ?? '').trim(),
                doctorName: createInvoiceDto.doctorName ?? null,
                salespersonId: createInvoiceDto.salespersonId ?? null,
                salespersonName: createInvoiceDto.salespersonName ?? null,
                subtotal: r2(createInvoiceDto.subtotal),
                productDiscount: r2(createInvoiceDto.productDiscount),
                taxableAmount: r2(createInvoiceDto.taxableAmount ?? createInvoiceDto.subtotal),
                cgst: r2(createInvoiceDto.cgst),
                sgst: r2(createInvoiceDto.sgst),
                igst: r2(createInvoiceDto.igst),
                deliveryCharge: r2(createInvoiceDto.deliveryCharge),
                additionalCharges: (createInvoiceDto.additionalCharges ?? []) as any,
                roundOff: r2(createInvoiceDto.roundOff),
                grandTotal: r2(createInvoiceDto.grandTotal),
                paymentMode: 'CREDIT',
                status: 'DRAFT',
                amountPaid: 0,
                changeReturned: 0,
                createdById: userId,
                // Optional CRM Lead link — populated when the invoice is
                // created via "Create Invoice" from the lead detail panel.
                ...(createInvoiceDto.leadId && { leadId: createInvoiceDto.leadId }),
                items: {
                  create: createInvoiceDto.items.map((item) =>
                    normalizeItem(item, this.mrpFallbackFor(mrpFallbacks, item)),
                  ),
                },
              } as any,
            });

            await this.approvalsService.createRequest({
              type: 'CREDIT_BILL',
              payload: {
                invoiceId: draftInvoice.id,
                invoiceNumber,
                pendingCount,
                customerId: createInvoiceDto.customerId,
                customerName: createInvoiceDto.customerName,
                grandTotal: createInvoiceDto.grandTotal,
                // Carry the full bill so the reviewer sees exactly what's being
                // sold on credit (products / qty / rate / tax) without having to
                // open the draft invoice separately.
                items: createInvoiceDto.items,
                subtotal: createInvoiceDto.subtotal,
                cgst: createInvoiceDto.cgst,
                sgst: createInvoiceDto.sgst,
                igst: createInvoiceDto.igst,
              },
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

      // 2. Generate unique invoice/quotation number (atomic, FY-aware).
      // Replacement invoices (no-charge, fulfilling a credit note) get their
      // own REPL series so they're distinguishable from regular sales.
      const isQuotation = createInvoiceDto.type === 'QUOTATION';
      const docType: 'QTN' | 'INV' | 'REPL' = isQuotation
        ? 'QTN'
        : createInvoiceDto.isReplacement
          ? 'REPL'
          : 'INV';
      const invoiceNumber = await this.numbering.nextNumber(
        tx,
        docType,
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

      // Derive the payment status from the actual money collected rather than
      // trusting the client: a partial cash/UPI collection (amountPaid <
      // grandTotal) must land as PARTIAL, not PAID. Drafts/quotations keep their
      // explicit DRAFT status. Mirrors the rule used by the edit path
      // (updateInvoice, step 5) so create and edit stay consistent.
      const grandTotalNum = r2(createInvoiceDto.grandTotal);
      const amountPaidNum = r2(createInvoiceDto.amountPaid);
      const derivedStatus: InvoiceStatus = isDraft
        ? createInvoiceDto.status
        : amountPaidNum + 0.01 >= grandTotalNum
          ? InvoiceStatus.PAID
          : amountPaidNum > 0
            ? InvoiceStatus.PARTIAL
            : InvoiceStatus.UNPAID;

      // 3. Create the Invoice and InvoiceItems
      const mrpFallbacks = await this.resolveItemMrpFallbacks(tx, createInvoiceDto.items);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: createInvoiceDto.type,
          billingType: createInvoiceDto.billingType,
          branchId,
          customerId: createInvoiceDto.customerId,
          customerName: (createInvoiceDto.customerName ?? '').trim(),
          doctorName: createInvoiceDto.doctorName,
          subtotal: r2(createInvoiceDto.subtotal),
          productDiscount: r2(createInvoiceDto.productDiscount),
          taxableAmount: r2(createInvoiceDto.taxableAmount),
          cgst: r2(createInvoiceDto.cgst),
          sgst: r2(createInvoiceDto.sgst),
          igst: r2(createInvoiceDto.igst),
          deliveryCharge: r2(createInvoiceDto.deliveryCharge),
          additionalCharges: (createInvoiceDto.additionalCharges ?? []) as any,
          roundOff: r2(createInvoiceDto.roundOff),
          grandTotal: r2(createInvoiceDto.grandTotal),
          paymentMode: createInvoiceDto.paymentMode,
          paymentDetails: createInvoiceDto.paymentDetails,
          dueDate: createInvoiceDto.dueDate ? new Date(createInvoiceDto.dueDate) : null,
          status: derivedStatus,
          amountPaid: r2(createInvoiceDto.amountPaid),
          changeReturned: r2(createInvoiceDto.changeReturned),
          salespersonId: createInvoiceDto.salespersonId ?? null,
          salespersonName: createInvoiceDto.salespersonName ?? null,
          createdById: userId,
          // Optional CRM Lead link — see DTO comment.
          ...(createInvoiceDto.leadId && { leadId: createInvoiceDto.leadId }),
          items: {
            create: createInvoiceDto.items.map((item) =>
              normalizeItem(item, this.mrpFallbackFor(mrpFallbacks, item)),
            ),
          },
        },
        include: {
          items: true
        }
      });

      // 4. Extend the customer's outstanding ledger by any unpaid balance.
      // Applies to ANY payment mode — a partial cash/UPI collection leaves a
      // balance the customer still owes, exactly like a credit/split sale. The
      // inner `amountAddedToCredit > 0` guard means a fully-paid cash/UPI sale
      // is a no-op. Skipped for drafts — outstanding isn't extended until the
      // draft is finalized.
      //
      // Side-effect: if the customer is sitting on a credit balance (negative
      // currentOutstanding from a prior CN-Adjust whose cascade had nothing
      // else to absorb), auto-apply that credit toward this new invoice's
      // unpaid balance. We capture currentOutstanding BEFORE the increment so
      // we know what credit was available pre-sale; bump invoice.amountPaid
      // by min(credit, balance); record a PAYMENT row tagged CREDIT_APPLIED
      // so the ledger has an auditable receipt for the credit consumption.
      if (!isDraft && createInvoiceDto.customerId) {
        const amountAddedToCredit = createInvoiceDto.grandTotal - createInvoiceDto.amountPaid;

        if (amountAddedToCredit > 0) {
          // Snapshot of customer credit BEFORE the standard increment fires.
          const preCust = await tx.customer.findUnique({
            where: { id: createInvoiceDto.customerId },
            select: { currentOutstanding: true },
          });
          const preOutstanding = Number(preCust?.currentOutstanding ?? 0);

          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { currentOutstanding: { increment: amountAddedToCredit } }
          });

          const creditAvailable = Math.max(0, -preOutstanding);
          const applyFromCredit = Math.min(creditAvailable, amountAddedToCredit);
          if (applyFromCredit > 0) {
            const newAmountPaid = Number(createInvoiceDto.amountPaid) + applyFromCredit;
            const newStatus: 'PAID' | 'PARTIAL' =
              newAmountPaid >= Number(createInvoiceDto.grandTotal) - 0.01 ? 'PAID' : 'PARTIAL';
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { amountPaid: newAmountPaid, status: newStatus },
            });
            await tx.payment.create({
              data: {
                receiptNumber: `RCT-CR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                customerId: createInvoiceDto.customerId,
                invoiceId: invoice.id,
                amount: applyFromCredit,
                paymentMode: 'CREDIT_APPLIED',
                notes: `Auto-applied from customer credit balance (was ₹${creditAvailable.toFixed(2)})`,
                branchId: branchId ?? null,
              },
            });
          }
        }
      }

      // 4b. Record at-counter cash/card/UPI collection as a Payment row so it
      // posts to the customer's payment history + ledger (not just amountPaid).
      if (!isQuotation && !isDraft) {
        await this.recordCounterPayment(tx, {
          invoiceId: invoice.id,
          customerId: createInvoiceDto.customerId,
          // Stamp the history row with the method money actually came in on. A
          // partial cash/UPI collection sets paymentMode = CREDIT on the invoice,
          // so we rely on the explicit collectionMethod here (falling back to the
          // paymentMode only when it's itself a collection method). A zero
          // amountPaid is a no-op inside recordCounterPayment.
          paymentMode:
            createInvoiceDto.collectionMethod ??
            (['CASH', 'UPI', 'CARD'].includes(createInvoiceDto.paymentMode)
              ? createInvoiceDto.paymentMode
              : 'CASH'),
          amountPaid: createInvoiceDto.amountPaid,
          referenceNumber: createInvoiceDto.paymentReference ?? null,
          branchId,
        });
      }

      // 5. Auto-create a PAYMENT_DUE notification for new credit invoices —
      // but only once the due date is within the lead window (default 3 days),
      // matching the daily sweep. A far-off due date stays quiet until then;
      // the sweep raises it when the window opens. Skipped for drafts and for a
      // credit sale whose cash advance already cleared the balance.
      if (!isQuotation && !isDraft && createInvoiceDto.paymentMode === 'CREDIT') {
        const outstanding = Number(createInvoiceDto.grandTotal) - Number(createInvoiceDto.amountPaid);
        const beforeDays = Number(process.env.CUSTOMER_PAYMENT_DUE_BEFORE_DAYS ?? 3);
        const dueDate = createInvoiceDto.dueDate ? new Date(createInvoiceDto.dueDate) : null;
        const daysUntilDue = dueDate
          ? Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000)
          : null;
        const withinWindow = daysUntilDue === null || daysUntilDue <= beforeDays;
        if (outstanding > 0.01 && withinWindow) {
          await tx.notification.create({
            data: {
              type: 'PAYMENT_DUE',
              title: 'Payment Due',
              message: `Invoice ${invoiceNumber} for ${createInvoiceDto.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${invoice.id}]`,
              actionUrl: `/customers/invoices/detail?id=${invoice.id}`,
              branchId: branchId ?? null,
              // Carry the due date so the UI can show "Due in Xd / Overdue Xd".
              entityState: {
                kind: 'PAYMENT_DUE',
                outstanding,
                customerName: createInvoiceDto.customerName,
                dueDate: dueDate ?? null,
              } as Prisma.InputJsonValue,
            },
          });
        }
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

  // Record money physically collected at the billing counter as a first-class
  // Payment row, so it appears in the customer's payment history + ledger
  // instead of living only implicitly inside invoice.amountPaid. Fires only for
  // real money-in modes (CASH / CARD / UPI) against a registered customer:
  //   - CREDIT extends the ledger via currentOutstanding, not a receipt;
  //   - SPLIT's mixed tender is left to the Cash Book's at-sale synthesis so its
  //     cash portion isn't mis-categorised here.
  // Double-count-safe: getCustomerLedger, getInvoicePayments and getCashBook all
  // subtract real Payment rows from their synthesised at-sale figure, so this
  // row nets out everywhere it's consumed.
  private async recordCounterPayment(
    tx: Prisma.TransactionClient,
    args: {
      invoiceId: string;
      customerId?: string | null;
      paymentMode: string;
      amountPaid: number | null | undefined;
      referenceNumber?: string | null;
      branchId?: string | null;
    },
  ) {
    const amount = r2(args.amountPaid);
    if (
      !args.customerId ||
      amount <= 0.01 ||
      !['CASH', 'CARD', 'UPI'].includes(args.paymentMode)
    ) {
      return;
    }
    const receiptNumber = await this.numbering.nextNumber(
      tx,
      'RCPT',
      args.branchId ?? null,
    );
    await tx.payment.create({
      data: {
        receiptNumber,
        customerId: args.customerId,
        invoiceId: args.invoiceId,
        amount,
        paymentMode: args.paymentMode,
        referenceNumber: args.referenceNumber?.trim() || null,
        notes: 'Collected at billing',
        branchId: args.branchId ?? null,
      },
    });
  }

  // Public helper so the manual `POST /:id/send-whatsapp` controller endpoint
  // can re-fire the listener flow for an existing invoice.
  //
  // Calls InvoiceCreatedListener.handle() DIRECTLY rather than through the
  // event bus. The auto-send path on invoice create deliberately fires the
  // event and forgets, since billing must never block on WhatsApp/PDF/R2 —
  // but `EventEmitter2.emitAsync()` does NOT actually wait for
  // `@OnEvent({async:true})` listeners to finish despite the name (confirmed
  // by instrumenting both sides live: emitAsync resolved in ~1ms while the
  // real listener took ~7s to complete PDF render + upload + the Meta call).
  // Awaiting that gave a false "SKIPPED" result for sends that had, in fact,
  // just succeeded. A manual button click has no reason to avoid blocking, so
  // it calls the listener's method directly — an ordinary async function call
  // the caller can genuinely await — instead of going through the event bus.
  async emitInvoiceCreatedById(invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');

    // Cooldown: if a message was created for this invoice in the last 30 seconds,
    // skip — protects against rapid button clicks and concurrent API requests
    // that sneak through the React disabled-state guard.
    const recentAttempt = await this.prisma.whatsAppMessage.findFirst({
      where: {
        relatedEntityId: inv.id,
        relatedEntityType: 'invoice',
        createdAt: { gte: new Date(Date.now() - 30_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recentAttempt) {
      this.logger.warn(`resend throttled for ${inv.invoiceNumber} — a message was created ${Math.round((Date.now() - recentAttempt.createdAt.getTime()) / 1000)}s ago`);
      return { ok: false, status: 'SKIPPED', invoiceNumber: inv.invoiceNumber };
    }

    const payload: InvoiceCreatedPayload = {
      invoiceId: inv.id,
      branchId: inv.branchId ?? null,
      customerId: inv.customerId ?? null,
      type: inv.type as any,
      status: inv.status as any,
      grandTotal: Number(inv.grandTotal),
      amountPaid: Number(inv.amountPaid),
      // Manual "Resend" — bypass the idempotency guard so the operator can
      // deliberately re-send even when a copy was already delivered.
      forceResend: true,
    };
    // Diff by id rather than assuming "no rows before, so any row after is
    // new" — robust even if handle() is ever called concurrently for the
    // same invoice from two requests.
    const before = await this.prisma.whatsAppMessage.findMany({
      where: { relatedEntityId: inv.id, relatedEntityType: 'invoice' },
      select: { id: true },
    });
    const beforeIds = new Set(before.map((m) => m.id));
    await this.invoiceCreatedListener.handle(payload);
    const candidates = await this.prisma.whatsAppMessage.findMany({
      where: { relatedEntityId: inv.id, relatedEntityType: 'invoice' },
      orderBy: { createdAt: 'desc' },
      take: beforeIds.size + 5,
    });
    const sent = candidates.find((m) => !beforeIds.has(m.id));
    if (!sent) {
      // Listener returned without creating a message — opted out, no phone,
      // WHATSAPP_AUTO_SEND_ENABLED off, or PDF render failed before send.
      return { ok: false, status: 'SKIPPED', invoiceNumber: inv.invoiceNumber };
    }
    return {
      ok: sent.status === 'SENT',
      status: sent.status,
      invoiceNumber: inv.invoiceNumber,
      errorMessage: sent.errorMessage ?? undefined,
    };
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
    if (filters?.status) {
      // "PENDING" is a UI bucket (Outstanding card) covering both unpaid and
      // partially-paid invoices — expand it to the underlying statuses.
      where.status =
        filters.status === 'PENDING'
          ? { in: ['UNPAID', 'PARTIAL'] }
          : filters.status;
    }
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

    // Pull the customer's current phone alongside each invoice so the
    // Sales List / detail drawer / dashboard can render "name + phone" for
    // disambiguating customers that share a common name. Live JOIN, not a
    // snapshot — historical invoices reflect the customer's current phone.
    const listInclude = {
      items: true,
      customer: { select: { phone: true } },
    } as const;
    // Surfaces customer.phone at the top level as `customerPhone` for the
    // frontend, mirroring the existing `customerName` shape.
    const mapPhone = <T extends { customer?: { phone: string } | null }>(row: T) => ({
      ...row,
      customerPhone: row.customer?.phone ?? null,
    });

    // Flags invoices that were issued to fulfil a REPLACEMENT credit note
    // (referenced via CreditNote.replacementInvoiceId) so the Sales List can
    // badge them "Replacement" instead of a plain PAID — mirrors the Purchase
    // Entry list's replacement marker.
    const withReplacementFlag = async <T extends { id: string }>(rows: T[]) => {
      if (!rows.length) return rows.map((r) => ({ ...r, isReplacement: false }));
      const cns = await this.prisma.creditNote.findMany({
        where: { replacementInvoiceId: { in: rows.map((r) => r.id) } },
        select: { replacementInvoiceId: true },
      });
      const replSet = new Set(
        cns.map((c) => c.replacementInvoiceId).filter(Boolean) as string[],
      );
      return rows.map((r) => ({ ...r, isReplacement: replSet.has(r.id) }));
    };

    if (!paginated) {
      // Legacy callers (NewSale, dashboard, customer detail) — keep the
      // lightweight array contract, default-capped at 200. The Sales List page
      // is architected fully client-side (period filter, stat cards, tab
      // counts, search all run over the loaded array), so a low cap silently
      // truncated BOTH the list AND the stats once a branch had >200 invoices.
      // It requests the full set via an explicit `take`; a generous ceiling
      // still guards against a runaway response.
      const takeCap =
        typeof take === 'number' && take > 0 ? Math.min(take, 10000) : 200;
      const rows = await this.prisma.invoice.findMany({
        where,
        include: listInclude,
        orderBy: { date: 'desc' },
        take: takeCap,
      });
      return withReplacementFlag(rows.map(mapPhone));
    }

    const safeTake = Math.min(Math.max(take!, 1), 100);
    const safeSkip = Math.max(skip!, 0);

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: listInclude,
        orderBy: { date: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const data = await withReplacementFlag(rows.map(mapPhone));
    return {
      data,
      total,
      hasMore: safeSkip + data.length < total,
    };
  }

  // Invoice summary for the stat cards. Unscoped by default (the Sales List
  // page keeps it unfiltered so the cards stay stable as the user searches),
  // but callers can scope it to a single salesperson and/or a date range — the
  // Salesperson Detail page uses that so its period cards reflect exactly the
  // invoices in the chosen period, independent of the paginated list below.
  async summary(
    branchId?: string,
    filters?: { salespersonId?: string; from?: string; to?: string },
  ) {
    // Real, posted sales only — DRAFT (not posted) and CANCELLED (voided) must
    // not count toward Total Sales / Collected. The per-status sub-queries
    // below override `status` for their own buckets (PAID / UNPAID+PARTIAL /
    // RETURNED), so the notIn here only governs the totals.
    const base: any = {
      type: 'INVOICE',
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    };
    if (branchId) base.branchId = branchId;
    if (filters?.salespersonId) base.salespersonId = filters.salespersonId;
    if (filters?.from || filters?.to) {
      base.date = {};
      if (filters.from) base.date.gte = new Date(filters.from);
      if (filters.to) {
        // Make the `to` boundary inclusive of the entire day.
        const toEnd = new Date(filters.to);
        toEnd.setHours(23, 59, 59, 999);
        base.date.lte = toEnd;
      }
    }

    const [totalInvoices, totalAmountAgg, paidCount, paidAgg, outstandingAgg, returnsCount] =
      await Promise.all([
        this.prisma.invoice.count({ where: base }),
        this.prisma.invoice.aggregate({ where: base, _sum: { grandTotal: true } }),
        this.prisma.invoice.count({ where: { ...base, status: 'PAID' } }),
        // Collected = actual cash received across ALL real invoices, including
        // part-payments on PARTIAL invoices — not just fully-PAID totals.
        this.prisma.invoice.aggregate({
          where: base,
          _sum: { amountPaid: true },
        }),
        this.prisma.invoice.findMany({
          where: { ...base, status: { in: ['UNPAID', 'PARTIAL'] } },
          select: { grandTotal: true, amountPaid: true },
        }),
        this.prisma.invoice.count({ where: { ...base, status: 'RETURNED' } }),
      ]);

    const outstandingAmount = outstandingAgg.reduce(
      (sum, inv) => sum + (Number(inv.grandTotal) - Number(inv.amountPaid)),
      0,
    );

    return {
      totalInvoices,
      totalAmount: Number(totalAmountAgg._sum.grandTotal ?? 0),
      paidCount,
      paidTotal: Number(paidAgg._sum.amountPaid ?? 0),
      outstandingAmount,
      outstandingCount: outstandingAgg.length,
      returnsCount,
    };
  }

  /**
   * Past purchases of given products by a customer. Returns a map keyed by
   * productId so the client can render per-product histories without further
   * grouping. Queries InvoiceItem directly with a branch + customer + product
   * filter — this means a customer with 500 invoices still gets full history
   * for any product they bought, where the general findAll() would have only
   * returned the most recent 200 invoices and silently dropped older entries.
   */
  async productPurchases(
    customerId: string,
    productIds: string[],
    branchId?: string,
    perProductLimit = 100,
  ): Promise<Record<string, Array<{
    date: string;
    invoiceNumber: string;
    batchNumber: string;
    qty: number;
    rate: number;
    status: string;
  }>>> {
    if (!customerId || productIds.length === 0) return {};
    const safeLimit = Math.min(Math.max(perProductLimit, 1), 500);

    // Pull all matching InvoiceItem rows in one query — newer first so we can
    // slice() per product after grouping. Total rows = productCount × safeLimit
    // worst case, which is ~10 × 100 = 1000 max for a Product History view.
    const rows = await this.prisma.invoiceItem.findMany({
      where: {
        productId: { in: productIds },
        invoice: {
          customerId,
          ...(branchId ? { branchId } : {}),
        },
      },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            date: true,
            createdAt: true,
            status: true,
          },
        },
      },
      orderBy: { invoice: { date: 'desc' } },
    });

    const result: Record<string, Array<{
      date: string;
      invoiceNumber: string;
      batchNumber: string;
      qty: number;
      rate: number;
      status: string;
    }>> = {};

    for (const productId of productIds) {
      result[productId] = [];
    }

    for (const r of rows) {
      const productId = r.productId;
      if (!productId) continue;
      const bucket = result[productId];
      if (!bucket || bucket.length >= safeLimit) continue;
      bucket.push({
        date: (r.invoice?.date ?? r.invoice?.createdAt ?? new Date()).toISOString(),
        invoiceNumber: r.invoice?.invoiceNumber ?? '—',
        batchNumber: r.batchNumber ?? '—',
        qty: Number(r.quantity),
        rate: Number(r.rate),
        status: r.invoice?.status ?? 'UNKNOWN',
      });
    }

    return result;
  }

  async findOne(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        createdBy: { select: { name: true } },
        customer: {
          select: {
            id: true, name: true, phone: true, alternatePhone: true,
            email: true, address: true, gstin: true, type: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    // Was this invoice issued to fulfil a REPLACEMENT credit note? Lets the
    // detail page badge it as a replacement (no-charge) invoice.
    const replacementCn = await this.prisma.creditNote.findFirst({
      where: { replacementInvoiceId: invoice.id },
      select: { creditNoteNo: true },
    });
    // Surface the customer's contact block (the Invoice row only snapshots the
    // name) so the detail page / preview / PDF can show phone, address, GSTIN.
    return {
      ...invoice,
      customerPhone: invoice.customer?.phone ?? null,
      customerAddress: invoice.customer?.address ?? null,
      customerGstin: invoice.customer?.gstin ?? null,
      isReplacement: !!replacementCn,
      replacementForCreditNote: replacementCn?.creditNoteNo ?? null,
    };
  }

  // Full payment history for a single invoice — every Payment row tied to it,
  // plus a synthesized "at-counter" entry for the upfront amount collected at
  // billing (which lands in invoice.amountPaid but is never written as a
  // Payment row). The synthesized entry makes the history total reconcile with
  // the invoice's "Paid" figure without backfilling old data.
  async getInvoicePayments(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: {
          select: { name: true, phone: true, address: true, gstin: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }

    const rows = await this.prisma.payment.findMany({
      where: { invoiceId: id },
      orderBy: { createdAt: 'asc' },
    });

    const recorded = rows.reduce((sum, p) => sum + Number(p.amount), 0);
    const amountPaid = Number(invoice.amountPaid);
    const initial = amountPaid - recorded;

    const payments: Array<{
      id: string | null;
      receiptNumber: string | null;
      amount: number;
      paymentMode: string;
      referenceNumber: string | null;
      notes: string | null;
      createdAt: Date;
      source: 'INITIAL' | 'RECORDED';
    }> = [];

    if (initial > 0.01) {
      payments.push({
        id: null,
        receiptNumber: null,
        amount: initial,
        paymentMode: invoice.paymentMode,
        referenceNumber: null,
        notes: 'Collected at billing',
        createdAt: invoice.date,
        source: 'INITIAL',
      });
    }

    for (const p of rows) {
      payments.push({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: Number(p.amount),
        paymentMode: p.paymentMode,
        referenceNumber: p.referenceNumber,
        notes: p.notes,
        createdAt: p.createdAt,
        source: 'RECORDED',
      });
    }

    return {
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer?.name ?? invoice.customerName ?? '—',
      // Party contact details come from the linked customer record (the
      // invoice itself only snapshots the name), so the receipt can show the
      // payer's address / phone / GSTIN.
      customerPhone: invoice.customer?.phone ?? null,
      customerAddress: invoice.customer?.address ?? null,
      customerGstin: invoice.customer?.gstin ?? null,
      grandTotal: Number(invoice.grandTotal),
      amountPaid,
      payments,
    };
  }

  // One-time migration: backfill Payment rows for historical at-counter
  // CASH/CARD/UPI sales that predate recordCounterPayment(). Each qualifying
  // invoice gets ONE Payment row for the gap between invoice.amountPaid and the
  // sum of its existing Payment rows, dated on the invoice date so Cash Book /
  // ledger timing is preserved. Idempotent: a re-run finds gap ≤ 0 (the
  // backfilled row closes it) and the deterministic `RCT-BF-<invoiceId>` receipt
  // number is unique per invoice (createMany skipDuplicates is a second guard).
  // Mirrors the synthesis used by getInvoicePayments / getCustomerLedger /
  // getCashBook, so reported totals never change — only the rows become real.
  // Not wrapped in one giant transaction on purpose: each page's createMany is
  // atomic, and idempotency makes a re-run after a partial failure safe.
  async backfillCounterPayments(branchId?: string) {
    const PAGE = 500;
    let skip = 0;
    let scanned = 0;
    let created = 0;
    let skippedNoGap = 0;
    let totalAmount = 0;

    for (;;) {
      const invoices = await this.prisma.invoice.findMany({
        where: {
          type: 'INVOICE',
          customerId: { not: null },
          paymentMode: { in: ['CASH', 'CARD', 'UPI'] },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          amountPaid: { gt: 0 },
          ...(branchId ? { branchId } : {}),
        },
        orderBy: { date: 'asc' },
        skip,
        take: PAGE,
        select: {
          id: true,
          customerId: true,
          branchId: true,
          date: true,
          amountPaid: true,
          paymentMode: true,
        },
      });
      if (invoices.length === 0) break;
      scanned += invoices.length;

      // Sum existing Payment rows per invoice so we only backfill the uncovered
      // portion (idempotent + correct for partially-recorded invoices).
      const ids = invoices.map((i) => i.id);
      const agg = await this.prisma.payment.groupBy({
        by: ['invoiceId'],
        where: { invoiceId: { in: ids } },
        _sum: { amount: true },
      });
      const realPaid = new Map(
        agg.map((a) => [a.invoiceId, Number(a._sum.amount ?? 0)]),
      );

      const toCreate = invoices
        .map((inv) => {
          const gap = Number(inv.amountPaid) - (realPaid.get(inv.id) ?? 0);
          if (gap <= 0.01) {
            skippedNoGap++;
            return null;
          }
          totalAmount += r2(gap);
          return {
            receiptNumber: `RCT-BF-${inv.id}`,
            customerId: inv.customerId as string,
            invoiceId: inv.id,
            amount: r2(gap),
            paymentMode: inv.paymentMode,
            notes: 'Backfilled at-counter collection',
            branchId: inv.branchId ?? null,
            // Preserve original timing — the Cash Book dates Payment rows by
            // createdAt, so the default now() would shift historical cash.
            createdAt: inv.date,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (toCreate.length) {
        const res = await this.prisma.payment.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        created += res.count;
      }

      skip += PAGE;
    }

    return { scanned, created, skippedNoGap, totalAmount: r2(totalAmount) };
  }

  async convertToInvoice(id: string, branchId?: string) {
    return this.numbering.retryOnCollision(() =>
      this.convertToInvoiceInternal(id, branchId),
    );
  }

  private async convertToInvoiceInternal(id: string, branchId?: string) {
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
            rate: Number(item.rate),
            mrp: Number(item.mrp),
            // The quotation price was already agreed with the customer, so
            // conversion must not re-block on the below-cost floor.
            allowBelowCost: true,
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
  // PATCH :id/finalize. Stock, ledger, notifications only run at
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

      const mrpFallbacks = await this.resolveItemMrpFallbacks(tx, dto.items);
      return tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: (dto.customerName ?? '').trim(),
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: r2(dto.subtotal),
          productDiscount: r2(dto.productDiscount),
          taxableAmount: r2(dto.taxableAmount ?? dto.subtotal),
          cgst: r2(dto.cgst),
          sgst: r2(dto.sgst),
          igst: r2(dto.igst),
          deliveryCharge: r2(dto.deliveryCharge),
          additionalCharges: (dto.additionalCharges ?? []) as any,
          roundOff: r2(dto.roundOff),
          grandTotal: r2(dto.grandTotal),
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          amountPaid: r2(dto.amountPaid),
          changeReturned: r2(dto.changeReturned),
          // Status pinned to DRAFT — finalization goes through finalizeDraft().
          status: 'DRAFT',
          items: {
            create: dto.items.map((item) =>
              normalizeItem(item, this.mrpFallbackFor(mrpFallbacks, item)),
            ),
          },
        },
        include: { items: true },
      });
    });
  }

  // Finalize a draft into a real invoice. Runs the side effects that create()
  // skipped: prescription check, stock deduction, ledger, notification.
  // The DTO's status must be a final state (PAID / UNPAID / PARTIAL) — drafts
  // can't "finalize" themselves into another draft.
  async finalizeDraft(id: string, dto: CreateInvoiceDto, branchId?: string) {
    if (dto.status === 'DRAFT') {
      throw new BadRequestException('Finalize requires a non-DRAFT status (PAID / UNPAID / PARTIAL).');
    }
    return this.numbering.retryOnCollision(() =>
      this.finalizeDraftInternal(id, dto, branchId),
    );
  }

  private async finalizeDraftInternal(id: string, dto: CreateInvoiceDto, branchId?: string) {
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
      const mrpFallbacks = await this.resolveItemMrpFallbacks(tx, dto.items);
      const finalized = await tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: (dto.customerName ?? '').trim(),
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: r2(dto.subtotal),
          productDiscount: r2(dto.productDiscount),
          taxableAmount: r2(dto.taxableAmount ?? dto.subtotal),
          cgst: r2(dto.cgst),
          sgst: r2(dto.sgst),
          igst: r2(dto.igst),
          deliveryCharge: r2(dto.deliveryCharge),
          additionalCharges: (dto.additionalCharges ?? []) as any,
          roundOff: r2(dto.roundOff),
          grandTotal: r2(dto.grandTotal),
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          amountPaid: r2(dto.amountPaid),
          changeReturned: r2(dto.changeReturned),
          status: dto.status,
          items: {
            create: dto.items.map((item) =>
              normalizeItem(item, this.mrpFallbackFor(mrpFallbacks, item)),
            ),
          },
        },
        include: { items: true },
      });

      // Outstanding ledger update — same logic as create()'s non-draft path,
      // including the customer-credit auto-apply (see create() for full
      // commentary on why this exists).
      if (
        (dto.paymentMode === 'CREDIT' || dto.paymentMode === 'SPLIT') &&
        dto.customerId
      ) {
        const owed = dto.grandTotal - (dto.amountPaid ?? 0);
        if (owed > 0) {
          const preCust = await tx.customer.findUnique({
            where: { id: dto.customerId },
            select: { currentOutstanding: true },
          });
          const preOutstanding = Number(preCust?.currentOutstanding ?? 0);

          await tx.customer.update({
            where: { id: dto.customerId },
            data: { currentOutstanding: { increment: owed } },
          });

          const creditAvailable = Math.max(0, -preOutstanding);
          const applyFromCredit = Math.min(creditAvailable, owed);
          if (applyFromCredit > 0) {
            const newAmountPaid = Number(dto.amountPaid ?? 0) + applyFromCredit;
            const newStatus: 'PAID' | 'PARTIAL' =
              newAmountPaid >= Number(dto.grandTotal) - 0.01 ? 'PAID' : 'PARTIAL';
            await tx.invoice.update({
              where: { id },
              data: { amountPaid: newAmountPaid, status: newStatus },
            });
            await tx.payment.create({
              data: {
                receiptNumber: `RCT-CR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                customerId: dto.customerId,
                invoiceId: id,
                amount: applyFromCredit,
                paymentMode: 'CREDIT_APPLIED',
                notes: `Auto-applied from customer credit balance (was ₹${creditAvailable.toFixed(2)})`,
                branchId: existing.branchId ?? branchId ?? null,
              },
            });
          }
        }
      }

      // Record at-counter cash/card/UPI collection as a Payment row (parity
      // with create()) so finalized-draft sales also post to the ledger.
      if (existing.type === 'INVOICE') {
        await this.recordCounterPayment(tx, {
          invoiceId: id,
          customerId: dto.customerId,
          paymentMode: dto.paymentMode,
          amountPaid: dto.amountPaid,
          branchId: existing.branchId ?? branchId,
        });
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
  // we reverse the original side effects (stock, customer outstanding)
  // and reapply them with the new figures. PAID/RETURNED/CANCELLED
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
      // Only UNPAID / PARTIAL invoices are editable. PAID is excluded because
      // the sale is fully settled — any correction there should go through a
      // credit note, not a silent edit (this mirrors the UI, which only offers
      // Edit for UNPAID/PARTIAL, and now enforces it server-side too). CANCELLED
      // / RETURNED are financially closed. DRAFT has its own saveDraft /
      // finalizeDraft flow and never reaches here via this endpoint.
      if (existing.status !== 'UNPAID' && existing.status !== 'PARTIAL') {
        throw new BadRequestException(
          `Cannot edit invoice ${existing.invoiceNumber}: only UNPAID or PARTIAL invoices can be edited (status is ${existing.status}). Fully paid, cancelled, or returned invoices are financially closed — issue a credit note instead.`,
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
      const mrpFallbacks = await this.resolveItemMrpFallbacks(tx, dto.items);
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          billingType: dto.billingType,
          customerId: dto.customerId ?? null,
          customerName: (dto.customerName ?? '').trim(),
          doctorName: dto.doctorName ?? null,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: dto.salespersonName ?? null,
          subtotal: r2(dto.subtotal),
          productDiscount: r2(dto.productDiscount),
          taxableAmount: r2(dto.taxableAmount ?? dto.subtotal),
          cgst: r2(dto.cgst),
          sgst: r2(dto.sgst),
          igst: r2(dto.igst),
          deliveryCharge: r2(dto.deliveryCharge),
          additionalCharges: (dto.additionalCharges ?? []) as any,
          roundOff: r2(dto.roundOff),
          grandTotal: r2(dto.grandTotal),
          paymentMode: dto.paymentMode,
          paymentDetails: dto.paymentDetails,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          status: newStatus,
          // amountPaid intentionally NOT overwritten — it's the running tally
          // of what the customer actually handed over and lives independently
          // of the invoice's billed amount.
          items: {
            create: dto.items.map((item) =>
              normalizeItem(item, this.mrpFallbackFor(mrpFallbacks, item)),
            ),
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

  async collectPayment(id: string, amountReceived: number, paymentMode: string, branchId?: string, referenceNumber?: string) {
    return this.numbering.retryOnCollision(() =>
      this.collectPaymentInternal(id, amountReceived, paymentMode, branchId, referenceNumber),
    );
  }

  private async collectPaymentInternal(id: string, amountReceived: number, paymentMode: string, branchId?: string, referenceNumber?: string) {
    // Non-cash modes (UPI / Card / Cheque / NEFT) are traceable — require a
    // reference (UTR / txn id / cheque no.) so the receipt can be reconciled.
    const ref = referenceNumber?.trim() || undefined;
    if (paymentMode && paymentMode.toUpperCase() !== 'CASH' && !ref) {
      throw new BadRequestException(`A reference number is required for ${paymentMode} payments`);
    }
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
      // Reject overpayment — you can never collect more than what's due.
      // 0.01 tolerance absorbs floating-point rounding on the outstanding.
      if (amountReceived > outstanding + 0.01) {
        throw new BadRequestException(
          `Payment cannot exceed the outstanding amount of ${outstanding.toFixed(2)}`,
        );
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
            referenceNumber: ref ?? null,
            branchId: invoice.branchId ?? null,
          },
        });
      }

      // Keep the Payment Due reminder in sync: resolve it if the invoice is now
      // fully paid, or refresh its amount if a balance remains.
      await syncPaymentDueForInvoice(tx, {
        id,
        status: newStatus,
        grandTotal: invoice.grandTotal,
        amountPaid: newAmountPaid,
        date: invoice.date,
        customerName: invoice.customerName,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
      });

      return updated;
    });
  }

  async update(id: string, data: any, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }

    // Cancelling an invoice that still carries an open balance must release that
    // balance from the customer's cached `currentOutstanding`. Otherwise the
    // cancelled amount stays stuck on the customer (inflating the detail header,
    // ledger KPI, and aged-receivables report, all of which read the cache).
    // Only UNPAID/PARTIAL invoices hold outstanding.
    const openBalance = Number(invoice.grandTotal) - Number(invoice.amountPaid);
    const releasesOutstanding =
      data?.status === 'CANCELLED' &&
      invoice.status !== 'CANCELLED' &&
      !!invoice.customerId &&
      ['UNPAID', 'PARTIAL'].includes(invoice.status) &&
      openBalance > 0;

    if (releasesOutstanding) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.invoice.update({ where: { id }, data });
        await tx.customer.update({
          where: { id: invoice.customerId! },
          data: { currentOutstanding: { decrement: openBalance } },
        });
        return updated;
      });
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
