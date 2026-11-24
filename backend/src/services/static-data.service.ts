import { Prisma, PrismaClient } from '@prisma/client';

import { columnExistsInCurrentSchema } from '../utils/pgMeta';
import { isReturnReviewStepEnabled } from '../constants/return-form.constants';
import { searchTextWhere, selectableProductWhere } from './product-catalog/selectable';

const prisma = new PrismaClient();

/**
 * Customer data structure with Business Unit support
 */
export interface Customer {
  businessGroup: string;      // "CDG" or "LSG"
  customerGroup: string;      // e.g., "Z001"
  firstDigit: string;          // "1" (SOLD-TO), "2" (Direct Delivery), "8" (End User)
  code: string;               // 7-digit code
  sapCode: string;            // SAP code
  nameJapanese: string;       // Company name in Japanese
  nameEnglish?: string;       // Company name in English
  postalCode: string;
  prefecture?: string;
  address: string;
  phone: string;
}

/**
 * Is a directory row in scope for this form type?
 *
 * A row scoped to RETURN is offered only to the return flow; a row with no scope is offered to both.
 * Sample and Return share one requester directory, so without this a `ret-…` group carrying a
 * business unit of CDG or LSG appears in the sample wizard — which is how Damian Diggin became
 * selectable on a sample order.
 *
 * Called with no form type (as some internal callers do) it hides nothing, which keeps every
 * existing caller behaving as it did.
 */
function isDirectoryRowInScope(formScope: string | null | undefined, formType?: string): boolean {
  const scope = (formScope ?? '').trim().toUpperCase();
  if (!scope) return true;                       // unscoped: both flows
  if (!formType) return true;                    // caller did not say: do not hide anything
  return scope === String(formType).trim().toUpperCase();
}

/**
 * Get requester groups filtered by business unit (from database).
 *
 * All active groups for the BU are included, EXCEPT those belonging to another flow — a group
 * scoped to RETURN is offered only when asking as RETURN. `formType` used to be accepted and
 * thrown away, which is why the return teams reached the sample wizard.
 *
 * @param businessUnit - Business unit to filter by (CDG, LSG, etc.)
 * @param formType - The flow asking. Omit to hide nothing.
 * @returns Array of requester groups with id and name
 */
export const getRequesterGroupsByBusinessUnit = async (
  businessUnit?: string,
  formType?: string
): Promise<Array<{ id: string; name: string }>> => {
  if (!businessUnit) {
    return [];
  }

  const useScope = await hasFormScopeColumn('requester_groups');
  const allGroups = await prisma.requesterGroup.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      businessUnit: true,
      code: true,
      ...(useScope ? { formScope: true } : {}),
    },
  });

  // Filter by business unit (supports slash-separated e.g. "CDG/LSG"), then by flow.
  const filtered = allGroups.filter((g) => {
    const units = String(g.businessUnit ?? '')
      .split('/')
      .map((u) => u.trim());
    return (
      units.includes(businessUnit) &&
      isDirectoryRowInScope((g as { formScope?: string | null }).formScope, formType)
    );
  });

  return filtered.map((g) => ({ id: g.id, name: g.name }));
};

/** True if requester has no effective sales rep code (empty, NA, nan) – these show as "brackets" in ZSAM. */
function hasNoSalesRepCode(code: string | null | undefined): boolean {
  const c = (code ?? '').trim().toLowerCase();
  return c === '' || c === 'na' || c === 'nan';
}

/** Fullwidth space → space; collapse runs (wizard / Excel master list). */
function normalizePartnerDisplayName(name: string): string {
  return name.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 7-digit sales code for personal (9…) dropdown; strips leading zeros / SAP padding. */
function normalizePersonalAccountCode(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t || hasNoSalesRepCode(t)) return '';
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 7) {
    const last7 = digits.slice(-7);
    if (last7.startsWith('9')) return last7;
  }
  const stripped = t.replace(/^0+(?=\d)/, '');
  return stripped.startsWith('9') ? stripped : '';
}

/** Name or code match for personal-account search (supports padded codes e.g. 0009002301). */
function personalAccountSearchTokenWhere(token: string): Prisma.RequesterWhereInput {
  const or: Prisma.RequesterWhereInput[] = [
    { name: { contains: token, mode: 'insensitive' } },
    { code: { contains: token, mode: 'insensitive' } },
  ];
  const digits = token.replace(/\D/g, '');
  if (digits.length > 0) {
    const stripped = digits.replace(/^0+(?=\d)/, '');
    if (stripped && stripped !== digits) {
      or.push({ code: { contains: stripped, mode: 'insensitive' } });
    }
    if (digits.length >= 7) {
      const last7 = digits.slice(-7);
      if (last7 !== token && last7 !== stripped) {
        or.push({ code: { contains: last7, mode: 'insensitive' } });
      }
    }
  }
  return { OR: or };
}

const INVALID_REQUESTER_CODE_WHERE: Prisma.RequesterWhereInput = {
  NOT: {
    OR: [
      { code: { equals: 'na', mode: 'insensitive' } },
      { code: { equals: 'nan', mode: 'insensitive' } },
      { code: '' },
    ],
  },
};

const REQUESTER_SELECT_WITH_SAMPLE = {
  id: true,
  code: true,
  name: true,
  requesterGroupId: true,
  isActive: true,
  sampleRequestType: true,
} as const;

const REQUESTER_SELECT_LEGACY = {
  id: true,
  code: true,
  name: true,
  requesterGroupId: true,
  isActive: true,
} as const;

/**
 * Only cache `true` so a migrate deploy without process restart is picked up on the next request.
 * While the column is missing, we re-check each time (cheap EXISTS query).
 */
let cachedSampleRequestTypeColumnExists: true | undefined;

async function hasSampleRequestTypeColumn(): Promise<boolean> {
  if (cachedSampleRequestTypeColumnExists === true) {
    return true;
  }
  const exists = await columnExistsInCurrentSchema(prisma, 'requesters', 'sample_request_type');
  if (exists) {
    cachedSampleRequestTypeColumnExists = true;
  } else {
    console.warn(
      '[getSalesRepsByRequesterGroup] column requesters.sample_request_type missing; using legacy select. Run: npx prisma migrate deploy'
    );
  }
  return exists;
}


/**
 * `form_scope` guard, same shape as the one above and for the same reason: a select naming a column
 * that has not been migrated yet fails the whole request. Cached only on success, so a
 * `migrate deploy` without a process restart is picked up on the next call.
 *
 * While the column is missing every row reads as unscoped, which is exactly the old behaviour.
 */
const cachedFormScopeColumnExists: Record<string, true | undefined> = {};

async function hasFormScopeColumn(table: 'requesters' | 'requester_groups'): Promise<boolean> {
  if (cachedFormScopeColumnExists[table] === true) {
    return true;
  }
  const exists = await columnExistsInCurrentSchema(prisma, table, 'form_scope');
  if (exists) {
    cachedFormScopeColumnExists[table] = true;
  } else {
    console.warn(
      `[directory scope] column ${table}.form_scope missing; Sample and Return share every row. Run: npx prisma migrate deploy`
    );
  }
  return exists;
}
/**
 * Load requester group + active requesters. Omits `sample_request_type` when the column is not migrated yet.
 */
async function findRequesterGroupForSalesReps(requesterGroupId: string) {
  const where = {
    isActive: true,
    OR: [{ id: requesterGroupId }, { code: requesterGroupId }],
  };
  const useSample = await hasSampleRequestTypeColumn();
  const useScope = await hasFormScopeColumn('requesters');
  const requesterSelect = {
    ...(useSample ? REQUESTER_SELECT_WITH_SAMPLE : REQUESTER_SELECT_LEGACY),
    ...(useScope ? { formScope: true } : {}),
  };
  return prisma.requesterGroup.findFirst({
    where,
    include: {
      requesters: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: requesterSelect,
      },
    },
  });
}

/**
 * Get sales reps filtered by requester group ID (from database)
 * When formType is ZSAM (Sales Promotional), only returns requesters with a valid sales rep code (no "bracket" entries).
 *
 * @param requesterGroupId - Requester group ID (UUID) or code to filter by
 * @param formType - Optional: when 'ZSAM', exclude requesters with empty/NA code (non-sales)
 * @returns Array of sales reps with full details
 */
export const getSalesRepsByRequesterGroup = async (
  requesterGroupId?: string,
  formType?: string
): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    salesManager: string;
    districtSalesManager: string;
    nationalSalesManager: string;
    localFinanceController: string;
    directorCommercialManager: string;
    requesterGroupId: string;
  }>
> => {
  if (!requesterGroupId) {
    return [];
  }

  const group = await findRequesterGroupForSalesReps(requesterGroupId);

  if (!group) {
    return [];
  }

  let requesters = group.requesters;

  // Flow scope first: a requester belonging to another flow is not offered here at all. This is
  // separate from the sample-request-type restriction below, which only ever narrows within Sample.
  requesters = requesters.filter((r) =>
    isDirectoryRowInScope((r as { formScope?: string | null }).formScope, formType)
  );

  // Optional per-requester restriction (set in Data Management): only show for matching sample request type
  if (formType && ['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT'].includes(formType)) {
    requesters = requesters.filter((r) => {
      const st = (r as { sampleRequestType?: string | null }).sampleRequestType;
      return !st || st === formType;
    });
  }
  // For ZSAM (Sales Promotional), hide requesters with no sales rep code (they show as "Name ()" – brackets)
  if (formType === 'ZSAM') {
    requesters = requesters.filter((r) => !hasNoSalesRepCode(r.code));
  }

  const NATIONAL_SALES_MANAGER = 'Cailum Cortez';
  const LOCAL_FINANCE_CONTROLLER = 'Roberta Miley';
  const DIRECTOR_COMMERCIAL_MANAGER = 'Devon Comyn';

  return requesters.map((r) => ({
    id: r.id,
    code: hasNoSalesRepCode(r.code) ? '' : String(r.code ?? '').trim(),
    name: r.name,
    salesManager: '',
    districtSalesManager: '',
    nationalSalesManager: NATIONAL_SALES_MANAGER,
    localFinanceController: LOCAL_FINANCE_CONTROLLER,
    directorCommercialManager: DIRECTOR_COMMERCIAL_MANAGER,
    requesterGroupId: group.id,
  }));
};

export type RequesterPersonalAccountRow = { code: string; name: string };

/**
 * Paginated "personal" partner rows: active requesters (all groups) whose code starts with 9.
 * Requires a non-empty search string (name and/or code). Whitespace tokens are ANDed.
 */
export const getRequesterPersonalAccountsPaginated = async (
  _requesterGroupId: string | undefined,
  formType: string | undefined,
  options: { search?: string; limit?: number; offset?: number }
): Promise<{ accounts: RequesterPersonalAccountRow[]; total: number; hasMore: boolean }> => {
  const searchTrimmed = options.search?.trim() ?? '';
  if (!searchTrimmed) {
    return { accounts: [], total: 0, hasMore: false };
  }

  const limitNum = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offsetNum = Math.max(options.offset ?? 0, 0);

  const where: Prisma.RequesterWhereInput = {
    isActive: true,
    code: { startsWith: '9', mode: 'insensitive' },
    AND: [INVALID_REQUESTER_CODE_WHERE],
  };

  const useSample = await hasSampleRequestTypeColumn();
  if (formType && ['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT'].includes(formType)) {
    if (useSample) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [{ sampleRequestType: null }, { sampleRequestType: formType }],
        },
      ];
    }
  }

  const tokens = searchTrimmed.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      personalAccountSearchTokenWhere(token),
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.requester.findMany({
      where,
      take: limitNum,
      skip: offsetNum,
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    }),
    prisma.requester.count({ where }),
  ]);

  const accounts = rows
    .map((r) => ({
      code: normalizePersonalAccountCode(String(r.code ?? '')),
      name: normalizePartnerDisplayName(r.name),
    }))
    .filter((a) => a.code.length > 0 && a.name.length > 0);

  return {
    accounts,
    total,
    hasMore: offsetNum + accounts.length < total,
  };
};

/**
 * Normalize a value from the mapping (handles "Blank", empty strings, null)
 */
const normalizeZsamValue = (val?: string | null): string | undefined => {
  if (val == null) return undefined;
  const trimmed = String(val).trim();
  if (trimmed.toLowerCase() === 'blank' || trimmed === '') return undefined;
  return trimmed;
};

/** Normalize requester key for lookup: fullwidth space → space, trim, upper */
function normalizeRequesterKeyForLookup(name: string): string {
  return name.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Maps API/product BU to stored mapping key: '', 'CDG', 'LSG', or 'SERVICE'.
 * Combined CDG/LSG → '' (legacy single-row bucket).
 */
export function resolveBusinessUnitKey(businessUnit?: string | null): string {
  if (businessUnit == null) return '';
  const s = String(businessUnit).replace(/\u3000/g, ' ').trim().toUpperCase();
  if (!s) return '';
  if (s === 'SERVICE' || s.startsWith('SERVICE')) return 'SERVICE';
  if (s.includes('CDG') && s.includes('LSG')) return '';
  if (s.includes('LSG') && !s.includes('CDG')) return 'LSG';
  if (s.includes('CDG')) return 'CDG';
  if (s === 'LSG') return 'LSG';
  return '';
}

/** Try (requesterName, BU) in order; then fuzzy name match with same BU fallbacks. */
async function findZsammMappingRow(key: string, businessUnit?: string | null) {
  const bu = resolveBusinessUnitKey(businessUnit);
  const order = bu === 'CDG' || bu === 'LSG' ? [bu, ''] : ['', 'CDG', 'LSG'];
  for (const b of order) {
    const rec = await prisma.zsammApprovalMapping.findFirst({
      where: { requesterName: key, businessUnit: b },
    });
    if (rec) return rec;
  }
  const all = await prisma.zsammApprovalMapping.findMany();
  const fuzzy = all.filter((r) => normalizeRequesterKeyForLookup(r.requesterName) === key);
  if (fuzzy.length === 0) return null;
  if (fuzzy.length === 1) return fuzzy[0];
  for (const b of order) {
    const hit = fuzzy.find((r) => r.businessUnit === b);
    if (hit) return hit;
  }
  return fuzzy.sort((a, b) => a.businessUnit.localeCompare(b.businessUnit))[0];
}

export type ZsamApproversFields = {
  salesManager?: string;
  districtSalesManager?: string;
  nationalSalesManager?: string;
  localFinanceController?: string;
  directorCommercialManager?: string;
};

/**
 * Whether a zsamm_approval_mapping row exists for this requester (+ BU resolution).
 * When `hasMappingRow` is true, approver fields come **only** from the mapping row:
 * null/empty in DB becomes undefined here — callers must NOT fall back to User hierarchy
 * (otherwise cleared DSM would reappear from the User record).
 */
export const getZsamApproversForMerge = async (
  requesterName?: string,
  businessUnit?: string | null
): Promise<{ hasMappingRow: false } | { hasMappingRow: true; approvers: ZsamApproversFields }> => {
  if (!requesterName) return { hasMappingRow: false };

  const key = normalizeRequesterKeyForLookup(requesterName);
  const rec = await findZsammMappingRow(key, businessUnit);

  if (!rec) return { hasMappingRow: false };

  return {
    hasMappingRow: true,
    approvers: {
      salesManager: normalizeZsamValue(rec.salesManager),
      districtSalesManager: normalizeZsamValue(rec.districtSalesManager),
      nationalSalesManager: normalizeZsamValue(rec.nationalSalesManager),
      localFinanceController: normalizeZsamValue(rec.localFinanceController),
      directorCommercialManager: normalizeZsamValue(rec.directorCommercialManager),
    },
  };
};

/**
 * Get ZSAM approvers for a given requester name (from database).
 * Returns fields normalized to the form model. Missing/Blank entries are undefined.
 * Returns undefined when no mapping row exists.
 *
 * @param businessUnit - When set (CDG/LSG), selects national-account split rows when present.
 */
export const getZsamApprovers = async (
  requesterName?: string,
  businessUnit?: string | null
): Promise<ZsamApproversFields | undefined> => {
  const m = await getZsamApproversForMerge(requesterName, businessUnit);
  if (!m.hasMappingRow) return undefined;
  return m.approvers;
};

export type ReturnApproversFields = {
  /** Service review, taken before any approval; service-related returns only. */
  reviewer?: string;
  firstApprover?: string;
  secondApprover?: string;
  finalApprover?: string;
  /** Service managers from the two extra matrix columns; service-related returns only. */
  fourthApprover?: string;
  fifthApprover?: string;
  teamName?: string;
};

/** Team names compare the way the sheet is read: case and spacing are not identity. */
function normalizeTeamKeyForLookup(name?: string | null): string {
  return String(name ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * The one row to route by, out of however many the sheet holds for this person.
 *
 * Team name is part of a row's identity, so a person listed under two teams has two rows - the
 * Technical Service people sit under both (CDG) and (LSG). When the request says which team it was
 * raised under, that row wins; otherwise the rows for the pair are ordered by team name so the
 * answer is at least the same one every time, rather than whatever the database happens to return.
 *
 * Every merged key in today's sheet carries an identical chain, so this changes no routing now. It
 * is what lets the matrix hold a different chain per team, which the sheet has always been able to
 * express and the narrower key silently discarded.
 */
async function findReturnMappingRow(
  key: string,
  businessUnit?: string | null,
  teamName?: string | null
) {
  const bu = resolveBusinessUnitKey(businessUnit);
  const order =
    bu === 'CDG' || bu === 'LSG' || bu === 'SERVICE'
      ? [bu, '']
      : ['', 'CDG', 'LSG', 'SERVICE'];
  const wantedTeam = normalizeTeamKeyForLookup(teamName);
  const pick = (rows: typeof candidates) => {
    if (rows.length === 0) return null;
    if (wantedTeam) {
      const onTeam = rows.find((r) => normalizeTeamKeyForLookup(r.teamName) === wantedTeam);
      if (onTeam) return onTeam;
    }
    return [...rows].sort((a, b) => a.teamName.localeCompare(b.teamName))[0];
  };

  let candidates: Awaited<ReturnType<typeof prisma.returnApprovalMapping.findMany>> = [];
  for (const b of order) {
    candidates = await prisma.returnApprovalMapping.findMany({
      where: { requesterName: key, businessUnit: b },
    });
    const hit = pick(candidates);
    if (hit) return hit;
  }

  const all = await prisma.returnApprovalMapping.findMany();
  const fuzzy = all.filter((r) => normalizeRequesterKeyForLookup(r.requesterName) === key);
  if (fuzzy.length === 0) return null;
  for (const b of order) {
    const hit = pick(fuzzy.filter((r) => r.businessUnit === b));
    if (hit) return hit;
  }
  return (
    pick(fuzzy) ??
    [...fuzzy].sort((a, b) => a.businessUnit.localeCompare(b.businessUnit))[0]
  );
}

/**
 * Whether a return_approval_mapping row exists for this requester (+ BU).
 * When hasMappingRow is true, blank cells stay undefined (do not fall back to User hierarchy).
 */
/**
 * The team name behind whatever a form stored in `requesterGroup`.
 *
 * Forms store the directory row's id; the matrix keys its rows by the team's name, which is the same
 * string the directory group carries. An id that resolves to no group is handed back unchanged - old
 * rows hold the name itself - and a name that matches no team simply fails to match, leaving the
 * lookup on its deterministic fallback rather than routing somewhere unexpected.
 */
export const resolveRequesterTeamName = async (
  requesterGroup?: string | null
): Promise<string | null> => {
  const raw = String(requesterGroup ?? '').trim();
  if (!raw) return null;
  const byId = await prisma.requesterGroup.findUnique({
    where: { id: raw },
    select: { name: true },
  });
  if (byId) return byId.name;
  const byCode = await prisma.requesterGroup.findUnique({
    where: { code: raw },
    select: { name: true },
  });
  return byCode?.name ?? raw;
};

export const getReturnApproversForMerge = async (
  requesterName?: string,
  businessUnit?: string | null,
  /** The team the request was raised under, when the caller knows it. See findReturnMappingRow. */
  teamName?: string | null
): Promise<{ hasMappingRow: false } | { hasMappingRow: true; approvers: ReturnApproversFields }> => {
  if (!requesterName) return { hasMappingRow: false };

  const key = normalizeRequesterKeyForLookup(requesterName);
  const rec = await findReturnMappingRow(key, businessUnit, teamName);
  if (!rec) return { hasMappingRow: false };

  return {
    hasMappingRow: true,
    approvers: {
      // Feature-flagged. This function is the only source of return approvers — the approval
      // chain builder and the wizard's preview endpoint both read it — so withholding the reviewer
      // here removes the step from the chain AND from the preview, with no second switch to keep in
      // sync. A chain-config row whose mapping field resolves to nothing is skipped, which is the
      // same mechanism that drops an unset 4th/5th approver.
      reviewer: isReturnReviewStepEnabled() ? normalizeZsamValue(rec.reviewer) : undefined,
      firstApprover: normalizeZsamValue(rec.firstApprover),
      secondApprover: normalizeZsamValue(rec.secondApprover),
      finalApprover: normalizeZsamValue(rec.finalApprover),
      fourthApprover: normalizeZsamValue(rec.fourthApprover),
      fifthApprover: normalizeZsamValue(rec.fifthApprover),
      teamName: normalizeZsamValue(rec.teamName),
    },
  };
};

export const getReturnApprovers = async (
  requesterName?: string,
  businessUnit?: string | null,
  teamName?: string | null
): Promise<ReturnApproversFields | undefined> => {
  const m = await getReturnApproversForMerge(requesterName, businessUnit, teamName);
  if (!m.hasMappingRow) return undefined;
  return m.approvers;
};

function normalizeZintValue(val: string | null | undefined): string | undefined {
  const trimmed = typeof val === 'string' ? val.trim() : '';
  if (trimmed.toLowerCase() === 'blank' || trimmed === '') return undefined;
  return trimmed;
}

async function findZintMappingRow(key: string, businessUnit?: string | null) {
  const bu = resolveBusinessUnitKey(businessUnit);
  const order = bu === 'CDG' || bu === 'LSG' ? [bu, ''] : ['', 'CDG', 'LSG'];
  for (const b of order) {
    const rec = await prisma.zintApprovalMapping.findFirst({
      where: { requesterName: key, businessUnit: b },
    });
    if (rec) return rec;
  }
  const all = await prisma.zintApprovalMapping.findMany();
  const fuzzy = all.filter((r) => normalizeRequesterKeyForLookup(r.requesterName) === key);
  if (fuzzy.length === 0) return null;
  if (fuzzy.length === 1) return fuzzy[0];
  for (const b of order) {
    const hit = fuzzy.find((r) => r.businessUnit === b);
    if (hit) return hit;
  }
  return fuzzy.sort((a, b) => a.businessUnit.localeCompare(b.businessUnit))[0];
}

/**
 * Get ZINT approvers for a given requester name (from zint_approval_mapping).
 * ZINT chain: ➋ SM → ➌ DSM → ❹ NSM → ➎ CS/PS Manager → ❻ RAQA (≤¥1.5M) / ➐ Global RAQA (>¥1.5M)
 */
export const getZintApprovers = async (
  requesterName?: string,
  businessUnit?: string | null
): Promise<{
  salesManager?: string;
  districtSalesManager?: string;
  nationalSalesManager?: string;
  csPsManager?: string;
  raqaManager?: string;
  globalRaqaManager?: string;
} | undefined> => {
  if (!requesterName) return undefined;

  const key = normalizeRequesterKeyForLookup(requesterName);
  const rec = await findZintMappingRow(key, businessUnit);
  if (!rec) return undefined;

  return {
    salesManager: normalizeZintValue(rec.salesManager),
    districtSalesManager: normalizeZintValue(rec.districtSalesManager),
    nationalSalesManager: normalizeZintValue(rec.nationalSalesManager),
    csPsManager: normalizeZintValue(rec.csPsManager),
    raqaManager: normalizeZintValue(rec.raqaManager),
    globalRaqaManager: normalizeZintValue(rec.globalRaqaManager),
  };
};

const normalizeMappingValue = (val: string | null | undefined): string | undefined => {
  const trimmed = typeof val === 'string' ? val.trim() : '';
  if (trimmed.toLowerCase() === 'blank' || trimmed === '') return undefined;
  return trimmed;
};

async function findZncMappingRow(key: string, businessUnit?: string | null) {
  const bu = resolveBusinessUnitKey(businessUnit);
  const order = bu === 'CDG' || bu === 'LSG' ? [bu, ''] : ['', 'CDG', 'LSG'];
  for (const b of order) {
    const rec = await prisma.zncApprovalMapping.findFirst({
      where: { requesterName: key, businessUnit: b },
    });
    if (rec) return rec;
  }
  const all = await prisma.zncApprovalMapping.findMany();
  const fuzzy = all.filter((r) => normalizeRequesterKeyForLookup(r.requesterName) === key);
  if (fuzzy.length === 0) return null;
  if (fuzzy.length === 1) return fuzzy[0];
  for (const b of order) {
    const hit = fuzzy.find((r) => r.businessUnit === b);
    if (hit) return hit;
  }
  return fuzzy.sort((a, b) => a.businessUnit.localeCompare(b.businessUnit))[0];
}

async function findZncclaimMappingRow(key: string, businessUnit?: string | null) {
  const bu = resolveBusinessUnitKey(businessUnit);
  const order = bu === 'CDG' || bu === 'LSG' ? [bu, ''] : ['', 'CDG', 'LSG'];
  for (const b of order) {
    const rec = await prisma.zncclaimApprovalMapping.findFirst({
      where: { requesterName: key, businessUnit: b },
    });
    if (rec) return rec;
  }
  const all = await prisma.zncclaimApprovalMapping.findMany();
  const fuzzy = all.filter((r) => normalizeRequesterKeyForLookup(r.requesterName) === key);
  if (fuzzy.length === 0) return null;
  if (fuzzy.length === 1) return fuzzy[0];
  for (const b of order) {
    const hit = fuzzy.find((r) => r.businessUnit === b);
    if (hit) return hit;
  }
  return fuzzy.sort((a, b) => a.businessUnit.localeCompare(b.businessUnit))[0];
}

/**
 * Get ZNC (Installation) approvers for a given requester name (from znc_approval_mapping).
 * Chain: ➋ SM → ➌ DSM → ❹ NSM → ➎ TM → ❻ NTSM → ➐ LFC (>¥3M) → ➑ DCM (>¥3M)
 */
export const getZncApprovers = async (
  requesterName?: string,
  businessUnit?: string | null
): Promise<{
  salesManager?: string;
  districtSalesManager?: string;
  nationalSalesManager?: string;
  technicalManager?: string;
  nationalTSManager?: string;
  localFinanceController?: string;
  directorCommercialManager?: string;
} | undefined> => {
  if (!requesterName) return undefined;

  const key = normalizeRequesterKeyForLookup(requesterName);
  const rec = await findZncMappingRow(key, businessUnit);
  if (!rec) return undefined;

  return {
    salesManager: normalizeMappingValue(rec.salesManager),
    districtSalesManager: normalizeMappingValue(rec.districtSalesManager),
    nationalSalesManager: normalizeMappingValue(rec.nationalSalesManager),
    technicalManager: normalizeMappingValue(rec.technicalManager),
    nationalTSManager: normalizeMappingValue(rec.nationalTSManager),
    localFinanceController: normalizeMappingValue(rec.localFinanceController),
    directorCommercialManager: normalizeMappingValue(rec.directorCommercialManager),
  };
};

/**
 * Get ZNCCLAIM (Claim Replacement) approvers for a given requester name (from zncclaim_approval_mapping).
 * Chain: ➋ SM → ➌ DSM → ❹ NSM → ➎ CS/PS Manager → ❻ RAQA (≤¥1.5M) / ➐ Global RAQA (>¥1.5M)
 */
export const getZncclaimApprovers = async (
  requesterName?: string,
  businessUnit?: string | null
): Promise<{
  salesManager?: string;
  districtSalesManager?: string;
  nationalSalesManager?: string;
  csPsManager?: string;
  raqaManager?: string;
  globalRaqaManager?: string;
} | undefined> => {
  if (!requesterName) return undefined;

  const key = normalizeRequesterKeyForLookup(requesterName);
  const rec = await findZncclaimMappingRow(key, businessUnit);
  if (!rec) return undefined;

  return {
    salesManager: normalizeMappingValue(rec.salesManager),
    districtSalesManager: normalizeMappingValue(rec.districtSalesManager),
    nationalSalesManager: normalizeMappingValue(rec.nationalSalesManager),
    csPsManager: normalizeMappingValue(rec.csPsManager),
    raqaManager: normalizeMappingValue(rec.raqaManager),
    globalRaqaManager: normalizeMappingValue(rec.globalRaqaManager),
  };
};

/**
 * Get customers filtered by business unit and first digit from database
 * Supports pagination and search (multi-word: each token must match one of code, sapCode, nameJp, nameEn; AND across tokens).
 *
 * @param businessUnit - Business unit to filter by (CDG, LSG)
 * @param firstDigit - First digit of code ("1" for SOLD-TO, "2" for Direct Delivery, "8" for End Users)
 * @param options - Pagination and search options
 * @returns Object with customers array and total count
 */
export const getCustomersByBusinessUnit = async (
  businessUnit?: string,
  firstDigit?: string,
  options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
): Promise<{ customers: Customer[]; total: number }> => {
  if (!businessUnit) {
    return { customers: [], total: 0 };
  }

  const where: any = {
    businessGroup: businessUnit,
    isActive: true, // Only return active customers
    status: 'APPROVED', // Only return approved customers
  };

  if (firstDigit) {
    where.firstDigit = firstDigit;
  }

  // Multi-token AND search (same semantics as getProductsByBusinessUnit):
  // each whitespace-separated token must match at least one of code / sapCode / JP / EN.
  if (options?.search && options.search.trim()) {
    const tokens = options.search.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const tokenConditions = tokens.map((token) => ({
        OR: [
          { code: { contains: token, mode: 'insensitive' as const } },
          { sapCode: { contains: token, mode: 'insensitive' as const } },
          { nameJp: { contains: token, mode: 'insensitive' as const } },
          { nameEn: { contains: token, mode: 'insensitive' as const } },
        ],
      }));
      where.AND = where.AND || [];
      where.AND.push(...tokenConditions);
    }
  }

  // Get total count and customers in parallel
  const [dbCustomers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      take: options?.limit ?? undefined,
      skip: options?.offset ?? undefined,
      orderBy: { code: 'asc' }, // Consistent ordering
    }),
    prisma.customer.count({ where }),
  ]);

  // Map database records to Customer interface
  const customers = dbCustomers.map(c => ({
    businessGroup: c.businessGroup,
    customerGroup: '', // Not stored in DB, can be empty
    firstDigit: c.firstDigit,
    code: c.code,
    sapCode: c.sapCode,
    nameJapanese: c.nameJp,
    nameEnglish: c.nameEn,
    postalCode: c.postalCode || '',
    prefecture: c.prefecture || undefined,
    address: c.address || '',
    phone: c.phone || '',
  }));

  return { customers, total };
};

/**
 * Get customers formatted for frontend (compatible with existing types)
 * Maps to ChannelPartner or EndUser format
 * Supports pagination and search
 */
export const getCustomersFormatted = async (
  businessUnit?: string,
  firstDigit?: string,
  options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
): Promise<{
  customers: Array<{
    code: string;
    name: string;
    nameEnglish?: string;
    postalCode: string;
    prefecture?: string;
    address: string;
    phone: string;
    sapCode?: string;
  }>;
  total: number;
}> => {
  const { customers, total } = await getCustomersByBusinessUnit(businessUnit, firstDigit, options);

  const formatted = customers.map(customer => ({
    code: customer.code,
    name: customer.nameJapanese,
    nameEnglish: customer.nameEnglish,
    postalCode: customer.postalCode,
    prefecture: customer.prefecture,
    address: customer.address,
    phone: customer.phone,
    sapCode: customer.sapCode,
  }));

  return { customers: formatted, total };
};

/**
 * Product data structure
 */
export interface Product {
  businessGroup: string;      // "CDG" or "LSG"
  code: string;               // Product code
  sapCode: string;            // SAP code (may be empty for LSG)
  name: string;               // English product name
  price: number;              // Contract price
  listPrice: number;          // List price
  productNameLocal: string;   // Japanese product name (or English for LSG)
  division?: string;          // Division (CDG only)
  statisticsGroup?: string;   // Statistics group (CDG only)
  priceGroup?: string;        // Price group (LSG only)
}

/**
 * One product by its exact code (then SAP code) within a business unit.
 *
 * The wizards used to find a picked product by searching for its code with limit 100 and matching
 * client-side; a short code with more than 100 substring hits (CDG 12000 has 326) fell outside that
 * page and the line was priced at 0, which changes the approval route. This never pages.
 */
export const getProductExact = async (businessUnit: string, code: string): Promise<Product | null> => {
  const trimmed = code.trim();
  if (!businessUnit || !trimmed) return null;
  const base = selectableProductWhere(businessUnit);
  const row =
    (await prisma.productCatalog.findFirst({ where: { ...base, code: trimmed } })) ??
    (await prisma.productCatalog.findFirst({ where: { ...base, sapCode: trimmed }, orderBy: { code: 'asc' } }));
  if (!row) return null;
  return {
    businessGroup: row.businessGroup,
    code: row.code,
    sapCode: row.sapCode,
    name: row.name,
    price: Number(row.price),
    listPrice: Number(row.listPrice),
    productNameLocal: row.productNameLocal,
    division: row.division || undefined,
    statisticsGroup: row.statisticsGroup || undefined,
    priceGroup: row.priceGroup || undefined,
  };
};

/**
 * Get products filtered by business unit from database
 * Supports pagination and search
 * 
 * @param businessUnit - Business unit to filter by (CDG, LSG)
 * @param options - Pagination and search options
 * @returns Object with products array and total count
 */
export const getProductsByBusinessUnit = async (
  businessUnit?: string,
  options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
): Promise<{ products: Product[]; total: number }> => {
  if (!businessUnit) {
    return { products: [], total: 0 };
  }

  // Every word must match (AND), each anywhere in the code, SAP code or either name - "EDX LOW"
  // finds "EDX HBV Low Run Control". Matching is on the stored search key, folded for width and case,
  // so ﾘｸｲﾁｪｯｸ (as the Power BI master spells it) and リクイチェック (as people type it) both match.
  const tokens = searchTextWhere(options?.search);
  const where = {
    ...selectableProductWhere(businessUnit),
    ...(tokens.length > 0 ? { AND: tokens } : {}),
  };

  // Get total count and products in parallel
  const [dbProducts, total] = await Promise.all([
    prisma.productCatalog.findMany({
      where,
      take: options?.limit ?? undefined,
      skip: options?.offset ?? undefined,
      orderBy: { code: 'asc' }, // Consistent ordering
    }),
    prisma.productCatalog.count({ where }),
  ]);

  // Map database records to Product interface
  const products = dbProducts.map(p => ({
    businessGroup: p.businessGroup,
    code: p.code,
    sapCode: p.sapCode,
    name: p.name,
    price: Number(p.price),
    listPrice: Number(p.listPrice),
    productNameLocal: p.productNameLocal,
    division: p.division || undefined,
    statisticsGroup: p.statisticsGroup || undefined,
    priceGroup: p.priceGroup || undefined,
  }));

  return { products, total };
};


/**
 * Everything the Return wizard needs in order to decide what a signed-in requester may pick.
 *
 * `users.requesterGroupId` and `users.salesRepCode` were being treated as the answer to "who is this
 * requester", and neither can be. The `requesters` table is the real record: one row per person per
 * team. On UAT 38 people hold two or three rows, 120 of 123 REQUESTER accounts carry no sales rep
 * code at all, and 119 have no row whose name matches — so a wizard keyed on those two columns
 * showed most requesters an empty, disabled dropdown they could not get past.
 *
 * Resolution runs widest-reliable-first and stops at the first hit:
 *   1. rows linked by `userId` — authoritative, set by the admin UI and the backfill migration
 *   2. rows carrying this person's sales rep code — only when the code looks real, never a
 *      placeholder like `TBD` or `N/A`
 *   3. rows whose normalised name equals theirs — the historical fallback
 *
 * When nothing matches we return `unrestricted`. That is a deliberate choice: we cannot prove which
 * team the person is on, and letting them choose is far better than the previous behaviour of
 * disabling the field with nothing in it. It matches what a requester with no group already saw.
 */
export type RequesterScope = {
  /** No requester row could be tied to this account, so no restriction is applied. */
  unrestricted: boolean;
  /** How the rows were found — surfaced so the UI can explain itself and for support. */
  matchedBy: 'userId' | 'salesRepCode' | 'name' | 'none';
  groupIds: string[];
  requesterIds: string[];
};

/** A real SAP sales rep code, as opposed to a placeholder someone typed to satisfy a required field. */
const looksLikeRealSalesRepCode = (code: string | null | undefined): boolean =>
  /^\d{5,10}$/.test(String(code ?? '').trim());

const normalizeRequesterName = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

export const resolveRequesterScope = async (userId: string): Promise<RequesterScope> => {
  // Loaded here rather than taken from the request: the auth token carries only id/email/role/name,
  // and the sales rep code is needed for the second resolution step.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, salesRepCode: true },
  });
  if (!user) return { unrestricted: true, matchedBy: 'none', groupIds: [], requesterIds: [] };

  const select = { id: true, requesterGroupId: true } as const;
  const shape = (
    rows: Array<{ id: string; requesterGroupId: string }>,
    matchedBy: RequesterScope['matchedBy']
  ): RequesterScope => ({
    unrestricted: false,
    matchedBy,
    groupIds: [...new Set(rows.map((r) => r.requesterGroupId))],
    requesterIds: rows.map((r) => r.id),
  });

  const byUser = await prisma.requester.findMany({
    where: { userId: user.id, isActive: true },
    select,
  });
  if (byUser.length > 0) return shape(byUser, 'userId');

  const code = String(user.salesRepCode ?? '').trim();
  if (looksLikeRealSalesRepCode(code)) {
    const byCode = await prisma.requester.findMany({ where: { code, isActive: true }, select });
    if (byCode.length > 0) return shape(byCode, 'salesRepCode');
  }

  const wanted = normalizeRequesterName(user.name);
  if (wanted) {
    // Normalisation cannot be expressed in the query, so compare in memory over the active rows.
    const all = await prisma.requester.findMany({
      where: { isActive: true },
      select: { ...select, name: true },
    });
    const byName = all.filter((r) => normalizeRequesterName(r.name) === wanted);
    if (byName.length > 0) return shape(byName, 'name');
  }

  return { unrestricted: true, matchedBy: 'none', groupIds: [], requesterIds: [] };
};

export type ReturnMatrixRoles = { isRequester: boolean; isApprover: boolean; isReviewer: boolean };

/**
 * Which parts a person plays in the return approval matrix, by name - the matrix holds names, not
 * user ids. Drives what the Return home shows: a reviewer who approves nowhere has an Approver's
 * Inbox that can only ever be empty.
 */
export const getReturnMatrixRolesForName = async (name: string | null | undefined): Promise<ReturnMatrixRoles> => {
  const key = normalizeRequesterKeyForLookup(String(name ?? ''));
  if (!key) return { isRequester: false, isApprover: false, isReviewer: false };
  const rows = await prisma.returnApprovalMapping.findMany();
  const same = (v: string | null | undefined) => Boolean(v) && normalizeRequesterKeyForLookup(String(v)) === key;
  return {
    isRequester: rows.some((r) => same(r.requesterName)),
    isApprover: rows.some((r) =>
      [r.firstApprover, r.secondApprover, r.finalApprover, r.fourthApprover, r.fifthApprover].some(same)
    ),
    isReviewer: rows.some((r) => same(r.reviewer)),
  };
};
