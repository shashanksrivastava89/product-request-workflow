/**
 * Parse Excel (.xlsx) or CSV file to array of row objects (header keys).
 * Header row is detected when row 1 is a title row: we pick the best-scoring row among the first few rows.
 */

import * as XLSX from 'xlsx';
import fs from 'fs';
import type { ImportFileKind } from '../../utils/import-file-validation.util';

export type Row = Record<string, string | number | undefined>;

/** Metadata added by parser for multi-sheet Excel: sheet name and 1-based row number in that sheet */
export const ROW_META_SHEET = '__sheet';
export const ROW_META_ROW_IN_SHEET = '__rowInSheet';

export interface ParseOptions {
  /** For Excel: only parse these sheet names. Omit to parse all sheets. */
  sheetNames?: string[];
  /**
   * For Excel: headers whose cells are codes, not quantities. A number cell under one of them is read
   * as Excel shows it when that is the same number with leading zeros (01129 under a 00000 format),
   * because the raw value has already lost them. Every other column reads raw values as before.
   */
  textColumns?: string[];
}

export function parseImportFile(
  filePath: string,
  fileKind: ImportFileKind,
  options?: ParseOptions
): { headers: string[]; rows: Row[]; parsedSheetNames?: string[] } {
  if (fileKind === 'xlsx') {
    return parseXlsx(filePath, options?.sheetNames, options?.textColumns);
  }
  return parseCsv(filePath);
}

/**
 * The zero-padded text Excel displays for a number cell, when that is all the display adds: "01129"
 * for 1129 shown through a 00000 format. Anything else (a General-format number, "1.2E+13", a price
 * with separators) returns undefined and the raw value is used.
 */
export function zeroPaddedCellText(cell: XLSX.CellObject | undefined): string | undefined {
  if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || typeof cell.w !== 'string') return undefined;
  const raw = String(cell.v);
  const shown = cell.w.trim();
  if (!/^\d+$/.test(raw) || !/^0\d*$/.test(shown) || shown.length <= raw.length) return undefined;
  return shown.replace(/^0+/, '') === raw.replace(/^0+/, '') ? shown : undefined;
}

/**
 * Get sheet names and row count per sheet without loading all cell data (uses !ref for Excel).
 */
export function getSheetInfo(
  filePath: string,
  fileKind: ImportFileKind
): { sheetNames: string[]; rowCountPerSheet: Record<string, number> } {
  if (fileKind !== 'xlsx') {
    const { rows } = parseCsv(filePath);
    return { sheetNames: ['(CSV)'], rowCountPerSheet: { '(CSV)': rows.length } };
  }
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames || [];
  const rowCountPerSheet: Record<string, number> = {};
  for (const sheetName of sheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const ref = sheet['!ref'];
    if (ref) {
      try {
        const range = XLSX.utils.decode_range(ref);
        const totalRows = range.e.r - range.s.r + 1;
        rowCountPerSheet[sheetName] = totalRows > 0 ? totalRows - 1 : 0; // subtract header
      } catch {
        rowCountPerSheet[sheetName] = 0;
      }
    } else {
      rowCountPerSheet[sheetName] = 0;
    }
  }
  return { sheetNames, rowCountPerSheet };
}

/** Normalize sheet name for matching: trim and collapse inner spaces. */
function normalizeSheetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Heuristic: which row (0-based) in the sheet is the header row (customers, products, users). */
function scoreImportHeaderRow(row: string[]): number {
  const blob = row.map((c) => String(c ?? '').trim()).join(' | ').toLowerCase();
  let s = 0;
  if (/\bbusiness\s+group\b/.test(blob)) s += 2;
  if (/\b7\s*(degit|digit)\b/.test(blob)) s += 2;
  if (/\bsap\s*code\b/.test(blob)) s += 1;
  if (/\b(1st|first)\s*(degit|digit)\b/.test(blob)) s += 2;
  if (/\blocal\s+company\b/.test(blob) || /\bcompany\s+in\s+japanese\b/.test(blob)) s += 2;
  if (/\bglobal\s+company\b/.test(blob) || /\baccountname/.test(blob)) s += 1;
  if (/\bcustomer\s*type\b/.test(blob)) s += 2;
  if (/\bcustomer_group\b/.test(blob)) s += 1;
  if (/\bproduct\s+code\s+local\b/.test(blob)) s += 2;
  if (/\bsap\s+product\s+code\b/.test(blob)) s += 1;
  if (/\bproduct\s+name\s+local\b/.test(blob)) s += 1;
  if (/\blist\s+price\b/.test(blob)) s += 2;
  if (/\bcontract\s+price\b|\bcontrcat\s+price\b/.test(blob)) s += 2;
  if (/\bcontract\s+unit\s+price\b/.test(blob)) s += 1;
  if (/\bproduct\b/.test(blob) && /\bproduct\s+name\b/.test(blob) && /\blist\s+price\b/.test(blob)) s += 2;
  if (/\bemail\b/.test(blob) && /\brole\b/.test(blob)) s += 4;
  if (/\bsales\s*rep|sales\s*reps\s*or\s*requester|requester\b.*sales/.test(blob)) s += 2;
  if (/\bdistrict\s*sales\s*manager|➌/.test(blob)) s += 2;
  if (/\bnationa\s*sales|national\s*sales\s*manager|❹/.test(blob)) s += 2;
  if (/\blocal\s*finance|financd|➎/.test(blob)) s += 2;
  if (/\bdir.*commercial|commercial\s*mgr|zsam\s*total|❻/.test(blob)) s += 2;
  if (/\btechnical\s*manager\b|national\s*ts|national\s*fs|nts\s*manager|znc\s*total/i.test(blob)) s += 2;
  if (/\bgroup\b/.test(blob) && /\bteam\s*name\b/.test(blob) && /\bsales\s*rep|requester/i.test(blob)) s += 1;
  if (/\bcs\s*\/\s*ps|cs\s*ps|raqa|global\s*raqa|claim\s*replacement|znc\s*total/i.test(blob)) s += 2;
  if (/\bzint|zint\s*for\s*qc|zint\s*total|1\.5\s*000|1,500\s*000/i.test(blob)) s += 2;
  if (/\bgs\s*\/\s*fs\b|\bgs\s*fs\b/i.test(blob)) s += 2;
  if (/❶|❷|❸|❺|❻|❼|➊|➋|➌|➎|➐/.test(blob)) s += 1;
  return s;
}

function pickHeaderRowIndex(data: string[][]): number {
  const max = Math.min(5, data.length);
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < max; r++) {
    const sc = scoreImportHeaderRow(data[r] || []);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  if (bestScore < 2) return 0;
  return best;
}

function parseXlsx(
  filePath: string,
  onlySheetNames?: string[],
  textColumns?: string[]
): { headers: string[]; rows: Row[]; parsedSheetNames?: string[] } {
  const textKeys = new Set((textColumns ?? []).map((h) => normalizeHeaderKey(h).toLowerCase()));
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  let sheetNames = wb.SheetNames || [];
  if (onlySheetNames && onlySheetNames.length > 0) {
    const requested = onlySheetNames.map((s) => normalizeSheetName(s)).filter(Boolean);
    const requestedSet = new Set(requested);
    sheetNames = sheetNames.filter((name) => {
      const n = normalizeSheetName(name);
      return requestedSet.has(n);
    });
  }
  const allRows: Row[] = [];
  let headers: string[] = [];
  const parsedSheetNames = sheetNames.slice();

  for (const sheetName of sheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
    if (data.length === 0) continue;
    const headerRowIndex = pickHeaderRowIndex(data);
    const headerRow = data[headerRowIndex].map((h) => String(h ?? '').trim());
    const sheetHeaders: string[] = [];
    const seenHeader = new Set<string>();
    for (const h of headerRow) {
      const k = normalizeHeaderKey(h);
      if (!k.length || seenHeader.has(k)) continue;
      seenHeader.add(k);
      sheetHeaders.push(k);
    }
    if (headers.length === 0) headers = sheetHeaders;
    // sheet_to_json with header:1 keeps blank rows, so data[i] is sheet row range.s.r + i.
    const origin = XLSX.utils.decode_range(sheet['!ref'] as string).s;
    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i];
      const obj: Row = {};
      const colCount = Math.max(headerRow.length, row?.length ?? 0);
      for (let c = 0; c < colCount; c++) {
        const rawHeader = c < headerRow.length ? headerRow[c] : '';
        if (!rawHeader) continue;
        const key = normalizeHeaderKey(rawHeader);
        if (!key) continue;
        const raw = row?.[c];
        let val = raw === undefined || raw === null ? '' : String(raw).trim();
        if (textKeys.has(key.toLowerCase()) && typeof raw === 'number') {
          const cell = sheet[XLSX.utils.encode_cell({ r: origin.r + i, c: origin.c + c })] as XLSX.CellObject | undefined;
          val = zeroPaddedCellText(cell) ?? val;
        }
        if (val === '-' || val.toLowerCase() === 'blank') val = '';
        obj[key] = val;
      }
      obj[ROW_META_SHEET] = sheetName;
      obj[ROW_META_ROW_IN_SHEET] = i + 1; // 1-based Excel row number
      allRows.push(obj);
    }
  }

  return { headers, rows: allRows, parsedSheetNames };
}

function parseCsv(filePath: string): { headers: string[]; rows: Row[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headerLine = lines[0];
  const headers = splitCsvLine(headerLine);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    const obj: Row = {};
    headers.forEach((key, c) => {
      let val = parts[c] ?? '';
      if (val === '-' || val.toLowerCase() === 'blank') val = '';
      obj[key] = val;
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === ',' || ch === ';')) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Normalize Excel header text so "Business Group (correct)" matches even when Excel uses
 * fullwidth parentheses, odd spaces, BOM, or wrapped quotes.
 */
export function normalizeHeaderKey(s: string): string {
  let t = String(s ?? '')
    .trim()
    .replace(/^\uFEFF/, '');
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  t = t
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ');
  return t;
}

/**
 * Get value from row by header (case-insensitive; tolerates Excel punctuation variants).
 */
export function getCell(row: Row, ...possibleHeaders: string[]): string {
  const keys = Object.keys(row).filter((k) => k !== ROW_META_SHEET && k !== ROW_META_ROW_IN_SHEET);

  for (const h of possibleHeaders) {
    const want = normalizeHeaderKey(h).toLowerCase();
    const k = keys.find((x) => normalizeHeaderKey(x).toLowerCase() === want);
    if (k !== undefined) return String(row[k] ?? '').trim();
  }

  // Prefix match: "Business Group" matches "Business Group (correct)" / "Business Group2 (fixed)"
  const sorted = [...possibleHeaders].sort((a, b) => normalizeHeaderKey(b).length - normalizeHeaderKey(a).length);
  for (const h of sorted) {
    const want = normalizeHeaderKey(h).toLowerCase();
    const k = keys.find((x) => {
      const xn = normalizeHeaderKey(x).toLowerCase();
      return xn === want || xn.startsWith(`${want} `) || xn.startsWith(`${want}(`);
    });
    if (k !== undefined) return String(row[k] ?? '').trim();
  }

  return '';
}

const ROW_META_KEYS = new Set<string>([ROW_META_SHEET, ROW_META_ROW_IN_SHEET]);

function dataKeys(row: Row): string[] {
  return Object.keys(row).filter((k) => !ROW_META_KEYS.has(k));
}

/**
 * Match master-list style headers like "1 LSG/CDG" or "2 Requester Group" when the exact title is not used.
 * Finds the first column whose normalized header contains every word (e.g. lsg + cdg).
 */
export function getCellByHeaderContainsAll(row: Row, words: string[]): string {
  const lower = words.map((w) => w.toLowerCase().trim()).filter(Boolean);
  if (lower.length === 0) return '';
  for (const key of dataKeys(row)) {
    const xn = normalizeHeaderKey(key).toLowerCase();
    if (lower.every((w) => xn.includes(w))) return String(row[key] ?? '').trim();
  }
  return '';
}

/** Get sheet name and row-in-sheet from row (set when parsing multi-sheet Excel). */
export function getRowMeta(row: Row): { sheet?: string; rowInSheet?: number } {
  const sheet = row[ROW_META_SHEET];
  const rowInSheet = row[ROW_META_ROW_IN_SHEET];
  return {
    sheet: sheet !== undefined && sheet !== '' ? String(sheet) : undefined,
    rowInSheet: typeof rowInSheet === 'number' ? rowInSheet : undefined,
  };
}
