/**
 * User bulk import validation.
 * Supports canonical columns and master-list style: EMAIL ADDRESS, AD Account Name, LSG/CDG,
 * Requester Group, UPDATE (preferred over Requester Group when set).
 */

import { Row, getCell, getCellByHeaderContainsAll, getRowMeta } from './parser';
import {
  resolveUserImportRequesterGroupLabel,
  suggestUserImportGroupHints,
  normalizeUserImportGroupLabel,
} from './team-requester-group-map';
import { normalizeSpreadsheetCell } from './hierarchy-import-utils';

export interface ValidationError {
  row: number;
  column: string;
  message: string;
  value: string;
  sheet?: string;
  rowInSheet?: number;
}

const ROLES = [
  'REQUESTER',
  'SALES_MANAGER',
  'DISTRICT_SALES_MANAGER',
  'NATIONAL_SALES_MANAGER',
  'FINANCE_CONTROLLER',
  'DIRECTOR_COMMERCIAL',
  'ADMIN',
  'CUSTOMER_SUPPORT',
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Placeholder text in UPDATE that must not be imported as a group */
const UPDATE_PLACEHOLDER_RE = /^(ID\s+NOT|TEL\s+TO|NOT\s+CO|N\/A\s*$|NA\s*$)/i;

/** Notes / statuses sometimes pasted in UPDATE instead of a real requester group name */
const UPDATE_STATUS_NOTE_RE = /^(DID\s+NOT\s+COME|CANCEL\s+TO\s+CHANGE|DO\s+NOT\s+CHANGE|TBD|PENDING)\s*$/i;

export interface ValidatedUserRow {
  rowIndex: number;
  email: string;
  name: string;
  role: string;
  businessUnit: string | null;
  salesRepCode: string | null;
  /** Resolved requester_groups.code (e.g. cdg-7). Null = do not change group on this row. */
  requesterGroupCode: string | null;
  defaultPassword: string | null;
  /** True when both UPDATE and Requester Group are empty — leave existing DB group unchanged. */
  skipRequesterGroupUpdate: boolean;
}

function normalizeSalesRepCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = normalizeSpreadsheetCell(raw);
  if (!t || /^na$/i.test(t) || /^n\/a$/i.test(t) || /^nan$/i.test(t)) return null;
  return t.replace(/^0+(?=\d)/, '') || t;
}

function normalizeBusinessUnit(raw: string | null | undefined): string | null {
  const t = normalizeSpreadsheetCell(raw ?? '');
  if (!t) return null;
  const u = t.toUpperCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, '');
  if (u === 'CDG/LSG') return 'CDG/LSG';
  if (u === 'CDG') return 'CDG';
  if (u === 'LSG') return 'LSG';
  return null;
}

export function validateUserRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedUserRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedUserRow[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });

    const email = getCell(row, 'Email', 'email', 'EMAIL ADDRESS', 'Email Address');
    const name = getCell(row, 'Name', 'name');
    const role = getCell(row, 'Role', 'role').toUpperCase().replace(/\s/g, '_');

    const businessUnitRaw =
      getCell(row, 'Business Unit', 'business unit') ||
      getCell(row, 'LSG/CDG', 'LSG CDG') ||
      getCellByHeaderContainsAll(row, ['lsg', 'cdg']);
    const businessUnit = normalizeBusinessUnit(businessUnitRaw);

    const salesRepCode = normalizeSalesRepCode(
      getCell(row, 'Sales Rep Code', 'sales rep code', 'AD Account Name', 'AD Account', 'ad account name')
    );

    const updateCol = getCell(row, 'UPDATE', 'Update', 'update');
    const requesterGroupCol =
      getCell(row, 'Requester Group', 'requester group') || getCellByHeaderContainsAll(row, ['requester', 'group']);
    const legacyGroupCode = getCell(row, 'Requester Group Code', 'requester group code').trim();
    const effectiveGroupRaw = updateCol.trim() || requesterGroupCol.trim();

    if (updateCol.trim() && UPDATE_PLACEHOLDER_RE.test(updateCol.trim())) {
      err({
        row: rowNum,
        column: 'UPDATE',
        message:
          'Replace placeholder text in UPDATE with a real requester group name (e.g. FAS, DA1), or clear the cell.',
        value: updateCol,
      });
      return;
    }

    if (updateCol.trim() && UPDATE_STATUS_NOTE_RE.test(updateCol.trim())) {
      err({
        row: rowNum,
        column: 'UPDATE',
        message:
          'UPDATE must be a real requester group label (e.g. KINKI, FAS, RAQA), not a status note. Clear the cell to leave the user’s current group unchanged.',
        value: updateCol,
      });
      return;
    }

    const defaultPassword =
      getCell(row, 'Default Password', 'default password') || null;

    let hasError = false;

    if (!email) {
      err({ row: rowNum, column: 'Email', message: 'Required', value: '' });
      hasError = true;
    } else if (!EMAIL_RE.test(email)) {
      err({
        row: rowNum,
        column: 'Email',
        message: 'Invalid email format',
        value: email,
      });
      hasError = true;
    }

    if (seenEmails.has(email.toLowerCase())) {
      err({
        row: rowNum,
        column: 'Email',
        message: 'Duplicate email in file',
        value: email,
      });
      hasError = true;
    }
    if (email) seenEmails.add(email.toLowerCase());

    if (!name) {
      err({ row: rowNum, column: 'Name', message: 'Required', value: name });
      hasError = true;
    }

    if (!role) {
      err({ row: rowNum, column: 'Role', message: 'Required', value: role });
      hasError = true;
    } else if (!ROLES.includes(role)) {
      err({
        row: rowNum,
        column: 'Role',
        message: `Must be one of: ${ROLES.join(', ')}`,
        value: role,
      });
      hasError = true;
    }

    if (businessUnitRaw.trim() && !businessUnit) {
      err({
        row: rowNum,
        column: 'LSG/CDG',
        message: 'Must be CDG, LSG, or CDG/LSG if provided',
        value: businessUnitRaw,
      });
      hasError = true;
    }

    let requesterGroupCode: string | null = null;
    let skipRequesterGroupUpdate = false;

    if (legacyGroupCode && /^cdg-\d+$/i.test(legacyGroupCode) && !effectiveGroupRaw.trim()) {
      requesterGroupCode = legacyGroupCode.toLowerCase();
      skipRequesterGroupUpdate = false;
    } else if (!effectiveGroupRaw.trim()) {
      skipRequesterGroupUpdate = true;
    } else {
      const lsgCdgForResolve = businessUnitRaw || 'LSG';
      const resolved = resolveUserImportRequesterGroupLabel(effectiveGroupRaw, lsgCdgForResolve);
      if (!resolved.code) {
        const hints = suggestUserImportGroupHints(lsgCdgForResolve, 12).join(', ');
        const norm = normalizeUserImportGroupLabel(effectiveGroupRaw);
        err({
          row: rowNum,
          column: updateCol.trim() ? 'UPDATE' : 'Requester Group',
          message: `Unknown requester group "${norm || effectiveGroupRaw}". Use a known label for your LSG/CDG column (examples: ${hints}). You can also use Requester Group Code (e.g. cdg-7) when UPDATE/Requester Group are empty.`,
          value: effectiveGroupRaw,
        });
        hasError = true;
      } else {
        requesterGroupCode = resolved.code;
      }
    }

    if (!hasError) {
      validRows.push({
        rowIndex: rowNum,
        email,
        name,
        role,
        businessUnit: businessUnit || null,
        salesRepCode,
        requesterGroupCode,
        defaultPassword,
        skipRequesterGroupUpdate,
      });
    }
  });

  return { errors, validRows };
}
