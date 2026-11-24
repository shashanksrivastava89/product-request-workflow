/**
 * Persistent storage and DB operations for ZNC Claim form attachments.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  attachmentContentType,
  attachmentExtension,
  AttachmentFileKind,
  validateAttachmentFileBuffer,
  AttachmentFileValidationError,
} from '../utils/attachment-file-validation.util';
import { ATTACHMENT_UPLOAD_ROOT } from '../middleware/upload-attachment.middleware';

const prisma = new PrismaClient();

export const MAX_ATTACHMENTS_PER_FORM = 3;

export interface FormAttachmentMeta {
  id: string;
  formId: string;
  clientFilename: string;
  fileKind: AttachmentFileKind;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

/** Display name shown to users (not the uploader's original filename). */
function buildDocumentDisplayName(index: number, kind: AttachmentFileKind): string {
  return `Document ${index}${attachmentExtension(kind)}`;
}

async function renumberFormAttachmentDisplayNames(formId: string): Promise<void> {
  const rows = await prisma.formAttachment.findMany({
    where: { formId },
    orderBy: { createdAt: 'asc' },
  });
  for (let i = 0; i < rows.length; i++) {
    const nextName = buildDocumentDisplayName(i + 1, rows[i].fileKind as AttachmentFileKind);
    if (rows[i].clientFilename !== nextName) {
      await prisma.formAttachment.update({
        where: { id: rows[i].id },
        data: { clientFilename: nextName },
      });
    }
  }
}

function formAttachmentDir(formId: string): string {
  return path.join(ATTACHMENT_UPLOAD_ROOT, formId);
}

function attachmentDiskPath(formId: string, storedFilename: string): string {
  return path.join(formAttachmentDir(formId), storedFilename);
}

function mapRow(row: {
  id: string;
  formId: string;
  clientFilename: string;
  fileKind: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: Date;
}): FormAttachmentMeta {
  return {
    id: row.id,
    formId: row.formId,
    clientFilename: row.clientFilename,
    fileKind: row.fileKind as AttachmentFileKind,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function countFormAttachments(formId: string): Promise<number> {
  return prisma.formAttachment.count({ where: { formId } });
}

export async function listFormAttachments(formId: string): Promise<FormAttachmentMeta[]> {
  const rows = await prisma.formAttachment.findMany({
    where: { formId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(mapRow);
}

export async function findFormAttachmentById(
  attachmentId: string
): Promise<(FormAttachmentMeta & { storedFilename: string }) | null> {
  const row = await prisma.formAttachment.findUnique({ where: { id: attachmentId } });
  if (!row) return null;
  return { ...mapRow(row), storedFilename: row.storedFilename };
}

export async function saveFormAttachment(params: {
  formId: string;
  buffer: Buffer;
  uploadedById: string;
}): Promise<FormAttachmentMeta> {
  const { formId, buffer, uploadedById } = params;

  let kind: AttachmentFileKind;
  try {
    ({ kind } = validateAttachmentFileBuffer(buffer));
  } catch (err) {
    const message =
      err instanceof AttachmentFileValidationError ? err.message : 'Invalid upload file';
    throw new Error(message);
  }

  const ext = attachmentExtension(kind);
  const storedFilename = `attachment-${randomUUID()}${ext}`;
  const dir = formAttachmentDir(formId);
  const existingCount = await prisma.formAttachment.count({ where: { formId } });
  const clientFilename = buildDocumentDisplayName(existingCount + 1, kind);

  fs.mkdirSync(dir, { recursive: true });
  const destPath = attachmentDiskPath(formId, storedFilename);
  fs.writeFileSync(destPath, buffer, { mode: 0o600 });

  const row = await prisma.formAttachment.create({
    data: {
      formId,
      storedFilename,
      clientFilename,
      fileKind: kind,
      sizeBytes: buffer.length,
      uploadedById,
    },
  });

  return mapRow(row);
}

export function readAttachmentFile(formId: string, storedFilename: string): Buffer {
  const filePath = attachmentDiskPath(formId, storedFilename);
  if (!fs.existsSync(filePath)) {
    throw new Error('Attachment file not found on disk');
  }
  return fs.readFileSync(filePath);
}

export function getAttachmentContentTypeForKind(kind: AttachmentFileKind): string {
  return attachmentContentType(kind);
}

export async function deleteFormAttachmentRecordAndFile(
  attachment: FormAttachmentMeta & { storedFilename: string }
): Promise<void> {
  const filePath = attachmentDiskPath(attachment.formId, attachment.storedFilename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* best effort */
  }
  await prisma.formAttachment.delete({ where: { id: attachment.id } });
  await renumberFormAttachmentDisplayNames(attachment.formId);
}

export async function deleteAllAttachmentsForForm(formId: string): Promise<void> {
  const attachments = await prisma.formAttachment.findMany({ where: { formId } });
  for (const att of attachments) {
    const filePath = attachmentDiskPath(formId, att.storedFilename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* best effort */
    }
  }
  await prisma.formAttachment.deleteMany({ where: { formId } });
  const dir = formAttachmentDir(formId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmdirSync(dir);
    }
  } catch {
    /* best effort */
  }
}

export async function copyAttachmentsToNewForm(
  sourceFormId: string,
  targetFormId: string,
  uploadedById: string
): Promise<void> {
  const sourceAttachments = await prisma.formAttachment.findMany({
    where: { formId: sourceFormId },
    orderBy: { createdAt: 'asc' },
  });
  if (sourceAttachments.length === 0) return;

  fs.mkdirSync(formAttachmentDir(targetFormId), { recursive: true });

  let documentIndex = 0;
  for (const src of sourceAttachments) {
    const srcPath = attachmentDiskPath(sourceFormId, src.storedFilename);
    if (!fs.existsSync(srcPath)) continue;

    const kind = src.fileKind as AttachmentFileKind;
    const ext = attachmentExtension(kind);
    const storedFilename = `attachment-${randomUUID()}${ext}`;
    const destPath = attachmentDiskPath(targetFormId, storedFilename);
    fs.copyFileSync(srcPath, destPath);
    fs.chmodSync(destPath, 0o600);

    documentIndex += 1;
    await prisma.formAttachment.create({
      data: {
        formId: targetFormId,
        storedFilename,
        clientFilename: buildDocumentDisplayName(documentIndex, kind),
        fileKind: src.fileKind,
        sizeBytes: src.sizeBytes,
        uploadedById,
      },
    });
  }
}
