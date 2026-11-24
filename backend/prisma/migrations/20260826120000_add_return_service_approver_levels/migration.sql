-- Return approval chain gains levels 4 and 5.
--
-- Service-related returns must always finish with two service managers. The approval matrix now
-- carries them as two extra columns, populated only for non-service groups; a requester already
-- inside Service keeps the two managers in their own levels 2/3. Both columns are nullable and
-- purely additive, so existing rows and the 3-level behaviour are unaffected.
--
-- Column names are positional on purpose. Display titles come from approval_chain_config.role_label,
-- so these never need renaming when the sheet's header text is settled.

ALTER TABLE "return_approval_mapping"
  ADD COLUMN IF NOT EXISTS "fourth_approver" TEXT,
  ADD COLUMN IF NOT EXISTS "fifth_approver" TEXT;
