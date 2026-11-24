/**
 * Public (non-admin) UI: show SAP-style sales rep codes only when they are numeric
 * with 5–10 digits (e.g. 9002321). Otherwise hide the code (no "NA" placeholder).
 */

const NUMERIC_SALES_REP_CODE = /^\d{5,10}$/;

/** True when the code should be shown as a real code in end-user UI. */
export function hasDisplayableSalesRepCode(code: string | null | undefined): boolean {
  const c = String(code ?? '').trim();
  return NUMERIC_SALES_REP_CODE.test(c);
}

/** End-user sales rep field: digits when valid, otherwise empty (hidden). */
export function formatSalesRepCodeForPublicDisplay(code: string | null | undefined): string {
  const c = String(code ?? '').trim();
  return hasDisplayableSalesRepCode(c) ? c : '';
}

/** Label for requester dropdowns: "Name (code)" when numeric; otherwise name only. */
export function formatSalesRepOptionLabel(name: string, code: string | null | undefined): string {
  const n = String(name ?? '').trim();
  const c = String(code ?? '').trim();
  if (!n) return c;
  if (!hasDisplayableSalesRepCode(c)) return n;
  return `${n} (${c})`;
}

/** Requester line in hierarchy, summaries, print: "Name (code)" or name only. */
export function formatRequesterWithSalesRepCode(
  name: string | null | undefined,
  code: string | null | undefined
): string {
  const n = String(name ?? '').trim();
  if (!n) return 'Not selected';
  const c = formatSalesRepCodeForPublicDisplay(code);
  return c ? `${n} (${c})` : n;
}
