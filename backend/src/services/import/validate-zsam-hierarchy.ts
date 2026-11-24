/**
 * ZSAM approval hierarchy bulk import → zsamm_approval_mapping.
 * Matches Excel exports with columns like: Group, Team Name, Sales Reps or Requester, Sales Manager, …
 */

import { Row, getRowMeta, normalizeHeaderKey, ROW_META_ROW_IN_SHEET, ROW_META_SHEET } from './parser';
import {
  isEmptyOrSentinel,
  normApprover,
  normalizeRequesterNameForDb,
  normalizeSpreadsheetCell,
  parseGroupToBu,
} from './hierarchy-import-utils';
import {
  resolveTeamToRequesterGroupCode,
  suggestTeamNamesForBu,
} from './team-requester-group-map';

export interface ValidationError {
  row: number;
  column: string;
  message: string;
  value: string;
  sheet?: string;
  rowInSheet?: number;
}

export interface ValidatedZsammHierarchyRow {
  rowIndex: number;
  requesterName: string;
  businessUnit: string;
  /** Raw Team Name cell (after merged-cell carry-forward) */
  teamNameRaw: string | null;
  /** requester_groups.code when Team Name + Group resolved (e.g. cdg-7 for FAS LSG) */
  requesterGroupCode: string | null;
  /** Optional Sales Rep Code from file, or null → use existing DB / User at execute */
  salesRepCodeForSync: string | null;
  salesManager: string | null;
  districtSalesManager: string | null;
  nationalSalesManager: string | null;
  localFinanceController: string | null;
  directorCommercialManager: string | null;
}

function rowDataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);
}

/**
 * Map messy header text (Unicode bullets, newlines, typos) to approver fields.
 */
function extractZsammFromRow(row: Row): {
  groupRaw: string;
  teamRaw: string;
  requester: string;
  salesRepCode: string;
  sm: string;
  dsm: string;
  nsm: string;
  lfc: string;
  dcm: string;
} {
  let groupRaw = '';
  let teamRaw = '';
  let requester = '';
  let salesRepCode = '';
  let sm = '';
  let dsm = '';
  let nsm = '';
  let lfc = '';
  let dcm = '';

  for (const key of rowDataKeys(row)) {
    const n = normalizeHeaderKey(key).toLowerCase();
    const val = normalizeSpreadsheetCell(row[key]);
    if (/^no\.?$|^#$/.test(n) || n === 'no') continue;
    if (/\bgroup\b/.test(n) && !/customer/.test(n)) {
      groupRaw = val;
      continue;
    }
    if ((/team\s*name|^@team|⓪/.test(n) || /^team$/i.test(n)) && !/district/.test(n)) {
      teamRaw = val;
      continue;
    }
    // Must run before "Sales Reps or Requester" so "Sales Rep Code" is not captured as requester name
    if (/sales\s*rep\s*code|account\s*number|sap\s*rep\s*code|^rep\s*code$/i.test(n)) {
      salesRepCode = val;
      continue;
    }

    if (/district\s*sales\s*manager|➌/.test(n)) {
      dsm = val;
      continue;
    }
    if (/national\s*sales\s*manager|nationa\s*sales|❹/.test(n)) {
      nsm = val;
      continue;
    }
    if (/local\s*finance|financd|➎/.test(n)) {
      lfc = val;
      continue;
    }
    if (/dir.*commercial|commercial\s*mgr|director.*commercial|❻/.test(n)) {
      dcm = val;
      continue;
    }
    if (/sales\s*manager|➋/.test(n)) {
      sm = val;
      continue;
    }
    if (/sales\s*rep|requester|sales\s*reps\s*or|➊/.test(n)) {
      requester = val;
      continue;
    }
  }

  return { groupRaw, teamRaw, requester, salesRepCode, sm, dsm, nsm, lfc, dcm };
}

export function validateZsammHierarchyRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedZsammHierarchyRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedZsammHierarchyRow[] = [];
  const seenKeys = new Set<string>();

  let lastBU: string | null = null;
  let lastTeamRaw = '';

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });

    const ex = extractZsammFromRow(row);
    const buFromCell = parseGroupToBu(ex.groupRaw);
    if (buFromCell !== null) lastBU = buFromCell;
    const bu = buFromCell ?? lastBU;

    if (!isEmptyOrSentinel(ex.teamRaw)) {
      lastTeamRaw = normalizeSpreadsheetCell(ex.teamRaw);
    }
    const teamEffective = !isEmptyOrSentinel(ex.teamRaw) ? normalizeSpreadsheetCell(ex.teamRaw) : lastTeamRaw;

    if (isEmptyOrSentinel(ex.requester)) {
      return;
    }

    const requesterName = normalizeRequesterNameForDb(ex.requester);
    if (!requesterName) {
      err({ row: rowNum, column: 'Sales Reps or Requester', message: 'Required', value: ex.requester });
      return;
    }

    if (bu == null) {
      err({
        row: rowNum,
        column: 'Group',
        message: 'Set CDG or LSG (or repeat from a row above that has Group filled)',
        value: ex.groupRaw,
      });
      return;
    }

    if (isEmptyOrSentinel(teamEffective)) {
      err({
        row: rowNum,
        column: 'Team Name',
        message:
          'Set Team Name (or repeat from a row above when Excel uses merged cells). Needed to place the requester in the correct requester group.',
        value: '',
      });
      return;
    }

    const buKey = bu as 'CDG' | 'LSG';
    const resolved = resolveTeamToRequesterGroupCode(teamEffective, buKey);
    if (!resolved.code) {
      const hints = suggestTeamNamesForBu(buKey, 10).join(', ');
      err({
        row: rowNum,
        column: 'Team Name',
        message: `No requester group matches "${teamEffective}" for ${bu}. Check spelling (e.g. FAS, IA, DA1). Examples for ${bu}: ${hints}.`,
        value: teamEffective,
      });
      return;
    }

    const repCodeRaw = normalizeSpreadsheetCell(ex.salesRepCode);
    const salesRepCodeForSync =
      !isEmptyOrSentinel(ex.salesRepCode) && repCodeRaw ? repCodeRaw : null;

    const key = `${bu}|${requesterName}`;
    if (seenKeys.has(key)) {
      err({
        row: rowNum,
        column: 'Sales Reps or Requester',
        message: 'Duplicate Group + requester in file',
        value: key,
      });
      return;
    }
    seenKeys.add(key);

    validRows.push({
      rowIndex: rowNum,
      requesterName,
      businessUnit: bu,
      teamNameRaw: teamEffective,
      requesterGroupCode: resolved.code,
      salesRepCodeForSync,
      salesManager: normApprover(ex.sm),
      districtSalesManager: normApprover(ex.dsm),
      nationalSalesManager: normApprover(ex.nsm),
      localFinanceController: normApprover(ex.lfc),
      directorCommercialManager: normApprover(ex.dcm),
    });
  });

  if (validRows.length === 0 && rows.length > 0) {
    errors.push({
      row: 2,
      column: 'Sales Reps or Requester',
      message:
        'No rows to import. Each data row needs a requester name, or the header row was not recognized (row 1 must list Group, Sales Reps or Requester, Sales Manager, etc.).',
      value: '',
    });
  }

  return { errors, validRows };
}
