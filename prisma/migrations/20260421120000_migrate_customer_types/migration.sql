-- Migrate old CustomerType values to new ones
UPDATE "Customer" SET "type" = 'RETAIL' WHERE "type" IN ('WALK_IN', 'REGULAR');
UPDATE "Customer" SET "type" = 'WHOLESALE' WHERE "type" = 'HOSPITAL';
