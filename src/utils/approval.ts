export type Purpose = 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'

export function computeApprovalMessage(purpose: Purpose | undefined, subtotal: number): {
  message: string
  requirePresident: boolean
} {
  if (!purpose) return { message: '', requirePresident: false }
  const zncClaimRaqaSplitYen = 1_500_000
  const threeM = 3_000_000

  if (purpose === 'ZNCCLAIM' && subtotal > zncClaimRaqaSplitYen) {
    return { message: 'AP-RA/QA Director approval required', requirePresident: false }
  }
  if (purpose === 'ZINT' && subtotal > zncClaimRaqaSplitYen) {
    return { message: 'AP-RA/QA Director approval required', requirePresident: false }
  }
  if ((purpose === 'ZSAM' || purpose === 'ZNC') && subtotal > threeM) {
    return { message: 'President approval required', requirePresident: true }
  }
  return { message: '', requirePresident: false }
}
