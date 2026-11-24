/**
 * Return approval matrix bulk import, Phase 2: write the rows and say exactly what changed.
 *
 * The file is authoritative for the business units it covers: a row missing from it is deleted, not
 * left behind. That is what makes the round trip meaningful - export, edit, re-upload, and the
 * database is the file - but it also means an operator can remove ninety rows with one upload. So
 * nothing here is silent: every create, update and delete is reported with its before and after,
 * and the inverse SQL comes back with it. There is no other audit trail for matrix edits to fall
 * back on (bulk imports have never recorded one), so this response *is* the rollback path.
 */

import { PrismaClient } from '@prisma/client';
import type { ValidatedReturnApprovalMatrixRow } from './validate-return-approval-matrix';
import { compareReturnMatrixRows, type ReturnMatrixFileRow } from './return-matrix-columns';

const prisma = new PrismaClient();

/** Written one at a time, not in a transaction: a 126-row file is small and the log is per row. */
const MATRIX_FIELDS = [
  'reviewer',
  'firstApprover',
  'secondApprover',
  'finalApprover',
  'fourthApprover',
  'fifthApprover',
] as const;

type MatrixField = (typeof MATRIX_FIELDS)[number];

export type ReturnMatrixChange =
  | { action: 'created'; key: string; after: ReturnMatrixFileRow }
  | {
      action: 'updated';
      key: string;
      before: ReturnMatrixFileRow;
      after: ReturnMatrixFileRow;
      fields: MatrixField[];
    }
  | { action: 'deleted'; key: string; before: ReturnMatrixFileRow };

export type ReturnMatrixImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  /** Every change, before and after. Capped; `changesTruncated` says when. */
  changes: ReturnMatrixChange[];
  changesTruncated: boolean;
  /** Statements that put the table back exactly as it was, in reverse order of application. */
  rollbackSql: string;
  /**
   * Names in the file with no requester directory row at all.
   *
   * Reported, never fixed here. A matrix upload that quietly created directory rows and team
   * memberships would be the one side effect nobody could roll back from this log, and the
   * directory has its own sync (scripts/sync-return-requester-groups.ts).
   *
   * Deliberately "no row at all" rather than "no row for this team". The sheet's team names and the
   * directory's group names do not agree letter for letter - the sheet says "Techincal
   * Service(LSG)" where the directory says "Technical Service(LSG)", and gives the P&OP team no
   * unit suffix where the directory has two - so a per-team check flagged 42 of 91 rows for people
   * who are in fact in the directory. A report that noisy is one nobody reads.
   */
  requestersMissingFromDirectory: Array<{ requesterName: string; teamName: string; businessUnit: string }>;
};

/** How many changes to hand back inline before the response would get unwieldy. */
const MAX_CHANGES_IN_RESULT = 1000;

function rowKey(r: { requesterName: string; businessUnit: string; teamName: string }): string {
  return `${r.businessUnit} / ${r.teamName || '(no team)'} / ${r.requesterName}`;
}

function fileRow(r: ValidatedReturnApprovalMatrixRow | ReturnMatrixFileRow): ReturnMatrixFileRow {
  return {
    requesterName: r.requesterName,
    businessUnit: r.businessUnit,
    teamName: r.teamName,
    reviewer: r.reviewer,
    firstApprover: r.firstApprover,
    secondApprover: r.secondApprover,
    finalApprover: r.finalApprover,
    fourthApprover: r.fourthApprover,
    fifthApprover: r.fifthApprover,
  };
}

const sqlStr = (v: string | null): string =>
  v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;

/** `UPDATE … SET each approver back to what it was`, keyed on the row's own id. */
function rollbackUpdate(id: string, before: ReturnMatrixFileRow): string {
  const sets = MATRIX_FIELDS.map((f) => `${columnOf(f)} = ${sqlStr(before[f])}`).join(', ');
  return `UPDATE return_approval_mapping SET ${sets} WHERE id = '${id}';`;
}

function columnOf(field: MatrixField): string {
  return {
    reviewer: 'reviewer',
    firstApprover: 'first_approver',
    secondApprover: 'second_approver',
    finalApprover: 'final_approver',
    fourthApprover: 'fourth_approver',
    fifthApprover: 'fifth_approver',
  }[field];
}

function rollbackInsert(before: ReturnMatrixFileRow): string {
  const cols = [
    'id',
    '"requesterName"',
    '"businessUnit"',
    'team_name',
    ...MATRIX_FIELDS.map(columnOf),
    '"createdAt"',
    '"updatedAt"',
  ].join(', ');
  const vals = [
    'gen_random_uuid()',
    sqlStr(before.requesterName),
    sqlStr(before.businessUnit),
    sqlStr(before.teamName),
    ...MATRIX_FIELDS.map((f) => sqlStr(before[f])),
    'NOW()',
    'NOW()',
  ].join(', ');
  return `INSERT INTO return_approval_mapping (${cols}) VALUES (${vals});`;
}

export async function executeReturnApprovalMatrixImport(
  rows: ValidatedReturnApprovalMatrixRow[],
  opts: { reviewerColumnPresent: boolean }
): Promise<ReturnMatrixImportResult> {
  const changes: ReturnMatrixChange[] = [];
  const rollback: string[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const pushChange = (c: ReturnMatrixChange) => {
    if (changes.length < MAX_CHANGES_IN_RESULT) changes.push(c);
  };

  // The units this file speaks for. A file covering only SERVICE must not prune CDG.
  const unitsInFile = new Set(rows.map((r) => r.businessUnit));

  const existing = await prisma.returnApprovalMapping.findMany({
    where: { businessUnit: { in: [...unitsInFile] } },
  });
  const byKey = new Map(
    existing.map((r) => [
      `${r.businessUnit}|${r.requesterName}|${r.teamName.toUpperCase()}`,
      r,
    ])
  );

  for (const row of rows) {
    const key = `${row.businessUnit}|${row.requesterName}|${row.teamName.toUpperCase()}`;
    const prior = byKey.get(key);
    byKey.delete(key);

    /*
     * A file with no Reviewer column leaves the stored reviewer alone.
     *
     * The column has only ever been written by SQL, and the sheet Japan maintains does not have it
     * yet. Treating "absent" as "blank" would clear the review step off all 91 rows on the first
     * upload of an unmodified sheet. An export always includes the column, so a round trip is still
     * exact - and a Reviewer column that *is* present and empty does clear it, because then the
     * operator said so.
     */
    const desired: ReturnMatrixFileRow = {
      ...fileRow(row),
      reviewer: opts.reviewerColumnPresent ? row.reviewer : (prior?.reviewer ?? null),
    };

    if (!prior) {
      await prisma.returnApprovalMapping.create({
        data: {
          requesterName: desired.requesterName,
          businessUnit: desired.businessUnit,
          teamName: desired.teamName,
          reviewer: desired.reviewer,
          firstApprover: desired.firstApprover,
          secondApprover: desired.secondApprover,
          finalApprover: desired.finalApprover,
          fourthApprover: desired.fourthApprover,
          fifthApprover: desired.fifthApprover,
        },
      });
      created++;
      pushChange({ action: 'created', key: rowKey(desired), after: desired });
      rollback.push(
        `DELETE FROM return_approval_mapping WHERE "requesterName" = ${sqlStr(desired.requesterName)} AND "businessUnit" = ${sqlStr(desired.businessUnit)} AND team_name = ${sqlStr(desired.teamName)};`
      );
      continue;
    }

    const before = fileRow(prior);
    const changedFields = MATRIX_FIELDS.filter((f) => (before[f] ?? null) !== (desired[f] ?? null));
    if (changedFields.length === 0) {
      unchanged++;
      continue;
    }

    await prisma.returnApprovalMapping.update({
      where: { id: prior.id },
      data: Object.fromEntries(changedFields.map((f) => [f, desired[f]])),
    });
    updated++;
    pushChange({
      action: 'updated',
      key: rowKey(desired),
      before,
      after: desired,
      fields: changedFields,
    });
    rollback.push(rollbackUpdate(prior.id, before));
  }

  // Whatever is left in the map was in the database and not in the file.
  const stale = [...byKey.values()];
  for (const row of stale) {
    const before = fileRow(row);
    await prisma.returnApprovalMapping.delete({ where: { id: row.id } });
    pushChange({ action: 'deleted', key: rowKey(before), before });
    rollback.push(rollbackInsert(before));
  }

  const requestersMissingFromDirectory = await findRequestersMissingFromDirectory(rows);

  return {
    created,
    updated,
    unchanged,
    deleted: stale.length,
    changes: changes.sort((a, b) =>
      compareReturnMatrixRows(
        a.action === 'deleted' ? a.before : a.after,
        b.action === 'deleted' ? b.before : b.after
      )
    ),
    changesTruncated: created + updated + stale.length > changes.length,
    // Reverse order: undoing a delete-then-insert sequence has to unwind, not replay.
    rollbackSql: [
      '-- Return approval matrix rollback, generated at ' + new Date().toISOString(),
      '-- Apply in a transaction. Restores every row this import created, changed or removed.',
      'BEGIN;',
      ...rollback.reverse(),
      'COMMIT;',
    ].join('\n'),
    requestersMissingFromDirectory,
  };
}

/**
 * Which names in the file are absent from the requester directory.
 *
 * A matrix row decides who approves; the directory row is what puts the person in a team dropdown
 * so they can raise a request at all. They are separate tables, and a matrix upload cannot create
 * the second without inventing a team id, so this reports the gap for the directory sync to close.
 */
async function findRequestersMissingFromDirectory(
  rows: ValidatedReturnApprovalMatrixRow[]
): Promise<Array<{ requesterName: string; teamName: string; businessUnit: string }>> {
  if (rows.length === 0) return [];
  const names = [...new Set(rows.map((r) => r.requesterName))];
  const known = new Set(
    (
      await prisma.requester.findMany({
        where: { name: { in: names } },
        select: { name: true },
      })
    ).map((d) => d.name)
  );
  const seen = new Set<string>();
  const missing: Array<{ requesterName: string; teamName: string; businessUnit: string }> = [];
  for (const row of rows) {
    if (known.has(row.requesterName) || seen.has(row.requesterName)) continue;
    seen.add(row.requesterName);
    missing.push({
      requesterName: row.requesterName,
      teamName: row.teamName,
      businessUnit: row.businessUnit,
    });
  }
  return missing;
}
