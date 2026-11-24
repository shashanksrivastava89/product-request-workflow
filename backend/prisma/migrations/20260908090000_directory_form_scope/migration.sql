-- Record which flow a requester directory row belongs to, so Return people stop appearing in
-- Sample Ordering.
--
-- Vidhi Parsons, 8 Sep: Damian Diggin was selectable in the Sample Ordering requester dropdown.
-- "return scope should not hamper Sample Ordering scope (from approval matrix PoV too). We should
-- not merge the two worlds."
--
-- Why it happened: Sample and Return share one `requesters` / `requester_groups` directory with no
-- column saying which flow a row serves. The Return sync creates groups coded `ret-…` and carries a
-- business unit of CDG or LSG, which is exactly the pool the sample wizard queries.
--
-- The consequence was not cosmetic. Choosing such a person on a ZSAM form finds no row in
-- zsamm_approval_mapping, so the chain silently falls through to the user hierarchy — a sample order
-- built with the wrong approvers and no error.
--
-- NULL means "visible to both flows", which keeps every existing sample row behaving exactly as it
-- does today and makes this migration non-breaking. Only Return-only rows are marked.

ALTER TABLE "requester_groups" ADD COLUMN IF NOT EXISTS "form_scope" TEXT;
ALTER TABLE "requesters"      ADD COLUMN IF NOT EXISTS "form_scope" TEXT;

CREATE INDEX IF NOT EXISTS "requester_groups_form_scope_idx" ON "requester_groups"("form_scope");
CREATE INDEX IF NOT EXISTS "requesters_form_scope_idx"       ON "requesters"("form_scope");

-- Backfill, derived from the live data rather than assumed.
--
-- The six `ret-…` groups are Return-only. Deliberately NOT marked are the thirteen sales teams the
-- return matrix shares with Sample (CHUGOKU/SHIKOKU -> cdg-2, DA1 -> cdg-3, KINKI -> cdg-12 and so
-- on): those hold sample requester rows that were matched by name, and those people genuinely raise
-- both kinds of request. Marking them would break Sample.
UPDATE "requester_groups" SET "form_scope" = 'RETURN' WHERE "code" LIKE 'ret-%';

-- Every requester inside a Return-only group, whatever its own code. The prefix alone is not a
-- reliable test: ret-cdg-customer-service holds three `ret-` rows and one coded 'TBD'.
UPDATE "requesters" r SET "form_scope" = 'RETURN'
  FROM "requester_groups" g
 WHERE g."id" = r."requesterGroupId"
   AND g."form_scope" = 'RETURN';

-- Plus any row the Return tooling created elsewhere: `ret-` from the sync,
-- `adm-` from saving a RETURN approval-mapping row in the admin UI.
UPDATE "requesters" SET "form_scope" = 'RETURN'
 WHERE "form_scope" IS NULL
   AND ("code" LIKE 'ret-%' OR "code" LIKE 'adm-%');
