-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'CASHFREE');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('CREATED', 'SENT', 'PAID', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE', 'INVALID_SIGNATURE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerQrId" TEXT NOT NULL,
    "shortUrl" TEXT NOT NULL,
    "qrImageUrl" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'CREATED',
    "closedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "messageBody" TEXT,
    "mediaUrl" TEXT,
    "providerMessageId" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_providerQrId_key" ON "PaymentLink"("providerQrId");

-- CreateIndex
CREATE INDEX "PaymentLink_invoiceId_status_idx" ON "PaymentLink"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "PaymentLink_branchId_idx" ON "PaymentLink"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_relatedEntityType_relatedEntityId_idx" ON "WhatsAppMessage"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_attempts_idx" ON "WhatsAppMessage"("status", "attempts");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key" ON "WebhookEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "Payment_referenceNumber_idx" ON "Payment"("referenceNumber");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

