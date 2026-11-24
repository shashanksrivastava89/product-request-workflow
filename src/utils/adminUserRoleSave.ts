/**
 * Can the Users page save the role change drafted on an account row?
 *
 * One rule for the "Save role" button and the save handler, so the two cannot drift apart again.
 * They had: the handler stopped requiring a team, a sales rep code and a business unit for a
 * Requester (most Return requesters have no SAP code, and the wizard reads their teams from the
 * Requesters directory), but the button still demanded all three. On 23 Oct 2026 that left five
 * Customer Service accounts stuck on the read-only role: the button never enabled.
 *
 * Rules:
 *   - A role change is saveable. Nothing else is: the handler answers "No role change to save."
 *     to everything else, so editing an existing requester's team or code here is not a save.
 *   - A Requester with a team chosen needs a business unit, because the team is looked up by unit.
 *     A Requester with no team and no code is fine.
 */
export interface RoleSaveAccount {
  /** Missing on a legacy row; the page treats such an account as an administrator. */
  role?: string | null;
  businessUnit?: string | null;
  requesterGroupId?: string | null;
}

export interface RoleSaveDraft {
  /** The role picked in the row's dropdown; undefined when the admin has not touched it. */
  role?: string;
  /** Business unit picked in the row for an account that has none. */
  businessUnit?: string;
  /** Team picked in the row; an empty string means "no fixed team". */
  requesterGroupId?: string;
}

export function canSaveRoleChange(account: RoleSaveAccount, draft: RoleSaveDraft): boolean {
  const currentRole = account.role ?? 'ADMIN';
  const nextRole = draft.role ?? currentRole;
  if (nextRole === currentRole) return false;
  if (nextRole !== 'REQUESTER') return true;

  const businessUnit = account.businessUnit || draft.businessUnit || '';
  const team = (draft.requesterGroupId ?? '').trim() || (account.requesterGroupId ?? '');
  return !(team && !businessUnit);
}
