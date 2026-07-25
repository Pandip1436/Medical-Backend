/*
  Warnings:

  - You are about to alter the column `gstPercent` on the `GRNItem` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- AlterTable
-- IF NOT EXISTS: Customer.isActive was added out-of-band (db push) on some
-- environments before this migration existed, so a plain ADD COLUMN would fail
-- there and block every later migration (P3009). The column is identical either
-- way (BOOLEAN NOT NULL DEFAULT true), so skipping it when present is safe.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
-- Re-running SET DATA TYPE to the same type is a no-op, so this is already
-- idempotent.
ALTER TABLE "GRNItem" ALTER COLUMN "gstPercent" SET DATA TYPE DECIMAL(65,30);
