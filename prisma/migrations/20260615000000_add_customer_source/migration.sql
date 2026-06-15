-- Optional acquisition source on Customer (Walk-in, Referral, IndiaMART, …).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "source" TEXT;
