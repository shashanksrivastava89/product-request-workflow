-- CreateTable
CREATE TABLE "zint_approval_mapping" (
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

    CONSTRAINT "zint_approval_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zint_approval_mapping_requesterName_key" ON "zint_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "zint_approval_mapping_requesterName_idx" ON "zint_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "zint_approval_mapping_businessUnit_idx" ON "zint_approval_mapping"("businessUnit");
