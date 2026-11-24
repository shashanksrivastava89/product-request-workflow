import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../providers/I18nContext'
import { useAuth } from '../providers/AuthContext'
import { approvalsApi, requestsApi, staticDataApi, type ReturnMatrixRoles } from '../services/api.service'
import { isFormTypeInScope } from '../constants/requestTypes'
import { RETURN_CTA_TILE, RETURN_MAILBOX_TILE, RETURN_REVIEW_TILE } from '../constants/sectionTheme'
import { hasServiceAdminPrivileges } from '../utils/service-admin.util'
import { isReturnReviewerRole } from '../utils/return-approval.util'
import { isOnPendingList } from '../utils/pendingList'

/** Same badge as the Sample home tiles, so the two sections read alike. */
function CountBadge({ count }: { count: number | null }) {
  if (count === null) return null
  return (
    <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
      {count}
    </span>
  )
}

const TILE_BASE =
  'relative flex h-full min-h-[9.5rem] items-center justify-center rounded-xl text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg text-center overflow-hidden hover:scale-105'

export default function ReturnHome() {
  const { t } = useI18n()
  const { user } = useAuth()
  const isSuperApprover = user?.role === 'SUPER_APPROVER' || user?.isSuperApprover === true

  // Only P&OP (and admins) review, so the card is theirs alone — the same test the server uses
  // to decide who may action the step, so the card and the permission cannot drift apart.
  const canReview = hasServiceAdminPrivileges(user)
  const isAdminOrSuper = user?.role === 'ADMIN' || isSuperApprover

  /**
   * A reviewer who approves nowhere in the return matrix (Corlett) has an Approver's Inbox that can
   * only ever be empty, so it is not shown to them. Admins and super approvers keep it, and so does
   * anyone whose inbox actually holds something, whatever the matrix says.
   */
  const [matrixRoles, setMatrixRoles] = useState<ReturnMatrixRoles | null>(null)
  useEffect(() => {
    if (!canReview || isAdminOrSuper) return
    staticDataApi
      .getMyReturnMatrixRoles()
      .then(setMatrixRoles)
      .catch(() => setMatrixRoles(null))
  }, [canReview, isAdminOrSuper])

  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const [reviewCount, setReviewCount] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [approvedCount, setApprovedCount] = useState<number | null>(null)

  useEffect(() => {
    /**
     * Every count is filtered to RETURN. The endpoints are section-agnostic — they return both
     * kinds — so a tile that simply reported `length` would show the Sample totals here.
     */
    const fetchCounts = async () => {
      try {
        const inbox = await approvalsApi.getPendingApprovals()
        const returnApprovals = (inbox.approvals || []).filter((a: any) =>
          isFormTypeInScope(a.form?.formType, 'return')
        )
        // Each request belongs to exactly one card. A review step counts towards Service review
        // and NOT towards the Approver's Inbox — otherwise a reviewer saw the same single item
        // counted twice, once on each tile, which is what made the two cards look identical.
        const reviewSteps = returnApprovals.filter((a: any) => isReturnReviewerRole(a.role))
        setReviewCount(reviewSteps.length)
        setInboxCount(returnApprovals.length - reviewSteps.length)

        const { requests: all } = await requestsApi.getPendingRequests()
        setPendingCount(
          // The Pending Approvals page's own rule, so the tile's number is the number of rows there.
          all.filter((r: any) => isFormTypeInScope(r.formType, 'return') && isOnPendingList(r, user?.id)).length
        )

        const { requests: approved } = await requestsApi.getPendingRequests('APPROVED')
        setApprovedCount(approved.filter((r: any) => isFormTypeInScope(r.formType, 'return')).length)
      } catch {
        setInboxCount(null)
        setReviewCount(null)
        setPendingCount(null)
        setApprovedCount(null)
      }
    }
    fetchCounts()
  }, [user?.id])

  /**
   * Tile props for one mailbox. The gradient is inline rather than a Tailwind class because the
   * three Return accents live in one shared constant, and Tailwind cannot build class names from a
   * runtime value.
   */
  const hideInbox = canReview && !isAdminOrSuper && matrixRoles?.isApprover === false && (inboxCount ?? 0) === 0
  const tileCount = 4 + (canReview ? 1 : 0) - (hideInbox ? 1 : 0)
  /*
   * Four across at most, whatever the tile count.
   *
   * Five in a row squeezed every card until its title wrapped; a fifth wrapping onto its own line
   * reads better than five cramped ones.
   */
  const columns = tileCount >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'

  const tile = (kind: 'inbox' | 'pending' | 'approved') => {
    const c = RETURN_MAILBOX_TILE[kind]
    return {
      className: TILE_BASE,
      style: { backgroundImage: `linear-gradient(to right, ${c.from}, ${c.to})` },
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h1 className="text-3xl font-bold text-gray-800">{t('return.title')}</h1>
          <p className="mt-2 text-gray-600">{t('return.subtitle')}</p>
        </div>

        <div className={`grid grid-cols-1 gap-6 sm:grid-cols-2 items-stretch ${columns}`}>
          <Link
            to="/return/new"
            className={TILE_BASE}
            style={{
              backgroundImage: `linear-gradient(to right, ${RETURN_CTA_TILE.from}, ${RETURN_CTA_TILE.to})`,
            }}
          >
            <div className="px-6 py-6">
              <div className="text-3xl mb-2">📝</div>
              <div className="text-lg leading-snug">{t('return.cta')}</div>
            </div>
          </Link>

          {!hideInbox && (
            <Link to="/return/inbox" {...tile('inbox')}>
              <div className="px-6 py-6">
                <div className="text-3xl mb-2">{isSuperApprover ? '📑' : '📬'}</div>
                <div className="text-lg leading-snug">
                  {isSuperApprover ? t('home.superApproverInbox') : t('home.approvalInbox')}
                </div>
              </div>
              <CountBadge count={inboxCount} />
            </Link>
          )}

          {/*
            The service review queue. This is the answer to Vidhi Parsons's "Has this implemented?
            … How could we check it?" — a number he can look at, rather than an approval chain he
            has to read. The step used to be invisible in-app: it is addressed to a shared mailbox
            nobody can sign in as, so only the emailed link worked.
          */}
          {canReview && (
            <Link
              to="/return/review"
              className={TILE_BASE}
              style={{
                backgroundImage: `linear-gradient(to right, ${RETURN_REVIEW_TILE.from}, ${RETURN_REVIEW_TILE.to})`,
              }}
            >
              <div className="px-6 py-6">
                <div className="text-3xl mb-2">🔎</div>
                <div className="text-lg leading-snug">{t('return.review.title')}</div>
              </div>
              <CountBadge count={reviewCount} />
            </Link>
          )}

          <Link to="/return/pending" {...tile('pending')}>
            <div className="px-6 py-6">
              <div className="text-3xl mb-2">⏳</div>
              <div className="text-lg leading-snug">{t('home.pendingApprovals')}</div>
            </div>
            <CountBadge count={pendingCount} />
          </Link>

          <Link to="/return/approved" {...tile('approved')}>
            <div className="px-6 py-6">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-lg leading-snug">{t('home.approvedRequests')}</div>
            </div>
            <CountBadge count={approvedCount} />
          </Link>
        </div>
      </div>
    </div>
  )
}
