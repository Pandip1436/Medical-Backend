-- Add DELIVERY to the Role enum. In PostgreSQL, ALTER TYPE ... ADD VALUE must
-- run outside a transaction block; Prisma executes migration statements
-- individually so this is safe as its own migration.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DELIVERY';
