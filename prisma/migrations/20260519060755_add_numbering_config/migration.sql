-- CreateTable
CREATE TABLE "NumberingConfig" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "docType" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "fyFormat" TEXT NOT NULL DEFAULT 'YY-YY',
    "padding" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NumberingConfig_docType_idx" ON "NumberingConfig"("docType");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingConfig_branchId_docType_key" ON "NumberingConfig"("branchId", "docType");

-- AddForeignKey
ALTER TABLE "NumberingConfig" ADD CONSTRAINT "NumberingConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
