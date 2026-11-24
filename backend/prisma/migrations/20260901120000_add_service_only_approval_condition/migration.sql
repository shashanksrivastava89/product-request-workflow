-- Add SERVICE_ONLY to ApprovalCondition.
--
-- RETURN approval levels 4 and 5 are the two service managers and apply to service-related returns
-- only. Every condition available before this (ALWAYS, AMOUNT_LTE, AMOUNT_GT) would have applied
-- them to ordinary returns too, which is why seed_return_approval_chain_config.sql deliberately
-- left those two levels unseeded. This is the condition they were waiting for.
--
-- Its own migration because ALTER TYPE ... ADD VALUE must commit before the value can be used in
-- a later statement — same reason 20260721120000_add_return_form_type stands alone.
ALTER TYPE "ApprovalCondition" ADD VALUE IF NOT EXISTS 'SERVICE_ONLY';
