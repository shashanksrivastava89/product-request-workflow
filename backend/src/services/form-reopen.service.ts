/**
 * Reopening a rejected return in place — Corlett Siobhan, 25 Sep 2026.
 *
 * *"Depending on the reason for the rejection, it would be preferable to allow the submitter to
 * Reopen a rejected request rather than create a cloned request, as reopening preserves the request
 * history and requires less effort for data entry."*
 *
 * A rejection was terminal, and the way back was a copy: a new request with a new reference number
 * and none of the history — who approved it, who rejected it, and why. Reopening keeps the request
 * itself. It goes back to its requester as a draft with the same id and reference number, they
 * correct what was asked for, and submitting it routes it through the approval chain again.
 *
 * The one thing that cannot stay where it was is the rejected round's approval rows: a form holds one
 * row per level, so the resubmission's fresh chain could not be created alongside them. They move
 * into `approval_history` — every step with its decision and comment, what the service review
 * corrected, who submitted and who reopened — and the live rows are cleared. That also retires the
 * approve/reject links in the mails already sent for the rejected round, which should not be able to
 * act on a request that has since changed.
 *
 * Which rejections: only one made AT THE SERVICE REVIEW — "Send back to requester" from the P&OP
 * team. Corlett, the same day: *"My preference would be to allow Reopen for cases that have been
 * rejected at the Service Review level only."* The review is where a request is checked and put
 * right; an approver's rejection is a decision about the request itself, and that stays final — the
 * requester copies it into a new request instead.
 *
 * Who may reopen: the person who entered the request, or the rep it names as its Requester — the one
 * the rejection mail went to. Whoever reopens becomes the one entering the correction, so the draft,
 * like any draft, is theirs alone to edit and submit. Returns only: the sample flows are untouched.
 */
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { prismaService } from './prisma.service';
import type { SalesForm, SubmissionRound } from './db.service';
import { listReviewEdits } from './form-review-edit.service';
import { resolveNamedRequester } from './named-requester.service';
import { isReturnReviewerRole } from '../constants/return-form.constants';

const prisma = new PrismaClient();

/** Was this request sent back at the service review, rather than rejected by an approver? */
export function rejectedAtServiceReview(approvals: Array<{ status: string; role: string }>): boolean {
    const rejected = approvals.find((a) => a.status === 'REJECTED');
    return Boolean(rejected) && isReturnReviewerRole(rejected!.role);
}

/** Whether this person may reopen this request: its enterer, or the rep it names. */
async function isEntererOrNamedRequester(form: SalesForm, userId: string): Promise<boolean> {
    if (form.requesterId === userId) return true;
    return (await resolveNamedRequester(form))?.userId === userId;
}

/**
 * Put a rejected return back into its requester's hands, keeping its reference number and history.
 * Returns the form as it now stands: a DRAFT owned by whoever reopened it.
 */
export async function reopenRejectedReturn(formId: string, userId: string): Promise<SalesForm> {
    const form = await prismaService.findFormById(formId);
    if (!form) throw new AppError('Form not found', 404);
    if (form.formType !== 'RETURN') throw new AppError('Only a return / credit request can be reopened', 400);
    if (form.status !== 'REJECTED') throw new AppError('Only a rejected request can be reopened', 400);

    const approvals = await prismaService.findApprovalsByFormId(formId);
    if (!rejectedAtServiceReview(approvals)) {
        throw new AppError(
            'Only a request sent back at the service review can be reopened. A request rejected by an ' +
                'approver can be copied into a new request instead.',
            400
        );
    }
    if (!(await isEntererOrNamedRequester(form, userId))) {
        throw new AppError(
            'Only the person who entered this request, or the requester it names, can reopen it',
            403
        );
    }

    const [reviewEdits, submitter, reopener] = await Promise.all([
        listReviewEdits(formId),
        prismaService.findUserById(form.requesterId),
        prismaService.findUserById(userId),
    ]);

    const earlier = Array.isArray(form.approvalHistory) ? form.approvalHistory : [];
    const round: SubmissionRound = {
        round: earlier.length + 1,
        submittedAt: form.submittedAt ?? null,
        submittedById: form.requesterId,
        submittedByName: submitter?.name ?? null,
        rejectedAt: form.completedAt ?? null,
        approvals: [...approvals]
            .sort((a, b) => a.level - b.level)
            .map((a) => ({
                level: a.level,
                role: a.role,
                approverName: a.approverName,
                status: a.status,
                comments: a.comments ?? null,
                decidedAt: a.decidedAt ?? null,
                actualActorName: a.actualActorName ?? null,
            })),
        reviewEdits,
        reopenedAt: new Date().toISOString(),
        reopenedById: userId,
        reopenedByName: reopener?.name ?? null,
    };

    /*
     * One transaction: the round is written to history in the same commit that clears it, so it can
     * never be lost halfway. The review corrections move too - the next review takes its own
     * snapshot on its first correction, and "discard all corrections" must return to what was
     * RESUBMITTED, not to the first submission.
     */
    await prisma.$transaction([
        prisma.approval.deleteMany({ where: { formId } }),
        prisma.formReviewEdit.deleteMany({ where: { formId } }),
        prisma.salesForm.update({
            where: { id: formId },
            data: {
                status: 'DRAFT',
                completedAt: null,
                requesterId: userId,
                approvalHistory: [...earlier, round] as any,
            },
        }),
    ]);

    const reopened = await prismaService.findFormById(formId);
    if (!reopened) throw new AppError('Form not found after reopening', 500);
    return reopened;
}

/** The most recent rejection a resubmitted return came back from, for the mails. */
export function lastRejection(
    form: Pick<SalesForm, 'approvalHistory'>
): { by: string; role: string; at: string | null; reason: string | null } | null {
    const history = Array.isArray(form.approvalHistory) ? form.approvalHistory : [];
    const last = history[history.length - 1];
    if (!last) return null;
    const step = last.approvals.find((a) => a.status === 'REJECTED');
    if (!step) return null;
    return {
        by: step.actualActorName ? `${step.actualActorName} on behalf of ${step.approverName}` : step.approverName,
        role: step.role,
        at: step.decidedAt,
        reason: step.comments,
    };
}
