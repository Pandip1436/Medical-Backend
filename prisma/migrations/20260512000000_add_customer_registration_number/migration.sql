-- AlterTable: Customer gains a registrationNumber column (nullable) so DOCTOR-type
-- customers can store their Medical Council registration number.
-- IF NOT EXISTS makes this safe to re-run on environments where the column was
-- added out-of-band via prisma db push during development.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "registrationNumber" TEXT;
