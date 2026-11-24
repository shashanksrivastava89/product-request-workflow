import {
  PERSONAL_SHIP_TO_TENNOZ_NAME,
  isPersonalShipToTennozDefault,
} from './personalShipTo'

/** Stored on the form but not shown in UI or emails (use display name only). */
export function isInternalShipToCode(code?: string | null): boolean {
  return isPersonalShipToTennozDefault(code)
}

export function formatShipToDisplayName(name?: string | null, code?: string | null): string {
  const n = String(name ?? '').trim()
  if (n) return n
  if (isPersonalShipToTennozDefault(code)) return PERSONAL_SHIP_TO_TENNOZ_NAME
  return '—'
}

/** User-visible ship-to code, or null when internal. */
export function formatShipToDisplayCode(code?: string | null): string | null {
  const c = String(code ?? '').trim()
  if (!c || isInternalShipToCode(c)) return null
  return c
}

/** e.g. "TENNOZ HEAD OFFICE" or "Name (1089602)" — never "TENNOZ_HO". */
export function formatShipToLabel(
  name?: string | null,
  code?: string | null,
  opts?: { prefix?: string }
): string {
  const displayName = formatShipToDisplayName(name, code)
  const displayCode = formatShipToDisplayCode(code)
  const label = opts?.prefix ? `${opts.prefix}${displayName}` : displayName
  return displayCode ? `${label} (${displayCode})` : label
}

/** SearchSelect closed label when options are not loaded yet. */
export function shipToFallbackLabel(code?: string, name?: string): string | undefined {
  const c = String(code ?? '').trim()
  if (!c) return undefined
  const displayCode = formatShipToDisplayCode(c)
  const displayName = formatShipToDisplayName(name, c)
  if (displayCode) return `${displayCode} — ${displayName}`
  return displayName
}
