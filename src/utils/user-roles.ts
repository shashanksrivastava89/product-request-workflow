/** Super-approver capabilities: legacy `SUPER_APPROVER` role or primary role + `isSuperApprover`. */
export function hasSuperApproverAccess(role: string | undefined, isSuperApprover?: boolean): boolean {
    return role === 'SUPER_APPROVER' || isSuperApprover === true;
}

export function isCustomerSupport(role: string | undefined | null): boolean {
    return role === 'CUSTOMER_SUPPORT';
}

/**
 * The read-only all-requests pages: the CUSTOMER_SUPPORT role, or any role carrying the Customer
 * Service view flag (the Customer Service members are requesters who also need the overview).
 */
export function hasCustomerSupportView(role: string | undefined | null, flag?: boolean): boolean {
    return isCustomerSupport(role) || flag === true;
}
