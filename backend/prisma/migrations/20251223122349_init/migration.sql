-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('REQUESTER', 'SALES_MANAGER', 'DISTRICT_SALES_MANAGER', 'NATIONAL_SALES_MANAGER', 'FINANCE_CONTROLLER', 'DIRECTOR_COMMERCIAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('CHANNEL', 'DIRECT', 'INTERNAL', 'HEIWA');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'REQUESTER',
    "businessUnit" TEXT,
    "department" TEXT,
    "salesRepCode" TEXT,
    "requesterGroupId" TEXT,
    "salesManager" TEXT,
    "districtSalesManager" TEXT,
    "nationalSalesManager" TEXT,
    "localFinanceController" TEXT,
    "directorCommercialManager" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_forms" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "formType" "FormType" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "salesRepCodeSap" TEXT,
    "businessUnit" TEXT,
    "requesterGroup" TEXT,
    "requestDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TEXT,
    "purpose" TEXT NOT NULL,
    "deliveryMode" "DeliveryMode",
    "soldToCode" TEXT,
    "soldToName" TEXT,
    "shipToCode" TEXT,
    "shipToName" TEXT,
    "endUserCode" TEXT,
    "endUserName" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "prefecture" TEXT,
    "phone" TEXT,
    "salesManager" TEXT,
    "districtSalesManager" TEXT,
    "nationalSalesManager" TEXT,
    "localFinanceController" TEXT,
    "directorCommercialManager" TEXT,
    "commentsForApproval" TEXT,
    "freeDescription" TEXT,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvalMaxLevel" INTEGER,
    "approvalFinalRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_products" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productNameLocal" TEXT,
    "sapCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "wholesalePrice" DECIMAL(15,2),
    "subtotal" DECIMAL(15,2) NOT NULL,
    "isConsumable" BOOLEAN NOT NULL DEFAULT false,
    "lotNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "approverEmail" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "comments" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "cdg_code" VARCHAR(10) NOT NULL,
    "sap_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "is_consumable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_partners" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "end_users" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "end_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_catalog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_salesRepCode_key" ON "users"("salesRepCode");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_salesRepCode_idx" ON "users"("salesRepCode");

-- CreateIndex
CREATE UNIQUE INDEX "sales_forms_referenceNumber_key" ON "sales_forms"("referenceNumber");

-- CreateIndex
CREATE INDEX "sales_forms_requesterId_idx" ON "sales_forms"("requesterId");

-- CreateIndex
CREATE INDEX "sales_forms_status_idx" ON "sales_forms"("status");

-- CreateIndex
CREATE INDEX "sales_forms_businessUnit_idx" ON "sales_forms"("businessUnit");

-- CreateIndex
CREATE INDEX "sales_forms_referenceNumber_idx" ON "sales_forms"("referenceNumber");

-- CreateIndex
CREATE INDEX "sales_forms_requestDate_idx" ON "sales_forms"("requestDate");

-- CreateIndex
CREATE INDEX "form_products_formId_idx" ON "form_products"("formId");

-- CreateIndex
CREATE INDEX "form_products_productCode_idx" ON "form_products"("productCode");

-- CreateIndex
CREATE INDEX "approvals_formId_idx" ON "approvals"("formId");

-- CreateIndex
CREATE INDEX "approvals_approverId_idx" ON "approvals"("approverId");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_formId_level_key" ON "approvals"("formId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "products_cdg_code_key" ON "products"("cdg_code");

-- CreateIndex
CREATE INDEX "products_cdg_code_idx" ON "products"("cdg_code");

-- CreateIndex
CREATE INDEX "products_sap_code_idx" ON "products"("sap_code");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE UNIQUE INDEX "channel_partners_code_key" ON "channel_partners"("code");

-- CreateIndex
CREATE INDEX "channel_partners_code_idx" ON "channel_partners"("code");

-- CreateIndex
CREATE UNIQUE INDEX "end_users_code_key" ON "end_users"("code");

-- CreateIndex
CREATE INDEX "end_users_code_idx" ON "end_users"("code");

-- CreateIndex
CREATE INDEX "product_catalog_businessGroup_idx" ON "product_catalog"("businessGroup");

-- CreateIndex
CREATE INDEX "product_catalog_code_idx" ON "product_catalog"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_catalog_businessGroup_code_key" ON "product_catalog"("businessGroup", "code");

-- CreateIndex
CREATE INDEX "customers_businessGroup_idx" ON "customers"("businessGroup");

-- CreateIndex
CREATE INDEX "customers_firstDigit_idx" ON "customers"("firstDigit");

-- CreateIndex
CREATE INDEX "customers_code_idx" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_businessGroup_firstDigit_idx" ON "customers"("businessGroup", "firstDigit");

-- AddForeignKey
ALTER TABLE "sales_forms" ADD CONSTRAINT "sales_forms_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_products" ADD CONSTRAINT "form_products_formId_fkey" FOREIGN KEY ("formId") REFERENCES "sales_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_formId_fkey" FOREIGN KEY ("formId") REFERENCES "sales_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
