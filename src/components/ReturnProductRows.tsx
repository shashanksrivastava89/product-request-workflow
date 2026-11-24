/**
 * The return wizard's product lines — one row per product, with the live catalogue lookup, both
 * codes, batch/lot, quantity and the return / re-bill amounts.
 *
 * Extracted from ReturnWizard so the service reviewer's screen renders EXACTLY these rows. The
 * reviewer used to get a hand-built grid whose columns did not line up with the wizard's, and any
 * later change to one would have drifted from the other. Now there is one row markup and two
 * callers: the wizard in green, the reviewer in purple.
 *
 * Purely presentational, index-based like the wizard's own handlers: the caller owns the product
 * list and supplies `onChangeProduct` (a code was picked), `onUpdateProduct` (any other field) and
 * `onRemoveProduct`. The quantity and amount inputs keep the wizard's exact behaviour — integer
 * only, no negatives, blank rather than a pre-seeded 0, quantity snapped back to 1 on blur.
 */

import type { ReactNode } from 'react'
import { useI18n } from '../providers/I18nContext'
import SearchSelect from './SearchSelect'
import {
  QUANTITY_DECIMALS,
  blockNegativeAndDecimal,
  normalizeNonNegativeInt,
  toNonNegativeInt,
} from '../utils/numericInput'
import QuantityInput from './QuantityInput'
import ProductCodeLine from './ProductCodeLine'

export type ReturnProductRowsAccent = 'green' | 'purple'

export type ReturnProductRowLine = {
  productCode: string
  sapCode?: string | null
  productName: string
  quantity: number
  lotNumber?: string | null
  returnAmount?: number | null
  rebillAmount?: number | null
}

type Option = { value: string; label: string; sub?: string }
type AsyncResult = Option[] | { options: Option[]; total?: number; hasMore?: boolean }

export type ReturnProductAsyncOptions = {
  load: (search: string) => Promise<AsyncResult>
  initialLoad?: () => Promise<AsyncResult>
  loadMore?: (offset: number) => Promise<AsyncResult>
}

/** The only patches these rows emit — so a caller's own product type needs none of the nulls above. */
export type ReturnProductRowPatch = Partial<{ lotNumber: string; quantity: number; returnAmount: number; rebillAmount: number }>

type Props<P extends ReturnProductRowLine> = {
  products: P[]
  accent?: ReturnProductRowsAccent
  /** Shown before the product code in the codes sub-cell, e.g. "CDG:" — the wizard shows the catalogue's unit. */
  businessUnitLabel: string
  /** Memoised by the caller: SearchSelect resets its list whenever these functions change identity. */
  productAsyncOptions: ReturnProductAsyncOptions
  /** The lookup is disabled until the catalogue's unit is known, exactly as in the wizard. */
  catalogsReady: boolean
  rebillAmountEditable: boolean
  /** Stable key per row — the wizard uses the line's id. */
  rowKey: (product: P, index: number) => string
  onChangeProduct: (index: number, code: string) => void
  onUpdateProduct: (index: number, patch: ReturnProductRowPatch) => void
  onRemoveProduct: (index: number) => void
  /** Validation message under the list, in the wizard's wording (see `returnProductsErrorKey`). */
  errorMessage?: ReactNode
  /** A line-level warning under the codes - the wizard flags a product that is no longer selectable. */
  lineNotice?: (product: P, index: number) => ReactNode
}

/*
 * Full literal class strings per accent so Tailwind's scanner finds every class; a class assembled
 * at runtime would never be generated.
 */
const ACCENT = {
  green: {
    number: 'flex-shrink-0 w-8 h-8 bg-[#00A651] text-white rounded-full flex items-center justify-center font-bold text-sm mt-1',
    yen: 'absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#00A651]',
    amount: 'no-spinner border border-gray-300 rounded pl-5 pr-2 py-1 w-full text-sm font-semibold text-[#00A651]',
  },
  purple: {
    number: 'flex-shrink-0 w-8 h-8 bg-[#9333EA] text-white rounded-full flex items-center justify-center font-bold text-sm mt-1',
    yen: 'absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#9333EA]',
    amount: 'no-spinner border border-gray-300 rounded pl-5 pr-2 py-1 w-full text-sm font-semibold text-[#9333EA]',
  },
} as const

/** The wizard's "Add product" button, per accent, so a caller's header matches the wizard's. */
export const RETURN_PRODUCT_ADD_BUTTON_CLASS: Record<ReturnProductRowsAccent, string> = {
  green:
    'px-4 py-2 border-2 border-[#00A651] text-[#00A651] rounded-lg font-medium hover:bg-[#00A651] hover:text-white transition-all duration-200 shadow-sm hover:shadow btn-press',
  purple:
    'px-4 py-2 border-2 border-[#9333EA] text-[#9333EA] rounded-lg font-medium hover:bg-[#9333EA] hover:text-white transition-all duration-200 shadow-sm hover:shadow btn-press',
}

/** Empty rather than a pre-seeded 0: typing into a box already containing "0" produced "0123". */
export function amountFieldValue(amount: number | null | undefined): number | string {
  return amount === undefined || amount === null || amount === 0 ? '' : amount
}

/**
 * The wizard's product validity rule, verbatim: at least one line, every line with a code, a
 * quantity of at least 1 and non-negative amounts (re-bill only when the return type allows it).
 */
export function areReturnProductsValid(products: ReturnProductRowLine[], rebillAmountEditable: boolean): boolean {
  return (
    products.length > 0 &&
    products.every(
      (p) =>
        Boolean(p.productCode?.trim()) &&
        // Positive, not "at least one": a service line can legitimately be 0.5 hours.
        p.quantity > 0 &&
        (p.returnAmount ?? 0) >= 0 &&
        (rebillAmountEditable ? (p.rebillAmount ?? 0) >= 0 : true)
    )
  )
}

/** Which of the wizard's three product error messages applies, or null when the lines are valid. */
export function returnProductsErrorKey(
  products: ReturnProductRowLine[],
  rebillAmountEditable: boolean
): 'return.form.error.productRequired' | 'return.form.error.productIncomplete' | 'return.form.error.productAmounts' | null {
  if (areReturnProductsValid(products, rebillAmountEditable)) return null
  if (products.length === 0) return 'return.form.error.productRequired'
  if (products.some((p) => !p.productCode?.trim() || p.quantity <= 0)) return 'return.form.error.productIncomplete'
  return 'return.form.error.productAmounts'
}

export default function ReturnProductRows<P extends ReturnProductRowLine>({
  products,
  accent = 'green',
  businessUnitLabel,
  productAsyncOptions,
  catalogsReady,
  rebillAmountEditable,
  rowKey,
  onChangeProduct,
  onUpdateProduct,
  onRemoveProduct,
  errorMessage,
  lineNotice,
}: Props<P>) {
  const { t, tBilingual } = useI18n()
  const a = ACCENT[accent]
  // Customer Service's Japanese over the English, as on their mock-up: 返金 above TOTAL RETURNS.
  const returnAmountLabel = tBilingual('return.form.returnAmount')
  const rebillAmountLabel = tBilingual('return.form.rebillAmount')

  return (
    <>
      {products.length > 0 && (
        <div className="bg-white border-2 border-gray-200 rounded-xl shadow-sm divide-y divide-gray-200">
          {products.map((p, idx) => (
            <div key={rowKey(p, idx)} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-4">
                <div className={a.number}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-4">
                      <SearchSelect
                        key={`product-${idx}-${businessUnitLabel || 'none'}`}
                        asyncOptions={productAsyncOptions}
                        value={p.productCode || null}
                        onChange={(val) => onChangeProduct(idx, (val as string) || '')}
                        placeholder={catalogsReady ? 'Select product...' : t('return.form.selectBuFirst')}
                        disabled={!catalogsReady}
                        fallbackLabel={p.productCode ? (p.productName ? `${p.productName}` : p.productCode) : undefined}
                        hideSelectedSub
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                        Batch / lot #
                      </label>
                      <input
                        type="text"
                        className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                        placeholder="Optional"
                        value={p.lotNumber ?? ''}
                        onChange={(e) => onUpdateProduct(idx, { lotNumber: e.target.value })}
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                        Qty
                      </label>
                      <QuantityInput
                        value={p.quantity}
                        onChange={(quantity) => onUpdateProduct(idx, { quantity })}
                        onSnapBack={() => onUpdateProduct(idx, { quantity: 1 })}
                        decimals={QUANTITY_DECIMALS}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                        <span className="block" lang="ja">
                          {returnAmountLabel.jp}
                        </span>
                        {returnAmountLabel.en}
                      </label>
                      <div className="relative">
                        <span className={a.yen}>¥</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className={a.amount}
                          value={amountFieldValue(p.returnAmount)}
                          onKeyDown={blockNegativeAndDecimal}
                          onChange={(e) => onUpdateProduct(idx, { returnAmount: toNonNegativeInt(e.target.value) })}
                          onBlur={() =>
                            onUpdateProduct(idx, { returnAmount: normalizeNonNegativeInt(p.returnAmount ?? undefined) })
                          }
                        />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                        <span className="block" lang="ja">
                          {rebillAmountLabel.jp}
                        </span>
                        {rebillAmountLabel.en}
                      </label>
                      {rebillAmountEditable ? (
                        <div className="relative">
                          <span className={a.yen}>¥</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className={a.amount}
                            value={amountFieldValue(p.rebillAmount)}
                            onKeyDown={blockNegativeAndDecimal}
                            onChange={(e) => onUpdateProduct(idx, { rebillAmount: toNonNegativeInt(e.target.value) })}
                            onBlur={() =>
                              onUpdateProduct(idx, { rebillAmount: normalizeNonNegativeInt(p.rebillAmount ?? undefined) })
                            }
                          />
                        </div>
                      ) : (
                        <>
                          <div className="border border-gray-200 bg-gray-50 rounded px-2 py-1 w-full text-sm font-semibold text-gray-500 text-right">
                            ¥0
                          </div>
                          {/* A reviewer reported "I can not entry this fields" and assumed he had done
                              something wrong. The lock is correct for this return type; it just never
                              said so. */}
                          <p className="mt-0.5 text-[10px] leading-tight text-gray-500">{t('return.form.rebillLocked')}</p>
                        </>
                      )}
                    </div>
                    <div className="col-span-1 text-right pb-1">
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-700 p-1"
                        onClick={() => onRemoveProduct(idx)}
                        aria-label="Remove product"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Its codes side by side, directly under the product name the picker shows. */}
                  {p.productCode ? (
                    <div className="grid grid-cols-12 gap-3">
                      <ProductCodeLine product={p} unit={businessUnitLabel} className="col-span-4 mt-1 text-xs text-gray-600" />
                    </div>
                  ) : null}
                  {lineNotice?.(p, idx) ? <p className="mt-1 text-xs font-medium text-red-700">{lineNotice(p, idx)}</p> : null}
                  {p.productCode ? <p className="mt-2 text-xs text-red-600">{t('return.form.standardPriceNotice')}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {errorMessage ? <p className="mt-2 text-xs text-red-600">{errorMessage}</p> : null}
    </>
  )
}
