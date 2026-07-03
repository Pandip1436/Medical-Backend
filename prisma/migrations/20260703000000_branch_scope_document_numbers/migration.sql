-- Document numbers (invoiceNumber, receiptNumber, grnNumber, paymentNumber,
-- poNumber, creditNoteNo, refundNumber, debitNoteNo, quotationNumber) were
-- globally unique across the whole database. The number GENERATOR
-- (DocumentSequence) keeps a separate counter per branch with no branch
-- token in the rendered format, so two branches active in the same fiscal
-- year inevitably produce the same string, causing live invoice/payment
-- creation to fail with an unhandled unique-constraint violation.
--
-- Fix: make each of these fields unique WITHIN a branch, not globally —
-- matches how GST invoice numbering works per business location and does
-- not change what any invoice number looks like.
--
-- Pre-migration check (run 2026-07-03, before this migration): zero
-- duplicate (number, branchId) pairs found across all 9 tables, so this
-- is a pure index swap with no data changes needed.

-- DropIndex
DROP INDEX "CreditNote_creditNoteNo_key";

-- DropIndex
DROP INDEX "GRN_grnNumber_key";

-- DropIndex
DROP INDEX "Invoice_invoiceNumber_key";

-- DropIndex
DROP INDEX "Payment_receiptNumber_key";

-- DropIndex
DROP INDEX "PurchaseOrder_poNumber_key";

-- DropIndex
DROP INDEX "PurchaseReturn_debitNoteNo_key";

-- DropIndex
DROP INDEX "Quotation_quotationNumber_key";

-- DropIndex
DROP INDEX "Refund_refundNumber_key";

-- DropIndex
DROP INDEX "SupplierPayment_paymentNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_branchId_key" ON "CreditNote"("creditNoteNo", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "GRN_grnNumber_branchId_key" ON "GRN"("grnNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_branchId_key" ON "Invoice"("invoiceNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_branchId_key" ON "Payment"("receiptNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_branchId_key" ON "PurchaseOrder"("poNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_debitNoteNo_branchId_key" ON "PurchaseReturn"("debitNoteNo", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNumber_branchId_key" ON "Quotation"("quotationNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_refundNumber_branchId_key" ON "Refund"("refundNumber", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNumber_branchId_key" ON "SupplierPayment"("paymentNumber", "branchId");
