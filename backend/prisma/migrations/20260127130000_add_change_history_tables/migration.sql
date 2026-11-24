-- Create ChangeType enum and customer_history, product_history tables.
-- Controllers use prisma.customerHistory / prisma.productHistory; init never created these.

-- Create enum for change type (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChangeType') THEN
    CREATE TYPE "ChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE');
  END IF;
END $$;

-- Customer change history
CREATE TABLE IF NOT EXISTS "customer_history" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "businessGroup" TEXT NOT NULL,
  "firstDigit" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sapCode" TEXT NOT NULL,
  "nameJp" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "postalCode" TEXT,
  "prefecture" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL,
  "changedBy" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changeType" "ChangeType" NOT NULL,
  "changeReason" TEXT,
  "fieldChanges" JSONB,

  CONSTRAINT "customer_history_pkey" PRIMARY KEY ("id")
);

-- Product change history
CREATE TABLE IF NOT EXISTS "product_history" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "businessGroup" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sapCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "productNameLocal" TEXT NOT NULL,
  "price" DECIMAL(15,2) NOT NULL,
  "listPrice" DECIMAL(15,2) NOT NULL,
  "division" TEXT,
  "statisticsGroup" TEXT,
  "priceGroup" TEXT,
  "isActive" BOOLEAN NOT NULL,
  "changedBy" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changeType" "ChangeType" NOT NULL,
  "changeReason" TEXT,
  "fieldChanges" JSONB,

  CONSTRAINT "product_history_pkey" PRIMARY KEY ("id")
);

-- Indexes for customer_history
CREATE INDEX IF NOT EXISTS "customer_history_customerId_idx" ON "customer_history"("customerId");
CREATE INDEX IF NOT EXISTS "customer_history_changedAt_idx" ON "customer_history"("changedAt");
CREATE INDEX IF NOT EXISTS "customer_history_changedBy_idx" ON "customer_history"("changedBy");
CREATE INDEX IF NOT EXISTS "customer_history_customerId_version_idx" ON "customer_history"("customerId", "version");

-- Indexes for product_history
CREATE INDEX IF NOT EXISTS "product_history_productId_idx" ON "product_history"("productId");
CREATE INDEX IF NOT EXISTS "product_history_changedAt_idx" ON "product_history"("changedAt");
CREATE INDEX IF NOT EXISTS "product_history_changedBy_idx" ON "product_history"("changedBy");
CREATE INDEX IF NOT EXISTS "product_history_productId_version_idx" ON "product_history"("productId", "version");

-- Foreign keys for customer_history
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_history_customerId_fkey') THEN
    ALTER TABLE "customer_history" ADD CONSTRAINT "customer_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_history_changedBy_fkey') THEN
    ALTER TABLE "customer_history" ADD CONSTRAINT "customer_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Foreign keys for product_history
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_history_productId_fkey') THEN
    ALTER TABLE "product_history" ADD CONSTRAINT "product_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_history_changedBy_fkey') THEN
    ALTER TABLE "product_history" ADD CONSTRAINT "product_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
