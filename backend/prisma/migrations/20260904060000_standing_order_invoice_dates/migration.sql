-- 定期予約 / Standing orders: one request, several invoice dates.
--
-- Miriama Boreland (3 Sep) found that a single Invoice Date field forces a price adjustment spanning
-- April and May sales to be split into two requests. Damian Diggin (4 Sep) ruled that a standing
-- order should be ONE request — easier for requesters and approvers alike — with the invoice dates
-- repeatable like the product lines.
--
-- `sales_forms.invoice_date` is deliberately left in place and still populated with the FIRST date.
-- Everything that needs exactly one date (print view, emails, SAP hand-off) keeps working, and the
-- requests submitted before this change are untouched.

ALTER TABLE "sales_forms"
  ADD COLUMN IF NOT EXISTS "is_standing_order" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "form_invoice_dates" (
    "id"           TEXT NOT NULL,
    "form_id"      TEXT NOT NULL,
    "invoice_date" TEXT NOT NULL,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_invoice_dates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "form_invoice_dates_form_id_idx" ON "form_invoice_dates" ("form_id");

DO $$
BEGIN
  ALTER TABLE "form_invoice_dates"
    ADD CONSTRAINT "form_invoice_dates_form_id_fkey"
    FOREIGN KEY ("form_id") REFERENCES "sales_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed the list from the single date each existing request already carries, so a form opened after
-- this migration shows its date in the repeater rather than an empty list.
INSERT INTO "form_invoice_dates" ("id", "form_id", "invoice_date", "sort_order")
SELECT gen_random_uuid()::text, f."id", f."invoiceDate", 0
FROM   "sales_forms" f
WHERE  f."invoiceDate" IS NOT NULL
  AND  btrim(f."invoiceDate") <> ''
  AND  NOT EXISTS (SELECT 1 FROM "form_invoice_dates" d WHERE d."form_id" = f."id");
