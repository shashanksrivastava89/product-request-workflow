/**
 * The Return approval matrix's columns, defined once and used in both directions.
 *
 * "What goes in is what comes out": an export must reproduce the sheet, and feeding that export
 * straight back must change nothing. That only holds if one definition owns the column set, its
 * order and its wording - so this module is the single source, and both the export endpoint and the
 * `return-approval-matrix` importer read it.
 *
 * The order is the sheet's own, with two deliberate differences from the file Japan maintains today:
 *
 * - **Reviewer is included.** The sheet has no such column; the review step was only ever set by
 *   SQL. It runs before every approver, so it belongs at level 0, right after the requester.
 * - **Team Name is part of a row's identity.** The sheet lists the same person under more than one
 *   team, and the old (requesterName, businessUnit) key collapsed 126 rows into 90.
 *
 * `No` is a plain sequence number. Nothing reads it back - it exists so the file looks like the
 * sheet - so an export renumbers from 1 in the canonical order.
 */

/** The canonical header row, in order. */
export const RETURN_MATRIX_COLUMNS = [
  'No',
  'Group',
  'Team Name',
  'Sales Reps or Requester',
  'Reviewer',
  '1st Approver',
  '2nd Approver',
  'Final Approver',
  '4th Approver',
  '5th Approver',
] as const;

export type ReturnMatrixColumn = (typeof RETURN_MATRIX_COLUMNS)[number];

/** A matrix row as the file represents it. */
export type ReturnMatrixFileRow = {
  requesterName: string;
  businessUnit: string;
  teamName: string;
  reviewer: string | null;
  firstApprover: string | null;
  secondApprover: string | null;
  finalApprover: string | null;
  fourthApprover: string | null;
  fifthApprover: string | null;
};

/**
 * Which stored field a header names.
 *
 * Matched on a normalised form of the header - case, spacing, punctuation and the circled numerals
 * the sheet decorates its headings with (➊ ❶ ①) all dropped - because the file is maintained by
 * hand and has never had stable header text. The aliases are the spellings seen in the sheets and
 * in the seed scripts.
 */
const COLUMN_ALIASES: Array<{ field: keyof ReturnMatrixFileRow | 'no'; patterns: RegExp[] }> = [
  { field: 'no', patterns: [/^no\.?$/, /^#$/, /^sno\.?$/, /^serial(no)?$/] },
  { field: 'businessUnit', patterns: [/^group$/, /^bu$/, /^businessunit$/, /^businessgroup$/] },
  { field: 'teamName', patterns: [/^teamname$/, /^team$/, /^teamnames$/] },
  {
    field: 'requesterName',
    patterns: [
      /^salesrepsorrequester$/,
      /^salesreporrequester$/,
      /^salesreps?$/,
      /^requester$/,
      /^requestername$/,
    ],
  },
  { field: 'reviewer', patterns: [/^reviewer$/, /^reviewercorrector$/, /^servicereview(er)?$/] },
  { field: 'firstApprover', patterns: [/^1stapprover$/, /^firstapprover$/, /^approver1$/] },
  { field: 'secondApprover', patterns: [/^2ndapprover$/, /^secondapprover$/, /^approver2$/] },
  {
    field: 'finalApprover',
    // "3rd" and "Final" are the same slot: the sheet calls it Final, the model calls it final, and
    // some hand-edited copies number it.
    patterns: [/^finalapprover$/, /^3rdapprover$/, /^thirdapprover$/, /^approver3$/],
  },
  { field: 'fourthApprover', patterns: [/^4thapprover$/, /^fourthapprover$/, /^approver4$/] },
  { field: 'fifthApprover', patterns: [/^5thapprover$/, /^fifthapprover$/, /^approver5$/] },
];

/** Strip everything that is decoration rather than meaning, so headers match however they are typed. */
export function normalizeReturnMatrixHeader(header: string): string {
  return String(header ?? '')
    .replace(/　/g, ' ')
    // The circled numerals the sheet prefixes its headings with, in both filled and hollow forms.
    .replace(/[①-⑳❵-❿➀-➓⓪⭘]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
    .toLowerCase();
}

/** The field a header names, or null when it is not one of ours. */
export function returnMatrixFieldForHeader(
  header: string
): keyof ReturnMatrixFileRow | 'no' | null {
  const n = normalizeReturnMatrixHeader(header);
  if (!n) return null;
  for (const { field, patterns } of COLUMN_ALIASES) {
    if (patterns.some((p) => p.test(n))) return field;
  }
  return null;
}

/** A stored row as the canonical cells, in column order. */
export function returnMatrixRowToCells(row: ReturnMatrixFileRow, no: number): string[] {
  return [
    String(no),
    row.businessUnit,
    row.teamName,
    row.requesterName,
    row.reviewer ?? '',
    row.firstApprover ?? '',
    row.secondApprover ?? '',
    row.finalApprover ?? '',
    row.fourthApprover ?? '',
    row.fifthApprover ?? '',
  ];
}

/**
 * The order an export writes rows in, and therefore the order a round trip has to reproduce.
 *
 * Sorted rather than left to the database: `findMany` without an order is free to return rows
 * however it likes, and "export → import → export is byte-identical" cannot be asserted against a
 * moving target.
 */
export function compareReturnMatrixRows(a: ReturnMatrixFileRow, b: ReturnMatrixFileRow): number {
  const unit = (v: string) => {
    const i = ['CDG', 'LSG', 'SERVICE'].indexOf(v.toUpperCase());
    // Anything unrecognised sorts last rather than being silently grouped with CDG.
    return i === -1 ? 99 : i;
  };
  return (
    unit(a.businessUnit) - unit(b.businessUnit) ||
    a.teamName.localeCompare(b.teamName, 'en') ||
    a.requesterName.localeCompare(b.requesterName, 'en')
  );
}

/** One CSV cell, quoted only when it has to be. */
export function csvCell(value: string): string {
  const v = String(value ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The matrix as a CSV file.
 *
 * A UTF-8 BOM and CRLF line endings, because Excel on Japanese Windows opens a BOM-less UTF-8 CSV
 * as Shift-JIS and turns every Japanese team name into mojibake - the file has to survive being
 * opened, edited and saved by the people who maintain it.
 */
export function returnMatrixToCsv(rows: ReturnMatrixFileRow[]): string {
  const sorted = [...rows].sort(compareReturnMatrixRows);
  const lines = [RETURN_MATRIX_COLUMNS.map(csvCell).join(',')];
  sorted.forEach((row, i) => {
    lines.push(returnMatrixRowToCells(row, i + 1).map(csvCell).join(','));
  });
  return `﻿${lines.join('\r\n')}\r\n`;
}
