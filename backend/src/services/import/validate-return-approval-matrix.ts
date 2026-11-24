/**
 * Return approval matrix bulk import → return_approval_mapping.
 *
 * The matrix Japan maintains had no bulk path at all: it was loaded once by a script that read
 * columns by index and ignored the header text, and edited one row at a time in the admin UI
 * thereafter. This validator reads it by header instead, against the one canonical column
 * definition the export also uses, so a file that came out of the app goes back in unchanged.
 *
 * Columns: No, Group, Team Name, Sales Reps or Requester, Reviewer, 1st, 2nd, Final, 4th, 5th.
 * Merged Group / Team Name cells carry down, as they do in the sheet and in every other hierarchy
 * importer here.
 */

import { Row, getRowMeta, ROW_META_ROW_IN_SHEET, ROW_META_SHEET } from './parser';
import {
  isEmptyOrSentinel,
  normalizeRequesterNameForDb,
  normalizeSpreadsheetCell,
} from './hierarchy-import-utils';
import {
  returnMatrixFieldForHeader,
  type ReturnMatrixFileRow,
} from './return-matrix-columns';
import type { ValidationError } from './validate-zsam-hierarchy';

export interface ValidatedReturnApprovalMatrixRow extends ReturnMatrixFileRow {
  rowIndex: number;
}

/**
 * The stored business unit for a Group cell.
 *
 * SERVICE first: the sheet writes it plainly, and it is the bucket the Technical Service teams sit
 * in whichever of (CDG) / (LSG) their team name is suffixed with.
 */
export function returnMatrixGroupToBu(raw: string): string | null {
  const g = normalizeSpreadsheetCell(raw).toUpperCase();
  if (!g || isEmptyOrSentinel(g)) return null;
  if (g === 'SERVICE' || g.startsWith('SERVICE')) return 'SERVICE';
  if (g.includes('LSG') && !g.includes('CDG')) return 'LSG';
  if (g.includes('CDG')) return 'CDG';
  return null;
}

/**
 * An approver cell as stored: upper case, with the sheet's placeholders read as empty.
 *
 * `PLACEHOLDER …` appears in the sheet where a post is vacant, and must not become an approver
 * name that no `users` row will ever match. An email is left exactly as typed - the Reviewer column
 * holds the shared P&OP mailbox, and upper-casing an address would break the lookup.
 */
export function normalizeReturnMatrixApprover(val: string): string | null {
  const t = normalizeSpreadsheetCell(val);
  if (isEmptyOrSentinel(t) || /^placeholder\b/i.test(t)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t;
  return normalizeRequesterNameForDb(t) || null;
}

function rowDataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);
}

/** Which of our fields each column of this sheet holds. Unknown columns are ignored. */
function mapHeaders(row: Row): Map<string, keyof ReturnMatrixFileRow | 'no'> {
  const out = new Map<string, keyof ReturnMatrixFileRow | 'no'>();
  for (const key of rowDataKeys(row)) {
    const field = returnMatrixFieldForHeader(key);
    if (field) out.set(key, field);
  }
  return out;
}

export function validateReturnApprovalMatrixRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedReturnApprovalMatrixRow[];
  /** True when the file has no Reviewer column, so the import must leave stored reviewers alone. */
  reviewerColumnPresent: boolean;
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedReturnApprovalMatrixRow[] = [];

  if (rows.length === 0) {
    return { errors, validRows, reviewerColumnPresent: false };
  }

  const headers = mapHeaders(rows[0]);
  const fields = new Set(headers.values());
  const reviewerColumnPresent = fields.has('reviewer');

  if (!fields.has('requesterName')) {
    errors.push({
      row: 1,
      column: 'Sales Reps or Requester',
      message:
        'Header row not recognised. Row 1 must name the columns: No, Group, Team Name, Sales Reps or Requester, Reviewer, 1st Approver, 2nd Approver, Final Approver, 4th Approver, 5th Approver. Export the matrix first and edit that file to be sure of the headings.',
      value: rowDataKeys(rows[0]).join(' | '),
    });
    return { errors, validRows, reviewerColumnPresent };
  }

  /*
   * Merged cells arrive empty on every row but the first of their block, so a blank cell usually
   * means "same as above".
   *
   * Team Name only carries down when the Group cell is blank too. In the sheet, Group is merged
   * across large blocks and Team Name across smaller ones inside them, so a continuation row has
   * both cells empty - while a row that states its Group and leaves Team empty is stating an empty
   * team. Without that condition our own export cannot be read back: it writes Group on every row,
   * and a row whose team is genuinely blank would inherit the team above it, arriving as a
   * different row from the one that was exported.
   *
   * The trade-off is a sheet that repeats Group on every row while merging Team: its teams would
   * read as blank. That is visible in the validate step's preview before anything is written, which
   * is what the two-phase flow is for.
   */
  let lastGroup = '';
  let lastTeam = '';
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (column: string, message: string, value: string) =>
      errors.push({ row: rowNum, column, message, value, ...meta });

    const cell = (field: keyof ReturnMatrixFileRow | 'no'): string => {
      for (const [key, f] of headers) {
        if (f === field) return normalizeSpreadsheetCell(row[key]);
      }
      return '';
    };

    const groupRaw = cell('businessUnit');
    const teamRaw = cell('teamName');
    if (groupRaw) lastGroup = groupRaw;
    if (teamRaw) lastTeam = teamRaw;
    const group = groupRaw || lastGroup;
    const team = teamRaw || (groupRaw ? '' : lastTeam);
    const requesterRaw = cell('requesterName');

    // A wholly blank row, or a repeated header inside a multi-block sheet.
    if (isEmptyOrSentinel(requesterRaw)) return;
    if (returnMatrixFieldForHeader(requesterRaw) === 'requesterName') return;
    if (/^placeholder\b/i.test(requesterRaw)) return;

    const requesterName = normalizeRequesterNameForDb(requesterRaw);
    if (!requesterName) {
      err('Sales Reps or Requester', 'Required', requesterRaw);
      return;
    }

    const businessUnit = returnMatrixGroupToBu(group);
    if (!businessUnit) {
      err(
        'Group',
        'Set CDG, LSG or SERVICE, or repeat it from a row above that has Group filled',
        group
      );
      return;
    }

    const next: ValidatedReturnApprovalMatrixRow = {
      rowIndex: rowNum,
      requesterName,
      businessUnit,
      // Part of the row's identity, and stored as an empty string rather than null so the unique
      // key holds - Postgres treats NULLs as distinct.
      teamName: normalizeSpreadsheetCell(team),
      reviewer: normalizeReturnMatrixApprover(cell('reviewer')),
      firstApprover: normalizeReturnMatrixApprover(cell('firstApprover')),
      secondApprover: normalizeReturnMatrixApprover(cell('secondApprover')),
      finalApprover: normalizeReturnMatrixApprover(cell('finalApprover')),
      fourthApprover: normalizeReturnMatrixApprover(cell('fourthApprover')),
      fifthApprover: normalizeReturnMatrixApprover(cell('fifthApprover')),
    };

    /*
     * A row with a requester and no approver at all is a row that cannot route anything. The sheet
     * does hold such rows - a person listed before their chain was decided - and importing one
     * would leave a requester whose submit finds a mapping and builds an empty path. Reported
     * rather than dropped, so whoever maintains the file learns about it.
     */
    const hasApprover = [
      next.firstApprover,
      next.secondApprover,
      next.finalApprover,
      next.fourthApprover,
      next.fifthApprover,
    ].some(Boolean);
    if (!hasApprover) {
      err(
        '1st Approver',
        'No approver on this row. A row needs at least one approver: the reviewer alone is not a route.',
        ''
      );
      return;
    }

    // Team name is part of the key, so the same person may legitimately appear more than once -
    // but not twice under the same team. Last row wins, as every other importer here does.
    const key = `${next.businessUnit}|${next.requesterName}|${next.teamName.toUpperCase()}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      validRows[existing] = next;
      return;
    }
    seen.set(key, validRows.length);
    validRows.push(next);
  });

  if (validRows.length === 0 && errors.length === 0) {
    errors.push({
      row: 2,
      column: 'Sales Reps or Requester',
      message: 'No rows to import. Every data row needs a requester name and a Group.',
      value: '',
    });
  }

  return { errors, validRows, reviewerColumnPresent };
}
