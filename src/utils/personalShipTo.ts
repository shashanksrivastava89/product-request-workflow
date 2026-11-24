/** Delivery / Ship-To UI and display label for ZSAM personal ship-to (Tennoz Head Office). */
export const PERSONAL_SHIP_TO_LABEL_LINE1 = 'Personal'
export const PERSONAL_SHIP_TO_LABEL_LINE2 = '(Tennoz Head Office)'
export const PERSONAL_SHIP_TO_LABEL = `${PERSONAL_SHIP_TO_LABEL_LINE1} ${PERSONAL_SHIP_TO_LABEL_LINE2}`

/** Default ship-to when Personal is selected without optional directory search (same as ZINT Tennoz). */
export const PERSONAL_SHIP_TO_TENNOZ_CODE = 'TENNOZ_HO'
export const PERSONAL_SHIP_TO_TENNOZ_NAME = 'TENNOZ HEAD OFFICE'

/** Wizard info banner (title case; DB still stores TENNOZ HEAD OFFICE). */
export const PERSONAL_SHIP_TO_TENNOZ_DISPLAY_NAME = 'Tennoz Head Office'

export function personalShipToTennozDefaults(): { shipToCode: string; shipToName: string } {
  return { shipToCode: PERSONAL_SHIP_TO_TENNOZ_CODE, shipToName: PERSONAL_SHIP_TO_TENNOZ_NAME }
}

/** Personal ship-to uses requester-directory codes (same as Sold-To / End User personal). */
export function isPersonalShipToCode(code?: string | null): boolean {
  const c = String(code ?? '').trim()
  return c.length > 0 && c.startsWith('9')
}

export function isPersonalShipToTennozDefault(code?: string | null): boolean {
  return String(code ?? '').trim() === PERSONAL_SHIP_TO_TENNOZ_CODE
}

/** ZSAM personal ship-to: Tennoz default or optional 9… directory override. */
export function isZsamPersonalShipToSelection(code?: string | null): boolean {
  return isPersonalShipToCode(code) || isPersonalShipToTennozDefault(code)
}

export function isPersonalShipToUi(
  shipToCode: string | undefined | null,
  formTypeOrPurpose: string | undefined | null
): boolean {
  return formTypeOrPurpose === 'ZSAM' && isZsamPersonalShipToSelection(shipToCode)
}
