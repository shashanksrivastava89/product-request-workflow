-- ZSAM: add businessUnit (composite unique with requesterName)
ALTER TABLE "zsamm_approval_mapping" ADD COLUMN IF NOT EXISTS "businessUnit" TEXT NOT NULL DEFAULT '';

-- Normalize NULL businessUnit to empty string
UPDATE "znc_approval_mapping" SET "businessUnit" = '' WHERE "businessUnit" IS NULL;
UPDATE "zncclaim_approval_mapping" SET "businessUnit" = '' WHERE "businessUnit" IS NULL;
UPDATE "zint_approval_mapping" SET "businessUnit" = '' WHERE "businessUnit" IS NULL;

ALTER TABLE "znc_approval_mapping" ALTER COLUMN "businessUnit" SET NOT NULL;
ALTER TABLE "znc_approval_mapping" ALTER COLUMN "businessUnit" SET DEFAULT '';
ALTER TABLE "zncclaim_approval_mapping" ALTER COLUMN "businessUnit" SET NOT NULL;
ALTER TABLE "zncclaim_approval_mapping" ALTER COLUMN "businessUnit" SET DEFAULT '';
ALTER TABLE "zint_approval_mapping" ALTER COLUMN "businessUnit" SET NOT NULL;
ALTER TABLE "zint_approval_mapping" ALTER COLUMN "businessUnit" SET DEFAULT '';

-- Drop old single-column uniqueness: Prisma may use CONSTRAINT and/or UNIQUE INDEX (same name).
ALTER TABLE "znc_approval_mapping" DROP CONSTRAINT IF EXISTS "znc_approval_mapping_requesterName_key";
ALTER TABLE "zncclaim_approval_mapping" DROP CONSTRAINT IF EXISTS "zncclaim_approval_mapping_requesterName_key";
ALTER TABLE "zint_approval_mapping" DROP CONSTRAINT IF EXISTS "zint_approval_mapping_requesterName_key";
ALTER TABLE "zsamm_approval_mapping" DROP CONSTRAINT IF EXISTS "zsamm_approval_mapping_requesterName_key";
DROP INDEX IF EXISTS "znc_approval_mapping_requesterName_key";
DROP INDEX IF EXISTS "zncclaim_approval_mapping_requesterName_key";
DROP INDEX IF EXISTS "zint_approval_mapping_requesterName_key";
DROP INDEX IF EXISTS "zsamm_approval_mapping_requesterName_key";

-- National account: tag existing Installation rows as CDG (NSM already Cortez in DB)
UPDATE "znc_approval_mapping"
SET "businessUnit" = 'CDG', "updatedAt" = CURRENT_TIMESTAMP
WHERE "requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA');

INSERT INTO "znc_approval_mapping" (
    "id", "requesterName", "businessUnit", "salesManager", "districtSalesManager", "nationalSalesManager",
    "technical_manager", "national_ts_manager", "local_finance_controller", "director_commercial_manager",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    m."requesterName",
    'LSG',
    m."salesManager",
    m."districtSalesManager",
    'AILIS DEELEY',
    m."technical_manager",
    m."national_ts_manager",
    m."local_finance_controller",
    m."director_commercial_manager",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "znc_approval_mapping" m
WHERE m."requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA')
  AND m."businessUnit" = 'CDG';

-- Claim: CDG national → Cortez; add LSG rows with Deeley
UPDATE "zncclaim_approval_mapping"
SET
    "businessUnit" = 'CDG',
    "nationalSalesManager" = 'CAILUM CORTEZ',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA');

INSERT INTO "zncclaim_approval_mapping" (
    "id", "requesterName", "businessUnit", "salesManager", "districtSalesManager", "nationalSalesManager",
    "cs_ps_manager", "raqa_manager", "global_raqa_manager", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    m."requesterName",
    'LSG',
    m."salesManager",
    m."districtSalesManager",
    'AILIS DEELEY',
    m."cs_ps_manager",
    m."raqa_manager",
    m."global_raqa_manager",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "zncclaim_approval_mapping" m
WHERE m."requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA')
  AND m."businessUnit" = 'CDG';

-- ZSAM: CDG national → Cortez; add LSG rows with Deeley
UPDATE "zsamm_approval_mapping"
SET
    "businessUnit" = 'CDG',
    "nationalSalesManager" = 'CAILUM CORTEZ',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA');

INSERT INTO "zsamm_approval_mapping" (
    "id", "requesterName", "businessUnit", "salesManager", "districtSalesManager", "nationalSalesManager",
    "localFinanceController", "directorCommercialManager", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    m."requesterName",
    'LSG',
    m."salesManager",
    m."districtSalesManager",
    'AILIS DEELEY',
    m."localFinanceController",
    m."directorCommercialManager",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "zsamm_approval_mapping" m
WHERE m."requesterName" IN ('YAGNESH RAU', 'MAYA MCCORMICK', 'GEOFFREY BHATTACHARYYA')
  AND m."businessUnit" = 'CDG';

-- Composite unique indexes
CREATE UNIQUE INDEX "znc_approval_mapping_requesterName_businessUnit_key" ON "znc_approval_mapping"("requesterName", "businessUnit");
CREATE UNIQUE INDEX "zncclaim_approval_mapping_requesterName_businessUnit_key" ON "zncclaim_approval_mapping"("requesterName", "businessUnit");
CREATE UNIQUE INDEX "zint_approval_mapping_requesterName_businessUnit_key" ON "zint_approval_mapping"("requesterName", "businessUnit");
CREATE UNIQUE INDEX "zsamm_approval_mapping_requesterName_businessUnit_key" ON "zsamm_approval_mapping"("requesterName", "businessUnit");
