import { hasSuperApproverAccess } from './user-roles'

/**
 * Where a mail link should take a reader whose own list does not hold the linked request.
 *
 * The return mails link at the Pending and Approved lists with `?expand=<formId>`, and those lists
 * carry only the reader's own requests (plus what they approved or review). Administrators and super
 * approvers on copy of a mail landed on an empty page; every request is theirs to see in Data
 * Management, so the link opens it there - SubmittedRequestsListPanel reads the same `expand`
 * parameter. Anyone else gets null: the list stays and says why it is empty.
 */
export function dataManagementRequestLink(
  user: { role?: string | null; isSuperApprover?: boolean | null } | null | undefined,
  formId: string
): string | null {
  const role = user?.role ?? undefined
  if (role !== 'ADMIN' && !hasSuperApproverAccess(role, user?.isSuperApprover ?? undefined)) return null
  return `/admin/requests?expand=${encodeURIComponent(formId)}`
}
