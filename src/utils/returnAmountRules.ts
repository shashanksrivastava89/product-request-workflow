import type { ReturnTypeCode } from '../constants/returnTypes'
import type { ProductItem } from '../providers/FormContext'

export type ReturnAmountRules = {
  returnAmountEditable: boolean
  rebillAmountEditable: boolean
}

/** Editability of 返品合計 / 再請求合計 by return type (spec §8 Product–Amount). */
export function getReturnAmountRules(returnType: ReturnTypeCode | ''): ReturnAmountRules {
  switch (returnType) {
    case 'ZCMR_ZDMR':
    case 'ZRE_ZOR':
      return { returnAmountEditable: true, rebillAmountEditable: true }
    case 'ZCMR':
    case 'ZRE':
      return { returnAmountEditable: true, rebillAmountEditable: false }
    default:
      return { returnAmountEditable: true, rebillAmountEditable: false }
  }
}

/**
 * Yen are whole numbers, whatever the quantity is.
 *
 * Quantities became decimal so service work can be booked in hours, which is the first time a line
 * total could carry a fraction: 12,500 x 0.035 = 437.5. Vidhi Parsons asked for totals "not to be
 * .xx", so each line is rounded and the totals are sums of whole yen - the figure a reader gets by
 * adding up the rows. Round half up; with whole quantities this and the old `Math.floor` agree on
 * every figure the system has ever stored. Mirrored in backend/src/utils/money.util.ts.
 */
export function roundYen(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.round(amount))
}

export function catalogLineTotal(item: Pick<ProductItem, 'quantity' | 'unitPrice' | 'wholesalePrice'>): number {
  const price = item.wholesalePrice ?? item.unitPrice
  return roundYen((item.quantity || 0) * (price || 0))
}

/** What an amount means per unit at this quantity; undefined while there is no quantity. */
export function unitBasis(amount: number | null | undefined, quantity: number | null | undefined): number | undefined {
  const a = Number(amount)
  const q = Number(quantity)
  if (!Number.isFinite(a) || a < 0 || !(q > 0)) return undefined
  return a / q
}

/**
 * Is a typed (or loaded) amount an overwritten one, and what does it mean per unit?
 *
 * Only a figure that differs from what the catalogue gives the line counts. Leaving an amount box
 * re-sends the figure already there, and that used to mark it overwritten just by tabbing through -
 * after which it stopped following the catalogue. A loaded line is judged the same way instead of
 * every one of its amounts being taken as hand-typed.
 */
export function overrideState(
  amount: number,
  item: Pick<ProductItem, 'quantity' | 'unitPrice' | 'wholesalePrice'>
): { overridden: boolean; basis: number | undefined } {
  const overridden = amount !== catalogLineTotal(item)
  return { overridden, basis: overridden ? unitBasis(amount, item.quantity) : undefined }
}

/**
 * A hand-typed amount follows the quantity instead of being thrown away.
 *
 * Changing the quantity used to reset both amounts to the catalogue default, discarding whatever the
 * requester had typed, so an overwritten figure is treated as a per-unit amount and scaled with the
 * quantity - 9,000 at qty 1 becomes 18,000 at qty 2. An amount nobody overwrote still recalculates
 * from the catalogue price, which is the untouched path.
 *
 * It scales from the per-unit basis recorded when the amount was typed, not from the previous total.
 * The quantity box commits every keystroke, so retyping "1" as "2" passes through an empty box, 0,
 * and scaling from the previous quantity had nothing to scale from at either step: Damian Diggin's
 * 30 Sep test overwrote the re-bill to 9,000 at qty 1, changed the qty to 2, and the re-bill stayed
 * 9,000 while the untouched return rose to 20,000. While the quantity is 0 nothing is rescaled; the
 * basis carries the amount to whatever is typed next. It never compounds rounding either.
 */
export function scaleOverriddenAmounts(prev: ProductItem, next: ProductItem): ProductItem {
  const to = Number(next.quantity ?? 0)
  if (!(to > 0)) return next

  const out = { ...next }
  if (prev.returnAmountOverridden === true) {
    // No basis recorded (typed while the box was empty): the amount stands for the new quantity.
    const basis =
      prev.returnUnitBasis ?? unitBasis(prev.returnAmount, prev.quantity) ?? unitBasis(prev.returnAmount, to)
    if (basis !== undefined) {
      out.returnAmount = roundYen(basis * to)
      out.returnUnitBasis = basis
    }
  }
  if (prev.rebillAmountOverridden === true) {
    const basis =
      prev.rebillUnitBasis ?? unitBasis(prev.rebillAmount, prev.quantity) ?? unitBasis(prev.rebillAmount, to)
    if (basis !== undefined) {
      out.rebillAmount = roundYen(basis * to)
      out.rebillUnitBasis = basis
    }
  }
  return out
}

/**
 * Apply default / locked amounts after a product, price or quantity change.
 *
 * An overwritten amount is kept - already scaled to the new quantity by scaleOverriddenAmounts -
 * unless `resetOverrides` is set (a different product or price: the figure no longer belongs to the
 * line it was typed for) or the re-bill is locked to ¥0 for this return type. Everything else is the
 * catalogue total.
 */
export function applyReturnAmountDefaults(
  item: ProductItem,
  returnType: ReturnTypeCode | '',
  options?: { resetOverrides?: boolean }
): ProductItem {
  const rules = getReturnAmountRules(returnType)
  const catalogTotal = catalogLineTotal(item)
  const reset = options?.resetOverrides === true

  let returnAmount = item.returnAmount
  let returnAmountOverridden = item.returnAmountOverridden === true && !reset
  let rebillAmount = item.rebillAmount
  let rebillAmountOverridden = item.rebillAmountOverridden === true && !reset

  if (reset) {
    returnAmountOverridden = false
    rebillAmountOverridden = false
  }

  if (!returnAmountOverridden) {
    returnAmount = catalogTotal
  } else if (returnAmount == null || Number.isNaN(returnAmount)) {
    returnAmount = catalogTotal
    returnAmountOverridden = false
  }

  if (!rules.rebillAmountEditable) {
    rebillAmount = 0
    rebillAmountOverridden = false
  } else if (!rebillAmountOverridden) {
    rebillAmount = catalogTotal
  } else if (rebillAmount == null || Number.isNaN(rebillAmount)) {
    rebillAmount = catalogTotal
    rebillAmountOverridden = false
  }

  const safeReturn = roundYen(returnAmount ?? 0)
  const safeRebill = roundYen(rebillAmount ?? 0)

  return {
    ...item,
    returnAmount: safeReturn,
    rebillAmount: safeRebill,
    returnAmountOverridden,
    rebillAmountOverridden,
    // A basis belongs to an overwritten amount; one that follows the catalogue has none.
    returnUnitBasis: returnAmountOverridden ? item.returnUnitBasis : undefined,
    rebillUnitBasis: rebillAmountOverridden ? item.rebillUnitBasis : undefined,
    subTotal: safeReturn,
  }
}

/**
 * A product line after one edit: the rule the wizard and the review screen apply on every keystroke.
 *
 * Pure, so the sequences UAT reports - overwrite a figure, retype the quantity - can be replayed
 * outside the browser against the real rule rather than a copy of it.
 */
export function nextProductLine(
  prev: ProductItem,
  patch: Partial<ProductItem>,
  returnType: ReturnTypeCode | '',
  options?: { resetAmountOverrides?: boolean }
): ProductItem {
  const next = { ...prev, ...patch }

  const qtyChanged = patch.quantity !== undefined && patch.quantity !== prev.quantity
  const priceChanged =
    (patch.unitPrice !== undefined && patch.unitPrice !== prev.unitPrice) ||
    (patch.wholesalePrice !== undefined && patch.wholesalePrice !== prev.wholesalePrice)
  const productChanged = patch.productCode !== undefined && patch.productCode !== prev.productCode

  const shouldRecalcDefaults = options?.resetAmountOverrides || qtyChanged || priceChanged || productChanged

  // An amount typed by hand: judge it, and leave the catalogue alone.
  if (!shouldRecalcDefaults && (patch.returnAmount !== undefined || patch.rebillAmount !== undefined)) {
    const rules = getReturnAmountRules(returnType)
    const safeReturn = Math.max(0, Math.floor(next.returnAmount ?? 0))
    const safeRebill = rules.rebillAmountEditable ? Math.max(0, Math.floor(next.rebillAmount ?? 0)) : 0
    // Only a figure that actually changed is judged again: leaving the box re-sends the same one.
    const returned =
      patch.returnAmount !== undefined && safeReturn !== prev.returnAmount ? overrideState(safeReturn, next) : null
    const rebilled =
      rules.rebillAmountEditable && patch.rebillAmount !== undefined && safeRebill !== prev.rebillAmount
        ? overrideState(safeRebill, next)
        : null
    return {
      ...next,
      returnAmount: safeReturn,
      rebillAmount: safeRebill,
      returnAmountOverridden: returned ? returned.overridden : next.returnAmountOverridden,
      returnUnitBasis: returned ? returned.basis : next.returnUnitBasis,
      rebillAmountOverridden: rules.rebillAmountEditable
        ? rebilled
          ? rebilled.overridden
          : next.rebillAmountOverridden
        : false,
      rebillUnitBasis: rules.rebillAmountEditable ? (rebilled ? rebilled.basis : next.rebillUnitBasis) : undefined,
      subTotal: safeReturn,
    }
  }

  // A quantity change SCALES an overwritten amount rather than discarding it (scaleOverriddenAmounts).
  // A different product or price, or an explicit reset, clears the override: the figure no longer
  // belongs to the line it was typed for.
  return applyReturnAmountDefaults(qtyChanged ? scaleOverriddenAmounts(prev, next) : next, returnType, {
    resetOverrides: options?.resetAmountOverrides === true || productChanged || priceChanged,
  })
}
