/**
 * Compare an official customer list file against the database and disable removed customers.
 */

import { PrismaClient } from '@prisma/client';
import { parseImportFile } from './import/parser';
import type { ImportFileKind } from '../utils/import-file-validation.util';
import {
  validateCustomerRows,
  type ValidatedCustomerRow,
  type ValidationError,
} from './import/validate-customers';
import { trackCustomerChange } from './customer-history.service';

const prisma = new PrismaClient();

const MAX_ERRORS_IN_RESPONSE = 2000;

export type CustomerType = '1' | '2' | '8';

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  '1': 'SOLD-TO',
  '2': 'Ship-to',
  '8': 'End User',
};

export interface CustomerFieldChange {
  field: string;
  fileValue: string | number | null;
  dbValue: string | number | null;
}

export interface CustomerDiffRow {
  id?: string;
  businessGroup: string;
  code: string;
  sapCode: string;
  nameJp: string;
  nameEn: string;
  firstDigit?: string;
  isActive?: boolean;
  updatedAt?: string;
  fieldChanges?: CustomerFieldChange[];
}

export interface CustomerReconciliationSummary {
  added: number;
  updated: number;
  removed: number;
  alreadyInactive: number;
  unchanged: number;
  invalidRows: number;
  fileRowsForType: number;
}

export interface CustomerReconciliationResult {
  customerType: CustomerType;
  customerTypeLabel: string;
  summary: CustomerReconciliationSummary;
  added: CustomerDiffRow[];
  updated: CustomerDiffRow[];
  removed: CustomerDiffRow[];
  alreadyInactive: CustomerDiffRow[];
  errors: ValidationError[];
  totalErrorCount?: number;
  errorsTruncated?: boolean;
  excludedOtherTypeRows?: number;
  emptySelectedType?: boolean;
  warning?: string;
}

function normStr(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function customerKey(businessGroup: string, code: string): string {
  return `${businessGroup}|${code}`;
}

function toDiffRowFromFile(row: ValidatedCustomerRow): CustomerDiffRow {
  return {
    businessGroup: row.businessGroup,
    code: row.code,
    sapCode: row.sapCode,
    nameJp: row.nameJp,
    nameEn: row.nameEn,
    firstDigit: row.firstDigit,
  };
}

function toDiffRowFromDb(customer: {
  id: string;
  businessGroup: string;
  firstDigit: string;
  code: string;
  sapCode: string;
  nameJp: string;
  nameEn: string;
  isActive: boolean;
  updatedAt: Date;
}): CustomerDiffRow {
  return {
    id: customer.id,
    businessGroup: customer.businessGroup,
    code: customer.code,
    sapCode: customer.sapCode,
    nameJp: customer.nameJp,
    nameEn: customer.nameEn,
    firstDigit: customer.firstDigit,
    isActive: customer.isActive,
    updatedAt: customer.updatedAt.toISOString(),
  };
}

function getFieldChanges(
  fileRow: ValidatedCustomerRow,
  dbCustomer: {
    sapCode: string;
    nameJp: string;
    nameEn: string;
    postalCode: string | null;
    prefecture: string | null;
    address: string | null;
    phone: string | null;
    firstDigit: string;
  }
): CustomerFieldChange[] {
  const changes: CustomerFieldChange[] = [];

  const checks: Array<{
    field: string;
    fileValue: string;
    dbValue: string;
  }> = [
    { field: 'sapCode', fileValue: fileRow.sapCode, dbValue: normStr(dbCustomer.sapCode) },
    { field: 'nameJp', fileValue: fileRow.nameJp, dbValue: normStr(dbCustomer.nameJp) },
    { field: 'nameEn', fileValue: fileRow.nameEn, dbValue: normStr(dbCustomer.nameEn) },
    {
      field: 'postalCode',
      fileValue: normStr(fileRow.postalCode),
      dbValue: normStr(dbCustomer.postalCode),
    },
    {
      field: 'prefecture',
      fileValue: normStr(fileRow.prefecture),
      dbValue: normStr(dbCustomer.prefecture),
    },
    { field: 'address', fileValue: normStr(fileRow.address), dbValue: normStr(dbCustomer.address) },
    { field: 'phone', fileValue: normStr(fileRow.phone), dbValue: normStr(dbCustomer.phone) },
    { field: 'firstDigit', fileValue: fileRow.firstDigit, dbValue: normStr(dbCustomer.firstDigit) },
  ];

  for (const { field, fileValue, dbValue } of checks) {
    if (fileValue !== dbValue) {
      changes.push({ field, fileValue, dbValue });
    }
  }

  return changes;
}

export async function compareCustomerList(
  filePath: string,
  fileKind: ImportFileKind,
  customerType: CustomerType
): Promise<CustomerReconciliationResult> {
  const parseResult = parseImportFile(filePath, fileKind);
  const { errors, validRows } = validateCustomerRows(parseResult.rows);

  const invalidRowCount = new Set(errors.map((e) => e.row)).size;
  const errorsToSend =
    errors.length > MAX_ERRORS_IN_RESPONSE ? errors.slice(0, MAX_ERRORS_IN_RESPONSE) : errors;

  const typeRows = validRows.filter((r) => r.firstDigit === customerType);
  const excludedOtherTypeRows = validRows.length - typeRows.length;
  const customerTypeLabel = CUSTOMER_TYPE_LABELS[customerType];

  if (typeRows.length === 0) {
    const warning =
      validRows.length > 0
        ? `No ${customerTypeLabel} rows were found in this file. Please choose the correct customer type or upload the ${customerTypeLabel} master list.`
        : `No valid ${customerTypeLabel} rows were found in this file. Please check the file format and customer type column.`;

    return {
      customerType,
      customerTypeLabel,
      summary: {
        added: 0,
        updated: 0,
        removed: 0,
        alreadyInactive: 0,
        unchanged: 0,
        invalidRows: invalidRowCount,
        fileRowsForType: 0,
      },
      added: [],
      updated: [],
      removed: [],
      alreadyInactive: [],
      errors: errorsToSend,
      totalErrorCount: errors.length > MAX_ERRORS_IN_RESPONSE ? errors.length : undefined,
      errorsTruncated: errors.length > MAX_ERRORS_IN_RESPONSE || undefined,
      excludedOtherTypeRows: excludedOtherTypeRows > 0 ? excludedOtherTypeRows : undefined,
      emptySelectedType: true,
      warning,
    };
  }

  const fileByKey = new Map<string, ValidatedCustomerRow>();
  for (const row of typeRows) {
    fileByKey.set(customerKey(row.businessGroup, row.code), row);
  }

  const dbCustomers = await prisma.customer.findMany({
    where: {
      firstDigit: customerType,
      status: 'APPROVED',
    },
    orderBy: [{ businessGroup: 'asc' }, { code: 'asc' }],
  });

  const dbByKey = new Map(dbCustomers.map((c) => [customerKey(c.businessGroup, c.code), c]));

  const added: CustomerDiffRow[] = [];
  const updated: CustomerDiffRow[] = [];
  let unchanged = 0;

  for (const [key, fileRow] of fileByKey) {
    const dbCustomer = dbByKey.get(key);
    if (!dbCustomer) {
      added.push(toDiffRowFromFile(fileRow));
      continue;
    }

    const fieldChanges = getFieldChanges(fileRow, dbCustomer);
    if (fieldChanges.length > 0) {
      updated.push({
        ...toDiffRowFromDb(dbCustomer),
        fieldChanges,
      });
    } else {
      unchanged++;
    }
  }

  const removed: CustomerDiffRow[] = [];
  const alreadyInactive: CustomerDiffRow[] = [];

  for (const dbCustomer of dbCustomers) {
    const key = customerKey(dbCustomer.businessGroup, dbCustomer.code);
    if (fileByKey.has(key)) continue;

    if (dbCustomer.isActive) {
      removed.push(toDiffRowFromDb(dbCustomer));
    } else {
      alreadyInactive.push(toDiffRowFromDb(dbCustomer));
    }
  }

  return {
    customerType,
    customerTypeLabel,
    summary: {
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      alreadyInactive: alreadyInactive.length,
      unchanged,
      invalidRows: invalidRowCount,
      fileRowsForType: typeRows.length,
    },
    added,
    updated,
    removed,
    alreadyInactive,
    errors: errorsToSend,
    totalErrorCount: errors.length > MAX_ERRORS_IN_RESPONSE ? errors.length : undefined,
    errorsTruncated: errors.length > MAX_ERRORS_IN_RESPONSE || undefined,
    excludedOtherTypeRows: excludedOtherTypeRows > 0 ? excludedOtherTypeRows : undefined,
    emptySelectedType: false,
  };
}

export async function disableRemovedCustomers(
  customerIds: string[],
  customerType: CustomerType,
  userId: string,
  reason?: string
): Promise<{ disabled: number; skipped: Array<{ id: string; reason: string }> }> {
  const skipped: Array<{ id: string; reason: string }> = [];
  let disabled = 0;

  const uniqueIds = [...new Set(customerIds)];

  for (const id of uniqueIds) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      skipped.push({ id, reason: 'Customer not found' });
      continue;
    }
    if (customer.firstDigit !== customerType) {
      skipped.push({
        id,
        reason: `Customer is ${CUSTOMER_TYPE_LABELS[customer.firstDigit as CustomerType] ?? customer.firstDigit}, not ${CUSTOMER_TYPE_LABELS[customerType]}`,
      });
      continue;
    }
    if (customer.status !== 'APPROVED') {
      skipped.push({ id, reason: 'Customer is not approved' });
      continue;
    }
    if (!customer.isActive) {
      skipped.push({ id, reason: 'Already inactive' });
      continue;
    }

    const deactivated = await prisma.customer.update({
      where: { id },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });

    await trackCustomerChange(customer.id, 'DELETE', userId, customer, deactivated, reason);
    disabled++;
  }

  return { disabled, skipped };
}
