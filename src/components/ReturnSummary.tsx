/**
 * The return request summary — the card grid a requester sees at step 3 of the wizard.
 *
 * Extracted so the service reviewer's screen can show EXACTLY the same summary. Before this the
 * reviewer got a plain form of labelled inputs that looked nothing like what the requester had just
 * confirmed, and any later change to one would have drifted from the other. One component, two
 * callers: the wizard renders it read-only in green; the reviewer renders it in purple with every
 * tile's editor open.
 *
 * Purely presentational. It takes a view-model (`values`) rather than the wizard's form state, so
 * the reviewer can feed it a stored request, and the parent owns every editor: in edit mode each
 * tile shows the control the parent supplies through `renderEditor` (the wizard's own control for
 * that field), and the product rows come through `renderProductsEditor`. A tile whose `previous`
 * value is given shows it as "was: …" with an Undo beside it — that line, not a pencil, is how a
 * reviewer knows what they have changed.
 *
 * The per-field colours (blue Sold-To, purple End User, teal contacts, orange order / invoice /
 * quote) are part of what makes it read as "the same summary", so they are kept in both accents;
 * only the primary green swaps for purple.
 */

import type { ReactNode } from 'react'
import { useI18n } from '../providers/I18nContext'
import { formatProductCodes } from '../utils/productCodes'
import ReturnPreviousProductLines, { type ReturnPreviousProductLine } from './ReturnPreviousProductLines'
import { formatQuantity } from '../utils/numericInput'

export type ReturnSummaryProduct = {
  id?: string
  productCode: string
  productName: string
  sapCode?: string | null
  lotNumber?: string | null
  quantity: number
  returnAmount?: number | null
  rebillAmount?: number | null
}

export type ReturnSummaryValues = {
  returnTypeLabel: string
  requestDate: string
  /** Service-related return: what puts the P&OP review step in front of the chain. */
  isService: boolean
  businessUnit: string
  requesterDisplay: string
  soldToName: string
  soldToCode: string
  endUserName: string
  endUserCode: string
  dairitenContactName: string
  dairitenContactEmail: string
  originalOrderNumber: string
  invoiceDate: string
  /** 定期予約 / standing order: several invoice dates on one request. `invoiceDate` is the first. */
  isStandingOrder: boolean
  invoiceDates: string[]
  quoteRefNo: string
  orderReasonLabel: string
  justification: string
  products: ReturnSummaryProduct[]
  returnTotal: number
  rebillTotal: number
  rebillAmountEditable: boolean
  /** The route, requester first. `isReviewer` marks the service review step, shown differently. */
  timeline: { num: number; role: string; name: string; isReviewer?: boolean }[]
}

/** The tiles a reviewer may correct — every field of the form; the route follows the last three. */
export type ReturnSummaryField =
  | 'returnType'
  | 'requestDate'
  | 'isService'
  | 'businessUnit'
  | 'requester'
  | 'soldTo'
  | 'endUser'
  | 'dairitenContactName'
  | 'dairitenContactEmail'
  | 'originalOrderNumber'
  | 'invoiceDate'
  | 'quoteRefNo'
  | 'orderReason'
  | 'justification'

export type ReturnSummaryAccent = 'green' | 'purple'

/**
 * Headings for the two groups the tiles fall into, when the caller wants them shown.
 *
 * The tiles are already in the wizard's own order - everything from step 1, then everything from
 * step 2 - so grouping them is a matter of naming the seam. The reviewer's screen names it, to read
 * like the form the requester filled; the wizard's own step 3 leaves it unnamed, because the person
 * looking at it has just walked both steps and does not need telling where they were.
 */
export type ReturnSummaryStepGroups = { one: string; two: string }

type Props = {
  values: ReturnSummaryValues
  /** When set, the tiles are split into two named groups instead of one flat grid. */
  stepGroups?: ReturnSummaryStepGroups
  accent?: ReturnSummaryAccent
  /** Card heading. The wizard passes its "Summary" label; the reviewer passes its own. */
  title: string
  /** Show every tile's editor in place of its value. */
  editable?: boolean
  /** The control for a field, shown in its tile while `editable`. */
  renderEditor?: (field: ReturnSummaryField) => ReactNode
  /** Display strings for tiles whose value has changed, shown as "was: …". */
  previous?: Partial<Record<ReturnSummaryField, string>>
  /** Replaces the read-only product list while editing. */
  renderProductsEditor?: () => ReactNode
  /** Reverts one tile to the value it was loaded with; shown as "Undo" beside its "was: …" line. */
  onUndo?: (field: ReturnSummaryField) => void
  /**
   * Whether a field's Undo can be honoured. A value cleared because something upstream changed
   * cannot be put back on its own — a Sold-To or a product line belongs to one business unit's
   * catalogue — so the parent withholds those until the upstream change is undone.
   */
  canUndo?: (field: ReturnSummaryField) => boolean
  /** Validation messages, in the wizard's wording, under the tile they belong to. */
  errors?: Partial<Record<ReturnSummaryField | 'products', string>>
  /** The product lines as they were loaded, as a display string, when they have changed. */
  productsPrevious?: string
  /** The lines as the request arrived, shown on demand beside the "was" line. */
  productsPreviousLines?: ReturnPreviousProductLine[]
  onUndoProducts?: () => void
  /** The route as it stood before a correction changed it, shown as "was: …" under the hierarchy. */
  timelinePrevious?: string
  /** A note under the hierarchy, e.g. that the route is rebuilt from the corrected fields. */
  /** Why no route can be built as things stand — the requester has no row in the matrix. */
  timelineError?: string
}

/*
 * Full literal class strings, one set per accent, so Tailwind's scanner finds every class. A class
 * assembled from a template string at runtime would never be generated.
 */
const ACCENT = {
  green: {
    icon: 'w-5 h-5 text-[#00A651]',
    circle: 'w-10 h-10 rounded-full bg-[#00A651] bg-opacity-10 flex items-center justify-center',
    tile: 'bg-white rounded-xl p-4 border-2 border-gray-200 hover:border-[#00A651] transition-colors relative',
    totals: 'text-sm font-bold text-[#00A651] text-right space-y-0.5',
    dot: 'absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#00A651] border-2 border-white shadow-sm z-10 flex items-center justify-center',
    productsBox: 'mt-4 bg-white rounded-xl p-4 border-2 border-emerald-200',
    productsCircle: 'w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center',
    productsIcon: 'w-5 h-5 text-emerald-600',
    was: 'text-xs text-[#00A651] mt-1',
    undo: 'ml-2 underline font-semibold hover:opacity-80',
    groupHeading: 'text-[#00A651]',
  },
  purple: {
    icon: 'w-5 h-5 text-[#9333EA]',
    circle: 'w-10 h-10 rounded-full bg-[#9333EA] bg-opacity-10 flex items-center justify-center',
    tile: 'bg-white rounded-xl p-4 border-2 border-gray-200 hover:border-[#9333EA] transition-colors relative',
    totals: 'text-sm font-bold text-[#9333EA] text-right space-y-0.5',
    dot: 'absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#9333EA] border-2 border-white shadow-sm z-10 flex items-center justify-center',
    productsBox: 'mt-4 bg-white rounded-xl p-4 border-2 border-purple-200',
    productsCircle: 'w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center',
    productsIcon: 'w-5 h-5 text-purple-600',
    was: 'text-xs text-[#9333EA] mt-1',
    undo: 'ml-2 underline font-semibold hover:opacity-80',
    groupHeading: 'text-[#9333EA]',
  },
} as const

/* Per-field tile colours, identical in both accents — they are what makes this read as the same summary. */
const SEMANTIC = {
  blue: {
    tile: 'bg-white rounded-xl p-4 border-2 border-blue-200 hover:border-blue-500 transition-colors relative',
    circle: 'w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center',
    icon: 'w-5 h-5 text-blue-600',
  },
  purple: {
    tile: 'bg-white rounded-xl p-4 border-2 border-purple-200 hover:border-purple-500 transition-colors relative',
    circle: 'w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center',
    icon: 'w-5 h-5 text-purple-600',
  },
  teal: {
    tile: 'bg-white rounded-xl p-4 border-2 border-teal-200 hover:border-teal-500 transition-colors relative',
    circle: 'w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center',
    icon: 'w-5 h-5 text-teal-600',
  },
  orange: {
    tile: 'bg-white rounded-xl p-4 border-2 border-orange-200 hover:border-orange-500 transition-colors relative',
    circle: 'w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center',
    icon: 'w-5 h-5 text-orange-600',
  },
} as const

/* Icon paths, copied verbatim from the wizard so the two renderings are pixel-identical. */
const PATHS = {
  info: 'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z',
  type: [
    'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z',
    'M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z',
  ],
  calendar:
    'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z',
  building:
    'M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z',
  person: 'M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z',
  people:
    'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z',
  mail: [
    'M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z',
    'M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z',
  ],
  document:
    'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z',
  tag: 'M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z',
  flag: 'M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z',
  cog: 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
  cart: 'M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  chat: 'M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z',
} as const

/** The review step's dot, purple in both accents — it is the same act on either screen. */
const REVIEWER_DOT =
  'absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#9333EA] border-2 border-white shadow-sm z-10 flex items-center justify-center'

function Icon({ className, d }: { className: string; d: string | readonly string[] }) {
  const paths = Array.isArray(d) ? d : [d as string]
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      {paths.map((p, i) =>
        // The wizard draws multi-path icons with evenodd on the second path; single paths plain.
        paths.length > 1 && i > 0 ? (
          <path key={i} fillRule="evenodd" d={p} clipRule="evenodd" />
        ) : (
          <path key={i} fillRule={paths.length === 1 ? 'evenodd' : undefined} d={p} clipRule={paths.length === 1 ? 'evenodd' : undefined} />
        )
      )}
    </svg>
  )
}

export default function ReturnSummary({
  values: v,
  accent = 'green',
  stepGroups,
  title,
  editable = false,
  renderEditor,
  previous,
  renderProductsEditor,
  onUndo,
  canUndo,
  errors,
  productsPrevious,
  productsPreviousLines,
  onUndoProducts,
  timelinePrevious,
  timelineError,
}: Props) {
  const { t } = useI18n()
  const a = ACCENT[accent]
  const groupHeading = (text: string) => (
    <div className={`col-span-2 md:col-span-3 flex items-center gap-2 ${a.groupHeading}`}>
      <span className="text-xs font-bold uppercase tracking-wide">{text}</span>
      <span className="flex-1 h-px bg-current opacity-20" />
    </div>
  )

  /** The "was: …" line with its Undo, shared by the tiles, the products box and the justification. */
  const wasLine = (
    was: string | undefined,
    undo?: () => void,
    extraClass = '',
    /** Rendered inside the line, so it inherits the accent — the products box hangs its lines here. */
    extra?: ReactNode
  ) =>
    was === undefined ? null : (
      <div className={`${a.was}${extraClass}`}>
        {t('return.review.was')} {was || '—'}
        {undo && (
          <button type="button" onClick={undo} className={a.undo}>
            {t('return.review.undo')}
          </button>
        )}
        {extra}
      </div>
    )

  /**
   * One tile. `field` names the form field the tile shows; `tone` picks the per-field colour,
   * defaulting to the primary accent. In edit mode the value gives way to the parent's editor for
   * that field, and a "was:" line appears beneath once the value differs from what was loaded.
   */
  const tile = (
    key: string,
    label: string,
    icon: string | readonly string[],
    value: ReactNode,
    opts: { field?: ReturnSummaryField; tone?: keyof typeof SEMANTIC; sub?: ReactNode; block?: boolean } = {}
  ) => {
    const s = opts.tone ? SEMANTIC[opts.tone] : null
    const field = opts.field
    const editor = editable && renderEditor && field !== undefined
    const was = field !== undefined ? previous?.[field] : undefined
    const error = field !== undefined ? errors?.[field] : undefined
    return (
      <div
        key={key}
        // Read by the reviewer's "jump to the first empty field". The Sample wizard emits the same
        // kind of marker on its own fields; this is the summary's equivalent, and until now the
        // return side emitted markers nothing ever read.
        data-return-summary-field={field}
        className={`${s ? s.tile : a.tile}${error ? ' !border-red-400' : ''}`}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className={s ? s.circle : a.circle}>
            <Icon className={s ? s.icon : a.icon} d={icon} />
          </div>
          <div className="text-xs text-gray-500 font-medium uppercase">{label}</div>
        </div>
        {editor ? (
          <div className="text-sm">{renderEditor(field)}</div>
        ) : (
          <>
            <div className={opts.block ? 'text-sm text-gray-900 whitespace-pre-wrap' : 'text-sm font-semibold text-gray-900'}>
              {value}
            </div>
            {opts.sub}
          </>
        )}
        {wasLine(
          was,
          onUndo && field !== undefined && (!canUndo || canUndo(field)) ? () => onUndo(field) : undefined
        )}
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Icon className={a.icon} d={PATHS.info} />
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stepGroups && groupHeading(stepGroups.one)}
        {tile('type', t('return.summary.type'), PATHS.type, v.returnTypeLabel, { field: 'returnType' })}
        {tile('date', t('return.summary.date'), PATHS.calendar, v.requestDate || '—', { field: 'requestDate' })}
        {tile(
          'service',
          t('return.form.serviceRequest'),
          PATHS.cog,
          v.isService ? t('return.form.serviceYes') : t('return.form.serviceNo'),
          { field: 'isService' }
        )}
        {tile('bu', t('return.summary.businessUnit'), PATHS.building, v.businessUnit || '—', { field: 'businessUnit' })}
        {tile('requester', t('return.summary.requester'), PATHS.person, v.requesterDisplay, { field: 'requester' })}
        {stepGroups && groupHeading(stepGroups.two)}
        {tile('soldTo', t('return.summary.soldTo'), PATHS.building, v.soldToName || '—', {
          field: 'soldTo',
          tone: 'blue',
          sub: v.soldToCode ? <div className="text-xs text-gray-600 mt-1">{v.soldToCode}</div> : null,
        })}
        {tile('endUser', t('return.summary.endUser'), PATHS.people, v.endUserName || '—', {
          field: 'endUser',
          tone: 'purple',
          sub: v.endUserCode ? <div className="text-xs text-gray-600 mt-1">{v.endUserCode}</div> : null,
        })}
        {tile('contact', t('return.summary.dairitenContact'), PATHS.person, v.dairitenContactName || '—', {
          field: 'dairitenContactName',
          tone: 'teal',
        })}
        {tile('contactEmail', t('return.summary.dairitenEmail'), PATHS.mail, v.dairitenContactEmail || '—', {
          field: 'dairitenContactEmail',
          tone: 'teal',
        })}
        {tile('orderNumber', t('return.summary.orderNumber'), PATHS.document, v.originalOrderNumber || '—', {
          field: 'originalOrderNumber',
          tone: 'orange',
        })}
        {tile(
          'invoiceDate',
          t('return.summary.invoiceDate'),
          PATHS.calendar,
          v.isStandingOrder ? v.invoiceDates.filter(Boolean).join(', ') || v.invoiceDate || '—' : v.invoiceDate || '—',
          {
            field: 'invoiceDate',
            tone: 'orange',
            sub: v.isStandingOrder ? <div className="text-xs text-gray-600 mt-1">{t('return.form.standingOrder')}</div> : null,
          }
        )}
        {tile('quoteRef', t('return.summary.quoteRef'), PATHS.tag, v.quoteRefNo.trim() || '—', {
          field: 'quoteRefNo',
          tone: 'orange',
        })}
        {tile('orderReason', t('return.summary.orderReason'), PATHS.flag, v.orderReasonLabel, { field: 'orderReason' })}
      </div>

      <div className={a.productsBox} data-return-summary-field="products">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className={a.productsCircle}>
              <Icon className={a.productsIcon} d={PATHS.cart} />
            </div>
            <div className="text-xs text-gray-500 font-medium uppercase">
              {t('return.summary.products')} ({v.products.length})
            </div>
          </div>
          <div className={a.totals}>
            <div>
              {t('return.form.returnAmountTotal')}: ¥{v.returnTotal.toLocaleString()}
            </div>
            <div>
              {t('return.form.rebillAmountTotal')}: ¥{v.rebillTotal.toLocaleString()}
            </div>
          </div>
        </div>
        {/* A count and two totals do not say WHICH lines. The disclosure does. */}
        {wasLine(
          productsPrevious,
          onUndoProducts,
          ' mb-2',
          <ReturnPreviousProductLines
            lines={productsPreviousLines}
            rebillAmountEditable={v.rebillAmountEditable}
            businessUnit={v.businessUnit}
          />
        )}
        {editable && renderProductsEditor ? (
          renderProductsEditor()
        ) : v.products.length === 0 ? (
          <div className="text-sm text-gray-500">—</div>
        ) : (
          <div className="space-y-2">
            {v.products.map((p, i) => (
              <div
                key={p.id ?? i}
                className="flex items-center justify-between gap-3 text-sm border-t border-gray-100 pt-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">
                    {p.productName || p.productCode || '—'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatProductCodes(p, '—', v.businessUnit)}
                    {p.lotNumber ? ` · Batch / lot ${p.lotNumber}` : ''} · Qty {formatQuantity(p.quantity)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs sm:text-sm space-y-0.5">
                  <div className="font-semibold text-gray-800">
                    {t('return.form.returnAmount')}: ¥{(p.returnAmount ?? 0).toLocaleString()}
                  </div>
                  <div className="font-semibold text-gray-800">
                    {t('return.form.rebillAmount')}: ¥
                    {(v.rebillAmountEditable ? p.rebillAmount ?? 0 : 0).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {errors?.products && <div className="text-xs text-red-600 mt-2">{errors.products}</div>}
      </div>

      <div className="mt-4 bg-white rounded-xl p-4 border-2 border-gray-200 relative">
        <div className="flex items-center gap-3 mb-2">
          <div className={a.circle}>
            <Icon className={a.icon} d={PATHS.chat} />
          </div>
          <div className="text-xs text-gray-500 font-medium uppercase">{t('return.summary.justification')}</div>
        </div>
        {editable && renderEditor ? (
          <div className="text-sm">{renderEditor('justification')}</div>
        ) : (
          <div className="text-sm text-gray-900 whitespace-pre-wrap">{v.justification.trim() || '—'}</div>
        )}
        {wasLine(previous?.justification, onUndo ? () => onUndo('justification') : undefined)}
        {errors?.justification && <div className="text-xs text-red-600 mt-1">{errors.justification}</div>}
      </div>

      {v.timeline.length > 0 && (
        <div className="mt-4 bg-white border-2 border-gray-200 rounded-xl p-5 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-3">{t('return.form.hierarchy')}</h4>
          <div className="space-y-3 relative">
            <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gray-200" />
            {/* The review step reads as any other step; only its number is purple, marking it as
                a check rather than an approval. */}
            {v.timeline.map((approver) => (
              <div key={`${approver.role}-${approver.num}`} className="relative pl-8">
                <div className={approver.isReviewer ? REVIEWER_DOT : a.dot}>
                  <span className="text-[10px] text-white font-bold">{approver.num}</span>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {approver.isReviewer ? t('return.form.reviewerRole') : approver.role}
                  </div>
                  <div className="text-sm font-semibold text-gray-800">{approver.name}</div>
                </div>
              </div>
            ))}
          </div>
          {wasLine(timelinePrevious, undefined, ' mt-3')}
          {timelineError && <div className="text-xs text-red-600 mt-2">{timelineError}</div>}
        </div>
      )}
    </div>
  )
}
