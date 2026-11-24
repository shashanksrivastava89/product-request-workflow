import { isPersonalShipToUi, PERSONAL_SHIP_TO_LABEL } from './personalShipTo'

/** Two-line Delivery / Ship-To radio labels (Wizard UI). */
export const CHANNEL_SHIP_TO_LABEL_LINE1 = 'Channel'
export const CHANNEL_SHIP_TO_LABEL_LINE2 = 'Partner'
export const CHANNEL_SHIP_TO_LABEL = `${CHANNEL_SHIP_TO_LABEL_LINE1} ${CHANNEL_SHIP_TO_LABEL_LINE2}`

export const HEIWA_SHIP_TO_LABEL_LINE1 = 'HEIWAJIMA'
export const HEIWA_SHIP_TO_LABEL_LINE2 = 'CENTER'
export const HEIWA_SHIP_TO_LABEL = `${HEIWA_SHIP_TO_LABEL_LINE1} ${HEIWA_SHIP_TO_LABEL_LINE2}`

export const DIRECT_SHIP_TO_LABEL_LINE1 = 'Direct'
export const DIRECT_SHIP_TO_LABEL_LINE2 = 'Delivery'
export const DIRECT_SHIP_TO_LABEL = `${DIRECT_SHIP_TO_LABEL_LINE1} ${DIRECT_SHIP_TO_LABEL_LINE2}`

export type DeliveryModeDisplayOpts = {
  shipToCode?: string | null
  formType?: string | null
}

/**
 * User-friendly label for delivery mode (CHANNEL / HEIWA / DIRECT).
 * Personal ship-to (ZSAM, code 9…) is inferred from ship-to code — not stored on deliveryMode.
 */
export function deliveryModeDisplayLabel(
  deliveryMode: string | undefined | null,
  opts?: DeliveryModeDisplayOpts
): string {
  if (isPersonalShipToUi(opts?.shipToCode, opts?.formType)) {
    return PERSONAL_SHIP_TO_LABEL
  }
  if (!deliveryMode) return '—'
  switch (deliveryMode) {
    case 'CHANNEL':
      return CHANNEL_SHIP_TO_LABEL
    case 'HEIWA':
      return HEIWA_SHIP_TO_LABEL
    case 'DIRECT':
      return DIRECT_SHIP_TO_LABEL
    case 'INTERNAL':
      return 'Internal'
    default:
      return deliveryMode
  }
}
