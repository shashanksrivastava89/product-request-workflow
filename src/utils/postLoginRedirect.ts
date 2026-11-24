/**
 * Bringing someone back to the page they were sent to, after they sign in.
 *
 * Every mail links into the app — the rejected request to correct, the request just submitted, the
 * approved one — and a reader who is not signed in is sent to /login first. The router's `state.from`
 * carried the page there, but Login read only its pathname, dropping `?expand=`, which is what opens
 * the right request; and router state does not survive the Microsoft sign-in redirect at all, so the
 * reader landed on the home page. sessionStorage survives the same-tab round trip to Microsoft and
 * back, and is per-tab, so one tab's link cannot redirect another.
 */

const KEY = 'post_login_path';

/** Same-origin app paths only — `/x`, never `//host` or an absolute URL — and never back to /login. */
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
  if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login/')) return false;
  return true;
}

/** Remember where a signed-out reader was going. Ignored for anything that is not an app path. */
export function rememberPostLoginPath(path: string): void {
  if (!isSafeInternalPath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* private mode or storage blocked: they land on the home page, as before */
  }
}

/** The remembered path, if it is still a safe one. Does not clear it. */
export function peekPostLoginPath(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    return isSafeInternalPath(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Forget the remembered path once it has been used, so it cannot resurface on a later sign-in. */
export function clearPostLoginPath(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
