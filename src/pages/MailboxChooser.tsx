/**
 * Section picker for the top-nav mailboxes.
 *
 * The nav's Inbox / Pending / Approved pointed straight at `/approvals/*`, which is the **Sample**
 * section only — so a return sitting in the Return inbox was unreachable from the nav and the nav
 * counts told you nothing about it. These three entries now land here and ask which section you
 * want, with the live count for each so the choice is informed.
 *
 * The section routes themselves are untouched: `/approvals/<kind>` and `/return/<kind>` still work,
 * so the home tiles and any existing links keep going straight through.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../providers/I18nContext'
import { useAuth } from '../providers/AuthContext'
import { approvalsApi, requestsApi } from '../services/api.service'
import { isFormTypeInScope, type RequestListScope } from '../constants/requestTypes'
import { RETURN_CTA_TILE, type MailboxKind } from '../constants/sectionTheme'

const HEADING: Record<MailboxKind, { title: string; blurb: string; icon: string }> = {
  inbox: {
    title: 'Approver inbox',
    blurb: 'Requests waiting for your approval. Choose which section to open.',
    icon: '📬',
  },
  pending: {
    title: 'Pending approvals',
    blurb: 'Your own requests still moving through their approval chain.',
    icon: '⏳',
  },
  approved: {
    title: 'Approved requests',
    blurb: 'Requests that have completed every approval level.',
    icon: '✅',
  },
}

const CARD =
  'relative flex flex-col justify-between rounded-xl p-6 text-white shadow-md transition-all duration-200 hover:shadow-lg hover:scale-[1.02] min-h-[10rem]'

export default function MailboxChooser({ kind }: { kind: MailboxKind }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [counts, setCounts] = useState<{ sample: number; return: number } | null>(null)

  useEffect(() => {
    /** One fetch, split by section — the endpoints are section-agnostic and return both kinds. */
    const load = async () => {
      const tally = async (scope: RequestListScope) => {
        if (kind === 'inbox') {
          const { approvals } = await approvalsApi.getPendingApprovals()
          return (approvals || []).filter((a: any) => isFormTypeInScope(a.form?.formType, scope)).length
        }
        if (kind === 'pending') {
          const { requests } = await requestsApi.getPendingRequests()
          return requests.filter(
            (r: any) =>
              isFormTypeInScope(r.formType, scope) &&
              r.requesterId === user?.id &&
              (r.status === 'PENDING_APPROVAL' || r.status === 'IN_PROGRESS')
          ).length
        }
        const { requests } = await requestsApi.getPendingRequests('APPROVED')
        return requests.filter((r: any) => isFormTypeInScope(r.formType, scope)).length
      }
      try {
        setCounts({ sample: await tally('sample'), return: await tally('return') })
      } catch {
        setCounts(null)
      }
    }
    load()
  }, [kind, user?.id])

  const head = HEADING[kind]
  /*
   * The section's colour, not the mailbox's.
   *
   * These two cards are a choice between *sections* — the question is Sample or Return, not which
   * Return mailbox — so each wears the colour of that section's own landing page: Acme green for
   * Sample, crimson for Return, the same pair the two "Start new request" tiles use. It read as
   * teal here, amber on Pending and indigo on Approved, so the Return card changed colour on every
   * one of the three screens while meaning the same thing.
   *
   * The per-mailbox teal / amber / indigo still separate the tiles *inside* the Return landing,
   * where they are siblings and do need telling apart.
   */
  const ret = RETURN_CTA_TILE

  const badge = (n: number | undefined) =>
    n === undefined ? null : (
      <span className="absolute top-4 right-4 inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/20 text-white text-sm font-bold">
        {n}
      </span>
    )

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{head.icon}</span>
            <h1 className="text-3xl font-bold text-gray-800">{head.title}</h1>
          </div>
          <p className="mt-2 text-gray-600">{head.blurb}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Link
            to={`/approvals/${kind}`}
            className={`${CARD} bg-gradient-to-br from-[#00A651] to-[#008A44]`}
          >
            <div>
              <div className="text-2xl mb-2">📄</div>
              <div className="text-xl font-bold leading-snug">{t('nav.sample')}</div>
              <p className="mt-1 text-sm text-white/80">Sample ordering requests</p>
            </div>
            <span className="mt-4 text-sm font-semibold text-white/90">Open &rarr;</span>
            {badge(counts?.sample)}
          </Link>

          <Link
            to={`/return/${kind}`}
            className={CARD}
            style={{ backgroundImage: `linear-gradient(to bottom right, ${ret.from}, ${ret.to})` }}
          >
            <div>
              <div className="text-2xl mb-2">↩️</div>
              <div className="text-xl font-bold leading-snug">{t('nav.return')}</div>
              <p className="mt-1 text-sm text-white/80">Return and credit memo requests</p>
            </div>
            <span className="mt-4 text-sm font-semibold text-white/90">Open &rarr;</span>
            {badge(counts?.return)}
          </Link>
        </div>
      </div>
    </div>
  )
}
