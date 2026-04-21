-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SALESPERSON';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "salespersonId" TEXT,
ADD COLUMN     "salespersonName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "commissionRate" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
