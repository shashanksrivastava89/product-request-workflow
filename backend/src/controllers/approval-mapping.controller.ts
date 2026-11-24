/**
 * Admin CRUD for bulk-import approval mapping tables (ZSAM, ZNC Install, ZNC Claim, ZINT).
 * Natural key: (requesterName, businessUnit) — names normalized like bulk import.
 */

import { randomBytes } from 'crypto';
import { normalizeReturnMatrixApprover } from '../services/import/validate-return-approval-matrix';
import { returnMatrixToCsv } from '../services/import/return-matrix-columns';
import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { normalizeRequesterNameForDb } from '../services/import/hierarchy-import-utils';
import {
  assertApproverUsersExist,
  assertRequesterInDirectory,
} from '../utils/approval-mapping-directory-validation';

const prisma = new PrismaClient();

const FORM_TYPES = ['zsam', 'znc-installation', 'znc-claim', 'zint', 'return'] as const;
type FormTypeKey = (typeof FORM_TYPES)[number];

function parseFormType(s: string): FormTypeKey {
  const x = s.toLowerCase().trim();
  if (FORM_TYPES.includes(x as FormTypeKey)) return x as FormTypeKey;
  throw new AppError(`Invalid form type: ${s}. Use: ${FORM_TYPES.join(', ')}`, 400);
}

/**
 * An approver name on a Return matrix row, as stored.
 *
 * Upper case, which is the convention every identity table here follows and what the bulk import
 * writes. The admin UI used to store whatever was typed, so one writer produced "Shashank
 * Srivastava" and the other "SHASHANK SRIVASTAVA" for the same person - which showed up as a row
 * that changed every time the matrix was exported and re-imported. An email is left exactly as
 * typed: the Reviewer column holds a shared mailbox address, and upper-casing it breaks the lookup.
 *
 * Shared with the importer so there is one definition of the convention.
 */
function normReturnApproverField(s: unknown): string | null {
  const trimmed = normApproverField(s);
  return trimmed == null ? null : normalizeReturnMatrixApprover(trimmed);
}

/**
 * The Team Name cell as stored.
 *
 * Empty means empty string, not NULL: team name is part of the row's unique key, and Postgres treats
 * NULLs as distinct, so a NULL here would let two rows share a key the constraint is meant to guard.
 */
function normTeamNameField(s: unknown): string {
  return normApproverField(s) ?? '';
}

function normApproverField(s: unknown): string | null {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  if (!t || /^blank$/i.test(t)) return null;
  return t;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  businessUnit: z.enum(['CDG', 'LSG', 'SERVICE', '']).optional(),
  search: z.string().optional(),
  sortBy: z.string().optional().default('requesterName'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
});

/** Whitelist Prisma orderBy fields per form (prevents arbitrary keys). */
const LIST_SORT_FIELDS: Record<FormTypeKey, readonly string[]> = {
  zsam: [
    'requesterName',
    'businessUnit',
    'salesManager',
    'districtSalesManager',
    'nationalSalesManager',
    'localFinanceController',
    'directorCommercialManager',
  ],
  'znc-installation': [
    'requesterName',
    'businessUnit',
    'salesManager',
    'districtSalesManager',
    'nationalSalesManager',
    'technicalManager',
    'nationalTSManager',
    'localFinanceController',
    'directorCommercialManager',
  ],
  'znc-claim': [
    'requesterName',
    'businessUnit',
    'salesManager',
    'districtSalesManager',
    'nationalSalesManager',
    'csPsManager',
    'raqaManager',
    'globalRaqaManager',
  ],
  zint: [
    'requesterName',
    'businessUnit',
    'salesManager',
    'districtSalesManager',
    'nationalSalesManager',
    'csPsManager',
    'raqaManager',
    'globalRaqaManager',
  ],
  return: [
    'requesterName',
    'businessUnit',
    'teamName',
    'reviewer',
    'firstApprover',
    'secondApprover',
    'finalApprover',
    'fourthApprover',
    'fifthApprover',
  ],
};

function listOrderBy(
  formType: FormTypeKey,
  sortBy: string,
  sortDir: 'asc' | 'desc'
): Record<string, 'asc' | 'desc'> {
  const allowed = LIST_SORT_FIELDS[formType];
  const field = allowed.includes(sortBy) ? sortBy : 'requesterName';
  return { [field]: sortDir };
}

const baseBodySchema = z.object({
  requesterName: z.string().min(1),
  businessUnit: z.enum(['CDG', 'LSG']),
});

const returnBaseBodySchema = z.object({
  requesterName: z.string().min(1),
  businessUnit: z.enum(['CDG', 'LSG', 'SERVICE']),
});

const optionalTeamSchema = z.object({
  /** Optional: ensure this requester is listed under this team in Data Management → Requesters (creates membership if missing). */
  requesterGroupId: z.string().uuid().optional(),
  /** Optional: set `requesters.code` for that membership (requires `requesterGroupId` in the same request). */
  salesRepCode: z.string().max(64).optional(),
});

const zsamFields = z.object({
  salesManager: z.string().nullable().optional(),
  districtSalesManager: z.string().nullable().optional(),
  nationalSalesManager: z.string().nullable().optional(),
  localFinanceController: z.string().nullable().optional(),
  directorCommercialManager: z.string().nullable().optional(),
});

const zncInstallFields = z.object({
  salesManager: z.string().nullable().optional(),
  districtSalesManager: z.string().nullable().optional(),
  nationalSalesManager: z.string().nullable().optional(),
  technicalManager: z.string().nullable().optional(),
  nationalTSManager: z.string().nullable().optional(),
  localFinanceController: z.string().nullable().optional(),
  directorCommercialManager: z.string().nullable().optional(),
});

const zncClaimZintFields = z.object({
  salesManager: z.string().nullable().optional(),
  districtSalesManager: z.string().nullable().optional(),
  nationalSalesManager: z.string().nullable().optional(),
  csPsManager: z.string().nullable().optional(),
  raqaManager: z.string().nullable().optional(),
  globalRaqaManager: z.string().nullable().optional(),
});

const returnFields = z.object({
  teamName: z.string().nullable().optional(),
  // Level 0, service requests only: checked before any approver is asked.
  reviewer: z.string().nullable().optional(),
  firstApprover: z.string().nullable().optional(),
  secondApprover: z.string().nullable().optional(),
  finalApprover: z.string().nullable().optional(),
  // Service managers (levels 4-5); filled for non-service groups only.
  fourthApprover: z.string().nullable().optional(),
  fifthApprover: z.string().nullable().optional(),
});

const createZsamSchema = baseBodySchema.merge(zsamFields).merge(optionalTeamSchema);
const createZncInstSchema = baseBodySchema.merge(zncInstallFields).merge(optionalTeamSchema);
const createClaimZintSchema = baseBodySchema.merge(zncClaimZintFields).merge(optionalTeamSchema);
const createReturnSchema = returnBaseBodySchema.merge(returnFields).merge(optionalTeamSchema);

/** After save: add directory row (requester in group) so the Team column can resolve. */
async function ensureRequesterInTeamForMapping(
  normalizedRequesterName: string,
  requesterGroupId: string,
  mappingBusinessUnit: 'CDG' | 'LSG' | 'SERVICE'
): Promise<void> {
  const group = await prisma.requesterGroup.findFirst({
    where: { id: requesterGroupId, isActive: true },
  });
  if (!group) {
    throw new AppError('Team (requester group) not found or inactive', 400);
  }
  if (!mappingBuMatchesGroup(mappingBusinessUnit, group.businessUnit)) {
    // Name the team's own unit. "Technical Service(CDG)" is a SERVICE team despite the suffix, so
    // "does not match business unit CDG" reads like a contradiction without it.
    throw new AppError(
      `Team "${group.name}" belongs to business unit ${group.businessUnit || '(none)'}, not ${mappingBusinessUnit}. Pick a ${mappingBusinessUnit} team, or change this row's business unit.`,
      400
    );
  }

  const existing = await prisma.requester.findFirst({
    where: {
      requesterGroupId,
      name: { equals: normalizedRequesterName, mode: 'insensitive' },
    },
  });
  if (existing) return;

  let code = `adm-${randomBytes(4).toString('hex')}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const taken = await prisma.requester.findFirst({ where: { code } });
    if (!taken) break;
    code = `adm-${randomBytes(4).toString('hex')}`;
  }

  await prisma.requester.create({
    data: {
      requesterGroupId,
      name: normalizedRequesterName,
      code,
      // Inherit the team's flow scope rather than being told it: a row created inside a
      // return-only team is return-only by construction, and a row in a shared sales team stays
      // visible to both flows. Saving a RETURN mapping row used to add the person to the shared
      // directory unscoped, which put them in the Sample Ordering dropdown.
      formScope: group.formScope ?? null,
    },
  });
}

/**
 * The business unit a mapping row's team assignment is checked against.
 *
 * SERVICE counts. It used to return null, so choosing SERVICE and then a team failed with "Set
 * business unit to CDG or LSG on this row before assigning a team" — which is exactly the wall an
 * admin hit trying to attach NIA HARGREAVES, whose only team is a Service one.
 */
function effectiveMappingBu(
  body: { businessUnit?: 'CDG' | 'LSG' | 'SERVICE' },
  existing: { businessUnit: string }
): 'CDG' | 'LSG' | 'SERVICE' | null {
  const raw = (body.businessUnit ?? existing.businessUnit ?? '').trim().toUpperCase();
  if (raw === 'CDG' || raw === 'LSG' || raw === 'SERVICE') return raw;
  return null;
}

/** When `salesRepCode` is provided and non-empty after whitespace trim, updates the requester row for that team. */
async function applySalesRepCodeIfProvided(
  salesRepCode: string | undefined,
  normalizedRequesterName: string,
  requesterGroupId: string
): Promise<void> {
  if (salesRepCode === undefined) return;
  const code = salesRepCode.trim();
  if (!code) return;

  const req = await prisma.requester.findFirst({
    where: {
      requesterGroupId,
      name: { equals: normalizedRequesterName, mode: 'insensitive' },
    },
  });
  if (!req) return;
  if (req.code === code) return;

  await prisma.requester.update({ where: { id: req.id }, data: { code } });
}

/**
 * Ensures directory membership when `requesterGroupId` is set, then optionally updates sales rep code.
 * If `salesRepCode` is non-empty but no team is selected, rejects (ambiguous which requester row to update).
 */
async function finalizeMappingTeamDirectory(
  body: { requesterGroupId?: string; businessUnit?: 'CDG' | 'LSG' | 'SERVICE'; salesRepCode?: string },
  existing: { requesterName: string; businessUnit: string },
  nameNorm: string | undefined
): Promise<void> {
  const effName = normalizeRequesterNameForDb(nameNorm != null ? nameNorm : String(existing.requesterName));
  if (!effName) throw new AppError('Invalid requester name for team assignment', 400);

  if (body.requesterGroupId) {
    const effBu = effectiveMappingBu(body, existing);
    if (!effBu) {
      throw new AppError(
        'Set business unit to CDG, LSG or SERVICE on this row before assigning a team.',
        400
      );
    }
    await ensureRequesterInTeamForMapping(effName, body.requesterGroupId, effBu);
    await applySalesRepCodeIfProvided(body.salesRepCode, effName, body.requesterGroupId);
    return;
  }

  if (body.salesRepCode !== undefined && String(body.salesRepCode).trim() !== '') {
    throw new AppError('Select a team (requester group) to set the sales rep code.', 400);
  }
}

/** Requester group BU vs approval-mapping row BU (CDG/LSG split). */
function mappingBuMatchesGroup(mappingBu: string | undefined, groupBu: string): boolean {
  const g = groupBu.trim().toUpperCase();
  const m = (mappingBu ?? '').trim().toUpperCase();
  if (!m) return true;
  if (m === 'CDG') return g === 'CDG' || g === 'CDG/LSG';
  if (m === 'LSG') return g === 'LSG' || g === 'CDG/LSG';
  return g === m;
}

type RequesterWithGroup = {
  id: string;
  code: string;
  requesterGroupId: string;
  name: string;
  requesterGroup: { name: string; businessUnit: string };
};

/** Batch-load requesters + groups; group by normalized requester name. */
async function fetchRequestersByNormalizedName(names: string[]): Promise<Map<string, RequesterWithGroup[]>> {
  const unique = [...new Set(names.map((n) => normalizeRequesterNameForDb(n)).filter(Boolean))];
  const map = new Map<string, RequesterWithGroup[]>();
  if (unique.length === 0) return map;

  const rows = await prisma.requester.findMany({
    where: {
      OR: unique.map((name) => ({
        name: { equals: name, mode: 'insensitive' },
      })),
    },
    select: {
      id: true,
      code: true,
      requesterGroupId: true,
      name: true,
      requesterGroup: { select: { name: true, businessUnit: true } },
    },
  });

  for (const r of rows) {
    const key = normalizeRequesterNameForDb(r.name);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return map;
}

function teamNamesForMappingRow(
  row: { requesterName?: unknown; businessUnit?: unknown },
  byName: Map<string, RequesterWithGroup[]>
): string | null {
  const key = normalizeRequesterNameForDb(String(row.requesterName ?? ''));
  const bu = String(row.businessUnit ?? '');
  const candidates = byName.get(key) ?? [];
  const matched = candidates.filter((c) => mappingBuMatchesGroup(bu, c.requesterGroup.businessUnit));
  const teamNames = [...new Set(matched.map((c) => c.requesterGroup.name))].sort();
  return teamNames.length > 0 ? teamNames.join(', ') : null;
}

function directoryLinksForMappingRow(
  row: { requesterName?: unknown; businessUnit?: unknown },
  byName: Map<string, RequesterWithGroup[]>
): Array<{ id: string; code: string; requesterGroupId: string; groupName: string }> {
  const key = normalizeRequesterNameForDb(String(row.requesterName ?? ''));
  const bu = String(row.businessUnit ?? '');
  const candidates = byName.get(key) ?? [];
  const matched = candidates.filter((c) => mappingBuMatchesGroup(bu, c.requesterGroup.businessUnit));
  return matched
    .map((c) => ({
      id: c.id,
      code: c.code,
      requesterGroupId: c.requesterGroupId,
      groupName: c.requesterGroup.name,
    }))
    .sort((a, b) => a.groupName.localeCompare(b.groupName, undefined, { sensitivity: 'base' }));
}

function repCodesDisplayForMappingRow(
  row: { requesterName?: unknown; businessUnit?: unknown },
  byName: Map<string, RequesterWithGroup[]>
): string | null {
  const links = directoryLinksForMappingRow(row, byName);
  if (links.length === 0) return null;
  const uniq = [...new Set(links.map((l) => l.code))].sort();
  return uniq.length > 0 ? uniq.join(', ') : null;
}

async function enrichMappingRowsWithTeams(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  const byName = await fetchRequestersByNormalizedName(rows.map((r) => String(r.requesterName ?? '')));
  return rows.map((row) => ({
    ...row,
    requesterTeamNames: teamNamesForMappingRow(row, byName),
    requesterDirectoryLinks: directoryLinksForMappingRow(row, byName),
    requesterRepCodesDisplay: repCodesDisplayForMappingRow(row, byName),
  }));
}

/**
 * GET /admin/approval-mappings/return/export
 *
 * Every row, in the canonical columns, as a CSV the importer accepts unchanged. The page-scoped
 * client-side export it replaces emitted whatever the table was showing, in a header that mixed
 * snake_case with camelCase and included derived columns no importer could write back.
 *
 * Deliberately not paginated: this is the file Japan edits and re-uploads, and half a matrix
 * uploaded as the whole matrix would prune every row it omitted.
 */
export const exportReturnApprovalMatrix = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const rows = await prisma.returnApprovalMapping.findMany({
      select: {
        requesterName: true,
        businessUnit: true,
        teamName: true,
        reviewer: true,
        firstApprover: true,
        secondApprover: true,
        finalApprover: true,
        fourthApprover: true,
        fifthApprover: true,
      },
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="return-approval-matrix-${date}.csv"`
    );
    // Without this the browser hides the header from the page's own fetch, and the download saves
    // under the fallback name instead of the dated one - which matters when several are kept.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(returnMatrixToCsv(rows));
  } catch (e) {
    next(e);
  }
};

export const listApprovalMappings = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const formType = parseFormType(req.params.formType || '');
    const q = listQuerySchema.parse(req.query);
    const where: {
      businessUnit?: string;
      requesterName?: { contains: string; mode: 'insensitive' };
    } = {};
    if (q.businessUnit === 'CDG' || q.businessUnit === 'LSG' || q.businessUnit === 'SERVICE') {
      where.businessUnit = q.businessUnit;
    }
    if (q.search?.trim()) {
      const t = q.search.trim();
      where.requesterName = { contains: t, mode: 'insensitive' };
    }

    let total: number;
    let rows: unknown[];

    const orderBy = listOrderBy(formType, q.sortBy, q.sortDir);
    const effectiveSortBy = Object.keys(orderBy)[0] ?? 'requesterName';

    if (formType === 'zsam') {
      total = await prisma.zsammApprovalMapping.count({ where });
      rows = await prisma.zsammApprovalMapping.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      });
    } else if (formType === 'znc-installation') {
      total = await prisma.zncApprovalMapping.count({ where });
      rows = await prisma.zncApprovalMapping.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      });
    } else if (formType === 'znc-claim') {
      total = await prisma.zncclaimApprovalMapping.count({ where });
      rows = await prisma.zncclaimApprovalMapping.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      });
    } else if (formType === 'return') {
      total = await prisma.returnApprovalMapping.count({ where });
      rows = await prisma.returnApprovalMapping.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      });
    } else {
      total = await prisma.zintApprovalMapping.count({ where });
      rows = await prisma.zintApprovalMapping.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      });
    }

    rows = await enrichMappingRowsWithTeams(rows as Record<string, unknown>[]);

    // #region agent log
    if (formType === 'znc-installation') {
      const buCounts = await prisma.zncApprovalMapping.groupBy({
        by: ['businessUnit'],
        _count: { _all: true },
      });
      const emptyBuCount = await prisma.zncApprovalMapping.count({
        where: { businessUnit: '' },
      });
      const cdgOnlyNoLsg = await prisma.$queryRaw<[{ cnt: bigint }]>`
        SELECT COUNT(*)::bigint AS cnt FROM znc_approval_mapping c
        WHERE c."businessUnit" = 'CDG'
          AND NOT EXISTS (
            SELECT 1 FROM znc_approval_mapping l
            WHERE l."requesterName" = c."requesterName" AND l."businessUnit" = 'LSG'
          )`;
      const rowStats = (rows as Record<string, unknown>[]).map((r) => ({
        hasSm: Boolean(r.salesManager),
        hasDsm: Boolean(r.districtSalesManager),
        hasNsm: Boolean(r.nationalSalesManager),
      }));
      const debugPayload = {
        sessionId: '372d2a',
        location: 'approval-mapping.controller.ts:listApprovalMappings',
        message: 'znc-installation list',
        data: {
          filterBu: q.businessUnit || '(all)',
          search: q.search?.trim() ? '(set)' : '(none)',
          page: q.page,
          limit: q.limit,
          total,
          rowsReturned: rowStats.length,
          approverPopulated: {
            sm: rowStats.filter((s) => s.hasSm).length,
            dsm: rowStats.filter((s) => s.hasDsm).length,
            nsm: rowStats.filter((s) => s.hasNsm).length,
          },
          buCounts: buCounts.map((b) => ({ bu: b.businessUnit || '(empty)', count: b._count._all })),
          emptyBuCount,
          cdgRowsMissingLsgPair: Number(cdgOnlyNoLsg[0]?.cnt ?? 0),
        },
        timestamp: Date.now(),
        hypothesisId: 'A,B,C,D,E',
      };
      // EC2/docker: grep backend logs for [DEBUG-ZNC-LSG]
      console.info('[DEBUG-ZNC-LSG]', JSON.stringify(debugPayload));
      fetch('http://127.0.0.1:7541/ingest/00000000-0000-4000-8000-a0a828311efb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '372d2a' },
        body: JSON.stringify(debugPayload),
      }).catch(() => {});
    }
    // #endregion

    res.json({
      success: true,
      formType,
      rows,
      total,
      page: q.page,
      limit: q.limit,
      sortBy: effectiveSortBy,
      sortDir: q.sortDir,
    });
  } catch (e) {
    next(e);
  }
};

export const getApprovalMapping = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const formType = parseFormType(req.params.formType || '');
    const { id } = req.params;

    let row: unknown;
    if (formType === 'zsam') {
      row = await prisma.zsammApprovalMapping.findUnique({ where: { id } });
    } else if (formType === 'znc-installation') {
      row = await prisma.zncApprovalMapping.findUnique({ where: { id } });
    } else if (formType === 'znc-claim') {
      row = await prisma.zncclaimApprovalMapping.findUnique({ where: { id } });
    } else if (formType === 'return') {
      row = await prisma.returnApprovalMapping.findUnique({ where: { id } });
    } else {
      row = await prisma.zintApprovalMapping.findUnique({ where: { id } });
    }

    if (!row) throw new AppError('Mapping row not found', 404);
    const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
    res.json({ success: true, formType, row: enriched });
  } catch (e) {
    next(e);
  }
};

export const createApprovalMapping = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const formType = parseFormType(req.params.formType || '');

    if (formType === 'zsam') {
      const body = createZsamSchema.parse(req.body);
      const nameNorm = normalizeRequesterNameForDb(body.requesterName);
      if (!nameNorm) throw new AppError('Requester name is required', 400);
      await assertRequesterInDirectory(prisma, nameNorm);
      await assertApproverUsersExist(prisma, [
        { label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) },
        { label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) },
        { label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) },
        { label: 'Local finance controller (LFC)', normalizedName: normApproverField(body.localFinanceController) },
        { label: 'Director commercial manager (DCM)', normalizedName: normApproverField(body.directorCommercialManager) },
      ]);
      const row = await prisma.zsammApprovalMapping.create({
        data: {
          requesterName: nameNorm,
          businessUnit: body.businessUnit,
          salesManager: normApproverField(body.salesManager),
          districtSalesManager: normApproverField(body.districtSalesManager),
          nationalSalesManager: normApproverField(body.nationalSalesManager),
          localFinanceController: normApproverField(body.localFinanceController),
          directorCommercialManager: normApproverField(body.directorCommercialManager),
        },
      });
      await finalizeMappingTeamDirectory(body, { requesterName: nameNorm, businessUnit: body.businessUnit }, nameNorm);
      const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
      res.status(201).json({ success: true, formType, row: enriched });
      return;
    }

    if (formType === 'znc-installation') {
      const body = createZncInstSchema.parse(req.body);
      const nameNorm = normalizeRequesterNameForDb(body.requesterName);
      if (!nameNorm) throw new AppError('Requester name is required', 400);
      await assertRequesterInDirectory(prisma, nameNorm);
      await assertApproverUsersExist(prisma, [
        { label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) },
        { label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) },
        { label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) },
        { label: 'Technical manager (TM)', normalizedName: normApproverField(body.technicalManager) },
        { label: 'National TS manager (NTSM)', normalizedName: normApproverField(body.nationalTSManager) },
        { label: 'Local finance controller (LFC)', normalizedName: normApproverField(body.localFinanceController) },
        { label: 'Director commercial manager (DCM)', normalizedName: normApproverField(body.directorCommercialManager) },
      ]);
      const row = await prisma.zncApprovalMapping.create({
        data: {
          requesterName: nameNorm,
          businessUnit: body.businessUnit,
          salesManager: normApproverField(body.salesManager),
          districtSalesManager: normApproverField(body.districtSalesManager),
          nationalSalesManager: normApproverField(body.nationalSalesManager),
          technicalManager: normApproverField(body.technicalManager),
          nationalTSManager: normApproverField(body.nationalTSManager),
          localFinanceController: normApproverField(body.localFinanceController),
          directorCommercialManager: normApproverField(body.directorCommercialManager),
        },
      });
      await finalizeMappingTeamDirectory(body, { requesterName: nameNorm, businessUnit: body.businessUnit }, nameNorm);
      const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
      res.status(201).json({ success: true, formType, row: enriched });
      return;
    }

    if (formType === 'return') {
      const body = createReturnSchema.parse(req.body);
      const nameNorm = normalizeRequesterNameForDb(body.requesterName);
      if (!nameNorm) throw new AppError('Requester name is required', 400);
      await assertRequesterInDirectory(prisma, nameNorm);
      await assertApproverUsersExist(prisma, [
        { label: 'Reviewer', normalizedName: normApproverField(body.reviewer) },
        { label: '1st Approver', normalizedName: normApproverField(body.firstApprover) },
        { label: '2nd Approver', normalizedName: normApproverField(body.secondApprover) },
        { label: 'Final Approver', normalizedName: normApproverField(body.finalApprover) },
        { label: '4th Approver', normalizedName: normApproverField(body.fourthApprover) },
        { label: '5th Approver', normalizedName: normApproverField(body.fifthApprover) },
      ]);
      const row = await prisma.returnApprovalMapping.create({
        data: {
          requesterName: nameNorm,
          businessUnit: body.businessUnit,
          teamName: normTeamNameField(body.teamName),
          reviewer: normReturnApproverField(body.reviewer),
          firstApprover: normReturnApproverField(body.firstApprover),
          secondApprover: normReturnApproverField(body.secondApprover),
          finalApprover: normReturnApproverField(body.finalApprover),
          fourthApprover: normReturnApproverField(body.fourthApprover),
          fifthApprover: normReturnApproverField(body.fifthApprover),
        },
      });
      // Runs for SERVICE too. The old CDG/LSG-only guard skipped it silently, so saving a Service
      // row with a team and a sales rep code returned 200 and changed nothing — reported from UAT as
      // "added Nia, but not reflected". finalizeMappingTeamDirectory now raises a clear error for
      // a row with no usable business unit instead of dropping the work.
      await finalizeMappingTeamDirectory(
        body,
        { requesterName: nameNorm, businessUnit: body.businessUnit },
        nameNorm
      );
      const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
      res.status(201).json({ success: true, formType, row: enriched });
      return;
    }

    const body = createClaimZintSchema.parse(req.body);
    const nameNorm = normalizeRequesterNameForDb(body.requesterName);
    if (!nameNorm) throw new AppError('Requester name is required', 400);
    await assertRequesterInDirectory(prisma, nameNorm);
    await assertApproverUsersExist(prisma, [
      { label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) },
      { label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) },
      { label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) },
      { label: 'CS/PS manager', normalizedName: normApproverField(body.csPsManager) },
      { label: 'RA/QA manager', normalizedName: normApproverField(body.raqaManager) },
      { label: 'Global RA/QA manager', normalizedName: normApproverField(body.globalRaqaManager) },
    ]);
    const data = {
      requesterName: nameNorm,
      businessUnit: body.businessUnit,
      salesManager: normApproverField(body.salesManager),
      districtSalesManager: normApproverField(body.districtSalesManager),
      nationalSalesManager: normApproverField(body.nationalSalesManager),
      csPsManager: normApproverField(body.csPsManager),
      raqaManager: normApproverField(body.raqaManager),
      globalRaqaManager: normApproverField(body.globalRaqaManager),
    };

    if (formType === 'znc-claim') {
      const row = await prisma.zncclaimApprovalMapping.create({ data });
      await finalizeMappingTeamDirectory(body, { requesterName: nameNorm, businessUnit: body.businessUnit }, nameNorm);
      const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
      res.status(201).json({ success: true, formType, row: enriched });
      return;
    }

    const row = await prisma.zintApprovalMapping.create({ data });
    await finalizeMappingTeamDirectory(body, { requesterName: nameNorm, businessUnit: body.businessUnit }, nameNorm);
    const [enrichedZint] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
    res.status(201).json({ success: true, formType, row: enrichedZint });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      next(new AppError('A row with this requester name and business unit already exists (for a return, also the team name)', 409));
      return;
    }
    next(e);
  }
};

const updateZsamSchema = z
  .object({ requesterName: z.string().min(1).optional(), businessUnit: z.enum(['CDG', 'LSG']).optional() })
  .merge(zsamFields)
  .merge(optionalTeamSchema);
const updateZncInstSchema = z
  .object({ requesterName: z.string().min(1).optional(), businessUnit: z.enum(['CDG', 'LSG']).optional() })
  .merge(zncInstallFields)
  .merge(optionalTeamSchema);
const updateClaimZintSchema = z
  .object({ requesterName: z.string().min(1).optional(), businessUnit: z.enum(['CDG', 'LSG']).optional() })
  .merge(zncClaimZintFields)
  .merge(optionalTeamSchema);
const updateReturnSchema = z
  .object({
    requesterName: z.string().min(1).optional(),
    businessUnit: z.enum(['CDG', 'LSG', 'SERVICE']).optional(),
  })
  .merge(returnFields)
  .merge(optionalTeamSchema);

export const updateApprovalMapping = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const formType = parseFormType(req.params.formType || '');
    const { id } = req.params;

    if (formType === 'zsam') {
      const body = updateZsamSchema.parse(req.body);
      const nameNorm =
        body.requesterName != null ? normalizeRequesterNameForDb(body.requesterName) : undefined;
      if (body.requesterName != null && !nameNorm) throw new AppError('Invalid requester name', 400);
      const existing = await prisma.zsammApprovalMapping.findUnique({ where: { id } });
      if (!existing) throw new AppError('Mapping row not found', 404);
      if (nameNorm !== undefined) await assertRequesterInDirectory(prisma, nameNorm);
      {
        const appr: Array<{ label: string; normalizedName: string | null | undefined }> = [];
        if (body.salesManager !== undefined)
          appr.push({ label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) });
        if (body.districtSalesManager !== undefined)
          appr.push({ label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) });
        if (body.nationalSalesManager !== undefined)
          appr.push({ label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) });
        if (body.localFinanceController !== undefined)
          appr.push({ label: 'Local finance controller (LFC)', normalizedName: normApproverField(body.localFinanceController) });
        if (body.directorCommercialManager !== undefined)
          appr.push({
            label: 'Director commercial manager (DCM)',
            normalizedName: normApproverField(body.directorCommercialManager),
          });
        await assertApproverUsersExist(prisma, appr);
      }
      try {
        const row = await prisma.zsammApprovalMapping.update({
          where: { id },
          data: {
            ...(nameNorm !== undefined ? { requesterName: nameNorm } : {}),
            ...(body.businessUnit !== undefined ? { businessUnit: body.businessUnit } : {}),
            ...(body.salesManager !== undefined ? { salesManager: normApproverField(body.salesManager) } : {}),
            ...(body.districtSalesManager !== undefined
              ? { districtSalesManager: normApproverField(body.districtSalesManager) }
              : {}),
            ...(body.nationalSalesManager !== undefined
              ? { nationalSalesManager: normApproverField(body.nationalSalesManager) }
              : {}),
            ...(body.localFinanceController !== undefined
              ? { localFinanceController: normApproverField(body.localFinanceController) }
              : {}),
            ...(body.directorCommercialManager !== undefined
              ? { directorCommercialManager: normApproverField(body.directorCommercialManager) }
              : {}),
          },
        });
        await finalizeMappingTeamDirectory(body, existing, nameNorm);
        const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
        res.json({ success: true, formType, row: enriched });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          next(new AppError('A row with this requester name and business unit already exists', 409));
          return;
        }
        throw e;
      }
      return;
    }

    if (formType === 'znc-installation') {
      const body = updateZncInstSchema.parse(req.body);
      const nameNorm =
        body.requesterName != null ? normalizeRequesterNameForDb(body.requesterName) : undefined;
      if (body.requesterName != null && !nameNorm) throw new AppError('Invalid requester name', 400);
      const existing = await prisma.zncApprovalMapping.findUnique({ where: { id } });
      if (!existing) throw new AppError('Mapping row not found', 404);
      if (nameNorm !== undefined) await assertRequesterInDirectory(prisma, nameNorm);
      {
        const appr: Array<{ label: string; normalizedName: string | null | undefined }> = [];
        if (body.salesManager !== undefined)
          appr.push({ label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) });
        if (body.districtSalesManager !== undefined)
          appr.push({ label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) });
        if (body.nationalSalesManager !== undefined)
          appr.push({ label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) });
        if (body.technicalManager !== undefined)
          appr.push({ label: 'Technical manager (TM)', normalizedName: normApproverField(body.technicalManager) });
        if (body.nationalTSManager !== undefined)
          appr.push({ label: 'National TS manager (NTSM)', normalizedName: normApproverField(body.nationalTSManager) });
        if (body.localFinanceController !== undefined)
          appr.push({ label: 'Local finance controller (LFC)', normalizedName: normApproverField(body.localFinanceController) });
        if (body.directorCommercialManager !== undefined)
          appr.push({
            label: 'Director commercial manager (DCM)',
            normalizedName: normApproverField(body.directorCommercialManager),
          });
        await assertApproverUsersExist(prisma, appr);
      }
      try {
        const row = await prisma.zncApprovalMapping.update({
          where: { id },
          data: {
            ...(nameNorm !== undefined ? { requesterName: nameNorm } : {}),
            ...(body.businessUnit !== undefined ? { businessUnit: body.businessUnit } : {}),
            ...(body.salesManager !== undefined ? { salesManager: normApproverField(body.salesManager) } : {}),
            ...(body.districtSalesManager !== undefined
              ? { districtSalesManager: normApproverField(body.districtSalesManager) }
              : {}),
            ...(body.nationalSalesManager !== undefined
              ? { nationalSalesManager: normApproverField(body.nationalSalesManager) }
              : {}),
            ...(body.technicalManager !== undefined
              ? { technicalManager: normApproverField(body.technicalManager) }
              : {}),
            ...(body.nationalTSManager !== undefined
              ? { nationalTSManager: normApproverField(body.nationalTSManager) }
              : {}),
            ...(body.localFinanceController !== undefined
              ? { localFinanceController: normApproverField(body.localFinanceController) }
              : {}),
            ...(body.directorCommercialManager !== undefined
              ? { directorCommercialManager: normApproverField(body.directorCommercialManager) }
              : {}),
          },
        });
        await finalizeMappingTeamDirectory(body, existing, nameNorm);
        const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
        res.json({ success: true, formType, row: enriched });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          next(new AppError('A row with this requester name and business unit already exists', 409));
          return;
        }
        throw e;
      }
      return;
    }

    if (formType === 'return') {
      const body = updateReturnSchema.parse(req.body);
      const nameNorm =
        body.requesterName != null ? normalizeRequesterNameForDb(body.requesterName) : undefined;
      if (body.requesterName != null && !nameNorm) throw new AppError('Invalid requester name', 400);
      const existing = await prisma.returnApprovalMapping.findUnique({ where: { id } });
      if (!existing) throw new AppError('Mapping row not found', 404);
      if (nameNorm !== undefined) await assertRequesterInDirectory(prisma, nameNorm);
      {
        const appr: Array<{ label: string; normalizedName: string | null | undefined }> = [];
        if (body.reviewer !== undefined)
          appr.push({ label: 'Reviewer', normalizedName: normApproverField(body.reviewer) });
        if (body.firstApprover !== undefined)
          appr.push({ label: '1st Approver', normalizedName: normApproverField(body.firstApprover) });
        if (body.secondApprover !== undefined)
          appr.push({ label: '2nd Approver', normalizedName: normApproverField(body.secondApprover) });
        if (body.finalApprover !== undefined)
          appr.push({ label: 'Final Approver', normalizedName: normApproverField(body.finalApprover) });
        if (body.fourthApprover !== undefined)
          appr.push({ label: '4th Approver', normalizedName: normApproverField(body.fourthApprover) });
        if (body.fifthApprover !== undefined)
          appr.push({ label: '5th Approver', normalizedName: normApproverField(body.fifthApprover) });
        await assertApproverUsersExist(prisma, appr);
      }
      try {
        const row = await prisma.returnApprovalMapping.update({
          where: { id },
          data: {
            ...(nameNorm !== undefined ? { requesterName: nameNorm } : {}),
            ...(body.businessUnit !== undefined ? { businessUnit: body.businessUnit } : {}),
            ...(body.teamName !== undefined ? { teamName: normTeamNameField(body.teamName) } : {}),
            ...(body.reviewer !== undefined ? { reviewer: normReturnApproverField(body.reviewer) } : {}),
            ...(body.firstApprover !== undefined
              ? { firstApprover: normReturnApproverField(body.firstApprover) }
              : {}),
            ...(body.secondApprover !== undefined
              ? { secondApprover: normReturnApproverField(body.secondApprover) }
              : {}),
            ...(body.finalApprover !== undefined
              ? { finalApprover: normReturnApproverField(body.finalApprover) }
              : {}),
            ...(body.fourthApprover !== undefined
              ? { fourthApprover: normReturnApproverField(body.fourthApprover) }
              : {}),
            ...(body.fifthApprover !== undefined
              ? { fifthApprover: normReturnApproverField(body.fifthApprover) }
              : {}),
          },
        });
        // Same silent skip as on create; see the note there.
        const bu = body.businessUnit ?? existing.businessUnit;
        await finalizeMappingTeamDirectory(
          body,
          { requesterName: existing.requesterName, businessUnit: bu },
          nameNorm
        );
        const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
        res.json({ success: true, formType, row: enriched });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          next(new AppError('A row with this requester name, business unit and team name already exists', 409));
          return;
        }
        throw e;
      }
      return;
    }

    const body = updateClaimZintSchema.parse(req.body);
    const nameNorm =
      body.requesterName != null ? normalizeRequesterNameForDb(body.requesterName) : undefined;
    if (body.requesterName != null && !nameNorm) throw new AppError('Invalid requester name', 400);
    const data = {
      ...(nameNorm !== undefined ? { requesterName: nameNorm } : {}),
      ...(body.businessUnit !== undefined ? { businessUnit: body.businessUnit } : {}),
      ...(body.salesManager !== undefined ? { salesManager: normApproverField(body.salesManager) } : {}),
      ...(body.districtSalesManager !== undefined
        ? { districtSalesManager: normApproverField(body.districtSalesManager) }
        : {}),
      ...(body.nationalSalesManager !== undefined
        ? { nationalSalesManager: normApproverField(body.nationalSalesManager) }
        : {}),
      ...(body.csPsManager !== undefined ? { csPsManager: normApproverField(body.csPsManager) } : {}),
      ...(body.raqaManager !== undefined ? { raqaManager: normApproverField(body.raqaManager) } : {}),
      ...(body.globalRaqaManager !== undefined
        ? { globalRaqaManager: normApproverField(body.globalRaqaManager) }
        : {}),
    };

    if (nameNorm !== undefined) await assertRequesterInDirectory(prisma, nameNorm);
    {
      const appr: Array<{ label: string; normalizedName: string | null | undefined }> = [];
      if (body.salesManager !== undefined)
        appr.push({ label: 'Sales manager (SM)', normalizedName: normApproverField(body.salesManager) });
      if (body.districtSalesManager !== undefined)
        appr.push({ label: 'District sales manager (DSM)', normalizedName: normApproverField(body.districtSalesManager) });
      if (body.nationalSalesManager !== undefined)
        appr.push({ label: 'National sales manager (NSM)', normalizedName: normApproverField(body.nationalSalesManager) });
      if (body.csPsManager !== undefined)
        appr.push({ label: 'CS/PS manager', normalizedName: normApproverField(body.csPsManager) });
      if (body.raqaManager !== undefined)
        appr.push({ label: 'RA/QA manager', normalizedName: normApproverField(body.raqaManager) });
      if (body.globalRaqaManager !== undefined)
        appr.push({ label: 'Global RA/QA manager', normalizedName: normApproverField(body.globalRaqaManager) });
      await assertApproverUsersExist(prisma, appr);
    }

    if (formType === 'znc-claim') {
      const existing = await prisma.zncclaimApprovalMapping.findUnique({ where: { id } });
      if (!existing) throw new AppError('Mapping row not found', 404);
      try {
        const row = await prisma.zncclaimApprovalMapping.update({ where: { id }, data });
        await finalizeMappingTeamDirectory(body, existing, nameNorm);
        const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
        res.json({ success: true, formType, row: enriched });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          next(new AppError('A row with this requester name and business unit already exists', 409));
          return;
        }
        throw e;
      }
      return;
    }

    const existing = await prisma.zintApprovalMapping.findUnique({ where: { id } });
    if (!existing) throw new AppError('Mapping row not found', 404);
    try {
      const row = await prisma.zintApprovalMapping.update({ where: { id }, data });
      await finalizeMappingTeamDirectory(body, existing, nameNorm);
      const [enriched] = await enrichMappingRowsWithTeams([row as Record<string, unknown>]);
      res.json({ success: true, formType, row: enriched });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        next(new AppError('A row with this requester name and business unit already exists', 409));
        return;
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
};

export const deleteApprovalMapping = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const formType = parseFormType(req.params.formType || '');
    const { id } = req.params;

    if (formType === 'zsam') {
      await prisma.zsammApprovalMapping.delete({ where: { id } });
    } else if (formType === 'znc-installation') {
      await prisma.zncApprovalMapping.delete({ where: { id } });
    } else if (formType === 'znc-claim') {
      await prisma.zncclaimApprovalMapping.delete({ where: { id } });
    } else if (formType === 'return') {
      await prisma.returnApprovalMapping.delete({ where: { id } });
    } else {
      await prisma.zintApprovalMapping.delete({ where: { id } });
    }

    res.json({ success: true, message: 'Deleted' });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      next(new AppError('Mapping row not found', 404));
      return;
    }
    next(e);
  }
};

const summaryQuerySchema = z.object({
  name: z.string().min(1),
});

/** True when both legacy `businessUnit` '' and explicit CDG/LSG rows exist (duplicate risk). */
function duplicateLegacyBuWarning(rows: { businessUnit?: string | null }[]): boolean {
  const bus = rows.map((r) => (r.businessUnit ?? '').trim());
  const hasEmpty = bus.some((b) => b === '');
  const hasExplicit = bus.some((b) => b === 'CDG' || b === 'LSG');
  return hasEmpty && hasExplicit;
}

/**
 * GET /admin/approval-mappings/summary?name=LONNIE+DUNGAN
 * All four mapping tables for one requester (full picture for admins).
 */
export const getApprovalMappingSummary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = summaryQuerySchema.parse(req.query);
    const raw = q.name.trim();
    const normalized = normalizeRequesterNameForDb(raw);
    if (!normalized) throw new AppError('name query parameter is required', 400);

    const nameWhere = { requesterName: { equals: normalized, mode: 'insensitive' as const } };

    const [zsamRows, zncRows, zncclaimRows, zintRows, returnRows] = await Promise.all([
      prisma.zsammApprovalMapping.findMany({ where: nameWhere, orderBy: { businessUnit: 'asc' } }),
      prisma.zncApprovalMapping.findMany({ where: nameWhere, orderBy: { businessUnit: 'asc' } }),
      prisma.zncclaimApprovalMapping.findMany({ where: nameWhere, orderBy: { businessUnit: 'asc' } }),
      prisma.zintApprovalMapping.findMany({ where: nameWhere, orderBy: { businessUnit: 'asc' } }),
      prisma.returnApprovalMapping.findMany({ where: nameWhere, orderBy: { businessUnit: 'asc' } }),
    ]);

    const [zsam, znc, zncclaim, zint, ret] = await Promise.all([
      enrichMappingRowsWithTeams(zsamRows as Record<string, unknown>[]),
      enrichMappingRowsWithTeams(zncRows as Record<string, unknown>[]),
      enrichMappingRowsWithTeams(zncclaimRows as Record<string, unknown>[]),
      enrichMappingRowsWithTeams(zintRows as Record<string, unknown>[]),
      enrichMappingRowsWithTeams(returnRows as Record<string, unknown>[]),
    ]);

    res.json({
      success: true,
      query: raw,
      normalizedName: normalized,
      tables: {
        zsam: {
          formType: 'zsam',
          label: 'ZSAM',
          count: zsam.length,
          rows: zsam,
          duplicateLegacyBuWarning: duplicateLegacyBuWarning(zsamRows),
        },
        zncInstallation: {
          formType: 'znc-installation',
          label: 'ZNC Installation',
          count: znc.length,
          rows: znc,
          duplicateLegacyBuWarning: duplicateLegacyBuWarning(zncRows),
        },
        zncClaim: {
          formType: 'znc-claim',
          label: 'ZNC Claim',
          count: zncclaim.length,
          rows: zncclaim,
          duplicateLegacyBuWarning: duplicateLegacyBuWarning(zncclaimRows),
        },
        zint: {
          formType: 'zint',
          label: 'ZINT QC',
          count: zint.length,
          rows: zint,
          duplicateLegacyBuWarning: duplicateLegacyBuWarning(zintRows),
        },
        return: {
          formType: 'return',
          label: 'Return',
          count: ret.length,
          rows: ret,
          duplicateLegacyBuWarning: duplicateLegacyBuWarning(returnRows),
        },
      },
    });
  } catch (e) {
    next(e);
  }
};
