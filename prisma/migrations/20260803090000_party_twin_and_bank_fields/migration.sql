-- Structured bank fields + customer-parity columns on Supplier
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankAccountNumber" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankIfsc" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankUpiId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "alternatePhone" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Linked wholesale-customer twin (FK owned by Supplier, unique 1:1)
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_customerId_key'
  ) THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_customerId_key" UNIQUE ("customerId");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_customerId_fkey'
  ) THEN
    ALTER TABLE "Supplier"
      ADD CONSTRAINT "Supplier_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
