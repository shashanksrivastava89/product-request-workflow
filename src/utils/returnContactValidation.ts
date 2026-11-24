/** Dairiten contact name: letters (incl. Japanese), spaces, hyphen, apostrophe, middle dot — no digits. */
const CONTACT_NAME_RE =
  /^[\p{L}\p{M}]+(?:[ \u3000·・'\-.．][\p{L}\p{M}]+)*$/u

/** Practical email: contact-f3b5e5@outside.example */
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

export function isValidReturnContactName(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  if (/\d/.test(v)) return false
  return CONTACT_NAME_RE.test(v)
}

export function getReturnContactNameError(value: string | null | undefined): 'required' | 'invalid' | null {
  const v = String(value ?? '').trim()
  if (!v) return 'required'
  if (!isValidReturnContactName(v)) return 'invalid'
  return null
}

export function isValidReturnContactEmail(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  return EMAIL_RE.test(v)
}

export function getReturnContactEmailError(value: string | null | undefined): 'required' | 'invalid' | null {
  const v = String(value ?? '').trim()
  if (!v) return 'required'
  if (!isValidReturnContactEmail(v)) return 'invalid'
  return null
}

/**
 * The dealer contact email as an optional field: blank is fine, but anything typed still has to be
 * a real address.
 *
 * Kept separate from the strict pair above rather than loosening them, so "optional" is a property
 * of this one field on this one form and not of email validation everywhere.
 */
export function isValidOptionalReturnContactEmail(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  return v === '' || isValidReturnContactEmail(v)
}

export function getOptionalReturnContactEmailError(
  value: string | null | undefined
): 'invalid' | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  return isValidReturnContactEmail(v) ? null : 'invalid'
}
