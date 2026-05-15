-- Three feature additions land together here because all three were applied
-- to dev environments via `prisma db push` (no migration files were generated
-- at the time). This file is the catch-up migration so production deploys
-- via `prisma migrate deploy` can recreate the same schema.
--
--   1. SharedFile        — temporary public links for WhatsApp PDF delivery
--                           (invoice/quotation share). UUID-keyed; cleanup
--                           scheduler deletes via R2 + DB on expiry.
--
--   2. SupplierActivity  — interaction log on the supplier 360 page
--                           (CALL / WHATSAPP / EMAIL / NOTE / REMINDER).
--
--   3. CustomerActivity  — same shape, mirrored for the customer 360 page.
--
-- Idempotent throughout (IF NOT EXISTS / DO-block with duplicate_object
-- swallow) so re-running on a dev DB that already has these objects from
-- `db push` is a no-op rather than an error.

-- ── Enums ────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "SupplierActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'NOTE', 'REMINDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierActivityStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'NOTE', 'REMINDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerActivityStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SharedFile" (
  "id"          TEXT          NOT NULL,
  "filename"    TEXT          NOT NULL,
  "mimeType"    TEXT          NOT NULL,
  "sizeBytes"   INTEGER       NOT NULL,
  "label"       TEXT,
  "createdById" TEXT          NOT NULL,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "SharedFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierActivity" (
  "id"          TEXT                      NOT NULL,
  "supplierId"  TEXT                      NOT NULL,
  "type"        "SupplierActivityType"    NOT NULL,
  "notes"       TEXT,
  "title"       TEXT,
  "occurredAt"  TIMESTAMP(3),
  "dueAt"       TIMESTAMP(3),
  "status"      "SupplierActivityStatus"  DEFAULT 'PENDING',
  "contactName" TEXT,
  "subject"     TEXT,
  "createdById" TEXT                      NOT NULL,
  "branchId"    TEXT,
  "createdAt"   TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)              NOT NULL,
  CONSTRAINT "SupplierActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerActivity" (
  "id"          TEXT                      NOT NULL,
  "customerId"  TEXT                      NOT NULL,
  "type"        "CustomerActivityType"    NOT NULL,
  "notes"       TEXT,
  "title"       TEXT,
  "occurredAt"  TIMESTAMP(3),
  "dueAt"       TIMESTAMP(3),
  "status"      "CustomerActivityStatus"  DEFAULT 'PENDING',
  "contactName" TEXT,
  "subject"     TEXT,
  "createdById" TEXT                      NOT NULL,
  "branchId"    TEXT,
  "createdAt"   TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)              NOT NULL,
  CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "SharedFile_expiresAt_idx"
  ON "SharedFile" ("expiresAt");

CREATE INDEX IF NOT EXISTS "SupplierActivity_supplierId_createdAt_idx"
  ON "SupplierActivity" ("supplierId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupplierActivity_supplierId_type_idx"
  ON "SupplierActivity" ("supplierId", "type");

CREATE INDEX IF NOT EXISTS "CustomerActivity_customerId_createdAt_idx"
  ON "CustomerActivity" ("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerActivity_customerId_type_idx"
  ON "CustomerActivity" ("customerId", "type");

-- ── Foreign keys ─────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "SharedFile" ADD CONSTRAINT "SharedFile_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierActivity" ADD CONSTRAINT "SupplierActivity_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierActivity" ADD CONSTRAINT "SupplierActivity_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierActivity" ADD CONSTRAINT "SupplierActivity_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
