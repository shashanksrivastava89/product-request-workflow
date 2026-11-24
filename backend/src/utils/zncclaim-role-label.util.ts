/**
 * ZSAM / ZNC Claim: ➋ maps to salesManager; Burchill → Marketing Manager label.
 * Call only for ZSAM or ZNCCLAIM at the salesManager mapping slot (see approval.service).
 * Keep in sync with src/utils/zncclaim-role-label.util.ts
 */

const BURCHILL_MARKETING_MANAGER_NAME = 'JACQUELINE BURCHILL';

export function normalizePersonNameForRoleLabel(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Role label for salesManager slot when form type is ZSAM or ZNCCLAIM. */
export function zsamOrZncClaimSalesManagerRoleLabel(approverName: string | undefined | null): string {
  if (!approverName?.trim()) return 'Sales Manager';
  if (normalizePersonNameForRoleLabel(approverName) === BURCHILL_MARKETING_MANAGER_NAME) {
    return 'Marketing Manager';
  }
  return 'Sales Manager';
}

/**
 * NSM column in zsamm / some ZNC rows lists Burchill as Marketing Manager org role.
 * ZSAM / ZNC / ZNCCLAIM when mapping_field is nationalSalesManager.
 */
export function nationalSalesManagerSlotRoleLabel(
  formType: string,
  approverName: string | undefined | null
): string {
  if (!approverName?.trim()) return 'National Sales Manager';
  if (
    (formType === 'ZSAM' || formType === 'ZNC' || formType === 'ZNCCLAIM' || formType === 'ZINT') &&
    normalizePersonNameForRoleLabel(approverName) === BURCHILL_MARKETING_MANAGER_NAME
  ) {
    return 'Marketing Manager';
  }
  return 'National Sales Manager';
}
