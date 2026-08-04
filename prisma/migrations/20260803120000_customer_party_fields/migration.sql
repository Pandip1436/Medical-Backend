-- Shared party fields on Customer (populated for WHOLESALE customers, synced
-- with the linked supplier twin).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "contactPerson" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bankAccountNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bankIfsc" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bankUpiId" TEXT;
