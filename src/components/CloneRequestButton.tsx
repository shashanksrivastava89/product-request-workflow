/**
 * "Create a new request from this one" — the clone button, wherever a request is shown.
 *
 * One component because it now appears in three places (pending approvals, approved requests and
 * the approval / service-review inbox) and used to be two hand-copied blocks with slightly
 * different Japanese copy and different rules about when it appeared. The rule is now the same
 * everywhere: any request you can see, at any stage.
 *
 * The clone is a DRAFT owned by whoever pressed the button and visible to nobody else until they
 * submit it, which is why it needs no further permission than being able to read the original. The
 * server enforces exactly that (assertUserCanReadForm in copyFormFromRejected).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../services/api.service'

/** The key the wizards read the created draft back from, so the first paint has real values. */
export const WIZARD_BOOTSTRAP_DRAFT_KEY = 'japauto_wizard_bootstrap_draft:'

interface Props {
  formId: string
  /** Rendered as a full-width block with its explanation, or as a plain button in a row of them. */
  variant?: 'block' | 'inline'
  onError?: (message: string) => void
}

/*
 * A rejected return is corrected by REOPENING it now (ReopenRequestButton), which keeps its reference
 * number and history. This button is back to what it always was: start a new request from a copy -
 * still offered beside the reopen, for when starting over is simpler.
 */
export default function CloneRequestButton({ formId, variant = 'block', onError }: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const clone = async () => {
    setBusy(true)
    try {
      const { data } = await apiClient.post(`/forms/${formId}/copy-from-rejected`)
      const created = data?.form as Record<string, unknown> | undefined
      const newId = created?.id as string | undefined
      if (!newId) throw new Error('No draft id returned')
      try {
        sessionStorage.setItem(`${WIZARD_BOOTSTRAP_DRAFT_KEY}${newId}`, JSON.stringify(created))
      } catch {
        /* private mode / quota — the wizard's own GET is authoritative anyway */
      }
      // A copied RETURN belongs in the Return wizard: the sample wizard's form model has no
      // returnType, invoice dates or order reason, so it would drop every one of them.
      navigate(
        created?.formType === 'RETURN'
          ? `/return/new?draft=${encodeURIComponent(newId)}`
          : `/new?draft=${encodeURIComponent(newId)}`
      )
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'Could not create a new request from this one.'
      if (onError) onError(message)
      else window.alert(message)
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        void clone()
      }}
      className={
        variant === 'block'
          ? 'w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-lg bg-[#00A651] hover:bg-[#008a42] disabled:opacity-60 text-white text-sm font-bold shadow-md transition-colors'
          : 'min-h-[40px] px-3 py-2 rounded-lg border border-[#00A651] text-[#00785c] hover:bg-[#00A651]/5 disabled:opacity-60 text-sm font-semibold transition-colors'
      }
      lang="ja"
    >
      {busy ? '作成中…' : '新規申請にコピーを使用します。'}
    </button>
  )

  if (variant === 'inline') return button

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 space-y-3">
      <p className="text-sm text-amber-950 font-semibold" lang="ja">
        この内容をコピーして新しい申請を作成できます。（送信前に編集できます。）元の申請は変更されません。
      </p>
      {button}
    </div>
  )
}
