/**
 * Yen are whole numbers, whatever the quantity is.
 *
 * Quantities became decimal so service work can be booked as 1.5 hours (Corlett Siobhan, 17 Sep), which
 * is the first time a line total could carry a fraction: 12,500 x 0.035 = 437.5. Vidhi Parsons asked
 * for totals "not to be .xx", so every line is rounded before it is stored, summed or shown, and the
 * totals are sums of whole yen rather than a rounded sum of fractions - the two differ, and only the
 * first matches what a reader can add up from the rows.
 *
 * Round half up, the Japanese accounting default. Quantities were whole until now, so `Math.floor`
 * and this agree on every figure the system has ever stored.
 */
export function roundYen(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
}

/** Quantity as people write it: 1, 1.5, 0.35 - never 1.000. */
export function formatQuantity(quantity: unknown): string {
  const n = Number(quantity);
  if (!Number.isFinite(n)) return '—';
  return String(Number(n.toFixed(QUANTITY_DECIMALS)));
}

/** Decimal places a quantity may carry. Three, as asked: 0.350 of an hour is 21 minutes. */
export const QUANTITY_DECIMALS = 3;

/** True when a quantity is usable: positive and no finer than QUANTITY_DECIMALS. */
export function isValidQuantity(quantity: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return Number(quantity.toFixed(QUANTITY_DECIMALS)) === quantity;
}
