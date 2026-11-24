/** Users who may view the approved ZNC Claim report. */
export const ZNC_CLAIM_APPROVED_REPORT_EMAILS = [
  'beau_hargadon@example.com',
  'josiah_dearbhla@example.com',
] as const;

export function canViewZncClaimApprovedReport(email?: string | null): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  return ZNC_CLAIM_APPROVED_REPORT_EMAILS.some((allowed) => allowed === normalized);
}
