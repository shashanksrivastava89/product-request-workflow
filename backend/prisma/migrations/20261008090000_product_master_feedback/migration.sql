-- Product master, 8 Oct 2026 feedback round.
--
-- 1. The list-price rule of 27 Aug ("list price 0 or 1 = do not use this code") is applied to the
--    rows already stored: active ones are removed (with a history row each), inactive ones are
--    marked removed, and a removed product is hidden everywhere from now on.
-- 2. Versions: every applied sync gets a number, and the file it was made from is kept, so an
--    earlier version can be downloaded and restored.
-- 3. A width-insensitive search key, kept by a trigger, so ﾘｸｲﾁｪｯｸ and リクイチェック find the same
--    product. normalize() needs PostgreSQL 13+ on a UTF8 database (local 15, UAT 17, prod 18).

-- AlterTable
ALTER TABLE "product_catalog" ADD COLUMN     "searchText" TEXT;

-- AlterTable
ALTER TABLE "product_sync_runs" ADD COLUMN     "note" TEXT,
ADD COLUMN     "restoredFromRunId" TEXT,
ADD COLUMN     "version" INTEGER;

-- AlterTable
ALTER TABLE "product_sync_run_rows" ADD COLUMN     "holdKind" TEXT;

-- CreateTable
CREATE TABLE "product_sync_files" (
    "runId" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_sync_files_pkey" PRIMARY KEY ("runId")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_sync_runs_version_key" ON "product_sync_runs"("version");

-- AddForeignKey
ALTER TABLE "product_sync_files" ADD CONSTRAINT "product_sync_files_runId_fkey" FOREIGN KEY ("runId") REFERENCES "product_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Number the versions applied before this release, in the order they were applied. Their files
-- were never kept, so they can be listed but not restored.
WITH v AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "finishedAt", "startedAt", "id") AS n
    FROM "product_sync_runs"
    WHERE "status" = 'APPLIED' AND "mode" = 'full-snapshot'
)
UPDATE "product_sync_runs" r SET "version" = v.n FROM v WHERE v."id" = r."id";

-- Remove the active products whose list price is 0 or 1. One history row each, signed by the sync's
-- system user, so the change is on record like any other removal.
WITH sys AS (
    SELECT "id" FROM "users" WHERE "email" = 'product-sync@system.local'
),
gone AS (
    SELECT * FROM "product_catalog" WHERE "isActive" AND "listPrice" IN (0, 1)
),
hv AS (
    SELECT "productId", MAX("version") AS v FROM "product_history"
    WHERE "productId" IN (SELECT "id" FROM gone)
    GROUP BY "productId"
)
INSERT INTO "product_history" (
    "id", "productId", "version", "businessGroup", "code", "sapCode", "name", "productNameLocal",
    "price", "listPrice", "division", "statisticsGroup", "priceGroup", "isActive",
    "changedBy", "changedAt", "changeType", "changeReason", "fieldChanges"
)
SELECT gen_random_uuid()::text, g."id", COALESCE(hv.v, 0) + 1, g."businessGroup", g."code", g."sapCode",
       g."name", g."productNameLocal", g."price", g."listPrice", g."division", g."statisticsGroup",
       g."priceGroup", false, sys."id", CURRENT_TIMESTAMP, 'DELETE'::"ChangeType",
       'Removed: a list price of 0 or 1 means "do not use this code" (master data rule of 27 Aug 2026)',
       '[{"field":"isActive","oldValue":true,"newValue":false}]'::jsonb
FROM gone g
CROSS JOIN sys
LEFT JOIN hv ON hv."productId" = g."id";

UPDATE "product_catalog"
SET "isActive" = false,
    "retiredBySync" = true,
    "updatedBy" = (SELECT "id" FROM "users" WHERE "email" = 'product-sync@system.local'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" AND "listPrice" IN (0, 1);

-- Inactive products at 0 or 1 were switched off by the same rule on 28 Aug, not by a person: they
-- are removed products, hidden like the rest.
UPDATE "product_catalog"
SET "retiredBySync" = true
WHERE NOT "isActive" AND "listPrice" IN (0, 1) AND NOT "retiredBySync";

-- The search key. The trigger keeps it right for every writer (the sync's raw SQL, the admin
-- screens, rollbacks), so no code path has to remember it.
CREATE OR REPLACE FUNCTION "product_catalog_search_text"() RETURNS trigger AS $$
BEGIN
    NEW."searchText" := lower(normalize(concat_ws(' ', NEW."code", NEW."sapCode", NEW."name", NEW."productNameLocal"), NFKC));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "product_catalog_search_text"
BEFORE INSERT OR UPDATE OF "code", "sapCode", "name", "productNameLocal" ON "product_catalog"
FOR EACH ROW EXECUTE FUNCTION "product_catalog_search_text"();

UPDATE "product_catalog"
SET "searchText" = lower(normalize(concat_ws(' ', "code", "sapCode", "name", "productNameLocal"), NFKC));
