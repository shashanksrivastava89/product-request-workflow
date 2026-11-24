-- A rejected return can be reopened and resubmitted in place (Corlett Siobhan, 25 Sep 2026).
--
-- A form holds one approval row per level, so the resubmission cannot be routed while the rejected
-- round's rows are still there. Reopening moves that round here - every step, its decision and
-- comment, the service review's corrections, who reopened it - and clears the live rows. Nullable
-- and additive: every existing request simply has no earlier rounds.
ALTER TABLE "sales_forms" ADD COLUMN "approval_history" JSONB;
