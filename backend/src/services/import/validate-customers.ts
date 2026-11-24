/**
 * Validate customer import rows.
 * Column mapping per BULK-IMPORT-DETAILED-PLAN: Business Group, Customer Type, Code, SAP Code, Name (Japanese), etc.
 */

import { Row, getCell, getRowMeta } from './parser';

const BUSINESS_GROUPS = ['CDG', 'LSG'];
/** Raw values that mean "both CDG and LSG" – one validated row will be emitted per group. */
const COMPOUND_BUSINESS_GROUPS = ['CDG(LSG)', 'CDG/LSG', 'LSG(CDG)'];
const ALL_ALLOWED_BUSINESS_GROUP_RAW = [...BUSINESS_GROUPS, ...COMPOUND_BUSINESS_GROUPS];

/**
 * Normalize Business Group: single CDG/LSG or compound → array of 'CDG' | 'LSG'.
 * Compound values (CDG(LSG), CDG/LSG, LSG(CDG)) expand to [CDG, LSG] for SOLD-TO in both groups.
 */
function expandBusinessGroups(raw: string): ('CDG' | 'LSG')[] {
  const u = raw.trim().toUpperCase();
  if (u === 'CDG') return ['CDG'];
  if (u === 'LSG') return ['LSG'];
  if (COMPOUND_BUSINESS_GROUPS.includes(u)) return ['CDG', 'LSG'];
  return [];
}

const CUSTOMER_TYPE_MAP: Record<string, string> = {
  'sold-to': '1',
  'sold to': '1',
  soldto: '1',
  '1': '1',
  'end user': '8',
  'end-user': '8',
  enduser: '8',
  '8': '8',
  'ship-to': '2',
  'ship to': '2',
  shipto: '2',
  'direct delivery': '2',
  '2': '2',
};

export interface ValidationError {
  row: number;
  column: string;
  message: string;
  value: string;
  sheet?: string;
  rowInSheet?: number;
}

export interface ValidatedCustomerRow {
  rowIndex: number;
  businessGroup: string;
  firstDigit: string;
  code: string;
  sapCode: string;
  nameJp: string;
  nameEn: string;
  postalCode: string | null;
  prefecture: string | null;
  address: string | null;
  phone: string | null;
}

export function validateCustomerRows(rows: Row[]): {
  errors: ValidationError[];
  validRows: ValidatedCustomerRow[];
} {
  const errors: ValidationError[] = [];
  const validRows: ValidatedCustomerRow[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    const meta = getRowMeta(row);
    const rowNum = meta.rowInSheet ?? index + 2;
    const err = (e: Omit<ValidationError, 'sheet' | 'rowInSheet'>) =>
      errors.push({ ...e, row: meta.rowInSheet ?? e.row, ...meta });
    // Header aliases must match Excel exports (e.g. all_customer_data / master sheets use
    // "Business Group (correct)" not plain "Business Group").
    const businessGroupRaw = getCell(
      row,
      'Business Group (correct)',
      'Business Group2 (fixed)',
      'Business Group',
      'business group'
    ).trim();
    const businessGroupUpper = businessGroupRaw.toUpperCase();
    const customerTypeRaw = getCell(
      row,
      'Customer Type',
      'First Digit',
      'First Degit',
      '1st digit',
      '1st Digit',
      '1st degit',
      '1st Degit',
      'customer type',
      'first digit',
      'first degit'
    );
    let code = getCell(row, 'Code', '7 degit', '7 digit', 'code');
    const codeDigits = code.replace(/\D/g, '');
    if (codeDigits.length >= 7) code = codeDigits.slice(-7);
    let sapCode = getCell(row, 'SAP Code', 'sap code');
    const sapDigits = sapCode.replace(/\D/g, '');
    if (sapDigits.length >= 7) sapCode = sapDigits.slice(-7);
    /** Many exports repeat the 7-digit code in SAP when no separate SAP number exists. */
    if (!sapCode) sapCode = code;

    const nameJp = getCell(
      row,
      'Name (Japanese)',
      'Name Jp',
      'Company in Japanese Name',
      'Local Company name',
      'Local Company Name',
      'name (japanese)',
      'name jp',
      'company in japanese name',
      'local company name'
    );
    const nameEn = getCell(
      row,
      'Name (English)',
      'Name En',
      'AccountName_E',
      'Global Company Name',
      'Global company name',
      'name (english)',
      'name en',
      'accountname_e',
      'global company name'
    );
    const postalCode = getCell(row, 'Postal Code', 'postal code') || null;
    const prefecture = getCell(row, 'Prefecture', 'prefecture') || null;
    const address = getCell(row, 'Address', 'Japanese Address', 'address', 'japanese address') || null;
    const phone = getCell(row, 'Phone', 'Phone Number', 'phone', 'phone number') || null;

    let hasError = false;

    if (!businessGroupRaw) {
      err({ row: rowNum, column: 'Business Group', message: 'Required', value: '' });
      hasError = true;
    } else if (!ALL_ALLOWED_BUSINESS_GROUP_RAW.includes(businessGroupUpper)) {
      err({
        row: rowNum,
        column: 'Business Group',
        message: 'Must be CDG, LSG, CDG(LSG), CDG/LSG, or LSG(CDG)',
        value: businessGroupRaw,
      });
      hasError = true;
    }

    const firstDigit = resolveFirstDigit(customerTypeRaw);
    if (!firstDigit) {
      err({
        row: rowNum,
        column: 'Customer Type',
        message: 'Must be SOLD-TO (or 1), End User (or 8), or Ship-to/Direct Delivery (or 2)',
        value: customerTypeRaw,
      });
      hasError = true;
    }

    if (!code) {
      err({ row: rowNum, column: 'Code', message: 'Required', value: code });
      hasError = true;
    } else if (!/^\d{7}$/.test(code)) {
      err({
        row: rowNum,
        column: 'Code',
        message: 'Code must be 7 digits',
        value: code,
      });
      hasError = true;
    }

    if (!sapCode) {
      err({ row: rowNum, column: 'SAP Code', message: 'Required', value: sapCode });
      hasError = true;
    }

    if (!nameJp) {
      err({ row: rowNum, column: 'Name (Japanese)', message: 'Required', value: nameJp });
      hasError = true;
    }

    const duplicateKey = `${businessGroupUpper}|${firstDigit}|${code}`;
    if (seenKeys.has(duplicateKey)) {
      err({
        row: rowNum,
        column: 'Code',
        message: 'Duplicate Business Group + Customer Type + Code in file',
        value: duplicateKey,
      });
      hasError = true;
    }
    seenKeys.add(duplicateKey);

    if (!hasError) {
      const groups = expandBusinessGroups(businessGroupRaw);
      for (const businessGroup of groups) {
        validRows.push({
          rowIndex: rowNum,
          businessGroup,
          firstDigit: firstDigit!,
          code,
          sapCode,
          nameJp,
          nameEn: nameEn || '',
          postalCode: postalCode || null,
          prefecture: prefecture || null,
          address: address || null,
          phone: phone || null,
        });
      }
    }
  });

  return { errors, validRows };
}

function resolveFirstDigit(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const direct = CUSTOMER_TYPE_MAP[lower];
  if (direct) return direct;
  const n = parseFloat(trimmed);
  if (!Number.isNaN(n) && Number.isFinite(n)) {
    const intKey = String(Math.trunc(n));
    return CUSTOMER_TYPE_MAP[intKey] ?? null;
  }
  return null;
}
