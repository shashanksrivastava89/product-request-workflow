/**
 * ZSAM / ZNC Claim: ➋ / salesManager slot shows Marketing Manager for Burchill.
 * Keep in sync with backend/src/utils/zncclaim-role-label.util.ts
 */

const BURCHILL_MARKETING_MANAGER_NAME = 'JACQUELINE BURCHILL';

function normalizePersonNameForRoleLabel(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Label for the first approver badge / timeline when form uses the salesManager field. */
export function salesManagerSlotRoleLabel(
  formPurpose: string | undefined,
  salesManagerName: string | undefined
): string {
  if (
    (formPurpose === 'ZNCCLAIM' || formPurpose === 'ZSAM' || formPurpose === 'ZINT') &&
    salesManagerName?.trim() &&
    normalizePersonNameForRoleLabel(salesManagerName) === BURCHILL_MARKETING_MANAGER_NAME
  ) {
    return 'Marketing Manager'
  }
  return 'Sales Manager'
}

/** NSM slot (e.g. FMM rows): Burchill is Marketing Manager, not National Sales Manager. */
export function nationalSalesManagerSlotRoleLabel(
  formPurpose: string | undefined,
  name: string | undefined
): string {
  if (!name?.trim()) return 'National Sales Manager'
  if (
    (formPurpose === 'ZSAM' || formPurpose === 'ZNC' || formPurpose === 'ZNCCLAIM' || formPurpose === 'ZINT') &&
    normalizePersonNameForRoleLabel(name) === BURCHILL_MARKETING_MANAGER_NAME
  ) {
    return 'Marketing Manager'
  }
  return 'National Sales Manager'
}
