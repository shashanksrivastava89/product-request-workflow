/**
 * `/forms/<id>` — the address older mails link to.
 *
 * The rejection mail pointed at /forms/<id>, but there never was such a page: no route and no
 * catch-all, so the reader got the header over an empty body. Every sample rejection mail sent since
 * go-live carries that link, and so does every return rejection sent before the link was changed.
 * Rather than leave those mails dead, the address now works: it looks the request up and sends the
 * reader to the list that holds it, opened on that request. No mail template changes, so nothing a
 * sample user receives is different — the link they already have simply starts working.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import apiClient from '../services/api.service'
import { useAuth } from '../providers/AuthContext'

type LinkedForm = { id: string; formType?: string; status?: string; requesterId?: string }

/** The page that shows this request to this reader, with the request opened. */
function whereToOpen(form: LinkedForm, viewerId: string | undefined): string {
  const isReturn = form.formType === 'RETURN'
  const expand = `?expand=${encodeURIComponent(form.id)}`
  if (form.status === 'APPROVED') return `${isReturn ? '/return/approved' : '/approvals/approved'}${expand}`
  // A draft is only ever its owner's to open - a reopened return being corrected, most likely.
  if (form.status === 'DRAFT' && viewerId && form.requesterId === viewerId) {
    return `${isReturn ? '/return/new' : '/new'}?draft=${encodeURIComponent(form.id)}`
  }
  return `${isReturn ? '/return/pending' : '/approvals/pending'}${expand}`
}

export default function FormLinkRedirect() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      try {
        const { data } = await apiClient.get(`/forms/${encodeURIComponent(id)}`)
        const form = data?.form as LinkedForm | undefined
        if (!form?.id) throw Object.assign(new Error('missing'), { response: { status: 404 } })
        if (!cancelled) navigate(whereToOpen(form, user?.id), { replace: true })
      } catch (err: unknown) {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response?.status
        setProblem(
          status === 403
            ? 'You do not have access to this request.'
            : status === 404
              ? 'This request could not be found. It may have been deleted.'
              : 'This request could not be opened. Please try again.'
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate, user?.id])

  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      {problem ? (
        <div className="space-y-4">
          <p className="text-base font-semibold text-gray-900">{problem}</p>
          <Link to="/" className="inline-block text-sm font-semibold text-[#00785c] underline">
            Go to the home page
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-600">Opening the request…</p>
      )}
    </div>
  )
}
