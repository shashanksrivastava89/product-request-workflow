-- CreateTable
CREATE TABLE "zsamm_approval_mapping" (
    "id" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "salesManager" TEXT,
    "districtSalesManager" TEXT,
    "nationalSalesManager" TEXT,
    "localFinanceController" TEXT,
    "directorCommercialManager" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zsamm_approval_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zsamm_approval_mapping_requesterName_key" ON "zsamm_approval_mapping"("requesterName");

-- CreateIndex
CREATE INDEX "zsamm_approval_mapping_requesterName_idx" ON "zsamm_approval_mapping"("requesterName");
