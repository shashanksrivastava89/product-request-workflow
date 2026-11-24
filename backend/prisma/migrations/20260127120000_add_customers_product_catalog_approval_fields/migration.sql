-- Add approval workflow and audit fields to customers and product_catalog.
-- Schema expects status, isActive, submittedBy, approvedBy, etc.; init migration did not create them.

-- Create enum for master data status (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MasterDataStatus') THEN
    CREATE TYPE "MasterDataStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
  END IF;
END $$;

-- Customers: add isActive and approval/audit columns
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "status" "MasterDataStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN IF NOT EXISTS "submittedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- Change address to TEXT if it exists as varchar (schema has @db.Text)
-- Skip if already correct; init may have created as TEXT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'address') THEN
    ALTER TABLE "customers" ALTER COLUMN "address" TYPE TEXT USING "address"::TEXT;
  END IF;
END $$;

-- Product catalog: add isActive and approval/audit columns
ALTER TABLE "product_catalog"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "status" "MasterDataStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN IF NOT EXISTS "submittedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- Indexes for customers
CREATE INDEX IF NOT EXISTS "customers_isActive_idx" ON "customers"("isActive");
CREATE INDEX IF NOT EXISTS "customers_status_idx" ON "customers"("status");
CREATE INDEX IF NOT EXISTS "customers_submittedBy_idx" ON "customers"("submittedBy");
CREATE INDEX IF NOT EXISTS "customers_approvedBy_idx" ON "customers"("approvedBy");

-- Indexes for product_catalog
CREATE INDEX IF NOT EXISTS "product_catalog_isActive_idx" ON "product_catalog"("isActive");
CREATE INDEX IF NOT EXISTS "product_catalog_status_idx" ON "product_catalog"("status");
CREATE INDEX IF NOT EXISTS "product_catalog_submittedBy_idx" ON "product_catalog"("submittedBy");
CREATE INDEX IF NOT EXISTS "product_catalog_approvedBy_idx" ON "product_catalog"("approvedBy");

-- Foreign keys for customers (skip if exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_createdBy_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_updatedBy_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_submittedBy_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_approvedBy_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_rejectedBy_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Foreign keys for product_catalog (skip if exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalog_createdBy_fkey') THEN
    ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalog_updatedBy_fkey') THEN
    ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalog_submittedBy_fkey') THEN
    ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalog_approvedBy_fkey') THEN
    ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_catalog_rejectedBy_fkey') THEN
    ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
