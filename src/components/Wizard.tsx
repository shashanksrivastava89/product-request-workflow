import { useI18n } from '../providers/I18nContext'
import { SAMPLE_DRAFT_PREFIX, clearDraft, saveDraft } from '../utils/formDraftStorage'
import { useFormCtx } from '../providers/FormContext'
import React, { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SearchSelect from './SearchSelect'
import QuantityInput from './QuantityInput'
import { BilingualFieldCaption } from './BilingualFieldCaption'
import { ChannelPartner, EndUser, Product } from '../services/api.service'
import { computeApprovalMessage } from '../utils/approval'
import { resetDownstream, resetProductRowDownstream } from '../utils/formReset'
import { quantityFromInput, blockNegativeAndDecimal } from '../utils/numericInput'
import apiClient, { staticDataApi } from '../services/api.service'
import ZncClaimAttachmentUpload from './ZncClaimAttachmentUpload'
import { useAuth } from '../providers/AuthContext'
import { filterSalesRepsToSelf, normalizePersonName } from '../utils/requester-self.util'
import { nationalSalesManagerSlotRoleLabel, salesManagerSlotRoleLabel } from '../utils/zncclaim-role-label.util'
import {
  formatSalesRepCodeForPublicDisplay,
  formatSalesRepOptionLabel,
  formatRequesterWithSalesRepCode,
  hasDisplayableSalesRepCode,
} from '../utils/sales-rep-display.util'
import type { FormData, ProductItem } from '../providers/FormContext'
import { useRequesterPersonalAccountOptions } from '../hooks/useRequesterPersonalAccountOptions'
import {
  CHANNEL_SHIP_TO_LABEL_LINE1,
  CHANNEL_SHIP_TO_LABEL_LINE2,
  DIRECT_SHIP_TO_LABEL_LINE1,
  DIRECT_SHIP_TO_LABEL_LINE2,
  HEIWA_SHIP_TO_LABEL_LINE1,
  HEIWA_SHIP_TO_LABEL_LINE2,
} from '../utils/deliveryMode'
import {
  isZsamPersonalShipToSelection,
  personalShipToTennozDefaults,
  PERSONAL_SHIP_TO_LABEL_LINE1,
  PERSONAL_SHIP_TO_LABEL_LINE2,
  PERSONAL_SHIP_TO_TENNOZ_DISPLAY_NAME,
} from '../utils/personalShipTo'
import {
  formatShipToDisplayCode,
  formatShipToDisplayName,
  formatShipToLabel,
  shipToFallbackLabel,
} from '../utils/shipToDisplay'
import { WIZARD_READONLY_FIELD_CLASS } from '../utils/wizardFieldStyles'
import { formatProductCodes } from '../utils/productCodes'
import ProductCodeLine from './ProductCodeLine'

type ShipToUiMode = 'CHANNEL' | 'HEIWA' | 'DIRECT' | 'PERSONAL' | null

/**
 * When true, NSM is omitted from the ZNC Claim hierarchy preview even if populated (legacy workaround).
 * Leave false so preview matches Data Management / API (empty NSM hides the step naturally).
 */
const ZNCCLAIM_SUPPRESS_NSM_IN_HIERARCHY_PREVIEW = false

/** User-facing 3M yen threshold for ZSAM / ZNC conditional steps (logic still uses 3000000 numerically). */
const YEN_3M_DISPLAY = '¥3,000,000'
const FINANCE_SPLIT_YEN = 3_000_000
/** RAQA split for ZNCCLAIM / ZINT (Global RAQA added when total is strictly greater). */
const RAQUA_SPLIT_YEN = 1_500_000
const YEN_1_5M_DISPLAY = '¥1,500,000'

type ApprovalPreviewRow = { num: number; role: string; name: string; note?: string }

/** LFC / DCM on ZSAM & ZNC: show when total unknown (step 1) OR total > ¥3M. */
function shouldShowFinanceApproversInPreview(amount: number): boolean {
  return amount <= 0 || amount > FINANCE_SPLIT_YEN
}

/** Global RAQA is shown when mapped and (total unknown yet OR total > ¥1.5M). */
function shouldShowGlobalRaqaInPreview(amount: number): boolean {
  return amount <= 0 || amount > RAQUA_SPLIT_YEN
}

function filterApprovalPreviewByAmount(approvers: ApprovalPreviewRow[], subtotal: number): ApprovalPreviewRow[] {
  return approvers.filter((a) => {
    // Hide finance steps only when total is known and ≤ ¥3M (step 1 subtotal is 0 → keep full chain)
    if (
      subtotal > 0 &&
      subtotal <= FINANCE_SPLIT_YEN &&
      (a.role === 'Local Finance Controller' || a.role === 'Director, Commercial Manager')
    ) {
      return false
    }
    return true
  })
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  ZSAM: 'ZSAM for SALES PROMOTION',
  ZNC: 'ZNC for INSTALLATION',
  ZNCCLAIM: 'ZNC for CLAIM REPLACEMENT',
  ZINT: 'ZINT for QC TEST',
}
function getRequestTypeLabel(type: string | undefined): string {
  if (!type) return ''
  return REQUEST_TYPE_LABELS[type] ?? type
}

const WIZARD_BOOTSTRAP_DRAFT_KEY = 'japauto_wizard_bootstrap_draft:'

/** Prefer GET `server` fields; fill gaps from POST `bootstrap` (sessionStorage) when stringify/GET timing drops rows or CRM fields. */
function mergeServerDraftWithBootstrap(server: any, bootstrap: any | null): any {
  if (!bootstrap) return server
  const nonempty = (v: unknown) => {
    if (v == null) return undefined
    const s = String(v).trim()
    return s === '' ? undefined : s
  }
  const pick = (k: string) => nonempty(server?.[k]) ?? nonempty(bootstrap?.[k])
  const serverProducts = Array.isArray(server?.products) ? server.products : []
  const bootProducts = Array.isArray(bootstrap?.products) ? bootstrap.products : []
  const products = serverProducts.length > 0 ? serverProducts : bootProducts
  return {
    ...bootstrap,
    ...server,
    products,
    soldToCode: pick('soldToCode'),
    soldToName: pick('soldToName'),
    shipToCode: pick('shipToCode'),
    shipToName: pick('shipToName'),
    endUserCode: pick('endUserCode'),
    endUserName: pick('endUserName'),
    attentionTo: pick('attentionTo'),
    deliveryMode: server?.deliveryMode ?? bootstrap?.deliveryMode,
    address: nonempty(server?.address) ?? nonempty(bootstrap?.address),
    postalCode: nonempty(server?.postalCode) ?? nonempty(bootstrap?.postalCode),
    prefecture: nonempty(server?.prefecture) ?? nonempty(bootstrap?.prefecture),
    phone: nonempty(server?.phone) ?? nonempty(bootstrap?.phone),
  }
}

function mapServerFormToWizardForm(
  apiForm: any,
  opts: { currentUserId?: string }
): FormData {
  const purpose = (apiForm.purpose || apiForm.formType || '') as FormData['purpose']
  const formType = (apiForm.formType || '') as FormData['formType']
  const products: ProductItem[] = (apiForm.products || []).map((p: any) => {
    const rawUnit = p.unitPrice ?? p.unit_price
    const unit = Number(rawUnit != null && typeof rawUnit === 'object' && 'toString' in rawUnit ? String(rawUnit) : rawUnit ?? 0)
    const rawWh = p.wholesalePrice ?? p.wholesale_price
    const wholesale =
      rawWh != null && rawWh !== ''
        ? Number(typeof rawWh === 'object' && 'toString' in rawWh ? String(rawWh) : rawWh)
        : undefined
    const price = wholesale ?? unit
    return {
      id: crypto.randomUUID(),
      productCode: String(p.productCode ?? ''),
      sapCode: p.sapCode ?? undefined,
      productName: String(p.productName ?? ''),
      quantity: Number(p.quantity ?? 0),
      unitPrice: unit,
      wholesalePrice: wholesale,
      subTotal: Number(p.subtotal ?? p.quantity * price),
      lotNumber: p.lotNumber ?? undefined,
      note: p.note ?? undefined,
      isConsumable: Boolean(p.isConsumable),
    }
  })

  const requesterIdForWizard =
    opts.currentUserId && apiForm.requesterId === opts.currentUserId ? opts.currentUserId : ''

  return {
    id: apiForm.id,
    backendDraftId: apiForm.id,
    requestDate: apiForm.requestDate ? String(apiForm.requestDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    formType,
    requesterId: requesterIdForWizard,
    requesterName: apiForm.requesterName ?? '',
    businessUnit: (apiForm.businessUnit || undefined) as FormData['businessUnit'],
    requesterGroup: apiForm.requesterGroup ?? '',
    salesRepCodeSap: apiForm.salesRepCodeSap ?? undefined,
    expectedDeliveryDate: apiForm.expectedDeliveryDate ?? 'ASAP',
    salesManager: apiForm.salesManager ?? undefined,
    districtSalesManager: apiForm.districtSalesManager ?? undefined,
    nationalSalesManager: apiForm.nationalSalesManager ?? undefined,
    localFinanceController: apiForm.localFinanceController ?? undefined,
    directorCommercialManager: apiForm.directorCommercialManager ?? undefined,
    technicalManager: undefined,
    nationalTSManager: undefined,
    csPsManager: undefined,
    raqaManager: undefined,
    globalRaqaManager: undefined,
    purpose,
    deliveryMode: (apiForm.deliveryMode ?? apiForm.delivery_mode ?? undefined) as FormData['deliveryMode'],
    endUserCode: (apiForm.endUserCode ?? apiForm.end_user_code) as string | undefined,
    endUserName: (apiForm.endUserName ?? apiForm.end_user_name) as string | undefined,
    postalCode: apiForm.postalCode ?? undefined,
    prefecture: apiForm.prefecture ?? undefined,
    address: apiForm.address ?? undefined,
    phone: apiForm.phone ?? undefined,
    shipToCode: (apiForm.shipToCode ?? apiForm.ship_to_code) as string | undefined,
    shipToName: (apiForm.shipToName ?? apiForm.ship_to_name) as string | undefined,
    attentionTo: apiForm.attentionTo ?? undefined,
    soldToCode: (apiForm.soldToCode ?? apiForm.sold_to_code) as string | undefined,
    soldToName: (apiForm.soldToName ?? apiForm.sold_to_name) as string | undefined,
    commentsForApproval: apiForm.commentsForApproval ?? undefined,
    freeDescription: apiForm.freeDescription ?? '',
    products,
    status: 'DRAFT',
  }
}

/** Closed SearchSelect label when code/name exist but async options are not loaded yet. */
function codeNameFallback(code?: string, name?: string): string | undefined {
  const c = String(code ?? '').trim()
  if (!c) return undefined
  const n = String(name ?? '').trim()
  return n ? `${c} — ${n}` : c
}

/**
 * resetDownstream(..., 'endUserCode') clears deliveryMode, shipTo, comments, and free text (see ORDER in formReset).
 * When only end user changes, keep partner delivery + step-3 draft text — same idea as handleSoldToChange.
 */
function restorePartnerDeliveryAfterEndUserClear(
  prev: FormData,
  cleared: FormData,
  overrides: Partial<FormData>
): FormData {
  const next: FormData = { ...cleared, ...overrides, products: prev.products }
  const m = prev.deliveryMode
  if (m === 'CHANNEL' && prev.soldToCode) {
    next.deliveryMode = 'CHANNEL'
    next.shipToCode = prev.soldToCode
    next.shipToName = prev.soldToName
  } else if (m === 'HEIWA') {
    next.deliveryMode = 'HEIWA'
    next.shipToCode = 'HEIWA'
    next.shipToName = 'HEIWAJIMA SERVICE CENTER'
  } else if (m === 'DIRECT') {
    next.deliveryMode = 'DIRECT'
    next.shipToCode = prev.shipToCode
    next.shipToName = prev.shipToName
  } else if (m === 'INTERNAL') {
    next.deliveryMode = 'INTERNAL'
    next.shipToCode = prev.shipToCode
    next.shipToName = prev.shipToName
  }
  next.commentsForApproval = prev.commentsForApproval
  next.freeDescription = prev.freeDescription
  return next
}

/**
 * resetDownstream(..., 'soldTo') clears end user, deliveryMode, shipTo, etc. (see ORDER in formReset).
 * Keep prior end user + DIRECT/INTERNAL ship + step-3 text; CHANNEL/HEIWA ship follows the new sold-to.
 */
function restorePartnerFieldsAfterSoldToClear(
  prev: FormData,
  cleared: FormData,
  overrides: Pick<FormData, 'soldToCode' | 'soldToName'> & Partial<FormData>
): FormData {
  const next: FormData = { ...cleared, ...overrides, products: prev.products }
  next.endUserCode = prev.endUserCode
  next.endUserName = prev.endUserName
  next.endUserDepartment = prev.endUserDepartment
  next.endUserContact = prev.endUserContact
  next.postalCode = prev.postalCode
  next.prefecture = prev.prefecture
  next.address = prev.address
  next.phone = prev.phone

  const m = prev.deliveryMode
  const sc = overrides.soldToCode ?? ''
  const sn = overrides.soldToName
  if (m === 'CHANNEL' && sc) {
    next.deliveryMode = 'CHANNEL'
    next.shipToCode = sc
    next.shipToName = sn
  } else if (m === 'HEIWA') {
    next.deliveryMode = 'HEIWA'
    next.shipToCode = 'HEIWA'
    next.shipToName = 'HEIWAJIMA SERVICE CENTER'
  } else if (m === 'DIRECT') {
    next.deliveryMode = 'DIRECT'
    next.shipToCode = prev.shipToCode
    next.shipToName = prev.shipToName
  } else if (m === 'INTERNAL') {
    next.deliveryMode = 'INTERNAL'
    next.shipToCode = prev.shipToCode
    next.shipToName = prev.shipToName
  }

  next.commentsForApproval = prev.commentsForApproval
  next.freeDescription = prev.freeDescription
  return next
}


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
export default function Wizard() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, refreshUser, isLoading: authLoading } = useAuth()
  const { form, setForm, resetForm } = useFormCtx()
  const skipNextEmptyRouteResetRef = React.useRef(false)
  const prevBusinessUnitRef = React.useRef<string | undefined>(undefined)
  const prevRequesterGroupRef = React.useRef<string | undefined>(undefined)
  const prevPurposeRef = React.useRef<string | undefined>(undefined)
  /** Only clear partner/end-user address when BU actually changes (not first hydrate from server draft). */
  const prevBusinessUnitForPartnerFieldsRef = React.useRef<string | undefined>(undefined)
  /** After copy-from-rejected load, skip one BU-change clear (stale localStorage BU vs server draft BU). */
  const skipPartnerBuChangeClearOnceRef = React.useRef(false)

  const draftIdFromUrl = searchParams.get('draft')

  // Helper function to build approval hierarchy with sequential numbering
  const buildApprovalHierarchy = (amountForConditionals = 0) => {
    const approvers: ApprovalPreviewRow[] = [];
    let stepNum = 0;
    const financeNote =
      amountForConditionals > FINANCE_SPLIT_YEN ? undefined : `(if total > ${YEN_3M_DISPLAY})`;
    const globalRaqaNote =
      amountForConditionals > RAQUA_SPLIT_YEN ? undefined : `(if total > ${YEN_1_5M_DISPLAY})`;

    const pushStep = (role: string, name: string | undefined, note?: string) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      approvers.push({
        num: stepNum++,
        role,
        name: trimmed,
        note,
      });
    };

    const requesterDisplay = formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap);
    approvers.push({ num: stepNum++, role: 'Sales Rep / Requester', name: requesterDisplay });

    if (form.purpose !== 'ZINT') {
      pushStep(salesManagerSlotRoleLabel(form.purpose, form.salesManager), form.salesManager);
      pushStep('District Sales Manager', form.districtSalesManager);
    }

    // ZSAM: SM → DSM → NSM → LFC / DCM (if total > ¥3M)
    if (form.purpose === 'ZSAM') {
      pushStep(
        nationalSalesManagerSlotRoleLabel(form.purpose, form.nationalSalesManager),
        form.nationalSalesManager
      );
      if (shouldShowFinanceApproversInPreview(amountForConditionals)) {
        pushStep('Local Finance Controller', form.localFinanceController, financeNote);
        pushStep('Director, Commercial Manager', form.directorCommercialManager, financeNote);
      }
    }

    // ZNC (Installation): SM → DSM → NSM → TM → NTSM → LFC / DCM (if total > ¥3M)
    if (form.purpose === 'ZNC') {
      pushStep(
        nationalSalesManagerSlotRoleLabel(form.purpose, form.nationalSalesManager),
        form.nationalSalesManager
      );
      pushStep('Technical Manager', form.technicalManager);
      pushStep('National TS Manager', form.nationalTSManager);
      if (shouldShowFinanceApproversInPreview(amountForConditionals)) {
        pushStep('Local Finance Controller', form.localFinanceController, financeNote);
        pushStep('Director, Commercial Manager', form.directorCommercialManager, financeNote);
      }
    }
    // ZNCCLAIM: SM → DSM → NSM → CS/PS → RAQA (always) → Global RAQA (if total > ¥1.5M)
    if (form.purpose === 'ZNCCLAIM') {
      if (!ZNCCLAIM_SUPPRESS_NSM_IN_HIERARCHY_PREVIEW) {
        pushStep(
          nationalSalesManagerSlotRoleLabel(form.purpose, form.nationalSalesManager),
          form.nationalSalesManager
        );
      }
      pushStep('CS/PS Manager', form.csPsManager);
      pushStep('RAQA Manager', form.raqaManager);
      if (shouldShowGlobalRaqaInPreview(amountForConditionals)) {
        pushStep('Global RAQA Manager', form.globalRaqaManager, globalRaqaNote);
      }
    }
    // ZINT: CS/PS → RAQA → Global RAQA (if total > ¥1.5M) — matches approval_chain_config
    if (form.purpose === 'ZINT') {
      pushStep('CS/PS Manager', form.csPsManager);
      pushStep('RAQA Manager', form.raqaManager);
      if (shouldShowGlobalRaqaInPreview(amountForConditionals)) {
        pushStep('Global RAQA Manager', form.globalRaqaManager, globalRaqaNote);
      }
    }

    return approvers.map((a, i) => ({ ...a, num: i }));
  };
  const [step, setStep] = React.useState(1)

  const resolveShipToUiMode = React.useCallback((f: FormData): ShipToUiMode => {
    if (f.purpose === 'ZSAM' && isZsamPersonalShipToSelection(f.shipToCode)) return 'PERSONAL'
    if (f.deliveryMode === 'HEIWA') return 'HEIWA'
    if (f.deliveryMode === 'DIRECT') return 'DIRECT'
    if (f.deliveryMode === 'CHANNEL') return 'CHANNEL'
    return null
  }, [])

  const [shipToUiMode, setShipToUiMode] = React.useState<ShipToUiMode>(() => resolveShipToUiMode(form))

  // Reset, or load a server draft from copy-from-rejected (`/new?draft=<uuid>`). Open Review & Submit (step 3) when draft loads.
  React.useEffect(() => {
    if (draftIdFromUrl) {
      if (authLoading) return
      if (!user?.id) {
        navigate('/new', { replace: true })
        resetForm()
        setStep(1)
        return
      }
      let cancelled = false
      void (async () => {
        try {
          let bootstrap: any = null
          try {
            const rawBoot = sessionStorage.getItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${draftIdFromUrl}`)
            if (rawBoot) {
              bootstrap = JSON.parse(rawBoot)
              sessionStorage.removeItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${draftIdFromUrl}`)
            }
          } catch {
            /* ignore */
          }
          const { data } = await apiClient.get(`/forms/${draftIdFromUrl}`)
          const server = data?.form
          if (!server || server.status !== 'DRAFT') {
            throw new Error('Draft not available')
          }
          if (server.requesterId !== user.id) {
            throw new Error('Not your draft')
          }
          if (cancelled) return
          const f = mergeServerDraftWithBootstrap(server, bootstrap)
          const mapped = mapServerFormToWizardForm(f, { currentUserId: user.id })
          setForm(mapped)
          setShipToUiMode(resolveShipToUiMode(mapped))
          try {
            saveDraft(SAMPLE_DRAFT_PREFIX, mapped)
          } catch {
            /* ignore */
          }
          skipPartnerBuChangeClearOnceRef.current = true
          prevBusinessUnitRef.current = f.businessUnit || undefined
          prevRequesterGroupRef.current = f.requesterGroup || undefined
          prevPurposeRef.current = f.purpose || undefined
          prevBusinessUnitForPartnerFieldsRef.current = f.businessUnit || undefined
          skipNextEmptyRouteResetRef.current = true
          /*
           * A clone opens on step 2, not the summary.
           *
           * Vidhi Parsons, 9 Sep, relaying his sales managers: *"When they click use clone, the
           * system go back to 3rd page. need how to change end customer etc. Could you make it go
           * back second page?"* Step 3 is a summary with an edit link; the point of cloning is to
           * change the customer and the products, and those live on step 2.
           */
          setStep(2)
          navigate('/new', { replace: true })
        } catch {
          if (!cancelled) {
            alert('Could not open copied draft. Try again or start a new application.')
            navigate('/new', { replace: true })
            prevBusinessUnitRef.current = undefined
            prevRequesterGroupRef.current = undefined
            prevPurposeRef.current = undefined
            prevBusinessUnitForPartnerFieldsRef.current = undefined
            resetForm()
            setStep(1)
          }
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (skipNextEmptyRouteResetRef.current) {
      skipNextEmptyRouteResetRef.current = false
      return
    }
    prevBusinessUnitRef.current = undefined
    prevRequesterGroupRef.current = undefined
    prevPurposeRef.current = undefined
    prevBusinessUnitForPartnerFieldsRef.current = undefined
    resetForm()
    setStep(1)
  }, [draftIdFromUrl, authLoading, navigate, resetForm, setForm, user?.id])

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  // When true, missing required fields get amber highlight (e.g. after clicking disabled Next)
  const [highlightMissingFields, setHighlightMissingFields] = React.useState(false)
  const [availableRequesterGroups, setAvailableRequesterGroups] = React.useState<Array<{ id: string, name: string }>>([])
  const [fetchedSalesReps, setFetchedSalesReps] = React.useState<Array<{
    id: string;
    code: string;
    name: string;
    salesManager: string;
    districtSalesManager: string;
    nationalSalesManager: string;
    localFinanceController: string;
    directorCommercialManager: string;
    requesterGroupId: string;
  }>>([])
  const [loadingRequesterGroups, setLoadingRequesterGroups] = React.useState(false)
  const [requesterGroupsError, setRequesterGroupsError] = React.useState<string | null>(null)
  const [loadingSalesReps, setLoadingSalesReps] = React.useState(false)
  const [salesRepsError, setSalesRepsError] = React.useState<string | null>(null)
  const [channelPartners, setChannelPartners] = React.useState<ChannelPartner[]>([])
  const [endUsers, setEndUsers] = React.useState<EndUser[]>([])
  const [directDeliveryLocations, setDirectDeliveryLocations] = React.useState<ChannelPartner[]>([])
  const [loadingChannelPartners, setLoadingChannelPartners] = React.useState(false)
  const [loadingEndUsers, setLoadingEndUsers] = React.useState(false)
  const [loadingDirectDelivery, setLoadingDirectDelivery] = React.useState(false)
  const [channelPartnersError, setChannelPartnersError] = React.useState<string | null>(null)
  const [endUsersError, setEndUsersError] = React.useState<string | null>(null)
  const [directDeliveryError, setDirectDeliveryError] = React.useState<string | null>(null)
  const [productCatalog, setProductCatalog] = React.useState<Product[]>([])

  /*
   * Lines whose product a requester can no longer select. A clone or a saved draft keeps its lines as
   * they were, so a product the master has since removed (the stale CDG `1129` of 8 Oct 2026, a code
   * Power BI stopped listing, a list price of 0/1) would otherwise be submitted again. Each code is
   * checked once with the exact lookup; a code the picker itself offered is selectable by definition.
   * Keyed by business unit + code, valued with what to tell the requester.
   */
  const [unavailableCodes, setUnavailableCodes] = React.useState<Record<string, string>>({})
  const checkedProductCodesRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const bu = form.businessUnit
    if (!bu) return
    const pending = [...new Set(form.products.map(p => String(p.productCode ?? '').trim()).filter(Boolean))]
      .filter(code => !checkedProductCodesRef.current.has(`${bu}|${code}`))
      .filter(code => !productCatalog.some(pr => String(pr.code) === code))
    if (pending.length === 0) return
    let cancelled = false
    void (async () => {
      const verdicts: Array<[string, string | null]> = []
      await Promise.all(pending.map(async (code) => {
        try {
          const prod = await staticDataApi.getProductExact(bu, code)
          verdicts.push([
            code,
            !prod
              ? 'No longer in the product master - choose the product again.'
              : String(prod.code) !== code
                ? `No longer in the product master under this code; it is now ${prod.code}. Choose it again.`
                : null,
          ])
        } catch {
          /* a failed lookup proves nothing: left unchecked, so it is tried again */
        }
      }))
      if (cancelled) return
      for (const [code] of verdicts) checkedProductCodesRef.current.add(`${bu}|${code}`)
      const flagged = verdicts.filter(([, message]) => message !== null)
      if (flagged.length > 0) {
        setUnavailableCodes(prev => ({ ...prev, ...Object.fromEntries(flagged.map(([code, message]) => [`${bu}|${code}`, message as string])) }))
      }
    })()
    return () => { cancelled = true }
  }, [form.businessUnit, form.products, productCatalog])
  const unavailableLineMessage = (code: string | undefined) => unavailableCodes[`${form.businessUnit}|${String(code ?? '').trim()}`]
  const hasUnavailableLine = form.products.some(p => !!unavailableLineMessage(p.productCode))

  // Update available requester groups when business unit changes
  React.useEffect(() => {
    const prevBu = prevBusinessUnitRef.current
    const currBu = form.businessUnit
    prevBusinessUnitRef.current = currBu

    setRequesterGroupsError(null)
    setAvailableRequesterGroups([])

    if (prevBu !== undefined && prevBu !== currBu && (form.requesterGroup || form.requesterId)) {
      setForm((f) => ({
        ...f,
        requesterGroup: '',
        requesterId: '',
        requesterName: '',
        salesRepCodeSap: '',
      }))
    }

    if (!form.businessUnit) {
      return
    }

    setLoadingRequesterGroups(true)
    staticDataApi
      .getRequesterGroups(form.businessUnit, form.purpose || undefined)
      .then((response) => {
        setAvailableRequesterGroups(response.groups)
        setRequesterGroupsError(null)
      })
      .catch((error) => {
        console.error('Failed to fetch requester groups:', error)
        setRequesterGroupsError('Failed to load requester groups. Please try again.')
        setAvailableRequesterGroups([])
      })
      .finally(() => {
        setLoadingRequesterGroups(false)
      })
  }, [form.businessUnit, form.purpose, setForm])

  // REQUESTER: re-sync profile after BU so requesterGroupId / salesRepCode match server (admin updates, session drift)
  React.useEffect(() => {
    if (user?.role !== 'REQUESTER' || !form.businessUnit) return
    void refreshUser()
  }, [form.businessUnit, user?.role, refreshUser])

  // Fetch sales reps when requester group or sample request type (purpose) changes
  React.useEffect(() => {
    const prevRg = prevRequesterGroupRef.current
    const prevPurp = prevPurposeRef.current
    const currRg = form.requesterGroup || ''
    const currPurpose = form.purpose || ''
    prevRequesterGroupRef.current = form.requesterGroup
    prevPurposeRef.current = form.purpose || ''

    setSalesRepsError(null)
    setFetchedSalesReps([])

    const rgChanged = prevRg !== undefined && prevRg !== currRg
    const purposeChanged = prevPurp !== undefined && prevPurp !== currPurpose
    // Server-backed draft: aligning requester group (e.g. pin effect) must not wipe API-hydrated requester row.
    if (!form.backendDraftId && form.requesterId && (rgChanged || purposeChanged)) {
      setForm((f) => ({
        ...f,
        requesterId: '',
        requesterName: '',
        salesRepCodeSap: '',
      }))
    }

    if (!form.requesterGroup) {
      return
    }

    setLoadingSalesReps(true)
    staticDataApi
      .getSalesReps(form.requesterGroup, form.purpose || undefined)
      .then((response) => {
        setFetchedSalesReps(response.salesReps)
        setSalesRepsError(null)
      })
      .catch((error) => {
        console.error('Failed to fetch sales reps:', error)
        setSalesRepsError('Failed to load sales reps. Please try again.')
        setFetchedSalesReps([])
      })
      .finally(() => {
        setLoadingSalesReps(false)
      })
  }, [form.requesterGroup, form.purpose, form.backendDraftId, form.requesterId, setForm])

  /** REQUESTER users: only their row; admins/others see full group list. Backend also filters by sample request type (e.g. ZSAM). */
  const lockRequesterStep = user?.role === 'REQUESTER'

  /** REQUESTER: dropdown lists only the group on the user account — not every CDG/LSG team. */
  const requesterGroupsForDropdown = useMemo(() => {
    if (!lockRequesterStep || !user?.requesterGroupId) {
      return availableRequesterGroups
    }
    const mine = availableRequesterGroups.find((g) => g.id === user.requesterGroupId)
    return mine ? [mine] : []
  }, [lockRequesterStep, user?.requesterGroupId, availableRequesterGroups])

  const lockRequesterGroupUi = lockRequesterStep && !!user?.requesterGroupId

  const salesRepsForDropdown = useMemo(() => {
    if (!lockRequesterStep || !user) return fetchedSalesReps
    return filterSalesRepsToSelf(fetchedSalesReps, user)
  }, [lockRequesterStep, user, fetchedSalesReps])

  // REQUESTER: pin Requester Group to the account's group when that group exists for the current BU
  React.useEffect(() => {
    if (!lockRequesterStep || !user?.requesterGroupId) return
    if (!form.businessUnit || availableRequesterGroups.length === 0) return
    if (!availableRequesterGroups.some((g) => g.id === user.requesterGroupId)) return
    setForm((f) => {
      if (f.requesterGroup === user.requesterGroupId) return f
      // Copy-from-rejected / GET draft: source row may have empty or legacy requesterGroup — never
      // resetDownstream here or partners and products are wiped while only TYPE survives.
      if (f.backendDraftId) {
        return { ...f, requesterGroup: user.requesterGroupId! }
      }
      const cleared = resetDownstream(f, 'requesterGroup')
      return { ...cleared, requesterGroup: user.requesterGroupId! }
    })
  }, [lockRequesterStep, user?.requesterGroupId, form.businessUnit, availableRequesterGroups, setForm])

  type SalesRepRow = (typeof fetchedSalesReps)[number]

  const applySalesRepSelection = React.useCallback(
    (rep: SalesRepRow) => {
      setForm((f) => {
        let cleared = resetDownstream(f, 'requesterId')
        cleared = {
          ...cleared,
          requesterId: rep.id,
          requesterName: rep.name || '',
          salesRepCodeSap: hasDisplayableSalesRepCode(rep.code) ? String(rep.code).trim() : '',
        }
        const purpose = cleared.purpose
        const next =
          purpose === 'ZSAM'
            ? {
                ...cleared,
                salesManager: rep.salesManager || '',
                districtSalesManager: rep.districtSalesManager || '',
                nationalSalesManager: rep.nationalSalesManager || '',
                localFinanceController: rep.localFinanceController || '',
                directorCommercialManager: rep.directorCommercialManager || '',
              }
            : {
                ...cleared,
                salesManager: '',
                districtSalesManager: '',
                nationalSalesManager: '',
                localFinanceController: '',
                directorCommercialManager: '',
                technicalManager: '',
                nationalTSManager: '',
                csPsManager: '',
                raqaManager: '',
                globalRaqaManager: '',
              }

        if (next.purpose === 'ZSAM' && next.requesterName) {
          staticDataApi.getZsamApprovers(next.requesterName, next.businessUnit).then((response) => {
            if (response.approvers) {
              const a = response.approvers
              setForm((inner) => ({
                ...inner,
                salesManager: a.salesManager ?? '',
                districtSalesManager: a.districtSalesManager ?? '',
                nationalSalesManager: a.nationalSalesManager ?? '',
                localFinanceController: a.localFinanceController ?? '',
                directorCommercialManager: a.directorCommercialManager ?? '',
              }))
            }
          })
        }

        return next
      })
    },
    [setForm]
  )

  // REQUESTER: auto-select when exactly one row (yourself) is available for this group + sample type
  React.useEffect(() => {
    if (!lockRequesterStep || !user) return
    // Server draft hydrate uses auth user id as requesterId; sales-rep rows use Requester.id — do not run
    // applySalesRepSelection (resetDownstream from requesterId) or it wipes partners and products.
    if (form.backendDraftId) return
    if (salesRepsForDropdown.length !== 1) return
    const only = salesRepsForDropdown[0]
    if (form.requesterId === only.id) return
    applySalesRepSelection(only)
  }, [lockRequesterStep, user, salesRepsForDropdown, form.requesterId, form.backendDraftId, applySalesRepSelection])

  /** Own draft from API: requesterId was set to User.id; align to Requester.id for step-1 UI without clearing downstream. */
  React.useEffect(() => {
    if (!form.backendDraftId || !user?.id) return
    if (form.requesterId !== user.id) return
    if (salesRepsForDropdown.length === 0) return
    const byCode =
      form.salesRepCodeSap && hasDisplayableSalesRepCode(form.salesRepCodeSap)
        ? salesRepsForDropdown.find((r) => String(r.code || '').trim() === String(form.salesRepCodeSap).trim())
        : undefined
    const requesterName = form.requesterName
    const byName = requesterName
      ? salesRepsForDropdown.find(
          (r) => normalizePersonName(r.name) === normalizePersonName(requesterName)
        )
      : undefined
    const pick = byCode ?? byName ?? (salesRepsForDropdown.length === 1 ? salesRepsForDropdown[0] : undefined)
    if (!pick || pick.id === form.requesterId) return
    setForm((f) =>
      f.backendDraftId && f.requesterId === user.id ? { ...f, requesterId: pick.id } : f
    )
  }, [
    form.backendDraftId,
    form.requesterId,
    user?.id,
    form.salesRepCodeSap,
    form.requesterName,
    salesRepsForDropdown,
    setForm,
  ])

  // REQUESTER: you are not in the list for this sample type (e.g. ZSAM-only row) — clear selection
  React.useEffect(() => {
    if (!lockRequesterStep || loadingSalesReps) return
    if (form.backendDraftId) return
    if (fetchedSalesReps.length === 0 || salesRepsForDropdown.length > 0) return
    if (!form.requesterId) return
    setForm((f) => ({
      ...f,
      requesterId: '',
      requesterName: '',
      salesRepCodeSap: '',
      salesManager: '',
      districtSalesManager: '',
      nationalSalesManager: '',
      localFinanceController: '',
      directorCommercialManager: '',
      technicalManager: '',
      nationalTSManager: '',
      csPsManager: '',
      raqaManager: '',
      globalRaqaManager: '',
    }))
  }, [
    lockRequesterStep,
    loadingSalesReps,
    fetchedSalesReps.length,
    salesRepsForDropdown.length,
    form.requesterId,
    form.backendDraftId,
    setForm,
  ])

  // Calculate total amount for ZSAM approval logic
  const totalAmount = useMemo(() => {
    return form.products.reduce((sum, product) => sum + (product.quantity * product.unitPrice), 0)
  }, [form.products])
  const isZintPurpose = form.purpose === 'ZINT'
  const isZsamPurpose = form.purpose === 'ZSAM'
  const zintSoldToCode = '5002909'
  const zintSoldToName = 'ACME QUALITY ASSUARANCE'
  const zintPostalCode = '140-0002'
  const zintAddress = 'Tennoz Central Tower 20th Floor, 2-2-24, Higashi-Shinagawa Shinagawa-ku, Tokyo'
  /** ZINT ship-to: stored on form; UI offers two fixed choices */
  const zintShipTennozCode = 'TENNOZ_HO'
  const zintShipTennozName = 'TENNOZ HEAD OFFICE'
  const zintShipHeiwaCode = 'HEIWA'
  const zintShipHeiwaName = 'HEIWAJIMA SERVICE CENTER'
  const zintShipToValid = React.useCallback(
    (f: typeof form) => f.shipToCode === zintShipTennozCode || f.shipToCode === zintShipHeiwaCode,
    []
  )

  const canNext = React.useMemo(() => {
    if (step === 1) return ((form.businessUnit ?? '') !== '' && form.requesterId !== '' && (form.purpose ?? '') !== '')
    if (step === 2) {
      const hasProductsFromDropdown = form.products.length > 0 &&
        form.products.every(p => p.quantity > 0 && !!(p.productCode && String(p.productCode).trim())) &&
        !hasUnavailableLine
      // ZINT: fixed sold-to; user picks ship-to; products required
      if (isZintPurpose) return zintShipToValid(form) && hasProductsFromDropdown
      const hasSoldToAndEndUser = !!(form.soldToCode && form.endUserCode)
      const directDeliveryShipToRequired =
        form.deliveryMode === 'DIRECT' && shipToUiMode === 'DIRECT'
      const directDeliveryOk = !directDeliveryShipToRequired || !!form.shipToCode
      const deliveryDateOk = form.expectedDeliveryDate === 'ASAP' ||
        !!(form.expectedDeliveryDate && form.expectedDeliveryDate !== 'ASAP' && String(form.expectedDeliveryDate).trim().length >= 10)
      return !!form.deliveryMode && hasSoldToAndEndUser && directDeliveryOk && deliveryDateOk && hasProductsFromDropdown
    }
    if (step === 3) return String(form.freeDescription || '').trim().length > 0
    return true
  }, [step, form, isZintPurpose, zintShipToValid, shipToUiMode, hasUnavailableLine])

  // Step 1 required field order for "next to fill" hint (soft green)
  const step1NextFieldId = React.useMemo(() => {
    if ((form.purpose ?? '') === '') return 'purpose'
    if ((form.businessUnit ?? '') === '') return 'businessUnit'
    if ((form.requesterGroup ?? '') === '') return 'requesterGroup'
    if (!form.requesterId) return 'requester'
    return null
  }, [form.purpose, form.businessUnit, form.requesterGroup, form.requesterId])

  // Step 2: one-by-one order – soldTo → endUser → deliveryMode → shipTo → deliveryDate → products
  const step2NextFieldId = React.useMemo(() => {
    if (isZintPurpose) {
      if (!zintShipToValid(form)) return 'shipTo'
      return form.products.length > 0 && form.products.every(p => p.quantity > 0 && !!(p.productCode && String(p.productCode).trim())) && !hasUnavailableLine
        ? null
        : 'products'
    }
    if (!form.soldToCode) return 'soldTo'
    if (!form.endUserCode) return 'endUser'
    if (!form.deliveryMode) return 'deliveryMode'
    const directDeliveryShipToRequired =
      form.deliveryMode === 'DIRECT' && shipToUiMode === 'DIRECT'
    if (directDeliveryShipToRequired && !form.shipToCode) return 'shipTo'
    const deliveryDateOk = form.expectedDeliveryDate === 'ASAP' || !!(form.expectedDeliveryDate && form.expectedDeliveryDate !== 'ASAP' && String(form.expectedDeliveryDate).trim().length >= 10)
    if (!deliveryDateOk) return 'deliveryDate'
    if (form.products.length === 0 || !form.products.every(p => p.quantity > 0 && !!(p.productCode && String(p.productCode).trim())) || hasUnavailableLine) return 'products'
    return null
  }, [form.deliveryMode, form.soldToCode, form.endUserCode, form.shipToCode, form.expectedDeliveryDate, form.products, isZintPurpose, zintShipToValid, shipToUiMode, hasUnavailableLine])

  const step3NextFieldId = React.useMemo(() => {
    if (!String(form.freeDescription || '').trim()) return 'freeSampleComment'
    return null
  }, [form.freeDescription])

  const nextFieldId =
    step === 1 ? step1NextFieldId : step === 2 ? step2NextFieldId : step === 3 ? step3NextFieldId : null

  const isFieldMissing = React.useCallback((fieldId: string) => {
    if (step === 1) {
      if (fieldId === 'purpose') return !(form.purpose ?? '')
      if (fieldId === 'businessUnit') return !(form.businessUnit ?? '')
      if (fieldId === 'requesterGroup') return !(form.requesterGroup ?? '')
      if (fieldId === 'requester') return !form.requesterId
    }
    if (step === 2) {
      if (isZintPurpose) {
        if (fieldId === 'shipTo') return !zintShipToValid(form)
        if (fieldId === 'products')
          return form.products.length === 0 || !form.products.every(p => p.quantity > 0 && !!(p.productCode && String(p.productCode).trim())) || hasUnavailableLine
        return false
      }
      if (fieldId === 'deliveryMode') return !form.deliveryMode
      if (fieldId === 'soldTo') return !form.soldToCode
      if (fieldId === 'endUser') return !form.endUserCode
      if (fieldId === 'shipTo') {
        const directDeliveryShipToRequired =
          form.deliveryMode === 'DIRECT' && shipToUiMode === 'DIRECT'
        return directDeliveryShipToRequired && !form.shipToCode
      }
      if (fieldId === 'deliveryDate') {
        const ok = form.expectedDeliveryDate === 'ASAP' || (form.expectedDeliveryDate && String(form.expectedDeliveryDate).trim().length >= 10)
        return !ok
      }
      if (fieldId === 'products') return form.products.length === 0 || !form.products.every(p => p.quantity > 0 && !!(p.productCode && String(p.productCode).trim())) || hasUnavailableLine
    }
    if (step === 3 && fieldId === 'freeSampleComment') return !String(form.freeDescription || '').trim()
    return false
  }, [step, isZintPurpose, form.purpose, form.businessUnit, form.requesterGroup, form.requesterId, form.deliveryMode, form.soldToCode, form.endUserCode, form.shipToCode, form.expectedDeliveryDate, form.products, form.freeDescription, zintShipToValid, shipToUiMode, hasUnavailableLine])

  const fieldWrapClass = (fieldId: string) => {
    const isNext = nextFieldId === fieldId
    const missing = isFieldMissing(fieldId)
    if (isNext) return 'transition-all duration-300 rounded-lg border-2 border-emerald-300 bg-emerald-50/70 p-1 -m-1'
    if (highlightMissingFields && missing) return 'transition-all duration-300 rounded-lg border-2 border-amber-400 bg-amber-50/80 p-1 -m-1'
    return 'rounded-lg border-2 border-transparent p-1 -m-1 transition-all duration-300'
  }

  const renderZintShipToSelector = () => (
    <div data-wizard-field="shipTo" className={fieldWrapClass('shipTo')}>
      <div className="space-y-3">
        <label
          className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
            form.shipToCode === zintShipTennozCode ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-200'
          }`}
        >
          <input
            type="radio"
            name="zintShipTo"
            className="mt-1 text-orange-600 focus:ring-orange-500"
            checked={form.shipToCode === zintShipTennozCode}
            onChange={() =>
              setForm((f) => ({
                ...f,
                deliveryMode: 'HEIWA',
                shipToCode: zintShipTennozCode,
                shipToName: zintShipTennozName,
              }))
            }
          />
          <span className="font-bold text-gray-900 text-base">Ship-To: {zintShipTennozName}</span>
        </label>
        <label
          className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
            form.shipToCode === zintShipHeiwaCode ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-200'
          }`}
        >
          <input
            type="radio"
            name="zintShipTo"
            className="mt-1 text-orange-600 focus:ring-orange-500"
            checked={form.shipToCode === zintShipHeiwaCode}
            onChange={() =>
              setForm((f) => ({
                ...f,
                deliveryMode: 'HEIWA',
                shipToCode: zintShipHeiwaCode,
                shipToName: zintShipHeiwaName,
              }))
            }
          />
          <span className="font-bold text-gray-900 text-base">Ship-To: HEIWAJIMA SERVICE CENTER</span>
        </label>
      </div>
    </div>
  )

  // Reset highlight when step changes or when canNext becomes true
  React.useEffect(() => { setHighlightMissingFields(false) }, [step])
  React.useEffect(() => { if (canNext) setHighlightMissingFields(false) }, [canNext])

  const scrollToField = (fieldId: string) => {
    const el = document.querySelector(`[data-wizard-field="${fieldId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const handleNextOrSubmitClick = () => {
    if (canNext) {
      if (step < 3) setStep(s => Math.min(3, s + 1))
      else onSubmit()
      return
    }
    setHighlightMissingFields(true)
    if (nextFieldId) scrollToField(nextFieldId)
  }

  const subtotal = React.useMemo(() => form.products.reduce((s, p) => s + p.quantity * (p.wholesalePrice ?? p.unitPrice), 0), [form.products])
  const approval = React.useMemo(() => computeApprovalMessage(mapPurpose(form.purpose), subtotal), [form.purpose, subtotal])

  // Validation helpers
  const endUserCodeInvalid = React.useMemo(() => {
    if (!form.endUserCode) return false
    const c = String(form.endUserCode)
    return !(c.startsWith('8') || c.startsWith('9'))
  }, [form.endUserCode])
  const soldToCodeInvalid = React.useMemo(() => {
    if (form.deliveryMode !== 'CHANNEL' || !form.soldToCode) return false
    const c = String(form.soldToCode)
    return !(c.startsWith('1') || c.startsWith('9'))
  }, [form.deliveryMode, form.soldToCode])
  const shipToCodeInvalid = React.useMemo(() => {
    if (form.deliveryMode !== 'CHANNEL' || !form.shipToCode) return false
    const code = String(form.shipToCode)
    // Valid if starts with '2' OR matches the Sold-To code
    return !code.startsWith('2') && code !== form.soldToCode
  }, [form.deliveryMode, form.shipToCode, form.soldToCode])

  // Fetch hierarchy data from database when requester and form type are selected
  React.useEffect(() => {
    if (!(form.purpose && form.requesterName && form.businessUnit && form.businessUnit !== 'NA')) return;

    let cancelled = false;
    const empty = (v: string | null | undefined) => (v != null && v !== '' ? v : '');

    staticDataApi
      .getUserHierarchy(
        form.requesterName,
        form.businessUnit,
        form.purpose as 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'
      )
      .then(response => {
        if (cancelled) return;

        // ZNC / ZNCCLAIM / ZSAM: Data Management mappings (and server rules) are source of truth.
        // Use API values including empty/null as cleared — do NOT fall back to `f.*` or stale sales-rep defaults
        // (sales-reps API hardcodes e.g. national NSM for every rep).
        if (form.purpose === 'ZNCCLAIM') {
          if (response.hierarchy && response.found) {
            const hierarchy = response.hierarchy;
            const h = hierarchy as Record<string, string | null | undefined>;
            setForm(f => ({
              ...f,
              salesManager: empty(hierarchy.salesManager),
              districtSalesManager: empty(hierarchy.districtSalesManager),
              nationalSalesManager: empty(hierarchy.nationalSalesManager),
              csPsManager: empty(h.csPsManager),
              raqaManager: empty(h.raqaManager),
              globalRaqaManager: empty(h.globalRaqaManager),
            }));
          } else {
            setForm(f => ({
              ...f,
              salesManager: '',
              districtSalesManager: '',
              nationalSalesManager: '',
              csPsManager: '',
              raqaManager: '',
              globalRaqaManager: '',
            }));
          }
          return;
        }

        if (form.purpose === 'ZINT') {
          if (response.hierarchy && response.found) {
            const hierarchy = response.hierarchy;
            const h = hierarchy as Record<string, string | null | undefined>;
            setForm(f => ({
              ...f,
              salesManager: empty(hierarchy.salesManager),
              districtSalesManager: empty(hierarchy.districtSalesManager),
              nationalSalesManager: empty(hierarchy.nationalSalesManager),
              csPsManager: empty(h.csPsManager),
              raqaManager: empty(h.raqaManager),
              globalRaqaManager: empty(h.globalRaqaManager),
            }));
          } else {
            setForm(f => ({
              ...f,
              salesManager: '',
              districtSalesManager: '',
              nationalSalesManager: '',
              csPsManager: '',
              raqaManager: '',
              globalRaqaManager: '',
            }));
          }
          return;
        }

        if (!response.hierarchy || !response.found) return;

        const hierarchy = response.hierarchy;
        const h = hierarchy as Record<string, string | null | undefined>;

        if (form.purpose === 'ZNC') {
          setForm(f => ({
            ...f,
            salesManager: empty(hierarchy.salesManager),
            districtSalesManager: empty(hierarchy.districtSalesManager),
            nationalSalesManager: empty(hierarchy.nationalSalesManager),
            technicalManager: empty(h.technicalManager),
            nationalTSManager: empty(h.nationalTSManager),
            localFinanceController: empty(hierarchy.localFinanceController),
            directorCommercialManager: empty(hierarchy.directorCommercialManager),
          }));
          return;
        }

        if (form.purpose === 'ZSAM') {
          setForm(f => ({
            ...f,
            salesManager: empty(hierarchy.salesManager),
            districtSalesManager: empty(hierarchy.districtSalesManager),
            nationalSalesManager: empty(hierarchy.nationalSalesManager),
            localFinanceController: empty(hierarchy.localFinanceController),
            directorCommercialManager: empty(hierarchy.directorCommercialManager),
          }));
          return;
        }
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Failed to fetch user hierarchy:', error);
        if (form.purpose === 'ZSAM') {
          staticDataApi.getZsamApprovers(form.requesterName, form.businessUnit).then(response => {
            if (cancelled) return;
            if (response.approvers) {
              setForm(f => ({
                ...f,
                salesManager: response.approvers?.salesManager ?? f.salesManager,
                districtSalesManager: response.approvers?.districtSalesManager ?? f.districtSalesManager,
                nationalSalesManager: response.approvers?.nationalSalesManager ?? f.nationalSalesManager,
                localFinanceController: response.approvers?.localFinanceController ?? f.localFinanceController,
                directorCommercialManager: response.approvers?.directorCommercialManager ?? f.directorCommercialManager,
              }));
            }
          }).catch(fallbackError => {
            console.error('Fallback to ZSAM approvers also failed:', fallbackError);
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form.purpose, form.requesterName, form.businessUnit, setForm])

  // Clear partner / end-user fields only when Business Unit actually changes (not on first BU set from draft).
  React.useEffect(() => {
    if (skipPartnerBuChangeClearOnceRef.current) {
      skipPartnerBuChangeClearOnceRef.current = false
      prevBusinessUnitForPartnerFieldsRef.current = form.businessUnit
      return
    }
    const prev = prevBusinessUnitForPartnerFieldsRef.current
    const curr = form.businessUnit
    prevBusinessUnitForPartnerFieldsRef.current = curr

    if (prev !== undefined && prev !== curr && (form.soldToCode || form.endUserCode)) {
      setForm((f) => ({
        ...f,
        soldToCode: '',
        soldToName: '',
        endUserCode: '',
        endUserName: '',
        postalCode: '',
        prefecture: '',
        address: '',
        phone: '',
      }))
    }
  }, [form.businessUnit, form.soldToCode, form.endUserCode, setForm])

  // ZINT internal orders: fixed Sold-To; ship-To is TENNOZ HEAD OFFICE or Heiwajima (user choice). Auto-populate baseline fields.
  React.useEffect(() => {
    if (!isZintPurpose) return
    setForm(f => {
      const shipPairOk =
        (f.shipToCode === zintShipTennozCode && f.shipToName === zintShipTennozName) ||
        (f.shipToCode === zintShipHeiwaCode && f.shipToName === zintShipHeiwaName)
      const shipToCode = shipPairOk ? f.shipToCode! : zintShipHeiwaCode
      const shipToName = shipPairOk ? f.shipToName! : zintShipHeiwaName
      const alreadyNormalized =
        f.soldToCode === zintSoldToCode &&
        f.soldToName === zintSoldToName &&
        !f.endUserCode &&
        !f.endUserName &&
        f.postalCode === zintPostalCode &&
        f.prefecture === '' &&
        f.address === zintAddress &&
        !f.phone &&
        f.deliveryMode === 'HEIWA' &&
        shipPairOk
      if (alreadyNormalized) return f
      return {
        ...f,
        soldToCode: zintSoldToCode,
        soldToName: zintSoldToName,
        endUserCode: '',
        endUserName: '',
        postalCode: zintPostalCode,
        prefecture: '',
        address: zintAddress,
        phone: '',
        deliveryMode: 'HEIWA',
        shipToCode,
        shipToName,
        expectedDeliveryDate: f.expectedDeliveryDate && f.expectedDeliveryDate.trim() !== '' ? f.expectedDeliveryDate : 'ASAP',
      }
    })
  }, [isZintPurpose, form.businessUnit, setForm])

  // Helper functions for async customer loading
  const loadChannelPartnersInitial = React.useCallback(async () => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getChannelPartners('1', form.businessUnit, { limit: 50 })
      return {
        options: response.partners.map(c => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
          sub: `${c.address} — ${c.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load channel partners:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadChannelPartnersSearch = React.useCallback(async (search: string) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getChannelPartners('1', form.businessUnit, { 
        limit: 20, 
        search 
      })
      return {
        options: response.partners.map(c => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
          sub: `${c.address} — ${c.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to search channel partners:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadChannelPartnersMore = React.useCallback(async (offset: number) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getChannelPartners('1', form.businessUnit, { 
        limit: 50,
        offset 
      })
      return {
        options: response.partners.map(c => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
          sub: `${c.address} — ${c.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load more channel partners:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadEndUsersInitial = React.useCallback(async () => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getEndUsers('8', form.businessUnit, { limit: 50 })
      return {
        options: response.endUsers.map(u => ({
          value: u.code,
          label: `${u.code} — ${u.name}`,
          sub: `${u.address} — ${u.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load end users:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadEndUsersSearch = React.useCallback(async (search: string) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getEndUsers('8', form.businessUnit, { 
        limit: 20, 
        search 
      })
      return {
        options: response.endUsers.map(u => ({
          value: u.code,
          label: `${u.code} — ${u.name}`,
          sub: `${u.address} — ${u.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to search end users:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadEndUsersMore = React.useCallback(async (offset: number) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getEndUsers('8', form.businessUnit, { 
        limit: 50,
        offset 
      })
      return {
        options: response.endUsers.map(u => ({
          value: u.code,
          label: `${u.code} — ${u.name}`,
          sub: `${u.address} — ${u.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load more end users:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const {
    asyncOptions: personalAccountAsyncOptions,
    resolveByCode: resolvePersonalAccountByCode,
  } = useRequesterPersonalAccountOptions(form.purpose)

  // Clear Ship-To only when switching to a mode that doesn't use it (e.g. away from DIRECT).
  // Do not clear when CHANNEL, HEIWA, INTERNAL, or when deliveryMode is still unknown (null/undefined — e.g. legacy DB row).
  React.useEffect(() => {
    const mode = form.deliveryMode
    if (
      form.shipToCode &&
      mode != null &&
      mode !== 'DIRECT' &&
      mode !== 'HEIWA' &&
      mode !== 'CHANNEL' &&
      mode !== 'INTERNAL'
    ) {
      setForm(f => ({
        ...f,
        shipToCode: '',
        shipToName: '',
      }))
    }
  }, [form.deliveryMode, form.shipToCode, setForm])

  // Helper functions for async Direct Delivery loading
  const loadDirectDeliveryInitial = React.useCallback(async () => {
    if (!form.businessUnit || form.deliveryMode !== 'DIRECT') return { options: [] }
    try {
      const response = await staticDataApi.getDirectDeliveryLocations('2', form.businessUnit, { limit: 50 })
      return {
        options: response.locations.map(l => ({
          value: l.code,
          label: `${l.code} — ${l.name}`,
          sub: `${l.address} — ${l.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load direct delivery locations:', error)
      return { options: [] }
    }
  }, [form.businessUnit, form.deliveryMode])

  const loadDirectDeliverySearch = React.useCallback(async (search: string) => {
    if (!form.businessUnit || form.deliveryMode !== 'DIRECT') return { options: [] }
    try {
      const response = await staticDataApi.getDirectDeliveryLocations('2', form.businessUnit, { 
        limit: 20, 
        search 
      })
      return {
        options: response.locations.map(l => ({
          value: l.code,
          label: `${l.code} — ${l.name}`,
          sub: `${l.address} — ${l.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to search direct delivery locations:', error)
      return { options: [] }
    }
  }, [form.businessUnit, form.deliveryMode])

  const loadDirectDeliveryMore = React.useCallback(async (offset: number) => {
    if (!form.businessUnit || form.deliveryMode !== 'DIRECT') return { options: [] }
    try {
      const response = await staticDataApi.getDirectDeliveryLocations('2', form.businessUnit, { 
        limit: 50,
        offset 
      })
      return {
        options: response.locations.map(l => ({
          value: l.code,
          label: `${l.code} — ${l.name}`,
          sub: `${l.address} — ${l.phone || ''}`
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load more direct delivery locations:', error)
      return { options: [] }
    }
  }, [form.businessUnit, form.deliveryMode])

  // Helper functions for async product loading
  const loadProductsInitial = React.useCallback(async () => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getProductCatalog(form.businessUnit, { limit: 50 })
      return {
        options: response.products.map(prod => ({
          value: String(prod.code),
          label: prod.productNameLocal,
          sub: productPickerSub(prod, form.businessUnit || '')
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load products:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadProductsSearch = React.useCallback(async (search: string) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getProductCatalog(form.businessUnit, { 
        limit: 20, 
        search 
      })
      return {
        options: response.products.map(prod => ({
          value: String(prod.code),
          label: prod.productNameLocal,
          sub: productPickerSub(prod, form.businessUnit || '')
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to search products:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const loadProductsMore = React.useCallback(async (offset: number) => {
    if (!form.businessUnit) return { options: [] }
    try {
      const response = await staticDataApi.getProductCatalog(form.businessUnit, { 
        limit: 50,
        offset 
      })
      return {
        options: response.products.map(prod => ({
          value: String(prod.code),
          label: prod.productNameLocal,
          sub: productPickerSub(prod, form.businessUnit || '')
        })),
        total: response.total,
        hasMore: response.hasMore
      }
    } catch (error) {
      console.error('Failed to load more products:', error)
      return { options: [] }
    }
  }, [form.businessUnit])

  const handleProductChange = React.useCallback(async (val: any) => {
    if (val && form.businessUnit) {
      try {
        // Exact lookup: a search capped at 100 rows can miss a short code (CDG 12000 has 326
        // substring hits) and the line would silently price at 0.
        const product = await staticDataApi.getProductExact(form.businessUnit, String(val))
        if (product) {
          onChangeProduct(
            form.products.findIndex(p => p.productCode === val),
            val as string,
            product
          )
        } else {
          onChangeProduct(
            form.products.findIndex(p => p.productCode === val),
            val as string
          )
        }
      } catch (error) {
        console.error('Failed to fetch selected product details:', error)
        onChangeProduct(
          form.products.findIndex(p => p.productCode === val),
          val as string
        )
      }
    } else {
      onChangeProduct(
        form.products.findIndex(p => p.productCode === val),
        val as string
      )
    }
  }, [form.businessUnit, form.products])

  // Reusable onChange handlers for customer selections
  const handleSoldToChange = React.useCallback(
    async (val: any) => {
      if (val && String(val).startsWith('9')) {
        const row = await resolvePersonalAccountByCode(String(val))
        setForm((f) => {
          const cleared = resetDownstream(f, 'soldTo')
          return restorePartnerFieldsAfterSoldToClear(f, cleared, {
            soldToCode: val as string,
            soldToName: row?.name ?? '',
          })
        })
        return
      }
      if (val && form.businessUnit) {
      // Try to find by exact code match - search for the code as exact match
      try {
        // Search with the code - backend will match it in code field
        const response = await staticDataApi.getChannelPartners('1', form.businessUnit, { 
          limit: 100, // Get more results to ensure we find the match
          search: val as string 
        })
        const c = response.partners.find(x => x.code === val)
        if (c) {
          setForm(f => {
            const cleared = resetDownstream(f, 'soldTo')
            const soldToCode = (val as string) || ''
            const soldToName = c.name
            return restorePartnerFieldsAfterSoldToClear(f, cleared, { soldToCode, soldToName })
          })
        } else {
          // If not found, still set the code
          setForm(f => {
            const cleared = resetDownstream(f, 'soldTo')
            const soldToCode = (val as string) || ''
            const soldToName = ''
            return restorePartnerFieldsAfterSoldToClear(f, cleared, { soldToCode, soldToName })
          })
        }
      } catch (error) {
        console.error('Failed to fetch channel partner:', error)
        // Still set the code even if fetch fails
        setForm(f => {
          const cleared = resetDownstream(f, 'soldTo')
          const soldToCode = (val as string) || ''
          const soldToName = ''
          return restorePartnerFieldsAfterSoldToClear(f, cleared, { soldToCode, soldToName })
        })
      }
    } else {
      setForm(f => {
        const preservedProducts = f.products
        const cleared = resetDownstream(f, 'soldTo')
        const soldToCode = (val as string) || ''
        const soldToName = ''
        const next = { ...cleared, soldToCode, soldToName, products: preservedProducts }
        if (f.deliveryMode === 'CHANNEL') {
          next.deliveryMode = 'CHANNEL'
          next.shipToCode = soldToCode
          next.shipToName = soldToName
        } else if (f.deliveryMode === 'HEIWA') {
          next.deliveryMode = 'HEIWA'
          next.shipToCode = 'HEIWA'
          next.shipToName = 'HEIWAJIMA SERVICE CENTER'
        }
        return next
      })
    }
  }, [form.businessUnit, resolvePersonalAccountByCode, setForm])

  const handleEndUserChange = React.useCallback(async (val: any) => {
    if (val && String(val).startsWith('9')) {
      const row = await resolvePersonalAccountByCode(String(val))
      setForm((f) => {
        const cleared = resetDownstream(f, 'endUserCode')
        return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
          endUserCode: (val as string) || '',
          endUserName: row?.name ?? '',
          postalCode: '',
          prefecture: '',
          address: '',
          phone: '',
        })
      })
      return
    }
    if (val && form.businessUnit) {
      try {
        // Search with the code - backend will match it in code field
        const response = await staticDataApi.getEndUsers('8', form.businessUnit, { 
          limit: 100, // Get more results to ensure we find the match
          search: val as string 
        })
        const u = response.endUsers.find(e => e.code === val)
        if (u) {
          setForm(f => {
            const cleared = resetDownstream(f, 'endUserCode')
            return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
              endUserCode: (val as string) || '',
              endUserName: u.name,
              postalCode: u.postalCode,
              prefecture: u.prefecture,
              address: u.address,
              phone: u.phone,
            })
          })
        } else {
          // If not found, still set the code
          setForm(f => {
            const cleared = resetDownstream(f, 'endUserCode')
            return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
              endUserCode: (val as string) || '',
              endUserName: '',
              postalCode: '',
              prefecture: '',
              address: '',
              phone: '',
            })
          })
        }
      } catch (error) {
        console.error('Failed to fetch end user:', error)
        // Still set the code even if fetch fails
        setForm(f => {
          const cleared = resetDownstream(f, 'endUserCode')
          return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
            endUserCode: (val as string) || '',
            endUserName: '',
            postalCode: '',
            prefecture: '',
            address: '',
            phone: '',
          })
        })
      }
    } else {
      setForm(f => {
        const cleared = resetDownstream(f, 'endUserCode')
        return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
          endUserCode: (val as string) || '',
          endUserName: '',
          postalCode: '',
          prefecture: '',
          address: '',
          phone: '',
        })
      })
    }
  }, [form.businessUnit, resolvePersonalAccountByCode, setForm])

  const handleDirectDeliveryChange = React.useCallback(async (val: any) => {
    if (val && form.businessUnit) {
      try {
        // Search with the code - backend will match it in code field
        const response = await staticDataApi.getDirectDeliveryLocations('2', form.businessUnit, { 
          limit: 100, // Get more results to ensure we find the match
          search: val as string 
        })
        const c = response.locations.find(x => x.code === val)
        if (c) {
          setForm(f => {
            const cleared = resetDownstream(f, 'shipTo')
            return { ...cleared, shipToCode: (val as string) || '', shipToName: c.name }
          })
        } else {
          // If not found, still set the code
          setForm(f => {
            const cleared = resetDownstream(f, 'shipTo')
            return { ...cleared, shipToCode: (val as string) || '', shipToName: '' }
          })
        }
      } catch (error) {
        console.error('Failed to fetch direct delivery location:', error)
        // Still set the code even if fetch fails
        setForm(f => {
          const cleared = resetDownstream(f, 'shipTo')
          return { ...cleared, shipToCode: (val as string) || '', shipToName: '' }
        })
      }
    } else {
      setForm(f => {
        const cleared = resetDownstream(f, 'shipTo')
        return { ...cleared, shipToCode: (val as string) || '', shipToName: '' }
      })
    }
  }, [form.businessUnit, setForm])

  // State for approval hierarchy view type
  const [approvalView, setApprovalView] = React.useState<'flowchart' | 'list' | 'timeline' | 'badges'>('timeline')

  // State for summary view type
  const [summaryView, setSummaryView] = React.useState<'cards' | 'badges' | 'accordion' | 'grid' | 'timeline'>('grid')

  // State for product view type
  const [productView, setProductView] = React.useState<'cards' | 'table' | 'compact' | 'grid' | 'accordion'>('compact')

  // State for partner view type (Sold-To, End User, Ship-To)
  const [partnerView, setPartnerView] = React.useState<'cards' | 'accordion' | 'tabs' | 'gradient' | 'timeline'>('timeline')

  const [soldToAccountKind, setSoldToAccountKind] = React.useState<'standard' | 'personal'>('standard')
  const [endUserAccountKind, setEndUserAccountKind] = React.useState<'standard' | 'personal'>('standard')

  React.useEffect(() => {
    const c = form.soldToCode?.trim()
    if (!c) return
    setSoldToAccountKind(c.startsWith('9') && form.purpose === 'ZSAM' ? 'personal' : 'standard')
  }, [form.soldToCode, form.purpose])

  React.useEffect(() => {
    const c = form.endUserCode?.trim()
    if (!c) return
    setEndUserAccountKind(c.startsWith('9') && form.purpose === 'ZSAM' ? 'personal' : 'standard')
  }, [form.endUserCode, form.purpose])

  const clearSoldToSelectionForKindSwitch = React.useCallback(() => {
    setForm((f) => {
      const preservedProducts = f.products
      const cleared = resetDownstream(f, 'soldTo')
      const soldToCode = ''
      const soldToName = ''
      const next = { ...cleared, soldToCode, soldToName, products: preservedProducts }
      if (f.deliveryMode === 'CHANNEL') {
        next.deliveryMode = 'CHANNEL'
        next.shipToCode = soldToCode
        next.shipToName = soldToName
      } else if (f.deliveryMode === 'HEIWA') {
        next.deliveryMode = 'HEIWA'
        next.shipToCode = 'HEIWA'
        next.shipToName = 'HEIWAJIMA SERVICE CENTER'
      }
      return next
    })
  }, [setForm])

  const clearEndUserSelectionForKindSwitch = React.useCallback(() => {
    setForm((f) => {
      const cleared = resetDownstream(f, 'endUserCode')
      return restorePartnerDeliveryAfterEndUserClear(f, cleared, {
        endUserCode: '',
        endUserName: '',
        postalCode: '',
        prefecture: '',
        address: '',
        phone: '',
      })
    })
  }, [setForm])

  React.useEffect(() => {
    if (form.purpose === 'ZSAM') return
    if (soldToAccountKind === 'personal') {
      setSoldToAccountKind('standard')
      clearSoldToSelectionForKindSwitch()
    }
    if (endUserAccountKind === 'personal') {
      setEndUserAccountKind('standard')
      clearEndUserSelectionForKindSwitch()
    }
  }, [form.purpose, soldToAccountKind, endUserAccountKind, clearSoldToSelectionForKindSwitch, clearEndUserSelectionForKindSwitch])

  React.useEffect(() => {
    setShipToUiMode(resolveShipToUiMode(form))
  }, [form.deliveryMode, form.shipToCode, form.purpose, resolveShipToUiMode])

  React.useEffect(() => {
    if (form.purpose === 'ZSAM') return
    if (shipToUiMode !== 'PERSONAL') return
    if (isZsamPersonalShipToSelection(form.shipToCode)) {
      setForm((f) => ({ ...f, shipToCode: '', shipToName: '' }))
    }
  }, [form.purpose, form.shipToCode, shipToUiMode, setForm])

  const onSelectPersonalShipTo = React.useCallback(() => {
    if (shipToUiMode === 'PERSONAL') return
    setShipToUiMode('PERSONAL')
    setForm((f) => {
      const cleared = resetDownstream(f, 'deliveryMode')
      return { ...cleared, deliveryMode: 'DIRECT', ...personalShipToTennozDefaults() }
    })
  }, [shipToUiMode, setForm])

  const soldToAccountAsyncOptions =
    soldToAccountKind === 'personal' && isZsamPurpose
      ? personalAccountAsyncOptions
      : {
          initialLoad: loadChannelPartnersInitial,
          load: loadChannelPartnersSearch,
          loadMore: loadChannelPartnersMore,
        }

  const endUserAccountAsyncOptions =
    endUserAccountKind === 'personal' && isZsamPurpose
      ? personalAccountAsyncOptions
      : {
          initialLoad: loadEndUsersInitial,
          load: loadEndUsersSearch,
          loadMore: loadEndUsersMore,
        }

  const deliveryRadioGridClass =
    partnerView === 'cards' ? 'grid md:grid-cols-4 gap-4 mb-6' : 'grid md:grid-cols-4 gap-4 mb-4'

  const deliveryRadioLabelClass = (active: boolean) =>
    partnerView === 'cards'
      ? `flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
          active ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-orange-200'
        }`
      : 'flex items-start gap-2 cursor-pointer'

  const deliveryModeRadioTextClass =
    partnerView === 'cards' ? 'font-medium text-gray-700 leading-tight' : 'leading-tight'

  const deliveryModeRadioInputClass = `${partnerView === 'cards' ? 'text-orange-600 focus:ring-orange-500' : ''} mt-0.5 shrink-0`

  const renderDeliveryModeRadioLabel = (line1: string, line2: string) => (
    <span className={deliveryModeRadioTextClass}>
      <span className="block">{line1}</span>
      <span className="block">{line2}</span>
    </span>
  )

  const renderShipToInfoBanner = (content: React.ReactNode) => (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm text-gray-600 flex items-center gap-2">
      <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{content}</span>
    </div>
  )

  const renderDeliveryShipToFields = () => {
    if (isZintPurpose) return renderZintShipToSelector()

    return (
      <>
        <div data-wizard-field="deliveryMode" className={fieldWrapClass('deliveryMode')}>
          <div className={deliveryRadioGridClass}>
            <label className={deliveryRadioLabelClass(shipToUiMode === 'CHANNEL')}>
              <input
                type="radio"
                name="deliveryMode"
                value="CHANNEL"
                checked={shipToUiMode === 'CHANNEL'}
                onChange={() => onChangeDeliveryMode('CHANNEL')}
                className={deliveryModeRadioInputClass}
              />
              {renderDeliveryModeRadioLabel(CHANNEL_SHIP_TO_LABEL_LINE1, CHANNEL_SHIP_TO_LABEL_LINE2)}
            </label>
            <label className={deliveryRadioLabelClass(shipToUiMode === 'HEIWA')}>
              <input
                type="radio"
                name="deliveryMode"
                value="HEIWA"
                checked={shipToUiMode === 'HEIWA'}
                onChange={() => onChangeDeliveryMode('HEIWA')}
                className={deliveryModeRadioInputClass}
              />
              {renderDeliveryModeRadioLabel(HEIWA_SHIP_TO_LABEL_LINE1, HEIWA_SHIP_TO_LABEL_LINE2)}
            </label>
            <label className={deliveryRadioLabelClass(shipToUiMode === 'DIRECT')}>
              <input
                type="radio"
                name="deliveryMode"
                value="DIRECT"
                checked={shipToUiMode === 'DIRECT'}
                onChange={() => onChangeDeliveryMode('DIRECT')}
                className={deliveryModeRadioInputClass}
              />
              {renderDeliveryModeRadioLabel(DIRECT_SHIP_TO_LABEL_LINE1, DIRECT_SHIP_TO_LABEL_LINE2)}
            </label>
            {isZsamPurpose && (
              <label className={deliveryRadioLabelClass(shipToUiMode === 'PERSONAL')}>
                <input
                  type="radio"
                  name="deliveryMode"
                  value="PERSONAL"
                  checked={shipToUiMode === 'PERSONAL'}
                  onChange={onSelectPersonalShipTo}
                  className={deliveryModeRadioInputClass}
                />
                {renderDeliveryModeRadioLabel(PERSONAL_SHIP_TO_LABEL_LINE1, PERSONAL_SHIP_TO_LABEL_LINE2)}
              </label>
            )}
          </div>
        </div>

        {shipToUiMode === 'CHANNEL' &&
          renderShipToInfoBanner(
            <>
              Ship-To: <strong>{form.soldToName || 'None selected'}</strong> (Same as Sold-To)
            </>
          )}
        {shipToUiMode === 'HEIWA' &&
          renderShipToInfoBanner(
            <>
              Ship-To: <strong>HEIWAJIMA SERVICE CENTER</strong>
            </>
          )}
        {shipToUiMode === 'PERSONAL' &&
          renderShipToInfoBanner(
            <>
              Ship-To: <strong>{PERSONAL_SHIP_TO_TENNOZ_DISPLAY_NAME}</strong>
            </>
          )}
        {shipToUiMode === 'DIRECT' && (
          <div data-wizard-field="shipTo" className={fieldWrapClass('shipTo')}>
            {partnerView === 'cards' && (
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ship-To (Direct Delivery Location)
              </label>
            )}
            <SearchSelect
              asyncOptions={{
                initialLoad: loadDirectDeliveryInitial,
                load: loadDirectDeliverySearch,
                loadMore: loadDirectDeliveryMore,
              }}
              value={form.shipToCode || null}
              fallbackLabel={shipToFallbackLabel(form.shipToCode, form.shipToName)}
              onChange={handleDirectDeliveryChange}
              placeholder={
                form.businessUnit
                  ? 'Select Direct Delivery Location...'
                  : 'Select Business Unit first'
              }
              disabled={!form.businessUnit}
              labelClassName={partnerView === 'cards' ? 'text-base font-bold text-gray-900' : undefined}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Loading Overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md mx-4 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#00A651] mx-auto mb-4"></div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Submitting Your Request</h3>
            <p className="text-gray-600 mb-1">Generating reference number...</p>
            <p className="text-sm text-gray-500">Please wait, this will only take a moment</p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl shadow-lg p-8 animate-scaleIn">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-800">{t('wizard.title')}</h1>
          </div>
          {/* Progress bar */}
          <div className="w-full h-3 bg-gray-200 rounded-full mb-6 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-300 ease-in-out"
              style={{ backgroundColor: '#00A651', width: `${(step / 3) * 100}%` }}
            />
          </div>

          {/* Step Indicators */}
          <div className="flex justify-between items-center mb-8">
            {/* Step 1 */}
            <div className="flex items-center flex-1">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${step >= 1
                ? 'border-[#00A651] bg-[#00A651] text-white'
                : 'border-gray-300 bg-white text-gray-400'
                }`}>
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
                  {t('wizard.step1')}
                </div>
              </div>
              {step < 3 && <div className="flex-1 h-0.5 bg-gray-300 mx-4"></div>}
            </div>

            {/* Step 2 */}
            <div className="flex items-center flex-1">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${step >= 2
                ? 'border-[#00A651] bg-[#00A651] text-white'
                : 'border-gray-300 bg-white text-gray-400'
                }`}>
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
                  {t('wizard.step2')}
                </div>
              </div>
              <div className="flex-1 h-0.5 bg-gray-300 mx-4"></div>
            </div>

            {/* Step 3 */}
            <div className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${step >= 3
                ? 'border-[#00A651] bg-[#00A651] text-white'
                : 'border-gray-300 bg-white text-gray-400'
                }`}>
                <span className="font-semibold">3</span>
              </div>
              <div className="ml-3">
                <div className={`text-sm font-medium ${step >= 3 ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t('wizard.step3')}
                </div>
              </div>
            </div>
          </div>

          {step === 1 && (
            <section className="space-y-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div data-wizard-field="purpose" className={fieldWrapClass('purpose')}>
                  <label className="block text-sm mb-1">Sample Request Type</label>
                  <SearchSelect
                    options={[
                      { value: 'ZSAM', label: 'ZSAM for SALES PROMOTION' },
                      { value: 'ZNC', label: 'ZNC for INSTALLATION' },
                      { value: 'ZNCCLAIM', label: 'ZNC for CLAIM REPLACEMENT' },
                      { value: 'ZINT', label: 'ZINT for QC TEST' }
                    ]}
                    value={form.purpose || null}
                    onChange={(val) => onChangePurpose(val as any)}
                    placeholder="Select request type..."
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Date Requesting</label>
                  <input type="date" className="border rounded px-3 py-2 w-full" min={new Date().toISOString().slice(0, 10)} value={form.requestDate} onChange={(e) => setForm(f => ({ ...f, requestDate: e.target.value }))} />
                </div>
                <div data-wizard-field="businessUnit" className={fieldWrapClass('businessUnit')}>
                  <label className="block text-sm mb-1">Business Unit</label>
                  <SearchSelect
                    options={[
                      { value: 'CDG', label: 'CDG' },
                      { value: 'LSG', label: 'LSG' }
                    ]}
                    value={form.businessUnit || null}
                    onChange={(val) => setForm(f => {
                      const cleared = resetDownstream(f, 'businessUnit')
                      return { ...cleared, businessUnit: (val || undefined) as any }
                    })}
                    placeholder="Select business unit..."
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div data-wizard-field="requesterGroup" className={fieldWrapClass('requesterGroup')}>
                  <label className="block text-sm mb-1">Requester Group</label>
                  <SearchSelect
                    options={requesterGroupsForDropdown.map(group => ({
                      value: group.id,
                      label: group.name
                    }))}
                    value={form.requesterGroup || null}
                    onChange={(val) => setForm(f => {
                      const cleared = resetDownstream(f, 'requesterGroup')
                      return { ...cleared, requesterGroup: val as string }
                    })}
                    placeholder={
                      loadingRequesterGroups 
                        ? 'Loading requester groups...' 
                        : requesterGroupsError 
                          ? requesterGroupsError 
                          : form.businessUnit 
                            ? lockRequesterStep && requesterGroupsForDropdown.length === 0
                              ? 'Your team is not available for this business unit'
                              : 'Select requester group...' 
                            : 'Select Business Unit first'
                    }
                    disabled={
                      loadingRequesterGroups ||
                      !!requesterGroupsError ||
                      !form.businessUnit ||
                      lockRequesterGroupUi
                    }
                  />
                </div>
                <div data-wizard-field="requester" className={fieldWrapClass('requester')}>
                  <label className="block text-sm mb-1">Requester</label>
                  <SearchSelect
                    options={salesRepsForDropdown.map((requester) => ({
                      value: requester.id,
                      label: formatSalesRepOptionLabel(requester.name, requester.code),
                    }))}
                    value={form.requesterId || null}
                    onChange={(val) => {
                      const id = val as string
                      const rep = fetchedSalesReps.find(r => r.id === id)
                      if (rep) applySalesRepSelection(rep)
                    }}
                    placeholder={
                      loadingSalesReps 
                        ? 'Loading sales reps...' 
                        : salesRepsError 
                          ? salesRepsError 
                          : form.requesterGroup 
                            ? lockRequesterStep && salesRepsForDropdown.length === 0
                              ? 'No matching requester for this sample type in your group'
                              : 'Select requester...' 
                            : 'Select Requester Group first'
                    }
                    disabled={
                      loadingSalesReps ||
                      !!salesRepsError ||
                      !form.requesterGroup ||
                      (lockRequesterStep && salesRepsForDropdown.length <= 1)
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Sales Reps Code</label>
                  <input
                    type="text"
                    readOnly
                    title="Set by your requester selection; shown when a 5–10 digit SAP code applies."
                    className={WIZARD_READONLY_FIELD_CLASS}
                    value={
                      form.requesterId ? formatSalesRepCodeForPublicDisplay(form.salesRepCodeSap) : ''
                    }
                    placeholder="Select a requester"
                  />
                </div>
              </div>

              {/* Approval Hierarchy */}
              <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">Approval Hierarchy</h3>
                  {/* <SearchSelect
                    options={[
                      { value: 'flowchart', label: 'Vertical Flow Chart' },
                      { value: 'list', label: 'Compact List' },
                      { value: 'timeline', label: 'Timeline View' },
                      { value: 'badges', label: 'Badge Flow' }
                    ]}
                    value={approvalView}
                    onChange={(val) => setApprovalView(val as any)}
                    placeholder="Select view..."
                  /> */}
                </div>

                {/* Vertical Flow Chart View – use same hierarchy as list/timeline (ZNC: NSM, TM, NTSM, LFC, DCM) */}
                {approvalView === 'flowchart' && (() => {
                  const approvers = filterApprovalPreviewByAmount(buildApprovalHierarchy(subtotal), subtotal);
                  return (
                    <div className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                      <div className="flex flex-col space-y-3">
                        {approvers.map((approver, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && (
                              <div className="flex justify-center">
                                <svg className="w-6 h-6 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                </svg>
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#00A651] text-white flex items-center justify-center font-semibold text-sm">
                                {approver.num}
                              </div>
                              <div className="flex-1 bg-white border-2 border-gray-200 rounded-lg px-4 py-3 shadow-sm">
                                <div className="text-xs text-gray-500 font-medium">
                                  {approver.role} {approver.note && <span className="text-[#00A651]">{approver.note}</span>}
                                </div>
                                <div className="text-sm font-semibold text-gray-800">{approver.name}</div>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Compact List View */}
                {approvalView === 'list' && (() => {
                  const approvers = filterApprovalPreviewByAmount(buildApprovalHierarchy(subtotal), subtotal);
                  return (
                    <div className="bg-white border-2 border-gray-200 rounded-xl p-4 shadow-sm">
                      <div className="space-y-2">
                        {approvers.map((approver, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                            <svg className="w-5 h-5 text-[#00A651] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-gray-700">{approver.num}. {approver.role}:</span>
                                <span className="text-sm text-gray-900 font-medium truncate">{approver.name}</span>
                                {approver.note && <span className="text-xs text-[#00A651] font-medium">{approver.note}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Timeline View (Compact) */}
                {approvalView === 'timeline' && (() => {
                  const approvers = filterApprovalPreviewByAmount(buildApprovalHierarchy(subtotal), subtotal);
                  return (
                    <div className="bg-white border-2 border-gray-200 rounded-xl p-5 shadow-sm">
                      <div className="space-y-3 relative">
                        {/* Continuous Vertical Line */}
                        <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gray-200"></div>

                        {approvers.map((approver, idx) => (
                          <div key={idx} className="relative pl-8">
                            <div className="absolute left-0 top-2.5 w-5 h-5 rounded-full bg-[#00A651] border-2 border-white shadow-sm z-10 flex items-center justify-center">
                              <span className="text-[10px] text-white font-bold">{approver.num}</span>
                            </div>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 flex items-center justify-between hover:border-[#00A651] transition-all">
                              <div>
                                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                  {approver.role} {approver.note && <span className="text-[#00A651] normal-case ml-1">{approver.note}</span>}
                                </div>
                                <div className="text-sm font-semibold text-gray-800">{approver.name}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Badge Flow View */}
                {approvalView === 'badges' && (
                  <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      {/* 1. Sales Rep */}
                      <div className="flex items-center gap-2">
                        <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                          <span className="text-xs font-bold">0</span>
                          <div className="border-l border-white/30 pl-2">
                            <div className="text-xs font-semibold">Sales Rep</div>
                            <div className="text-xs opacity-90">{form.requesterName || 'Not selected'}</div>
                          </div>
                        </div>
                        <svg className="w-5 h-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>

                      {/* 2. Sales Manager */}
                      <div className="flex items-center gap-2">
                        <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                          <span className="text-xs font-bold">1</span>
                          <div className="border-l border-white/30 pl-2">
                            <div className="text-xs font-semibold">{salesManagerSlotRoleLabel(form.purpose, form.salesManager)}</div>
                            <div className="text-xs opacity-90">{form.salesManager || 'Not assigned'}</div>
                          </div>
                        </div>
                        <svg className="w-5 h-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>

                      {/* 3. District Sales Manager */}
                      <div className="flex items-center gap-2">
                        <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                          <span className="text-xs font-bold">2</span>
                          <div className="border-l border-white/30 pl-2">
                            <div className="text-xs font-semibold">District Sales Mgr</div>
                            <div className="text-xs opacity-90">{form.districtSalesManager || 'Not assigned'}</div>
                          </div>
                        </div>
                        {form.purpose === 'ZSAM' && (
                          <svg className="w-5 h-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        )}
                      </div>

                      {/* Conditional Approvers for ZSAM */}
                      {form.purpose === 'ZSAM' && (
                        <>
                          {/* 4. National Sales Manager */}
                          <div className="flex items-center gap-2">
                            <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                              <span className="text-xs font-bold">3</span>
                              <div className="border-l border-white/30 pl-2">
                                <div className="text-xs font-semibold">
                                  {nationalSalesManagerSlotRoleLabel(form.purpose, form.nationalSalesManager) ===
                                  'Marketing Manager'
                                    ? 'Marketing Mgr'
                                    : 'National Sales Mgr'}
                                </div>
                                <div className="text-xs opacity-90">{form.nationalSalesManager || 'Not assigned'}</div>
                              </div>
                            </div>
                            <svg className="w-5 h-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </div>

                          {/* 5. Local Finance Controller */}
                          <div className="flex items-center gap-2">
                            <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                              <span className="text-xs font-bold">4</span>
                              <div className="border-l border-white/30 pl-2">
                                <div className="text-xs font-semibold">Finance Controller</div>
                                <div className="text-xs opacity-90">{form.localFinanceController || 'Not assigned'}</div>
                              </div>
                            </div>
                            <svg className="w-5 h-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </div>

                          {/* 6. Director, Commercial Manager */}
                          <div className="flex items-center gap-2">
                            <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md flex items-center gap-2 hover:bg-[#008A44] transition-colors">
                              <span className="text-xs font-bold">5</span>
                              <div className="border-l border-white/30 pl-2">
                                <div className="text-xs font-semibold">Director, Comm. Mgr</div>
                                <div className="text-xs opacity-90">{form.directorCommercialManager || 'Not assigned'}</div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Legend for conditional approvers */}
                    {form.purpose === 'ZSAM' && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                          <svg className="w-4 h-4 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span>Steps 5-6 apply only if total amount exceeds {YEN_3M_DISPLAY}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>


            </section>
          )}

          {step === 2 && (
            <section className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Partner & Delivery Details</h3>
                {/* <SearchSelect
                  options={[
                    { value: 'cards', label: 'Card View (Default)' },
                    { value: 'accordion', label: 'Accordion View' },
                    { value: 'tabs', label: 'Tabbed Interface' },
                    { value: 'gradient', label: 'Gradient Headers' },
                    { value: 'timeline', label: 'Timeline View' }
                  ]}
                  value={partnerView}
                  onChange={(val) => setPartnerView(val as any)}
                  placeholder="Select view..."
                /> */}
              </div>

              {/* Option 1: Card View (Default) */}
              {partnerView === 'cards' && (
                <div className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* SOLD-TO Card */}
                    <div data-wizard-field="soldTo" className={fieldWrapClass('soldTo')}>
                    <div className="bg-white border-l-4 border-blue-500 rounded-xl shadow-sm p-5 border-2 border-gray-100 hover:shadow-md transition-all">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                        </div>
                        <h4 className="font-semibold text-gray-800">SOLD-TO (Channel Partner)</h4>
                      </div>
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-4">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            {zintSoldToCode} - {zintSoldToName}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="soldToAccountKind"
                                checked={soldToAccountKind === 'standard'}
                                onChange={() => {
                                  if (soldToAccountKind !== 'standard') {
                                    setSoldToAccountKind('standard')
                                    clearSoldToSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="soldToAccountKind"
                                    checked={soldToAccountKind === 'personal'}
                                    onChange={() => {
                                      if (soldToAccountKind !== 'personal') {
                                        setSoldToAccountKind('personal')
                                        clearSoldToSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`soldto-${soldToAccountKind}-${String(form.purpose)}`}
                            asyncOptions={soldToAccountAsyncOptions}
                            minSearchLength={soldToAccountKind === 'personal' ? 1 : 0}
                            value={form.soldToCode || null}
                            fallbackLabel={codeNameFallback(form.soldToCode, form.soldToName)}
                            onChange={handleSoldToChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : soldToAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select Sold-To...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                            labelClassName="text-base font-bold text-gray-900"
                          />
                        </>
                      )}
                    </div>
                    </div>

                    {/* End User Card */}
                    <div data-wizard-field="endUser" className={fieldWrapClass('endUser')}>
                    <div className="bg-white border-l-4 border-purple-500 rounded-xl shadow-sm p-5 border-2 border-gray-100 hover:shadow-md transition-all">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        </div>
                        <h4 className="font-semibold text-gray-800">End User</h4>
                      </div>
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            No end-user exist for internal orders.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="endUserAccountKind"
                                checked={endUserAccountKind === 'standard'}
                                onChange={() => {
                                  if (endUserAccountKind !== 'standard') {
                                    setEndUserAccountKind('standard')
                                    clearEndUserSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="endUserAccountKind"
                                    checked={endUserAccountKind === 'personal'}
                                    onChange={() => {
                                      if (endUserAccountKind !== 'personal') {
                                        setEndUserAccountKind('personal')
                                        clearEndUserSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`enduser-${endUserAccountKind}-${String(form.purpose)}`}
                            asyncOptions={endUserAccountAsyncOptions}
                            minSearchLength={endUserAccountKind === 'personal' ? 1 : 0}
                            value={form.endUserCode || null}
                            fallbackLabel={codeNameFallback(form.endUserCode, form.endUserName)}
                            onChange={handleEndUserChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : endUserAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select End User...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                            labelClassName="text-base font-bold text-gray-900"
                          />
                          {endUserCodeInvalid && (
                            <div className="text-xs mt-2 text-red-600 font-medium">Selected code must start with &apos;8&apos; (CRM) or &apos;9&apos; (personal)</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  </div>

                  {/* Delivery Card */}
                  <div className="bg-white border-l-4 border-orange-500 rounded-xl shadow-sm p-5 border-2 border-gray-100 hover:shadow-md transition-all">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <h4 className="font-semibold text-gray-800">Delivery / Ship-To</h4>
                    </div>

                    {renderDeliveryShipToFields()}
                  </div>
                </div>
              )}

              {/* Option 2: Accordion View */}
              {partnerView === 'accordion' && (
                <div className="space-y-4">
                  <div data-wizard-field="soldTo" className={fieldWrapClass('soldTo')}>
                  {/* SOLD-TO Accordion */}
                  <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 p-4 border-b border-gray-200 font-semibold text-gray-800 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">1</div>
                      SOLD-TO (Channel Partner)
                    </div>
                    <div className="p-4">
                      {isZintPurpose ? (
                        <p className="text-base font-bold text-gray-900 leading-snug">
                          {zintSoldToCode} - {zintSoldToName}
                        </p>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="soldToAccountKind"
                                checked={soldToAccountKind === 'standard'}
                                onChange={() => {
                                  if (soldToAccountKind !== 'standard') {
                                    setSoldToAccountKind('standard')
                                    clearSoldToSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="soldToAccountKind"
                                    checked={soldToAccountKind === 'personal'}
                                    onChange={() => {
                                      if (soldToAccountKind !== 'personal') {
                                        setSoldToAccountKind('personal')
                                        clearSoldToSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`soldto-${soldToAccountKind}-${String(form.purpose)}`}
                            asyncOptions={soldToAccountAsyncOptions}
                            minSearchLength={soldToAccountKind === 'personal' ? 1 : 0}
                            value={form.soldToCode || null}
                            fallbackLabel={codeNameFallback(form.soldToCode, form.soldToName)}
                            onChange={handleSoldToChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : soldToAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select Sold-To...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                          />
                        </>
                      )}
                    </div>
                  </div>
                  </div>

                  {/* End User Accordion */}
                  <div data-wizard-field="endUser" className={fieldWrapClass('endUser')}>
                  <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 p-4 border-b border-gray-200 font-semibold text-gray-800 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs">2</div>
                      End User
                    </div>
                    <div className="p-4">
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            No end-user exist for internal orders.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="endUserAccountKind"
                                checked={endUserAccountKind === 'standard'}
                                onChange={() => {
                                  if (endUserAccountKind !== 'standard') {
                                    setEndUserAccountKind('standard')
                                    clearEndUserSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="endUserAccountKind"
                                    checked={endUserAccountKind === 'personal'}
                                    onChange={() => {
                                      if (endUserAccountKind !== 'personal') {
                                        setEndUserAccountKind('personal')
                                        clearEndUserSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`enduser-${endUserAccountKind}-${String(form.purpose)}`}
                            asyncOptions={endUserAccountAsyncOptions}
                            minSearchLength={endUserAccountKind === 'personal' ? 1 : 0}
                            value={form.endUserCode || null}
                            fallbackLabel={codeNameFallback(form.endUserCode, form.endUserName)}
                            onChange={handleEndUserChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : endUserAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select End User...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                          />
                          {endUserCodeInvalid && (
                            <div className="text-xs mt-2 text-red-600">Selected code must start with &apos;8&apos; (CRM) or &apos;9&apos; (personal)</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  </div>

                  {/* Delivery Accordion */}
                  <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 p-4 border-b border-gray-200 font-semibold text-gray-800 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs">3</div>
                      Delivery / Ship-To
                    </div>
                    <div className="p-4">
                      {renderDeliveryShipToFields()}
                    </div>
                  </div>
                </div>
              )}

              {/* Option 3: Tabbed Interface */}
              {partnerView === 'tabs' && (
                <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex border-b-2 border-gray-200">
                    <div className="flex-1 p-4 text-center font-semibold text-blue-600 border-b-2 border-blue-600 bg-blue-50">SOLD-TO</div>
                    <div className="flex-1 p-4 text-center font-medium text-gray-500 hover:bg-gray-50">End User</div>
                    <div className="flex-1 p-4 text-center font-medium text-gray-500 hover:bg-gray-50">Delivery</div>
                  </div>
                  <div className="p-6">
                    <div data-wizard-field="soldTo" className={`mb-6 ${fieldWrapClass('soldTo')}`}>
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">SOLD-TO (Channel Partner)</label>
                      {isZintPurpose ? (
                        <p className="text-base font-bold text-gray-900 leading-snug">
                          {zintSoldToCode} - {zintSoldToName}
                        </p>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="soldToAccountKind"
                                checked={soldToAccountKind === 'standard'}
                                onChange={() => {
                                  if (soldToAccountKind !== 'standard') {
                                    setSoldToAccountKind('standard')
                                    clearSoldToSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="soldToAccountKind"
                                    checked={soldToAccountKind === 'personal'}
                                    onChange={() => {
                                      if (soldToAccountKind !== 'personal') {
                                        setSoldToAccountKind('personal')
                                        clearSoldToSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`soldto-${soldToAccountKind}-${String(form.purpose)}`}
                            asyncOptions={soldToAccountAsyncOptions}
                            minSearchLength={soldToAccountKind === 'personal' ? 1 : 0}
                            value={form.soldToCode || null}
                            fallbackLabel={codeNameFallback(form.soldToCode, form.soldToName)}
                            onChange={handleSoldToChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : soldToAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select Sold-To...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                          />
                        </>
                      )}
                    </div>
                    </div>
                    <div data-wizard-field="endUser" className={fieldWrapClass('endUser')}>
                    <div className="mb-6 pt-6 border-t">
                      <label className="block text-sm font-medium text-gray-700 mb-2">End User</label>
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            No end-user exist for internal orders.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="endUserAccountKind"
                                checked={endUserAccountKind === 'standard'}
                                onChange={() => {
                                  if (endUserAccountKind !== 'standard') {
                                    setEndUserAccountKind('standard')
                                    clearEndUserSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="endUserAccountKind"
                                    checked={endUserAccountKind === 'personal'}
                                    onChange={() => {
                                      if (endUserAccountKind !== 'personal') {
                                        setEndUserAccountKind('personal')
                                        clearEndUserSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`enduser-${endUserAccountKind}-${String(form.purpose)}`}
                            asyncOptions={endUserAccountAsyncOptions}
                            minSearchLength={endUserAccountKind === 'personal' ? 1 : 0}
                            value={form.endUserCode || null}
                            fallbackLabel={codeNameFallback(form.endUserCode, form.endUserName)}
                            onChange={handleEndUserChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : endUserAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select End User...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                          />
                          {endUserCodeInvalid && (
                            <div className="text-xs mt-2 text-red-600">Selected code must start with &apos;8&apos; (CRM) or &apos;9&apos; (personal)</div>
                          )}
                        </>
                      )}
                    </div>
                    </div>
                    <div className="pt-6 border-t">
                      <label className="block text-sm font-medium text-gray-700 mb-4">Delivery / Ship-To</label>
                      {renderDeliveryShipToFields()}
                    </div>
                  </div>
                </div>
              )}

              {/* Option 4: Gradient Headers */}
              {partnerView === 'gradient' && (
                <div className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div data-wizard-field="soldTo" className={fieldWrapClass('soldTo')}>
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
                      <div className="bg-gradient-to-r from-[#00A651] to-[#00C865] p-3 text-white font-semibold flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        SOLD-TO
                      </div>
                      <div className="p-4">
                        {isZintPurpose ? (
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            {zintSoldToCode} - {zintSoldToName}
                          </p>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name="soldToAccountKind"
                                  checked={soldToAccountKind === 'standard'}
                                  onChange={() => {
                                    if (soldToAccountKind !== 'standard') {
                                      setSoldToAccountKind('standard')
                                      clearSoldToSelectionForKindSwitch()
                                    }
                                  }}
                                  className="text-blue-600"
                                />
                                <span>Standard</span>
                              </label>
                              {isZsamPurpose && (
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="soldToAccountKind"
                                    checked={soldToAccountKind === 'personal'}
                                    onChange={() => {
                                      if (soldToAccountKind !== 'personal') {
                                        setSoldToAccountKind('personal')
                                        clearSoldToSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                              )}
                            </div>
                            <SearchSelect
                              key={`soldto-${soldToAccountKind}-${String(form.purpose)}`}
                              asyncOptions={soldToAccountAsyncOptions}
                              minSearchLength={soldToAccountKind === 'personal' ? 1 : 0}
                              value={form.soldToCode || null}
                              fallbackLabel={codeNameFallback(form.soldToCode, form.soldToName)}
                              onChange={handleSoldToChange}
                              placeholder={
                                !form.businessUnit
                                  ? 'Select Business Unit first'
                                  : soldToAccountKind === 'personal'
                                      ? 'Search by name or code...'
                                      : 'Select Sold-To...'
                              }
                              disabled={
                                !form.businessUnit
                              }
                            />
                          </>
                        )}
                      </div>
                    </div>
                    </div>

                    <div data-wizard-field="endUser" className={fieldWrapClass('endUser')}>
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
                      <div className="bg-gradient-to-r from-[#00A651] to-[#00C865] p-3 text-white font-semibold flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        End User
                      </div>
                      <div className="p-4">
                        {isZintPurpose ? (
                          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                            <p className="text-base font-bold text-gray-900 leading-snug">
                              No end-user exist for internal orders.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name="endUserAccountKind"
                                  checked={endUserAccountKind === 'standard'}
                                  onChange={() => {
                                    if (endUserAccountKind !== 'standard') {
                                      setEndUserAccountKind('standard')
                                      clearEndUserSelectionForKindSwitch()
                                    }
                                  }}
                                  className="text-blue-600"
                                />
                                <span>Standard</span>
                              </label>
                              {isZsamPurpose && (
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="endUserAccountKind"
                                    checked={endUserAccountKind === 'personal'}
                                    onChange={() => {
                                      if (endUserAccountKind !== 'personal') {
                                        setEndUserAccountKind('personal')
                                        clearEndUserSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                              )}
                            </div>
                            <SearchSelect
                              key={`enduser-${endUserAccountKind}-${String(form.purpose)}`}
                              asyncOptions={endUserAccountAsyncOptions}
                              minSearchLength={endUserAccountKind === 'personal' ? 1 : 0}
                              value={form.endUserCode || null}
                              fallbackLabel={codeNameFallback(form.endUserCode, form.endUserName)}
                              onChange={handleEndUserChange}
                              placeholder={
                                !form.businessUnit
                                  ? 'Select Business Unit first'
                                  : endUserAccountKind === 'personal'
                                      ? 'Search by name or code...'
                                      : 'Select End User...'
                              }
                              disabled={
                                !form.businessUnit
                              }
                            />
                            {endUserCodeInvalid && (
                              <div className="text-xs mt-2 text-red-600">Selected code must start with &apos;8&apos; (CRM) or &apos;9&apos; (personal)</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
                    <div className="bg-gradient-to-r from-[#00A651] to-[#00C865] p-3 text-white font-semibold flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Delivery / Ship-To
                    </div>
                    <div className="p-4">
                      {renderDeliveryShipToFields()}
                    </div>
                  </div>
                </div>
              )}

              {/* Option 5: Timeline View */}
              {partnerView === 'timeline' && (
                <div className="relative pl-8 border-l-2 border-gray-200 space-y-8">
                  <div data-wizard-field="soldTo" className={fieldWrapClass('soldTo')}>
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">1</div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="font-semibold text-gray-800 mb-3">Select SOLD-TO (Channel Partner)</h4>
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            {zintSoldToCode} - {zintSoldToName}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="soldToAccountKind"
                                checked={soldToAccountKind === 'standard'}
                                onChange={() => {
                                  if (soldToAccountKind !== 'standard') {
                                    setSoldToAccountKind('standard')
                                    clearSoldToSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="soldToAccountKind"
                                    checked={soldToAccountKind === 'personal'}
                                    onChange={() => {
                                      if (soldToAccountKind !== 'personal') {
                                        setSoldToAccountKind('personal')
                                        clearSoldToSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`soldto-${soldToAccountKind}-${String(form.purpose)}`}
                            asyncOptions={soldToAccountAsyncOptions}
                            minSearchLength={soldToAccountKind === 'personal' ? 1 : 0}
                            value={form.soldToCode || null}
                            fallbackLabel={codeNameFallback(form.soldToCode, form.soldToName)}
                            onChange={handleSoldToChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : soldToAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select Sold-To...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                            labelClassName="text-base font-bold text-gray-900"
                          />
                        </>
                      )}
                    </div>
                  </div>
                  </div>

                  <div data-wizard-field="endUser" className={fieldWrapClass('endUser')}>
                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">2</div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="font-semibold text-gray-800 mb-3">Select End User</h4>
                      {isZintPurpose ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                          <p className="text-base font-bold text-gray-900 leading-snug">
                            No end-user exist for internal orders.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="endUserAccountKind"
                                checked={endUserAccountKind === 'standard'}
                                onChange={() => {
                                  if (endUserAccountKind !== 'standard') {
                                    setEndUserAccountKind('standard')
                                    clearEndUserSelectionForKindSwitch()
                                  }
                                }}
                                className="text-blue-600"
                              />
                              <span>Standard</span>
                            </label>
                            {isZsamPurpose && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="endUserAccountKind"
                                    checked={endUserAccountKind === 'personal'}
                                    onChange={() => {
                                      if (endUserAccountKind !== 'personal') {
                                        setEndUserAccountKind('personal')
                                        clearEndUserSelectionForKindSwitch()
                                      }
                                    }}
                                    className="text-blue-600"
                                  />
                                  <span>Personal</span>
                                </label>
                            )}
                          </div>
                          <SearchSelect
                            key={`enduser-${endUserAccountKind}-${String(form.purpose)}`}
                            asyncOptions={endUserAccountAsyncOptions}
                            minSearchLength={endUserAccountKind === 'personal' ? 1 : 0}
                            value={form.endUserCode || null}
                            fallbackLabel={codeNameFallback(form.endUserCode, form.endUserName)}
                            onChange={handleEndUserChange}
                            placeholder={
                              !form.businessUnit
                                ? 'Select Business Unit first'
                                : endUserAccountKind === 'personal'
                                    ? 'Search by name or code...'
                                    : 'Select End User...'
                            }
                            disabled={
                              !form.businessUnit
                            }
                            labelClassName="text-base font-bold text-gray-900"
                          />
                          {endUserCodeInvalid && (
                            <div className="text-xs mt-2 text-red-600 font-medium">Selected code must start with &apos;8&apos; (CRM) or &apos;9&apos; (personal)</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  </div>

                  <div className="relative">
                    <div className="absolute -left-[41px] top-0 w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold border-4 border-white shadow-sm">3</div>
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="font-semibold text-gray-800 mb-3">Delivery / Ship-To</h4>
                      {renderDeliveryShipToFields()}
                      <div data-wizard-field="deliveryDate" className={`mt-4 ${fieldWrapClass('deliveryDate')}`}>
                        <h4 className="font-semibold text-gray-800 mb-3">Delivery Date</h4>
                        <div className="flex flex-wrap items-end gap-4">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="deliveryDateChoice"
                              className="mt-1.5 shrink-0"
                              checked={form.expectedDeliveryDate === 'ASAP'}
                              onChange={() => setForm(f => ({ ...f, expectedDeliveryDate: 'ASAP' }))}
                            />
                            <span className="text-sm font-semibold text-gray-900 leading-snug pt-0.5">ASAP</span>
                          </label>
                          <label className="flex items-start gap-2 cursor-pointer max-w-md">
                            <input
                              type="radio"
                              name="deliveryDateChoice"
                              className="mt-1.5 shrink-0"
                              checked={form.expectedDeliveryDate !== 'ASAP'}
                              onChange={() => setForm(f => ({ ...f, expectedDeliveryDate: f.expectedDeliveryDate === 'ASAP' ? '' : f.expectedDeliveryDate }))}
                            />
                            <BilingualFieldCaption labelKey="wizard.bilingual.specificDate" compact className="min-w-0" />
                          </label>
                          {form.expectedDeliveryDate !== 'ASAP' && (
                            <input
                              type="date"
                              min={new Date().toISOString().slice(0, 10)}
                              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-transparent"
                              value={form.expectedDeliveryDate && form.expectedDeliveryDate !== 'ASAP' ? String(form.expectedDeliveryDate).substring(0, 10) : ''}
                              onChange={(e) => setForm(f => ({ ...f, expectedDeliveryDate: e.target.value }))}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Attention to (optional) - recipient name for sample shipment, after Delivery / Ship-To */}
              <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <label className="block mb-2">
                  <BilingualFieldCaption labelKey="wizard.bilingual.attention" />
                </label>
                <input
                  type="text"
                  className="border border-gray-300 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-transparent"
                  placeholder="Recipient name for sample shipment"
                  value={form.attentionTo || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, attentionTo: v === '' ? undefined : v }));
                  }}
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    setForm((f) => ({ ...f, attentionTo: t === '' ? undefined : t }));
                  }}
                />
              </div>

              <div data-wizard-field="products" className={fieldWrapClass('products')}>
              <div className="flex items-center justify-between mt-6">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-800">Products</h3>
                </div>
                <div className="flex items-center gap-3">
                  {/* <SearchSelect
                    options={[
                      { value: 'table', label: 'Enhanced Table' },
                      { value: 'cards', label: 'Card-Based Rows' },
                      { value: 'compact', label: 'Compact List' },
                      { value: 'grid', label: 'Grid Layout' },
                      { value: 'accordion', label: 'Accordion View' }
                    ]}
                    value={productView}
                    onChange={(val) => setProductView(val as any)}
                    placeholder="Select view..."
                  /> */}
                  <button
                    className="px-4 py-2 border-2 border-[#00A651] text-[#00A651] rounded-lg font-medium hover:bg-[#00A651] hover:text-white transition-all duration-200 shadow-sm hover:shadow btn-press"
                    onClick={() => setForm(f => ({
                      ...f, products: [...f.products, {
                        id: crypto.randomUUID(), productCode: '', sapCode: '', productName: '', quantity: 1, unitPrice: 0, wholesalePrice: 0, subTotal: 0, lotNumber: ''
                      }]
                    }))}
                  >+ Add Product</button>
                </div>
              </div>



              {/* Option 3: Compact List */}
              {productView === 'compact' && (
                <div className="bg-white border-2 border-gray-200 rounded-xl shadow-sm divide-y divide-gray-200">
                  {form.products.map((p, idx) => (
                    <div key={p.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 w-8 h-8 bg-[#00A651] text-white rounded-full flex items-center justify-center font-bold text-sm">
                          {idx + 1}
                        </div>
                        <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-3">
                            <SearchSelect
                              asyncOptions={{
                                initialLoad: loadProductsInitial,
                                load: loadProductsSearch,
                                loadMore: loadProductsMore
                              }}
                              value={p.productCode}
                              onChange={(val) => onChangeProduct(idx, val as string)}
                              /*
                               * What is selected, while the catalogue page holding it loads -
                               * and on a clone it may never load, since the picker fetches only
                               * the first page and searches on demand.
                               *
                               * Vidhi Parsons, 9 Sep: "for products, looks like not selected
                               * anything and looks blank. Could we change like other fields not
                               * looks like blank now." Every other picker on this page already
                               * passed a fallback; this one did not, so a cloned request showed
                               * "Select product..." over a row that plainly had a product in it.
                               */
                              // The name alone: the codes are on the code line under the name.
                              fallbackLabel={p.productName || p.productCode || undefined}
                              hideSelectedSub
                              placeholder={
                                form.businessUnit 
                                  ? 'Select product...' 
                                  : 'Select Business Unit first'
                              }
                              disabled={!form.businessUnit}
                            />
                          </div>
                          {/* The name, then its codes side by side directly beneath it - they used to sit
                              in a column of their own, SAP over the local code, apart from the name. */}
                          <div className="col-span-4 min-w-0">
                            <div className="text-sm font-medium text-gray-800 truncate" title={p.productName}>
                              {p.productName || '-'}
                            </div>
                            {(() => {
                              // The local name, unless it only repeats the name above it.
                              const local = productCatalog.find(pr => String(pr.code) === String(p.productCode))?.productNameLocal || ''
                              return local && local.trim() !== String(p.productName ?? '').trim() ? (
                                <div className="text-xs text-gray-600 truncate" title={local}>{local}</div>
                              ) : null
                            })()}
                            {p.productCode ? <ProductCodeLine product={p} unit={form.businessUnit} /> : null}
                            {unavailableLineMessage(p.productCode) && (
                              <div className="text-xs font-medium text-red-700 mt-0.5">{unavailableLineMessage(p.productCode)}</div>
                            )}
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">Batch / lot #</label>
                            <input
                              type="text"
                              className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
                              placeholder="Optional"
                              value={p.lotNumber ?? ''}
                              onChange={(e) => update(idx, { lotNumber: e.target.value })}
                            />
                          </div>
                          <div className="col-span-1">
                            <label className="block text-[10px] font-semibold text-gray-700 uppercase tracking-wide mb-0.5">Qty</label>
                            {/* Same box as the return wizard: it must not blank under the cursor. */}
                            <QuantityInput
                              value={p.quantity}
                              onChange={(quantity) => update(idx, { quantity })}
                              onSnapBack={() => update(idx, { quantity: 1 })}
                            />
                          </div>
                          <div className="col-span-1 text-right text-sm font-semibold text-[#00A651]">
                            ¥{((p.wholesalePrice ?? p.unitPrice) * p.quantity).toLocaleString()}
                          </div>
                          <div className="col-span-1 text-right">
                            <button className="text-red-500 hover:text-red-700 p-1" onClick={() => removeRow(idx)}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              </div>

              <div className="text-right font-medium">Total Amount: ¥{subtotal.toLocaleString()}</div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-6">
              <div className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-800">Summary</h3>
                  </div>
                  {/* <SearchSelect
                    options={[
                      { value: 'cards', label: 'Card View (Current)' },
                      { value: 'badges', label: 'Badge Flow' },
                      { value: 'accordion', label: 'Compact Accordion' },
                      { value: 'grid', label: 'Icon Grid' },
                      { value: 'timeline', label: 'Timeline View' }
                    ]}
                    value={summaryView}
                    onChange={(val) => setSummaryView(val as any)}
                    placeholder="Select view..."
                  /> */}
                </div>

                {/* Option 1: Card View (Current - Enhanced) */}
                {summaryView === 'cards' && (
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Left Column */}
                    <div className="space-y-3">
                      <div className="bg-white rounded-lg p-3 border-l-4 border-[#00A651]">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Type</div>
                        <div className="text-sm font-semibold text-gray-800 mt-1">{getRequestTypeLabel(form.purpose || form.formType)}</div>
                      </div>


                      <div className="bg-white rounded-lg p-3 border-l-4 border-[#00A651]">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Requester</div>
                        <div className="text-sm font-semibold text-gray-800 mt-1">
                          {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                        </div>
                      </div>
                    </div>

                    {/* Right Column */}
                    <div className="space-y-3">
                      <div className="bg-white rounded-lg p-3 border-l-4 border-blue-500">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">SOLD-TO (Channel Partner)</div>
                        {isZintPurpose ? (
                          <div className="text-lg sm:text-xl font-bold text-gray-900 mt-1 leading-snug">
                            {zintSoldToCode} - {zintSoldToName}
                          </div>
                        ) : (
                          <>
                            <div className="text-sm font-semibold text-gray-800 mt-1">{form.soldToName}</div>
                            <div className="text-xs text-gray-600 mt-1">Code: {form.soldToCode}</div>
                          </>
                        )}
                      </div>

                      <div className="bg-white rounded-lg p-3 border-l-4 border-purple-500">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">End User</div>
                        {isZintPurpose ? (
                          <div className="text-sm text-gray-600 mt-1">No end-user exist for internal orders.</div>
                        ) : (
                          <>
                            <div className="text-sm font-semibold text-gray-800 mt-1">{form.endUserName}</div>
                            <div className="text-xs text-gray-600 mt-1">Code: {form.endUserCode}</div>
                          </>
                        )}
                      </div>

                      <div className="bg-white rounded-lg p-3 border-l-4 border-orange-500">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Delivery / Ship-To</div>
                        {isZintPurpose ? (
                          <div className="text-sm font-bold text-gray-900 mt-1">Ship-To: {formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                        ) : (
                          <>
                            <div className="text-sm font-semibold text-gray-800 mt-1">{formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                            {formatShipToDisplayCode(form.shipToCode) && (
                              <div className="text-xs text-gray-600 mt-1">Code: {formatShipToDisplayCode(form.shipToCode)}</div>
                            )}
                          </>
                        )}
                      </div>
                      {form.attentionTo && (
                        <div className="bg-white rounded-lg p-3 border-l-4 border-teal-500">
                          <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="mb-1" />
                          <div className="text-sm font-semibold text-gray-800 mt-1">{form.attentionTo}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Option 2: Badge Flow */}
                {summaryView === 'badges' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md">
                      <div className="text-xs opacity-75">Type</div>
                      <div className="text-sm font-semibold">{getRequestTypeLabel(form.purpose || form.formType)}</div>
                    </div>

                    <svg className="w-4 h-4 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <div className="bg-[#00A651] text-white px-4 py-2 rounded-full shadow-md">
                      <div className="text-xs opacity-75">Requester</div>
                      <div className="text-sm font-semibold">
                        {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <div className="bg-blue-500 text-white px-4 py-2 rounded-full shadow-md">
                      <div className="text-xs opacity-75">SOLD-TO</div>
                      <div className={`font-semibold ${isZintPurpose ? 'text-base' : 'text-sm'}`}>
                        {isZintPurpose ? `${zintSoldToCode} - ${zintSoldToName}` : form.soldToName}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <div className="bg-purple-500 text-white px-4 py-2 rounded-full shadow-md">
                      <div className="text-xs opacity-75">End User</div>
                      <div className="text-sm font-semibold">{isZintPurpose ? 'No end-user exist for internal orders.' : form.endUserName}</div>
                    </div>
                    <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <div className="bg-orange-500 text-white px-4 py-2 rounded-full shadow-md">
                      <div className="text-xs opacity-75">SHIP-TO</div>
                      <div className="text-sm font-semibold">{isZintPurpose ? `Ship-To: ${formatShipToDisplayName(form.shipToName, form.shipToCode)}` : formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                    </div>
                    {form.attentionTo && (
                      <>
                        <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <div className="bg-teal-500 text-white px-4 py-2 rounded-full shadow-md max-w-xs">
                          <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact tone="onColor" className="mb-0.5" />
                          <div className="text-sm font-semibold">{form.attentionTo}</div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Option 3: Compact Accordion */}
                {summaryView === 'accordion' && (
                  <div className="space-y-2">
                    <div className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700">Type:</span>
                          <span className="text-sm text-gray-900">{getRequestTypeLabel(form.purpose || form.formType)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700">Requester:</span>
                          <span className="text-sm text-gray-900">
                            {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-white rounded-lg border-2 border-blue-200 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-blue-50">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold text-gray-700">SOLD-TO:</span>
                          {isZintPurpose ? (
                            <span className="text-base font-bold text-gray-900">{zintSoldToCode} - {zintSoldToName}</span>
                          ) : (
                            <span className="text-sm text-gray-900">{form.soldToName} ({form.soldToCode})</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="bg-white rounded-lg border-2 border-purple-200 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-purple-50">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700">End User:</span>
                          <span className="text-sm text-gray-900">{isZintPurpose ? 'No end-user exist for internal orders.' : `${form.endUserName} (${form.endUserCode})`}</span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-white rounded-lg border-2 border-orange-200 overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-orange-50">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-700">Delivery / SHIP-TO:</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {isZintPurpose ? `Ship-To: ${formatShipToDisplayName(form.shipToName, form.shipToCode)}` : formatShipToLabel(form.shipToName, form.shipToCode)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {form.attentionTo && (
                      <div className="bg-white rounded-lg border-2 border-teal-200 overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-teal-50">
                          <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="shrink-0" />
                          <span className="text-sm font-semibold text-gray-900">{form.attentionTo}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Option 4: Icon Grid */}
                {summaryView === 'grid' && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl p-4 border-2 border-gray-200 hover:border-[#00A651] transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-[#00A651] bg-opacity-10 flex items-center justify-center">
                          <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-xs text-gray-500 font-medium uppercase">Type</div>
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{getRequestTypeLabel(form.purpose || form.formType)}</div>
                    </div>


                    <div className="bg-white rounded-xl p-4 border-2 border-gray-200 hover:border-[#00A651] transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-[#00A651] bg-opacity-10 flex items-center justify-center">
                          <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-xs text-gray-500 font-medium uppercase">Requester</div>
                      </div>
                      <div className="text-sm font-semibold text-gray-900">
                        {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-4 border-2 border-blue-200 hover:border-blue-500 transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-xs text-gray-500 font-medium uppercase">SOLD-TO (Channel Partner)</div>
                      </div>
                      {isZintPurpose ? (
                        <div className="text-lg font-bold text-gray-900 leading-snug">
                          {zintSoldToCode} - {zintSoldToName}
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold text-gray-900">{form.soldToName}</div>
                          <div className="text-xs text-gray-600 mt-1">{form.soldToCode}</div>
                        </>
                      )}
                    </div>

                    <div className="bg-white rounded-xl p-4 border-2 border-purple-200 hover:border-purple-500 transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                          </svg>
                        </div>
                        <div className="text-xs text-gray-500 font-medium uppercase">End User</div>
                      </div>
                      {isZintPurpose ? (
                        <div className="text-sm text-gray-600">No end-user exist for internal orders.</div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold text-gray-900">{form.endUserName}</div>
                          <div className="text-xs text-gray-600 mt-1">{form.endUserCode}</div>
                        </>
                      )}
                    </div>

                    <div className="bg-white rounded-xl p-4 border-2 border-orange-200 hover:border-orange-500 transition-colors">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="text-xs text-gray-500 font-medium uppercase">Delivery / Ship-To</div>
                      </div>
                      {isZintPurpose ? (
                        <div className="text-sm font-bold text-gray-900">Ship-To: {formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold text-gray-900">{formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                          {formatShipToDisplayCode(form.shipToCode) && (
                            <div className="text-xs text-gray-600 mt-1">{formatShipToDisplayCode(form.shipToCode)}</div>
                          )}
                        </>
                      )}
                    </div>
                    {form.attentionTo && (
                      <div className="bg-white rounded-xl p-4 border-2 border-teal-200 hover:border-teal-500 transition-colors">
                        <div className="flex items-start gap-3 mb-2">
                          <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                            </svg>
                          </div>
                          <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="min-w-0" />
                        </div>
                        <div className="text-sm font-semibold text-gray-900">{form.attentionTo}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Option 5: Timeline View */}
                {summaryView === 'timeline' && (
                  <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-300"></div>
                    <div className="space-y-4">
                      <div className="relative flex items-start gap-4">
                        <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-[#00A651] border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                          1
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-[#00A651]">
                          <div className="text-xs text-gray-500 font-medium uppercase">Type</div>
                          <div className="text-sm font-semibold text-gray-900 mt-1">{getRequestTypeLabel(form.purpose || form.formType)}</div>
                        </div>
                      </div>


                      <div className="relative flex items-start gap-4">
                        <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-[#00A651] border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                          2
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-[#00A651]">
                          <div className="text-xs text-gray-500 font-medium uppercase">Requester</div>
                          <div className="text-sm font-semibold text-gray-900 mt-1">
                            {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                          </div>
                        </div>
                      </div>

                      <div className="relative flex items-start gap-4">
                        <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                          3
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-blue-500">
                          <div className="text-xs text-gray-500 font-medium uppercase">SOLD-TO (Channel Partner)</div>
                          {isZintPurpose ? (
                            <div className="text-lg font-bold text-gray-900 mt-1 leading-snug">
                              {zintSoldToCode} - {zintSoldToName}
                            </div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{form.soldToName}</div>
                              <div className="text-xs text-gray-600 mt-1">Code: {form.soldToCode}</div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="relative flex items-start gap-4">
                        <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-purple-500 border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                          4
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-purple-500">
                          <div className="text-xs text-gray-500 font-medium uppercase">End User</div>
                          {isZintPurpose ? (
                            <div className="text-sm text-gray-600 mt-1">No end-user exist for internal orders.</div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{form.endUserName}</div>
                              <div className="text-xs text-gray-600 mt-1">Code: {form.endUserCode}</div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="relative flex items-start gap-4">
                        <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-orange-500 border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                          5
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-orange-500">
                          <div className="text-xs text-gray-500 font-medium uppercase">Delivery / Ship-To</div>
                          {isZintPurpose ? (
                            <div className="text-sm font-bold text-gray-900 mt-1">Ship-To: {formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-gray-900 mt-1">{formatShipToDisplayName(form.shipToName, form.shipToCode)}</div>
                              {formatShipToDisplayCode(form.shipToCode) && (
                                <div className="text-xs text-gray-600 mt-1">Code: {formatShipToDisplayCode(form.shipToCode)}</div>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {form.attentionTo && (
                        <div className="relative flex items-start gap-4">
                          <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-teal-500 border-4 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                            6
                          </div>
                          <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-teal-500">
                            <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="mb-1" />
                            <div className="text-sm font-semibold text-gray-900 mt-1">{form.attentionTo}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>



              <div className="mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-800">Products ({form.products.length})</h3>
                </div>
                <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 font-semibold border-b-2 border-gray-200">
                      <tr>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3 font-bold text-gray-800">Batch / lot</th>
                        <th className="px-4 py-3 text-right font-bold text-gray-800">Qty</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {form.products.map((p, idx) => (
                        <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                          <td className="px-4 py-3 text-gray-800">
                            <div>{p.productName}</div>
                            <ProductCodeLine product={p} unit={form.businessUnit} />
                          </td>
                          <td className="px-4 py-3 text-gray-700">{p.lotNumber?.trim() || '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-700">{p.quantity}</td>
                          <td className="px-4 py-3 text-right text-gray-700">¥{(p.wholesalePrice ?? p.unitPrice).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">¥{p.subTotal.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              

              {/* Total Amount */}
              <div className="bg-gradient-to-r from-[#00A651] to-[#00B85C] text-white rounded-xl p-4 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">Total Amount:</span>
                  <span className="text-2xl font-bold">¥{subtotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Comment Field */}
              <div data-wizard-field="freeSampleComment" className={fieldWrapClass('freeSampleComment')}>
                <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                  <div className="flex items-start gap-2 mb-3">
                    <svg className="w-5 h-5 text-[#00A651] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0 flex-1 flex items-start gap-1.5">
                      <label className="block min-w-0 flex-1" htmlFor="wizard-free-sample-justification">
                        <BilingualFieldCaption labelKey="wizard.bilingual.freeSample" />
                      </label>
                      <span
                        className="text-red-600 font-bold text-lg leading-none shrink-0 mt-0.5"
                        title="Required"
                        aria-hidden="true"
                      >
                        *
                      </span>
                    </div>
                  </div>
                  <textarea
                    id="wizard-free-sample-justification"
                    className="border-2 border-gray-300 rounded-lg px-4 py-3 w-full h-32 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-opacity-50 focus:border-[#00A651] transition-all resize-none"
                    value={form.freeDescription || ''}
                    onChange={(e) => setForm(f => ({ ...f, freeDescription: e.target.value }))}
                    placeholder="Enter justification for free sample request..."
                    aria-required="true"
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    {form.freeDescription?.length || 0} characters
                  </div>
                </div>
              </div>

              {form.purpose === 'ZNCCLAIM' && (
                <ZncClaimAttachmentUpload
                  formId={form.backendDraftId}
                  disabled={isSubmitting}
                  onNeedDraft={async () => {
                    const formData = {
                      formType: form.formType || form.purpose,
                      requestDate: new Date().toISOString(),
                      businessUnit: form.businessUnit,
                      requesterGroup: form.requesterGroup,
                      requesterName: form.requesterName,
                      salesRepCodeSap: form.requesterId
                        ? hasDisplayableSalesRepCode(form.salesRepCodeSap)
                          ? String(form.salesRepCodeSap).trim()
                          : ''
                        : form.salesRepCodeSap,
                      purpose: form.purpose,
                      expectedDeliveryDate: form.expectedDeliveryDate,
                      deliveryMode: form.deliveryMode,
                      soldToCode: form.soldToCode,
                      soldToName: form.soldToName,
                      shipToCode: form.shipToCode,
                      shipToName: form.shipToName,
                      attentionTo: form.attentionTo,
                      endUserCode: form.endUserCode,
                      endUserName: form.endUserName,
                      address: form.address,
                      salesManager: form.salesManager,
                      districtSalesManager: form.districtSalesManager,
                      nationalSalesManager: form.nationalSalesManager,
                      localFinanceController: form.localFinanceController,
                      directorCommercialManager: form.directorCommercialManager,
                      commentsForApproval: form.commentsForApproval,
                      freeDescription: String(form.freeDescription || '').trim() || 'Draft',
                      products: form.products.map(p => ({
                        productCode: p.productCode,
                        productName: p.productName,
                        sapCode: p.sapCode,
                        quantity: p.quantity,
                        unitPrice: p.unitPrice,
                        wholesalePrice: p.wholesalePrice,
                        isConsumable: p.isConsumable ?? false,
                        lotNumber: p.lotNumber?.trim() || undefined,
                        note: p.note,
                      })),
                    }
                    try {
                      if (form.backendDraftId) {
                        await apiClient.put(`/forms/${form.backendDraftId}`, formData)
                        return form.backendDraftId
                      }
                      const createResponse = await apiClient.post('/forms', formData)
                      const createdId = createResponse.data?.form?.id as string | undefined
                      if (createdId) {
                        setForm(f => ({ ...f, backendDraftId: createdId }))
                      }
                      return createdId ?? null
                    } catch {
                      return null
                    }
                  }}
                />
              )}

              {/* Approval Hierarchy Summary */}
              <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-800">Approval Flow</h3>
                </div>
                <div className="space-y-2">
                  {(() => {
                    const approvers = filterApprovalPreviewByAmount(buildApprovalHierarchy(subtotal), subtotal);
                    return approvers.map((approver, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border-l-4 border-[#00A651]">
                        <span className="text-sm font-medium text-gray-600">
                          {approver.num}. {approver.role}
                          {approver.note ? <span className="text-[#00A651] font-normal"> {approver.note}</span> : null}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">{approver.name}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Additional Comments for Approval */}
             {/*  <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-[#00A651]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <label className="text-base font-semibold text-gray-800">Comments for Approval</label>
                </div>
                <textarea
                  className="border-2 border-gray-300 rounded-lg px-4 py-3 w-full h-24 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-opacity-50 focus:border-[#00A651] transition-all resize-none"
                  value={form.commentsForApproval || ''}
                  onChange={(e) => setForm(f => ({ ...f, commentsForApproval: e.target.value }))}
                  placeholder="Add any additional comments for approvers..."
                />
              </div> */}
            </section>
          )}

          <div className="mt-6 sticky bottom-0 bg-gray-50 py-4 border-t flex justify-between z-10">
            <button className="px-5 py-2.5 border-2 border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed btn-press" disabled={step === 1} onClick={() => setStep(s => Math.max(1, s - 1))}>{t('common.back')}</button>
            <div className="flex gap-3">
              {step < 3 ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); handleNextOrSubmitClick(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNextOrSubmitClick(); } }}
                  className="inline-block"
                >
                  <button type="button" className="px-6 py-2.5 text-white rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm btn-press" style={{ backgroundColor: '#00A651' }} onMouseEnter={(e) => canNext && (e.currentTarget.style.backgroundColor = '#008A44')} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#00A651')} disabled={!canNext}>{t('common.next')}</button>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); handleNextOrSubmitClick(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNextOrSubmitClick(); } }}
                  className="inline-block"
                >
                  <button type="button" className="px-6 py-2.5 text-white rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm btn-press" style={{ backgroundColor: '#00A651' }} onMouseEnter={(e) => canNext && (e.currentTarget.style.backgroundColor = '#008A44')} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#00A651')} disabled={!canNext}>Submit</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div >
  )

  function update(index: number, patch: Partial<typeof form.products[number]>) {
    setForm(f => {
      const copy = [...f.products]
      copy[index] = { ...copy[index], ...patch }
      const price = (copy[index].wholesalePrice ?? copy[index].unitPrice)
      copy[index].subTotal = copy[index].quantity * price
      return { ...f, products: copy }
    })
  }

  function loadSample() {
    const sample = {
      businessUnit: 'CDG',
      requesterName: 'Mauricegeorgina Keevers',
      purpose: 'ZNC' as const,
      requestDate: '2025-11-14',
      naPcdIndicator: 'NA',
      salesRepCodeSap: '912345',
      approvers: {
        firstApprover: 'Sales Manager',
        secondApprover: 'District Sales Manager',
        presidentApproval: false,
        presidentApprovalName: '',
        salesManagerOrMktManager: 'Sales Manager',
        serviceManagerOrRAQA: 'RAQA Manager',
        financeManagerApproval: 'Finance Controller',
      }
    }
    const rep = fetchedSalesReps.find(r => r.name === sample.requesterName)
    onChangePurpose(sample.purpose)
    setForm(f => ({
      ...f,
      businessUnit: sample.businessUnit as any,
      requesterId: rep?.id || f.requesterId,
      requesterName: rep?.name || sample.requesterName,
      requestDate: sample.requestDate,
      naPcdIndicator: sample.naPcdIndicator,
      salesRepCodeSap: sample.salesRepCodeSap,
      firstApprover: sample.approvers.firstApprover,
      secondApprover: sample.approvers.secondApprover,
      presidentApproval: sample.approvers.presidentApproval,
      presidentApprovalName: sample.approvers.presidentApprovalName,
      salesManagerOrMktManager: sample.approvers.salesManagerOrMktManager,
      serviceManagerOrRAQA: sample.approvers.serviceManagerOrRAQA,
      financeManagerApproval: sample.approvers.financeManagerApproval,
    }))
  }

  function removeRow(index: number) {
    setForm(f => ({ ...f, products: f.products.filter((_, i) => i !== index) }))
  }

  async function onChangeProduct(index: number, code: string, product?: Product) {
    // Use provided product or try to fetch from catalog/API
    let prod: Product | undefined = product ?? productCatalog.find(p => String(p.code) === String(code))
    if (!prod && form.businessUnit) {
      try {
        const fetchedProduct = await staticDataApi.getProductExact(form.businessUnit, String(code))
        if (fetchedProduct) {
          prod = fetchedProduct
          setProductCatalog(prev => {
            const existing = prev.find(p => String(p.code) === String(fetchedProduct.code))
            if (existing) return prev
            return [...prev, fetchedProduct]
          })
        }
      } catch (error) {
        console.error('Failed to fetch product details:', error)
      }
    }
    // Reset downstream fields in the row, then hydrate with selected product details
    const current = form.products[index]
    const cleared = resetProductRowDownstream({
      ...current,
      productCode: code,
    })
    update(index, {
      productCode: code,
      sapCode: prod?.sapCode ?? cleared.sapCode,
      productName: prod?.name || cleared.productName,
      unitPrice: prod?.price || cleared.unitPrice,
      wholesalePrice: prod?.price || cleared.wholesalePrice,
      subTotal: cleared.subTotal,
    })
  }

  function onCancel() {
    // reset to empty
    setForm(f => ({ ...f, products: [], status: 'DRAFT' }))
    setStep(1)
  }

  async function onSubmit() {
    if (hasUnavailableLine) {
      // A line from a clone or draft whose product was removed from the master: back to the products.
      setStep(2)
      setHighlightMissingFields(true)
      scrollToField('products')
      return
    }
    if (!String(form.freeDescription || '').trim()) {
      setHighlightMissingFields(true)
      scrollToField('freeSampleComment')
      return
    }
    setIsSubmitting(true);
    try {
      // Prepare form data
      const formData = {
        formType: form.formType || form.purpose,
        requestDate: new Date().toISOString(),
        businessUnit: form.businessUnit,
        requesterGroup: form.requesterGroup,
        requesterName: form.requesterName, // Add requester name
        salesRepCodeSap: form.requesterId
          ? hasDisplayableSalesRepCode(form.salesRepCodeSap)
            ? String(form.salesRepCodeSap).trim()
            : ''
          : form.salesRepCodeSap,
        purpose: form.purpose,
        expectedDeliveryDate: form.expectedDeliveryDate,
        deliveryMode: form.deliveryMode,
        soldToCode: form.soldToCode,
        soldToName: form.soldToName,
        shipToCode: form.shipToCode,
        shipToName: form.shipToName,
        attentionTo: form.attentionTo,
        endUserCode: form.endUserCode,
        endUserName: form.endUserName,
        address: form.address,
        salesManager: form.salesManager,
        districtSalesManager: form.districtSalesManager,
        nationalSalesManager: form.nationalSalesManager,
        localFinanceController: form.localFinanceController,
        directorCommercialManager: form.directorCommercialManager,
        commentsForApproval: form.commentsForApproval, // Add comments
        freeDescription: String(form.freeDescription || '').trim(),
        products: form.products.map(p => ({
          productCode: p.productCode,
          productName: p.productName,
          sapCode: p.sapCode,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          wholesalePrice: p.wholesalePrice,
          isConsumable: p.isConsumable ?? false,
          lotNumber: p.lotNumber?.trim() || undefined,
          note: p.note
        }))
      };

      // Log what we're sending
      console.log('📤 Submitting form data:', formData);
      console.log('📊 Form summary:', {
        requester: formData.requesterName,
        businessUnit: formData.businessUnit,
        purpose: formData.purpose,
        products: formData.products.length,
        totalAmount: form.products.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0),
        approvers: {
          salesManager: formData.salesManager || '❌ Missing',
          districtSalesManager: formData.districtSalesManager || '❌ Missing',
          nationalSalesManager: formData.nationalSalesManager || '❌ Missing'
        },
        comments: {
          commentsForApproval: formData.commentsForApproval || '❌ Not filled',
          freeDescription: formData.freeDescription || '❌ Not filled'
        }
      });

      const draftId = form.backendDraftId

      let submitFormId: string
      if (draftId) {
        await apiClient.put(`/forms/${draftId}`, formData)
        submitFormId = draftId
        console.log('✅ Server draft updated:', draftId)
      } else {
        const createResponse = await apiClient.post('/forms', formData)
        if (!createResponse.data) {
          console.error('❌ Create form failed: No data returned')
          throw new Error('Failed to create form')
        }
        const { form: createdForm } = createResponse.data
        submitFormId = createdForm.id
        console.log('✅ Form created:', createdForm.id)
      }

      const submitResponse = await apiClient.post(`/forms/${submitFormId}/submit`, {}, { timeout: 30000 })

      if (!submitResponse.data) {
        console.error('❌ Submit form failed: No data returned');
        throw new Error('Failed to submit form');
      }

      const submitData = submitResponse.data;
      console.log('✅ Form submitted successfully!', submitData);
      console.log('📧 Email sent to first approver');

      // Success! Email has been sent to first approver
      const referenceNumber = submitData.form?.referenceNumber;
      // Clears `:last` too. Removing only the per-id key is why a submitted request used to come
      // back the next time /new was opened.
      clearDraft(SAMPLE_DRAFT_PREFIX);
      navigate('/success', {
        state: {
          referenceNumber,
          formType: form.formType,
          requester: form.requesterName
        }
      });
    } catch (error) {
      console.error('❌ Error submitting form:', error);
      alert('Failed to submit form. Please check console for details.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSaveDraft() {
    const id = form.id || 'last'
    saveDraft(SAMPLE_DRAFT_PREFIX, form)
    alert('Draft saved')
  }

  function onChangeDeliveryMode(mode: 'CHANNEL' | 'DIRECT' | 'INTERNAL' | 'HEIWA' | '') {
    if (mode === 'CHANNEL' || mode === 'HEIWA' || mode === 'DIRECT') {
      setShipToUiMode(mode)
    }
    setForm(f => {
      const effectiveMode = f.purpose === 'ZINT' ? 'HEIWA' : mode
      const cleared = resetDownstream(f, 'deliveryMode')
      let shipToCode = cleared.shipToCode
      let shipToName = cleared.shipToName

      // Auto-set Ship-To based on delivery mode
      if (effectiveMode === 'CHANNEL') {
        // Set Ship-To to Sold-To
        shipToCode = f.soldToCode
        shipToName = f.soldToName
      } else if (effectiveMode === 'HEIWA') {
        // Set Ship-To to HEIWAJIMA SERVICE CENTER
        shipToCode = 'HEIWA'
        shipToName = 'HEIWAJIMA SERVICE CENTER'
      }

      return {
        ...cleared,
        deliveryMode: (effectiveMode || undefined) as any,
        shipToCode,
        shipToName,
      }
    })
  }

  function mapPurpose(p?: string) {
    if (!p) return undefined as any
    return p as any
  }

  function onChangePurpose(p: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT') {
    setForm(f => {
      const cleared = resetDownstream(f, 'purpose')
      let nextMode = cleared.deliveryMode
      if (p === 'ZSAM') {
        if (nextMode !== 'CHANNEL' && nextMode !== 'DIRECT') nextMode = 'CHANNEL'
      } else if (p === 'ZNC' || p === 'ZNCCLAIM') {
        nextMode = 'CHANNEL'
      } else if (p === 'ZINT') {
        nextMode = 'INTERNAL'
      }
      return { ...cleared, purpose: p as any, formType: p as any, deliveryMode: nextMode }
    })
  }
}
