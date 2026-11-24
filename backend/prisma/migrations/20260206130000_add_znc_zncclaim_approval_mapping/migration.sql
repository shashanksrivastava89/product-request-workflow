-- CreateTable
CREATE TABLE "znc_approval_mapping" (
    "id" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "businessUnit" TEXT,
    "salesManager" TEXT,
    "districtSalesManager" TEXT,
    "nationalSalesManager" TEXT,
    "technical_manager" TEXT,
    "national_ts_manager" TEXT,
    "local_finance_controller" TEXT,
    "director_commercial_manager" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "znc_approval_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zncclaim_approval_mapping" (
    "id" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "businessUnit" TEXT,
    "salesManager" TEXT,
    "districtSalesManager" TEXT,
    "nationalSalesManager" TEXT,
    "cs_ps_manager" TEXT,
    "raqa_manager" TEXT,
    "global_raqa_manager" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zncclaim_approval_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "znc_approval_mapping_requesterName_key" ON "znc_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "znc_approval_mapping_requesterName_idx" ON "znc_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "znc_approval_mapping_businessUnit_idx" ON "znc_approval_mapping"("businessUnit");

-- CreateIndex
CREATE UNIQUE INDEX "zncclaim_approval_mapping_requesterName_key" ON "zncclaim_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "zncclaim_approval_mapping_requesterName_idx" ON "zncclaim_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "zncclaim_approval_mapping_businessUnit_idx" ON "zncclaim_approval_mapping"("businessUnit");
