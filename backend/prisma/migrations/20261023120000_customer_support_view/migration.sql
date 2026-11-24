-- Customer Service view: the read-only "all requests" pages on top of the primary role. A flag, like
-- is_service_admin, because the five Customer Service members raise returns as REQUESTERs since
-- 23 Oct 2026: the CUSTOMER_SUPPORT role alone cannot submit, REQUESTER alone cannot see every request.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_customer_support" BOOLEAN NOT NULL DEFAULT false;
