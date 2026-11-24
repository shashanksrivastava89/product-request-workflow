/**
 * Match logged-in user to a row from GET /sales-reps (requesters in a group).
 * Uses SAP code when set; otherwise normalized full name (handles full-width space vs ASCII).
 */
export function normalizePersonName(s: string): string {
  return String(s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function filterSalesRepsToSelf<T extends { name: string; code: string }>(
  reps: T[],
  user: { name: string; salesRepCode?: string | null }
): T[] {
  const code = user.salesRepCode?.trim();
  if (code) {
    const hit = reps.find((r) => (r.code || '').trim() === code);
    return hit ? [hit] : [];
  }
  const un = normalizePersonName(user.name);
  const hit = reps.find((r) => normalizePersonName(r.name) === un);
  return hit ? [hit] : [];
}
