-- Add defaults to Product columns that the trimmed Add Product form no longer
-- requires. Frontend now omits these on create; Prisma fills in the defaults.
-- storageCondition is the only previously-required column that flips to
-- "default-and-keep-omittable"; the rest stay nullable-by-default values.
ALTER TABLE "Product"
  ALTER COLUMN "packSize" SET DEFAULT '',
  ALTER COLUMN "unitOfMeasure" SET DEFAULT '',
  ALTER COLUMN "storageCondition" SET DEFAULT 'ROOM_TEMP',
  ALTER COLUMN "purchaseRate" SET DEFAULT 0,
  ALTER COLUMN "wholesaleRate" SET DEFAULT 0,
  ALTER COLUMN "maxStock" SET DEFAULT 0,
  ALTER COLUMN "reorderQty" SET DEFAULT 0,
  ALTER COLUMN "rackLocation" SET DEFAULT '';
