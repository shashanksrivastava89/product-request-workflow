/**
 * Helpers for numerical inputs: no negative values, and no decimals except where a quantity is
 * genuinely fractional.
 *
 * Money is always whole yen. Quantity was too, until service work had to be booked in hours - so
 * the return wizard's quantity box accepts up to three decimal places and everything else does not.
 */

/** Parse input as non-negative integer; default to 0 if invalid or negative. */
export function toNonNegativeInt(value: string | number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/[^\d]/g, ''), 10)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.floor(n))
}

/** Coerce API / form values (number, string, Decimal) to a non-negative integer. */
export function normalizeNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }
  return toNonNegativeInt(String(value ?? ''))
}

/** Parse input as positive integer (min 1); default to 1 if invalid or less than 1. Use for quantity. */
export function toPositiveInt(value: string | number): number {
  const n = toNonNegativeInt(value)
  return n < 1 ? 1 : n
}

/**
 * Wizard product quantity while typing: empty field → 0 so the user can clear and type a new number.
 * Final validation / blur should clamp to at least 1.
 */
export function quantityFromInput(value: string): number {
  if (String(value).trim() === '') return 0
  return toNonNegativeInt(value)
}

/** For filter amount fields: allow empty string or non-negative integer. */
export function toNonNegativeIntOrEmpty(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const n = toNonNegativeInt(trimmed)
  return String(n)
}

/** Block keypress for minus, period, comma so user cannot type decimals or negative. */
export function blockNegativeAndDecimal(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key === '-' || e.key === '.' || e.key === ',' || e.key === 'e' || e.key === 'E') {
    e.preventDefault()
  }
}

/** Decimal places a quantity may carry. 0.350 of an hour is 21 minutes, which is precise enough. */
export const QUANTITY_DECIMALS = 3

/** Block minus and exponent, but allow one decimal point. For the return wizard's quantity only. */
export function blockNegativeOnly(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key === '-' || e.key === ',' || e.key === 'e' || e.key === 'E') {
    e.preventDefault()
  }
}

/**
 * Quantity while typing, allowing decimals.
 *
 * Returns 0 for an empty or half-typed box ("0.", ".") so the caller sees "not valid yet" rather
 * than NaN; the field itself keeps showing exactly what was typed, which is QuantityInput's job.
 * Anything finer than QUANTITY_DECIMALS is truncated rather than rounded - a typist who has entered
 * four places has not finished making up their mind, and rounding under the cursor is the fight
 * this whole component exists to avoid.
 */
export function quantityFromDecimalInput(value: string): number {
  const trimmed = String(value).trim()
  if (trimmed === '') return 0
  const n = Number(trimmed.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  const factor = 10 ** QUANTITY_DECIMALS
  return Math.floor(n * factor) / factor
}

/** A quantity as people write it: 1, 1.5, 0.35 - never 1.000. */
export function formatQuantity(quantity: unknown): string {
  const n = Number(quantity)
  if (!Number.isFinite(n)) return '—'
  return String(Number(n.toFixed(QUANTITY_DECIMALS)))
}
