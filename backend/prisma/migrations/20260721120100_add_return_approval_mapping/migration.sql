-- Return approval mapping + chain config (1st → 2nd → Final)

CREATE TABLE IF NOT EXISTS "return_approval_mapping" (
    "id" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL DEFAULT '',
    "team_name" TEXT,
    "first_approver" TEXT,
    "second_approver" TEXT,
    "final_approver" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_approval_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_approval_mapping_requesterName_businessUnit_key"
  ON "return_approval_mapping"("requesterName", "businessUnit");

CREATE INDEX IF NOT EXISTS "return_approval_mapping_requesterName_idx"
  ON "return_approval_mapping"("requesterName");

CREATE INDEX IF NOT EXISTS "return_approval_mapping_businessUnit_idx"
  ON "return_approval_mapping"("businessUnit");

INSERT INTO approval_chain_config (
  id,
  form_type,
  level,
  role_label,
  mapping_field,
  condition_type,
  amount_value,
  sort_order,
  "createdAt",
  "updatedAt"
) VALUES
  (gen_random_uuid(), 'RETURN', 1, '1st Approver', 'firstApprover', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'RETURN', 2, '2nd Approver', 'secondApprover', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'RETURN', 3, 'Final Approver', 'finalApprover', 'ALWAYS', NULL, 0, NOW(), NOW())
ON CONFLICT (form_type, level, mapping_field) DO UPDATE SET
  role_label = EXCLUDED.role_label,
  condition_type = EXCLUDED.condition_type,
  amount_value = EXCLUDED.amount_value,
  sort_order = EXCLUDED.sort_order,
  "updatedAt" = NOW();
