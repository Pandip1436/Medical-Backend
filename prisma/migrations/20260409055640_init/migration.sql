-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('WALK_IN', 'REGULAR', 'HOSPITAL', 'WHOLESALE', 'DOCTOR');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('NEPHROLOGY', 'ONCOLOGY', 'GENERAL', 'OTC', 'SURGICAL');

-- CreateEnum
CREATE TYPE "Schedule" AS ENUM ('NONE', 'H', 'H1', 'X');

-- CreateEnum
CREATE TYPE "StorageCondition" AS ENUM ('ROOM_TEMP', 'COOL_DRY', 'REFRIGERATED', 'FROZEN');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('NET_30', 'NET_45', 'NET_60');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'QUOTATION');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('RETAIL', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CARD', 'UPI', 'CREDIT', 'SPLIT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PAID', 'CREDIT', 'PARTIAL', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GRNStatus" AS ENUM ('DRAFT', 'RECEIVED', 'VERIFIED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PHARMACIST',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "type" "CustomerType" NOT NULL DEFAULT 'WALK_IN',
    "doctorRef" TEXT,
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currentOutstanding" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "gstin" TEXT,
    "dlNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "subCategory" TEXT,
    "packSize" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "schedule" "Schedule" NOT NULL DEFAULT 'NONE',
    "hsnCode" TEXT NOT NULL,
    "isNarcotic" BOOLEAN NOT NULL DEFAULT false,
    "storageCondition" "StorageCondition" NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "purchaseRate" DECIMAL(65,30) NOT NULL,
    "sellingRate" DECIMAL(65,30) NOT NULL,
    "wholesaleRate" DECIMAL(65,30) NOT NULL,
    "gstRate" DECIMAL(65,30) NOT NULL,
    "minStock" INTEGER NOT NULL,
    "maxStock" INTEGER NOT NULL,
    "reorderQty" INTEGER NOT NULL,
    "rackLocation" TEXT NOT NULL,
    "barcode" TEXT,
    "totalStock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "mfgDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "purchaseRate" DECIMAL(65,30) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "drugLicense" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "paymentTerms" "PaymentTerms" NOT NULL,
    "bankDetails" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "InvoiceType" NOT NULL,
    "billingType" "BillingType" NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "doctorName" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "productDiscount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(65,30) NOT NULL,
    "cgst" DECIMAL(65,30) NOT NULL,
    "sgst" DECIMAL(65,30) NOT NULL,
    "igst" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(65,30) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "paymentDetails" JSONB,
    "status" "InvoiceStatus" NOT NULL,
    "amountPaid" DECIMAL(65,30) NOT NULL,
    "changeReturned" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "discountPercent" DECIMAL(65,30) NOT NULL,
    "gstPercent" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "POStatus" NOT NULL,
    "expectedDelivery" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "requiredQty" INTEGER NOT NULL,
    "lastPurchaseRate" DECIMAL(65,30) NOT NULL,
    "expectedRate" DECIMAL(65,30) NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRN" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "poId" TEXT,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT NOT NULL,
    "supplierInvoiceDate" TIMESTAMP(3) NOT NULL,
    "supplierInvoiceAmount" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" "GRNStatus" NOT NULL,

    CONSTRAINT "GRN_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRNItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "batchNumber" TEXT NOT NULL,
    "mfgDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "purchaseRate" DECIMAL(65,30) NOT NULL,
    "mrp" DECIMAL(65,30) NOT NULL,
    "damageQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GRNItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "receiptImage" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_Alternatives" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GRN_grnNumber_key" ON "GRN"("grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "_Alternatives_AB_unique" ON "_Alternatives"("A", "B");

-- CreateIndex
CREATE INDEX "_Alternatives_B_index" ON "_Alternatives"("B");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRN" ADD CONSTRAINT "GRN_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRNItem" ADD CONSTRAINT "GRNItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Alternatives" ADD CONSTRAINT "_Alternatives_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Alternatives" ADD CONSTRAINT "_Alternatives_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
