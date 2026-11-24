/**
 * The two dates a request carries, and why they are not the same thing.
 *
 * `submittedAt` is stamped once, when the requester submits, and nothing ever re-stamps it.
 * `requestDate` is a field ON the form — the requester picks it, and a service reviewer may correct
 * it like any other entry. Showing one and silently falling back to the other made the "Submitted"
 * column move when a reviewer saved, which is what Corlett reported: 「The committed data and creating
 * data should be different」.
 */
export function formatSubmittedDate(submittedAt?: string | null): string {
  if (!submittedAt) return '—'
  const d = new Date(submittedAt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export function formatRequestDate(requestDate?: string | null): string {
  if (!requestDate) return '—'
  const d = new Date(requestDate)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

/** True when `value` falls inside an inclusive from/to range of `yyyy-mm-dd` strings. */
export function withinDateRange(
  value: string | null | undefined,
  from: string,
  to: string
): boolean {
  if (!from && !to) return true
  if (!value) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  if (from && d < new Date(from)) return false
  if (to) {
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    if (d > end) return false
  }
  return true
}

/**
 * "Y · entered by X" — the named requester, and the account that actually typed it in.
 *
 * A manager may raise a request for a rep, so the two differ legitimately. Corlett asked to see which:
 * 「本当にこのこれを入力したのは誰っていうのを逆に知りたい」. Returns null when they are the same
 * person, so nothing is shown in the ordinary case.
 */
export function enteredByLabel(
  requesterName?: string | null,
  submitterName?: string | null
): string | null {
  const named = String(requesterName ?? '').trim()
  const actual = String(submitterName ?? '').trim()
  if (!actual || !named) return null
  const norm = (v: string) => v.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
  return norm(named) === norm(actual) ? null : actual
}

/**
 * The end user a request names, as one line: "NAME (CODE)".
 *
 * Both halves, because a row may carry only one of them and the code is what a customer-service
 * search usually starts from. Shared by the three list pages so the text on the row is exactly the
 * text the End User filter matches - a field you can see but not search is a trap.
 */
export function endUserLabel(form: {
  endUserName?: string | null
  endUserCode?: string | null
} | null | undefined): string {
  const name = String(form?.endUserName ?? '').trim()
  const code = String(form?.endUserCode ?? '').trim()
  if (name && code) return `${name} (${code})`
  return name || code || '—'
}

/** Case-insensitive substring match on the end user's name or code. Blank matches everything. */
export function matchesEndUser(
  form: { endUserName?: string | null; endUserCode?: string | null } | null | undefined,
  needle: string
): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return (
    String(form?.endUserName ?? '').toLowerCase().includes(q) ||
    String(form?.endUserCode ?? '').toLowerCase().includes(q)
  )
}

/**
 * What a row says about the products, in the width of one tile.
 *
 * Sales reps scan their own approved list looking for the request to clone, and the reference number
 * alone does not identify it - the product does. The first line's name, plus a count of the rest.
 *
 * Reads both shapes the list payloads use, as ProductLinesSection does: `products` on the approved
 * and pending lists, `formDetails.products` on older pending rows.
 */
export function firstProductLabel(form: {
  products?: unknown
  formDetails?: { products?: unknown }
} | null | undefined): string {
  const raw = Array.isArray(form?.products)
    ? form?.products
    : Array.isArray(form?.formDetails?.products)
      ? form?.formDetails?.products
      : []
  const lines = raw as Array<{ productName?: string | null; productCode?: string | null }>
  if (lines.length === 0) return '\u2014'
  const first = lines[0]
  const name = String(first?.productName ?? '').trim() || String(first?.productCode ?? '').trim()
  if (!name) return `${lines.length} item(s)`
  return lines.length > 1 ? `${name} +${lines.length - 1}` : name
}
