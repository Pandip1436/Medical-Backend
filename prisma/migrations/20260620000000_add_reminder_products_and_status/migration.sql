-- AlterEnum
ALTER TYPE "ReminderContactStatus" ADD VALUE 'STOPPED';

-- AlterTable
ALTER TABLE "CustomerReminder" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ReminderProduct" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderProduct_reminderId_idx" ON "ReminderProduct"("reminderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderProduct_reminderId_productId_key" ON "ReminderProduct"("reminderId", "productId");

-- AddForeignKey
ALTER TABLE "ReminderProduct" ADD CONSTRAINT "ReminderProduct_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "CustomerReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderProduct" ADD CONSTRAINT "ReminderProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
