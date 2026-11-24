-- Super approver role + audit column when a super approver acts on the current step for someone else

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'SUPER_APPROVER'
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE 'SUPER_APPROVER';
  END IF;
END
$migration$;

ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "actual_actor_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "approvals_actual_actor_user_id_idx" ON "approvals"("actual_actor_user_id");

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approvals_actual_actor_user_id_fkey'
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actual_actor_user_id_fkey"
    FOREIGN KEY ("actual_actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;
