/**
 * Wizard draft persistence, shared by the sample-order and return flows.
 *
 * Why this exists: both wizards kept their in-progress form in `localStorage` under a `…:last` key
 * and rehydrated it on every mount. `localStorage` outlives the browser session, so reopening the
 * link days later resurrected the previous request — and `…:last` was never cleared, not even after
 * a successful submit, so a submitted request came straight back. A UAT reviewer reported it as
 * "the previous filling out is still shown in the link … should I logout manually every time after
 * submitting?". The answer is no.
 *
 * `sessionStorage` draws the line where users expect it: a refresh or an accidental navigation
 * inside the tab still restores the draft, closing the tab or the browser discards it. That is
 * simpler and more predictable than stamping drafts with a time and expiring them.
 *
 * Both flows use this module so the two wizards cannot drift apart again.
 */

/** Per-flow key prefix. The `:last` entry is the one a wizard rehydrates from. */
export const SAMPLE_DRAFT_PREFIX = 'salesFormDraft';
export const RETURN_DRAFT_PREFIX = 'returnFormDraft';

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    // Private modes and locked-down browsers can throw on access, not just on write.
    return null;
  }
}

/** Read the draft a wizard should resume, or null when there is nothing to resume. */
export function loadDraft<T>(prefix: string): T | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(`${prefix}:last`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Persist the working draft.
 *
 * Only `:last` is written. Both providers also used to write a `:<id>` copy, but nothing ever read
 * it — `loadDraft` is the sole reader and it reads `:last` — so those were accumulating one dead
 * entry per wizard mount. (The server-draft bootstrap in Wizard.tsx uses its own separate key.)
 */
export function saveDraft(prefix: string, form: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(`${prefix}:last`, JSON.stringify(form));
  } catch {
    // A full or unavailable store must never break the wizard; the draft is a convenience.
  }
}

/**
 * Forget a draft — call after a successful submit.
 *
 * The sample flow used to clear only its `:<id>` key and leave `:last` behind, which is exactly why
 * a submitted request came back the next time the wizard was opened.
 */
export function clearDraft(prefix: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(`${prefix}:last`);
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Drop every draft an earlier build left in `localStorage`.
 *
 * Without this a user's existing localStorage draft would keep resurrecting forever, because
 * nothing writes there any more to overwrite it. Removes the whole `prefix:*` family, including the
 * per-id copies the old code accumulated. Safe to call on every mount.
 */
export function purgeLegacyLocalDraft(prefix: string): void {
  try {
    if (typeof window === 'undefined') return;
    const stale = Object.keys(window.localStorage).filter((k) => k.startsWith(`${prefix}:`));
    for (const key of stale) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* nothing useful to do */
  }
}
