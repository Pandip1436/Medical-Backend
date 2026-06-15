-- Add a SUPPLIER_PAYMENT_DUE notification type — the supplier-side mirror of
-- PAYMENT_DUE (money the business owes suppliers on unpaid/partial GRNs).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT_DUE';
