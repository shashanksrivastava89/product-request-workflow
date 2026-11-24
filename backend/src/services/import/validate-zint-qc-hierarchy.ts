/**
 * ZINT for QC approval hierarchy bulk import → zint_approval_mapping.
 *
 * Two layouts (detected from headers):
 * - **zintMd** (default, matches ZINT_for_QC_TEST.md and common Excel): no separate Team Name column.
 *   Column “➊ Sales Reps or Requester” holds the **region / team** (merged cells carried down).
 *   Column “➋ Sales manager” holds the **requester’s name** (not the SM approver role; Blank elsewhere).
 * - **standard**: explicit Team Name (⓪ / @Team Name / “Team Name”) — then ➊ = requester, ➋ = SM approver.
 *
 * Columns: SM → DSM → NSM → CS/PS or GS/FS → RAQA (always) + Global RAQA (when total > ¥1.5M).
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

export interface ValidatedZintQcHierarchyRow {
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

type ZintQcImportLayout = 'standard' | 'zintMd';

function rowDataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);
}

/** True when the sheet has a dedicated team/region column (not the ZINT_for_QC two-column layout). */
function hasExplicitTeamNameColumn(headerKeys: string[]): boolean {
  return headerKeys.some((key) => {
    const n = normalizeHeaderKey(key).toLowerCase();
    if (/district|national|global/.test(n)) return false;
    if (/\bteam\s*name\b/.test(n)) return true;
    if (/^@team\b/.test(n)) return true;
    if (n === 'team') return true;
    if (/^⓪\s*team\b/i.test(n)) return true;
    return false;
  });
}

function detectZintQcLayout(rows: Row[]): ZintQcImportLayout {
  if (rows.length === 0) return 'zintMd';
  const keys = rowDataKeys(rows[0]);
  return hasExplicitTeamNameColumn(keys) ? 'standard' : 'zintMd';
}

function extractZintQcFromRow(row: Row, layout: ZintQcImportLayout): {
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
    if (
      (/\bteam\s*name\b|^@team\b|^team$/i.test(n) || /^⓪\s*team/i.test(n)) &&
      !/district|sales\s*rep|requester/.test(n)
    ) {
      teamRaw = val;
      continue;
    }
    if (/district\s*sales\s*manager|➌|❸/.test(n)) {
      dsm = val;
      continue;
    }
    if (/national\s*sales\s*manager|nationa\s*sales|❹/.test(n)) {
      nsm = val;
      continue;
    }
    if (/gs\s*\/\s*fs|gs\s*fs\s*manager/i.test(n)) {
      csPs = val;
      continue;
    }
    if (
      /cs\s*\/\s*ps|cs\s*ps\s*manager|cs\/ps|csps/i.test(n) ||
      (/➎|❺/.test(n) && /cs\s*\/\s*ps|cs\/ps|cs\s*ps/i.test(n))
    ) {
      csPs = val;
      continue;
    }
    if (/global\s*raqa|global.*raqa|➐|❼/.test(n)) {
      globalRaqa = val;
      continue;
    }
    if ((/raqa|❻/.test(n)) && !/global/.test(n)) {
      raqa = val;
      continue;
    }

    if (layout === 'zintMd') {
      if (/sales\s*rep|sales\s*reps\s*or|➊|❶/.test(n)) {
        teamRaw = val;
        continue;
      }
      if (/sales\s*manager|➋|❷/.test(n)) {
        requester = val;
        continue;
      }
      continue;
    }

    if (/sales\s*manager|➋|❷/.test(n)) {
      sm = val;
      continue;
    }
    if (/sales\s*rep|requester|sales\s*reps\s*or|➊|❶/.test(n)) {
      requester = val;
      continue;
    }
  }

  return { groupRaw, teamRaw, requester, sm, dsm, nsm, csPs, raqa, globalRaqa };
}

export function validateZintQcHierarchyRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedZintQcHierarchyRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedZintQcHierarchyRow[] = [];
  const seenKeys = new Set<string>();

  const layout = detectZintQcLayout(rows);
  const requesterColumnLabel =
    layout === 'zintMd' ? '➋ Sales manager (requester name)' : '➊ Sales Reps or Requester';

  let lastBU: string | null = null;
  let lastTeamRaw = '';

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });

    const ex = extractZintQcFromRow(row, layout);
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
      err({ row: rowNum, column: requesterColumnLabel, message: 'Required', value: ex.requester });
      return;
    }

    if (bu == null) {
      err({
        row: rowNum,
        column: 'Group',
        message:
          'Set CDG or LSG in Group, or use region/team text with (CDG)/(LSG), or repeat from a row above that has Group filled',
        value: ex.groupRaw,
      });
      return;
    }

    const key = `${bu}|${requesterName}`;
    const next: ValidatedZintQcHierarchyRow = {
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

    // Same person can appear twice in source files (e.g. ZINT_for_QC_TEST.md: MATIU RAHILLY + Matiu Rahilly;
    // KEEVA BEAKEY listed under RAQA(CDG) twice). Normalize to one row: **last row wins**.
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
      column: requesterColumnLabel,
      message:
        layout === 'zintMd'
          ? 'No rows to import. Each data row needs a requester name in ➋ Sales manager (ZINT QC layout: ➊ is region/team). Or add a Team Name column to use the alternate layout (➊ = requester).'
          : 'No rows to import. Each data row needs a requester name, or the header row was not recognized (row 1 must list Group, Team Name or Sales Reps or Requester, CS/PS or GS/FS manager, RAQA manager, etc.).',
      value: '',
    });
  }

  return { errors, validRows };
}
