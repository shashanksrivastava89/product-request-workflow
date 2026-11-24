-- Add hierarchy and technical manager columns expected by current Prisma schema.
-- Init migration created users without: technical_manager, national_ts_manager, *_id FK columns.

-- Add legacy string columns for ZNC/ZNCCLAIM/ZINT (schema @map names)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "technical_manager" TEXT,
  ADD COLUMN IF NOT EXISTS "national_ts_manager" TEXT;

-- Add FK columns for approval hierarchy (schema @map names)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sales_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "district_sales_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "national_sales_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "local_finance_controller_id" TEXT,
  ADD COLUMN IF NOT EXISTS "director_commercial_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "technical_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "national_ts_manager_id" TEXT;

-- Foreign key constraints (skip if already added)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_sales_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_sales_manager_id_fkey"
      FOREIGN KEY ("sales_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_district_sales_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_district_sales_manager_id_fkey"
      FOREIGN KEY ("district_sales_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_national_sales_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_national_sales_manager_id_fkey"
      FOREIGN KEY ("national_sales_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_local_finance_controller_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_local_finance_controller_id_fkey"
      FOREIGN KEY ("local_finance_controller_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_director_commercial_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_director_commercial_manager_id_fkey"
      FOREIGN KEY ("director_commercial_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_technical_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_technical_manager_id_fkey"
      FOREIGN KEY ("technical_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_national_ts_manager_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_national_ts_manager_id_fkey"
      FOREIGN KEY ("national_ts_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes (Prisma @@index from schema)
CREATE INDEX IF NOT EXISTS "users_sales_manager_id_idx" ON "users"("sales_manager_id");
CREATE INDEX IF NOT EXISTS "users_district_sales_manager_id_idx" ON "users"("district_sales_manager_id");
CREATE INDEX IF NOT EXISTS "users_national_sales_manager_id_idx" ON "users"("national_sales_manager_id");
CREATE INDEX IF NOT EXISTS "users_local_finance_controller_id_idx" ON "users"("local_finance_controller_id");
CREATE INDEX IF NOT EXISTS "users_director_commercial_manager_id_idx" ON "users"("director_commercial_manager_id");
CREATE INDEX IF NOT EXISTS "users_technical_manager_id_idx" ON "users"("technical_manager_id");
CREATE INDEX IF NOT EXISTS "users_national_ts_manager_id_idx" ON "users"("national_ts_manager_id");
