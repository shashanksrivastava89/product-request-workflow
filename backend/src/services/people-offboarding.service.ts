/**
 * Removing a person who has left the organization from everywhere their name steers an approval.
 *
 * A name is written into many places and nothing tied them together: the approver columns of the
 * five mapping tables (ZSAM, ZNC Installation, ZNC Claim, ZINT, Return), the manager links on other
 * accounts (the foreign keys and the legacy name columns both), the requester directory and the
 * account itself. Taking someone out by hand meant finding every row on every tab - which is how
 * Mairtin Yoder stayed a DSM on sample rows after he had been taken off the return matrix.
 *
 * `previewOffboarding` only reads: it lists every place the name is found, so an administrator sees
 * the whole of it first. `executeOffboarding` applies it in one transaction:
 *   - mapping rows where the person approves: the cell is cleared, or set to the successor when one
 *     is named (an empty slot is skipped by the chain builder, so requests keep flowing);
 *   - mapping rows where the person is the requester: deleted - they raise nothing any more;
 *   - other accounts linking to them as a manager: the link is cleared or moved to the successor;
 *   - their requester directory rows and their account: deactivated, never deleted, because
 *     submitted forms and approvals reference them.
 * Approval steps still open on their name are reported, not touched: a super approver decides those
 * on their behalf, or the request is rebuilt.
 *
 * Names are compared the way the mail path compares them (`normalizeNameForMatch`: U+3000 and
 * runs of spaces folded, case ignored), because the tables spell the same person several ways.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { findUserByName, normalizeNameForMatch } from './named-requester.service';
import { normalizeRequesterNameForDb } from './import/hierarchy-import-utils';
import { normalizeReturnMatrixApprover } from './import/validate-return-approval-matrix';

const prisma = new PrismaClient();

export type MappingTableKey = 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return';

type MappingTableSpec = {
  key: MappingTableKey;
  label: string;
  model:
    | 'zsammApprovalMapping'
    | 'zncApprovalMapping'
    | 'zncclaimApprovalMapping'
    | 'zintApprovalMapping'
    | 'returnApprovalMapping';
  approverColumns: readonly string[];
  /** How an approver name is written in this table (the bulk importer's convention). */
  writeName: (name: string) => string | null;
};

const sampleName = (name: string): string | null => normalizeRequesterNameForDb(name) || null;

export const MAPPING_TABLES: readonly MappingTableSpec[] = [
  {
    key: 'zsam',
    label: 'ZSAM',
    model: 'zsammApprovalMapping',
    approverColumns: ['salesManager', 'districtSalesManager', 'nationalSalesManager', 'localFinanceController', 'directorCommercialManager'],
    writeName: sampleName,
  },
  {
    key: 'znc-installation',
    label: 'ZNC Installation',
    model: 'zncApprovalMapping',
    approverColumns: [
      'salesManager',
      'districtSalesManager',
      'nationalSalesManager',
      'technicalManager',
      'nationalTSManager',
      'localFinanceController',
      'directorCommercialManager',
    ],
    writeName: sampleName,
  },
  {
    key: 'znc-claim',
    label: 'ZNC Claim',
    model: 'zncclaimApprovalMapping',
    approverColumns: ['salesManager', 'districtSalesManager', 'nationalSalesManager', 'csPsManager', 'raqaManager', 'globalRaqaManager'],
    writeName: sampleName,
  },
  {
    key: 'zint',
    label: 'ZINT QC',
    model: 'zintApprovalMapping',
    approverColumns: ['salesManager', 'districtSalesManager', 'nationalSalesManager', 'csPsManager', 'raqaManager', 'globalRaqaManager'],
    writeName: sampleName,
  },
  {
    key: 'return',
    label: 'Return',
    model: 'returnApprovalMapping',
    approverColumns: ['firstApprover', 'secondApprover', 'finalApprover', 'fourthApprover', 'fifthApprover', 'reviewer'],
    writeName: normalizeReturnMatrixApprover,
  },
];

/** The manager links an account carries: the foreign key the chain uses and the legacy name beside it. */
export const USER_MANAGER_LINKS = [
  { fk: 'salesManagerId', legacy: 'salesManager' },
  { fk: 'districtSalesManagerId', legacy: 'districtSalesManager' },
  { fk: 'nationalSalesManagerId', legacy: 'nationalSalesManager' },
  { fk: 'localFinanceControllerId', legacy: 'localFinanceController' },
  { fk: 'directorCommercialManagerId', legacy: 'directorCommercialManager' },
  { fk: 'technicalManagerId', legacy: 'technicalManager' },
  { fk: 'nationalTSManagerId', legacy: 'nationalTSManager' },
] as const;

export type OffboardingAccount = { id: string; email: string; name: string; role: string; isActive: boolean };
export type OffboardingMappingRow = {
  id: string;
  requesterName: string;
  businessUnit: string;
  teamName?: string;
  /** Approver columns holding the name; empty for the person's own row. */
  columns: string[];
};
export type OffboardingMappingTable = {
  table: MappingTableKey;
  label: string;
  asApprover: OffboardingMappingRow[];
  asRequester: OffboardingMappingRow[];
};
export type OffboardingHierarchyRef = { userId: string; name: string; email: string; fields: string[] };
export type OffboardingDirectoryRow = {
  id: string;
  name: string;
  code: string;
  group: string;
  groupCode: string;
  isActive: boolean;
};
export type OffboardingOpenApproval = {
  formId: string;
  referenceNumber: string | null;
  formStatus: string;
  level: number;
  role: string;
  status: string;
};
export type OffboardingScope = {
  name: string;
  key: string;
  accounts: OffboardingAccount[];
  mappings: OffboardingMappingTable[];
  hierarchyReferences: OffboardingHierarchyRef[];
  directoryRows: OffboardingDirectoryRow[];
  openApprovals: OffboardingOpenApproval[];
  /** Anything at all to remove (open approvals alone do not count: they are reported only). */
  found: boolean;
};
export type OffboardingResult = {
  scope: OffboardingScope;
  successor: { name: string; userId: string | null } | null;
  applied: {
    mappingRowsUpdated: number;
    mappingRowsDeleted: number;
    hierarchyLinksUpdated: number;
    directoryRowsDeactivated: number;
    accountsDeactivated: number;
  };
};

export function sameName(value: unknown, key: string): boolean {
  return typeof value === 'string' && normalizeNameForMatch(value) === key;
}

export type MappingRowLike = Record<string, unknown> & {
  id: string;
  requesterName: string;
  businessUnit?: string | null;
  teamName?: string | null;
};

/** The person's own rows, and the rows where they sit in an approver column (with which columns). */
export function splitMappingRows<R extends MappingRowLike>(
  rows: readonly R[],
  approverColumns: readonly string[],
  key: string
): { asRequester: R[]; asApprover: Array<{ row: R; columns: string[] }> } {
  const asRequester: R[] = [];
  const asApprover: Array<{ row: R; columns: string[] }> = [];
  for (const row of rows) {
    if (sameName(row.requesterName, key)) {
      asRequester.push(row);
      continue;
    }
    const columns = approverColumns.filter((c) => sameName(row[c], key));
    if (columns.length > 0) asApprover.push({ row, columns });
  }
  return { asRequester, asApprover };
}

/** The manager fields of one account that point at the person, by id or by legacy name. */
export function managerLinksTo(user: Record<string, unknown>, accountIds: ReadonlySet<string>, key: string): string[] {
  const fields: string[] = [];
  for (const link of USER_MANAGER_LINKS) {
    const fk = user[link.fk];
    if (typeof fk === 'string' && accountIds.has(fk)) fields.push(link.fk);
    if (sameName(user[link.legacy], key)) fields.push(link.legacy);
  }
  return fields;
}

type MappingDelegate = {
  findMany: () => Promise<unknown[]>;
  update: (args: { where: { id: string }; data: Record<string, string | null> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegateFor(client: PrismaClient | Prisma.TransactionClient, spec: MappingTableSpec): MappingDelegate {
  return (client as unknown as Record<string, MappingDelegate>)[spec.model];
}

function describeRow(row: MappingRowLike, columns: string[]): OffboardingMappingRow {
  return {
    id: row.id,
    requesterName: row.requesterName,
    businessUnit: row.businessUnit == null ? '' : String(row.businessUnit),
    ...(row.teamName == null ? {} : { teamName: String(row.teamName) }),
    columns,
  };
}

export async function previewOffboarding(name: string): Promise<OffboardingScope> {
  const key = normalizeNameForMatch(name);
  if (!key) throw new AppError('A name is required', 400);

  const users = await prisma.user.findMany();
  const accounts = users.filter((u) => sameName(u.name, key));
  const accountIds = new Set(accounts.map((u) => u.id));

  const hierarchyReferences: OffboardingHierarchyRef[] = users
    .filter((u) => !accountIds.has(u.id))
    .map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      fields: managerLinksTo(u as unknown as Record<string, unknown>, accountIds, key),
    }))
    .filter((r) => r.fields.length > 0);

  const mappings: OffboardingMappingTable[] = [];
  for (const spec of MAPPING_TABLES) {
    const rows = (await delegateFor(prisma, spec).findMany()) as MappingRowLike[];
    const { asRequester, asApprover } = splitMappingRows(rows, spec.approverColumns, key);
    mappings.push({
      table: spec.key,
      label: spec.label,
      asApprover: asApprover.map(({ row, columns }) => describeRow(row, columns)),
      asRequester: asRequester.map((row) => describeRow(row, [])),
    });
  }

  const directory = await prisma.requester.findMany({
    include: { requesterGroup: { select: { name: true, code: true } } },
  });
  const directoryRows: OffboardingDirectoryRow[] = directory
    .filter((r) => sameName(r.name, key))
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      group: r.requesterGroup.name,
      groupCode: r.requesterGroup.code,
      isActive: r.isActive,
    }));

  const open = await prisma.approval.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    include: { form: { select: { referenceNumber: true, status: true } } },
  });
  const openApprovals: OffboardingOpenApproval[] = open
    .filter((a) => accountIds.has(a.approverId) || sameName(a.approverName, key))
    .map((a) => ({
      formId: a.formId,
      referenceNumber: a.form.referenceNumber,
      formStatus: a.form.status,
      level: a.level,
      role: a.role,
      status: a.status,
    }));

  const found =
    accounts.length > 0 ||
    hierarchyReferences.length > 0 ||
    directoryRows.length > 0 ||
    mappings.some((m) => m.asApprover.length > 0 || m.asRequester.length > 0);

  return {
    name: name.trim(),
    key,
    accounts: accounts.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive })),
    mappings,
    hierarchyReferences,
    directoryRows,
    openApprovals,
    found,
  };
}

export async function executeOffboarding(
  name: string,
  opts: { successorName?: string | null; changedBy: string | null }
): Promise<OffboardingResult> {
  const scope = await previewOffboarding(name);
  if (!scope.found) {
    throw new AppError(`"${scope.name}" is not an approver, a requester or an account anywhere`, 404);
  }

  const successorInput = (opts.successorName ?? '').trim();
  const successorKey = normalizeNameForMatch(successorInput);
  if (successorKey && successorKey === scope.key) throw new AppError('The successor must be a different person', 400);
  const successorUser = successorKey ? await findUserByName(successorInput) : null;
  const successorName = successorKey ? successorUser?.name ?? successorInput : null;

  const reason =
    `Left the organization - removed from every approval hierarchy` +
    (successorName ? `, handed to ${successorName}` : '');

  const applied = await prisma.$transaction(
    async (tx) => {
      let mappingRowsUpdated = 0;
      let mappingRowsDeleted = 0;
      let hierarchyLinksUpdated = 0;

      for (const spec of MAPPING_TABLES) {
        const block = scope.mappings.find((m) => m.table === spec.key);
        if (!block) continue;
        const written = successorName ? spec.writeName(successorName) : null;
        for (const row of block.asApprover) {
          const data: Record<string, string | null> = {};
          for (const col of row.columns) data[col] = written;
          await delegateFor(tx, spec).update({ where: { id: row.id }, data });
          mappingRowsUpdated += 1;
        }
        for (const row of block.asRequester) {
          await delegateFor(tx, spec).delete({ where: { id: row.id } });
          mappingRowsDeleted += 1;
        }
      }

      for (const ref of scope.hierarchyReferences) {
        const data: Record<string, string | null> = {};
        for (const link of USER_MANAGER_LINKS) {
          if (ref.fields.includes(link.fk)) data[link.fk] = successorUser?.id ?? null;
          if (ref.fields.includes(link.legacy)) data[link.legacy] = successorName;
        }
        await tx.user.update({ where: { id: ref.userId }, data: data as Prisma.UserUncheckedUpdateInput });
        hierarchyLinksUpdated += 1;
      }

      const directory = await tx.requester.updateMany({
        where: { id: { in: scope.directoryRows.map((r) => r.id) }, isActive: true },
        data: { isActive: false },
      });

      const accountIds = scope.accounts.map((a) => a.id);
      const deactivated = await tx.user.updateMany({
        where: { id: { in: accountIds }, isActive: true },
        data: { isActive: false },
      });

      return {
        mappingRowsUpdated,
        mappingRowsDeleted,
        hierarchyLinksUpdated,
        directoryRowsDeactivated: directory.count,
        accountsDeactivated: deactivated.count,
      };
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  // The only durable record besides the rows themselves: `user_history` exists on production with
  // snake_case columns the Prisma model does not map, and Change History never reads it, so the
  // audit goes to the server log and back to the administrator in the response.
  console.info(
    JSON.stringify({
      event: 'people-offboarding',
      name: scope.name,
      reason,
      changedBy: opts.changedBy,
      successor: successorName ? { name: successorName, userId: successorUser?.id ?? null } : null,
      applied,
      accounts: scope.accounts.map((a) => a.email),
      openApprovals: scope.openApprovals.map((a) => a.referenceNumber ?? a.formId),
    })
  );

  return {
    scope,
    successor: successorName ? { name: successorName, userId: successorUser?.id ?? null } : null,
    applied,
  };
}
