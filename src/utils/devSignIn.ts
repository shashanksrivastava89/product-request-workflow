/**
 * Sign in from the URL, for local development only.
 *
 * There is no password form for SSO accounts, so testing locally otherwise means opening the
 * console and writing `auth_mode` / `sso_email` into localStorage by hand — and a full page
 * navigation clears them again, which makes it fiddly to get right.
 *
 * With this, a link is enough:
 *
 *     http://localhost:5173/return?devUser=shashank_srivastava@example.com
 *
 * The email must match a row in the local `users` table; the backend looks the account up and
 * applies that person's real role and flags, so what you see is what they would see. The parameter
 * is removed from the address bar once used, so it does not end up in a shared screenshot.
 *
 * Safety: the whole function is behind `import.meta.env.DEV`, which Vite replaces with `false` in a
 * production build — the bundler then drops the body entirely, so none of this exists in the
 * deployed app. It also depends on `VITE_SSO_HEADER_FALLBACK=true`, which is a local-only setting.
 */

const AUTH_MODE_KEY = 'auth_mode';
const SSO_EMAIL_KEY = 'sso_email';
const SSO_NAME_KEY = 'sso_name';

/** Call once, before the app renders. Returns the email it signed in as, or null. */
export function applyDevSignInFromUrl(): string | null {
  if (!import.meta.env.DEV) return null;

  try {
    const url = new URL(window.location.href);
    // `as` is the short form, for typing by hand.
    const requested = url.searchParams.get('devUser') ?? url.searchParams.get('as');
    if (requested === null) return null;

    const email = requested.trim();
    if (!email) {
      console.warn('[devSignIn] ?devUser= was empty; expected an email that exists in the local users table');
      return null;
    }

    localStorage.setItem(AUTH_MODE_KEY, 'sso');
    localStorage.setItem(SSO_EMAIL_KEY, email);
    // A display name is only cosmetic; the server resolves the real one from the account.
    if (!localStorage.getItem(SSO_NAME_KEY)) {
      localStorage.setItem(SSO_NAME_KEY, email.split('@')[0].replace(/[._]/g, ' ').toUpperCase());
    }

    // Drop the parameter so a reload does not keep re-applying it, and so the address is clean.
    url.searchParams.delete('devUser');
    url.searchParams.delete('as');
    window.history.replaceState({}, '', url.pathname + (url.search === '?' ? '' : url.search) + url.hash);

    console.info(`[devSignIn] signed in as ${email} (local development only)`);
    return email;
  } catch (e) {
    // Never let a dev convenience stop the app from starting.
    console.warn('[devSignIn] could not apply ?devUser=', e);
    return null;
  }
}

/** Clear a dev sign-in. `localhost:5173/?devLogout` also works. */
export function applyDevLogoutFromUrl(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('devLogout')) return false;
    localStorage.removeItem(AUTH_MODE_KEY);
    localStorage.removeItem(SSO_EMAIL_KEY);
    localStorage.removeItem(SSO_NAME_KEY);
    url.searchParams.delete('devLogout');
    window.history.replaceState({}, '', url.pathname + (url.search === '?' ? '' : url.search) + url.hash);
    console.info('[devSignIn] cleared the local sign-in');
    return true;
  } catch {
    return false;
  }
}
