-- CreateTable
CREATE TABLE "form_attachments" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "client_filename" TEXT NOT NULL,
    "file_kind" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_attachments_form_id_idx" ON "form_attachments"("form_id");

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "sales_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
