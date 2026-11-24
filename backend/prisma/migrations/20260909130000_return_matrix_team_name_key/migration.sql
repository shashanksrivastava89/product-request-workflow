-- Team Name joins the row's identity, so every sheet row survives an import.
--
-- The key was (requesterName, businessUnit), which collapsed the 126-row Return matrix into 90
-- rows: 36 keys merged and 33 lost a distinct Team Name, because the Technical Service people are
-- listed under both (CDG) and (LSG) and both normalise to the SERVICE bucket. No merged key had a
-- conflicting approver chain, so routing was intact -- only the team label was lost, and an export
-- could not reproduce the sheet. Widening the key makes the round trip lossless and lets the matrix
-- hold a different chain per team, which the sheet has always been able to express.
--
-- team_name becomes NOT NULL DEFAULT '' first: in Postgres NULLs are distinct, so a nullable column
-- in a unique key would let unlimited duplicates through the very constraint meant to prevent them.

UPDATE "return_approval_mapping" SET "team_name" = '' WHERE "team_name" IS NULL;

ALTER TABLE "return_approval_mapping" ALTER COLUMN "team_name" SET DEFAULT '';
ALTER TABLE "return_approval_mapping" ALTER COLUMN "team_name" SET NOT NULL;

DROP INDEX IF EXISTS "return_approval_mapping_requesterName_businessUnit_key";

CREATE UNIQUE INDEX IF NOT EXISTS "return_approval_mapping_requesterName_businessUnit_team_name_key"
  ON "return_approval_mapping"("requesterName", "businessUnit", "team_name");

CREATE INDEX IF NOT EXISTS "return_approval_mapping_team_name_idx"
  ON "return_approval_mapping"("team_name");
