-- ─────────────────────────────────────────────────────────────
-- CRM module: Lead / Contact / Company / LeadActivity
-- + Integration plumbing for IndiaMART Pull API v2
-- ─────────────────────────────────────────────────────────────

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE "LeadStage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "LeadTouchStatus" AS ENUM ('TOUCHED', 'UNTOUCHED');
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'INDIAMART', 'REFERRAL', 'WEBSITE', 'WHATSAPP', 'CALL', 'EMAIL', 'OTHER');
CREATE TYPE "LeadPipeline" AS ENUM ('SALES', 'PROCUREMENT', 'SUPPORT');
CREATE TYPE "IndiamartQueryType" AS ENUM ('W', 'B', 'P', 'BIZ', 'WA');
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'NOTE', 'REMINDER');
CREATE TYPE "LeadActivityStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');
CREATE TYPE "IntegrationProvider" AS ENUM ('INDIAMART');
CREATE TYPE "SyncJobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'RATE_LIMITED', 'NO_NEW_LEADS');

-- ── Company ──────────────────────────────────────────────────
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Company_branchId_name_idx" ON "Company"("branchId", "name");
ALTER TABLE "Company" ADD CONSTRAINT "Company_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Contact ──────────────────────────────────────────────────
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "phoneCountryCode" TEXT NOT NULL DEFAULT '+91',
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "jobTitle" TEXT,
    "companyId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "countryIso" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerUserId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "promotedCustomerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Contact_promotedCustomerId_key" ON "Contact"("promotedCustomerId");
CREATE UNIQUE INDEX "Contact_branchId_phone_key" ON "Contact"("branchId", "phone");
CREATE INDEX "Contact_branchId_email_idx" ON "Contact"("branchId", "email");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_promotedCustomerId_fkey"
    FOREIGN KEY ("promotedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Lead ─────────────────────────────────────────────────────
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "leadNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "pipeline" "LeadPipeline" NOT NULL DEFAULT 'SALES',
    "stage" "LeadStage" NOT NULL DEFAULT 'LEAD',
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "touchStatus" "LeadTouchStatus" NOT NULL DEFAULT 'UNTOUCHED',
    "score" INTEGER NOT NULL DEFAULT 50,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expectedCloseDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "assignedToUserId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "externalQueryId" TEXT,
    "externalQueryType" "IndiamartQueryType",
    "externalQueryTime" TIMESTAMP(3),
    "externalMessage" TEXT,
    "externalProductName" TEXT,
    "externalCategory" TEXT,
    "externalCity" TEXT,
    "externalState" TEXT,
    "externalCountryIso" TEXT,
    "externalRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Lead_leadNumber_key" ON "Lead"("leadNumber");
CREATE UNIQUE INDEX "Lead_externalQueryId_key" ON "Lead"("externalQueryId");
CREATE INDEX "Lead_branchId_stage_status_idx" ON "Lead"("branchId", "stage", "status");
CREATE INDEX "Lead_assignedToUserId_idx" ON "Lead"("assignedToUserId");
CREATE INDEX "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");
CREATE INDEX "Lead_touchStatus_idx" ON "Lead"("touchStatus");
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── LeadActivity (mirrors CustomerActivity exactly) ──────────
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "notes" TEXT,
    "title" TEXT,
    "occurredAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "status" "LeadActivityStatus" DEFAULT 'PENDING',
    "contactName" TEXT,
    "subject" TEXT,
    "createdById" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX "LeadActivity_leadId_type_idx" ON "LeadActivity"("leadId", "type");
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── IntegrationCredential ────────────────────────────────────
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "branchId" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "apiKeyIv" TEXT NOT NULL,
    "apiKeyTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastSuccessfulEndTime" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationCredential_provider_branchId_key"
    ON "IntegrationCredential"("provider", "branchId");
CREATE INDEX "IntegrationCredential_isActive_provider_idx"
    ON "IntegrationCredential"("isActive", "provider");
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── IntegrationSyncJob ───────────────────────────────────────
CREATE TABLE "IntegrationSyncJob" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "branchId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "SyncJobStatus" NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "newLeadsCount" INTEGER NOT NULL DEFAULT 0,
    "dupeSkippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "rawRequestUrl" TEXT,
    "rawResponseSize" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationSyncJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegrationSyncJob_branchId_provider_startedAt_idx"
    ON "IntegrationSyncJob"("branchId", "provider", "startedAt");
CREATE INDEX "IntegrationSyncJob_status_idx" ON "IntegrationSyncJob"("status");
ALTER TABLE "IntegrationSyncJob" ADD CONSTRAINT "IntegrationSyncJob_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Invoice / Quotation: attach optional leadId for conversions ─
ALTER TABLE "Invoice" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Invoice_leadId_idx" ON "Invoice"("leadId");

ALTER TABLE "Quotation" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Quotation_leadId_idx" ON "Quotation"("leadId");
