/**
 * Return approval helpers: normalize names and skip requester self-approval.
 */

/** Normalize person names for equality (fullwidth space, case, collapse whitespace). */
export function normalizePersonNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function isSamePerson(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ka = normalizePersonNameKey(a)
  const kb = normalizePersonNameKey(b)
  return Boolean(ka && kb && ka === kb)
}

/**
 * Drop approval steps where the assignee is the requester (skip self).
 */
export function skipSelfApprovers<T extends { name?: string; approverName?: string }>(
  steps: T[],
  requesterName: string | null | undefined
): T[] {
  if (!requesterName?.trim()) return steps
  return steps.filter((step) => {
    const assignee = step.approverName ?? step.name
    return !isSamePerson(assignee, requesterName)
  })
}

/**
 * The route steps from the approval matrix, in order.
 *
 * `reviewer` is the service review taken *before* any approval: the service admin team checks the
 * entries are right before the chain starts, because a wrong service return that reaches the end
 * has to be raised again from scratch. Levels 4-5 are the two service managers; the sheet fills
 * them for non-service groups only.
 *
 * Kept in step with backend/src/utils/return-approval.util.ts so the wizard preview and the chain
 * the backend builds cannot drift.
 */
export const RETURN_APPROVER_LEVEL_KEYS = [
  'reviewer',
  'firstApprover',
  'secondApprover',
  'finalApprover',
  'fourthApprover',
  'fifthApprover',
] as const

export type ReturnApproverLevelKey = (typeof RETURN_APPROVER_LEVEL_KEYS)[number]

export const RETURN_REVIEWER_KEY = 'reviewer' as const

/**
 * The role label the backend puts on a service review step.
 *
 * Must match RETURN_REVIEWER_ROLE_LABEL on the server — the review step is identified by this
 * string rather than by level, because renumbering shifts the level but never the label.
 */
export const RETURN_REVIEWER_ROLE_LABEL = 'Reviewer'

/** True when an approval row is the service review step rather than a numbered approval. */
export function isReturnReviewerRole(role: string | null | undefined): boolean {
  return String(role ?? '').trim().toLowerCase() === RETURN_REVIEWER_ROLE_LABEL.toLowerCase()
}

export type ReturnApproverLevels = Partial<Record<ReturnApproverLevelKey, string | null>>

/** One step of a return's route, with the matrix column it came from. */
export type ReturnChainStep = { key: ReturnApproverLevelKey; name: string }

/**
 * The route a return takes, in order, with blanks, the requester themselves and repeats removed.
 *
 * `isService` governs both service-only extras: the review step in front, and the two service
 * managers at the end. A requester already inside Service carries those managers in their own
 * levels 2/3, so they need nothing appended.
 *
 * Steps carry their key rather than being bare names, because the review step must stay
 * distinguishable — it is not an approval, and must not be labelled "1st Approver".
 */
export function buildReturnApproverChain(
  approvers: ReturnApproverLevels,
  requesterName: string | null | undefined,
  options: { isService: boolean }
): ReturnChainStep[] {
  const keys = RETURN_APPROVER_LEVEL_KEYS.filter((key) => {
    if (key === RETURN_REVIEWER_KEY) return options.isService
    if (key === 'fourthApprover' || key === 'fifthApprover') return options.isService
    return true
  })

  const chain: ReturnChainStep[] = []
  for (const key of keys) {
    const name = String(approvers[key] ?? '').trim()
    if (!name) continue
    if (isSamePerson(name, requesterName)) continue
    // The same person must never approve twice, however the sheet lists them. The reviewer is
    // exempt: reviewing and approving are different acts.
    if (
      key !== RETURN_REVIEWER_KEY &&
      chain.some((seen) => seen.key !== RETURN_REVIEWER_KEY && isSamePerson(seen.name, name))
    ) {
      continue
    }
    chain.push({ key, name })
  }
  return chain
}

/** Step titles for the numbered approvals, by position. The review step is named, not numbered. */
export const RETURN_APPROVER_STEP_LABELS = [
  '1st Approver',
  '2nd Approver',
  '3rd Approver',
  '4th Approver',
  '5th Approver',
] as const

/**
 * The route as the wizard previews it at step 1: the review step by name, then the approvals
 * numbered by position. Blanks, the requester themselves and repeats are already gone, so the
 * numbering counts the approvals that survive - a requester who is himself the district manager
 * routes straight to his department manager, and that person is the 1st approver.
 *
 * Shared by the wizard and the reviewer's correction screen, so a route rebuilt after a correction
 * is previewed exactly as it was previewed at submission.
 */
export type ReturnHierarchyRow = {
  /** The role as the chain stores it — 'Reviewer', or a positional approver label. */
  role: string
  name: string
  /** The review step: shown differently, and it is not one of the approvals. */
  isReviewer: boolean
}

export function buildReturnHierarchyRows(
  approvers: ReturnApproverLevels,
  requesterName: string | null | undefined,
  options: { isService: boolean }
): ReturnHierarchyRow[] {
  const chain = buildReturnApproverChain(approvers, requesterName, options)
  let approverIndex = 0
  return chain.map((step) => {
    if (step.key === RETURN_REVIEWER_KEY) {
      return { role: RETURN_REVIEWER_ROLE_LABEL, name: step.name, isReviewer: true }
    }
    const role = RETURN_APPROVER_STEP_LABELS[approverIndex] ?? `Approver ${approverIndex + 1}`
    approverIndex += 1
    return { role, name: step.name, isReviewer: false }
  })
}
