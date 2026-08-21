-- DropForeignKey
ALTER TABLE "CreditNote" DROP CONSTRAINT "CreditNote_invoiceId_fkey";

-- AlterTable
ALTER TABLE "CreditNote" ALTER COLUMN "invoiceId" DROP NOT NULL,
ALTER COLUMN "invoiceNumber" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
