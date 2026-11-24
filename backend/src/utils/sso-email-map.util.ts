/**
 * Optional map when Microsoft sign-in UPN ≠ users.email in DB.
 * Format: comma-separated pairs contact-8f1cae@outside.example=contact-09bbf3@outside.example (case-insensitive keys).
 * Example: SSO_EMAIL_MAP=u119620@example.com=josiah_dearbhla@example.com
 */
export function mapIncomingSsoEmailToDbEmail(headerEmail: string): string {
    const normalized = headerEmail.trim().toLowerCase();
    const raw = process.env.SSO_EMAIL_MAP?.trim();
    if (!raw) return normalized;

    for (const segment of raw.split(',')) {
        const eq = segment.indexOf('=');
        if (eq <= 0) continue;
        const key = segment.slice(0, eq).trim().toLowerCase();
        const val = segment.slice(eq + 1).trim().toLowerCase();
        if (key && val && normalized === key) return val;
    }
    return normalized;
}
