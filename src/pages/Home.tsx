import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useI18n } from '../providers/I18nContext'
import { isFormTypeInScope } from '../constants/requestTypes'
import { useFormCtx } from '../providers/FormContext'
import { useAuth } from '../providers/AuthContext'
import { adminApi, approvalsApi, requestsApi, appSettingsApi, reportsApi } from '../services/api.service'
import { hasCustomerSupportView, isCustomerSupport } from '../utils/user-roles'
import { canViewZncClaimApprovedReport } from '../utils/znc-claim-approved-report.util'

const DEFAULT_DATA_BANNER = 'Data last updated on: April 1, 2026'

type SupportSummary = {
  all: number
  awaiting: number
  approved: number
  closed: number
}

export default function Home() {
  const { t } = useI18n()
  const { resetForm } = useFormCtx()
  const { user } = useAuth()
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [approvedCount, setApprovedCount] = useState<number | null>(null)
  const [supportSummary, setSupportSummary] = useState<SupportSummary | null>(null)
  const [dataBanner, setDataBanner] = useState<string | null>(null)
  const [zncClaimApprovedCount, setZncClaimApprovedCount] = useState<number | null>(null)
  // The role-only account sees the all-requests tiles and nothing else; a requester carrying the
  // Customer Service view flag sees them beside their own tiles.
  const supportUser = isCustomerSupport(user?.role)
  const supportView = hasCustomerSupportView(user?.role, user?.isCustomerSupport)
  const showZncClaimApprovedReport = canViewZncClaimApprovedReport(user?.email)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { message: m } = await appSettingsApi.getWizardStep2DataBanner()
        const trimmed = (m ?? '').trim()
        if (!cancelled) setDataBanner(trimmed || null)
      } catch {
        if (!cancelled) setDataBanner(DEFAULT_DATA_BANNER)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        if (supportView) {
          const summary = await adminApi.getSupportFormsSummary()
          setSupportSummary({
            all: summary.all ?? 0,
            awaiting: summary.awaiting ?? 0,
            approved: summary.approved ?? 0,
            closed: summary.closed ?? 0,
          })
        } else {
          setSupportSummary(null)
        }
        if (supportUser) {
          setInboxCount(null)
          setPendingCount(null)
          setApprovedCount(null)
          return
        }

        // Section-scoped: these endpoints return both kinds, so an unfiltered length counted
        // returns into the Sample badges.
        const inbox = await approvalsApi.getPendingApprovals()
        setInboxCount(
          (inbox.approvals || []).filter((a: any) => isFormTypeInScope(a.form?.formType, 'sample')).length
        )

        const { requests: all } = await requestsApi.getPendingRequests()
        const myPending = all.filter(
          (r: any) =>
            isFormTypeInScope(r.formType, 'sample') &&
            r.requesterId === user?.id &&
            (r.status === 'PENDING_APPROVAL' || r.status === 'IN_PROGRESS')
        )
        setPendingCount(myPending.length)

        const { requests: approved } = await requestsApi.getPendingRequests('APPROVED')
        setApprovedCount(approved.filter((r: any) => isFormTypeInScope(r.formType, 'sample')).length)

        if (showZncClaimApprovedReport) {
          const summary = await reportsApi.getZncClaimApprovedSummary({ businessUnit: 'CDG' })
          setZncClaimApprovedCount(summary.total ?? 0)
        } else {
          setZncClaimApprovedCount(null)
        }
      } catch {
        setInboxCount(null)
        setPendingCount(null)
        setApprovedCount(null)
        setSupportSummary(null)
        setZncClaimApprovedCount(null)
      }
    }
    fetchCounts()
  }, [user?.id, user?.role, user?.email, supportUser, supportView, showZncClaimApprovedReport])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="text-3xl font-bold text-gray-800">
              {t('home.title')}, {user?.name}
            </h1>
            {dataBanner && (
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 shrink-0 sm:max-w-md sm:text-right">
                {dataBanner}
              </p>
            )}
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4`}>
        {supportView && (
          <>
            <Link
              to="/support/requests"
              className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#0066CC] to-[#0052A3] hover:scale-105"
            >
              <div className="px-6 py-8">
                <div className="text-3xl mb-2">📋</div>
                <div className="text-lg">All requests</div>
              </div>
              {supportSummary && (
                <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
                  {supportSummary.all}
                </span>
              )}
            </Link>

            <Link
              to="/support/requests?status=APPROVED"
              className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#28A745] to-[#218838] hover:scale-105"
            >
              <div className="px-6 py-8">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-lg">Approved</div>
              </div>
              {supportSummary && (
                <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
                  {supportSummary.approved}
                </span>
              )}
            </Link>

            <Link
              to="/support/requests?statusGroup=awaiting"
              className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#FF9500] to-[#CC7700] hover:scale-105"
            >
              <div className="px-6 py-8">
                <div className="text-3xl mb-2">⏳</div>
                <div className="text-lg">Pending / in progress</div>
              </div>
              {supportSummary && (
                <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
                  {supportSummary.awaiting}
                </span>
              )}
            </Link>

            <Link
              to="/support/requests?statusGroup=closed"
              className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#6c757d] to-[#545b62] hover:scale-105"
            >
              <div className="px-6 py-8">
                <div className="text-3xl mb-2">✕</div>
                <div className="text-lg">Rejected / cancelled</div>
              </div>
              {supportSummary && (
                <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
                  {supportSummary.closed}
                </span>
              )}
            </Link>
          </>
        )}
        {!supportUser && (
          <>
        {/* Start New Application */}
        <Link
          to="/new"
          className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#00A651] to-[#008A44] hover:scale-105"
          onClick={resetForm}
        >
          <div className="px-6 py-8">
            <div className="text-3xl mb-2">📝</div>
            <div className="text-lg">{t('home.cta')}</div>
          </div>
        </Link>

        {/* Approval inbox — table-style super inbox for SUPER_APPROVER; row-by-row for other approvers */}
        <Link
          to="/approvals/inbox"
          className={
            (user?.role === 'SUPER_APPROVER' || user?.isSuperApprover === true)
              ? 'relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#0e7490] to-[#155e75] hover:scale-105'
              : 'relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#0066CC] to-[#0052A3] hover:scale-105'
          }
          title={
            (user?.role === 'SUPER_APPROVER' || user?.isSuperApprover === true)
              ? 'Review all requests (table view) and act on the current step'
              : undefined
          }
        >
          <div className="px-6 py-8">
            <div className="text-3xl mb-2">{(user?.role === 'SUPER_APPROVER' || user?.isSuperApprover === true) ? '📑' : '📬'}</div>
            <div className="text-lg">
              {(user?.role === 'SUPER_APPROVER' || user?.isSuperApprover === true) ? t('home.superApproverInbox') : t('home.approvalInbox')}
            </div>
          </div>
          {typeof inboxCount === 'number' && (
            <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
              {inboxCount}
            </span>
          )}
        </Link>

        {/* Pending Approvals */}
        <Link
          to="/approvals/pending"
          className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#FF9500] to-[#CC7700] hover:scale-105"
        >
          <div className="px-6 py-8">
            <div className="text-3xl mb-2">⏳</div>
            <div className="text-lg">{t('home.pendingApprovals')}</div>
          </div>
          {typeof pendingCount === 'number' && (
            <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
              {pendingCount}
            </span>
          )}
        </Link>

        {/* Approved Requests */}
        <Link
          to="/approvals/approved"
          className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#28A745] to-[#218838] hover:scale-105"
        >
          <div className="px-6 py-8">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-lg">{t('home.approvedRequests')}</div>
          </div>
          {typeof approvedCount === 'number' && (
            <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
              {approvedCount}
            </span>
          )}
        </Link>

        {showZncClaimApprovedReport && (
          <Link
            to="/reports/znc-claim-approved"
            className="relative block rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden bg-gradient-to-r from-[#5b21b6] to-[#4c1d95] hover:scale-105"
          >
            <div className="px-6 py-8">
              <div className="text-3xl mb-2">📊</div>
              <div className="text-lg">Approved ZNC Claim Report</div>
            </div>
            {typeof zncClaimApprovedCount === 'number' && (
              <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
                {zncClaimApprovedCount}
              </span>
            )}
          </Link>
        )}
          </>
        )}
      </div>
    </div>
    </div>
  )
}
