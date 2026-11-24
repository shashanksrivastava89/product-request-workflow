/**
 * Reopen a rejected return and correct it in place — Corlett Siobhan, 25 Sep 2026.
 *
 * *"Reopening preserves the request history and requires less effort for data entry."* A copy starts
 * a new request with a new reference number and none of the history; reopening puts this same
 * request back into its requester's hands as a draft, with its reference number, and keeps the
 * rejected round — every step, who rejected it and why — on the request. Submitting it routes it
 * through the approval chain again.
 *
 * The server decides who may (the person who entered it, or the rep it names) and records the
 * history; this only asks for it and opens the wizard on the reopened draft.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../services/api.service'
import { WIZARD_BOOTSTRAP_DRAFT_KEY } from './CloneRequestButton'

interface Props {
  formId: string
  onError?: (message: string) => void
}

export default function ReopenRequestButton({ formId, onError }: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const reopen = async () => {
    setBusy(true)
    try {
      const { data } = await apiClient.post(`/forms/${formId}/reopen`)
      const reopened = data?.form as Record<string, unknown> | undefined
      const id = reopened?.id as string | undefined
      if (!id) throw new Error('No request returned')
      try {
        sessionStorage.setItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${id}`, JSON.stringify(reopened))
      } catch {
        /* private mode / quota — the wizard's own GET is authoritative anyway */
      }
      navigate(`/return/new?draft=${encodeURIComponent(id)}`)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'Could not reopen this request.'
      if (onError) onError(message)
      else window.alert(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 space-y-3">
      <p className="text-sm text-emerald-950 font-semibold" lang="ja">
        この申請を開いて修正し、再申請できます。参照番号と履歴はそのまま残ります。
      </p>
      <p className="text-xs text-emerald-900">
        Opens this same request for you to correct and submit again. It keeps its reference number and its history.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          void reopen()
        }}
        className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-lg bg-[#00A651] hover:bg-[#008a42] disabled:opacity-60 text-white text-sm font-bold shadow-md transition-colors"
        lang="ja"
      >
        {busy ? '処理中…' : '修正して再申請 / Reopen and correct'}
      </button>
    </div>
  )
}
