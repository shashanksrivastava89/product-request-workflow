import { isReturnReviewerRole } from '../constants/return-form.constants';
import { hasServiceAdminPrivileges, hasSuperApproverPrivileges } from './auth-roles.util';

/**
 * An approver's "Delete" on a rejected request in their inbox (Shashank Srivastava, 7 Oct 2026):
 * *"If already rejected, keep in Approver's inbox, but add a Delete button - after delete, the count
 * on the Approver Inbox should go down for the user. But Super approver must be still able to see
 * this request as read only for record purposes."*
 *
 * So it is per person and removes nothing: the request, its approval rows, the requester's lists and
 * every other person's inbox stay as they were, and the super approver's table lists every request
 * whatever anyone deleted. See the ApprovalInboxDismissal model.
 */

/**
 * Is this step hidden from the inbox of someone who deleted it at `dismissedAt`?
 *
 * Only the rejection they deleted. A step that has been reopened and rejected again carries a later
 * decision time, so it is a new item and shows again; a step that is not rejected at all (reopened
 * and waiting on its approver) is never hidden, whatever its approver deleted earlier.
 */
export function isDismissedFromInbox(
    approval: { status: string; decidedAt?: string | Date | null },
    dismissedAt: Date | undefined
): boolean {
    if (!dismissedAt || approval.status !== 'REJECTED') return false;
    if (!approval.decidedAt) return true;
    return new Date(approval.decidedAt).getTime() <= dismissedAt.getTime();
}

/**
 * May this person delete this rejected step from their inbox? Exactly the people whose inbox lists
 * it (getPendingApprovals): the assigned approver, whoever actually rejected it, any of the service
 * team for a send-back at the review step, and a super approver.
 */
export function canDismissFromInbox(
    approval: { approverId: string; actualActorUserId?: string | null; role: string },
    user: { id: string; role?: string; isSuperApprover?: boolean; isServiceAdmin?: boolean }
): boolean {
    if (approval.approverId === user.id) return true;
    if (approval.actualActorUserId != null && approval.actualActorUserId === user.id) return true;
    if (isReturnReviewerRole(approval.role) && hasServiceAdminPrivileges(user.role, user.isServiceAdmin)) return true;
    return hasSuperApproverPrivileges(user.role ?? '', user.isSuperApprover);
}
