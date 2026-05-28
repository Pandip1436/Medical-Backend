-- CreateEnum
CREATE TYPE "GrnPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "GRN" ADD COLUMN     "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentStatus" "GrnPaymentStatus" NOT NULL DEFAULT 'UNPAID';

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "grnId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNumber_key" ON "SupplierPayment"("paymentNumber");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_grnId_idx" ON "SupplierPayment"("grnId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
