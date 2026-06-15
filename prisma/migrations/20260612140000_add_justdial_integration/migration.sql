-- Just Dial leads integration: mirror of IndiaMART. New enum values for the
-- integration provider and the lead source.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'JUSTDIAL';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'JUSTDIAL';
