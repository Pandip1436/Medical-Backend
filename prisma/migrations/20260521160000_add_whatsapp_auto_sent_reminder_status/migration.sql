-- Phase 5b of the WhatsApp pipeline: monthly sale reminder auto-send.
--
-- Adds a new ReminderContactStatus enum value WHATSAPP_AUTO_SENT. The
-- ReminderDueNotificationListener writes a ReminderContact row with this
-- status after it auto-sends the monthly customer_sale_reminder template,
-- so staff see in the RemindersPage contact log that the customer has
-- already been pinged via WhatsApp and they don't need to also call.
--
-- Idempotent re-run safety: ALTER TYPE ... ADD VALUE IF NOT EXISTS is
-- supported on Postgres 9.6+. Neon runs Postgres 16, so we're fine.

ALTER TYPE "ReminderContactStatus" ADD VALUE IF NOT EXISTS 'WHATSAPP_AUTO_SENT';
