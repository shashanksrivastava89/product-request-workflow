/**
 * Bulk import Phase 2: persist validated rows (upsert by natural keys).
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { ValidatedCustomerRow } from './validate-customers';
import type { ValidatedUserRow } from './validate-users';
import type { ValidatedZsammHierarchyRow } from './validate-zsam-hierarchy';
import type { ValidatedZncInstallationHierarchyRow } from './validate-znc-installation-hierarchy';
import type { ValidatedZncClaimReplacementHierarchyRow } from './validate-znc-claim-replacement-hierarchy';
import type { ValidatedZintQcHierarchyRow } from './validate-zint-qc-hierarchy';

const prisma = new PrismaClient();

const CUSTOMER_CHUNK = 150;
const USER_CHUNK = 50;
const ZSAMM_CHUNK = 50;
const ZNC_INSTALL_CHUNK = 50;
const ZNC_CLAIM_CHUNK = 50;
const ZINT_QC_CHUNK = 50;

export interface ExecuteStats {
  created: number;
  updated: number;
  /** ZINT QC / ZNC claim / ZNC installation: rows deleted so DB matches the file per CDG/LSG block */
  removed?: number;
}

/**
 * After upserting hierarchy rows for an import, delete any rows with the same `requesterName` whose
 * `businessUnit` is not present in the file for that requester. Ensures bulk upload is the only
 * authority (no duplicate keys like "" vs LSG, stray admin UI rows, or old seed drift).
 */
async function removeStrayBusinessUnitRowsForImportedRequesters(
  delegate: { deleteMany: (args: { where: { requesterName: string; businessUnit: { notIn: string[] } } }) => Promise<{ count: number }> },
  rows: { requesterName: string; businessUnit: string }[]
): Promise<number> {
  const allowedBusByRequester = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = allowedBusByRequester.get(r.requesterName);
    if (!s) {
      s = new Set<string>();
      allowedBusByRequester.set(r.requesterName, s);
    }
    s.add(r.businessUnit);
  }
  let total = 0;
  for (const [requesterName, allowedBus] of allowedBusByRequester) {
    const notIn = [...allowedBus];
    if (notIn.length === 0) continue;
    const del = await delegate.deleteMany({
      where: {
        requesterName,
        businessUnit: { notIn },
      },
    });
    total += del.count;
  }
  return total;
}

/** ZSAM import: sync `requesters` table from Team Name + Group */
export interface ZsamRequesterSyncStats {
  created: number;
  updated: number;
  moved: number;
}

function hasNoSalesRepCode(code: string | null | undefined): boolean {
  const c = String(code ?? '').trim().toLowerCase();
  return c === '' || c === 'na' || c === 'nan';
}

function normalizeRepCodeForDb(s: string): string {
  return String(s ?? '').trim();
}

/**
 * Place each imported sales rep into the requester group implied by Team Name + Group (CDG/LSG).
 * Uses optional Sales Rep Code from file; otherwise existing Requester row or User.salesRepCode.
 */
export async function executeZsamRequesterGroupSync(
  rows: ValidatedZsammHierarchyRow[]
): Promise<ZsamRequesterSyncStats> {
  let created = 0;
  let updated = 0;
  let moved = 0;

  for (const r of rows) {
    const gCode = r.requesterGroupCode;
    if (!gCode) continue;

    const group = await prisma.requesterGroup.findUnique({ where: { code: gCode } });
    if (!group) {
      throw new Error(`Requester group not found for code ${gCode}. Run DB migrations / seed requester groups.`);
    }

    const nameEq = r.requesterName;
    let resolvedCode = normalizeRepCodeForDb(r.salesRepCodeForSync || '');

    const existing = await prisma.requester.findMany({
      where: { name: { equals: nameEq, mode: 'insensitive' } },
      include: { requesterGroup: true },
    });

    if (existing.length > 1) {
      const inTarget = existing.filter((x) => x.requesterGroupId === group.id);
      if (inTarget.length > 1) {
        throw new Error(
          `Row ${r.rowIndex}: multiple "${nameEq}" requester rows in group ${gCode}. Resolve duplicates in the database, then retry.`
        );
      }
    }

    if (!resolvedCode || hasNoSalesRepCode(resolvedCode)) {
      if (existing.length === 1) {
        resolvedCode = normalizeRepCodeForDb(existing[0]!.code);
      }
    }
    if (!resolvedCode || hasNoSalesRepCode(resolvedCode)) {
      const user = await prisma.user.findFirst({
        where: { name: { equals: nameEq, mode: 'insensitive' } },
        select: { salesRepCode: true },
      });
      if (user?.salesRepCode && !hasNoSalesRepCode(user.salesRepCode)) {
        resolvedCode = normalizeRepCodeForDb(user.salesRepCode);
      }
    }

    if (!resolvedCode || hasNoSalesRepCode(resolvedCode)) {
      throw new Error(
        `Row ${r.rowIndex}: ${nameEq} — add a Sales Rep Code or Account Number column, or ensure this person exists as a User or Requester with a sales rep code.`
      );
    }

    if (existing.length > 1) {
      const inTarget = existing.find((x) => x.requesterGroupId === group.id);
      if (inTarget) {
        await prisma.requester.update({
          where: { id: inTarget.id },
          data: { code: resolvedCode },
        });
        updated++;
        continue;
      }
      const toMove = existing.find((x) => x.requesterGroupId !== group.id) ?? existing[0]!;
      const wasMove = toMove.requesterGroupId !== group.id;
      await prisma.requester.update({
        where: { id: toMove.id },
        data: { requesterGroupId: group.id, code: resolvedCode },
      });
      if (wasMove) moved++;
      else updated++;
      continue;
    }

    if (existing.length === 1) {
      const e = existing[0]!;
      const wasMove = e.requesterGroupId !== group.id;
      await prisma.requester.update({
        where: { id: e.id },
        data: { requesterGroupId: group.id, code: resolvedCode },
      });
      if (wasMove) moved++;
      else updated++;
      continue;
    }

    await prisma.requester.create({
      data: {
        requesterGroupId: group.id,
        name: nameEq,
        code: resolvedCode,
      },
    });
    created++;
  }

  return { created, updated, moved };
}

export async function executeCustomerImport(rows: ValidatedCustomerRow[]): Promise<ExecuteStats> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += CUSTOMER_CHUNK) {
    const chunk = rows.slice(i, i + CUSTOMER_CHUNK);
    const existing = await prisma.customer.findMany({
      where: {
        OR: chunk.map((r) => ({ businessGroup: r.businessGroup, code: r.code })),
      },
      select: { id: true, businessGroup: true, code: true },
    });
    const idByKey = new Map<string, string>();
    for (const e of existing) {
      idByKey.set(`${e.businessGroup}|${e.code}`, e.id);
    }

    const approvedAt = new Date();
    for (const r of chunk) {
      const key = `${r.businessGroup}|${r.code}`;
      const id = idByKey.get(key);
      const data = {
        firstDigit: r.firstDigit,
        sapCode: r.sapCode,
        nameJp: r.nameJp,
        nameEn: r.nameEn || '',
        postalCode: r.postalCode,
        prefecture: r.prefecture,
        address: r.address,
        phone: r.phone,
        // Match admin create: bulk import is authoritative master data
        status: 'APPROVED' as const,
        isActive: true,
        approvedAt,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      };
      if (id) {
        await prisma.customer.update({ where: { id }, data });
        updated++;
      } else {
        await prisma.customer.create({
          data: {
            businessGroup: r.businessGroup,
            code: r.code,
            ...data,
          },
        });
        created++;
      }
    }
  }

  return { created, updated };
}

/** Exported for admin UI: create REQUESTER user + link to `requesters` directory (same rules as user import). */
export async function syncRequesterRecordForImportedUser(user: {
  id: string;
  name: string;
  salesRepCode: string | null;
  requesterGroupId: string | null;
}): Promise<void> {
  const codeRaw = user.salesRepCode?.trim();
  if (!codeRaw || hasNoSalesRepCode(codeRaw)) return;

  const codeNorm = codeRaw.replace(/^0+(?=\d)/, '') || codeRaw;

  const byUser = await prisma.requester.findFirst({ where: { userId: user.id } });
  if (!user.requesterGroupId) {
    if (byUser) {
      await prisma.requester.update({
        where: { id: byUser.id },
        data: { name: user.name, code: codeNorm },
      });
    }
    return;
  }

  if (byUser) {
    await prisma.requester.update({
      where: { id: byUser.id },
      data: {
        requesterGroupId: user.requesterGroupId,
        code: codeNorm,
        name: user.name,
      },
    });
    return;
  }

  // Return-scoped rows are excluded deliberately. This search spans every group and then
  // REASSIGNS the row's group below, so a sample-side user import could pull a person out of their
  // return team — the rows the return sync creates have no userId, which is exactly what this
  // prefers. Sample and Return keep their own directory rows.
  const nameMatches = (
    await prisma.requester.findMany({
      where: { name: { equals: user.name, mode: 'insensitive' } },
    })
  ).filter((x) => String((x as { formScope?: string | null }).formScope ?? '').toUpperCase() !== 'RETURN');
  const orphan = nameMatches.find((x) => !x.userId) ?? nameMatches[0];
  if (orphan) {
    await prisma.requester.update({
      where: { id: orphan.id },
      data: {
        userId: user.id,
        requesterGroupId: user.requesterGroupId,
        code: codeNorm,
        name: user.name,
      },
    });
    return;
  }

  await prisma.requester.create({
    data: {
      userId: user.id,
      requesterGroupId: user.requesterGroupId,
      name: user.name,
      code: codeNorm,
    },
  });
}

export async function executeUserImport(rows: ValidatedUserRow[]): Promise<ExecuteStats> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += USER_CHUNK) {
    const chunk = rows.slice(i, i + USER_CHUNK);
    for (const r of chunk) {
      const email = r.email.trim();
      const role = r.role as UserRole;
      let requesterGroupId: string | null = null;
      if (!r.skipRequesterGroupUpdate && r.requesterGroupCode?.trim()) {
        const g = await prisma.requesterGroup.findUnique({
          where: { code: r.requesterGroupCode.trim() },
        });
        if (!g) {
          throw new Error(`Row ${r.rowIndex}: Requester group code not found: ${r.requesterGroupCode}`);
        }
        requesterGroupId = g.id;
      }

      const existing = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      const passwordPlain = r.defaultPassword?.trim() || null;
      const passwordHash = passwordPlain
        ? await bcrypt.hash(passwordPlain, 10)
        : undefined;

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: r.name,
            role,
            businessUnit: r.businessUnit,
            salesRepCode: r.salesRepCode,
            ...(!r.skipRequesterGroupUpdate ? { requesterGroupId } : {}),
            ...(passwordHash ? { password: passwordHash } : {}),
          },
        });
        updated++;
        const u = await prisma.user.findUnique({
          where: { id: existing.id },
          select: { id: true, name: true, salesRepCode: true, requesterGroupId: true },
        });
        if (u) await syncRequesterRecordForImportedUser(u);
      } else {
        if (!passwordPlain) {
          throw new Error(
            `Row ${r.rowIndex}: New user ${email} requires Default Password column (or create user manually first).`
          );
        }
        const createdUser = await prisma.user.create({
          data: {
            email: email.toLowerCase(),
            name: r.name,
            password: passwordHash!,
            role,
            businessUnit: r.businessUnit,
            salesRepCode: r.salesRepCode,
            ...(!r.skipRequesterGroupUpdate && requesterGroupId ? { requesterGroupId } : {}),
          },
          select: { id: true, name: true, salesRepCode: true, requesterGroupId: true },
        });
        created++;
        await syncRequesterRecordForImportedUser(createdUser);
      }
    }
  }

  return { created, updated };
}

export async function executeZsammHierarchyImport(
  rows: ValidatedZsammHierarchyRow[],
  options?: { skipRequesterSync?: boolean }
): Promise<ExecuteStats & { requesterSync?: ZsamRequesterSyncStats }> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += ZSAMM_CHUNK) {
    const chunk = rows.slice(i, i + ZSAMM_CHUNK);
    const results = await prisma.$transaction(
      chunk.map((r) =>
        prisma.zsammApprovalMapping.upsert({
          where: {
            requesterName_businessUnit: {
              requesterName: r.requesterName,
              businessUnit: r.businessUnit,
            },
          },
          create: {
            requesterName: r.requesterName,
            businessUnit: r.businessUnit,
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            localFinanceController: r.localFinanceController,
            directorCommercialManager: r.directorCommercialManager,
          },
          update: {
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            localFinanceController: r.localFinanceController,
            directorCommercialManager: r.directorCommercialManager,
          },
        })
      )
    );
    for (const result of results) {
      const diff = result.updatedAt.getTime() - result.createdAt.getTime();
      if (diff < 1500) created++;
      else updated++;
    }
  }

  const removedStray = await removeStrayBusinessUnitRowsForImportedRequesters(prisma.zsammApprovalMapping, rows);

  if (options?.skipRequesterSync) {
    return { created, updated, removed: removedStray };
  }

  const requesterSync = await executeZsamRequesterGroupSync(rows);

  return { created, updated, removed: removedStray, requesterSync };
}

export async function executeZncClaimReplacementHierarchyImport(
  rows: ValidatedZncClaimReplacementHierarchyRow[]
): Promise<ExecuteStats> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += ZNC_CLAIM_CHUNK) {
    const chunk = rows.slice(i, i + ZNC_CLAIM_CHUNK);
    const results = await prisma.$transaction(
      chunk.map((r) =>
        prisma.zncclaimApprovalMapping.upsert({
          where: {
            requesterName_businessUnit: {
              requesterName: r.requesterName,
              businessUnit: r.businessUnit,
            },
          },
          create: {
            requesterName: r.requesterName,
            businessUnit: r.businessUnit,
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            csPsManager: r.csPsManager,
            raqaManager: r.raqaManager,
            globalRaqaManager: r.globalRaqaManager,
          },
          update: {
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            csPsManager: r.csPsManager,
            raqaManager: r.raqaManager,
            globalRaqaManager: r.globalRaqaManager,
          },
        })
      )
    );
    for (const result of results) {
      const diff = result.updatedAt.getTime() - result.createdAt.getTime();
      if (diff < 1500) created++;
      else updated++;
    }
  }

  const namesByBu = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = namesByBu.get(r.businessUnit);
    if (!set) {
      set = new Set<string>();
      namesByBu.set(r.businessUnit, set);
    }
    set.add(r.requesterName);
  }

  let removed = 0;
  for (const [bu, nameSet] of namesByBu) {
    const names = [...nameSet];
    const del = await prisma.zncclaimApprovalMapping.deleteMany({
      where: {
        businessUnit: bu,
        requesterName: { notIn: names },
      },
    });
    removed += del.count;
  }

  removed += await removeStrayBusinessUnitRowsForImportedRequesters(prisma.zncclaimApprovalMapping, rows);

  return { created, updated, removed };
}

export async function executeZintQcHierarchyImport(rows: ValidatedZintQcHierarchyRow[]): Promise<ExecuteStats> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += ZINT_QC_CHUNK) {
    const chunk = rows.slice(i, i + ZINT_QC_CHUNK);
    const results = await prisma.$transaction(
      chunk.map((r) =>
        prisma.zintApprovalMapping.upsert({
          where: {
            requesterName_businessUnit: {
              requesterName: r.requesterName,
              businessUnit: r.businessUnit,
            },
          },
          create: {
            requesterName: r.requesterName,
            businessUnit: r.businessUnit,
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            csPsManager: r.csPsManager,
            raqaManager: r.raqaManager,
            globalRaqaManager: r.globalRaqaManager,
          },
          update: {
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            csPsManager: r.csPsManager,
            raqaManager: r.raqaManager,
            globalRaqaManager: r.globalRaqaManager,
          },
        })
      )
    );
    for (const result of results) {
      const diff = result.updatedAt.getTime() - result.createdAt.getTime();
      if (diff < 1500) created++;
      else updated++;
    }
  }

  // File is source of truth per business unit: remove ZINT rows for that BU that are not in this import.
  // Otherwise old requesters stay in PostgreSQL forever (upsert-only), causing count/UI mismatch with Excel.
  const namesByBu = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = namesByBu.get(r.businessUnit);
    if (!set) {
      set = new Set<string>();
      namesByBu.set(r.businessUnit, set);
    }
    set.add(r.requesterName);
  }

  let removed = 0;
  for (const [bu, nameSet] of namesByBu) {
    const names = [...nameSet];
    const del = await prisma.zintApprovalMapping.deleteMany({
      where: {
        businessUnit: bu,
        requesterName: { notIn: names },
      },
    });
    removed += del.count;
  }

  removed += await removeStrayBusinessUnitRowsForImportedRequesters(prisma.zintApprovalMapping, rows);

  return { created, updated, removed };
}

export async function executeZncInstallationHierarchyImport(
  rows: ValidatedZncInstallationHierarchyRow[]
): Promise<ExecuteStats> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += ZNC_INSTALL_CHUNK) {
    const chunk = rows.slice(i, i + ZNC_INSTALL_CHUNK);
    const results = await prisma.$transaction(
      chunk.map((r) =>
        prisma.zncApprovalMapping.upsert({
          where: {
            requesterName_businessUnit: {
              requesterName: r.requesterName,
              businessUnit: r.businessUnit,
            },
          },
          create: {
            requesterName: r.requesterName,
            businessUnit: r.businessUnit,
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            technicalManager: r.technicalManager,
            nationalTSManager: r.nationalTSManager,
            localFinanceController: r.localFinanceController,
            directorCommercialManager: r.directorCommercialManager,
          },
          update: {
            salesManager: r.salesManager,
            districtSalesManager: r.districtSalesManager,
            nationalSalesManager: r.nationalSalesManager,
            technicalManager: r.technicalManager,
            nationalTSManager: r.nationalTSManager,
            localFinanceController: r.localFinanceController,
            directorCommercialManager: r.directorCommercialManager,
          },
        })
      )
    );
    for (const result of results) {
      const diff = result.updatedAt.getTime() - result.createdAt.getTime();
      if (diff < 1500) created++;
      else updated++;
    }
  }

  const namesByBu = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = namesByBu.get(r.businessUnit);
    if (!set) {
      set = new Set<string>();
      namesByBu.set(r.businessUnit, set);
    }
    set.add(r.requesterName);
  }

  let removed = 0;
  for (const [bu, nameSet] of namesByBu) {
    const names = [...nameSet];
    const del = await prisma.zncApprovalMapping.deleteMany({
      where: {
        businessUnit: bu,
        requesterName: { notIn: names },
      },
    });
    removed += del.count;
  }

  removed += await removeStrayBusinessUnitRowsForImportedRequesters(prisma.zncApprovalMapping, rows);

  return { created, updated, removed };
}
