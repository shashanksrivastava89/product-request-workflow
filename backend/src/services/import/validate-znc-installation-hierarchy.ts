/**
 * ZNC (Installation) approval hierarchy bulk import → znc_approval_mapping.
 * Matches Excel exports: Group, Team Name, Sales Reps, SM → DSM → NSM → Technical Manager →
 * National TS manager → Local Finance Controller → Dir, Commercial Mgr.
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

export interface ValidatedZncInstallationHierarchyRow {
  rowIndex: number;
  requesterName: string;
  businessUnit: string;
  salesManager: string | null;
  districtSalesManager: string | null;
  nationalSalesManager: string | null;
  technicalManager: string | null;
  nationalTSManager: string | null;
  localFinanceController: string | null;
  directorCommercialManager: string | null;
}

function rowDataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);
}

function extractZncInstallationFromRow(row: Row): {
  groupRaw: string;
  teamRaw: string;
  requester: string;
  sm: string;
  dsm: string;
  nsm: string;
  tm: string;
  ntsm: string;
  lfc: string;
  dcm: string;
} {
  let groupRaw = '';
  let teamRaw = '';
  let requester = '';
  let sm = '';
  let dsm = '';
  let nsm = '';
  let tm = '';
  let ntsm = '';
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
    // Sales Reps / Requester before generic "sales manager"
    if (/sales\s*rep|requester|sales\s*reps\s*or|➊/.test(n)) {
      requester = val;
      continue;
    }
    // District / National before plain "Sales Manager" — headers contain "sales manager" as substring
    if (/district\s*sales\s*manager|➌/.test(n)) {
      dsm = val;
      continue;
    }
    // National FS manager (field service) — same DB field as National TS manager; must run before National Sales
    if (
      /national\s*fs\s*manager|national\s*fs\s*\(|national\s*fs\b/i.test(n) ||
      (/national\s*fs/i.test(n) && /manager|mgr/i.test(n))
    ) {
      ntsm = val;
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
    if (/technical\s*manager/i.test(n) || (/➎/.test(n) && /technical/i.test(n))) {
      tm = val;
      continue;
    }
    if (
      /national\s*ts\s*manager|nts\s*manager|national\s*ts\b/i.test(n) ||
      (/❻/.test(n) && /national|nts/i.test(n) && !/fs/i.test(n))
    ) {
      ntsm = val;
      continue;
    }
    // Local Financial Controller (not only "finance")
    if (/local\s*financ/i.test(n) || /local\s*finance|financd|➐/.test(n)) {
      lfc = val;
      continue;
    }
    if (/dir.*commercial|commercial\s*mgr|➑/.test(n)) {
      dcm = val;
      continue;
    }
  }

  return { groupRaw, teamRaw, requester, sm, dsm, nsm, tm, ntsm, lfc, dcm };
}

export function validateZncInstallationHierarchyRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedZncInstallationHierarchyRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedZncInstallationHierarchyRow[] = [];
  const seenKeys = new Set<string>();

  let lastBU: string | null = null;
  let lastTeamRaw = '';

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });

    const ex = extractZncInstallationFromRow(row);
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
    // Skip blank-after-normalize rows (invisible chars / formatting) without failing — same as empty.
    if (!requesterName) {
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
    const next: ValidatedZncInstallationHierarchyRow = {
      rowIndex: rowNum,
      requesterName,
      businessUnit: bu,
      salesManager: normApprover(ex.sm),
      districtSalesManager: normApprover(ex.dsm),
      nationalSalesManager: normApprover(ex.nsm),
      technicalManager: normApprover(ex.tm),
      nationalTSManager: normApprover(ex.ntsm),
      localFinanceController: normApprover(ex.lfc),
      directorCommercialManager: normApprover(ex.dcm),
    };

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
        'No rows to import. Each data row needs a requester name, or the header row was not recognized (row 1 must list Group, Sales Reps or Requester, Sales Manager, Technical Manager, etc.).',
      value: '',
    });
  }

  return { errors, validRows };
}
