import { useState, useEffect, useMemo } from 'react'
import CloneRequestButton from '../components/CloneRequestButton'
import { endUserLabel, enteredByLabel, firstProductLabel, formatRequestDate, formatSubmittedDate, matchesEndUser, withinDateRange } from '../utils/requestDates'
import { dataManagementRequestLink } from '../utils/linkedRequest'
import { isSamePerson } from '../utils/return-approval.util'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '../providers/I18nContext'
import { useAuth } from '../providers/AuthContext'
import apiClient, { approvalsApi, requestsApi, Approval, RequestSnapshot, ApprovedFormRelation } from '../services/api.service'
import PrintButton from '../components/PrintButton'
import FormPrintView from '../components/FormPrintView'
import FormAttachmentsGallery from '../components/FormAttachmentsGallery'
import { BilingualFieldCaption } from '../components/BilingualFieldCaption'
import { toNonNegativeIntOrEmpty, blockNegativeAndDecimal } from '../utils/numericInput'
import {
  RETURN_REQUEST_TYPE_OPTIONS,
  SAMPLE_REQUEST_TYPE_OPTIONS,
  isFormTypeInScope,
} from '../constants/requestTypes'
import { mailboxTheme, type RequestSectionScope } from '../constants/sectionTheme'
import {
  PartnerAndDeliverySection,
  ProductLinesSection,
  RequesterCommentsSection,
  ReviewEditTrailSection,
  SubmissionHistorySection,
  SalesOrderNumberSection,
  isReturnRequest,
  returnTypeLabel,
} from '../components/RequestDetailSections'
import { formatApprovalAssigneeLine } from '../utils/approval-display.util'
import { hasServiceAdminPrivileges } from '../utils/service-admin.util'
import { RequestPeopleTiles } from '../components/RequestRowTiles'

type FormWithApprovals = RequestSnapshot & {
  approvals?: Approval[]
  commentsForApproval?: string
  freeDescription?: string
  approvedRelation?: ApprovedFormRelation
}

type ApprovedTab = 'mine' | 'approvedByMe'

function matchesApprovedTab(form: FormWithApprovals, tab: ApprovedTab, userId?: string): boolean {
  const rel = form.approvedRelation
  if (rel) {
    if (tab === 'mine') return rel === 'requester' || rel === 'both'
    return rel === 'approver' || rel === 'both'
  }
  if (tab === 'mine') return !!userId && form.requesterId === userId
  return false
}

/**
 * `scope` decides which section this page is serving. Both sections share this one page — the
 * Return tiles used to point at 31-line stubs, so a submitted return appeared only in the Sample
 * list and nowhere under Return, which is exactly what UAT reported.
 */
export default function ApprovedRequests({ scope = 'sample' }: { scope?: RequestSectionScope }) {
  const { t } = useI18n()
  const { user } = useAuth()
  /**
   * Is this row the viewer's own submission?
   *
   * Relation, not role: a super approver looking at somebody else's request is not its requester and
   * gets the full row, which is what they asked for - and looking at their own they get the compact
   * one, which is what everybody wants. Same test the 'mine' tab uses.
   */
  // 'requester'/'both' include a return raised in your name by somebody else: it is your request.
  const isOwnRequest = (form: FormWithApprovals) =>
    !!user?.id &&
    (form.requesterId === user.id || form.approvedRelation === 'requester' || form.approvedRelation === 'both')
  const navigate = useNavigate()
  const theme = mailboxTheme(scope, 'approved')
  const accentBar = theme.accentBar
  const isReturnScope = scope === 'return'
  const typeOptions = isReturnScope ? RETURN_REQUEST_TYPE_OPTIONS : SAMPLE_REQUEST_TYPE_OPTIONS
  /** Only the Service Admin team enters the SAP number; the endpoint checks the same thing again. */
  const canSetSalesOrderNumber = hasServiceAdminPrivileges(user)
  const [forms, setForms] = useState<FormWithApprovals[]>([])
  const [allForms, setAllForms] = useState<FormWithApprovals[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /*
   * The approved mail links straight at one request: Customer Service reads the handoff, needs a
   * detail it does not carry, and should not have to hunt for the row. Same mechanism the approval
   * inbox already uses for its own links.
   */
  const [searchParams] = useSearchParams()
  const expandFormId = searchParams.get('expand')
  
  // Filter states
  const [filters, setFilters] = useState({
    formType: '',
    minAmount: '',
    maxAmount: '',
    submittedFrom: '',
    submittedTo: '',
    requester: '',
    endUser: ''
  })
  const [showFilters, setShowFilters] = useState(false)
  const [activeTab, setActiveTab] = useState<ApprovedTab>('mine')

  useEffect(() => {
    fetchMyForms()
  }, [])

  /** Only this section's rows; the payload carries both kinds. */
  const scopedForms = useMemo(
    () => allForms.filter((f) => isFormTypeInScope(f.formType, scope)),
    [allForms, scope]
  )

  const mineCount = useMemo(
    () => scopedForms.filter((f) => matchesApprovedTab(f, 'mine', user?.id)).length,
    [scopedForms, user?.id]
  )
  const approvedByMeCount = useMemo(
    () => scopedForms.filter((f) => matchesApprovedTab(f, 'approvedByMe', user?.id)).length,
    [scopedForms, user?.id]
  )

  const tabForms = useMemo(
    () => allForms.filter((f) => matchesApprovedTab(f, activeTab, user?.id)),
    [allForms, activeTab, user?.id]
  )

  /**
   * A linked request opens itself, on whichever tab holds it.
   *
   * Runs once the rows have arrived and only while the link is being followed, so it never fights
   * the reader afterwards: expanding is a one-off, and the tab choice defers to the reader the
   * moment they touch the tabs themselves.
   */
  const [linkHandled, setLinkHandled] = useState(false)
  useEffect(() => {
    if (!expandFormId || linkHandled || isLoading) return
    const hit = allForms.find((f) => f.id === expandFormId)
    if (!hit) return
    setLinkHandled(true)
    setTabChosen(true)
    setActiveTab(matchesApprovedTab(hit, 'mine', user?.id) ? 'mine' : 'approvedByMe')
    setExpanded((prev) => ({ ...prev, [hit.id]: true }))
    setTimeout(() => {
      document.getElementById(`approved-form-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
  }, [expandFormId, linkHandled, isLoading, allForms, user?.id])

  /*
   * The same link reaches people who are on neither tab - administrators and super approvers on
   * copy of the approved mail. For them every request is in Data Management, so the link opens it
   * there instead of leaving an empty list; everyone else is told why there is nothing to show.
   */
  const linkedRequestMissing =
    !!expandFormId && !isLoading && !error && !allForms.some((f) => f.id === expandFormId)
  const dataManagementLink = linkedRequestMissing ? dataManagementRequestLink(user, expandFormId) : null
  useEffect(() => {
    if (dataManagementLink) navigate(dataManagementLink, { replace: true })
  }, [dataManagementLink, navigate])

  /**
   * Open on the tab that holds something. The service review team raises few returns of their own,
   * so "My requests" was empty for them and the page read as "No Approved Requests" while the
   * approved service returns they came for sat one tab across. Only ever moves off the default
   * before the reviewer has touched the tabs.
   */
  const [tabChosen, setTabChosen] = useState(false)
  useEffect(() => {
    if (tabChosen || isLoading) return
    if (mineCount === 0 && approvedByMeCount > 0) setActiveTab('approvedByMe')
  }, [tabChosen, isLoading, mineCount, approvedByMeCount])

  const fetchMyForms = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Get approved requests snapshot from backend/data/requests.json via API
      const { requests } = await requestsApi.getPendingRequests('APPROVED')

      const withApprovals = await Promise.all(
        requests.map(async (req) => {
          try {
            const { approvals } = await approvalsApi.getApprovalHistory(req.id)
            return { ...req, approvals }
          } catch {
            return { ...req, approvals: [] }
          }
        })
      )

      setAllForms(withApprovals)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load forms')
    } finally {
      setIsLoading(false)
    }
  }

  const applyFilters = (data: FormWithApprovals[]) => {
    // Section scope first: the Return pages show returns only, the Sample pages everything else.
    // Without this a return appeared in both sections, which is how it was found in UAT.
    let filtered = data.filter((f) => isFormTypeInScope(f.formType, scope))

    if (filters.formType) {
      filtered = filtered.filter(f => f.formType === filters.formType)
    }

    if (filters.minAmount) {
      const min = parseFloat(filters.minAmount)
      filtered = filtered.filter(f => f.totalAmount >= min)
    }

    if (filters.maxAmount) {
      const max = parseFloat(filters.maxAmount)
      filtered = filtered.filter(f => f.totalAmount <= max)
    }

    // Vidhi: "make easier submitted date from / submitted date to". Keyed on submittedAt, which a
    // review edit cannot move, rather than on the requester's own requestDate field.
    if (filters.submittedFrom || filters.submittedTo) {
      filtered = filtered.filter(f => withinDateRange(f.submittedAt, filters.submittedFrom, filters.submittedTo))
    }


    if (filters.requester.trim()) {
      const needle = filters.requester.trim().toLowerCase()
      filtered = filtered.filter(f =>
        String(f.requesterName ?? '').toLowerCase().includes(needle) ||
        String(f.requester?.name ?? '').toLowerCase().includes(needle)
      )
    }

    if (filters.endUser.trim()) {
      filtered = filtered.filter(f => matchesEndUser(f, filters.endUser))
    }

    setForms(filtered)
  }

  useEffect(() => {
    applyFilters(tabForms)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, tabForms])

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({
      formType: '',
      minAmount: '',
      maxAmount: '',
      submittedFrom: '',
      submittedTo: '',
      requester: '',
      endUser: ''
    })
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
      APPROVED: { bg: 'bg-gradient-to-r from-green-500 to-green-600', text: 'text-white', label: t('approvals.status.approved'), icon: '✅' },
    }

    const config = statusConfig[status] || { bg: 'bg-gray-500', text: 'text-white', label: status, icon: '📄' }

    return (
      <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold shadow-md ${config.bg} ${config.text}`}>
        <span>{config.icon}</span>
        {config.label}
      </span>
    )
  }

  const getApprovalBadge = (status: Approval['status']) => {
    const statusConfig: Record<Approval['status'], { bg: string; text: string; label: string }> = {
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
      IN_PROGRESS: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
      APPROVED: { bg: 'bg-green-100', text: 'text-green-800', label: 'Approved' },
      REJECTED: { bg: 'bg-red-100', text: 'text-red-800', label: 'Rejected' },
    }

    const config = statusConfig[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status }

    return (
      <span className={`inline-block px-3 py-1 rounded-lg text-xs font-semibold ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-[#00A651] border-t-transparent"></div>
          <p className="mt-6 text-gray-600 font-medium">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-6 py-4 rounded-lg shadow-md">
            <div className="flex items-center">
              <span className="text-xl mr-3">⚠️</span>
              <p className="font-semibold">{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header Section */}
        <div className="relative bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl shadow-xl p-5 mb-5 border border-gray-200 overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
          
          <div className="relative flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <div className={`absolute inset-0 bg-gradient-to-br ${accentBar} rounded-xl blur-lg opacity-50`}></div>
                  <div className={`relative w-9 h-9 bg-gradient-to-br ${accentBar} rounded-xl flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform`}>
                    <span className="text-lg">✅</span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-2xl font-extrabold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
                      {t(isReturnScope ? 'return.approved.title' : 'approvals.approved.title')}
                    </h1>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`h-0.5 w-6 bg-gradient-to-r ${accentBar} rounded-full`}></div>
                    <p className="text-sm font-semibold text-gray-700">{t(isReturnScope ? 'return.approved.subtitle' : 'approvals.approved.subtitle')}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="ml-4 relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[#00A651]/20 to-[#008a42]/10 rounded-xl blur-md"></div>
              <div className="relative bg-gradient-to-br from-[#00A651]/15 to-[#008a42]/5 px-4 py-3 rounded-xl border-2 border-[#00A651]/30 backdrop-blur-sm">
                <div className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-1">{t('home.approvedRequests')}</div>
                <div className={`text-2xl font-extrabold bg-gradient-to-r ${accentBar} bg-clip-text text-transparent`}>
                  {/* Section-scoped: allForms is the whole payload, both kinds. */}
                  {scopedForms.length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-md p-1.5 mb-4 border border-gray-200 inline-flex gap-1">
          <button
            type="button"
            onClick={() => { setTabChosen(true); setActiveTab('mine') }}
            className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-colors ${
              activeTab === 'mine'
                ? `bg-gradient-to-r ${accentBar} text-white shadow-md`
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t('approvals.approved.tab.mine')}
            <span className={`ml-2 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs ${
              activeTab === 'mine' ? 'bg-white/25' : 'bg-gray-200 text-gray-700'
            }`}>
              {mineCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setTabChosen(true); setActiveTab('approvedByMe') }}
            className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-colors ${
              activeTab === 'approvedByMe'
                ? `bg-gradient-to-r ${accentBar} text-white shadow-md`
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t('approvals.approved.tab.approvedByMe')}
            <span className={`ml-2 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs ${
              activeTab === 'approvedByMe' ? 'bg-white/25' : 'bg-gray-200 text-gray-700'
            }`}>
              {approvedByMeCount}
            </span>
          </button>
        </div>

        {linkedRequestMissing && !dataManagementLink && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 mb-4 text-sm" role="status">
            The request from your e-mail link is not on this list: it shows here only for its requester and
            the people who approved it. Ask the requester or an administrator if you need it.
          </div>
        )}

        {/* Filters Section */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-semibold text-gray-700"
            >
              <span>🔍</span>
              <span>Filters</span>
              <span className={`transform transition-transform ${showFilters ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {(filters.formType || filters.minAmount || filters.maxAmount || filters.submittedFrom || filters.submittedTo || filters.requester || filters.endUser) && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors font-semibold"
              >
                Clear All
              </button>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-3 border-t border-gray-200">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Form Type</label>
                <select
                  value={filters.formType}
                  onChange={(e) => handleFilterChange('formType', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                >
                  <option value="">All Types</option>
                  {typeOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Min Amount (¥)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={filters.minAmount}
                  onKeyDown={blockNegativeAndDecimal}
                  onChange={(e) => handleFilterChange('minAmount', toNonNegativeIntOrEmpty(e.target.value))}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Max Amount (¥)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={filters.maxAmount}
                  onKeyDown={blockNegativeAndDecimal}
                  onChange={(e) => handleFilterChange('maxAmount', toNonNegativeIntOrEmpty(e.target.value))}
                  placeholder="∞"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Submitted From</label>
                <input
                  type="date"
                  value={filters.submittedFrom}
                  onChange={(e) => handleFilterChange('submittedFrom', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Submitted To</label>
                <input
                  type="date"
                  value={filters.submittedTo}
                  onChange={(e) => handleFilterChange('submittedTo', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
              {/* Matches the named requester or the account that entered it - Corlett asked for both. */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Requester / entered by</label>
                <input
                  type="text"
                  value={filters.requester}
                  onChange={(e) => handleFilterChange('requester', e.target.value)}
                  placeholder="Name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
              {/* End User, by name or by customer code - Vidhi asked for it on both sections. */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">End User</label>
                <input
                  type="text"
                  value={filters.endUser}
                  onChange={(e) => handleFilterChange('endUser', e.target.value)}
                  placeholder="Name or code"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {forms.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-10 text-center border border-gray-100">
            <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✅</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">No Approved Requests</h3>
            <p className="text-gray-500 text-sm">
              {activeTab === 'mine' ? t('approvals.approved.empty.mine') : t('approvals.approved.empty.approvedByMe')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {forms.map((form) => (
              <div 
                key={form.id} 
                id={`approved-form-${form.id}`}
                className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300"
              >
                <button
                  className="w-full flex items-start justify-between p-4 hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded((prev) => ({ ...prev, [form.id]: !prev[form.id] }))}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base font-bold text-gray-900">
                        {form.referenceNumber || form.id.slice(0, 8)}
                      </span>
                      {getStatusBadge(form.status)}
                      {/*
                        The compact row spends no tile on the requester, so a request raised for
                        somebody else says so here instead - a manager's own list would otherwise
                        look like a list of their own requests.
                      */}
                      {!isReturnScope && isOwnRequest(form) && !isSamePerson(form.requesterName, user?.name) && form.requesterName && (
                        <span className="text-xs text-gray-500 truncate">for {form.requesterName}</span>
                      )}
                    </div>
                    {isReturnScope ? (
                    /* Requester, Submitter and Submitted lead every return row - see RequestPeopleTiles. */
                    <div className={`grid gap-3 ${isOwnRequest(form) ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>
                      <RequestPeopleTiles
                        requesterName={form.requesterName}
                        salesRepCode={form.salesRepCodeSap}
                        submitterName={form.requester?.name}
                        submittedAt={form.submittedAt}
                        requesterTileClassName={
                          !isOwnRequest(form) && activeTab === 'approvedByMe'
                            ? 'bg-blue-50 rounded-lg p-2 border border-blue-100'
                            : undefined
                        }
                      />
                      {isOwnRequest(form) ? (
                        <>
                      <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                      </div>
                      <div className={`rounded-lg p-2 ${theme.tile}`}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                        <div className={`text-xs font-bold ${theme.text}`}>¥{form.totalAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Product</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={firstProductLabel(form)}>{firstProductLabel(form)}</div>
                      </div>
                        </>
                      ) : (
                        <>
                      <div className={`rounded-lg p-2 ${theme.tile}`}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                        <div className={`text-xs font-bold ${theme.text}`}>¥{form.totalAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Return type</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={returnTypeLabel(form.returnType)}>{returnTypeLabel(form.returnType)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Date requesting</div>
                        <div className="text-xs font-bold text-gray-900">{formatRequestDate(form.requestDate)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                      </div>
                        </>
                      )}
                    </div>
                    ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {isOwnRequest(form) ? (
                        <>
                      {/*
                        A rep's own request collapses to the four things they scan for when hunting
                        the one to clone - *"single row for easier spotting"*. Anybody looking at
                        somebody else's request keeps the full set below, because an approver or a
                        reviewer does need to see who submitted it and when it is wanted.
                      */}
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Submitted</div>
                        <div className="text-xs font-bold text-gray-900">{formatSubmittedDate(form.submittedAt)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                      </div>
                      <div className={`rounded-lg p-2 ${theme.tile}`}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                        <div className={`text-xs font-bold ${theme.text}`}>¥{form.totalAmount.toLocaleString()}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Product</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={firstProductLabel(form)}>{firstProductLabel(form)}</div>
                      </div>
                        </>
                      ) : (
                        <>
                      {/*
                        The requester was on the "approved by me" tab only, so a person's own list of
                        approved requests never said whose they were - and on a return that is the
                        one name that matters, because a manager may raise one for a rep. It is on
                        every tab now, tinted only where it identifies somebody else's request.
                      */}
                      <div className={activeTab === 'approvedByMe' ? 'bg-blue-50 rounded-lg p-2 border border-blue-100' : 'bg-gray-50 rounded-lg p-2'}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Requester</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={form.requesterName}>{form.requesterName || '—'}</div>
                        {enteredByLabel(form.requesterName, form.requester?.name) && (
                          <div className="text-[10px] text-gray-500 truncate">
                            entered by {enteredByLabel(form.requesterName, form.requester?.name)}
                          </div>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Type</div>
                        <div className="text-xs font-bold text-gray-900">{form.formType}</div>
                      </div>
                      <div className={`rounded-lg p-2 ${theme.tile}`}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                        <div className={`text-xs font-bold ${theme.text}`}>¥{form.totalAmount.toLocaleString()}</div>
                      </div>
                      {/* Two dates, never one standing in for the other — see formatSubmittedDate. */}
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Submitted</div>
                        <div className="text-xs font-bold text-gray-900">{formatSubmittedDate(form.submittedAt)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Date requesting</div>
                        <div className="text-xs font-bold text-gray-900">{formatRequestDate(form.requestDate)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                      </div>
                      {/* A return has no delivery date; show what it does have. */}
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                          {isReturnRequest(form) ? 'Return type' : 'Delivery Date'}
                        </div>
                        <div className="text-xs font-bold text-gray-900 truncate" title={isReturnRequest(form) ? returnTypeLabel(form.returnType) : undefined}>
                          {isReturnRequest(form)
                            ? returnTypeLabel(form.returnType)
                            : form.expectedDeliveryDate === 'ASAP'
                              ? 'ASAP'
                              : form.expectedDeliveryDate
                                ? new Date(form.expectedDeliveryDate).toLocaleDateString()
                                : '—'}
                        </div>
                      </div>
                        </>
                      )}
                    </div>
                    )}
                  </div>
                  <div className="ml-4 flex items-center">
                    <div className={`w-8 h-8 rounded-full ${theme.chevron} flex items-center justify-center transition-transform ${expanded[form.id] ? 'rotate-90' : ''}`}>
                      <span className="text-base font-bold">▶</span>
                    </div>
                  </div>
                </button>
                {expanded[form.id] && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    {/* Print View (hidden, for printing) */}
                    <div className="hidden">
                      <FormPrintView
                        form={form}
                        approvals={form.approvals}
                        id={`print-form-${form.id}`}
                      />
                    </div>
                    
                    <div className="p-4 space-y-4">
                      {/* Any request, at any stage. See CloneRequestButton. */}
                      <CloneRequestButton formId={form.id} onError={setError} />
                      {/* Print Button */}
                      <div className="flex justify-end no-print">
                        <PrintButton
                          targetId={`print-form-${form.id}`}
                          label="Print Form"
                          variant="outline"
                        />
                      </div>
                      
                      <PartnerAndDeliverySection form={form} accent={accentBar} />
                      <ProductLinesSection form={form} accent={accentBar} />
                      <RequesterCommentsSection form={form} accent={accentBar} />
                      <ReviewEditTrailSection reviewEdits={form.reviewEdits} accent={accentBar} />
                      <SubmissionHistorySection history={form.approvalHistory} accent={accentBar} />

                      {form.formType === 'ZNCCLAIM' && form.id && (
                        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                          <FormAttachmentsGallery formId={form.id} formType="ZNCCLAIM" />
                        </div>
                      )}

                      {form.approvals && form.approvals.length > 0 && (
                        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`w-1 h-4 bg-gradient-to-b ${accentBar} rounded-full`}></div>
                            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Approval Path</h4>
                    </div>
                        <div className="space-y-2">
                          {form.approvals
                            .slice()
                            .sort((a, b) => a.level - b.level)
                            .map((approval) => (
                                <div key={approval.id} className="rounded-xl border-2 border-gray-200 bg-gradient-to-r from-[#00A651]/5 to-white hover:border-[#00A651] transition-all overflow-hidden">
                                  <div className="flex items-center justify-between px-5 py-4">
                                  <div className="flex items-center gap-4">
                                      <span className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${accentBar} text-white flex items-center justify-center text-sm font-bold shadow-md`}>
                                        {approval.level}
                                      </span>
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">{approval.role}</p>
                                        <p className="text-xs text-gray-600 mt-1 font-medium">
                                          {formatApprovalAssigneeLine(approval)}
                                        </p>
                                      </div>
                                    </div>
                                    {getApprovalBadge(approval.status)}
                                  </div>
                                  {(approval.status === 'APPROVED' || approval.status === 'REJECTED') && (
                                    <div className="px-5 pb-4 pt-0 border-t border-gray-200 bg-white">
                                      <div className="mt-3 space-y-2">
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="font-semibold text-gray-700">Action On:</span>
                                          <span className="text-gray-600">{approval.decidedAt ? new Date(approval.decidedAt).toLocaleString() : '—'}</span>
                                </div>
                                        {approval.comments && (
                                    <div>
                                            <span className="text-xs font-semibold text-gray-700">Comment:</span>
                                            <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{approval.comments || '—'}</p>
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                      {/* Last, after the Approval Path: the SAP number exists only once the chain is done. */}
                      <SalesOrderNumberSection
                        form={form}
                        canEdit={canSetSalesOrderNumber}
                        accent={accentBar}
                        onSaved={(salesOrderNumber) =>
                          setForms((prev) =>
                            prev.map((f) => (f.id === form.id ? { ...f, salesOrderNumber } : f))
                          )
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
