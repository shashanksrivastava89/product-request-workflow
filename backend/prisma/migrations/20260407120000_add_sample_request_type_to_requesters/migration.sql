-- Optional: limit requester to one sample request type (wizard purpose). Null = all types.
ALTER TABLE "requesters" ADD COLUMN IF NOT EXISTS "sample_request_type" TEXT;

CREATE INDEX IF NOT EXISTS "requesters_sample_request_type_idx" ON "requesters" ("sample_request_type");
