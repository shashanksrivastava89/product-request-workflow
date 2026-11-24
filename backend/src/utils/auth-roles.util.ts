/** Super-approver powers: legacy enum-only accounts or primary role + `isSuperApprover` flag. */
export function hasSuperApproverPrivileges(role: string, isSuperApprover?: boolean): boolean {
    return role === 'SUPER_APPROVER' || isSuperApprover === true;
}

export function isCustomerSupportRole(role: string | undefined | null): boolean {
    return role === 'CUSTOMER_SUPPORT';
}

/**
 * The Customer Service view: the read-only "all requests" pages.
 *
 * The CUSTOMER_SUPPORT role gives it and nothing else - such an account cannot submit. The five
 * Customer Service members became REQUESTERs on 23 Oct 2026 so they could raise returns, and lost
 * the view the same moment. The flag puts it back on top of whatever role they hold; the role alone
 * still decides who is read-only (`isCustomerSupportRole`).
 */
export function hasCustomerSupportView(
    role: string | undefined | null,
    isCustomerSupport?: boolean
): boolean {
    return isCustomerSupportRole(role) || isCustomerSupport === true;
}

/**
 * Service Admin team membership.
 *
 * A flag rather than a role because the same people raise the requests they review — Nia Hargreaves
 * and Baljiwan Woodward are REQUESTERs — so a single `role` column cannot express both. Same shape as
 * `hasSuperApproverPrivileges`, which exists for that reason too.
 *
 * Grants: the service review step, the review-window edit, sight of every approved service return,
 * and entry of the SAP sales order number. ADMIN is included so an administrator is never locked
 * out of a step only this team can clear.
 */
export function hasServiceAdminPrivileges(
    role: string | undefined | null,
    isServiceAdmin?: boolean
): boolean {
    return isServiceAdmin === true || role === 'ADMIN';
}
