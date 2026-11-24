/**
 * The partner / delivery panel shown inside an expanded request card.
 *
 * Why this exists: the three approval pages each carried their own copy of the same block, and all
 * three rendered a sample-shaped form — Sold-To, Ship-To, End User, Delivery Mode, Delivery Date. A
 * return has none of the last three (the wizard never asks for them), so an approved return showed
 * three empty dashes and none of the facts it *is* about. Reported from UAT as "the approved request
 * did not reflect Ship to, Delivery Mode, Delivery Date".
 *
 * So: one component, branching on form type. Sample types render exactly what they rendered before.
 * A return renders its partners plus the return's own fields — the SAP document type, the order it
 * reverses, why, and the dealer contact — which is what an approver needs to sign it off. The same
 * split already exists in the approval emails (renderCompactMailReturnRows) and on the return
 * confirmation page; this brings the in-app view into line with both.
 */
import { useState } from 'react'
import { BilingualFieldCaption } from './BilingualFieldCaption'
import { deliveryModeDisplayLabel } from '../utils/deliveryMode'
import { formatShipToLabel } from '../utils/shipToDisplay'
import { RETURN_TYPE_OPTIONS } from '../constants/returnTypes'
import { RETURN_ORDER_REASON_OPTIONS } from '../constants/returnOrderReasons'
import { formsApi, type ReviewEditRecord, type SubmissionRound } from '../services/api.service'
import ProductCodeLine from './ProductCodeLine'
import { formatQuantity } from '../utils/numericInput'

/**
 * The Service flag's name wherever it is shown, the same as on the form. Corlett Siobhan, 25 Sep 2026:
 * rename "Service" to "Service - TS有償作業WOと保守" so users can tell at once what the field is for.
 */
export const SERVICE_FIELD_LABEL = 'Service - TS有償作業WOと保守'

/** A request is a return when its form type says so; `purpose` is the older carrier of the same code. */
export function isReturnRequest(form: { formType?: string; purpose?: string } | null | undefined): boolean {
  const t = String(form?.formType ?? form?.purpose ?? '').trim().toUpperCase()
  return t === 'RETURN'
}

export function returnTypeLabel(code?: string | null): string {
  const key = String(code ?? '').trim()
  if (!key) return '—'
  return RETURN_TYPE_OPTIONS.find((o) => o.value === key)?.label || key
}

export function returnOrderReasonLabel(code?: string | null): string {
  const key = String(code ?? '').trim()
  if (!key) return '—'
  return RETURN_ORDER_REASON_OPTIONS.find((o) => o.value === key)?.label || key
}

/** Sum of the per-line credits, falling back to the stored total for anything that predates them. */
export function returnCreditTotal(form: { products?: any[]; totalAmount?: number }): number {
  const lines = Array.isArray(form.products) ? form.products : []
  if (lines.length === 0) return Number(form.totalAmount ?? 0)
  return lines.reduce((sum, p) => sum + Number(p?.returnAmount ?? 0), 0)
}

export function returnRebillTotal(form: { products?: any[] }): number {
  const lines = Array.isArray(form.products) ? form.products : []
  return lines.reduce((sum, p) => sum + Number(p?.rebillAmount ?? 0), 0)
}

const CELL = 'bg-gray-50 rounded-lg p-3'
const LABEL = 'text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'
const VALUE = 'text-xs font-bold text-gray-900'

function Cell({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${CELL}${wide ? ' md:col-span-2' : ''}`}>
      <div className={LABEL}>{label}</div>
      <div className={VALUE}>{children}</div>
    </div>
  )
}

function SectionHeading({ title, accent }: { title: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`w-1 h-4 rounded-full bg-gradient-to-b ${accent}`}></div>
      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{title}</h4>
    </div>
  )
}

/**
 * Partner and delivery (or, for a return, partner and return details).
 *
 * `accent` keeps the caller's colour so the Return section can read differently from Sample without
 * this component deciding the palette.
 */
export function PartnerAndDeliverySection({
  form,
  accent = 'from-[#00A651] to-[#008a42]',
}: {
  form: any
  accent?: string
}) {
  if (isReturnRequest(form)) {
    const contact = [form.dairitenContactName, form.dairitenContactEmail]
      .map((v: unknown) => String(v ?? '').trim())
      .filter(Boolean)
      .join(' · ')
    return (
      <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
        <SectionHeading title="Return details" accent={accent} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Cell label="Return type">{returnTypeLabel(form.returnType)}</Cell>
          <Cell label="Order reason">{returnOrderReasonLabel(form.orderReason)}</Cell>
          <Cell label="Original order no.">{form.originalOrderNumber || '—'}</Cell>
          <Cell label={(form.invoiceDates?.length ?? 0) > 1 ? 'Invoice dates' : 'Invoice date'}>
            {(form.invoiceDates?.length ?? 0) > 1
              ? form.invoiceDates!.join(' / ')
              : form.invoiceDate || '—'}
            {form.isStandingOrder ? ' (定期予約 / standing order)' : ''}
          </Cell>
          <Cell label="Quote ref no.">{form.quoteRefNo || '—'}</Cell>
          <Cell label={SERVICE_FIELD_LABEL}>{form.isService ? 'Yes' : 'No'}</Cell>
          <Cell label="Sold-To (Channel Partner)">
            {form.soldToName || '—'} {form.soldToCode ? `(${form.soldToCode})` : ''}
          </Cell>
          <Cell label="End User">
            {form.endUserName || '—'} {form.endUserCode ? `(${form.endUserCode})` : ''}
          </Cell>
          <Cell label="Dealer contact" wide>
            <span className="break-all">{contact || '—'}</span>
          </Cell>
          {/* Ship-To, Delivery Mode and Delivery Date are deliberately absent: a return does not
              collect them, and three empty dashes told an approver nothing. */}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      <SectionHeading title="Delivery Information" accent={accent} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Cell label="Sold-To (Channel Partner)">
          {form.soldToName || '—'} {form.soldToCode ? `(${form.soldToCode})` : ''}
        </Cell>
        <Cell label="Ship-To">{formatShipToLabel(form.shipToName, form.shipToCode)}</Cell>
        {form.attentionTo && (
          <div className={CELL}>
            <div className="mb-1">
              <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact />
            </div>
            <div className={VALUE}>{form.attentionTo}</div>
          </div>
        )}
        <Cell label="End User">
          {form.endUserName || '—'} {form.endUserCode ? `(${form.endUserCode})` : ''}
        </Cell>
        <Cell label="Delivery Mode">
          {deliveryModeDisplayLabel(form.deliveryMode, {
            shipToCode: form.shipToCode,
            formType: form.formType ?? form.purpose,
          })}
        </Cell>
        <Cell label="Delivery Date" wide>
          {form.expectedDeliveryDate === 'ASAP'
            ? 'ASAP'
            : form.expectedDeliveryDate
              ? new Date(form.expectedDeliveryDate).toLocaleDateString()
              : '—'}
        </Cell>
      </div>
    </div>
  )
}

/**
 * The requester's free text.
 *
 * A return justifies itself in `justification`; a sample uses `freeDescription`. Both are the
 * mandatory free-text reason, under different field names and labels, so show whichever applies.
 */
export function RequesterCommentsSection({
  form,
  accent = 'from-[#00A651] to-[#008a42]',
}: {
  form: any
  accent?: string
}) {
  const isReturn = isReturnRequest(form)
  const justification = String(form.justification ?? '').trim()
  const freeDescription = String(form.freeDescription ?? '').trim()
  const comments = String(form.commentsForApproval ?? '').trim()
  if (!comments && !freeDescription && !justification) return null

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      <SectionHeading title="Requester's comments" accent={accent} />
      <div className="space-y-3">
        {comments && (
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Comments for approval
            </p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{comments}</p>
          </div>
        )}
        {isReturn && justification && (
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Justification</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{justification}</p>
          </div>
        )}
        {!isReturn && freeDescription && (
          <div>
            <div className="mb-1">
              <BilingualFieldCaption labelKey="wizard.bilingual.freeSample" compact />
            </div>
            <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{freeDescription}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Product lines, with the credit and re-billed amounts a return turns on.
 *
 * The approved view showed no product table at all, so a return's whole point — how much is being
 * credited, and how much re-billed — was invisible until you printed it.
 */
export function ProductLinesSection({
  form,
  accent = 'from-[#00A651] to-[#008a42]',
}: {
  form: any
  accent?: string
}) {
  // `formDetails.products` is the shape the pending list gets from its own endpoint; the legacy
  // inline table read both, so this does too.
  const lines: any[] = Array.isArray(form?.products)
    ? form.products
    : Array.isArray(form?.formDetails?.products)
      ? form.formDetails.products
      : []
  if (lines.length === 0) return null
  const isReturn = isReturnRequest(form)

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      <SectionHeading title={`Products (${lines.length})`} accent={accent} />
      {/* overflow-x-auto: the return variant has six columns of yen and must scroll inside the card
          rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="py-2 pr-3 font-semibold">Product</th>
              <th className="py-2 pr-3 font-semibold">Batch / lot</th>
              <th className="py-2 pr-3 font-semibold text-right">Qty</th>
              <th className="py-2 pr-3 font-semibold text-right">Unit price</th>
              {isReturn ? (
                <>
                  <th className="py-2 pr-3 font-semibold text-right">Return</th>
                  <th className="py-2 font-semibold text-right">Re-bill</th>
                </>
              ) : (
                <th className="py-2 font-semibold text-right">Subtotal</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((p, i) => {
              const unit = Number(p.wholesalePrice ?? p.unitPrice ?? 0)
              return (
                <tr key={p.id || i}>
                  <td className="py-2 pr-3 font-bold text-gray-900">
                    {p.productName || '—'}
                    {/* Both codes, side by side under the name; "SAP: —" is a CDG number never imported. */}
                    <ProductCodeLine product={p} unit={form?.businessUnit} className="font-normal text-gray-500" />
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{String(p.lotNumber ?? '').trim() || '—'}</td>
                  <td className="py-2 pr-3 text-right text-gray-900">{formatQuantity(p.quantity)}</td>
                  <td className="py-2 pr-3 text-right text-gray-900">¥{unit.toLocaleString()}</td>
                  {isReturn ? (
                    <>
                      <td className="py-2 pr-3 text-right font-bold text-gray-900">
                        ¥{Number(p.returnAmount ?? 0).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-bold text-gray-900">
                        ¥{Number(p.rebillAmount ?? 0).toLocaleString()}
                      </td>
                    </>
                  ) : (
                    <td className="py-2 text-right font-bold text-gray-900">
                      ¥{Number(p.subtotal ?? unit * Number(p.quantity ?? 0)).toLocaleString()}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 font-bold text-gray-900">
            <tr>
              {/* Product, Lot, Qty, Unit price - then the money columns it totals. */}
              <td colSpan={4} className="py-2 pr-3 text-right">
                Total
              </td>
              {isReturn ? (
                <>
                  <td className="py-2 pr-3 text-right">¥{returnCreditTotal(form).toLocaleString()}</td>
                  <td className="py-2 text-right">¥{returnRebillTotal(form).toLocaleString()}</td>
                </>
              ) : (
                <td className="py-2 text-right">¥{Number(form.totalAmount ?? 0).toLocaleString()}</td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/**
 * Whether a form can carry an SAP sales order number.
 *
 * Service only, and only once approved: the number exists because the Service Admin team creates the
 * credit/return order in SAP *after* the chain completes (Corlett, 2 Sep). Emi asked to keep it off CS —
 * CS reads order numbers from the SAP document flow and wanted no extra manual entry after approval
 * — and agreed to it for Service alone.
 */
export function canCarrySalesOrderNumber(form: {
  formType?: string
  purpose?: string
  isService?: boolean | null
  status?: string
}): boolean {
  return isReturnRequest(form) && form.isService === true && form.status === 'APPROVED'
}

/**
 * The SAP sales order number, entered after every approval is in.
 *
 * Rendered as its own section after the Approval Path, which is where Corlett asked for it — she opens
 * the request from Approved Requests and types the number in once SAP has one. Everyone else sees it
 * read-only, so an approver or the requester can tell whether the order has been raised yet.
 */
export function SalesOrderNumberSection({
  form,
  canEdit = false,
  onSaved,
  accent = 'from-[#00A651] to-[#008a42]',
}: {
  form: any
  /** True for the Service Admin team; the endpoint enforces the same rule again server-side. */
  canEdit?: boolean
  onSaved?: (salesOrderNumber: string | null) => void
  accent?: string
}) {
  const stored = String(form.salesOrderNumber ?? '').trim()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canCarrySalesOrderNumber(form)) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = draft.trim()
      await formsApi.setSalesOrderNumber(form.id, next)
      // Keep the card in step with the server without refetching the whole list.
      form.salesOrderNumber = next || null
      onSaved?.(next || null)
      setEditing(false)
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not save the sales order number')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-[#00A651]/30">
      <SectionHeading title="SAP Sales Order Number" accent={accent} />
      {editing ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. 0091234567"
              maxLength={40}
              className="flex-1 min-w-[12rem] px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651]/40"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#00A651] hover:bg-[#008a42] rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(stored)
                setError(null)
                setEditing(false)
              }}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Leave it empty to clear the number. Entered after the credit/return order is created in SAP.
          </p>
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-lg font-mono font-bold ${stored ? 'text-gray-900' : 'text-gray-400'}`}>
            {stored || 'Not yet created in SAP'}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(stored)
                setEditing(true)
              }}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#00A651] hover:bg-[#008a42] rounded-lg"
            >
              {stored ? 'Edit' : 'Enter number'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What the Service Admin team changed while the request sat at the review step.
 *
 * The review window exists so a wrong service request can be corrected instead of rejected and
 * raised again from scratch. That means an approver may be signing off figures the requester never
 * submitted, so every edit is shown here and in the approver's email - otherwise the correction is
 * invisible to the people whose signature it changes.
 */
/**
 * The earlier submissions of a reopened return: who submitted each, who rejected it and why, who
 * approved before that, and who reopened it.
 *
 * This is what reopening keeps and a copy never had (Corlett Siobhan, 25 Sep): the corrected request
 * goes back through the approvers, and anyone looking at it can see what it was rejected for last
 * time and by whom. Renders nothing for a request that was never reopened.
 */
export function SubmissionHistorySection({
  history,
  accent = 'from-[#00A651] to-[#008a42]',
}: {
  history?: SubmissionRound[] | null
  accent?: string
}) {
  const rounds = Array.isArray(history) ? history : []
  if (rounds.length === 0) return null
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-red-200">
      <SectionHeading
        title={rounds.length === 1 ? 'Earlier submission' : `Earlier submissions (${rounds.length})`}
        accent={accent}
      />
      <div className="space-y-3">
        {[...rounds].reverse().map((r) => {
          const rejected = r.approvals.find((a) => a.status === 'REJECTED')
          const approved = r.approvals.filter((a) => a.status === 'APPROVED')
          return (
            <div key={r.round} className="bg-red-50/60 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-800">
                Submission {r.round}
                <span className="font-normal text-gray-600">
                  {' · submitted '}
                  {when(r.submittedAt)}
                  {r.submittedByName ? ` by ${r.submittedByName}` : ''}
                </span>
              </p>
              {approved.length > 0 && (
                <p className="text-xs text-gray-700">
                  Approved by {approved.map((a) => `${a.actualActorName ?? a.approverName} (${a.role})`).join(', ')}
                </p>
              )}
              {rejected && (
                <p className="text-xs font-semibold text-red-800">
                  <span lang="ja">差し戻し</span> / Rejected by {rejected.actualActorName ?? rejected.approverName} ({rejected.role})
                  <span className="font-normal text-red-700"> · {when(rejected.decidedAt)}</span>
                </p>
              )}
              {rejected?.comments?.trim() ? (
                <p className="text-xs text-red-900 whitespace-pre-wrap bg-white/70 rounded p-2">{rejected.comments}</p>
              ) : null}
              <p className="text-[11px] text-gray-500">
                Reopened {when(r.reopenedAt)}
                {r.reopenedByName ? ` by ${r.reopenedByName}` : ''}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ReviewEditTrailSection({
  reviewEdits,
  accent = 'from-[#00A651] to-[#008a42]',
  onDiscardAll,
  discarding = false,
}: {
  reviewEdits?: ReviewEditRecord[] | null
  accent?: string
  /**
   * Offered only to the review team, while the request is still at its step: discards every
   * correction and returns the request to what the requester submitted. The trail keeps the
   * history — the revert is recorded as a further entry, not by deleting the earlier ones.
   */
  onDiscardAll?: () => void
  discarding?: boolean
}) {
  const edits = Array.isArray(reviewEdits) ? reviewEdits : []
  if (edits.length === 0) return null

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-amber-300">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading title="Corrected during service review" accent={accent} />
        {onDiscardAll && (
          <button
            type="button"
            onClick={onDiscardAll}
            disabled={discarding}
            className="shrink-0 text-xs font-semibold text-red-700 border border-red-300 rounded-md px-2.5 py-1 hover:bg-red-50 disabled:opacity-60"
          >
            {discarding ? 'Discarding…' : 'Discard all corrections'}
          </button>
        )}
      </div>
      <div className="space-y-3">
        {edits.map((edit, i) => (
          <div key={i} className="bg-amber-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-700">
              {edit.changedByName}
              <span className="font-normal text-gray-600">
                {' · '}
                {new Date(edit.changedAt).toLocaleString()}
              </span>
            </p>
            <ul className="mt-2 space-y-1">
              {edit.fieldChanges.map((c, j) => (
                <li key={j} className="text-xs text-gray-800">
                  <span className="font-semibold">{c.field}:</span>{' '}
                  <span className="line-through text-gray-500">{c.oldValue ?? '—'}</span>{' '}
                  <span aria-hidden="true">{'→'}</span>{' '}
                  <span className="font-semibold">{c.newValue ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
