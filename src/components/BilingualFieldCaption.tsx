import React from 'react'
import { useI18n } from '../providers/I18nContext'

export type BilingualFieldKey =
  | 'wizard.bilingual.attention'
  | 'wizard.bilingual.freeSample'
  | 'wizard.bilingual.specificDate'

type Props = {
  labelKey: BilingualFieldKey
  className?: string
  /** Smaller typography for dense cards and print. */
  compact?: boolean
  /** White / light text on solid badge backgrounds. */
  tone?: 'default' | 'onColor'
  as?: 'div' | 'span'
}

export function BilingualFieldCaption({
  labelKey,
  className = '',
  compact = false,
  tone = 'default',
  as: Comp = 'div',
}: Props) {
  const { tBilingual } = useI18n()
  const { jp, en } = tBilingual(labelKey)
  const primaryCls =
    tone === 'onColor'
      ? compact
        ? 'text-xs font-semibold text-white leading-snug'
        : 'text-sm font-semibold text-white'
      : compact
        ? 'text-xs font-semibold text-gray-900 leading-snug'
        : 'text-base font-semibold text-gray-900'
  const subCls =
    tone === 'onColor'
      ? compact
        ? 'text-[10px] text-white/85 mt-0.5 leading-snug'
        : 'text-xs text-white/85 mt-0.5'
      : compact
        ? 'text-[10px] text-gray-600 mt-0.5 leading-snug'
        : 'text-sm text-gray-600 mt-0.5'

  return (
    <Comp className={className}>
      <div className={primaryCls} lang="ja">
        {jp}
      </div>
      <div className={subCls} lang="en">
        {en}
      </div>
    </Comp>
  )
}
