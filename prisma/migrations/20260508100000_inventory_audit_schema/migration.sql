-- AlterEnum: add INVENTORY_ADJUSTMENT to ApprovalType
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'INVENTORY_ADJUSTMENT';

-- AlterTable: Category gains a branchId column (nullable for back-compat with
-- existing rows that were globally scoped before today)
ALTER TABLE "Category" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropIndex: replace the global name-only unique with a per-branch unique
DROP INDEX IF EXISTS "Category_name_key";

-- CreateIndex: per-branch uniqueness so two branches can each have a "Cardio"
-- category with their own colour/description
CREATE UNIQUE INDEX "Category_name_branchId_key" ON "Category"("name", "branchId");

-- AlterTable: StockAdjustmentLog gains an adjustmentNo so atomic ADJ doc
-- numbers can be assigned per stock-adjustment session
ALTER TABLE "StockAdjustmentLog" ADD COLUMN "adjustmentNo" TEXT;
