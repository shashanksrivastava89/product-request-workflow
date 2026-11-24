import React, { createContext, useContext, useMemo, useState } from 'react'
import {
  SAMPLE_DRAFT_PREFIX,
  loadDraft,
  purgeLegacyLocalDraft,
  saveDraft,
} from '../utils/formDraftStorage'

export type ProductItem = {
  id: string
  productCode: string
  sapCode?: string
  productName: string
  quantity: number
  unitPrice: number
  wholesalePrice?: number
  subTotal: number
  /** Batch / lot number for this line (stored as form_products.lot_number). */
  lotNumber?: string
  note?: string
  isConsumable?: boolean
  /** Return flow: 返品合計 (line total). */
  returnAmount?: number
  /** Return flow: 再請求合計 (line total). */
  rebillAmount?: number
  /** When true, qty changes do not overwrite returnAmount. */
  returnAmountOverridden?: boolean
  /** When true, qty changes do not overwrite rebillAmount. */
  rebillAmountOverridden?: boolean
  /**
   * Return flow, client only: what an overwritten 返品合計 / 再請求合計 means per unit, so the amount
   * follows the quantity (see scaleOverriddenAmounts). Never sent to the server.
   */
  returnUnitBasis?: number
  rebillUnitBasis?: number
}

export type FormData = {
  id: string
  requestDate: string
  formType: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | ''
  requesterId: string
  requesterName?: string
  businessUnit?: 'CDG' | 'LSG' | 'NA'
  requesterGroup?: string
  salesRepCodeSap?: string
  firstApprover?: string
  secondApprover?: string
  presidentApproval?: boolean
  presidentApprovalName?: string
  expectedDeliveryDate?: string
  // Approval Hierarchy
  salesManager?: string
  districtSalesManager?: string
  nationalSalesManager?: string
  localFinanceController?: string
  directorCommercialManager?: string
  // ZNC/ZNCCLAIM Hierarchy Fields
  technicalManager?: string
  nationalTSManager?: string
  // ZINT Hierarchy Fields
  csPsManager?: string
  raqaManager?: string
  globalRaqaManager?: string

  // Legacy fields (to be removed after migration)
  salesManagerOrMktManager?: string
  serviceManagerOrRAQA?: string
  financeManagerApproval?: string

  purpose?: 'ZSAM' | 'ZNCCLAIM' | 'ZNC' | 'ZINT'
  deliveryMode?: 'CHANNEL' | 'DIRECT' | 'INTERNAL' | 'HEIWA'

  endUserCode?: string
  endUserName?: string
  endUserDepartment?: string
  endUserContact?: string
  postalCode?: string
  prefecture?: string
  address?: string
  phone?: string
  shipToCode?: string
  shipToName?: string
  attentionTo?: string
  soldToCode?: string
  soldToName?: string
  deliveryDepartment?: string
  deliveryContact?: string
  commentsForApproval?: string
  freeDescription?: string
  products: ProductItem[]
  status: 'DRAFT' | 'SUBMITTED'
  /** Server draft id when continuing a form created via copy-from-rejected (PUT + submit). */
  backendDraftId?: string
}

const emptyForm = (): FormData => ({
  id: crypto.randomUUID(),
  requestDate: new Date().toISOString().slice(0, 10),
  formType: '',
  requesterId: '',

  deliveryMode: undefined,
  expectedDeliveryDate: 'ASAP',
  products: [],
  status: 'DRAFT',
  backendDraftId: undefined,
})

interface Ctx {
  form: FormData
  setForm: React.Dispatch<React.SetStateAction<FormData>>
  resetForm: () => void
}

const Ctx = createContext<Ctx | null>(null)

export function FormProvider({ children }: { children: React.ReactNode }) {
  const [form, setForm] = useState<FormData>(() => {
    // Opening /new?draft=… loads the form from the API in Wizard; do not hydrate a stale localStorage draft first
    // (it can have the wrong BU / empty partners and race React Strict Mode remounts).
    if (typeof window !== 'undefined') {
      try {
        const id = new URLSearchParams(window.location.search).get('draft')?.trim()
        if (id) {
          return emptyForm()
        }
      } catch {
        /* ignore */
      }
    }
    // Anything left in localStorage is from a build that persisted drafts across sessions; drop it
    // so a request submitted before this upgrade cannot come back.
    purgeLegacyLocalDraft(SAMPLE_DRAFT_PREFIX)
    const parsed = loadDraft<FormData>(SAMPLE_DRAFT_PREFIX)
    if (parsed) {
      if (parsed.expectedDeliveryDate === undefined) {
        parsed.expectedDeliveryDate = 'ASAP'
      }
      return parsed
    }
    return emptyForm()
  })

  React.useEffect(() => {
    saveDraft(SAMPLE_DRAFT_PREFIX, form)
  }, [form])

  const resetForm = React.useCallback(() => {
    const fresh = emptyForm()
    setForm(fresh)
    saveDraft(SAMPLE_DRAFT_PREFIX, fresh)
  }, [])

  const value = useMemo(() => ({ form, setForm, resetForm }), [form, resetForm])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFormCtx() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFormCtx must be used within FormProvider')
  return ctx
}
