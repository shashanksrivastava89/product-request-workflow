-- CreateTable
CREATE TABLE "requester_groups" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requester_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requesters" (
    "id" TEXT NOT NULL,
    "requesterGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requesters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "requester_groups_code_key" ON "requester_groups"("code");

-- CreateIndex
CREATE INDEX "requester_groups_businessUnit_idx" ON "requester_groups"("businessUnit");

-- CreateIndex
CREATE INDEX "requester_groups_isActive_idx" ON "requester_groups"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "requesters_userId_key" ON "requesters"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "requesters_requesterGroupId_name_key" ON "requesters"("requesterGroupId", "name");

-- CreateIndex
CREATE INDEX "requesters_requesterGroupId_idx" ON "requesters"("requesterGroupId");

-- CreateIndex
CREATE INDEX "requesters_code_idx" ON "requesters"("code");

-- CreateIndex
CREATE INDEX "requesters_userId_idx" ON "requesters"("userId");

-- AddForeignKey
ALTER TABLE "requesters" ADD CONSTRAINT "requesters_requesterGroupId_fkey" FOREIGN KEY ("requesterGroupId") REFERENCES "requester_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requesters" ADD CONSTRAINT "requesters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
