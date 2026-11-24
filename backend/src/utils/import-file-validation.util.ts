/**
 * Server-side import upload validation (magic bytes + content safety).
 * Do not use client filename or Content-Type for format decisions.
 */

import {
  containsDangerousContent,
  sanitizeClientFilename,
} from './file-upload-security.util';

export type ImportFileKind = 'xlsx' | 'csv';

export { sanitizeClientFilename };

const OOXML_ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK..
const SCAN_BYTES = 8192;

export class ImportFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileValidationError';
  }
}

function scanLength(buf: Buffer): number {
  return Math.min(buf.length, SCAN_BYTES);
}

function isOoxmlZip(buf: Buffer): boolean {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(OOXML_ZIP_SIGNATURE)) {
    return false;
  }
  const head = buf.subarray(0, Math.min(buf.length, 65536));
  const bin = head.toString('latin1');
  return bin.includes('[Content_Types].xml') || bin.includes('xl/');
}

function isAcceptableCsv(buf: Buffer): boolean {
  if (buf.includes(0)) {
    return false;
  }
  const sample = buf.subarray(0, scanLength(buf));
  const text = sample.toString('utf8');
  if (text.includes('\uFFFD') && buf.length > 64) {
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad > sample.length * 0.05) {
      return false;
    }
  }
  return true;
}

export function validateImportFileBuffer(buf: Buffer): { kind: ImportFileKind } {
  if (!buf?.length) {
    throw new ImportFileValidationError('Empty file');
  }

  if (containsDangerousContent(buf)) {
    throw new ImportFileValidationError('File contains disallowed content');
  }

  if (isOoxmlZip(buf)) {
    return { kind: 'xlsx' };
  }

  if (isAcceptableCsv(buf)) {
    return { kind: 'csv' };
  }

  throw new ImportFileValidationError(
    'Only valid Excel (.xlsx) or CSV files are allowed. Upload content must match the file format (ZIP/OOXML for Excel).'
  );
}
