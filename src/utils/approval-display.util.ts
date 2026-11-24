import { isReturnReviewerRole } from './return-approval.util'

/**
 * Who acted on this step, when it was not the person (or mailbox) it is addressed to.
 *
 * Two entitlements can do that, and they are not the same thing. A super approver may act on any
 * step, and the parenthetical names that power because nothing else explains the substitution. A
 * Service Admin may act only on the service review step, which is addressed to a shared mailbox
 * nobody can sign in as - there the assignee IS the team ("SERVICE ADMIN TEAM"), so "X on behalf of
 * SERVICE ADMIN TEAM" already says everything, and calling a member of that team a super approver
 * is simply false. Corlett Siobhan is a Service Admin and is not a super approver; her requester's
 * approval mail said she was (UAT, 10 Sep 2026).
 *
 * `processApproval` sets `actualActorUserId` under exactly those two conditions, so the step's own
 * role tells the two apart with no extra column: only the review step can be cleared by someone
 * who is not a super approver.
 */
export function formatApprovalAssigneeLine(approval: {
    approverName: string;
    /** The step's role. Distinguishes the service review step from every other. */
    role?: string | null;
    actualActorUserId?: string | null;
    actualActorName?: string | null;
}): string {
    if (approval.actualActorUserId) {
        const n = approval.actualActorName?.trim();
        const onReviewStep = isReturnReviewerRole(approval.role);
        if (n) return `${n}${onReviewStep ? '' : ' (super approver)'} on behalf of ${approval.approverName}`;
        return `${onReviewStep ? 'Service admin' : 'Super approver'} on behalf of ${approval.approverName}`;
    }
    return approval.approverName;
}

/** Compact date/time for approval tables (e.g. 2026/5/26 11:01). */
export function formatCompactApprovalDateTime(date: Date | string): string {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${h}:${min}`;
}

/** Merged Status / When cell for order-taking mail and print. */
export function formatApprovalDecisionLine(approval: {
    status: string;
    decidedAt?: string | Date | null;
    notifiedAt?: string | Date | null;
}): string {
    if (approval.decidedAt) {
        return `${approval.status} · ${formatCompactApprovalDateTime(approval.decidedAt)}`;
    }
    if (approval.notifiedAt) {
        return `Sent · ${formatCompactApprovalDateTime(approval.notifiedAt)}`;
    }
    return '—';
}

/** Primary approve control: super approver acting for another user sees “on behalf of” copy. */
export function approveActionButtonLabel(
    userId: string | undefined,
    userRole: string | undefined,
    approval: { approverId: string; approverName: string },
    defaultLabel: string,
    isSuperApprover?: boolean
): string {
    const superUser =
        (userRole === 'SUPER_APPROVER' || isSuperApprover === true) &&
        userId &&
        userId !== approval.approverId;
    if (superUser) {
        return `Approve on behalf of ${approval.approverName}`;
    }
    return defaultLabel;
}

/** Reject control: same “on behalf of” copy for super approver. */
export function rejectActionButtonLabel(
    userId: string | undefined,
    userRole: string | undefined,
    approval: { approverId: string; approverName: string },
    defaultLabel: string,
    isSuperApprover?: boolean
): string {
    const superUser =
        (userRole === 'SUPER_APPROVER' || isSuperApprover === true) &&
        userId &&
        userId !== approval.approverId;
    if (superUser) {
        return `Reject on behalf of ${approval.approverName}`;
    }
    return defaultLabel;
}
