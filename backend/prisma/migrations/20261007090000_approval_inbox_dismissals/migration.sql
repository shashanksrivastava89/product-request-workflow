-- An approver's "Delete" on a rejected request in their inbox: per person, hides that rejection
-- from their inbox only. Nothing else about the request changes.

-- CreateTable
CREATE TABLE "approval_inbox_dismissals" (
    "id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_inbox_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_inbox_dismissals_user_id_idx" ON "approval_inbox_dismissals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_inbox_dismissals_approval_id_user_id_key" ON "approval_inbox_dismissals"("approval_id", "user_id");

-- AddForeignKey
ALTER TABLE "approval_inbox_dismissals" ADD CONSTRAINT "approval_inbox_dismissals_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_inbox_dismissals" ADD CONSTRAINT "approval_inbox_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
