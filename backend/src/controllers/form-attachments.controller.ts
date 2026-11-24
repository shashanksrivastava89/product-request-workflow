/**
 * ZNC Claim form attachment endpoints (upload, list, download, delete).
 */

import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { assertUserCanReadForm } from '../utils/form-access.util';
import { prismaService } from '../services/prisma.service';
import {
  countFormAttachments,
  deleteFormAttachmentRecordAndFile,
  findFormAttachmentById,
  getAttachmentContentTypeForKind,
  listFormAttachments,
  MAX_ATTACHMENTS_PER_FORM,
  readAttachmentFile,
  saveFormAttachment,
} from '../services/form-attachment.service';

function assertZncClaimForm(formType: string): void {
  if (formType !== 'ZNCCLAIM') {
    throw new AppError('Attachments are only supported for ZNC Claim forms', 400);
  }
}

async function assertRequesterCanWriteAttachments(
  req: AuthRequest,
  formId: string
): Promise<{ id: string; formType: string; status: string; requesterId: string }> {
  const userId = req.user?.id;
  if (!userId) throw new AppError('Unauthorized', 401);

  const form = await prismaService.findFormById(formId);
  if (!form) throw new AppError('Form not found', 404);
  if (form.requesterId !== userId) throw new AppError('Access denied', 403);
  if (form.status !== 'DRAFT') {
    throw new AppError('Attachments can only be changed on draft forms', 400);
  }
  assertZncClaimForm(form.formType);
  return form;
}

export const listFormAttachmentsHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: formId } = req.params;
    const form = await assertUserCanReadForm(req, formId);
    if (form.formType !== 'ZNCCLAIM') {
      res.json({ attachments: [] });
      return;
    }
    const attachments = await listFormAttachments(formId);
    res.json({ attachments });
  } catch (error) {
    next(error);
  }
};

export const uploadFormAttachmentHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: formId } = req.params;
    const userId = req.user?.id;
    if (!userId) throw new AppError('Unauthorized', 401);

    await assertRequesterCanWriteAttachments(req, formId);

    const file = req.file;
    if (!file?.buffer?.length) {
      throw new AppError('No file uploaded. Use multipart field "file".', 400);
    }

    const currentCount = await countFormAttachments(formId);
    if (currentCount >= MAX_ATTACHMENTS_PER_FORM) {
      throw new AppError(`Maximum ${MAX_ATTACHMENTS_PER_FORM} attachments per form`, 400);
    }

    const attachment = await saveFormAttachment({
      formId,
      buffer: file.buffer,
      uploadedById: userId,
    });

    res.status(201).json({ attachment });
  } catch (error) {
    if (error instanceof Error && error.message.includes('allowed')) {
      next(new AppError(error.message, 400));
      return;
    }
    next(error);
  }
};

export const downloadFormAttachmentHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: formId, attachmentId } = req.params;
    await assertUserCanReadForm(req, formId);

    const attachment = await findFormAttachmentById(attachmentId);
    if (!attachment || attachment.formId !== formId) {
      throw new AppError('Attachment not found', 404);
    }

    const buffer = readAttachmentFile(formId, attachment.storedFilename);
    const contentType = getAttachmentContentTypeForKind(attachment.fileKind);
    const disposition = 'inline';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(attachment.clientFilename)}"`
    );
    res.send(buffer);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      next(new AppError('Attachment file not found', 404));
      return;
    }
    next(error);
  }
};

export const deleteFormAttachmentHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: formId, attachmentId } = req.params;
    await assertRequesterCanWriteAttachments(req, formId);

    const attachment = await findFormAttachmentById(attachmentId);
    if (!attachment || attachment.formId !== formId) {
      throw new AppError('Attachment not found', 404);
    }

    await deleteFormAttachmentRecordAndFile(attachment);
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    next(error);
  }
};
