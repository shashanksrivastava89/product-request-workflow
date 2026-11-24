/**
 * Is this request on the viewer's Pending list?
 *
 * One rule for the list and for the Return home tile that counts it, so the number on the tile is
 * the number of rows the page shows. They had drifted apart: the tile counted only requests still
 * with the approvers, while the page also lists rejected ones and returns being corrected.
 *
 * - their own requests, and returns raised in their name by someone else (`requester`);
 * - for the service admin team, every Service case not yet approved (`reviewer`);
 * - still in flight, rejected, or reopened and being corrected (a draft with a reference number).
 */
export function isOnPendingList(
  r: {
    requesterId?: string
    pendingRelation?: 'requester' | 'reviewer'
    status?: string
    formType?: string
    referenceNumber?: string | null
  },
  userId: string | undefined
): boolean {
  const related =
    (!!userId && r.requesterId === userId) || r.pendingRelation === 'requester' || r.pendingRelation === 'reviewer'
  if (!related) return false
  return (
    r.status === 'PENDING_APPROVAL' ||
    r.status === 'IN_PROGRESS' ||
    r.status === 'REJECTED' ||
    (r.status === 'DRAFT' && r.formType === 'RETURN' && Boolean(r.referenceNumber))
  )
}
