/**
 * Shared helpers for ZSAM / ZNC hierarchy spreadsheet imports.
 */

/** Excel may return numbers, null, or strings — normalize to a single trimmed display string. */
export function normalizeSpreadsheetCell(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'number') {
    if (Number.isNaN(raw)) return '';
    return String(raw);
  }
  return String(raw).replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True for visually empty cells and common “no approver” placeholders. */
export function isEmptyOrSentinel(s: string): boolean {
  const t = normalizeSpreadsheetCell(s);
  if (!t) return true;
  const lower = t.toLowerCase();
  if (
    lower === 'blank' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === 'null' ||
    lower === 'none' ||
    lower === '-' ||
    lower === '\u2014' ||
    lower === '\u2013'
  ) {
    return true;
  }
  if (/^[\u2010\u2011\u2012\u2013\u2014\u2212\-]$/.test(t)) return true;
  return false;
}

/** Approver fields: empty / Blank / dash → null (no person at that step). */
export function normApprover(val: string): string | null {
  if (isEmptyOrSentinel(val)) return null;
  return normalizeSpreadsheetCell(val);
}

export function normalizeRequesterNameForDb(s: string): string {
  return normalizeSpreadsheetCell(s).toUpperCase();
}

/** CDG / LSG from Group cell; null if empty. */
export function parseGroupToBu(raw: string): string | null {
  const t = normalizeSpreadsheetCell(raw);
  if (isEmptyOrSentinel(t)) return null;
  const s = t.toUpperCase();
  if (/\bLSG\b/.test(s) && !/\bCDG\b/.test(s)) return 'LSG';
  if (/\bCDG\b/.test(s)) return 'CDG';
  return null;
}

/**
 * CDG/LSG hints from Team Name when Group is blank (e.g. "FAS(CDG)", "FMM(CDG)").
 */
export function parseTeamNameHintToBu(raw: string): string | null {
  const t = normalizeSpreadsheetCell(raw).toUpperCase();
  if (!t) return null;
  const hasCdg = /\(CDG\)|\bCDG\b/.test(t);
  const hasLsg = /\(LSG\)|\bLSG\b/.test(t);
  if (hasCdg && hasLsg) return null;
  if (hasLsg) return 'LSG';
  if (hasCdg) return 'CDG';
  return null;
}
