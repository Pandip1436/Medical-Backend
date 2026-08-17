-- Multi-phone support for customers and suppliers.
--
-- `phone` stays exactly as it is: the PRIMARY number, and the column every read
-- path in the app already selects. `phones` holds the full list; the entry
-- flagged primary is mirrored back into `phone` on every write.

ALTER TABLE "Customer" ADD COLUMN "phones" JSONB;
ALTER TABLE "Supplier" ADD COLUMN "phones" JSONB;

-- Backfill so existing rows open with a populated list instead of an empty one,
-- and so the `alternatePhone` values already captured survive the move. The
-- alternate is skipped when it is the same number as `phone` (same digits,
-- whatever the formatting) — duplicates in the list would be dropped anyway.
-- Label follows the same rule as the application: a 10-digit number starting
-- 6-9 is a mobile, anything else is treated as a landline.

UPDATE "Customer" c
SET "phones" =
  jsonb_build_array(
    jsonb_build_object(
      'number', btrim(c."phone"),
      'label', CASE WHEN regexp_replace(c."phone", '\D', '', 'g') ~ '^[6-9][0-9]{9}$'
                    THEN 'MOBILE' ELSE 'LANDLINE' END,
      'isPrimary', true
    )
  )
  ||
  CASE
    WHEN btrim(coalesce(c."alternatePhone", '')) = '' THEN '[]'::jsonb
    WHEN regexp_replace(coalesce(c."alternatePhone", ''), '\D', '', 'g')
       = regexp_replace(coalesce(c."phone", ''), '\D', '', 'g') THEN '[]'::jsonb
    ELSE jsonb_build_array(
      jsonb_build_object(
        'number', btrim(c."alternatePhone"),
        'label', CASE WHEN regexp_replace(c."alternatePhone", '\D', '', 'g') ~ '^[6-9][0-9]{9}$'
                      THEN 'MOBILE' ELSE 'LANDLINE' END,
        'isPrimary', false
      )
    )
  END
WHERE c."phones" IS NULL
  AND btrim(coalesce(c."phone", '')) <> '';

UPDATE "Supplier" s
SET "phones" =
  jsonb_build_array(
    jsonb_build_object(
      'number', btrim(s."phone"),
      'label', CASE WHEN regexp_replace(s."phone", '\D', '', 'g') ~ '^[6-9][0-9]{9}$'
                    THEN 'MOBILE' ELSE 'LANDLINE' END,
      'isPrimary', true
    )
  )
  ||
  CASE
    WHEN btrim(coalesce(s."alternatePhone", '')) = '' THEN '[]'::jsonb
    WHEN regexp_replace(coalesce(s."alternatePhone", ''), '\D', '', 'g')
       = regexp_replace(coalesce(s."phone", ''), '\D', '', 'g') THEN '[]'::jsonb
    ELSE jsonb_build_array(
      jsonb_build_object(
        'number', btrim(s."alternatePhone"),
        'label', CASE WHEN regexp_replace(s."alternatePhone", '\D', '', 'g') ~ '^[6-9][0-9]{9}$'
                      THEN 'MOBILE' ELSE 'LANDLINE' END,
        'isPrimary', false
      )
    )
  END
WHERE s."phones" IS NULL
  AND btrim(coalesce(s."phone", '')) <> '';
