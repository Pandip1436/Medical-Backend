-- IndiaMART integration pivot: Pull API → Push API (real-time webhooks).
-- The Push flow doesn't use IndiaMART-issued API keys; instead WE generate
-- a high-entropy URL secret that the seller pastes into IndiaMART's panel.
-- IndiaMART then POSTs leads to that URL.
--
-- - Add `webhookToken` (nullable, unique) to hold the URL secret per branch.
-- - Make the Pull-API columns nullable so we can stop populating them on
--   new Push rows without dropping data on legacy ones.

ALTER TABLE "IntegrationCredential"
  ADD COLUMN IF NOT EXISTS "webhookToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationCredential_webhookToken_key"
  ON "IntegrationCredential"("webhookToken");

ALTER TABLE "IntegrationCredential"
  ALTER COLUMN "apiKeyCiphertext" DROP NOT NULL,
  ALTER COLUMN "apiKeyIv" DROP NOT NULL,
  ALTER COLUMN "apiKeyTag" DROP NOT NULL;
