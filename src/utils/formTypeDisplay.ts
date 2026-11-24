/** Keep in sync with backend `reference.service.ts` FORM_TYPE_DISPLAY_LABELS. */
export const FORM_TYPE_DISPLAY_LABELS: Record<string, string> = {
  ZSAM: 'サンプル用(ZSAM)',
  ZNC: '機器設置用(ZNC)',
  ZNCCLAIM: 'クレーム対応(ZNC)',
  ZINT: 'QC用(ZINT)',
}

export function formTypeDisplayLabel(formType?: string | null): string {
  const code = String(formType ?? '').trim()
  return FORM_TYPE_DISPLAY_LABELS[code] ?? (code || '—')
}
