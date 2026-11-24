-- Additive super approver: primary role stays on `role`; flag grants super-approver API/UI access.
ALTER TABLE "users" ADD COLUMN "is_super_approver" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "is_super_approver" = true WHERE "role" = 'SUPER_APPROVER';
