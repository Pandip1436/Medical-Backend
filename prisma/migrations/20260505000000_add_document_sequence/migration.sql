-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "branchId" TEXT,
    "financialYear" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_key_key" ON "DocumentSequence"("key");

-- CreateIndex
CREATE INDEX "DocumentSequence_docType_branchId_financialYear_idx" ON "DocumentSequence"("docType", "branchId", "financialYear");
