import React, { createContext, useContext, useMemo, useState, useCallback } from 'react'
import type { ReturnTypeCode } from '../constants/returnTypes'
import type { ReturnOrderReasonCode } from '../constants/returnOrderReasons'
import type { ProductItem } from './FormContext'
import {
  RETURN_DRAFT_PREFIX,
  loadDraft,
  purgeLegacyLocalDraft,
  saveDraft,
} from '../utils/formDraftStorage'
import { roundYen } from '../utils/returnAmountRules'

export type { ProductItem }
/** Returns are raised under CDG or LSG; service teams are reached via the `isService` flag. */
export type ReturnBusinessUnit = 'CDG' | 'LSG'

export type ReturnFormData = {
  id: string
  returnType: ReturnTypeCode | ''
  requestDate: string
  businessUnit: ReturnBusinessUnit | ''
  /** Service request: lists the service teams for the business unit instead of its sales teams. */
  isService: boolean
  requesterGroup: string
  requesterId: string
  requesterName: string
  salesRepCodeSap: string
  /** Return approval chain (from return_approval_mapping) */
  /**
   * Service review step, ahead of the approvers. Applied only when isService is true, and only
   * filled when the server offers one, so the step-1 and step-3 previews show exactly the chain
   * that will be built - a requester should not be surprised by a step appearing after submission.
   */
  reviewer: string
  firstApprover: string
  secondApprover: string
  finalApprover: string
  /** Service managers (levels 4-5). Applied only when isService is true. */
  fourthApprover: string
  fifthApprover: string
  soldToCode: string
  soldToName: string
  endUserCode: string
  endUserName: string
  dairitenContactName: string
  dairitenContactEmail: string
  originalOrderNumber: string
  /** The first invoice date, and the only one unless this is a standing order. */
  invoiceDate: string
  /**
   * 定期予約 / Standing order. A standing order is price-adjusted across several billing periods,
   * so it may carry more than one invoice date — Damian Diggin ruled (4 Sep 2026) that it stays ONE
   * request rather than one per date.
   */
  isStandingOrder: boolean
  /**
   * The additional invoice dates, beyond `invoiceDate`. Empty unless this is a standing order; the
   * submit payload sends `[invoiceDate, ...additionalInvoiceDates]` as the full ordered list.
   */
  additionalInvoiceDates: string[]
  quoteRefNo: string
  orderReason: ReturnOrderReasonCode | ''
  justification: string
  products: ProductItem[]
  status: 'DRAFT' | 'VALIDATED'
  /**
   * The row this form is editing, when it came from "Create New Case from Copy".
   *
   * Present only for a copied draft. Submit then updates that row and submits it, rather than
   * creating a second one and leaving the copy behind as an orphan DRAFT.
   */
  backendDraftId?: string
  /**
   * Set when this draft is a rejected return that was REOPENED: its reference number, and what it was
   * rejected for. The wizard says so, so the requester knows they are correcting that same request
   * rather than raising a new one. A copy never carries it - a copy is a new request.
   */
  reopenedReference?: string
  reopenedRejection?: { by: string; role: string; reason: string | null }
}

/* Draft lifetime lives in formDraftStorage, shared with the sample-order wizard. */

export const emptyReturnForm = (): ReturnFormData => ({
  id: crypto.randomUUID(),
  returnType: '',
  requestDate: new Date().toISOString().slice(0, 10),
  businessUnit: '',
  isService: false,
  requesterGroup: '',
  requesterId: '',
  requesterName: '',
  salesRepCodeSap: '',
  reviewer: '',
  firstApprover: '',
  secondApprover: '',
  finalApprover: '',
  fourthApprover: '',
  fifthApprover: '',
  soldToCode: '',
  soldToName: '',
  endUserCode: '',
  endUserName: '',
  dairitenContactName: '',
  dairitenContactEmail: '',
  originalOrderNumber: '',
  invoiceDate: '',
  isStandingOrder: false,
  additionalInvoiceDates: [],
  quoteRefNo: '',
  orderReason: '',
  justification: '',
  products: [],
  status: 'DRAFT',
})

function clearHierarchy(f: ReturnFormData) {
  f.reviewer = ''
  f.firstApprover = ''
  f.secondApprover = ''
  f.finalApprover = ''
  f.fourthApprover = ''
  f.fifthApprover = ''
}

function clearRequester(f: ReturnFormData) {
  f.requesterId = ''
  f.requesterName = ''
  f.salesRepCodeSap = ''
  clearHierarchy(f)
}

function clearPartners(f: ReturnFormData) {
  f.soldToCode = ''
  f.soldToName = ''
  f.endUserCode = ''
  f.endUserName = ''
}

type DownstreamKey = 'returnType' | 'businessUnit' | 'isService' | 'requesterGroup' | 'requesterId' | 'soldTo'

/** Clear fields downstream from the changed key (Return form only). */
export function resetReturnDownstream(form: ReturnFormData, changedKey: DownstreamKey): ReturnFormData {
  const next: ReturnFormData = { ...form, status: 'DRAFT' }

  if (changedKey === 'returnType' || changedKey === 'businessUnit' || changedKey === 'isService') {
    next.requesterGroup = ''
    clearRequester(next)
    clearPartners(next)
    next.products = []
  } else if (changedKey === 'requesterGroup') {
    // Catalogs follow the business unit directly now, so changing team keeps partners/products.
    clearRequester(next)
  } else if (changedKey === 'requesterId') {
    clearRequester(next)
  } else if (changedKey === 'soldTo') {
    clearPartners(next)
  }

  return next
}

interface Ctx {
  form: ReturnFormData
  setForm: React.Dispatch<React.SetStateAction<ReturnFormData>>
  resetForm: () => void
  /**
   * Whether changes are saved to localStorage as the requester's draft.
   *
   * On for the wizard's own use. Off while the service review has the wizard open on somebody
   * else's request — otherwise the reviewed request became the requester's next draft.
   */
  setPersistEnabled: (on: boolean) => void
}

const Ctx = createContext<Ctx | null>(null)

function normalizeProductItem(raw: unknown): ProductItem {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProductItem>
  const quantity = typeof p.quantity === 'number' && Number.isFinite(p.quantity) ? p.quantity : 1
  const unitPrice = typeof p.unitPrice === 'number' && Number.isFinite(p.unitPrice) ? p.unitPrice : 0
  const wholesalePrice =
    typeof p.wholesalePrice === 'number' && Number.isFinite(p.wholesalePrice)
      ? p.wholesalePrice
      : undefined
  const catalogFallback = roundYen(quantity * (wholesalePrice ?? unitPrice))
  const returnAmount =
    typeof p.returnAmount === 'number' && Number.isFinite(p.returnAmount)
      ? Math.max(0, Math.floor(p.returnAmount))
      : catalogFallback
  const rebillAmount =
    typeof p.rebillAmount === 'number' && Number.isFinite(p.rebillAmount)
      ? Math.max(0, Math.floor(p.rebillAmount))
      : 0
  return {
    id: typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID(),
    productCode: typeof p.productCode === 'string' ? p.productCode : '',
    sapCode: typeof p.sapCode === 'string' ? p.sapCode : '',
    productName: typeof p.productName === 'string' ? p.productName : '',
    quantity,
    unitPrice,
    wholesalePrice,
    subTotal: typeof p.subTotal === 'number' && Number.isFinite(p.subTotal) ? p.subTotal : returnAmount,
    lotNumber: typeof p.lotNumber === 'string' ? p.lotNumber : '',
    note: p.note,
    isConsumable: p.isConsumable,
    returnAmount,
    rebillAmount,
    returnAmountOverridden: p.returnAmountOverridden === true,
    rebillAmountOverridden: p.rebillAmountOverridden === true,
  }
}

/** Migrate older localStorage drafts that used sample-request hierarchy field names. */
function normalizeStoredDraft(parsed: Partial<ReturnFormData> & Record<string, unknown>): ReturnFormData {
  const base = emptyReturnForm()
  const legacy = parsed as Record<string, unknown>
  // Business unit is CDG/LSG now. A draft saved under the retired SERVICE unit reopens as a
  // service request with no unit, so the team and requester are re-picked against current lists.
  const storedBu = typeof parsed.businessUnit === 'string' ? parsed.businessUnit.toUpperCase() : ''
  const wasService = storedBu === 'SERVICE'
  const businessUnit: ReturnBusinessUnit | '' =
    storedBu === 'CDG' || storedBu === 'LSG' ? (storedBu as ReturnBusinessUnit) : ''
  return {
    ...base,
    ...parsed,
    businessUnit,
    isService: parsed.isService === true || wasService,
    requesterGroup: businessUnit ? (parsed.requesterGroup ?? '') : '',
    requesterId: businessUnit ? (parsed.requesterId ?? '') : '',
    requesterName: businessUnit ? (parsed.requesterName ?? '') : '',
    products: Array.isArray(parsed.products) ? parsed.products.map(normalizeProductItem) : [],
    firstApprover:
      (typeof parsed.firstApprover === 'string' && parsed.firstApprover) ||
      (typeof legacy.salesManager === 'string' ? legacy.salesManager : '') ||
      '',
    secondApprover:
      (typeof parsed.secondApprover === 'string' && parsed.secondApprover) ||
      (typeof legacy.districtSalesManager === 'string' ? legacy.districtSalesManager : '') ||
      '',
    finalApprover:
      (typeof parsed.finalApprover === 'string' && parsed.finalApprover) ||
      (typeof legacy.nationalSalesManager === 'string' ? legacy.nationalSalesManager : '') ||
      '',
  }
}

export function ReturnFormProvider({ children }: { children: React.ReactNode }) {
  const [form, setForm] = useState<ReturnFormData>(() => {
    // Opening /return/new?draft=… loads the request from the API in ReturnWizard; hydrating a stale
    // localStorage draft first would race that load and show the previous request's values.
    if (typeof window !== 'undefined') {
      try {
        const id = new URLSearchParams(window.location.search).get('draft')?.trim()
        if (id) return emptyReturnForm()
      } catch {
        /* ignore */
      }
    }
    try {
      // Anything left in localStorage is from a build that persisted across sessions; drop it so
      // the stale-form behaviour cannot survive this upgrade.
      purgeLegacyLocalDraft(RETURN_DRAFT_PREFIX)
      const stored = loadDraft<Partial<ReturnFormData> & Record<string, unknown>>(RETURN_DRAFT_PREFIX)
      if (stored) {
        return normalizeStoredDraft(stored)
      }
    } catch {
      /* fall through */
    }
    return emptyReturnForm()
  })

  const persistRef = React.useRef(true)
  const setPersistEnabled = useCallback((on: boolean) => {
    persistRef.current = on
  }, [])

  React.useEffect(() => {
    if (persistRef.current) saveDraft(RETURN_DRAFT_PREFIX, form)
  }, [form])

  const resetForm = useCallback(() => {
    const fresh = emptyReturnForm()
    setForm(fresh)
    if (persistRef.current) saveDraft(RETURN_DRAFT_PREFIX, fresh)
  }, [])

  const value = useMemo(
    () => ({ form, setForm, resetForm, setPersistEnabled }),
    [form, resetForm, setPersistEnabled]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReturnFormCtx() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReturnFormCtx must be used within ReturnFormProvider')
  return ctx
}
