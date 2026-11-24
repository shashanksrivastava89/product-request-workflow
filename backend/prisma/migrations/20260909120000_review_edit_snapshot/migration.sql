-- Keep the request as it was before the first service-review correction.
--
-- The review trail stores field diffs as display strings and the product lines as a one-line
-- summary — enough to SHOW what changed, not enough to REBUILD the request. The review team asked
-- to be able to discard every correction and go back to exactly what the requester submitted, so
-- the first edit on a form now also carries a full snapshot (form columns, products, invoice dates).
-- Nullable and additive: existing rows are untouched.
ALTER TABLE "form_review_edits" ADD COLUMN IF NOT EXISTS "before_snapshot" JSONB;
