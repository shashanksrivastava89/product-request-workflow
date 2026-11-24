/**
 * Request types used for the form-type filter across the approval pages.
 *
 * RETURN is here because a submitted return lands in the same inbox as everything else — GET
 * /approvals has never filtered by form type — so without this row an approver could see return
 * requests in the list but not filter to them.
 */
export const REQUEST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ZSAM', label: 'ZSAM for SALES PROMOTION' },
  { value: 'ZNC', label: 'ZNC for INSTALLATION' },
  { value: 'ZNCCLAIM', label: 'ZNC for CLAIM REPLACEMENT' },
  { value: 'ZINT', label: 'ZINT for QC TEST' },
  { value: 'RETURN', label: 'RETURN / CREDIT' },
]

/** The four sample types — the Sample section's own filter, with returns left out. */
export const SAMPLE_REQUEST_TYPE_OPTIONS = REQUEST_TYPE_OPTIONS.filter((o) => o.value !== 'RETURN')

/**
 * The Return section's filter. A single option, so the dropdown is really a label — but keeping the
 * same control in the same place means the two sections stay recognisably the same pages.
 */
export const RETURN_REQUEST_TYPE_OPTIONS = REQUEST_TYPE_OPTIONS.filter((o) => o.value === 'RETURN')

/**
 * Which section a list belongs to.
 *
 * `all` exists for Data Management -> Submitted requests, which is deliberately one combined list:
 * Vidhi asked in the 2 Sep review whether sample and return requests are listed separately, was
 * told they share one list filtered by Request Type, and accepted that. Scoping that page to
 * `sample` (as it defaulted to) hid returns from it entirely.
 */
export type RequestListScope = 'sample' | 'return' | 'all'

/** The form types a section owns. Keeps a return out of the Sample lists and vice versa. */
export function isFormTypeInScope(formType: string | undefined, scope: RequestListScope): boolean {
  if (scope === 'all') return true
  const t = String(formType ?? '').trim().toUpperCase()
  return scope === 'return' ? t === 'RETURN' : t !== 'RETURN'
}

/** The Request Type options a scope should offer. `all` offers every type, including RETURN. */
export function requestTypeOptionsForScope(scope: RequestListScope) {
  if (scope === 'all') return REQUEST_TYPE_OPTIONS
  return scope === 'return' ? RETURN_REQUEST_TYPE_OPTIONS : SAMPLE_REQUEST_TYPE_OPTIONS
}
