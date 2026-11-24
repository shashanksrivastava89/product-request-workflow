import { formatSubmittedDate } from '../utils/requestDates'
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util'
import { isReturnReviewerRole } from '../utils/return-approval.util'

/**
 * Requester, Submitter and Submitted: the first three tiles of every collapsed row in the Return
 * section, on every list and at every stage.
 *
 * Corlett Siobhan, 25 Sep 2026: *"It would be very helpful if the Requester, Submitter, and Submitted
 * Date could be displayed in the collapsed view at any stages."* The Requester is the rep the form
 * names; the Submitter is the account that entered it. A manager raising a request for a rep makes
 * them two different people, so both are always shown - not the second only when it differs, which
 * is how the rows used to hint at it. Same three, same place, whichever list the row is on.
 */
export function RequestPeopleTiles({
  requesterName,
  salesRepCode,
  submitterName,
  submittedAt,
  requesterTileClassName = 'bg-gray-50 rounded-lg p-2',
}: {
  requesterName?: string | null
  salesRepCode?: string | null
  submitterName?: string | null
  submittedAt?: string | null
  /** The approved list tints the requester when the row is somebody else's request. */
  requesterTileClassName?: string
}) {
  const requester = String(requesterName ?? '').trim()
    ? formatRequesterWithSalesRepCode(requesterName, salesRepCode)
    : '—'
  const submitter = String(submitterName ?? '').trim() || '—'
  return (
    <>
      <PeopleTile label="Requester" value={requester} className={requesterTileClassName} />
      <PeopleTile label="Submitter" value={submitter} />
      <PeopleTile label="Submitted" value={formatSubmittedDate(submittedAt)} />
    </>
  )
}

function PeopleTile({
  label,
  value,
  className = 'bg-gray-50 rounded-lg p-2',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-xs font-bold text-gray-900 truncate" title={value}>
        {value}
      </div>
    </div>
  )
}

type StageForm = {
  status?: string
  approvals?: Array<{ status: string; role: string }>
}

/**
 * Where a return stands, in words: at the service review, waiting on an approver, sent back, or
 * rejected. The status badge beside it says "In Progress" or "Rejected"; this says where.
 *
 * The Pending list now carries every Service case at every stage for the service team, so a row has
 * to say which stage it is at without being opened. Nothing for a draft being corrected - its badge
 * already says so - or while the approval path has not loaded.
 */
export function returnStageLabel(form: StageForm): string | null {
  const approvals = form.approvals ?? []
  if (form.status === 'REJECTED') {
    const step = approvals.find((a) => a.status === 'REJECTED')
    if (!step) return null
    return isReturnReviewerRole(step.role)
      ? 'サービス確認で差し戻し / Sent back at service review'
      : `却下 / Rejected by ${step.role}`
  }
  if (form.status === 'PENDING_APPROVAL' || form.status === 'IN_PROGRESS') {
    const step = approvals.find((a) => a.status === 'IN_PROGRESS')
    if (!step) return null
    return isReturnReviewerRole(step.role)
      ? 'サービス確認中 / At service review'
      : `承認待ち / Awaiting ${step.role}`
  }
  return null
}

export function ReturnStageChip({ form }: { form: StageForm }) {
  const label = returnStageLabel(form)
  if (!label) return null
  return (
    <span className="inline-block px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
      {label}
    </span>
  )
}

/** Is the request sitting at its service review step right now? */
export function isAtServiceReview(form: StageForm): boolean {
  if (form.status !== 'PENDING_APPROVAL' && form.status !== 'IN_PROGRESS') return false
  const step = (form.approvals ?? []).find((a) => a.status === 'IN_PROGRESS')
  return Boolean(step) && isReturnReviewerRole(step!.role)
}
