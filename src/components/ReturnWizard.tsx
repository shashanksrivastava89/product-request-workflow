import React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SearchSelect from './SearchSelect'
import ReturnProductRows, { RETURN_PRODUCT_ADD_BUTTON_CLASS, returnProductsErrorKey } from './ReturnProductRows'
import ReturnSummary from './ReturnSummary'
import { useI18n } from '../providers/I18nContext'
import { useAuth } from '../providers/AuthContext'
import {
  useReturnFormCtx,
  emptyReturnForm,
  resetReturnDownstream,
  type ReturnBusinessUnit,
  type ReturnFormData,
} from '../providers/ReturnFormContext'
import { RETURN_TYPE_OPTIONS, type ReturnTypeCode } from '../constants/returnTypes'
import { RETURN_ORDER_REASON_OPTIONS, type ReturnOrderReasonCode } from '../constants/returnOrderReasons'
import {
  getOptionalReturnOrderNumberError,
  getReturnOrderNumberError,
} from '../utils/returnOrderNumber'
import {
  getOptionalReturnContactEmailError,
  getReturnContactNameError,
  isValidOptionalReturnContactEmail,
  isValidReturnContactName,
} from '../utils/returnContactValidation'
import {
  formatSalesRepOptionLabel,
  formatRequesterWithSalesRepCode,
  hasDisplayableSalesRepCode,
} from '../utils/sales-rep-display.util'
import {
  applyReturnAmountDefaults,
  getReturnAmountRules,
  nextProductLine,
  overrideState,
} from '../utils/returnAmountRules'
import { loadReturnRequesterGroups } from '../utils/returnRequesterGroups'
import { resolveReturnCatalogBusinessUnit } from '../utils/returnCatalogBusinessUnit'
import apiClient, { staticDataApi, type SalesRep, type Product } from '../services/api.service'
import { RETURN_DRAFT_PREFIX, clearDraft } from '../utils/formDraftStorage'
import { buildReturnHierarchyRows, type ReturnHierarchyRow } from '../utils/return-approval.util'
import { useReturnReview } from '../hooks/useReturnReview'
import { RETURN_REQUIRED_FIELD_LABEL_KEYS } from '../utils/returnCompleteness'
import { ReviewEditTrailSection } from './RequestDetailSections'
import ReturnPreviousProductLines from './ReturnPreviousProductLines'
import QuantityInput from './QuantityInput'
import { formatProductCodes } from '../utils/productCodes'
import { isFutureInvoiceDate, todayInJapan } from '../utils/returnInvoiceDate'
import { hasServiceAdminPrivileges } from '../utils/service-admin.util'
import type { ReturnSummaryField } from './ReturnSummary'

function empty(v: string | null | undefined): string {
  return (v ?? '').trim()
}

function RequiredMark() {
  return <span className="text-red-600 ml-0.5" aria-hidden="true">*</span>
}

/**
 * What a yen amount input should display.
 *
 * Zero shows as an empty box rather than "0". Binding `value={amount ?? 0}` meant the field always
 * contained a 0 that typing appended to, so entering 1500 produced 01500 — reported from UAT as
 * "currency keep first zero". The Qty input in this same row already used the empty-when-zero
 * pattern; this is that pattern for money.
 */
function buildHierarchyRows(form: ReturnFormData): ReturnHierarchyRow[] {
  // The Service selector decides both service-only extras: the review step in front and the two
  // service managers at the end. The sheet fills levels 4-5 on every non-service row regardless,
  // so the flag is what decides; and a requester already inside Service carries those managers in
  // their own levels 2/3, so nothing is appended for them either way. The rows themselves are built
  // by the helper the reviewer's correction screen also uses, so the two previews cannot drift.
  return buildReturnHierarchyRows(form, form.requesterName, { isService: form.isService })
}

/** The key the list pages stash the created copy under, shared with the sample wizard. */
const WIZARD_BOOTSTRAP_DRAFT_KEY = 'japauto_wizard_bootstrap_draft:'

/**
 * A stored RETURN row as this wizard's form.
 *
 * Only used for a draft made by "Create New Case from Copy". Every return-only column is mapped —
 * the return type, the invoice dates, the standing-order flag, the order reason — because those are
 * exactly what was lost while a copied return opened in the sample wizard, whose form model has no
 * field to put them in.
 */
function mapServerFormToReturnForm(api: Record<string, any>): ReturnFormData {
  const base = emptyReturnForm()
  const str = (v: unknown) => (v == null ? '' : String(v).trim())
  const day = (v: unknown) => str(v).slice(0, 10)
  const num = (v: unknown, fallback = 0) => {
    const n = Number(v ?? fallback)
    return Number.isFinite(n) ? n : fallback
  }
  const dates = (Array.isArray(api.invoiceDates) ? api.invoiceDates : []).map(day).filter(Boolean)
  const allDates = dates.length > 0 ? dates : [day(api.invoiceDate)].filter(Boolean)
  const bu = str(api.businessUnit).toUpperCase()
  // A reopened return has been submitted before, so it still has its reference number and history.
  const history = Array.isArray(api.approvalHistory) ? api.approvalHistory : []
  const lastRound = history[history.length - 1]
  const rejectedStep = lastRound?.approvals?.find((a: any) => a?.status === 'REJECTED')
  return {
    ...base,
    backendDraftId: str(api.id),
    reopenedReference: str(api.referenceNumber) || undefined,
    reopenedRejection: rejectedStep
      ? {
          by: str(rejectedStep.actualActorName) || str(rejectedStep.approverName),
          role: str(rejectedStep.role),
          reason: str(rejectedStep.comments) || null,
        }
      : undefined,
    returnType: str(api.returnType) as ReturnFormData['returnType'],
    // A copy is a request being made now, not a reprint of the original's date. A REOPENED request
    // is the same request being corrected, so it keeps the date it was raised on.
    requestDate: (str(api.referenceNumber) && day(api.requestDate)) || new Date().toISOString().slice(0, 10),
    businessUnit: (bu === 'CDG' || bu === 'LSG' ? bu : '') as ReturnFormData['businessUnit'],
    isService: api.isService === true,
    requesterGroup: str(api.requesterGroup),
    // A form stores the requester's name, not the directory row id; the picker resolves it back
    // once the group's sales reps load, and the name alone is what the route is built from.
    requesterId: '',
    requesterName: str(api.requesterName),
    salesRepCodeSap: str(api.salesRepCodeSap),
    soldToCode: str(api.soldToCode),
    soldToName: str(api.soldToName),
    endUserCode: str(api.endUserCode),
    endUserName: str(api.endUserName),
    dairitenContactName: str(api.dairitenContactName),
    dairitenContactEmail: str(api.dairitenContactEmail),
    originalOrderNumber: str(api.originalOrderNumber),
    invoiceDate: allDates[0] ?? '',
    isStandingOrder: api.isStandingOrder === true,
    additionalInvoiceDates: allDates.slice(1),
    quoteRefNo: str(api.quoteRefNo),
    orderReason: str(api.orderReason) as ReturnFormData['orderReason'],
    justification: str(api.justification),
    products: (Array.isArray(api.products) ? api.products : []).map((p: Record<string, any>) => {
      const returnAmount = num(p.returnAmount)
      const line = {
        quantity: num(p.quantity, 1) || 1,
        unitPrice: num(p.unitPrice),
        wholesalePrice: num(p.wholesalePrice ?? p.unitPrice),
      }
      const returned = overrideState(returnAmount, line)
      const rebilled = overrideState(num(p.rebillAmount), line)
      return {
        id: crypto.randomUUID(),
        productCode: str(p.productCode),
        sapCode: str(p.sapCode),
        productName: str(p.productName),
        quantity: num(p.quantity, 1) || 1,
        unitPrice: num(p.unitPrice),
        wholesalePrice: num(p.wholesalePrice ?? p.unitPrice),
        subTotal: num(p.subtotal ?? returnAmount),
        lotNumber: str(p.lotNumber),
        note: p.note ?? undefined,
        isConsumable: p.isConsumable === true,
        returnAmount,
        rebillAmount: num(p.rebillAmount),
        // A copied figure that differs from the catalogue was overwritten: it stands as entered and
        // follows the quantity. One that matches is the catalogue's, and stays with it.
        returnAmountOverridden: returned.overridden,
        returnUnitBasis: returned.basis,
        rebillAmountOverridden: rebilled.overridden,
        rebillUnitBasis: rebilled.basis,
      }
    }),
    status: 'DRAFT',
  }
}

/**
 * What colours the frame: Acme green for a requester's own request, purple for a review.
 *
 * Only the chrome changes - progress bar, step circles, buttons, product rows, the summary card.
 * The fields, their order, their cascade and their validation are the same JSX in both modes, which
 * is the whole point: a field added to a step is added for the reviewer in the same edit.
 */
const CREATE_UI = {
  hex: '#00A651',
  hexHover: '#008A44',
  stepOn: 'border-[#00A651] bg-[#00A651] text-white',
  link: 'text-[#00A651]',
  ring: 'focus:ring-[#00A651] focus:border-[#00A651]',
  productsIcon: 'text-[#00A651]',
  nextField: 'transition-all duration-300 rounded-lg border-2 border-emerald-300 bg-emerald-50/70 p-1 -m-1',
  accent: 'green' as const,
} as const
const REVIEW_UI = {
  hex: '#9333EA',
  hexHover: '#6B21A8',
  stepOn: 'border-[#9333EA] bg-[#9333EA] text-white',
  link: 'text-[#9333EA]',
  ring: 'focus:ring-[#9333EA] focus:border-[#9333EA]',
  productsIcon: 'text-[#9333EA]',
  nextField: 'transition-all duration-300 rounded-lg border-2 border-purple-300 bg-purple-50/70 p-1 -m-1',
  accent: 'purple' as const,
} as const
const REVIEW_BAR = 'from-[#9333EA] to-[#6B21A8]'

export type ReturnWizardMode = 'create' | 'review'

/**
 * The return wizard, for a new request or for the service review of a submitted one.
 *
 * `review` opens the request named in the route (`/return/edit/:id`) in the same three steps a
 * requester walks, with everything that is true only of a review layered on by useReturnReview:
 * the request as loaded, "was: …" with an Undo on every changed field, the route preview when the
 * route inputs change, the two gates (malformed blocks saving, empty blocks sending), and a footer
 * that saves to the same request rather than creating one. See that hook for why the reviewer no
 * longer has a screen of their own.
 */

/**
 * The line under a product in the picker.
 *
 * CDG carries a SAP number and shows both; LSG has none, so it shows the local code alone rather
 * than the same number twice under two labels.
 */
function productPickerSub(prod: { sapCode?: string | null; code: string }, unit: string): string {
  // The same line every screen and mail prints under a product name - see ProductCodeLine.
  return formatProductCodes({ productCode: prod.code, sapCode: prod.sapCode }, '—', unit)
}
export default function ReturnWizard({ mode = 'create' }: { mode?: ReturnWizardMode } = {}) {
  const reviewing = mode === 'review'
  const ui = reviewing ? REVIEW_UI : CREATE_UI
  const { id: reviewFormId } = useParams<{ id: string }>()
  const { t } = useI18n()
  const { user, isLoading: userLoading } = useAuth()
  const { form, setForm, resetForm } = useReturnFormCtx()
  const navigate = useNavigate()
  const [step, setStep] = React.useState(1)
  const review = useReturnReview({ enabled: reviewing, formId: reviewFormId, emptyForm: emptyReturnForm })
  const [searchParams] = useSearchParams()
  const draftIdFromUrl = (searchParams.get('draft') ?? '').trim()
  const [highlightMissing, setHighlightMissing] = React.useState(false)
  const [validatedBanner, setValidatedBanner] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [orderNumberTouched, setOrderNumberTouched] = React.useState(false)
  const [contactNameTouched, setContactNameTouched] = React.useState(false)
  const [contactEmailTouched, setContactEmailTouched] = React.useState(false)

  const [availableRequesterGroups, setAvailableRequesterGroups] = React.useState<
    Array<{ id: string; name: string }>
  >([])
  const [loadingRequesterGroups, setLoadingRequesterGroups] = React.useState(false)
  const [requesterGroupsError, setRequesterGroupsError] = React.useState<string | null>(null)

  const [fetchedSalesReps, setFetchedSalesReps] = React.useState<SalesRep[]>([])
  const [loadingSalesReps, setLoadingSalesReps] = React.useState(false)
  const [salesRepsError, setSalesRepsError] = React.useState<string | null>(null)

  const lockRequesterStep = !reviewing && user?.role === 'REQUESTER'

  /**
   * Which teams and requester rows actually belong to this person, from the `requesters` table.
   *
   * The wizard used to narrow both dropdowns using `user.requesterGroupId` and `user.salesRepCode`.
   * Neither describes a Return requester: a person belongs to as many teams as they have requester
   * rows (38 people on UAT hold two or three), and 120 of 123 requester accounts have no sales rep
   * code at all. The old filters therefore returned an empty list for most requesters, and because
   * each field is disabled at one option or fewer, they were left with a grey box and no way on.
   *
   * `null` while loading and `unrestricted` when no row could be tied to the account — in both
   * cases nothing is narrowed.
   */
  const [requesterScope, setRequesterScope] = React.useState<{
    unrestricted: boolean
    groupIds: string[]
    requesterIds: string[]
  } | null>(null)

  React.useEffect(() => {
    if (!lockRequesterStep) return
    let cancelled = false
    staticDataApi
      .getMyRequesterScope()
      .then((scope) => {
        if (!cancelled) setRequesterScope(scope)
      })
      .catch(() => {
        // Never trade a failed lookup for a locked form: fall back to no restriction.
        if (!cancelled) setRequesterScope({ unrestricted: true, groupIds: [], requesterIds: [] })
      })
    return () => {
      cancelled = true
    }
  }, [lockRequesterStep])

  /**
   * Every team available for the chosen business unit — the scope no longer narrows this list.
   *
   * Narrowing it to the person's own teams is what produced Nia Hargreaves's 3 Sep report: with
   * Service = Yes her two planner teams reduced to a single match, and a single option meant the
   * field was locked. With Service = No none of her teams were on offer, so it fell back to the
   * whole list and stayed open — the inconsistency she was asking about.
   *
   * Service = No has always offered the unit's full team list, so matching it under Service = Yes
   * restores consistency rather than widening anything. The scope is still used, but only to
   * pre-fill the person's own team; see the effect below.
   *
   * Note the knock-on: with a team other than their own selected, the requester field falls back to
   * that team's members, so a return can be raised for someone else. That is the same behaviour
   * Service = No already had, and it is how a planner raises a return on a colleague's behalf.
   */
  const requesterGroupsForDropdown = availableRequesterGroups

  const salesRepsForDropdown = React.useMemo(() => {
    if (!lockRequesterStep || !user) return fetchedSalesReps
    if (!requesterScope || requesterScope.unrestricted) return fetchedSalesReps
    /**
     * Narrow to this person's own requester rows by id. Matching on the sales rep code (what
     * `filterSalesRepsToSelf` does, and what the Sample wizard still does) cannot work here: the
     * code is absent for almost every Return requester, and the two that carry one hold the
     * placeholders `TBD` and `N/A`.
     *
     * If none of their rows sit in the chosen team, do not narrow to nothing — an empty list is
     * what froze the field before. Show the team's members and let them pick.
     */
    const mine = new Set(requesterScope.requesterIds)
    const own = fetchedSalesReps.filter((rep) => mine.has(rep.id))
    return own.length > 0 ? own : fetchedSalesReps
  }, [fetchedSalesReps, lockRequesterStep, user, requesterScope])

  const selectedRequesterGroupName = React.useMemo(() => {
    if (!form.requesterGroup) return ''
    return (
      availableRequesterGroups.find((g) => g.id === form.requesterGroup)?.name ||
      requesterGroupsForDropdown.find((g) => g.id === form.requesterGroup)?.name ||
      ''
    )
  }, [form.requesterGroup, availableRequesterGroups, requesterGroupsForDropdown])

  /** Catalogs are CDG/LSG only — SERVICE uses team suffix e.g. Technical Service(CDG). */
  const catalogBusinessUnit = React.useMemo(
    () => resolveReturnCatalogBusinessUnit(form.businessUnit, selectedRequesterGroupName),
    [form.businessUnit, selectedRequesterGroupName]
  )

  const catalogsReady = Boolean(catalogBusinessUnit)

  /*
   * Opening the new-request route always starts blank, matching the sample wizard, which does the
   * same at Wizard.tsx (`resetForm()` on every plain /new mount).
   *
   * Without this the return form came back filled in from the previous request — a UAT reviewer
   * asked "should I logout manually every time after submitting a request?" because a stale
   * requester and partner were still on screen. The sample flow never had that problem, so matching
   * it is both the fix and the consistent behaviour users already know.
   *
   * Mount-only on purpose: running on any later render would wipe the form mid-entry.
   */
  React.useEffect(() => {
    // A review loads the request itself (useReturnReview); a copy loads a draft (below).
    if (draftIdFromUrl || reviewing) return
    resetForm()
    setStep(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * `/return/new?draft=<id>` opens a copy of an existing request.
   *
   * "Create New Case from Copy" used to send every copy to the sample wizard, so a copied return
   * arrived as a sample application with its return type, invoice dates and order reason gone. The
   * copy now lands here, and this loads the row the server created and opens step 3, so the
   * requester reviews what carried over before submitting - the same shape as Wizard.tsx.
   */
  React.useEffect(() => {
    if (!draftIdFromUrl || reviewing) return
    if (!user?.id) return
    let cancelled = false
    void (async () => {
      try {
        // The list page stashes the created draft so a slow GET cannot show an empty form first.
        // The GET is still authoritative; this only fills what it does not carry.
        let bootstrap: Record<string, any> | null = null
        try {
          const raw = sessionStorage.getItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${draftIdFromUrl}`)
          if (raw) {
            bootstrap = JSON.parse(raw)
            sessionStorage.removeItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${draftIdFromUrl}`)
          }
        } catch {
          /* private browsing, or a quota refusal */
        }
        const { data } = await apiClient.get(`/forms/${draftIdFromUrl}`)
        const server = data?.form
        if (!server || server.status !== 'DRAFT') throw new Error('Draft not available')
        if (server.requesterId !== user.id) throw new Error('Not your draft')
        if (cancelled) return
        setForm(mapServerFormToReturnForm({ ...(bootstrap ?? {}), ...server }))
        // Step 2, for the same reason as the sample wizard: a clone exists to be changed, and the
        // customer, the order details and the products are all on that page.
        setStep(2)
        navigate('/return/new', { replace: true })
      } catch {
        if (cancelled) return
        window.alert(t('return.form.copyOpenFailed'))
        resetForm()
        setStep(1)
        navigate('/return/new', { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftIdFromUrl, user?.id])

  // Load requester groups when BU changes
  React.useEffect(() => {
    if (!form.businessUnit) {
      setAvailableRequesterGroups([])
      setRequesterGroupsError(null)
      // Also drop the in-flight flag: clearing the business unit while a fetch was running used to
      // leave the picker stuck on "Loading requester groups...". Reachable any time the unit is
      // cleared or switched, and now hit on every mount because the form resets itself.
      setLoadingRequesterGroups(false)
      return
    }
    let cancelled = false
    setLoadingRequesterGroups(true)
    setRequesterGroupsError(null)
    // Which teams are offered, and the two rules about that, live in one place shared with the
    // reviewer's correction screen — see loadReturnRequesterGroups.
    loadReturnRequesterGroups(form.businessUnit, form.isService)
      .then((groups) => {
        if (cancelled) return
        setAvailableRequesterGroups(groups)
      })
      .catch(() => {
        if (cancelled) return
        setRequesterGroupsError(t('return.form.error.loadGroups'))
        setAvailableRequesterGroups([])
      })
      .finally(() => {
        if (!cancelled) setLoadingRequesterGroups(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.businessUnit, form.isService, t])

  /**
   * Pre-fill the team when exactly one of the person's own teams is on offer.
   *
   * This is a convenience, not a restriction — see the `disabled` rule on the field. Two changes
   * from the previous version: it reads the requester scope rather than `user.requesterGroupId`
   * (which is null for anyone belonging to several teams, so they got no pre-fill at all), and it
   * only ever writes into an *empty* field. The old version re-applied on every render, which would
   * now silently undo a deliberate change of team.
   */
  React.useEffect(() => {
    if (!lockRequesterStep || !requesterScope || requesterScope.unrestricted) return
    if (!form.businessUnit) return
    const own = requesterGroupsForDropdown.filter((g) => requesterScope.groupIds.includes(g.id))
    if (own.length !== 1) return
    setForm((f) => {
      if (f.requesterGroup) return f
      const cleared = resetReturnDownstream(f, 'requesterGroup')
      return { ...cleared, requesterGroup: own[0].id }
    })
  }, [lockRequesterStep, requesterScope, form.businessUnit, requesterGroupsForDropdown, setForm])

  // Load sales reps when group changes
  React.useEffect(() => {
    if (!form.requesterGroup) {
      setFetchedSalesReps([])
      setSalesRepsError(null)
      return
    }
    let cancelled = false
    setLoadingSalesReps(true)
    setSalesRepsError(null)
    staticDataApi
      .getSalesReps(form.requesterGroup, 'RETURN')
      .then((res) => {
        if (cancelled) return
        setFetchedSalesReps(res.salesReps || [])
      })
      .catch(() => {
        if (cancelled) return
        setSalesRepsError(t('return.form.error.loadReps'))
        setFetchedSalesReps([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSalesReps(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.requesterGroup, t])

  const applySalesRepSelection = React.useCallback(
    (rep: SalesRep) => {
      setForm((f) => {
        const cleared = resetReturnDownstream(f, 'requesterId')
        return {
          ...cleared,
          requesterId: rep.id,
          requesterName: rep.name || '',
          salesRepCodeSap: hasDisplayableSalesRepCode(rep.code) ? String(rep.code).trim() : '',
          firstApprover: '',
          secondApprover: '',
          finalApprover: '',
        }
      })

      const name = (rep.name || '').trim()
      const bu = form.businessUnit || undefined
      if (!name) return

      staticDataApi
        .getReturnApprovers(name, bu, form.requesterGroup || undefined)
        .then((response) => {
          if (!response.approvers || !response.found) return
          const a = response.approvers
          // Stored verbatim; self-approval and the service-level gating are applied when the chain
          // is built for display, so toggling Service does not need another fetch.
          setForm((inner) => ({
            ...inner,
            // The reviewer comes back only for a service return with the step switched on, so the
            // preview shows the review step exactly when the built chain will have one.
            reviewer: a.reviewer ?? '',
            firstApprover: a.firstApprover ?? '',
            secondApprover: a.secondApprover ?? '',
            finalApprover: a.finalApprover ?? '',
            fourthApprover: a.fourthApprover ?? '',
            fifthApprover: a.fifthApprover ?? '',
          }))
        })
        .catch(() => {
          /* keep empty hierarchy until mapping exists */
        })
    },
    [form.businessUnit, form.requesterGroup, setForm]
  )

  // REQUESTER: auto-select single self row
  React.useEffect(() => {
    if (!lockRequesterStep || !user) return
    if (salesRepsForDropdown.length !== 1) return
    const only = salesRepsForDropdown[0]
    if (form.requesterId === only.id) return
    applySalesRepSelection(only)
  }, [lockRequesterStep, user, salesRepsForDropdown, form.requesterId, applySalesRepSelection])

  /**
   * Put the requester back on a copied draft.
   *
   * A stored request holds the requester's *name*; the dropdown and the approval chain are keyed on
   * the directory row's id, which no form carries. Once the team's members load, match the name back
   * so step 1 is complete and the chain can be fetched — without this a copied request could not be
   * taken past step 1, whose Next needs `requesterId`.
   *
   * One shot, so a later change of requester is the person's own and stays.
   */
  const copiedRequesterResolvedRef = React.useRef(false)
  React.useEffect(() => {
    if (reviewing || !form.backendDraftId) return
    if (copiedRequesterResolvedRef.current) return
    if (form.requesterId || !form.requesterName) return
    if (fetchedSalesReps.length === 0) return
    // Identity rows are stored upper case; the stored name may not be.
    const wanted = form.requesterName.trim().toLocaleUpperCase()
    const match = fetchedSalesReps.find(
      (rep) => (rep.name || '').trim().toLocaleUpperCase() === wanted
    )
    if (!match) return
    copiedRequesterResolvedRef.current = true
    applySalesRepSelection(match)
  }, [
    form.backendDraftId,
    form.requesterId,
    form.requesterName,
    fetchedSalesReps,
    applySalesRepSelection,
  ])

  // The review's own requester resolution: the loaded request holds a name, the picker wants the
  // directory row id. Matched once the team's members arrive, on the original too.
  React.useEffect(() => {
    if (!review || fetchedSalesReps.length === 0) return
    review.resolveRequester(fetchedSalesReps)
  }, [review, fetchedSalesReps])

  const loadChannelPartnersInitial = React.useCallback(async () => {
    if (!catalogBusinessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getChannelPartners('1', catalogBusinessUnit, { limit: 50 })
      return {
        options: response.partners.map((c) => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
          sub: `${c.address} — ${c.phone || ''}`,
        })),
        total: response.total,
        hasMore: response.hasMore,
      }
    } catch {
      return { options: [] }
    }
  }, [catalogBusinessUnit])

  const loadChannelPartnersSearch = React.useCallback(
    async (search: string) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getChannelPartners('1', catalogBusinessUnit, {
          limit: 20,
          search,
        })
        return {
          options: response.partners.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.name}`,
            sub: `${c.address} — ${c.phone || ''}`,
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch {
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const loadChannelPartnersMore = React.useCallback(
    async (offset: number) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getChannelPartners('1', catalogBusinessUnit, {
          limit: 50,
          offset,
        })
        return {
          options: response.partners.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.name}`,
            sub: `${c.address} — ${c.phone || ''}`,
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch {
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const loadEndUsersInitial = React.useCallback(async () => {
    if (!catalogBusinessUnit) return { options: [] }
    try {
      // End users are first-digit 8 (Sold-To is 1)
      const response = await staticDataApi.getEndUsers('8', catalogBusinessUnit, { limit: 50 })
      return {
        options: response.endUsers.map((c) => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
          sub: `${c.address} — ${c.phone || ''}`,
        })),
        total: response.total,
        hasMore: response.hasMore,
      }
    } catch {
      return { options: [] }
    }
  }, [catalogBusinessUnit])

  const loadEndUsersSearch = React.useCallback(
    async (search: string) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getEndUsers('8', catalogBusinessUnit, {
          limit: 20,
          search,
        })
        return {
          options: response.endUsers.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.name}`,
            sub: `${c.address} — ${c.phone || ''}`,
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch {
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const loadEndUsersMore = React.useCallback(
    async (offset: number) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getEndUsers('8', catalogBusinessUnit, {
          limit: 50,
          offset,
        })
        return {
          options: response.endUsers.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.name}`,
            sub: `${c.address} — ${c.phone || ''}`,
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch {
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const [productCatalog, setProductCatalog] = React.useState<Product[]>([])

  /*
   * Lines whose product a requester can no longer select. A clone or a saved draft keeps its lines as
   * they were, so a product the master has since removed would otherwise be submitted again. Checked
   * once per code with the exact lookup. Not in the service review: the reviewer corrects a return
   * submitted when its products were still listed.
   */
  const [unavailableCodes, setUnavailableCodes] = React.useState<Record<string, true>>({})
  const checkedProductCodesRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const bu = catalogBusinessUnit
    if (!bu || review) return
    const pending = [...new Set((form.products ?? []).map((p) => String(p.productCode ?? '').trim()).filter(Boolean))]
      .filter((code) => !checkedProductCodesRef.current.has(`${bu}|${code}`))
      .filter((code) => !productCatalog.some((pr) => String(pr.code) === code))
    if (pending.length === 0) return
    let cancelled = false
    void (async () => {
      const verdicts: Array<[string, boolean]> = []
      await Promise.all(
        pending.map(async (code) => {
          try {
            const prod = await staticDataApi.getProductExact(bu, code)
            verdicts.push([code, !prod || String(prod.code) !== code])
          } catch {
            /* a failed lookup proves nothing: left unchecked, so it is tried again */
          }
        })
      )
      if (cancelled) return
      for (const [code] of verdicts) checkedProductCodesRef.current.add(`${bu}|${code}`)
      const gone = verdicts.filter(([, unavailable]) => unavailable)
      if (gone.length > 0) {
        setUnavailableCodes((prev) => ({ ...prev, ...Object.fromEntries(gone.map(([code]) => [`${bu}|${code}`, true as const])) }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [catalogBusinessUnit, form.products, productCatalog, review])
  const isUnavailableLine = (code: string | undefined) =>
    !review && !!unavailableCodes[`${catalogBusinessUnit}|${String(code ?? '').trim()}`]

  const loadProductsInitial = React.useCallback(async () => {
    if (!catalogBusinessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getProductCatalog(catalogBusinessUnit, { limit: 50 })
      return {
        options: response.products.map((prod) => ({
          value: String(prod.code),
          label: prod.productNameLocal || prod.name,
          sub: productPickerSub(prod, catalogBusinessUnit),
        })),
        total: response.total,
        hasMore: response.hasMore,
      }
    } catch (error) {
      console.error('Failed to load products:', error)
      return { options: [] }
    }
  }, [catalogBusinessUnit])

  const loadProductsSearch = React.useCallback(
    async (search: string) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getProductCatalog(catalogBusinessUnit, {
          limit: 20,
          search,
        })
        return {
          options: response.products.map((prod) => ({
            value: String(prod.code),
            label: prod.productNameLocal || prod.name,
            sub: productPickerSub(prod, catalogBusinessUnit),
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch (error) {
        console.error('Failed to search products:', error)
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const loadProductsMore = React.useCallback(
    async (offset: number) => {
      if (!catalogBusinessUnit) return { options: [] }
      try {
        const response = await staticDataApi.getProductCatalog(catalogBusinessUnit, {
          limit: 50,
          offset,
        })
        return {
          options: response.products.map((prod) => ({
            value: String(prod.code),
            label: prod.productNameLocal || prod.name,
            sub: productPickerSub(prod, catalogBusinessUnit),
          })),
          total: response.total,
          hasMore: response.hasMore,
        }
      } catch (error) {
        console.error('Failed to load more products:', error)
        return { options: [] }
      }
    },
    [catalogBusinessUnit]
  )

  const productAsyncOptions = React.useMemo(
    () => ({
      initialLoad: loadProductsInitial,
      load: loadProductsSearch,
      loadMore: loadProductsMore,
    }),
    [loadProductsInitial, loadProductsSearch, loadProductsMore]
  )

  const products = form.products ?? []
  const amountRules = React.useMemo(
    () => getReturnAmountRules(form.returnType),
    [form.returnType]
  )
  const returnTotal = React.useMemo(
    () => products.reduce((s, p) => s + Math.max(0, p.returnAmount ?? 0), 0),
    [products]
  )
  const rebillTotal = React.useMemo(
    () => products.reduce((s, p) => s + Math.max(0, p.rebillAmount ?? 0), 0),
    [products]
  )
  const hasUnavailableLine = products.some((p) => isUnavailableLine(p.productCode))
  const productsValid =
    products.length > 0 &&
    !hasUnavailableLine &&
    products.every(
      (p) =>
        Boolean(p.productCode?.trim()) &&
        p.quantity > 0 &&
        (p.returnAmount ?? 0) >= 0 &&
        (amountRules.rebillAmountEditable ? (p.rebillAmount ?? 0) >= 0 : true)
    )

  // At least one approval. A matrix row carrying only a reviewer is not a route, and blocked
  // Next before the review step ever appeared in this preview. Under review the stored route
  // stands until the requester, unit or service flag changes; then the rebuilt one is judged.
  const hierarchyValid = review
    ? review.timeline.some((row) => row.num > 0 && !row.isReviewer)
    : buildHierarchyRows(form).some((row) => !row.isReviewer)

  const canNextStep1 = Boolean(
    form.returnType &&
      form.requestDate &&
      form.businessUnit &&
      form.requesterGroup &&
      form.requesterId &&
      hierarchyValid
  )

  const updateProduct = (
    index: number,
    patch: Partial<(typeof products)[number]>,
    options?: { resetAmountOverrides?: boolean }
  ) => {
    setForm((f) => {
      const copy = [...(f.products ?? [])]
      copy[index] = nextProductLine(copy[index], patch, f.returnType, options)
      return { ...f, products: copy, status: 'DRAFT' }
    })
  }

  const removeProductRow = (index: number) => {
    setForm((f) => ({
      ...f,
      products: (f.products ?? []).filter((_, i) => i !== index),
      status: 'DRAFT',
    }))
  }

  const onChangeProduct = async (index: number, code: string) => {
    let prod: Product | undefined = productCatalog.find((p) => String(p.code) === String(code))
    if (!prod && catalogBusinessUnit && code) {
      try {
        // Exact lookup, never paged: a short code can have more than 100 substring hits.
        prod = (await staticDataApi.getProductExact(catalogBusinessUnit, String(code))) ?? undefined
        if (prod) {
          setProductCatalog((prev) => {
            if (prev.some((p) => String(p.code) === String(prod!.code))) return prev
            return [...prev, prod!]
          })
        }
      } catch {
        /* ignore */
      }
    }
    updateProduct(
      index,
      {
        productCode: code,
        sapCode: prod?.sapCode ?? '',
        productName: prod?.name || prod?.productNameLocal || '',
        unitPrice: prod?.price ?? 0,
        wholesalePrice: prod?.price ?? 0,
        returnAmountOverridden: false,
        rebillAmountOverridden: false,
      },
      { resetAmountOverrides: true }
    )
  }

  /*
   * Order no. and invoice date may be left blank only where somebody completes them later: the
   * service review, which only a Service = Yes return goes through - and the reviewer, who is that
   * somebody. A Service = No return goes straight to its approvers and on to Customer Service, so it
   * carries both from the start; one reached the desk with its order number blank (Damian Diggin,
   * 30 Sep 2026).
   */
  const orderDetailsRequired = !review && !form.isService
  const orderNumberErrorKey = orderDetailsRequired
    ? getReturnOrderNumberError(form.originalOrderNumber)
    : getOptionalReturnOrderNumberError(form.originalOrderNumber)
  // A malformed number is wrong as it is typed; an empty required one only once visited.
  const orderNumberInvalid =
    Boolean(orderNumberErrorKey) && (orderNumberErrorKey !== 'required' || orderNumberTouched)
  const invoiceDateMissing = orderDetailsRequired && !String(form.invoiceDate ?? '').trim()
  // The original order was invoiced already: today at the latest, in Japan (todayInJapan).
  const invoiceToday = todayInJapan()
  const invoiceDateFuture = isFutureInvoiceDate(form.invoiceDate, invoiceToday)
  const extraInvoiceDateFuture = form.additionalInvoiceDates.some((d) => isFutureInvoiceDate(d, invoiceToday))

  const canValidateStep2 = Boolean(
    form.soldToCode &&
      isValidReturnContactName(form.dairitenContactName) &&
      isValidOptionalReturnContactEmail(form.dairitenContactEmail) &&
      // Blank only where the service review completes them - see orderDetailsRequired.
      !orderNumberErrorKey &&
      !invoiceDateMissing &&
      !invoiceDateFuture &&
      !extraInvoiceDateFuture &&
      productsValid &&
      form.orderReason &&
      form.justification.trim()
  )

  const nextMissingField = (): string | null => {
    if (step === 1) {
      if (!form.returnType) return 'returnType'
      if (!form.requestDate) return 'requestDate'
      if (!form.businessUnit) return 'businessUnit'
      if (!form.requesterGroup) return 'requesterGroup'
      if (!form.requesterId) return 'requester'
      if (!hierarchyValid) return 'hierarchy'
      return null
    }
    if (!form.soldToCode) return 'soldTo'
    if (!isValidReturnContactName(form.dairitenContactName)) return 'dairitenContact'
    if (!isValidOptionalReturnContactEmail(form.dairitenContactEmail)) return 'dairitenEmail'
    if (orderNumberErrorKey) return 'orderNumber'
    if (invoiceDateMissing || invoiceDateFuture || extraInvoiceDateFuture) return 'invoiceDate'
    if (!productsValid) return 'products'
    if (!form.orderReason) return 'orderReason'
    if (!form.justification.trim()) return 'justification'
    return null
  }

  const nextFieldId = nextMissingField()

  const fieldWrapClass = (fieldId: string) => {
    const isNext = nextFieldId === fieldId
    const isMissing = highlightMissing && isNext
    if (isMissing) return 'transition-all duration-300 rounded-lg ring-2 ring-amber-400 ring-offset-1'
    // Green here put a Sample-coloured panel in the middle of a purple review.
    if (isNext) return ui.nextField
    return ''
  }

  const canNext = step === 1 ? canNextStep1 : step === 2 ? canValidateStep2 : true

  React.useEffect(() => {
    if (canNext) setHighlightMissing(false)
  }, [canNext])

  const handleNext = () => {
    // A review never submits from here; its footer has its own actions on step 3.
    if (review && step === 3) return
    if (step === 1) {
      if (!canNextStep1) {
        setHighlightMissing(true)
        return
      }
      setStep(2)
      setValidatedBanner(false)
      return
    }
    if (step === 2) {
      setOrderNumberTouched(true)
      setContactNameTouched(true)
      setContactEmailTouched(true)
      if (!canValidateStep2) {
        setHighlightMissing(true)
        return
      }
      setStep(3)
      setValidatedBanner(false)
      return
    }
    void onSubmit()
  }

  /**
   * Create the request, then submit it — the same two calls the sample wizard makes
   * (Wizard.onSubmit), against the same endpoints. `POST /forms` stores the draft, and
   * `POST /forms/:id/submit` is what assigns the reference number, builds the approval chain from
   * return_approval_mapping and emails the first approver.
   *
   * The return flow has no server-side draft to update, so it always creates; there is no
   * `backendDraftId` branch to mirror.
   */
  async function onSubmit() {
    if (!canValidateStep2) {
      setStep(2)
      setHighlightMissing(true)
      return
    }
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const payload = {
        formType: 'RETURN',
        // purpose carries the form-type code for every other flow too, and several readers show it
        // directly; keep that contract rather than putting the return type here.
        purpose: 'RETURN',
        requestDate: form.requestDate,
        businessUnit: form.businessUnit,
        requesterGroup: form.requesterGroup,
        requesterName: form.requesterName,
        // Same guard as the sample wizard: a picked requester without a displayable SAP code sends
        // blank rather than a placeholder, because the code goes into the reference number.
        salesRepCodeSap: form.requesterId
          ? hasDisplayableSalesRepCode(form.salesRepCodeSap)
            ? String(form.salesRepCodeSap).trim()
            : ''
          : form.salesRepCodeSap,
        soldToCode: form.soldToCode,
        soldToName: form.soldToName,
        endUserCode: form.endUserCode,
        endUserName: form.endUserName,
        returnType: form.returnType,
        isService: form.isService,
        originalOrderNumber: form.originalOrderNumber,
        invoiceDate: form.invoiceDate,
        isStandingOrder: form.isStandingOrder,
        // The full ordered list: the primary date first, then any standing-order additions.
        // Blank rows are dropped so an unfinished repeater row cannot be submitted.
        invoiceDates: [form.invoiceDate, ...form.additionalInvoiceDates]
          .map((d) => String(d ?? '').trim())
          .filter(Boolean),
        quoteRefNo: form.quoteRefNo,
        orderReason: form.orderReason,
        justification: form.justification.trim(),
        dairitenContactName: form.dairitenContactName,
        dairitenContactEmail: form.dairitenContactEmail?.trim() || undefined,
        products: (form.products ?? []).map((p) => ({
          productCode: p.productCode,
          productName: p.productName,
          sapCode: p.sapCode,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          wholesalePrice: p.wholesalePrice,
          lotNumber: p.lotNumber?.trim() || undefined,
          note: p.note,
          returnAmount: p.returnAmount ?? 0,
          rebillAmount: p.rebillAmount ?? 0,
        })),
      }

      // A copied draft is already a row: update that one and submit it. Posting again would
      // create a second request and leave the copy behind as an orphan draft.
      let createdId = form.backendDraftId ?? ''
      if (createdId) {
        await apiClient.put(`/forms/${createdId}`, payload)
      } else {
        const createResponse = await apiClient.post('/forms', payload)
        createdId = createResponse.data?.form?.id ?? ''
      }
      if (!createdId) throw new Error('Create returned no form id')

      const submitResponse = await apiClient.post(
        `/forms/${createdId}/submit`,
        {},
        { timeout: 30000 }
      )
      const referenceNumber = submitResponse.data?.form?.referenceNumber

      // Clear before navigating: the success page reads the form from context, which is still in
      // memory, while the stored draft must not survive into the next /return/new.
      clearDraft(RETURN_DRAFT_PREFIX)
      navigate('/return/success', {
        state: {
          referenceNumber,
          formType: 'RETURN',
          requester: form.requesterName,
        },
      })
    } catch (error) {
      console.error('Failed to submit return request:', error)
      setSubmitError(t('return.form.submitError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const returnTypeLabel =
    RETURN_TYPE_OPTIONS.find((o) => o.value === form.returnType)?.label || form.returnType || '—'
  const orderReasonLabel =
    RETURN_ORDER_REASON_OPTIONS.find((o) => o.value === form.orderReason)?.label ||
    form.orderReason ||
    '—'

  const hierarchyRows = buildHierarchyRows(form)
  const timelineApprovers: { num: number; role: string; name: string; isReviewer?: boolean }[] = []
  /*
   * Nobody but the service review team corrects a request. The server says so too - the save, the
   * send and the send-back all check it - but without this the wrong person got the whole review
   * screen and found out only when a button failed. Reinstated: the standalone review page had
   * this guard and the move into the wizard left it behind.
   */
  if (reviewing && !userLoading && !hasServiceAdminPrivileges(user)) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow p-6">
          <h1 className="text-xl font-bold text-gray-800">{t('return.review.title')}</h1>
          <p className="mt-2 text-gray-600">{t('return.review.notReviewer')}</p>
        </div>
      </div>
    )
  }

  if (review) {
    // The route as it stands, or as it will be rebuilt from the corrected fields — see the hook.
    timelineApprovers.push(...review.timeline)
  } else {
    // Step 0 is always present and reads "Not selected" until a requester is picked, matching the
    // sample wizard (buildApprovalHierarchy in Wizard.tsx). Both flows then look the same from the
    // start. formatRequesterWithSalesRepCode supplies the "Not selected" text.
    timelineApprovers.push({
      num: 0,
      role: 'Sales Rep / Requester',
      name: formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap),
    })
    hierarchyRows.forEach((row, idx) => {
      timelineApprovers.push({ num: idx + 1, role: row.role, name: row.name, isReviewer: row.isReviewer })
    })
  }

  /**
   * "was: …" with an Undo under a field the reviewer has changed. Nothing in create mode.
   *
   * One call beside each field is the convention: the field is the same JSX in both modes, and this
   * is how it says what it used to hold.
   */
  const reviewWas = (field: ReturnSummaryField) => {
    if (!review) return null
    const was = review.previous[field]
    if (was === undefined) return null
    const canUndo = review.canUndoField(field)
    return (
      <div className="text-xs text-[#9333EA] mt-1">
        {t('return.review.was')} {was || '—'}
        {canUndo && (
          <button
            type="button"
            onClick={() => review.undoField(field)}
            className="ml-2 underline font-semibold hover:opacity-80"
          >
            {t('return.review.undo')}
          </button>
        )}
      </div>
    )
  }
  /** The review-only "Required." under a field the requester was allowed to leave blank. */
  const reviewRequired = (field: ReturnSummaryField) =>
    review && review.errors[field] && !review.formatErrors[field] ? (
      <div className="text-xs text-red-600 mt-1">{review.errors[field]}</div>
    ) : null

  const orderNumberErrorMessage = (() => {
    if (!orderNumberTouched && !highlightMissing) return null
    if (!orderNumberErrorKey) return null
    if (orderNumberErrorKey === 'required') return t('return.form.error.orderRequired')
    if (orderNumberErrorKey === 'prefix') return t('return.form.error.orderPrefix')
    if (orderNumberErrorKey === 'length') return t('return.form.error.orderLength')
    return t('return.form.error.orderDigits')
  })()

  const contactNameErrorKey = getReturnContactNameError(form.dairitenContactName)
  const contactEmailErrorKey = getOptionalReturnContactEmailError(form.dairitenContactEmail)
  const showContactNameError = (contactNameTouched || highlightMissing) && !!contactNameErrorKey
  const showContactEmailError = (contactEmailTouched || highlightMissing) && !!contactEmailErrorKey
  const contactNameErrorMessage =
    contactNameErrorKey === 'required'
      ? t('return.form.error.nameRequired')
      : contactNameErrorKey === 'invalid'
        ? t('return.form.error.nameInvalid')
        : null
  // The field is optional now, so blank is not an error — only a malformed address is.
  const contactEmailErrorMessage =
    contactEmailErrorKey === 'invalid' ? t('return.form.error.email') : null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Submitting overlay — same shape as the sample wizard's, so the two flows feel identical at
          the one moment a user is most likely to click twice. */}
      {isSubmitting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md mx-4 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#00A651] mx-auto mb-4"></div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('return.form.submitting')}</h3>
            <p className="text-gray-600 mb-1">{t('return.form.submittingHint')}</p>
            <p className="text-sm text-gray-500">{t('return.form.submittingWait')}</p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl shadow-lg p-8 animate-scaleIn">
          {review ? (
            <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold text-gray-800">{t('return.review.title')}</h1>
                <p className="mt-1 text-gray-600">{t('return.review.editIntro')}</p>
                {review.stored && (
                  <p className="mt-2 text-sm text-gray-500">
                    {review.stored.referenceNumber} · {String(review.stored.requesterName ?? '')} ·{' '}
                    {String(review.stored.businessUnit ?? '')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={review.leave}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 shrink-0"
              >
                {t('return.review.backToQueue')}
              </button>
            </div>
          ) : (
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-800">{t('return.new.title')}</h1>
              {form.reopenedReference && (
                /* Correcting a reopened request, not raising a new one: say which, and why it came back. */
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-1.5" role="status">
                  <p className="text-sm font-semibold text-amber-950" lang="ja">
                    差し戻された申請 {form.reopenedReference} を修正しています。送信すると同じ参照番号で再申請されます。
                  </p>
                  <p className="text-xs text-amber-900">
                    Correcting {form.reopenedReference}. Submitting sends this same request for approval again.
                  </p>
                  {form.reopenedRejection && (
                    <p className="text-xs text-red-800">
                      <span className="font-semibold">
                        <span lang="ja">差し戻し理由</span> / Rejected by {form.reopenedRejection.by} ({form.reopenedRejection.role})
                      </span>
                      {form.reopenedRejection.reason ? `: ${form.reopenedRejection.reason}` : ''}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <Link to="/return" className={`font-medium ${ui.link} hover:underline`}>
                  {t('return.back')}
                </Link>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => {
                    resetForm()
                    setStep(1)
                    setValidatedBanner(false)
                    setHighlightMissing(false)
                    setOrderNumberTouched(false)
                    setContactNameTouched(false)
                    setContactEmailTouched(false)
                  }}
                  className="text-gray-600 hover:text-gray-900 underline"
                >
                  {t('return.form.reset')}
                </button>
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="w-full h-3 bg-gray-200 rounded-full mb-6 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-300 ease-in-out"
              style={{ backgroundColor: ui.hex, width: `${(step / 3) * 100}%` }}
            />
          </div>

          {/* Step Indicators */}
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center flex-1">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                  step >= 1
                    ? ui.stepOn
                    : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                {step > 1 ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="font-semibold">1</span>
                )}
              </div>
              <div className="ml-3 flex-1">
                <div className={`text-sm font-medium ${step >= 1 ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t('return.form.step1')}
                </div>
              </div>
              <div className="flex-1 h-0.5 bg-gray-300 mx-4" />
            </div>

            <div className="flex items-center flex-1">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                  step >= 2
                    ? ui.stepOn
                    : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                {step > 2 ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="font-semibold">2</span>
                )}
              </div>
              <div className="ml-3 flex-1">
                <div className={`text-sm font-medium ${step >= 2 ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t('return.form.step2')}
                </div>
              </div>
              <div className="flex-1 h-0.5 bg-gray-300 mx-4" />
            </div>

            <div className="flex items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                  step >= 3
                    ? ui.stepOn
                    : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                <span className="font-semibold">3</span>
              </div>
              <div className="ml-3">
                <div className={`text-sm font-medium ${step >= 3 ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t('return.form.step3')}
                </div>
              </div>
            </div>
          </div>

          {review?.isLoading && (
            <div className="py-16 text-center text-gray-500">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#9333EA]" />
            </div>
          )}
          {review?.loadError && (
            <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm font-medium">
              {review.loadError}
            </div>
          )}
          {review?.actionError && (
            <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm font-medium">
              {review.actionError}
            </div>
          )}
          {review?.savedNotice && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-sm font-medium">
              {t('return.review.saved')}
            </div>
          )}

          {validatedBanner && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-sm font-medium">
              {t('return.form.validated')}
            </div>
          )}

          {/* A failed submit has to say so on the page. The form is still filled in and the draft is
              still stored, so the requester can simply press Submit again. */}
          {submitError && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm font-medium"
            >
              {submitError}
            </div>
          )}

          {step === 1 && !review?.isLoading && (
            <section className="space-y-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div data-return-field="returnType" className={fieldWrapClass('returnType')}>
                  <label className="block text-sm mb-1">{t('return.form.returnType')}<RequiredMark /></label>
                  <SearchSelect
                    options={RETURN_TYPE_OPTIONS}
                    value={form.returnType || null}
                    onChange={(val) =>
                      setForm((f) => {
                        const cleared = resetReturnDownstream(f, 'returnType')
                        return { ...cleared, returnType: (val || '') as ReturnTypeCode | '' }
                      })
                    }
                    placeholder={t('return.form.returnTypePlaceholder')}
                  />
                  {reviewWas('returnType')}
                </div>
                <div data-return-field="requestDate" className={fieldWrapClass('requestDate')}>
                  <label className="block text-sm mb-1">{t('return.form.requestDate')}<RequiredMark /></label>
                  <input
                    type="date"
                    className="border rounded px-3 py-2 w-full"
                    value={form.requestDate}
                    onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))}
                  />
                  {reviewWas('requestDate')}
                </div>
                <div data-return-field="businessUnit" className={fieldWrapClass('businessUnit')}>
                  <label className="block text-sm mb-1">{t('return.form.businessUnit')}<RequiredMark /></label>
                  <SearchSelect
                    options={[
                      { value: 'CDG', label: 'CDG' },
                      { value: 'LSG', label: 'LSG' },
                    ]}
                    value={form.businessUnit || null}
                    onChange={(val) =>
                      setForm((f) => {
                        const cleared = resetReturnDownstream(f, 'businessUnit')
                        return {
                          ...cleared,
                          businessUnit: (val || '') as ReturnBusinessUnit | '',
                        }
                      })
                    }
                    placeholder={t('return.form.businessUnitPlaceholder')}
                  />
                  {reviewWas('businessUnit')}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div data-return-field="isService">
                  <label className="block text-sm mb-1">{t('return.form.serviceRequest')}</label>
                  <SearchSelect
                    options={[
                      { value: 'no', label: t('return.form.serviceNo') },
                      { value: 'yes', label: t('return.form.serviceYes') },
                    ]}
                    value={form.isService ? 'yes' : 'no'}
                    onChange={(val) =>
                      setForm((f) => {
                        const nextIsService = val === 'yes'
                        if (nextIsService === f.isService) return f
                        const cleared = resetReturnDownstream(f, 'isService')
                        return { ...cleared, isService: nextIsService }
                      })
                    }
                    placeholder={t('return.form.serviceNo')}
                  />
                  {reviewWas('isService')}
                </div>
                <div data-return-field="requesterGroup" className={fieldWrapClass('requesterGroup')}>
                  <label className="block text-sm mb-1">{t('return.form.requesterGroup')}<RequiredMark /></label>
                  <SearchSelect
                    options={requesterGroupsForDropdown.map((g) => ({
                      value: g.id,
                      label: g.name,
                    }))}
                    value={form.requesterGroup || null}
                    onChange={(val) =>
                      setForm((f) => {
                        const cleared = resetReturnDownstream(f, 'requesterGroup')
                        return { ...cleared, requesterGroup: (val as string) || '' }
                      })
                    }
                    placeholder={
                      loadingRequesterGroups
                        ? t('return.form.loadingGroups')
                        : requesterGroupsError
                          ? requesterGroupsError
                          : form.businessUnit
                            ? t('return.form.requesterGroupPlaceholder')
                            : t('return.form.selectBuFirst')
                    }
                    /**
                     * Never disabled just because the requester has one team here.
                     *
                     * Nia Hargreaves reported on 3 Sep that the team was selectable with Service = No
                     * but greyed out with Service = Yes. Exactly right: Service = Yes adds the
                     * SERVICE teams filtered to the chosen unit, which narrowed her two planner
                     * teams to one match — and one option meant "locked". Service = No offered
                     * neither of her teams, fell back to the full list, and stayed open.
                     *
                     * The scope now *pre-fills* the person's team instead of forbidding the others,
                     * so the two settings behave the same and a planner can raise a return for the
                     * team it belongs to. Who may be submitted *as* is still governed by the
                     * requester field below.
                     */
                    disabled={
                      loadingRequesterGroups || !!requesterGroupsError || !form.businessUnit
                    }
                  />
                </div>
                <div data-return-field="requester" className={fieldWrapClass('requester')}>
                  <label className="block text-sm mb-1">{t('return.form.requester')}<RequiredMark /></label>
                  <SearchSelect
                    options={salesRepsForDropdown.map((rep) => ({
                      value: rep.id,
                      label: formatSalesRepOptionLabel(rep.name, rep.code),
                    }))}
                    value={form.requesterId || null}
                    onChange={(val) => {
                      const id = val as string
                      const rep = fetchedSalesReps.find((r) => r.id === id)
                      if (rep) applySalesRepSelection(rep)
                    }}
                    placeholder={
                      loadingSalesReps
                        ? t('return.form.loadingReps')
                        : salesRepsError
                          ? salesRepsError
                          : form.requesterGroup
                            ? t('return.form.requesterPlaceholder')
                            : t('return.form.selectGroupFirst')
                    }
                    disabled={
                      loadingSalesReps ||
                      !!salesRepsError ||
                      !form.requesterGroup ||
                      (lockRequesterStep && salesRepsForDropdown.length <= 1)
                    }
                    // The name stands in until the directory id resolves — a stored request holds
                    // the name only. See the same fallback on the summary's requester tile.
                    fallbackLabel={form.requesterName || undefined}
                  />
                  {reviewWas('requester')}
                </div>
              </div>

              <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">{t('return.form.hierarchy')}<RequiredMark /></h3>
                </div>
                <div className="bg-white border-2 border-gray-200 rounded-xl p-5 shadow-sm">
                  <div className="space-y-3 relative">
                    <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gray-200" />
                    {/* The review step is shown so a requester is not surprised by their request
                        being changed on the way through. It reads as any other step; only its
                        number is purple, marking it as a check rather than an approval. */}
                    {timelineApprovers.map((approver) => (
                      <div key={`${approver.role}-${approver.num}`} className="relative pl-8">
                        <div
                          className={
                            approver.isReviewer
                              ? 'absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#9333EA] border-2 border-white shadow-sm z-10 flex items-center justify-center'
                              : 'absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#00A651] border-2 border-white shadow-sm z-10 flex items-center justify-center'
                          }
                        >
                          <span className="text-[10px] text-white font-bold">{approver.num}</span>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 flex items-center justify-between hover:border-[#00A651] transition-all">
                          <div>
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                              {approver.isReviewer ? t('return.form.reviewerRole') : approver.role}
                            </div>
                            <div className="text-sm font-semibold text-gray-800">{approver.name}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {review?.timelinePrevious && (
                  <div className="mt-3 text-xs text-[#9333EA]">
                    {t('return.review.was')} {review.timelinePrevious}
                  </div>
                )}
                {review?.routeChanged && (
                  <p className="mt-2 text-xs text-gray-600">{t('return.review.routeRebuilt')}</p>
                )}
                {review?.routeMissing && (
                  <p className="mt-2 text-sm text-red-600">{t('return.form.hierarchyMissing')}</p>
                )}
                {/* A requester with no matrix row still has to be reported - the timeline alone
                    cannot say it, and this state blocks Next. */}
                {!review && hierarchyRows.length === 0 && form.requesterId && (
                  <p className="mt-3 text-sm text-gray-500">
                    {highlightMissing
                      ? t('return.form.error.hierarchyRequired')
                      : t('return.form.hierarchyMissing')}
                  </p>
                )}
              </div>
            </section>
          )}

          {step === 2 && !review?.isLoading && (
            <section className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">{t('return.form.step2')}</h3>
              </div>

              <div className="relative pl-8 border-l-2 border-gray-200 space-y-8">
                {/* 1 Sold-To */}
                <div data-return-field="soldTo" className={fieldWrapClass('soldTo')}>
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      1
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="font-semibold text-gray-800 mb-3">{t('return.form.soldTo')}<RequiredMark /></h4>
                      <SearchSelect
                        key={`sold-to-${catalogBusinessUnit || 'none'}`}
                        asyncOptions={{
                          initialLoad: loadChannelPartnersInitial,
                          load: loadChannelPartnersSearch,
                          loadMore: loadChannelPartnersMore,
                        }}
                        value={form.soldToCode || null}
                        onChange={(val) => {
                          const code = (val as string) || ''
                          setForm((f) => {
                            const cleared = resetReturnDownstream(f, 'soldTo')
                            return {
                              ...cleared,
                              soldToCode: code,
                              soldToName: code ? f.soldToName : '',
                            }
                          })
                          if (code && catalogBusinessUnit) {
                            staticDataApi
                              .getChannelPartners('1', catalogBusinessUnit, { search: code, limit: 5 })
                              .then((res) => {
                                const hit = res.partners.find((p) => p.code === code)
                                if (hit) {
                                  setForm((f) => ({
                                    ...f,
                                    soldToCode: hit.code,
                                    soldToName: hit.name,
                                  }))
                                }
                              })
                              .catch(() => {})
                          }
                        }}
                        placeholder={
                          catalogsReady
                            ? t('return.form.soldToPlaceholder')
                            : t('return.form.selectBuFirst')
                        }
                        disabled={!catalogsReady}
                        fallbackLabel={
                          form.soldToCode
                            ? `${form.soldToCode}${form.soldToName ? ` — ${form.soldToName}` : ''}`
                            : undefined
                        }
                        labelClassName="text-base font-bold text-gray-900"
                      />
                      {reviewWas('soldTo')}
                    </div>
                  </div>
                </div>

                {/* 2 End User */}
                <div data-return-field="endUser" className={fieldWrapClass('endUser')}>
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      2
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="font-semibold text-gray-800 mb-3">{t('return.form.endUser')}</h4>
                      <SearchSelect
                        key={`end-user-${catalogBusinessUnit || 'none'}`}
                        asyncOptions={{
                          initialLoad: loadEndUsersInitial,
                          load: loadEndUsersSearch,
                          loadMore: loadEndUsersMore,
                        }}
                        value={form.endUserCode || null}
                        onChange={(val) => {
                          const code = (val as string) || ''
                          setForm((f) => ({
                            ...f,
                            endUserCode: code,
                            endUserName: code ? f.endUserName : '',
                            status: 'DRAFT',
                          }))
                          if (code && catalogBusinessUnit) {
                            staticDataApi
                              .getEndUsers('8', catalogBusinessUnit, { search: code, limit: 5 })
                              .then((res) => {
                                const hit = res.endUsers.find((p) => p.code === code)
                                if (hit) {
                                  setForm((f) => ({
                                    ...f,
                                    endUserCode: hit.code,
                                    endUserName: hit.name,
                                  }))
                                }
                              })
                              .catch(() => {})
                          }
                        }}
                        placeholder={
                          catalogsReady
                            ? t('return.form.endUserPlaceholder')
                            : t('return.form.selectBuFirst')
                        }
                        disabled={!catalogsReady}
                        fallbackLabel={
                          form.endUserCode
                            ? `${form.endUserCode}${form.endUserName ? ` — ${form.endUserName}` : ''}`
                            : undefined
                        }
                        labelClassName="text-base font-bold text-gray-900"
                      />
                      {reviewWas('endUser')}
                    </div>
                  </div>
                </div>

                {/* 3 Dairiten contact */}
                <div
                  data-return-field="dairitenContact"
                  className={fieldWrapClass(
                    nextFieldId === 'dairitenEmail' ? 'dairitenEmail' : 'dairitenContact'
                  )}
                >
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-teal-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      3
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3">
                          {t('return.form.dairitenContact')}
                          <RequiredMark />
                        </h4>
                        <input
                          type="text"
                          className={`border rounded px-3 py-2 w-full ${
                            showContactNameError ? 'border-red-400' : 'border-gray-300'
                          }`}
                          value={form.dairitenContactName}
                          onChange={(e) => {
                            setContactNameTouched(true)
                            setForm((f) => ({
                              ...f,
                              dairitenContactName: e.target.value,
                              status: 'DRAFT',
                            }))
                          }}
                          onBlur={() => setContactNameTouched(true)}
                          placeholder={t('return.form.dairitenContactPlaceholder')}
                          aria-invalid={showContactNameError}
                        />
                        {showContactNameError && contactNameErrorMessage && (
                          <p className="mt-1 text-xs text-red-600">{contactNameErrorMessage}</p>
                        )}
                        {reviewWas('dairitenContactName')}
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3">
                          {t('return.form.dairitenEmailOptional')}
                        </h4>
                        <input
                          type="email"
                          className={`border rounded px-3 py-2 w-full ${
                            showContactEmailError ? 'border-red-400' : 'border-gray-300'
                          }`}
                          value={form.dairitenContactEmail}
                          onChange={(e) => {
                            setContactEmailTouched(true)
                            setForm((f) => ({
                              ...f,
                              dairitenContactEmail: e.target.value,
                              status: 'DRAFT',
                            }))
                          }}
                          onBlur={() => setContactEmailTouched(true)}
                          placeholder={t('return.form.dairitenEmailPlaceholder')}
                          aria-invalid={showContactEmailError}
                        />
                        {showContactEmailError && contactEmailErrorMessage && (
                          <p className="mt-1 text-xs text-red-600">{contactEmailErrorMessage}</p>
                        )}
                        {reviewWas('dairitenContactEmail')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4 Order details */}
                <div
                  data-return-field="orderNumber"
                  className={fieldWrapClass(
                    nextFieldId === 'invoiceDate' ? 'invoiceDate' : 'orderNumber'
                  )}
                >
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      4
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <div className="grid md:grid-cols-3 gap-4">
                        <div>
                          {/*
                            Required for a Service = No return, and before a review may pass a
                            service return on. Optional only for a service requester, whose review
                            completes it - no red asterisk there, since a required mark on a field
                            that may be left blank is a lie.
                          */}
                          <label className="block text-sm mb-1">
                            {t('return.form.orderNumber')}
                            {(review || orderDetailsRequired) && <RequiredMark />}
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={10}
                            className={`border rounded px-3 py-2 w-full ${
                              orderNumberInvalid ||
                              (highlightMissing && orderNumberErrorKey) ||
                              review?.errors.originalOrderNumber
                                ? 'border-red-400'
                                : 'border-gray-300'
                            }`}
                            value={form.originalOrderNumber}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                              setOrderNumberTouched(true)
                              setForm((f) => ({ ...f, originalOrderNumber: v, status: 'DRAFT' }))
                            }}
                            onBlur={() => setOrderNumberTouched(true)}
                            placeholder="1xxxxxxxxx"
                          />
                          {orderNumberErrorMessage && (
                            <p className="mt-1 text-xs text-red-600">{orderNumberErrorMessage}</p>
                          )}
                          {/* Optional for the requester; the review cannot pass it on empty. */}
                          {!orderNumberErrorMessage && reviewRequired('originalOrderNumber')}
                          {reviewWas('originalOrderNumber')}
                        </div>
                        <div data-return-field="invoiceDates">
                          <label className="block text-sm mb-1">
                            {t('return.form.invoiceDate')}
                            {(review || orderDetailsRequired) && <RequiredMark />}
                          </label>
                          <input
                            type="date"
                            max={invoiceToday}
                            className={`border rounded px-3 py-2 w-full ${
                              review?.errors.invoiceDate || (highlightMissing && invoiceDateMissing) || invoiceDateFuture
                                ? 'border-red-400'
                                : ''
                            }`}
                            value={form.invoiceDate}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                invoiceDate: e.target.value,
                                status: 'DRAFT',
                              }))
                            }
                          />
                          {/* Directly under the date it is about. A review shows these through its own errors. */}
                          {highlightMissing && invoiceDateMissing && (
                            <p className="mt-1 text-xs text-red-600">{t('return.form.error.invoiceDateRequired')}</p>
                          )}
                          {!review && invoiceDateFuture && (
                            <p className="mt-1 text-xs text-red-600">{t('return.form.error.invoiceDateFuture')}</p>
                          )}

                          {/*
                            定期予約 / Standing orders. A standing order is price-adjusted across
                            several billing periods, so it needs several invoice dates on ONE
                            request — Damian Diggin, 4 Sep 2026, after Miriama Boreland found that a
                            single date forced April and May to be submitted separately.
                          */}
                          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={form.isStandingOrder}
                              onChange={(e) => {
                                const on = e.target.checked
                                setForm((f) => ({
                                  ...f,
                                  isStandingOrder: on,
                                  // Unticking drops the extra dates rather than hiding them, so
                                  // what is submitted is always what the requester can see.
                                  additionalInvoiceDates: on ? f.additionalInvoiceDates : [],
                                  status: 'DRAFT',
                                }))
                              }}
                            />
                            <span>{t('return.form.standingOrder')}</span>
                          </label>

                          {form.isStandingOrder && (
                            <div className="mt-2 space-y-2">
                              {form.additionalInvoiceDates.map((d, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <input
                                    type="date"
                                    max={invoiceToday}
                                    className={`border rounded px-3 py-2 w-full ${
                                      isFutureInvoiceDate(d, invoiceToday) ? 'border-red-400' : ''
                                    }`}
                                    value={d}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setForm((f) => {
                                        const next = [...f.additionalInvoiceDates]
                                        next[i] = v
                                        return { ...f, additionalInvoiceDates: next, status: 'DRAFT' }
                                      })
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForm((f) => ({
                                        ...f,
                                        additionalInvoiceDates: f.additionalInvoiceDates.filter(
                                          (_, j) => j !== i
                                        ),
                                        status: 'DRAFT',
                                      }))
                                    }
                                    className="shrink-0 px-2 py-2 text-sm text-red-600 hover:bg-red-50 rounded"
                                    aria-label={t('return.form.removeInvoiceDate')}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({
                                    ...f,
                                    additionalInvoiceDates: [...f.additionalInvoiceDates, ''],
                                    status: 'DRAFT',
                                  }))
                                }
                                className={`text-sm font-medium ${review ? 'text-[#9333EA]' : 'text-[#0E7490]'} hover:underline`}
                              >
                                + {t('return.form.addInvoiceDate')}
                              </button>
                            </div>
                          )}
                          {/* A standing order's later dates: the same rule, said once under their list. */}
                          {!review && extraInvoiceDateFuture && (
                            <p className="mt-1 text-xs text-red-600">{t('return.form.error.invoiceDateFuture')}</p>
                          )}
                          {reviewRequired('invoiceDate')}
                          {reviewWas('invoiceDate')}
                        </div>
                        <div>
                          <label className="block text-sm mb-1">{t('return.form.quoteRef')}</label>
                          <input
                            type="text"
                            className="border rounded px-3 py-2 w-full"
                            value={form.quoteRefNo}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                quoteRefNo: e.target.value,
                                status: 'DRAFT',
                              }))
                            }
                            placeholder={t('return.form.quoteRefPlaceholder')}
                          />
                          {reviewWas('quoteRefNo')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5 Products */}
                <div data-return-field="products" className={fieldWrapClass('products')}>
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      5
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <svg
                            className={`w-6 h-6 ${ui.productsIcon}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                          </svg>
                          <h4 className="text-lg font-semibold text-gray-800">
                            {t('return.form.products')}
                            <RequiredMark />
                          </h4>
                        </div>
                        <button
                          type="button"
                          className={RETURN_PRODUCT_ADD_BUTTON_CLASS[ui.accent]}
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              status: 'DRAFT',
                              products: [
                                ...(f.products ?? []),
                                applyReturnAmountDefaults(
                                  {
                                    id: crypto.randomUUID(),
                                    productCode: '',
                                    sapCode: '',
                                    productName: '',
                                    quantity: 1,
                                    unitPrice: 0,
                                    wholesalePrice: 0,
                                    subTotal: 0,
                                    lotNumber: '',
                                    returnAmount: 0,
                                    rebillAmount: 0,
                                    returnAmountOverridden: false,
                                    rebillAmountOverridden: false,
                                  },
                                  f.returnType,
                                  { resetOverrides: true }
                                ),
                              ],
                            }))
                          }
                        >
                          {t('return.form.addProduct')}
                        </button>
                      </div>

                      {/*
                        The rows are shared with the service reviewer's screen (ReturnProductRows),
                        so what the reviewer corrects lines up exactly with what the requester filled
                        in. Index-based handlers, as before.
                      */}
                      {review?.productsPrevious !== undefined && (
                        <div className="text-xs text-[#9333EA] mb-2">
                          {t('return.review.was')} {review.productsPrevious}
                          {review.undoProducts && (
                            <button
                              type="button"
                              onClick={review.undoProducts}
                              className="ml-2 underline font-semibold hover:opacity-80"
                            >
                              {t('return.review.undo')}
                            </button>
                          )}
                          {/* A count and two totals do not say WHICH lines. This does. */}
                          <ReturnPreviousProductLines
                            lines={review.productsPreviousLines}
                            rebillAmountEditable={amountRules.rebillAmountEditable}
                            businessUnit={catalogBusinessUnit || form.businessUnit}
                          />
                        </div>
                      )}
                      <ReturnProductRows
                        products={products}
                        accent={ui.accent}
                        businessUnitLabel={catalogBusinessUnit || form.businessUnit || 'N/A'}
                        productAsyncOptions={productAsyncOptions}
                        catalogsReady={catalogsReady}
                        rebillAmountEditable={amountRules.rebillAmountEditable}
                        rowKey={(p) => p.id}
                        onChangeProduct={(idx, code) => void onChangeProduct(idx, code)}
                        onUpdateProduct={(idx, patch) => updateProduct(idx, patch)}
                        onRemoveProduct={removeProductRow}
                        lineNotice={(p) => (isUnavailableLine(p.productCode) ? t('return.form.error.productUnavailable') : null)}
                        errorMessage={
                          !productsValid && (highlightMissing || products.length > 0)
                            ? t(
                                hasUnavailableLine
                                  ? 'return.form.error.productUnavailable'
                                  : returnProductsErrorKey(products, amountRules.rebillAmountEditable) ??
                                      'return.form.error.productAmounts'
                              )
                            : null
                        }
                      />

                      <div className="flex flex-wrap justify-end gap-4 font-medium mt-3 text-sm">
                        <div>
                          {t('return.form.returnAmountTotal')}: ¥{returnTotal.toLocaleString()}
                        </div>
                        <div>
                          {t('return.form.rebillAmountTotal')}: ¥{rebillTotal.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 6 Reason + justification */}
                <div
                  data-return-field="orderReason"
                  className={fieldWrapClass(
                    nextFieldId === 'justification' ? 'justification' : 'orderReason'
                  )}
                >
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-[#00A651] text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">
                      6
                    </div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3">
                          {t('return.form.orderReason')}
                          <RequiredMark />
                        </h4>
                        <SearchSelect
                          options={RETURN_ORDER_REASON_OPTIONS}
                          value={form.orderReason || null}
                          onChange={(val) =>
                            setForm((f) => ({
                              ...f,
                              orderReason: (val || '') as ReturnOrderReasonCode | '',
                              status: 'DRAFT',
                            }))
                          }
                          placeholder={t('return.form.orderReasonPlaceholder')}
                        />
                        {reviewWas('orderReason')}
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-1">
                          {t('return.form.justification')}
                          <RequiredMark />
                        </h4>
                        <p className="text-xs text-gray-500 mb-2">
                          {t('return.form.justificationHint')}
                        </p>
                        <textarea
                          rows={5}
                          className={`border-2 border-gray-300 rounded-lg px-4 py-3 w-full focus:outline-none focus:ring-2 ${ui.ring} focus:ring-opacity-50 transition-all resize-none`}
                          value={form.justification}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              justification: e.target.value,
                              status: 'DRAFT',
                            }))
                          }
                          placeholder={t('return.form.justificationPlaceholder')}
                        />
                        {reviewWas('justification')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {step === 3 && !review?.isLoading && (
            <section className="space-y-6">
              {/*
                The summary is shared with the service reviewer's screen (ReturnSummary), so that
                what the reviewer corrects is exactly what the requester confirmed here. Values are
                passed as a view-model rather than the form itself, because the reviewer feeds it
                a stored request.
              */}
              <ReturnSummary
                accent={ui.accent}
                title={review ? t('return.review.correcting') : t('return.form.summary')}
                // The review's own layer on the same summary: what changed, what it was, what is
                // still wrong or empty, and the route as it stood. Nothing of it in create mode.
                {...(review
                  ? {
                      stepGroups: { one: t('return.form.step1'), two: t('return.form.step2') },
                      previous: review.previous,
                      onUndo: review.undoField,
                      canUndo: review.canUndoField,
                      errors: review.errors,
                      productsPrevious: review.productsPrevious,
                      productsPreviousLines: review.productsPreviousLines,
                      onUndoProducts: review.undoProducts,
                      timelinePrevious: review.timelinePrevious,
                      timelineError: review.routeMissing ? t('return.form.hierarchyMissing') : undefined,
                    }
                  : {})}
                values={{
                  returnTypeLabel,
                  requestDate: form.requestDate,
                  isService: form.isService,
                  businessUnit: form.businessUnit,
                  requesterDisplay: formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap),
                  soldToName: form.soldToName,
                  soldToCode: form.soldToCode,
                  endUserName: form.endUserName,
                  endUserCode: form.endUserCode,
                  dairitenContactName: form.dairitenContactName,
                  dairitenContactEmail: form.dairitenContactEmail,
                  originalOrderNumber: form.originalOrderNumber,
                  invoiceDate: form.invoiceDate,
                  isStandingOrder: form.isStandingOrder,
                  invoiceDates: [form.invoiceDate, ...form.additionalInvoiceDates],
                  quoteRefNo: form.quoteRefNo,
                  orderReasonLabel,
                  justification: form.justification,
                  products,
                  returnTotal,
                  rebillTotal,
                  rebillAmountEditable: amountRules.rebillAmountEditable,
                  timeline: timelineApprovers,
                }}
              />
            </section>
          )}

          {/* What the reviewer still owes before the request can go on, and where things stand. */}
          {review && step === 3 && (
            <div className="mt-6 text-sm text-gray-500">
              {!review.canSave && review.anythingChanged ? (
                <span className="text-red-600">{t('return.review.fixBeforeSave')}</span>
              ) : review.anythingChanged ? (
                <>
                  {t('return.review.hasChanges')} <span className="text-gray-400">{t('return.review.saveFirstHint')}</span>
                </>
              ) : (
                t('return.review.noChanges')
              )}
              {review.missingFields.length > 0 && (
                <div className="mt-1 text-xs text-amber-700">
                  <div>{t('return.review.mustCompleteBeforeApproval')}</div>
                  <button type="button" onClick={review.jumpToFirstMissing} className="underline font-semibold text-left">
                    {t('return.review.blockedFields')} ({review.missingFields.length}):{' '}
                    {review.missingFields.map((f) => t(RETURN_REQUIRED_FIELD_LABEL_KEYS[f])).join(', ')}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 sticky bottom-0 bg-gray-50 py-4 border-t flex justify-between z-10 flex-wrap gap-3">
            <div className="flex gap-3">
              <button
                type="button"
                className="px-5 py-2.5 border-2 border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed btn-press"
                disabled={step === 1 || isSubmitting || review?.isSending}
                onClick={() => {
                  setStep((s) => Math.max(1, s - 1))
                  setValidatedBanner(false)
                }}
              >
                {t('common.back')}
              </button>
              {review && (
                <button
                  type="button"
                  className="px-5 py-2.5 border-2 border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-all duration-200 disabled:opacity-50 btn-press"
                  disabled={review.isSaving || review.isSending}
                  onClick={review.leave}
                >
                  {t('return.review.cancel')}
                </button>
              )}
            </div>
            <div className="flex gap-3 flex-wrap justify-end">
              {/*
                The review's own actions, on the last step. Save records the corrections on this
                request; Send back rejects the step with a reason; Send for approval saves anything
                unsaved and then clears the review step — disabled while a required field is empty,
                which the server enforces too. Nothing is created: it is the same request throughout.
              */}
              {review && step === 3 && (
                <>
                  <button
                    type="button"
                    className="px-5 py-2.5 border-2 border-red-300 text-red-700 rounded-lg font-medium hover:bg-red-50 transition-all duration-200 disabled:opacity-50 btn-press"
                    disabled={review.isSaving || review.isSending}
                    onClick={() => void review.sendBack()}
                  >
                    {t('return.review.discard')}
                  </button>
                  <button
                    type="button"
                    className="px-5 py-2.5 border-2 border-[#9333EA] text-[#6B21A8] rounded-lg font-semibold hover:bg-[#9333EA]/5 transition-all duration-200 disabled:opacity-50 btn-press"
                    disabled={review.isSaving || review.isSending || !review.anythingChanged || !review.canSave}
                    onClick={() => void review.save()}
                  >
                    {review.isSaving ? t('return.review.saving') : t('return.review.save')}
                  </button>
                  <button
                    type="button"
                    className="px-6 py-2.5 text-white rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm btn-press"
                    style={{ backgroundImage: 'linear-gradient(to right, #9333EA, #6B21A8)' }}
                    disabled={
                      review.isSaving ||
                      review.isSending ||
                      !review.canSave ||
                      review.missingFields.length > 0
                    }
                    onClick={() => void review.sendForApproval()}
                  >
                    {review.isSending ? t('return.review.sending') : t('return.review.sendForApproval')}
                  </button>
                </>
              )}
              {/* Next through the steps in both modes; Submit only when creating. */}
              {(!review || step < 3) && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault()
                    handleNext()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleNext()
                    }
                  }}
                  className="inline-block"
                >
                  <button
                    type="button"
                    className="px-6 py-2.5 text-white rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm btn-press"
                    style={{ backgroundColor: ui.hex }}
                    onMouseEnter={(e) =>
                      canNext && (e.currentTarget.style.backgroundColor = ui.hexHover)
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = ui.hex)}
                    disabled={!canNext || isSubmitting}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleNext()
                    }}
                  >
                    {step < 3 ? t('common.next') : t('return.form.submit')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Every correction saved so far, and the way to discard them all. */}
          {review && step === 3 && Array.isArray(review.stored?.reviewEdits) && review.stored!.reviewEdits.length > 0 && (
            <div className="mt-6">
              <ReviewEditTrailSection
                reviewEdits={review.stored!.reviewEdits}
                accent={REVIEW_BAR}
                onDiscardAll={() => void review.discardAll()}
                discarding={review.isDiscarding}
              />
            </div>
          )}
          {review && step === 3 && <p className="mt-4 text-xs text-gray-500">{t('return.review.trailNote')}</p>}
        </div>
      </div>
    </div>
  )
}
