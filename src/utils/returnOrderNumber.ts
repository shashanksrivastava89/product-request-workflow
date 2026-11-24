/** Original sales order number: exactly 10 digits and must start with 1. */
const RETURN_ORDER_NUMBER = /^1\d{9}$/

export function isValidReturnOrderNumber(value: string | null | undefined): boolean {
  return RETURN_ORDER_NUMBER.test(String(value ?? '').trim())
}

export function getReturnOrderNumberError(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim()
  if (!v) return 'required'
  if (!/^\d+$/.test(v)) return 'digits'
  if (v.length !== 10) return 'length'
  if (!v.startsWith('1')) return 'prefix'
  return null
}

/**
 * The same rule, but blank passes.
 *
 * A requester may submit without the original order number; the service review team fills it in
 * before the request goes to the approvers. A value that IS given must still be a real order number
 * — an unusable one is worse than none, because it looks answered.
 *
 * Mirrors isValidOptionalReturnContactEmail / getOptionalReturnContactEmailError, which already
 * express "optional, but well-formed if present" for the dealer's email.
 */
export function isValidOptionalReturnOrderNumber(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  return v === '' || RETURN_ORDER_NUMBER.test(v)
}

/** Format errors only — never 'required'. Null when blank or valid. */
export function getOptionalReturnOrderNumberError(
  value: string | null | undefined
): 'digits' | 'length' | 'prefix' | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  const err = getReturnOrderNumberError(v)
  return err === 'required' ? null : (err as 'digits' | 'length' | 'prefix' | null)
}
