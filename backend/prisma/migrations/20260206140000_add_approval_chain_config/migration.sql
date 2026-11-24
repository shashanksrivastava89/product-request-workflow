-- CreateEnum
CREATE TYPE "ApprovalCondition" AS ENUM ('ALWAYS', 'AMOUNT_LTE', 'AMOUNT_GT');

-- CreateTable
CREATE TABLE "approval_chain_config" (
    "id" TEXT NOT NULL,
    "form_type" "FormType" NOT NULL,
    "level" INTEGER NOT NULL,
    "role_label" TEXT NOT NULL,
    "mapping_field" TEXT NOT NULL,
    "condition_type" "ApprovalCondition" NOT NULL,
    "amount_value" DECIMAL(15,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_chain_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_chain_config_form_type_level_mapping_field_key" ON "approval_chain_config"("form_type", "level", "mapping_field");

-- CreateIndex
CREATE INDEX "approval_chain_config_form_type_idx" ON "approval_chain_config"("form_type");
