-- Add approvalToken and tokenExpiresAt to approvals table for email-based approval links
ALTER TABLE "approvals"
  ADD COLUMN IF NOT EXISTS "approvalToken" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);

-- Create unique index for approvalToken (for secure token lookup)
CREATE UNIQUE INDEX IF NOT EXISTS "approvals_approvalToken_key" ON "approvals"("approvalToken");

-- Create index for approvalToken lookups
CREATE INDEX IF NOT EXISTS "approvals_approvalToken_idx" ON "approvals"("approvalToken");
