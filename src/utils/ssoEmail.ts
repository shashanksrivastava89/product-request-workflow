import type { AccountInfo } from '@azure/msal-browser';

function asEmail(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.trim().toLowerCase();
    return s.includes('@') ? s : null;
}

/**
 * Entra often signs you in with a UPN like contact-606544@outside.example or user@example.com,
 * while your app DB uses the corporate mailbox (e.g. first_last@example.com). The ID token `email`
 * claim, when present, usually matches the mailbox — prefer it over `username` / `preferred_username`.
 */
export function resolveAppEmailFromMsalAccount(account: AccountInfo): string | null {
    const c = account.idTokenClaims as Record<string, unknown> | undefined;
    return (
        asEmail(c?.email) ||
        asEmail(c?.upn) ||
        asEmail(c?.preferred_username) ||
        asEmail(account.username) ||
        null
    );
}
