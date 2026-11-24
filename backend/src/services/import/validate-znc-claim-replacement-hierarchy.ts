/**
 * ZNC Claim Replacement approval hierarchy bulk import → zncclaim_approval_mapping.
 * Columns: SM → DSM → NSM → CS/PS manager → RAQA (always) + Global RAQA (when claim total > ¥1.5M).
 */

import { Row, getRowMeta, normalizeHeaderKey, ROW_META_ROW_IN_SHEET, ROW_META_SHEET } from './parser';
import {
  isEmptyOrSentinel,
  normApprover,
  normalizeRequesterNameForDb,
  normalizeSpreadsheetCell,
  parseGroupToBu,
  parseTeamNameHintToBu,
} from './hierarchy-import-utils';
import type { ValidationError } from './validate-zsam-hierarchy';

export interface ValidatedZncClaimReplacementHierarchyRow {
  rowIndex: number;
  requesterName: string;
  businessUnit: string;
  salesManager: string | null;
  districtSalesManager: string | null;
  nationalSalesManager: string | null;
  csPsManager: string | null;
  raqaManager: string | null;
  globalRaqaManager: string | null;
}

function rowDataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);
}

function extractZncClaimReplacementFromRow(row: Row): {
  groupRaw: string;
  teamRaw: string;
  requester: string;
  sm: string;
  dsm: string;
  nsm: string;
  csPs: string;
  raqa: string;
  globalRaqa: string;
} {
  let groupRaw = '';
  let teamRaw = '';
  let requester = '';
  let sm = '';
  let dsm = '';
  let nsm = '';
  let csPs = '';
  let raqa = '';
  let globalRaqa = '';

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
    if (/sales\s*rep|requester|sales\s*reps\s*or|➊/.test(n)) {
      requester = val;
      continue;
    }
    // District / National before plain "Sales Manager" — headers contain "sales manager" as substring
    if (/district\s*sales\s*manager|➌/.test(n)) {
      dsm = val;
      continue;
    }
    if (/national\s*sales\s*manager|nationa\s*sales|❹/.test(n)) {
      nsm = val;
      continue;
    }
    if (/sales\s*manager|➋/.test(n)) {
      sm = val;
      continue;
    }
    if (
      /cs\s*\/\s*ps|cs\s*ps\s*manager|cs\/ps|csps/i.test(n) ||
      (/➎/.test(n) && /cs\s*\/\s*ps|cs\/ps|cs\s*ps/i.test(n))
    ) {
      csPs = val;
      continue;
    }
    // Global RAQA must be matched before plain RAQA (headers often contain both words)
    if (/global\s*raqa|global.*raqa|➐/.test(n)) {
      globalRaqa = val;
      continue;
    }
    if ((/raqa|❻/.test(n)) && !/global/.test(n)) {
      raqa = val;
      continue;
    }
  }

  return { groupRaw, teamRaw, requester, sm, dsm, nsm, csPs, raqa, globalRaqa };
}

export function validateZncClaimReplacementHierarchyRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedZncClaimReplacementHierarchyRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedZncClaimReplacementHierarchyRow[] = [];
  const seenKeys = new Set<string>();

  let lastBU: string | null = null;
  let lastTeamRaw = '';

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });

    const ex = extractZncClaimReplacementFromRow(row);
    if (!isEmptyOrSentinel(ex.teamRaw)) {
      lastTeamRaw = normalizeSpreadsheetCell(ex.teamRaw);
    }
    const teamEffective = !isEmptyOrSentinel(ex.teamRaw) ? normalizeSpreadsheetCell(ex.teamRaw) : lastTeamRaw;

    const buFromCell = parseGroupToBu(ex.groupRaw);
    const buFromTeam = parseTeamNameHintToBu(teamEffective);
    const resolved = buFromCell ?? buFromTeam ?? lastBU;
    if (buFromCell !== null) lastBU = buFromCell;
    else if (buFromTeam !== null) lastBU = buFromTeam;
    const bu = resolved;

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
        message:
          'Set CDG or LSG in Group, or use Team Name with (CDG)/(LSG), or repeat from a row above that has Group filled',
        value: ex.groupRaw,
      });
      return;
    }

    const key = `${bu}|${requesterName}`;
    const next: ValidatedZncClaimReplacementHierarchyRow = {
      rowIndex: rowNum,
      requesterName,
      businessUnit: bu,
      salesManager: normApprover(ex.sm),
      districtSalesManager: normApprover(ex.dsm),
      nationalSalesManager: normApprover(ex.nsm),
      csPsManager: normApprover(ex.csPs),
      raqaManager: normApprover(ex.raqa),
      globalRaqaManager: normApprover(ex.globalRaqa),
    };

    // Same requester can appear twice (e.g. different casing or repeated block). Last row wins.
    if (seenKeys.has(key)) {
      const idx = validRows.findIndex((r) => r.businessUnit === bu && r.requesterName === requesterName);
      if (idx >= 0) validRows[idx] = next;
      return;
    }
    seenKeys.add(key);
    validRows.push(next);
  });

  if (validRows.length === 0 && rows.length > 0) {
    errors.push({
      row: 2,
      column: 'Sales Reps or Requester',
      message:
        'No rows to import. Each data row needs a requester name, or the header row was not recognized (row 1 must list Group, Sales Reps or Requester, CS/PS manager, RAQA manager, etc.).',
      value: '',
    });
  }

  return { errors, validRows };
}
