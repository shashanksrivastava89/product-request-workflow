/**
 * Multer config for ZNC Claim form attachment uploads.
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';

/** 10 MB per attachment (photos, screenshots, PDFs) */
export const MAX_ATTACHMENT_FILE_SIZE = 10 * 1024 * 1024;

export const ATTACHMENT_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'form-attachments');

export function ensureAttachmentUploadRoot(): void {
  try {
    if (!fs.existsSync(ATTACHMENT_UPLOAD_ROOT)) {
      fs.mkdirSync(ATTACHMENT_UPLOAD_ROOT, { recursive: true });
    }
  } catch (err) {
    console.warn(
      `[upload] Could not create ${ATTACHMENT_UPLOAD_ROOT} at startup:`,
      err instanceof Error ? err.message : err
    );
  }
}

ensureAttachmentUploadRoot();

export const uploadFormAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_FILE_SIZE },
}).single('file');
