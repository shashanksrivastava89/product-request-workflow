-- Product master sync (Phase 1: the Power BI export uploaded by hand, diffed and applied as a run).
--
-- product_catalog gains the two informational Power BI columns, a source marker and the
-- retired-by-sync flag; product_history gains the run id and a real uniqueness guarantee on
-- (productId, version); two new tables hold each run and its rows. The system user that signs
-- sync-written history rows is created here because product_history.changedBy is a foreign key.
-- Everything is additive, so existing requests and admin screens keep working unchanged.

-- AlterTable
ALTER TABLE "product_catalog" ADD COLUMN     "dchain" TEXT,
ADD COLUMN     "retiredBySync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceFlag" TEXT,
ADD COLUMN     "sourceSystem" TEXT;

-- A row created by hand in the app carries createdBy; imports and scripts never set it. The sync
-- never retires a manual row, so the distinction has to exist before the first run.
UPDATE "product_catalog"
SET "sourceSystem" = CASE WHEN "createdBy" IS NOT NULL THEN 'manual' ELSE 'import' END
WHERE "sourceSystem" IS NULL;

-- AlterTable
ALTER TABLE "product_history" ADD COLUMN     "syncRunId" TEXT;

-- The per-row "max(version) + 1" in trackProductChange was never serialised, so two admin actions on
-- one product in the same instant could share a version. Renumber any such product by time order
-- before the unique index below is created, so the migration cannot fail on an environment that
-- already has a repeat.
WITH dup AS (
    SELECT "productId" FROM "product_history" GROUP BY "productId", "version" HAVING COUNT(*) > 1
),
ranked AS (
    SELECT h."id", ROW_NUMBER() OVER (PARTITION BY h."productId" ORDER BY h."version", h."changedAt", h."id") AS rn
    FROM "product_history" h
    WHERE h."productId" IN (SELECT "productId" FROM dup)
)
UPDATE "product_history" h SET "version" = r.rn FROM ranked r WHERE r."id" = h."id" AND h."version" <> r.rn;

-- DropIndex
DROP INDEX "product_history_productId_version_idx";

-- CreateIndex
CREATE UNIQUE INDEX "product_history_productId_version_key" ON "product_history"("productId", "version");

-- CreateIndex
CREATE INDEX "product_history_syncRunId_idx" ON "product_history"("syncRunId");

-- CreateTable
CREATE TABLE "product_sync_runs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "appliedFilter" TEXT,
    "fingerprint" TEXT,
    "diffFingerprint" TEXT,
    "counts" JSONB,
    "guards" JSONB,
    "samples" JSONB,
    "error" TEXT,
    "guardOverrideReason" TEXT,
    "triggeredBy" TEXT,
    "triggeredByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previewedAt" TIMESTAMP(3),
    "applyStartedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sync_run_rows" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "productId" TEXT,
    "businessGroup" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sapCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productNameLocal" TEXT NOT NULL,
    "price" DECIMAL(15,2),
    "listPrice" DECIMAL(15,2),
    "priceGroup" TEXT,
    "serviceFlag" TEXT,
    "dchain" TEXT,
    "rowIndex" INTEGER,
    "reason" TEXT,
    "fieldChanges" JSONB,

    CONSTRAINT "product_sync_run_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_sync_runs_status_idx" ON "product_sync_runs"("status");

-- CreateIndex
CREATE INDEX "product_sync_runs_startedAt_idx" ON "product_sync_runs"("startedAt");

-- CreateIndex
CREATE INDEX "product_sync_run_rows_runId_action_idx" ON "product_sync_run_rows"("runId", "action");

-- CreateIndex
CREATE INDEX "product_sync_run_rows_runId_businessGroup_code_idx" ON "product_sync_run_rows"("runId", "businessGroup", "code");

-- AddForeignKey
ALTER TABLE "product_sync_run_rows" ADD CONSTRAINT "product_sync_run_rows_runId_fkey" FOREIGN KEY ("runId") REFERENCES "product_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The account the sync signs its history rows with. Inactive, so it can never sign in, and on a
-- domain SSO can never produce, so no real person can ever map onto it. The password hash is of a
-- random value that was discarded the moment it was hashed.
INSERT INTO "users" ("id", "email", "password", "name", "role", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       'product-sync@system.local',
       '$2b$10$x7osx9HTPWGj38cz4k.sHuv3RXfQnhzatZUvfQMwzU3k.sYfyH8gO',
       'SYSTEM - Product sync',
       'REQUESTER'::"UserRole",
       false,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'product-sync@system.local');
