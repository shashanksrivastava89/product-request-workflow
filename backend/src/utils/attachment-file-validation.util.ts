/**
 * Server-side attachment validation (magic bytes + content safety).
 * Do not use client filename or Content-Type for format decisions.
 */

import {
  containsDangerousContent,
} from './file-upload-security.util';

export type AttachmentFileKind = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp';

export class AttachmentFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentFileValidationError';
  }
}

const PDF_SIGNATURE = Buffer.from('%PDF-');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87_SIGNATURE = Buffer.from('GIF87a');
const GIF89_SIGNATURE = Buffer.from('GIF89a');
const RIFF_SIGNATURE = Buffer.from('RIFF');
const WEBP_SIGNATURE = Buffer.from('WEBP');

function startsWith(buf: Buffer, sig: Buffer): boolean {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isWebp(buf: Buffer): boolean {
  if (!startsWith(buf, RIFF_SIGNATURE) || buf.length < 12) return false;
  return buf.subarray(8, 12).equals(WEBP_SIGNATURE);
}

export function attachmentExtension(kind: AttachmentFileKind): string {
  switch (kind) {
    case 'pdf':
      return '.pdf';
    case 'jpeg':
      return '.jpg';
    case 'png':
      return '.png';
    case 'gif':
      return '.gif';
    case 'webp':
      return '.webp';
    default:
      return '.bin';
  }
}

export function attachmentContentType(kind: AttachmentFileKind): string {
  switch (kind) {
    case 'pdf':
      return 'application/pdf';
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export function validateAttachmentFileBuffer(buf: Buffer): { kind: AttachmentFileKind } {
  if (!buf?.length) {
    throw new AttachmentFileValidationError('Empty file');
  }

  if (containsDangerousContent(buf)) {
    throw new AttachmentFileValidationError('File contains disallowed content');
  }

  if (startsWith(buf, PDF_SIGNATURE)) {
    return { kind: 'pdf' };
  }
  if (isJpeg(buf)) {
    return { kind: 'jpeg' };
  }
  if (startsWith(buf, PNG_SIGNATURE)) {
    return { kind: 'png' };
  }
  if (startsWith(buf, GIF87_SIGNATURE) || startsWith(buf, GIF89_SIGNATURE)) {
    return { kind: 'gif' };
  }
  if (isWebp(buf)) {
    return { kind: 'webp' };
  }

  throw new AttachmentFileValidationError(
    'Only PDF and image files (JPEG, PNG, GIF, WebP) are allowed. Upload content must match the file format.'
  );
}
