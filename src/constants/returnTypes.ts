export type ReturnTypeCode = 'ZCMR_ZDMR' | 'ZCMR' | 'ZRE' | 'ZRE_ZOR'

export const RETURN_TYPE_OPTIONS: { value: ReturnTypeCode; label: string }[] = [
  { value: 'ZCMR_ZDMR', label: '伝票処理のみ (赤黒伝票)：ZCMR/ZDMR' },
  { value: 'ZCMR', label: '伝票処理のみ (赤伝票)：ZCMR' },
  { value: 'ZRE', label: '商品返品：ZRE' },
  { value: 'ZRE_ZOR', label: '商品返品/代品出荷：ZRE/ZOR' },
]
