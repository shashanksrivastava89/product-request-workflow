import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { prismaService } from '../services/prisma.service';
import type { SalesForm } from '../services/db.service';
import {
    hasCustomerSupportView,
    hasServiceAdminPrivileges,
    hasSuperApproverPrivileges,
} from './auth-roles.util';
import { isReturnReviewerRole } from '../constants/return-form.constants';
import { canViewZncClaimApprovedReport } from './znc-claim-approved-report.util';
import { canReadApprovedZncClaimReportForm } from '../services/znc-claim-approved-report.service';
import { resolveNamedRequester } from '../services/named-requester.service';

/**
 * A Service return the service admin team may see: one that has been submitted, whatever has
 * happened to it since - at review, with the approvers, rejected, approved, or reopened and being
 * corrected (a draft that still carries its reference number). A draft that was never submitted is
 * still its author's alone.
 *
 * One definition for the read check and the Pending list, so the team can open every row it is shown
 * and is shown every row it can open.
 */
export function isServiceCaseForServiceTeam(form: {
    formType?: string | null;
    isService?: boolean | null;
    status?: string | null;
    referenceNumber?: string | null;
}): boolean {
    if (form.formType !== 'RETURN' || form.isService !== true) return false;
    return form.status !== 'DRAFT' || Boolean(form.referenceNumber);
}

/** Whether the user may read this form (detail, approval history, print). */
export async function assertUserCanReadForm(req: AuthRequest, formId: string): Promise<SalesForm> {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Unauthorized', 401);

    const form = await prismaService.findFormById(formId);
    if (!form) throw new AppError('Form not found', 404);

    const role = req.user?.role ?? '';

    if (role === 'ADMIN' || hasSuperApproverPrivileges(role, req.user?.isSuperApprover)) {
        return form;
    }

    // The Customer Service view: every submitted request, whoever raised it, so the all-requests
    // list can open what it shows. Drafts stay their author's.
    if (hasCustomerSupportView(role, req.user?.isCustomerSupport)) {
        if (form.status === 'DRAFT') {
            throw new AppError('Access denied', 403);
        }
        return form;
    }

    if (form.requesterId === userId) {
        return form;
    }

    if (
        canViewZncClaimApprovedReport(req.user?.email) &&
        canReadApprovedZncClaimReportForm(form)
    ) {
        return form;
    }

    const approvals = await prismaService.findApprovalsByFormId(formId);
    const isApprover = approvals.some(
        (a) => a.approverId === userId || a.actualActorUserId === userId
    );
    if (isApprover) {
        return form;
    }

    /**
     * The service admin team may read every Service return, at any stage.
     *
     * Corlett Siobhan, 25 Sep 2026: *"Please grant access to all service admin members (Nia Hargreaves &
     * Baljiwan Woodward & Siobhan Corlett) to view all Service cases (Service = Yes) at any stages."* Until
     * then a Service Admin could read a return only while its review step was open, and lost sight
     * of it the moment it moved on - so the approved list showed Nia a row and then refused her
     * its approval path. Corlett never met the wall only because her account is an administrator's.
     *
     * A return sitting at its review step stays readable whatever its Service flag, as before: the
     * step is the team's to act on, and a reviewer may have switched the flag off while correcting.
     */
    if (form.formType === 'RETURN' && hasServiceAdminPrivileges(role, req.user?.isServiceAdmin)) {
        if (isServiceCaseForServiceTeam(form)) return form;
        if (approvals.some((a) => a.status === 'IN_PROGRESS' && isReturnReviewerRole(a.role))) return form;
    }

    /**
     * The rep a return names as its Requester, when somebody else submitted it.
     *
     * They are the one mailed "Request Submitted", every status update and "Request Rejected" - and
     * they could open none of it: this check knew only the submitter, so the link in their own
     * rejection mail answered "Access denied", and without read access they could not copy the
     * request to correct and resubmit it either. The resolver is the one the mail uses, so the
     * person mailed is exactly the person let in - one per form, nobody else.
     *
     * Checked last because it is the only step that loads the directory: submitters, approvers and
     * reviewers are recognised before it runs.
     */
    if (form.formType === 'RETURN' && (await resolveNamedRequester(form))?.userId === userId) {
        return form;
    }

    throw new AppError('Access denied', 403);
}
