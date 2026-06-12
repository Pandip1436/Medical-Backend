-- Add a CANCELLED state to the purchase-order status enum so a PO can be
-- explicitly cancelled (distinct from CLOSED). PostgreSQL allows adding an enum
-- value transactionally on PG12+; the value is only used by later statements,
-- not within this migration, so it's safe.
ALTER TYPE "POStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
