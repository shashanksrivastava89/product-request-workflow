-- The service review step, the review-edit trail, and the SAP sales order number.
--
-- All four changes come from the 2 Sep review (Japan Automation (Return Goods)) and are additive
-- and nullable, so existing rows and all four sample form types are untouched. No enum changes, so
-- this can be one migration.

-- 1. Service Admin team membership.
--
-- A flag rather than a role, because the same people raise the requests they review: Nia Hargreaves
-- and Baljiwan Woodward are REQUESTERs. Same shape as is_super_approver, which exists for exactly this
-- "primary role plus extra powers" case.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_service_admin" BOOLEAN NOT NULL DEFAULT false;

-- 2. The reviewer named per requester in the approval matrix.
--
-- Normally a shared mailbox rather than a person, so the whole Service Admin team is notified; any
-- is_service_admin user may then action the step. Reached only through a SERVICE_ONLY row in
-- approval_chain_config, so ordinary returns never gain a review step.
ALTER TABLE "return_approval_mapping"
  ADD COLUMN IF NOT EXISTS "reviewer" TEXT;

-- 3. SAP sales order number for the credit/debit memo.
--
-- Entered by the Service Admin team after every approval is in. Service returns only: Emi confirmed
-- CS does not need it because they read the order numbers from the SAP document flow, and asked to
-- "minimize manual input, especially after approval has been completed".
ALTER TABLE "sales_forms"
  ADD COLUMN IF NOT EXISTS "salesOrderNumber" TEXT;

-- 4. What a reviewer changed, so approvers further down can see it.
--
-- The reviewer may correct a request somebody else raised — that is the point of the step — but an
-- approver must be able to tell that it happened and what moved, or they would be signing off
-- something the requester never submitted. field_changes follows product_history.fieldChanges.
CREATE TABLE IF NOT EXISTS "form_review_edits" (
  "id"            TEXT         NOT NULL,
  "form_id"       TEXT         NOT NULL,
  "changed_by_id" TEXT         NOT NULL,
  "changed_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "field_changes" JSONB        NOT NULL,
  CONSTRAINT "form_review_edits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "form_review_edits_form_id_idx"
  ON "form_review_edits" ("form_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_review_edits_form_id_fkey') THEN
    ALTER TABLE "form_review_edits"
      ADD CONSTRAINT "form_review_edits_form_id_fkey"
      FOREIGN KEY ("form_id") REFERENCES "sales_forms" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_review_edits_changed_by_id_fkey') THEN
    ALTER TABLE "form_review_edits"
      ADD CONSTRAINT "form_review_edits_changed_by_id_fkey"
      FOREIGN KEY ("changed_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
