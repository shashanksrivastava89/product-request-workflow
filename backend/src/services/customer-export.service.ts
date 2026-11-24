/**
 * Export approved customer rows in master-list column layout (bulk import compatible).
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

export type CustomerExportType = 'all' | 'sold-to' | 'direct-delivery' | 'ship-to';
export type CustomerExportFormat = 'xlsx' | 'csv';

const EXPORT_HEADERS = [
  'Business Group (correct)',
  'Business Group2 (fixed)',
  'First Degit',
  '7 degit',
  'SAP Code',
  'Company in Japanese Name',
  'AccountName_E',
  'Japanese Address',
  'Phone Number',
] as const;

/** Map export type to firstDigit filter. */
export function firstDigitForExportType(type: CustomerExportType): string | undefined {
  switch (type) {
    case 'sold-to':
      return '1';
    case 'direct-delivery':
      return '2';
    case 'ship-to':
      return '8';
    default:
      return undefined;
  }
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatJapaneseAddress(customer: {
  postalCode: string | null;
  prefecture: string | null;
  address: string | null;
}): string {
  if (customer.address?.trim()) {
    const postal = customer.postalCode?.trim();
    const prefix = postal ? `〒${postal} ` : '';
    const prefecture = customer.prefecture?.trim();
    const body = customer.address.trim();
    if (prefecture && !body.includes(prefecture)) {
      return `${prefix}${prefecture}${body}`.trim();
    }
    return `${prefix}${body}`.trim();
  }
  const parts = [customer.postalCode, customer.prefecture, customer.address]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.join(' ');
}

export async function fetchMasterCustomers(customerType: CustomerExportType) {
  const firstDigit = firstDigitForExportType(customerType);
  return prisma.customer.findMany({
    where: {
      status: 'APPROVED',
      isActive: true,
      ...(firstDigit ? { firstDigit } : {}),
    },
    orderBy: [{ businessGroup: 'asc' }, { firstDigit: 'asc' }, { code: 'asc' }],
    select: {
      businessGroup: true,
      firstDigit: true,
      code: true,
      sapCode: true,
      nameJp: true,
      nameEn: true,
      postalCode: true,
      prefecture: true,
      address: true,
      phone: true,
    },
  });
}

function toExportRow(
  customer: Awaited<ReturnType<typeof fetchMasterCustomers>>[number]
): string[] {
  return [
    customer.businessGroup,
    customer.businessGroup,
    customer.firstDigit,
    customer.code,
    customer.sapCode,
    customer.nameJp,
    customer.nameEn,
    formatJapaneseAddress(customer),
    customer.phone ?? '',
  ];
}

export function buildCustomerExportXlsx(
  customerType: CustomerExportType,
  customers: Awaited<ReturnType<typeof fetchMasterCustomers>>
): Buffer {
  const rows = customers.map((c) => toExportRow(c));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[...EXPORT_HEADERS], ...rows]);
  const sheetName =
    customerType === 'all'
      ? 'Customers'
      : customerType
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildCustomerExportCsv(
  customers: Awaited<ReturnType<typeof fetchMasterCustomers>>
): string {
  const lines = customers.map((c) =>
    toExportRow(c)
      .map((v) => csvEscape(v))
      .join(',')
  );
  return `${EXPORT_HEADERS.join(',')}\n${lines.join('\n')}`;
}

export function customerExportFilename(
  customerType: CustomerExportType,
  format: CustomerExportFormat,
  date = new Date()
): string {
  const day = date.toISOString().slice(0, 10);
  const ext = format === 'xlsx' ? 'xlsx' : 'csv';
  const slug =
    customerType === 'all' ? 'all-customers' : `customers-${customerType}`;
  return `${slug}-${day}.${ext}`;
}

export function parseCustomerExportType(raw: unknown): CustomerExportType | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (
    value === 'all' ||
    value === 'sold-to' ||
    value === 'direct-delivery' ||
    value === 'ship-to'
  ) {
    return value;
  }
  return undefined;
}

export function parseCustomerExportFormat(raw: unknown): CustomerExportFormat {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'csv' ? 'csv' : 'xlsx';
}
