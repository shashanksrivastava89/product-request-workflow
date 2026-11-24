-- Persist what a return request collects, so RETURN can be submitted.
--
-- Until now the return wizard validated in the browser and stopped: sales_forms had no column for
-- anything a return asks for beyond the shared header, and form_products had nowhere to put the
-- credit and re-bill amounts. Every column here is additive and nullable (isService defaults to
-- false), so existing rows and all four sample form types are untouched.
--
-- On sales_forms rather than a return side table: approval emails, the approval pages and the
-- admin export all read sales_forms directly, and a side table would mean teaching each of them a
-- join. This mirrors how ZNC/ZINT-specific fields already ride along on the same model.

ALTER TABLE "sales_forms"
  ADD COLUMN IF NOT EXISTS "returnType"           TEXT,
  ADD COLUMN IF NOT EXISTS "isService"            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "originalOrderNumber"  TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceDate"          TEXT,
  ADD COLUMN IF NOT EXISTS "quoteRefNo"           TEXT,
  ADD COLUMN IF NOT EXISTS "orderReason"          TEXT,
  ADD COLUMN IF NOT EXISTS "justification"        TEXT,
  ADD COLUMN IF NOT EXISTS "dairitenContactName"  TEXT,
  ADD COLUMN IF NOT EXISTS "dairitenContactEmail" TEXT;

-- returnAmount is the credit for the line, rebillAmount what is charged again. Both start at the
-- catalogue line total but the requester may overwrite either, so neither can be derived from
-- subtotal after the fact.
ALTER TABLE "form_products"
  ADD COLUMN IF NOT EXISTS "returnAmount" DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS "rebillAmount" DECIMAL(15, 2);
