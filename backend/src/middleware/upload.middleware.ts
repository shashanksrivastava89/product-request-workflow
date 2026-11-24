/**
 * Multer config for admin import file uploads.
 * Files are held in memory until validateImportUpload writes a validated copy to disk.
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';

/** 10 MB — bulk spreadsheets; validated before write */
export const MAX_IMPORT_FILE_SIZE = 20 * 1024 * 1024;

export const IMPORT_UPLOAD_DIR = path.join(process.cwd(), 'tmp', 'import');

/** Ensure upload dir exists (non-fatal at startup — Docker nodejs user / read-only cwd). */
export function ensureImportUploadDir(): void {
  try {
    if (!fs.existsSync(IMPORT_UPLOAD_DIR)) {
      fs.mkdirSync(IMPORT_UPLOAD_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(
      `[upload] Could not create ${IMPORT_UPLOAD_DIR} at startup:`,
      err instanceof Error ? err.message : err
    );
  }
}

ensureImportUploadDir();

export const uploadImportFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE },
}).single('file');

/**
 * One slice of a chunked import upload.
 *
 * Capped well below the whole-file limit because a chunk is sized to clear the edge's request-body
 * limit (~8KB on UAT/production); 1MB leaves room to raise the client chunk size once that limit
 * is lifted, without letting a single request carry a whole workbook.
 */
export const MAX_IMPORT_CHUNK_SIZE = 1024 * 1024;

export const uploadImportChunk = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_CHUNK_SIZE },
}).single('chunk');
