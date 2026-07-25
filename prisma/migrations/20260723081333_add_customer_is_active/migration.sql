/*
  Warnings:

  - You are about to alter the column `gstPercent` on the `GRNItem` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GRNItem" ALTER COLUMN "gstPercent" SET DATA TYPE DECIMAL(65,30);
