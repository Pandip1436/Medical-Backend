-- Update CustomerType enum: replace WALK_IN/REGULAR/HOSPITAL with RETAIL
-- Step 1: Add RETAIL to the existing enum
ALTER TYPE "CustomerType" ADD VALUE IF NOT EXISTS 'RETAIL';
