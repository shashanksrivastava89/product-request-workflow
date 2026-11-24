-- Seed approval_chain_config (ZSAM, ZNC, ZNCCLAIM, ZINT Option B).
-- ZINT: CS/PS → RAQA → Global RAQA (> ¥1.5M), no sales-chain approval steps.
-- Idempotent: safe to re-run via ON CONFLICT.

DELETE FROM approval_chain_config WHERE form_type = 'ZINT';

DELETE FROM approval_chain_config
WHERE form_type = 'ZNCCLAIM' AND level = 5 AND mapping_field = 'globalRaqaManager';

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
  (gen_random_uuid(), 'ZSAM', 1, 'Sales Manager', 'salesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZSAM', 2, 'District Sales Manager', 'districtSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZSAM', 3, 'National Sales Manager', 'nationalSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZSAM', 4, 'Local Finance Controller', 'localFinanceController', 'AMOUNT_GT', 3000000, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZSAM', 5, 'Director, Commercial Manager', 'directorCommercialManager', 'AMOUNT_GT', 3000000, 0, NOW(), NOW()),

  (gen_random_uuid(), 'ZNC', 1, 'Sales Manager', 'salesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 2, 'District Sales Manager', 'districtSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 3, 'National Sales Manager', 'nationalSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 4, 'Technical Manager', 'technicalManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 5, 'National TS Manager', 'nationalTSManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 6, 'Local Finance Controller', 'localFinanceController', 'AMOUNT_GT', 3000000, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNC', 7, 'Director, Commercial Manager', 'directorCommercialManager', 'AMOUNT_GT', 3000000, 0, NOW(), NOW()),

  (gen_random_uuid(), 'ZNCCLAIM', 1, 'Sales Manager', 'salesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNCCLAIM', 2, 'District Sales Manager', 'districtSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNCCLAIM', 3, 'National Sales Manager', 'nationalSalesManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNCCLAIM', 4, 'CS/PS Manager', 'csPsManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNCCLAIM', 5, 'RAQA Manager', 'raqaManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZNCCLAIM', 6, 'Global RAQA Manager', 'globalRaqaManager', 'AMOUNT_GT', 1500000, 0, NOW(), NOW()),

  (gen_random_uuid(), 'ZINT', 1, 'CS/PS Manager', 'csPsManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZINT', 2, 'RAQA Manager', 'raqaManager', 'ALWAYS', NULL, 0, NOW(), NOW()),
  (gen_random_uuid(), 'ZINT', 3, 'Global RAQA Manager', 'globalRaqaManager', 'AMOUNT_GT', 1500000, 0, NOW(), NOW())
ON CONFLICT (form_type, level, mapping_field) DO UPDATE SET
  role_label = EXCLUDED.role_label,
  condition_type = EXCLUDED.condition_type,
  amount_value = EXCLUDED.amount_value,
  sort_order = EXCLUDED.sort_order,
  "updatedAt" = NOW();
