/**
 * Return approval helpers: normalize names and skip requester self-approval.
 */

/** Normalize person names for equality (fullwidth space, case, collapse whitespace). */
export function normalizePersonNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function isSamePerson(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ka = normalizePersonNameKey(a);
  const kb = normalizePersonNameKey(b);
  return Boolean(ka && kb && ka === kb);
}

/**
 * Drop approval steps where the assignee is the requester (skip self).
 * Preserves order; blank names are already omitted by callers.
 */
export function skipSelfApprovers<T extends { name?: string; approverName?: string }>(
  steps: T[],
  requesterName: string | null | undefined
): T[] {
  if (!requesterName?.trim()) return steps;
  return steps.filter((step) => {
    const assignee = step.approverName ?? step.name;
    return !isSamePerson(assignee, requesterName);
  });
}

/**
 * Drop a step whose assignee already appears earlier in the path.
 *
 * The approval matrix repeats a name across levels for some teams — a manager who is both the 1st
 * and the final approver, for instance. buildReturnApproverChain has always collapsed those for the
 * wizard preview; this is the same rule for the path the backend actually creates, so the chain
 * shown at step 3 is the chain that gets built. Without it the same person receives two approval
 * emails for one return and has to approve it twice.
 *
 * Keeps the first occurrence, so the earliest level wins and order is preserved.
 */
export function dropRepeatApprovers<T extends { name?: string; approverName?: string; role?: string }>(
  steps: T[]
): T[] {
  const seen: string[] = [];
  const out: T[] = [];
  for (const step of steps) {
    // The review step is not an approval, so it never counts as a repeat of one — the same person
    // may legitimately review a request and then approve it.
    if (isReturnReviewerRole(step.role)) {
      out.push(step);
      continue;
    }
    const assignee = step.approverName ?? step.name;
    const key = normalizePersonNameKey(assignee);
    if (key && seen.includes(key)) continue;
    if (key) seen.push(key);
    out.push(step);
  }
  return out;
}

/** The role label the review step carries, as seeded in approval_chain_config. */
export const RETURN_REVIEWER_ROLE_LABEL = 'Reviewer';

export function isReturnReviewerRole(role: string | undefined | null): boolean {
  return String(role ?? '').trim().toLowerCase() === RETURN_REVIEWER_ROLE_LABEL.toLowerCase();
}

/**
 * The five approver levels from the approval matrix, in order.
 * Levels 4-5 are the two service managers; the sheet fills them for non-service groups only.
 */
export type ReturnApproverLevels = {
  /**
   * Service review, taken before any approver. Not an approval: the service admin team checks the
   * entries are right before the chain starts, because a wrong service return that reaches the end
   * has to be raised again from scratch.
   */
  reviewer?: string | null;
  firstApprover?: string | null;
  secondApprover?: string | null;
  finalApprover?: string | null;
  fourthApprover?: string | null;
  fifthApprover?: string | null;
};

/** The level keys in approval order — also the `mapping_field` names in approval_chain_config. */
export const RETURN_APPROVER_LEVEL_KEYS = [
  'reviewer',
  'firstApprover',
  'secondApprover',
  'finalApprover',
  'fourthApprover',
  'fifthApprover',
] as const;

/** The review step is not an approval; several rules treat it differently. */
export const RETURN_REVIEWER_KEY = 'reviewer' as const;

export type ReturnApproverLevelKey = (typeof RETURN_APPROVER_LEVEL_KEYS)[number];

/**
 * Clear mapping fields that equal the requester (for preview / hierarchy map).
 *
 * Keeps the named-field shape because approval_chain_config resolves approvers by `mapping_field`.
 * Use buildReturnApproverChain when an ordered list is what is wanted.
 */
export function clearSelfFromReturnApprovers(
  approvers: ReturnApproverLevels,
  requesterName: string | null | undefined
): Partial<Record<ReturnApproverLevelKey, string>> {
  const out: Partial<Record<ReturnApproverLevelKey, string>> = {};
  for (const key of RETURN_APPROVER_LEVEL_KEYS) {
    const name = String(approvers[key] ?? '').trim();
    if (!name) continue;
    if (isSamePerson(name, requesterName)) continue;
    out[key] = name;
  }
  return out;
}

/** One step of a return's route, with the matrix column it came from. */
export type ReturnChainStep = { key: ReturnApproverLevelKey; name: string };

/**
 * The route a return takes, in order, with blanks, the requester themselves and repeats removed.
 *
 * `isService` reflects the request's Service flag and governs both service-only extras: the review
 * step in front, and the two service managers at the end. A requester already inside Service
 * carries those managers in their own levels 2/3, so they need nothing appended.
 *
 * Steps are returned with their key rather than as bare names, because the review step has to stay
 * distinguishable — it is not an approval, and it must not be labelled "1st Approver".
 */
export function buildReturnApproverChain(
  approvers: ReturnApproverLevels,
  requesterName: string | null | undefined,
  options: { isService: boolean }
): ReturnChainStep[] {
  const keys = RETURN_APPROVER_LEVEL_KEYS.filter((key) => {
    if (key === RETURN_REVIEWER_KEY) return options.isService;
    if (key === 'fourthApprover' || key === 'fifthApprover') return options.isService;
    return true;
  });

  const chain: ReturnChainStep[] = [];
  for (const key of keys) {
    const name = String(approvers[key] ?? '').trim();
    if (!name) continue;
    if (isSamePerson(name, requesterName)) continue;
    // The same person must never approve twice, however the sheet lists them. The reviewer is
    // exempt: reviewing and approving are different acts, so the same name may legitimately do both.
    if (
      key !== RETURN_REVIEWER_KEY &&
      chain.some((seen) => seen.key !== RETURN_REVIEWER_KEY && isSamePerson(seen.name, name))
    ) {
      continue;
    }
    chain.push({ key, name });
  }
  return chain;
}

/**
 * Does a matrix cell hold an address rather than a person's name?
 *
 * The Reviewer column holds the shared mailbox `japan_cus_care_pro_op@example.com`, because Corlett
 * asked for the review to reach the team rather than her personally. Every other approver column
 * holds a name that is resolved to an address through the `users` table, and putting an address
 * down that path would suffix it into `...@example.com@example.com` and reach nobody.
 */
export function looksLikeApproverEmail(value: string | null | undefined): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}
