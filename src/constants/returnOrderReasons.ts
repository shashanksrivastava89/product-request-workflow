export type ReturnOrderReasonCode =
  | 'PRODUCT_COMPLAINT'
  | 'DC_ERROR'
  | 'CARRIER_ERROR'
  | 'CSR_ERROR'
  | 'SALES_ERROR'
  | 'CUSTOMER_ERROR'
  | 'IT_SYSTEM'
  | 'OTHER'

export const RETURN_ORDER_REASON_OPTIONS: { value: ReturnOrderReasonCode; label: string }[] = [
  { value: 'PRODUCT_COMPLAINT', label: '製品不良 / Product Complaint' },
  { value: 'DC_ERROR', label: '倉庫の出荷ミス / DC Error' },
  { value: 'CARRIER_ERROR', label: '配送業者の配送取扱ミス / Carrier Error' },
  { value: 'CSR_ERROR', label: '受注入力ミス / CSR Error Data Entry' },
  { value: 'SALES_ERROR', label: '営業案内ミス / Sales Error' },
  { value: 'CUSTOMER_ERROR', label: '代理店またはユーザーの発注ミス / Customer Error' },
  { value: 'IT_SYSTEM', label: 'SAP/システム障害 / IT/System issue' },
  { value: 'OTHER', label: 'その他 / Other' },
]
