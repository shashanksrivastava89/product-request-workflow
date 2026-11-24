import { Response, NextFunction } from 'express';
import { prismaService } from '../services/prisma.service';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { processApproval, reopenRejectedApproval, sendApprovalRequestNotification } from '../services/approval.service';
import { z } from 'zod';
import {
    hasServiceAdminPrivileges,
    hasSuperApproverPrivileges,
    isCustomerSupportRole,
} from '../utils/auth-roles.util';
import { isReturnReviewerRole } from '../constants/return-form.constants';
import { listReviewEdits } from '../services/form-review-edit.service';
import { assertUserCanReadForm } from '../utils/form-access.util';
import { assertReviewStepComplete } from '../utils/return-approval-readiness.util';
import { canDismissFromInbox, isDismissedFromInbox } from '../utils/inbox-dismissal.util';

const approvalDecisionSchema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comments: z.string().optional()
});

export const getPendingApprovals = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        const userRole = req.user?.role;
        if (!userId) throw new AppError('Unauthorized', 401);

        if (isCustomerSupportRole(userRole)) {
            res.json({ approvals: [] });
            return;
        }

        const isSuper = hasSuperApproverPrivileges(userRole ?? '', req.user?.isSuperApprover);
        const isServiceAdmin = hasServiceAdminPrivileges(userRole, req.user?.isServiceAdmin);

        let inProgress = isSuper
            ? await prismaService.findManyApprovals({ status: 'IN_PROGRESS' })
            : await prismaService.findManyApprovals({
                  approverId: userId,
                  status: 'IN_PROGRESS',
              });

        // The service review step is addressed to a shared mailbox, which nobody can sign in as —
        // so it appeared in nobody's inbox, and the only way to action it was the emailed link. The
        // approve and reject handlers already let any Service Admin act on it; this is the listing
        // that lets them find it. Without both halves the step is actionable but invisible.
        if (!isSuper && isServiceAdmin) {
            const reviewSteps = (
                await prismaService.findManyApprovals({ status: 'IN_PROGRESS' })
            ).filter((a) => isReturnReviewerRole(a.role));
            const seen = new Set(inProgress.map((a) => a.id));
            inProgress = [...inProgress, ...reviewSteps.filter((a) => !seen.has(a.id))];
        }

        // Admins manage rejected forms in Data Management; inbox is only for items they must act on.
        const reopenableRejected = await prismaService.findRejectedApprovalsForReopen(userId, isSuper);
        /*
         * The service team's send-backs, for everyone on the team.
         *
         * A rejected step is listed for whoever rejected it, so they can take it back. The review
         * step, though, belongs to the team - any Service Admin approves or rejects it - and listing
         * a send-back only for the one who pressed the button made the queue differ person to
         * person: Corlett saw three requests where Nia saw one (25 Sep 2026, "view all Service cases
         * (Service = Yes) at any stages"). Any of them may reopen it, too (reopenRejectedApproval).
         */
        const teamSendBacks = !isSuper && isServiceAdmin ? await prismaService.findRejectedReviewSteps() : [];
        const byId = new Map<string, (typeof inProgress)[0]>();
        for (const a of inProgress) byId.set(a.id, a);
        for (const a of reopenableRejected) byId.set(a.id, a);
        for (const a of teamSendBacks) byId.set(a.id, a);
        // A rejected request this person deleted from their inbox stays out of it, and so out of the
        // count on their inbox tile. Nobody else's list changes (dismissRejectedApproval).
        const dismissed = await prismaService.findInboxDismissals(
            userId,
            [...byId.values()].filter((a) => a.status === 'REJECTED').map((a) => a.id)
        );
        const approvals = [...byId.values()].filter((a) => !isDismissedFromInbox(a, dismissed.get(a.id)));

        // Get form details for each approval
        const approvalsWithForms = await Promise.all(
            approvals.map(async (approval) => {
                const form = await prismaService.findFormById(approval.formId);
                const products = await prismaService.findFormProducts(approval.formId);
                const invoiceDates = await prismaService.findFormInvoiceDates(approval.formId);
                const requester = form ? await prismaService.findUserById(form.requesterId) : null;
                // What a service reviewer corrected before this approver was asked. Only a return
                // can have any, so the rest of the inbox costs nothing.
                const reviewEdits =
                    form?.formType === 'RETURN' ? await listReviewEdits(form.id) : [];
                // What the earlier steps wrote when they approved - a reviewer's note about a
                // correction, an approver's caveat. Recorded all along, shown to nobody until now.
                const priorComments = (await prismaService.findApprovalsByFormId(approval.formId))
                    .filter((a) => a.level < approval.level && a.status === 'APPROVED' && a.comments?.trim())
                    .sort((a, b) => a.level - b.level)
                    .map((a) => ({
                        level: a.level,
                        role: a.role,
                        approverName: a.approverName,
                        comments: String(a.comments).trim(),
                        decidedAt: a.decidedAt ?? null,
                    }));

                return {
                    ...approval,
                    priorComments,
                    form: form ? {
                        ...form,
                        products,
                        invoiceDates,
                        reviewEdits,
                        requester: requester ? {
                            id: requester.id,
                            name: requester.name,
                            email: requester.email
                        } : null
                    } : null
                };
            })
        );

        res.json({ approvals: approvalsWithForms });
    } catch (error) {
        next(error);
    }
};

export const getApprovalHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { formId } = req.params;

        await assertUserCanReadForm(req, formId);

        const approvals = await prismaService.findApprovalsByFormId(formId);
        const sortedApprovals = approvals.sort((a, b) => a.level - b.level);

        res.json({ approvals: sortedApprovals });
    } catch (error) {
        next(error);
    }
};

export const approveForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);
        
        const { comments } = approvalDecisionSchema.parse({ ...req.body, decision: 'APPROVED' });

        const approval = await prismaService.findApprovalById(id);

        if (!approval) {
            throw new AppError('Approval not found', 404);
        }

        if (approval.status !== 'IN_PROGRESS') {
            throw new AppError('This approval has already been processed', 400);
        }

        const isAssignee = approval.approverId === userId;
        const isSuper = hasSuperApproverPrivileges(req.user?.role ?? '', req.user?.isSuperApprover);
        // The service review step is addressed to a shared mailbox, which nobody can sign in as.
        // Any Service Admin acts on it instead, and processApproval records who actually did.
        const isServiceReview =
            isReturnReviewerRole(approval.role) &&
            hasServiceAdminPrivileges(req.user?.role, req.user?.isServiceAdmin);
        if (!isAssignee && !isSuper && !isServiceReview) {
            throw new AppError('This approval is not assigned to you', 403);
        }

        /*
         * A review step may not be passed on while the request is incomplete.
         *
         * A Service = Yes requester may submit without the order number or invoice date, on the
         * understanding that the review team completes them — *"after the service admin team review,
         * this cannot be accepted for any \[empty\] space"*. The reviewer's screen and the queue both
         * check this; so does the emailed Approve button, which lands on the public token endpoint and
         * calls this same check.
         */
        await assertReviewStepComplete(approval);

        // Process the approval
        await processApproval(id, 'APPROVED', comments, {
            userId,
            role: req.user?.role || '',
            isSuperApprover: req.user?.isSuperApprover === true,
            isServiceAdmin: req.user?.isServiceAdmin === true,
        });

        const updatedApproval = await prismaService.findApprovalById(id);

        res.json({
            message: 'Form approved successfully',
            approval: updatedApproval
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Same form: put the rejected step back to IN_PROGRESS so the approver can approve later.
 */
export const reopenRejectedStep = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const updated = await reopenRejectedApproval(id, {
            userId,
            role: req.user?.role || '',
            isSuperApprover: req.user?.isSuperApprover === true,
            isServiceAdmin: req.user?.isServiceAdmin === true,
        });

        res.json({
            message: 'This step was reopened. You can approve or reject again.',
            approval: updated,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to reopen';
        if (msg === 'Approval not found') {
            return next(new AppError(msg, 404));
        }
        if (
            msg.includes('Only a rejected') ||
            msg.includes('not in rejected') ||
            msg.includes('Only the assigned approver')
        ) {
            return next(new AppError(msg, 400));
        }
        next(error);
    }
};

/**
 * "Delete" on a rejected request in the approver's inbox: takes it out of THIS person's inbox.
 *
 * Nothing about the request changes - it stays rejected, the requester still has it, every other
 * inbox that lists it still does, and the super approver's table shows every request regardless.
 * Only a rejected step can be deleted: one still waiting on a decision must stay where it is.
 */
export const dismissRejectedApproval = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const approval = await prismaService.findApprovalById(id);
        if (!approval) throw new AppError('Approval not found', 404);
        if (approval.status !== 'REJECTED') {
            throw new AppError('Only a rejected request can be deleted from the inbox', 400);
        }
        if (
            !canDismissFromInbox(approval, {
                id: userId,
                role: req.user?.role,
                isSuperApprover: req.user?.isSuperApprover === true,
                isServiceAdmin: req.user?.isServiceAdmin === true,
            })
        ) {
            throw new AppError('This request is not in your inbox', 403);
        }

        const dismissedAt = await prismaService.dismissApprovalFromInbox(id, userId);
        res.json({ message: 'Deleted from your inbox', approvalId: id, dismissedAt: dismissedAt.toISOString() });
    } catch (error) {
        next(error);
    }
};

/** ADMIN only: resend approval-request email to the current IN_PROGRESS approver. */
export const notifyApprover = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            throw new AppError('Only administrators can send approver notifications', 403);
        }

        const { id } = req.params;
        const result = await sendApprovalRequestNotification(id);

        res.json({
            message: `Notification sent to ${result.approverName}`,
            approverName: result.approverName,
            notifiedAt: result.notifiedAt,
            approval: result.approval,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to send notification';
        if (msg === 'Approval not found' || msg === 'Form not found') {
            return next(new AppError(msg, 404));
        }
        if (
            msg.includes('not in progress') ||
            msg.includes('Only the active') ||
            msg.includes('no email')
        ) {
            return next(new AppError(msg, 400));
        }
        next(error);
    }
};

export const rejectForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);
        
        const { comments } = approvalDecisionSchema.parse({ ...req.body, decision: 'REJECTED' });

        if (!comments) {
            throw new AppError('Comments are required when rejecting a form', 400);
        }

        const approval = await prismaService.findApprovalById(id);

        if (!approval) {
            throw new AppError('Approval not found', 404);
        }

        if (approval.status !== 'IN_PROGRESS') {
            throw new AppError('This approval has already been processed', 400);
        }

        const isAssignee = approval.approverId === userId;
        const isSuper = hasSuperApproverPrivileges(req.user?.role ?? '', req.user?.isSuperApprover);
        // The service review step is addressed to a shared mailbox, which nobody can sign in as.
        // Any Service Admin acts on it instead, and processApproval records who actually did.
        const isServiceReview =
            isReturnReviewerRole(approval.role) &&
            hasServiceAdminPrivileges(req.user?.role, req.user?.isServiceAdmin);
        if (!isAssignee && !isSuper && !isServiceReview) {
            throw new AppError('This approval is not assigned to you', 403);
        }

        // Process the rejection
        await processApproval(id, 'REJECTED', comments, {
            userId,
            role: req.user?.role || '',
            isSuperApprover: req.user?.isSuperApprover === true,
            isServiceAdmin: req.user?.isServiceAdmin === true,
        });

        const updatedApproval = await prismaService.findApprovalById(id);

        res.json({
            message: 'Form rejected successfully',
            approval: updatedApproval
        });
    } catch (error) {
        next(error);
    }
};
