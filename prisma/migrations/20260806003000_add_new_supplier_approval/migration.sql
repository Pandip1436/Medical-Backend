-- New supplier raised by an Inventory Manager needs admin approval.
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'NEW_SUPPLIER';
