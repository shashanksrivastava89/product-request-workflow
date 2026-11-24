/**
 * Normalise the product master: the Power BI material master export, and nothing else.
 *
 * Since 8 Oct 2026 the export is the only way products enter the app (the old per-unit price-list
 * layouts and their upsert import are gone), so a file in any other layout is refused outright.
 */

import { Row, getCell, getRowMeta, normalizeHeaderKey } from './parser';

/**
 * The Power BI master-data export (SAP -> Snowflake -> Power BI), agreed in the JAPAN AUTOMATION
 * UPDATE review on 2026-08-27. One file covers CDG and LSG:
 *
 *   BU | MaterialNumber | GS1 | MaterialName | ListPrice | ContractPrice | PricingG | PriceRate |
 *   DCHAIN | ServiceFlag
 *
 * Rules:
 *
 *  - GS1 is the locally-assigned product code and exists for CDG only. It is taken as it is, whatever
 *    its form (8 Oct 2026: "even if it is not 5 digits, keep it"); a blank GS1 falls back to
 *    MaterialNumber (the SAP code), because the app requires a product code. LSG rows ignore it.
 *  - ContractPrice blank while ListPrice is present -> copy ListPrice across. Contract price drives
 *    the ¥3M sample-request approval threshold, so a blank there would silently change routing.
 *  - ListPrice of 0, 1 or blank means "do not use this code" — marketing sets those deliberately.
 *    Those rows are dropped, not failed: they are expected, not mistakes, and the product leaves the
 *    app. A list price that is not a number is a defect in the report, so it is an error instead.
 *  - DCHAIN (SAP product status Y1/Y3/Y5/Y7/Y8/Y9) is stored, not acted on. A status filter was
 *    considered and rejected in favour of the price rule above.
 *  - PricingG populates priceGroup for both business units. The file is the master, so a blank
 *    PricingG clears the stored group; only a file without the column at all leaves it alone.
 *  - PriceRate (ListPrice x PriceRate = ContractPrice) is informational; nothing consumes it.
 *  - The "Applied filters" footer row is metadata, reported separately and never counted as a row.
 *  - Prices are rounded to two decimals, half-up, so float noise never shows as a price change.
 */
const POWER_BI_MARKER_HEADERS = ['MaterialNumber', 'MaterialName'];

/**
 * Every header the Power BI export is read by, in one place, so a renamed report column is a
 * one-line change here and not a change to the rules below.
 */
export const POWER_BI_COLUMNS = {
  businessGroup: ['BU', 'Business Group', 'Business Unit'],
  materialNumber: ['MaterialNumber', 'Material Number'],
  gs1: ['GS1', 'GS 1'],
  materialName: ['MaterialName', 'Material Name'],
  listPrice: ['ListPrice', 'List Price'],
  contractPrice: ['ContractPrice', 'Contract Price'],
  pricingGroup: ['PricingG', 'Pricing G', 'Pricing Group', 'Price Group'],
  priceRate: ['PriceRate', 'Price Rate'],
  dchain: ['DCHAIN', 'D Chain'],
  serviceFlag: ['ServiceFlag', 'Service Flag'],
} as const;

/** The columns the export (and the app's own download) is laid out in, in order. */
export const POWER_BI_LAYOUT = ['BU', 'MaterialNumber', 'GS1', 'MaterialName', 'ListPrice', 'ContractPrice', 'PricingG', 'PriceRate', 'DCHAIN', 'ServiceFlag'] as const;

/** Columns that hold codes: an Excel number cell there is read as displayed, so a leading 0 survives. */
export const POWER_BI_CODE_COLUMNS: string[] = [...POWER_BI_COLUMNS.materialNumber, ...POWER_BI_COLUMNS.gs1];

/**
 * The export ends with a footer row such as "Applied filters:\nDCHAIN is Y5, Y6, Y7, or Y9" in the
 * first column. It is metadata about the report, not a product: it must never count as a skipped
 * or invalid row, and the sync checks it against the filter the business agreed on.
 */
const APPLIED_FILTERS_PREFIX = /^applied filters?\s*:/i;

export function appliedFilterFromRow(row: Row): string | null {
  for (const key of Object.keys(row)) {
    const value = String(row[key] ?? '').trim();
    if (APPLIED_FILTERS_PREFIX.test(value)) {
      return value.replace(APPLIED_FILTERS_PREFIX, '').replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

/** True when the sheet is the Power BI master export. */
export function isPowerBiMasterFormat(rows: Row[]): boolean {
  const sample = rows[0];
  if (!sample) return false;
  return POWER_BI_MARKER_HEADERS.some((h) => getCell(sample, h) !== '' || h in sample);
}

/** True when the row carries one of these headers at all, blank or not. */
function hasColumn(row: Row, headers: readonly string[]): boolean {
  const wanted = new Set(headers.map((h) => normalizeHeaderKey(h).toLowerCase()));
  return Object.keys(row).some((k) => wanted.has(normalizeHeaderKey(k).toLowerCase()));
}

/**
 * Money to two decimals, half-up, with the float noise the export carries stripped first
 * (15119.999999999998 is 15120; 1235 x 0.955 = 1179.425 is 1179.43). The catalogue stores
 * DECIMAL(15,2), so this is also what makes a re-import of unchanged prices compare equal.
 */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ValidationError {
  row: number;
  column: string;
  message: string;
  value: string;
  sheet?: string;
  rowInSheet?: number;
}

const BUSINESS_GROUPS = ['CDG', 'LSG'];

export interface ValidatedProductRow {
  rowIndex: number;
  businessGroup: string;
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price: number;
  listPrice: number;
  /** From PricingG: '' when blank (clears the stored group), undefined when the file has no such column. */
  priceGroup?: string;
  /** "Service" / "Non-Service". Stored, not acted on. Same blank/absent rule as priceGroup. */
  serviceFlag?: string;
  /** SAP product status (Y5 on sale ... Y9 retired). Stored, not acted on. Same blank/absent rule. */
  dchain?: string;
}

/**
 * Two rows that resolve to the same (business group, product code). GS1 and MaterialNumber share a
 * namespace, so a Non-Service row's GS1 can equal a Service row's MaterialNumber: two DIFFERENT
 * products colliding. Neither is written (the sync holds the code back) and the operator is told,
 * because a lost product looks like nothing at all.
 */
export interface DuplicateProductKey {
  businessGroup: string;
  code: string;
  /** Row numbers that collided, in file order. */
  rows: number[];
  /** Names of the colliding rows — identical names mean a harmless repeat. */
  names: string[];
}

/** A row the master-data rules drop on purpose. Not an error — reported so the count adds up. */
export interface SkippedProductRow {
  row: number;
  code: string;
  reason: string;
  sheet?: string;
  rowInSheet?: number;
}

/**
 * A row that failed validation, by the keys it would have matched a product on. The sync never
 * removes a product because its row was unreadable: a report defect is not a business decision.
 */
export interface InvalidProductRow {
  row: number;
  businessGroup: string;
  code: string;
  sapCode: string;
  reason: string;
}

/** Parse price / list price cells: commas, yen symbols, optional spaces. */
function parseMoneyCell(raw: string): { n: number; empty: boolean; invalid: boolean } {
  const t = String(raw ?? '')
    .trim()
    .replace(/^﻿/, '');
  if (!t) return { n: 0, empty: true, invalid: false };

  const cleaned = t
    .replace(/[ 　]/g, '')
    .replace(/[¥￥$€£]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (cleaned === '') return { n: NaN, empty: false, invalid: true };
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) return { n, empty: false, invalid: true };
  return { n, empty: false, invalid: false };
}

/** Why a file is refused before any row is read. */
export const NOT_POWER_BI_MESSAGE = `This is not the Power BI material master export. Expected the columns ${POWER_BI_LAYOUT.join(', ')}.`;

export function validateProductRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedProductRow[];
  skipped: SkippedProductRow[];
  duplicates: DuplicateProductKey[];
  invalid: InvalidProductRow[];
  /** True when the sheet was recognised as the Power BI master export; nothing is read otherwise. */
  powerBi: boolean;
  /** The export's "Applied filters" footer, when it carried one. */
  appliedFilter?: string;
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedProductRow[] = [];
  const skipped: SkippedProductRow[] = [];
  const invalid: InvalidProductRow[] = [];
  const seenKeys = new Set<string>();
  const collisions = new Map<string, DuplicateProductKey>();
  let appliedFilter: string | undefined;

  if (!isPowerBiMasterFormat(rows)) {
    return {
      errors: [{ row: 1, column: 'Header', message: NOT_POWER_BI_MESSAGE, value: '' }],
      validRows,
      skipped,
      duplicates: [],
      invalid,
      powerBi: false,
    };
  }

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const meta = getRowMeta(row);
    const rowErrors: ValidationError[] = [];
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) => rowErrors.push({ ...e, ...meta });

    const footer = appliedFilterFromRow(row);
    if (footer !== null) {
      appliedFilter = footer;
      return;
    }

    const businessGroup = getCell(row, ...POWER_BI_COLUMNS.businessGroup).toUpperCase();
    const materialNumber = getCell(row, ...POWER_BI_COLUMNS.materialNumber);
    const gs1 = getCell(row, ...POWER_BI_COLUMNS.gs1);
    // GS1 is CDG-only and often blank; the SAP material number is the fallback product code.
    const code = businessGroup === 'CDG' && gs1 ? gs1 : materialNumber;
    const sapCode = materialNumber;
    // MaterialName is Japanese only - there is no English version - so it fills both name fields.
    const name = getCell(row, ...POWER_BI_COLUMNS.materialName);
    const productNameLocal = name;

    const listPriceStr = getCell(row, ...POWER_BI_COLUMNS.listPrice);
    let priceStr = getCell(row, ...POWER_BI_COLUMNS.contractPrice);
    if (!priceStr.trim() && listPriceStr.trim() && !parseMoneyCell(listPriceStr).invalid) {
      // Contract price feeds the ¥3M sample threshold, so it must never be left blank.
      priceStr = listPriceStr;
    }

    const listParsed = parseMoneyCell(listPriceStr);
    // Blank, 0 and 1 are marketing's "do not use this code": dropped on purpose, and in a sync the
    // product is removed. A value that is not a number is a defect in the report, so it is an error
    // instead - and an error never removes anything.
    if (!listParsed.invalid && (listParsed.empty || listParsed.n === 0 || listParsed.n === 1)) {
      skipped.push({
        row: rowNum,
        code,
        reason: listParsed.empty ? 'List price blank' : `List price ${listParsed.n}`,
        ...meta,
      });
      return;
    }

    if (!businessGroup) {
      err({ row: rowNum, column: 'BU', message: 'Required', value: '' });
    } else if (!BUSINESS_GROUPS.includes(businessGroup)) {
      err({ row: rowNum, column: 'BU', message: 'Must be CDG or LSG', value: businessGroup });
    }
    if (!materialNumber) {
      err({ row: rowNum, column: 'MaterialNumber', message: 'Required', value: '' });
    }
    if (!name) {
      err({ row: rowNum, column: 'MaterialName', message: 'Required', value: '' });
    }

    const priceParsed = parseMoneyCell(priceStr);
    if (!priceParsed.empty && priceParsed.invalid) {
      err({ row: rowNum, column: 'ContractPrice', message: 'Must be a non-negative number', value: priceStr });
    }
    if (listParsed.invalid) {
      err({ row: rowNum, column: 'ListPrice', message: 'Must be a non-negative number', value: listPriceStr });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      if (BUSINESS_GROUPS.includes(businessGroup) && (code || sapCode)) {
        invalid.push({
          row: rowNum,
          businessGroup,
          code,
          sapCode,
          reason: rowErrors.map((e) => `${e.column}: ${e.message}${e.value ? ` (${e.value})` : ''}`).join('; '),
        });
      }
      return;
    }

    const optional = (headers: readonly string[], transform: (s: string) => string = (s) => s): string | undefined =>
      hasColumn(row, headers) ? transform(getCell(row, ...headers).trim()) : undefined;
    const priceGroup = optional(POWER_BI_COLUMNS.pricingGroup);
    const serviceFlag = optional(POWER_BI_COLUMNS.serviceFlag);
    const dchain = optional(POWER_BI_COLUMNS.dchain, (s) => s.toUpperCase());

    const rowPayload: ValidatedProductRow = {
      rowIndex: rowNum,
      businessGroup,
      code,
      sapCode,
      name,
      productNameLocal,
      price: roundMoney(priceParsed.empty ? 0 : priceParsed.n),
      listPrice: roundMoney(listParsed.n),
      ...(priceGroup !== undefined ? { priceGroup } : {}),
      ...(serviceFlag !== undefined ? { serviceFlag } : {}),
      ...(dchain !== undefined ? { dchain } : {}),
    };

    const key = `${businessGroup}|${code}`;
    if (seenKeys.has(key)) {
      const idx = validRows.findIndex((r) => r.businessGroup === businessGroup && r.code === code);
      const existing = idx >= 0 ? validRows[idx] : undefined;
      const record = collisions.get(key) ?? {
        businessGroup,
        code,
        rows: existing ? [existing.rowIndex] : [],
        names: existing ? [existing.productNameLocal] : [],
      };
      record.rows.push(rowNum);
      record.names.push(productNameLocal);
      collisions.set(key, record);
      if (idx >= 0) validRows[idx] = rowPayload;
      return;
    }
    seenKeys.add(key);
    validRows.push(rowPayload);
  });

  return {
    errors,
    validRows,
    skipped,
    duplicates: [...collisions.values()],
    invalid,
    powerBi: true,
    ...(appliedFilter !== undefined ? { appliedFilter } : {}),
  };
}
