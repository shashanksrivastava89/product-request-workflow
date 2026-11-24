/**
 * After multer: validate upload bytes, write to disk with a server-controlled name.
 */
import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { AppError } from './error.middleware';
import { AuthRequest } from './auth.middleware';
import {
  ImportFileValidationError,
  sanitizeClientFilename,
  validateImportFileBuffer,
} from '../utils/import-file-validation.util';
import { IMPORT_UPLOAD_DIR } from './upload.middleware';

export const validateImportUpload = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void => {
  const multerFile = req.file;
  if (!multerFile?.buffer) {
    // A chunked upload carries `uploadId` instead of a file; its bytes were already magic-byte
    // checked when the chunks were stitched, so the controller resolves the staged file itself.
    if (String((req.body as { uploadId?: unknown } | undefined)?.uploadId ?? '').trim()) {
      next();
      return;
    }
    next(new AppError('No file uploaded. Use multipart field "file".', 400));
    return;
  }
  const file = multerFile;

  let kind: 'xlsx' | 'csv';
  try {
    ({ kind } = validateImportFileBuffer(file.buffer));
  } catch (err) {
    const message =
      err instanceof ImportFileValidationError
        ? err.message
        : 'Invalid upload file';
    next(new AppError(message, 400));
    return;
  }

  const ext = kind === 'xlsx' ? '.xlsx' : '.csv';
  const filename = `import-${randomUUID()}${ext}`;
  const destPath = path.join(IMPORT_UPLOAD_DIR, filename);

  try {
    fs.writeFileSync(destPath, file.buffer, { mode: 0o600 });
  } catch {
    next(new AppError('Failed to store upload temporarily', 500));
    return;
  }

  const clientName = sanitizeClientFilename(file.originalname || 'upload');
  file.path = destPath;
  file.filename = filename;
  file.destination = IMPORT_UPLOAD_DIR;
  file.size = file.buffer.length;
  req.importFileKind = kind;
  req.importClientFilename = clientName;

  next();
};
