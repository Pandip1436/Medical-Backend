-- Add PURCHASE_ENTRY to the ApprovalType enum (near-expiry GRN admin approval).
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'PURCHASE_ENTRY';
