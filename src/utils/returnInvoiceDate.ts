/**
 * An invoice date is when the original sales order was invoiced, so it cannot be in the future -
 * Shashank Srivastava, 1 Oct 2026. Mirrors backend/src/utils/invoice-date.util.ts.
 */

/**
 * Today in Japan, as YYYY-MM-DD: the business day an invoice date is judged against.
 *
 * Japan's day, not the machine's: UAT runs in us-west-2, sixteen hours behind Tokyo, so judging by
 * the server's clock would refuse a Japanese user's "today" every morning; and a reviewer elsewhere
 * would see a different cut-off from the requester. Both sides use the same rule.
 */
export function todayInJapan(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** A date that has not happened yet. Blank is not "future"; whether it is required is another rule. */
export function isFutureInvoiceDate(value: string | null | undefined, today: string = todayInJapan()): boolean {
  const v = String(value ?? '').trim().slice(0, 10)
  return v !== '' && v > today
}
