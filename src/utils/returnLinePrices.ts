import { roundYen } from './returnAmountRules'

/*
 * A return's amounts as the mails print them - backend/src/utils/email-return-details.util.ts - so a
 * page an approver opens from the mail shows the same figures as the mail itself.
 */

/**
 * Unit prices only on a whole quantity of 2 or more. At qty 1 the unit is the total; a fractional
 * quantity (service hours) shows totals only (Damian Diggin / Shashank Srivastava, 30 Sep 2026).
 */
export function lineShowsUnitPrices(quantity: unknown): boolean {
  const q = Number(quantity)
  return Number.isInteger(q) && q >= 2
}

/** The standard price when the total is quantity x standard price, else the total per unit. */
export function returnLineUnitPrice(total: number, quantity: unknown, standardUnit?: unknown): number {
  const q = Number(quantity)
  if (!(q > 0)) return total
  const std = Number(standardUnit)
  if (std > 0 && roundYen(q * std) === total) return std
  return total / q
}

/** Whole yen when it divides evenly, otherwise to the sen: ¥10,000 / 3 = ¥3,333.33. */
export function formatUnitYen(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 1e-9
  return whole
    ? `¥${Math.round(amount).toLocaleString('ja-JP')}`
    : `¥${amount.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
