-- Rename InvoiceStatus value CREDIT -> UNPAID
-- Postgres enum alteration requires drop+recreate of the type because
-- enum values cannot be renamed in place and cannot be removed once added.

-- Step 1: rename existing enum type to a temporary name
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";

-- Step 2: create the new enum with UNPAID instead of CREDIT
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PAID', 'UNPAID', 'PARTIAL', 'RETURNED', 'CANCELLED');

-- Step 3: switch the Invoice.status column to the new enum, mapping CREDIT -> UNPAID
ALTER TABLE "Invoice"
  ALTER COLUMN "status" TYPE "InvoiceStatus"
  USING (
    CASE "status"::text
      WHEN 'CREDIT' THEN 'UNPAID'
      ELSE "status"::text
    END
  )::"InvoiceStatus";

-- Step 4: drop the old enum type
DROP TYPE "InvoiceStatus_old";
