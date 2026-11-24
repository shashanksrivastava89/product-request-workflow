/**
 * The service review, as a mode of the return wizard.
 *
 * The reviewer used to have a screen of their own: the requester's summary with every tile opened
 * into an editor, and its own copy of each field's control. That copy is what this hook retires.
 * Shashank, 10 Sep: *"centralize this with the request journey … in future if requester journey adds
 * a field, reviewer should receive it as well"*. So the reviewer now walks the wizard itself, and the
 * fields exist in exactly one place — the wizard's steps. What this hook adds is everything that is
 * true only of a review:
 *
 *  - the request as it was loaded (`original`), so every change can show "was: …" with an Undo,
 *    and an Undo of a field that cascades (type, unit, service, team) brings back everything the
 *    cascade cleared;
 *  - the route preview when the requester, unit or service flag is corrected, with the old route
 *    as "was";
 *  - the two gates: malformed entries block *saving*, empty required fields block *sending* — the
 *    order number and invoice date the requester may leave blank must be filled before the request
 *    goes on (Vidhi: *"after the service admin team review, this cannot be accepted for any [empty]
 *    space"*);
 *  - save (the guarded `PUT /forms/:id`, which records the trail), discard-all (the revert
 *    endpoint), send for approval (approve the review step, saving first if anything is unsaved) and
 *    send back to the requester (reject the step, with a reason);
 *  - leaving: back to the review queue with this request expanded, confirmed if anything is unsaved.
 *
 * It works on the wizard's own form state through ReturnFormContext, so the wizard's cascade and
 * validation rules apply to a review unchanged — that is the point of sharing the screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { approvalsApi, formsApi, staticDataApi, type Approval, type SalesRep } from '../services/api.service'
import { useI18n } from '../providers/I18nContext'
import type { ProductItem } from '../providers/FormContext'
import { useReturnFormCtx, type ReturnFormData } from '../providers/ReturnFormContext'
import { extractApiError } from '../utils/apiError'
import { RETURN_TYPE_OPTIONS } from '../constants/returnTypes'
import { RETURN_ORDER_REASON_OPTIONS } from '../constants/returnOrderReasons'
import { getReturnAmountRules, overrideState } from '../utils/returnAmountRules'
import { formatRequesterWithSalesRepCode, hasDisplayableSalesRepCode } from '../utils/sales-rep-display.util'
import { getOptionalReturnOrderNumberError } from '../utils/returnOrderNumber'
import { isFutureInvoiceDate } from '../utils/returnInvoiceDate'
import { getOptionalReturnContactEmailError, getReturnContactNameError } from '../utils/returnContactValidation'
import { buildReturnHierarchyRows, isReturnReviewerRole, isSamePerson } from '../utils/return-approval.util'
import { missingReturnFieldsForApproval, type ReturnRequiredField } from '../utils/returnCompleteness'
import type { ReturnSummaryField } from '../components/ReturnSummary'
import { returnProductsErrorKey } from '../components/ReturnProductRows'

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (v == null ? '' : String(v))

/** The matrix columns the route preview is built from, as the wizard keeps them on its form. */
type RouteFields = Pick<
  ReturnFormData,
  'reviewer' | 'firstApprover' | 'secondApprover' | 'finalApprover' | 'fourthApprover' | 'fifthApprover'
>
const EMPTY_ROUTE: RouteFields = {
  reviewer: '',
  firstApprover: '',
  secondApprover: '',
  finalApprover: '',
  fourthApprover: '',
  fifthApprover: '',
}

/** The requester's matrix row, as the wizard fetches it on picking a requester. Empty when there is none. */
async function fetchMatrixRoute(
  requesterName: string,
  businessUnit: string,
  requesterGroup: string
): Promise<RouteFields> {
  if (!requesterName.trim()) return EMPTY_ROUTE
  try {
    const r = await staticDataApi.getReturnApprovers(
      requesterName.trim(),
      businessUnit || undefined,
      requesterGroup || undefined
    )
    if (!r.found || !r.approvers) return EMPTY_ROUTE
    const a = r.approvers
    return {
      reviewer: a.reviewer ?? '',
      firstApprover: a.firstApprover ?? '',
      secondApprover: a.secondApprover ?? '',
      finalApprover: a.finalApprover ?? '',
      fourthApprover: a.fourthApprover ?? '',
      fifthApprover: a.fifthApprover ?? '',
    }
  } catch {
    return EMPTY_ROUTE
  }
}

/** What a reviewer can change on a line, for change detection. */
const lineFingerprint = (p: ProductItem) =>
  [p.productCode, p.sapCode ?? '', p.quantity, p.lotNumber ?? '', p.returnAmount ?? 0, p.rebillAmount ?? 0].join('|')

/** The route columns the matrix fills — cleared with the requester, restored with them. */
const ROUTE_KEYS = [
  'reviewer',
  'firstApprover',
  'secondApprover',
  'finalApprover',
  'fourthApprover',
  'fifthApprover',
] as const satisfies readonly (keyof ReturnFormData)[]

/** What a change of requester or team clears (see resetReturnDownstream → clearRequester). */
const REQUESTER_KEYS = ['requesterGroup', 'requesterId', 'requesterName', 'salesRepCodeSap', ...ROUTE_KEYS] as const

/** Everything a change of type, unit or service flag clears — restored together on Undo. */
const CASCADE_KEYS = [
  ...REQUESTER_KEYS,
  'soldToCode',
  'soldToName',
  'endUserCode',
  'endUserName',
  'products',
] as const satisfies readonly (keyof ReturnFormData)[]

/**
 * The fields whose change empties the partners and the product lines, because those belong to one
 * business unit's catalogue. While any of them differs from what was loaded, the Sold-To, End User
 * and product Undos are withheld: putting a CDG product line back into a request now marked LSG
 * produced exactly that — a CDG code displayed as an LSG one. Undoing the upstream field restores
 * them all together.
 */
const CATALOG_CONTEXT_KEYS = ['returnType', 'businessUnit', 'isService'] as const satisfies readonly (keyof ReturnFormData)[]

/** The wizard's form key(s) behind each summary field, for "was" and Undo. */
const FIELD_KEYS: Record<ReturnSummaryField, readonly (keyof ReturnFormData)[]> = {
  returnType: ['returnType'],
  requestDate: ['requestDate'],
  isService: ['isService'],
  businessUnit: ['businessUnit'],
  requester: ['requesterName', 'salesRepCodeSap'],
  soldTo: ['soldToCode', 'soldToName'],
  endUser: ['endUserCode', 'endUserName'],
  dairitenContactName: ['dairitenContactName'],
  dairitenContactEmail: ['dairitenContactEmail'],
  originalOrderNumber: ['originalOrderNumber'],
  invoiceDate: ['invoiceDate', 'isStandingOrder', 'additionalInvoiceDates'],
  quoteRefNo: ['quoteRefNo'],
  orderReason: ['orderReason'],
  justification: ['justification'],
}

export type ReturnReviewTimelineRow = { num: number; role: string; name: string; isReviewer?: boolean }

export type ReturnReviewSession = {
  /** The request as stored: reference, approvals, trail. */
  stored: Record<string, any> | null
  /** The request as it was loaded, mapped onto the wizard's form. */
  original: ReturnFormData | null
  isLoading: boolean
  loadError: string | null

  /** "was: …" for every summary field whose value differs from what was loaded. */
  previous: Partial<Record<ReturnSummaryField, string>>
  productsPrevious: string | undefined
  /**
   * The lines themselves, as loaded, whenever they differ from the ones on screen.
   *
   * The summary line above counts them and totals them; this is what they were. Needed most in the
   * one case where Undo is withheld — a change of type, unit or service flag clears the lines with
   * the catalogue they belong to.
   */
  productsPreviousLines: ProductItem[] | undefined
  anythingChanged: boolean
  undoField: (field: ReturnSummaryField) => void
  undoProducts: (() => void) | undefined
  canUndoField: (field: ReturnSummaryField) => boolean

  /** A wrong value — blocks saving. */
  formatErrors: Partial<Record<ReturnSummaryField | 'products', string>>
  /** An empty required value — blocks sending. */
  missingFields: ReturnRequiredField[]
  /** Both, for the summary to paint. */
  errors: Partial<Record<ReturnSummaryField | 'products', string>>
  jumpToFirstMissing: () => void

  /** The route as it stands or as it will be rebuilt, with the old one when it changed. */
  timeline: ReturnReviewTimelineRow[]
  timelinePrevious: string | undefined
  routeChanged: boolean
  routeMissing: boolean

  canSave: boolean
  isSaving: boolean
  isSending: boolean
  isDiscarding: boolean
  actionError: string | null
  savedNotice: boolean
  save: () => Promise<boolean>
  discardAll: () => Promise<void>
  sendForApproval: () => Promise<void>
  sendBack: () => Promise<void>
  leave: () => void

  /** Match the loaded requester to a directory row once the team's members are known. */
  resolveRequester: (reps: SalesRep[]) => void
}

/**
 * The stored request as the wizard's form model.
 *
 * The requester's directory row id is resolved later, by name, once the team's members load. The
 * request date is kept as stored — this is the request itself, not a copy of it.
 */
function toFormData(f: Record<string, any>, base: ReturnFormData): ReturnFormData {
  const dates: string[] = (Array.isArray(f.invoiceDates) ? f.invoiceDates : []).map(str).filter(Boolean)
  const [first, ...rest] = dates.length > 0 ? dates : [str(f.invoiceDate)]
  const bu = str(f.businessUnit).toUpperCase()
  return {
    ...base,
    id: str(f.id),
    returnType: str(f.returnType) as ReturnFormData['returnType'],
    requestDate: str(f.requestDate).slice(0, 10),
    businessUnit: (bu === 'CDG' || bu === 'LSG' ? bu : '') as ReturnFormData['businessUnit'],
    isService: Boolean(f.isService),
    requesterGroup: str(f.requesterGroup),
    requesterId: '',
    requesterName: str(f.requesterName),
    salesRepCodeSap: str(f.salesRepCodeSap),
    ...EMPTY_ROUTE,
    soldToCode: str(f.soldToCode),
    soldToName: str(f.soldToName),
    endUserCode: str(f.endUserCode),
    endUserName: str(f.endUserName),
    dairitenContactName: str(f.dairitenContactName),
    dairitenContactEmail: str(f.dairitenContactEmail),
    originalOrderNumber: str(f.originalOrderNumber),
    invoiceDate: str(first).slice(0, 10),
    isStandingOrder: Boolean(f.isStandingOrder),
    additionalInvoiceDates: rest.map((d) => d.slice(0, 10)),
    quoteRefNo: str(f.quoteRefNo),
    orderReason: str(f.orderReason) as ReturnFormData['orderReason'],
    justification: str(f.justification),
    products: (f.products ?? []).map((p: Record<string, any>, i: number): ProductItem => {
      const returnAmount = num(p.returnAmount)
      const line = {
        quantity: num(p.quantity),
        unitPrice: num(p.unitPrice),
        wholesalePrice: num(p.wholesalePrice ?? p.unitPrice),
      }
      const returned = overrideState(returnAmount, line)
      const rebilled = overrideState(num(p.rebillAmount), line)
      return {
        id: str(p.id) || `loaded-${i}`,
        productCode: str(p.productCode),
        sapCode: str(p.sapCode),
        productName: str(p.productName),
        quantity: num(p.quantity),
        unitPrice: num(p.unitPrice),
        wholesalePrice: num(p.wholesalePrice ?? p.unitPrice),
        subTotal: returnAmount,
        lotNumber: str(p.lotNumber),
        note: p.note ?? undefined,
        isConsumable: Boolean(p.isConsumable),
        returnAmount,
        rebillAmount: num(p.rebillAmount),
        // The requester's figures stand. One that differs from the catalogue was overwritten and
        // follows the quantity if the reviewer changes it; one that matches stays with the catalogue.
        returnAmountOverridden: returned.overridden,
        returnUnitBasis: returned.basis,
        rebillAmountOverridden: rebilled.overridden,
        rebillUnitBasis: rebilled.basis,
      }
    }),
    status: 'DRAFT',
    backendDraftId: undefined,
  }
}

export function useReturnReview(opts: { enabled: boolean; formId: string | undefined; emptyForm: () => ReturnFormData }): ReturnReviewSession | null {
  const { enabled, formId, emptyForm } = opts
  const navigate = useNavigate()
  const { t } = useI18n()
  const { form, setForm, setPersistEnabled, resetForm } = useReturnFormCtx()

  const [stored, setStored] = useState<Record<string, any> | null>(null)
  const [original, setOriginal] = useState<ReturnFormData | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [loadingRoute, setLoadingRoute] = useState(false)

  const originalRef = useRef(original)
  originalRef.current = original
  const missingFieldsRef = useRef<string[]>([])

  /*
   * A review must not become the requester's next draft. The context saves every change to
   * localStorage for the wizard's own use; while a review is open that is switched off, and the
   * shared form is reset on the way out so nothing of the reviewed request survives into
   * /return/new.
   */
  useEffect(() => {
    if (!enabled) return
    setPersistEnabled(false)
    return () => {
      setPersistEnabled(true)
      resetForm()
    }
  }, [enabled, setPersistEnabled, resetForm])

  const load = useCallback(async () => {
    if (!enabled || !formId) return
    setIsLoading(true)
    try {
      const data = await formsApi.getForm(formId)
      const f = data.form ?? data
      setStored(f)
      const base = toFormData(f, emptyForm())
      // The requester's matrix row, so a change of Service or unit alone can be previewed and the
      // wizard's step 1 has a route to validate.
      const withRoute = {
        ...base,
        ...(await fetchMatrixRoute(base.requesterName, base.businessUnit, base.requesterGroup)),
      }
      setOriginal(withRoute)
      setForm(withRoute)
      setLoadError(null)
    } catch (e) {
      setLoadError(extractApiError(e, 'Could not load this request.'))
    } finally {
      setIsLoading(false)
    }
  }, [enabled, formId, emptyForm, setForm])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The stored request names its requester but not the directory row the picker uses. Once the
   * team's members are known the row is found by name — on the draft and on the original alike, so
   * resolving it never reads as a change.
   */
  const resolveRequester = useCallback(
    (reps: SalesRep[]) => {
      const o = originalRef.current
      if (!o || o.requesterId || !o.requesterName) return
      const hit = reps.find((r) => isSamePerson(r.name, o.requesterName))
      if (!hit) return
      const withId = (f: ReturnFormData | null) =>
        f && !f.requesterId && f.requesterGroup === o.requesterGroup && isSamePerson(f.requesterName, o.requesterName)
          ? { ...f, requesterId: hit.id }
          : f
      setOriginal(withId)
      setForm((f) => withId(f) ?? f)
    },
    [setForm]
  )

  /* ------------------------------------------------------------------ route: as stored, or as it will be rebuilt */

  // When the corrected requester/unit pair differs from the loaded one and the wizard has not yet
  // fetched a route for it (a re-pick of the same person in another unit, say), fetch it here.
  const routeKey = `${form.requesterName}|${form.businessUnit}|${form.requesterGroup}`
  const originalRouteKey = original ? `${original.requesterName}|${original.businessUnit}|${original.requesterGroup}` : ''
  useEffect(() => {
    if (!enabled || !original) return
    if (routeKey === originalRouteKey) return
    if (!form.requesterName) return
    if (ROUTE_KEYS.some((k) => form[k])) return
    let cancelled = false
    setLoadingRoute(true)
    const [name, bu, group] = routeKey.split('|')
    fetchMatrixRoute(name, bu, group)
      .then((route) => {
        if (cancelled) return
        setForm((f) => (`${f.requesterName}|${f.businessUnit}|${f.requesterGroup}` === routeKey ? { ...f, ...route } : f))
      })
      .finally(() => {
        if (!cancelled) setLoadingRoute(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, routeKey, originalRouteKey])

  const storedChain = useMemo(
    () =>
      [...(stored?.approvals ?? [])]
        .sort((a: any, b: any) => a.level - b.level)
        .map((a: any) => ({ id: str(a.id), role: str(a.role), name: str(a.approverName), status: str(a.status) })),
    [stored]
  )
  const currentReviewStep = storedChain.find((s) => s.status === 'IN_PROGRESS' && isReturnReviewerRole(s.role)) ?? null

  const routeChanged = Boolean(
    original &&
      (original.requesterName !== form.requesterName ||
        original.businessUnit !== form.businessUnit ||
        original.isService !== form.isService)
  )
  const previewFollowers = useMemo(
    () =>
      routeChanged
        ? buildReturnHierarchyRows(form, form.requesterName, { isService: form.isService }).filter(
            (r) => !isReturnReviewerRole(r.role)
          )
        : [],
    [form, routeChanged]
  )
  const timeline = useMemo<ReturnReviewTimelineRow[]>(() => {
    const rows: ReturnReviewTimelineRow[] = [
      {
        num: 0,
        role: 'Sales Rep / Requester',
        name: formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap),
        isReviewer: false,
      },
    ]
    if (!routeChanged) {
      storedChain.forEach((s, i) =>
        rows.push({ num: i + 1, role: s.role, name: s.name, isReviewer: isReturnReviewerRole(s.role) })
      )
      return rows
    }
    let n = 1
    if (currentReviewStep) rows.push({ num: n++, role: currentReviewStep.role, name: currentReviewStep.name, isReviewer: true })
    previewFollowers.forEach((r) => rows.push({ num: n++, role: r.role, name: r.name, isReviewer: r.isReviewer }))
    return rows
  }, [form.requesterName, form.salesRepCodeSap, routeChanged, storedChain, currentReviewStep, previewFollowers])
  const timelinePrevious = routeChanged ? storedChain.map((s) => s.name).join(' → ') : undefined
  // A requester with no matrix row has no route — the same state that blocks Next in the wizard.
  const routeMissing = routeChanged && !loadingRoute && Boolean(form.requesterName) && previewFollowers.length === 0

  /* ------------------------------------------------------------------ "was", and Undo */

  const amountRules = useMemo(() => getReturnAmountRules(form.returnType), [form.returnType])
  const labelFor = (opts: ReadonlyArray<{ value: string; label: string }>, code: string) =>
    opts.find((o) => o.value === code)?.label || code || '—'
  const datesLabel = (d: ReturnFormData) =>
    d.isStandingOrder ? [d.invoiceDate, ...d.additionalInvoiceDates].filter(Boolean).join(', ') : d.invoiceDate

  const previous = useMemo(() => {
    if (!original) return {}
    const out: Partial<Record<ReturnSummaryField, string>> = {}
    const changed = (field: ReturnSummaryField) =>
      FIELD_KEYS[field].some((k) => JSON.stringify(original[k]) !== JSON.stringify(form[k]))
    if (changed('returnType')) out.returnType = labelFor(RETURN_TYPE_OPTIONS, original.returnType)
    if (changed('requestDate')) out.requestDate = original.requestDate
    if (changed('isService')) out.isService = original.isService ? t('return.form.serviceYes') : t('return.form.serviceNo')
    if (changed('businessUnit')) out.businessUnit = original.businessUnit || '—'
    if (changed('requester')) out.requester = formatRequesterWithSalesRepCode(original.requesterName, original.salesRepCodeSap)
    if (changed('soldTo')) out.soldTo = [original.soldToName, original.soldToCode].filter(Boolean).join(' · ')
    if (changed('endUser')) out.endUser = [original.endUserName, original.endUserCode].filter(Boolean).join(' · ')
    if (changed('dairitenContactName')) out.dairitenContactName = original.dairitenContactName
    if (changed('dairitenContactEmail')) out.dairitenContactEmail = original.dairitenContactEmail
    if (changed('originalOrderNumber')) out.originalOrderNumber = original.originalOrderNumber
    if (changed('invoiceDate')) out.invoiceDate = datesLabel(original)
    if (changed('quoteRefNo')) out.quoteRefNo = original.quoteRefNo
    if (changed('orderReason')) out.orderReason = labelFor(RETURN_ORDER_REASON_OPTIONS, original.orderReason)
    if (changed('justification')) out.justification = original.justification
    return out
  }, [original, form, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const productsChanged = useMemo(
    () =>
      !!original &&
      (form.products ?? []).map(lineFingerprint).join('\n') !== original.products.map(lineFingerprint).join('\n'),
    [form.products, original]
  )
  const productsPrevious = useMemo(() => {
    if (!productsChanged || !original) return undefined
    const returnTotal = original.products.reduce((s, p) => s + num(p.returnAmount), 0)
    const rebillTotal = amountRules.rebillAmountEditable ? original.products.reduce((s, p) => s + num(p.rebillAmount), 0) : 0
    return (
      `${original.products.length} ${t('return.review.productsSummary')} · ` +
      `${t('return.form.returnAmountTotal')} ¥${returnTotal.toLocaleString()} · ` +
      `${t('return.form.rebillAmountTotal')} ¥${rebillTotal.toLocaleString()}`
    )
  }, [productsChanged, original, amountRules.rebillAmountEditable, t])

  const anythingChanged = Object.keys(previous).length > 0 || productsChanged

  const catalogContextChanged = useMemo(
    () => Boolean(original && CATALOG_CONTEXT_KEYS.some((k) => original[k] !== form[k])),
    [original, form]
  )
  const canUndoField = useCallback(
    (field: ReturnSummaryField) => !catalogContextChanged || (field !== 'soldTo' && field !== 'endUser'),
    [catalogContextChanged]
  )

  /**
   * One field back to what was loaded. A field that cascades (type, unit, service, team) takes
   * everything its change cleared back with it; Sold-To, End User and the invoice dates are several
   * stored fields each.
   */
  const undoField = useCallback(
    (field: ReturnSummaryField) => {
      const o = originalRef.current
      if (!o) return
      const restore = (d: ReturnFormData, keys: readonly (keyof ReturnFormData)[]) => {
        const next = { ...d }
        for (const k of keys) (next as any)[k] = o[k]
        return next
      }
      setForm((d) => {
        switch (field) {
          case 'returnType':
          case 'businessUnit':
          case 'isService':
            return restore(d, [field, ...CASCADE_KEYS])
          case 'requester':
            return restore(d, REQUESTER_KEYS)
          default:
            return restore(d, FIELD_KEYS[field])
        }
      })
    },
    [setForm]
  )
  const undoProducts = useCallback(() => {
    const o = originalRef.current
    if (o) setForm((d) => ({ ...d, products: o.products }))
  }, [setForm])

  /* ------------------------------------------------------------------ the two gates */

  /** A value that is wrong rather than absent. Blocks saving. */
  const formatErrors = useMemo(() => {
    const e: Partial<Record<ReturnSummaryField | 'products', string>> = {}
    const nameErr = getReturnContactNameError(form.dairitenContactName)
    if (nameErr === 'invalid') e.dairitenContactName = t('return.form.error.nameInvalid')
    if (getOptionalReturnContactEmailError(form.dairitenContactEmail)) e.dairitenContactEmail = t('return.form.error.email')
    const orderErr = getOptionalReturnOrderNumberError(form.originalOrderNumber)
    if (orderErr)
      e.originalOrderNumber = t(
        orderErr === 'prefix'
          ? 'return.form.error.orderPrefix'
          : orderErr === 'length'
            ? 'return.form.error.orderLength'
            : 'return.form.error.orderDigits'
      )
    // An invoice date in the future is wrong, not missing: it blocks saving, as on the form.
    if ([form.invoiceDate, ...(form.additionalInvoiceDates ?? [])].some((d) => isFutureInvoiceDate(d)))
      e.invoiceDate = t('return.form.error.invoiceDateFuture')
    if ((form.products ?? []).length > 0) {
      const productsErr = returnProductsErrorKey(form.products, amountRules.rebillAmountEditable)
      if (productsErr) e.products = t(productsErr)
    }
    return e
  }, [form, amountRules.rebillAmountEditable, t])

  /** Still empty. Does not block saving; blocks sending. */
  const missingFields = useMemo(() => missingReturnFieldsForApproval(form), [form])
  missingFieldsRef.current = missingFields

  const errors = useMemo(() => {
    const e: Partial<Record<ReturnSummaryField | 'products', string>> = { ...formatErrors }
    const required = t('return.review.required')
    for (const f of missingFields) {
      const key = f === 'products' ? 'products' : (f as ReturnSummaryField)
      if (!e[key]) e[key] = required
    }
    return e
  }, [formatErrors, missingFields, t])

  const jumpToFirstMissing = useCallback(() => {
    const first = missingFieldsRef.current[0]
    if (!first) return
    const el =
      document.querySelector(`[data-return-summary-field="${first}"]`) ??
      document.querySelector(`[data-return-field="${first}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const canSave = Object.keys(formatErrors).length === 0 && !routeMissing && !loadingRoute

  /* ------------------------------------------------------------------ actions */

  const backToQueue = useCallback(() => navigate(`/return/review?expand=${formId}`), [navigate, formId])
  const leave = useCallback(() => {
    if (anythingChanged && !window.confirm(t('return.review.leaveConfirm'))) return
    backToQueue()
  }, [anythingChanged, backToQueue, t])

  const save = useCallback(async (): Promise<boolean> => {
    if (!formId || !canSave) return false
    setIsSaving(true)
    setActionError(null)
    try {
      const returnTotal = (form.products ?? []).reduce((s, p) => s + num(p.returnAmount), 0)
      // Only what the wizard owns. Sending the whole row back would rewrite columns the reviewer
      // never saw, and the trail would then claim they changed them.
      await formsApi.updateForm(formId, {
        returnType: form.returnType || undefined,
        isService: form.isService,
        requestDate: form.requestDate || undefined,
        businessUnit: form.businessUnit || undefined,
        requesterGroup: form.requesterGroup || undefined,
        requesterName: form.requesterName || undefined,
        salesRepCodeSap: form.requesterId
          ? hasDisplayableSalesRepCode(form.salesRepCodeSap)
            ? String(form.salesRepCodeSap).trim()
            : ''
          : form.salesRepCodeSap,
        soldToCode: form.soldToCode || undefined,
        soldToName: form.soldToName || undefined,
        endUserCode: form.endUserCode || undefined,
        endUserName: form.endUserName || undefined,
        dairitenContactName: form.dairitenContactName || undefined,
        dairitenContactEmail: form.dairitenContactEmail || undefined,
        originalOrderNumber: form.originalOrderNumber || undefined,
        isStandingOrder: form.isStandingOrder,
        invoiceDates: [form.invoiceDate, ...(form.isStandingOrder ? form.additionalInvoiceDates : [])].filter(Boolean),
        quoteRefNo: form.quoteRefNo,
        orderReason: form.orderReason || undefined,
        justification: form.justification,
        totalAmount: returnTotal,
        products: (form.products ?? [])
          .filter((p) => p.productCode)
          .map((p) => ({
            productCode: p.productCode,
            productName: p.productName,
            sapCode: p.sapCode || undefined,
            quantity: num(p.quantity),
            unitPrice: num(p.unitPrice),
            wholesalePrice: num(p.wholesalePrice ?? p.unitPrice),
            lotNumber: p.lotNumber || undefined,
            note: p.note || undefined,
            returnAmount: num(p.returnAmount),
            rebillAmount: amountRules.rebillAmountEditable ? num(p.rebillAmount) : 0,
          })),
      })
      // What is saved is now what was loaded: reload so "was" lines clear and the trail shows.
      await load()
      setSavedNotice(true)
      setTimeout(() => setSavedNotice(false), 4000)
      return true
    } catch (e) {
      setActionError(extractApiError(e, 'Could not save these corrections.'))
      return false
    } finally {
      setIsSaving(false)
    }
  }, [formId, canSave, form, amountRules.rebillAmountEditable, load])

  const discardAll = useCallback(async () => {
    if (!formId) return
    if (!window.confirm(t('return.review.discardAllConfirm'))) return
    setIsDiscarding(true)
    setActionError(null)
    try {
      await formsApi.revertReviewEdits(formId)
      await load()
    } catch (e) {
      setActionError(extractApiError(e, 'Could not discard the corrections.'))
    } finally {
      setIsDiscarding(false)
    }
  }, [formId, load, t])

  /**
   * Send for approval: save anything unsaved, then clear the review step. The server refuses the
   * step while a required field is empty (400 naming the fields), so the emailed link cannot get
   * round the gate either; the button is disabled first, this is the backstop.
   */
  const sendForApproval = useCallback(async () => {
    if (!currentReviewStep) {
      setActionError('This request is not at its review step.')
      return
    }
    if (missingFieldsRef.current.length > 0) return
    setIsSending(true)
    setActionError(null)
    try {
      if (anythingChanged) {
        const ok = await save()
        if (!ok) return
      }
      await approvalsApi.approveForm(currentReviewStep.id)
      navigate('/return/review')
    } catch (e) {
      setActionError(extractApiError(e, 'Could not send this request for approval.'))
    } finally {
      setIsSending(false)
    }
  }, [currentReviewStep, anythingChanged, save, navigate])

  const sendBack = useCallback(async () => {
    if (!currentReviewStep) {
      setActionError('This request is not at its review step.')
      return
    }
    const reason = window.prompt(t('return.review.sendBackReason'))
    if (reason == null) return
    if (!reason.trim()) {
      setActionError(t('return.review.sendBackReasonRequired'))
      return
    }
    setIsSending(true)
    setActionError(null)
    try {
      await approvalsApi.rejectForm(currentReviewStep.id, reason.trim())
      navigate('/return/review')
    } catch (e) {
      setActionError(extractApiError(e, 'Could not send this request back.'))
    } finally {
      setIsSending(false)
    }
  }, [currentReviewStep, navigate, t])

  if (!enabled) return null
  return {
    stored,
    original,
    isLoading,
    loadError,
    previous,
    productsPrevious,
    productsPreviousLines: productsChanged && original ? original.products : undefined,
    anythingChanged,
    undoField,
    undoProducts: catalogContextChanged ? undefined : undoProducts,
    canUndoField,
    formatErrors,
    missingFields,
    errors,
    jumpToFirstMissing,
    timeline,
    timelinePrevious,
    routeChanged,
    routeMissing,
    canSave,
    isSaving,
    isSending,
    isDiscarding,
    actionError,
    savedNotice,
    save,
    discardAll,
    sendForApproval,
    sendBack,
    leave,
    resolveRequester,
  }
}

export type { Approval }
