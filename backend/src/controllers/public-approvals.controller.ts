/**
 * Public approval endpoints (no authentication required)
 * These endpoints use tokens from email links
 */

import { Request, Response, NextFunction } from 'express';
import { prismaService } from '../services/prisma.service';
import { processApproval } from '../services/approval.service';
import { assertReviewStepComplete } from '../utils/return-approval-readiness.util';
import { AppError } from '../middleware/error.middleware';
import { isTokenExpired } from '../utils/token.util';
import { z } from 'zod';
import { listReviewEdits } from '../services/form-review-edit.service';
import {
  findFormAttachmentById,
  getAttachmentContentTypeForKind,
  listFormAttachments,
  readAttachmentFile,
} from '../services/form-attachment.service';

const approvalDecisionSchema = z.object({
    comments: z.string().optional()
});

async function resolveApprovalByToken(token: string) {
    const approval = await prismaService.findApprovalByToken(token);
    if (!approval) {
        throw new AppError('Invalid or expired approval token', 404);
    }
    if (approval.tokenExpiresAt && isTokenExpired(approval.tokenExpiresAt)) {
        throw new AppError('This approval link has expired', 410);
    }
    return approval;
}

/**
 * Get approval details by token (for displaying approval page)
 */
export const getApprovalByToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.query;

        if (!token || typeof token !== 'string') {
            throw new AppError('Approval token is required', 400);
        }

        const approval = await resolveApprovalByToken(token);

        // Get form details (read-only — allow viewing even after this step was processed)
        const form = await prismaService.findFormById(approval.formId);
        if (!form) {
            throw new AppError('Form not found', 404);
        }

        // Get products
        const products = await prismaService.findFormProducts(approval.formId);

        // Get requester info
        const requester = await prismaService.findUserById(form.requesterId);

        const attachments =
            form.formType === 'ZNCCLAIM'
                ? await listFormAttachments(approval.formId)
                : [];

        res.json({
            approval: {
                ...approval,
                form: {
                    ...form,
                    products,
                    attachments,
                    // An approver reached by the emailed link signs off the same figures as one in
                    // the inbox, so they must see what the review team changed before them too.
                    reviewEdits: form.formType === 'RETURN' ? await listReviewEdits(approval.formId) : [],
                    requester: requester ? {
                        id: requester.id,
                        name: requester.name,
                        email: requester.email
                    } : null
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List attachments for token-based approvers (no login).
 */
export const listAttachmentsByToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.query;
        if (!token || typeof token !== 'string') {
            throw new AppError('Approval token is required', 400);
        }

        const approval = await resolveApprovalByToken(token);
        const form = await prismaService.findFormById(approval.formId);
        if (!form || form.formType !== 'ZNCCLAIM') {
            res.json({ attachments: [] });
            return;
        }

        const attachments = await listFormAttachments(approval.formId);
        res.json({ attachments });
    } catch (error) {
        next(error);
    }
};

/**
 * Download attachment for token-based approvers (no login).
 */
export const downloadAttachmentByToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { attachmentId } = req.params;
        const { token } = req.query;
        if (!token || typeof token !== 'string') {
            throw new AppError('Approval token is required', 400);
        }

        const approval = await resolveApprovalByToken(token);
        const attachment = await findFormAttachmentById(attachmentId);
        if (!attachment || attachment.formId !== approval.formId) {
            throw new AppError('Attachment not found', 404);
        }

        const buffer = readAttachmentFile(attachment.formId, attachment.storedFilename);
        const contentType = getAttachmentContentTypeForKind(attachment.fileKind);

        res.setHeader('Content-Type', contentType);
        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(attachment.clientFilename)}"`
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

/**
 * Approve form using token (no authentication required)
 */
export const approveFormByToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.query;
        const { comments } = approvalDecisionSchema.parse(req.body);

        if (!token || typeof token !== 'string') {
            throw new AppError('Approval token is required', 400);
        }

        const approval = await prismaService.findApprovalByToken(token);

        if (!approval) {
            throw new AppError('Invalid or expired approval token', 404);
        }

        // Check if token is expired
        if (approval.tokenExpiresAt && isTokenExpired(approval.tokenExpiresAt)) {
            throw new AppError('This approval link has expired', 410);
        }

        // Check if approval is already processed (must be IN_PROGRESS to process)
        if (approval.status !== 'IN_PROGRESS') {
            throw new AppError(
                approval.status === 'APPROVED' || approval.status === 'REJECTED'
                    ? 'This approval has already been processed'
                    : `This approval cannot be processed. Current status: ${approval.status}`,
                400
            );
        }

        // The review mail's Approve button lands here, so the review step's completeness check
        // applies here too - it used to be enforced only on the logged-in endpoint.
        await assertReviewStepComplete(approval);

        // Process the approval
        await processApproval(approval.id, 'APPROVED', comments);

        const updatedApproval = await prismaService.findApprovalById(approval.id);

        res.json({
            message: 'Form approved successfully',
            approval: updatedApproval
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Reject form using token (no authentication required)
 */
export const rejectFormByToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.query;
        const { comments } = approvalDecisionSchema.parse(req.body);

        if (!token || typeof token !== 'string') {
            throw new AppError('Approval token is required', 400);
        }

        if (!comments || comments.trim().length === 0) {
            throw new AppError('Comments are required when rejecting a form', 400);
        }

        const approval = await prismaService.findApprovalByToken(token);

        if (!approval) {
            throw new AppError('Invalid or expired approval token', 404);
        }

        // Check if token is expired
        if (approval.tokenExpiresAt && isTokenExpired(approval.tokenExpiresAt)) {
            throw new AppError('This approval link has expired', 410);
        }

        // Check if approval is already processed (must be IN_PROGRESS to process)
        if (approval.status !== 'IN_PROGRESS') {
            throw new AppError(
                approval.status === 'APPROVED' || approval.status === 'REJECTED'
                    ? 'This approval has already been processed'
                    : `This approval cannot be processed. Current status: ${approval.status}`,
                400
            );
        }

        // Process the rejection
        await processApproval(approval.id, 'REJECTED', comments);

        const updatedApproval = await prismaService.findApprovalById(approval.id);

        res.json({
            message: 'Form rejected successfully',
            approval: updatedApproval
        });
    } catch (error) {
        next(error);
    }
};

