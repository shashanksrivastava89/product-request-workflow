/**
 * The product lines as the request arrived, on demand.
 *
 * "was: 2 line(s) · Total Returns ¥128,000 · Total Re-billed ¥128,000" says that the lines changed
 * and what they came to, but never which lines they were — and a change of return type, business
 * unit or service flag empties the lines outright, withholding their Undo, because a CDG code
 * cannot be shown as an LSG one. The reviewer was then correcting away from something they could no
 * longer see. Asked for directly: *"what if it was 2 lines → any way to view the product lines
 * (can't be undone if BU changed)"* (10 Sep 2026).
 *
 * Closed by default: it is a record of what used to be there, not part of the form. Undoing the
 * upstream field still brings the lines themselves back — this is how you decide whether to.
 */
import { useI18n } from '../providers/I18nContext'
import { formatProductCodes } from '../utils/productCodes'
import { formatQuantity } from '../utils/numericInput'

export type ReturnPreviousProductLine = {
  id?: string
  productCode?: string | null
  productName?: string | null
  sapCode?: string | null
  lotNumber?: string | null
  quantity?: number | null
  returnAmount?: number | null
  rebillAmount?: number | null
}

export default function ReturnPreviousProductLines({
  lines,
  rebillAmountEditable = true,
  businessUnit,
  className = '',
}: {
  lines: ReturnPreviousProductLine[] | undefined
  /** Re-bill is not collected for every return type; when it is not, it is not shown as a total either. */
  rebillAmountEditable?: boolean
  /** CDG or LSG, so the codes read the same here as they do in the live row above. */
  businessUnit?: string | null
  className?: string
}) {
  const { t } = useI18n()
  if (!lines || lines.length === 0) return null

  return (
    <details className={`mt-1.5 ${className}`}>
      <summary className="cursor-pointer underline font-semibold hover:opacity-80 w-fit">
        {t('return.review.viewPreviousLines')} ({lines.length})
      </summary>
      <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50/60 divide-y divide-purple-100">
        {lines.map((p, i) => (
          <div key={p.id ?? i} className="flex items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">
                {p.productName || p.productCode || '—'}
              </div>
              <div className="text-gray-500">
                {formatProductCodes(p, '—', businessUnit)}
                {p.lotNumber ? ` · Batch / lot ${p.lotNumber}` : ''} · Qty {formatQuantity(p.quantity ?? 0)}
              </div>
            </div>
            <div className="shrink-0 text-right text-gray-700 space-y-0.5">
              <div>
                {t('return.form.returnAmount')}: ¥{(p.returnAmount ?? 0).toLocaleString()}
              </div>
              {rebillAmountEditable && (
                <div>
                  {t('return.form.rebillAmount')}: ¥{(p.rebillAmount ?? 0).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}
