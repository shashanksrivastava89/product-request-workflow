/**
 * Resolve the application login email from Microsoft Entra token claims.
 * Priority must stay aligned with `src/utils/ssoEmail.ts` on the frontend.
 *
 * Prefer the corporate mailbox (`email`) over UPN (`preferred_username` / `upn`).
 */
export function emailFromMicrosoftTokenClaims(claims: Record<string, unknown>): string | null {
    const candidates = [
        claims.email,
        claims.upn,
        claims.preferred_username,
        claims.unique_name,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.includes('@')) {
            return c.trim().toLowerCase();
        }
    }
    return null;
}
