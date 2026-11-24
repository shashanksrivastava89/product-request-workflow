/**
 * Admin CRUD for requester_groups and requesters (sales rep directory used by New Application step 1).
 */

import { randomBytes } from 'crypto';
import { Response, NextFunction } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();

/**
 * Business units a requester group can belong to.
 *
 * SERVICE is a real unit, not a shortcut: the approval matrix's Group column carries CDG, LSG and
 * Service, and Emi's requirement (3) — "Add Service in Business Unit" — routes a fully approved
 * service request to its own order-taking mailbox. The four Service teams on UAT predate this
 * schema and were created by the import scripts, which bypass it; without SERVICE here the admin UI
 * could see them but never create or edit one.
 *
 * Partner and product catalogues stay CDG/LSG only — a Service team's own name carries the suffix
 * that picks the catalogue (resolveReturnCatalogBusinessUnit on the frontend).
 */
const buSchema = z.enum(['CDG', 'LSG', 'CDG/LSG', 'SERVICE']);

const sampleRequestTypeSchema = z
  .enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT'])
  .nullable()
  .optional();

const createGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  businessUnit: buSchema,
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'Code: letters, numbers, hyphens only')
    .optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  businessUnit: buSchema.optional(),
  isActive: z.boolean().optional(),
});

const createRequesterSchema = z.object({
  requesterGroupId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().min(1, 'Sales rep code is required').max(64),
  sampleRequestType: sampleRequestTypeSchema,
});

const updateRequesterSchema = z.object({
  requesterGroupId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(64).optional(),
  isActive: z.boolean().optional(),
  sampleRequestType: sampleRequestTypeSchema,
});

function uniqueCodeSuggestion(): string {
  return `admin-${randomBytes(4).toString('hex')}`;
}

/** Approval mapping modal: searchable teams (requester groups) filtered by mapping BU. */
export const searchRequesterGroupsForPicker = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const buRaw = (req.query.businessUnit as string | undefined)?.trim().toUpperCase();
    if (buRaw !== 'CDG' && buRaw !== 'LSG' && buRaw !== 'SERVICE') {
      throw new AppError('businessUnit query must be CDG, LSG or SERVICE', 400);
    }
    const q = (req.query.q as string | undefined)?.trim() ?? '';
    const limitRaw = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 1), 100);

    // CDG and LSG both include the shared CDG/LSG teams. SERVICE stands alone: a service team is
    // not a CDG or LSG team, which is why asking for CDG used to return 14 groups and none of the
    // four Service ones — and why an admin could not attach NIA HARGREAVES to her own team.
    const buWhere =
      buRaw === 'SERVICE'
        ? { businessUnit: 'SERVICE' }
        : buRaw === 'CDG'
          ? { OR: [{ businessUnit: 'CDG' }, { businessUnit: 'CDG/LSG' }] }
          : { OR: [{ businessUnit: 'LSG' }, { businessUnit: 'CDG/LSG' }] };

    const groups = await prisma.requesterGroup.findMany({
      where: {
        isActive: true,
        ...buWhere,
        ...(q.length > 0 ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, businessUnit: true, code: true },
    });

    res.json({ success: true, groups });
  } catch (e) {
    next(e);
  }
};

export const listRequesterGroups = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const businessUnit = req.query.businessUnit as string | undefined;
    const includeInactive = req.query.includeInactive === 'true';
    /*
     * Which flow's teams to list.
     *
     * Sample Ordering and Return share one directory, and `formScope` is what records which flow a
     * group belongs to - NULL meaning both, which is the honest default for the thirteen sales
     * teams both flows use. Without this the Requesters screen listed all of them together, so the
     * Return teams (`ret-…`) sat among the sample ones with nothing to tell them apart.
     */
    const formScope = String(req.query.formScope ?? '').trim().toUpperCase();

    const groups = await prisma.requesterGroup.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ businessUnit: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        businessUnit: true,
        isActive: true,
        formScope: true,
        _count: { select: { requesters: true } },
      },
    });

    let filtered = groups;
    // A scope filter keeps the groups for that flow plus the shared ones, which belong to both.
    if (formScope === 'RETURN' || formScope === 'SAMPLE') {
      filtered = filtered.filter((g) => {
        const scope = String(g.formScope ?? '').trim().toUpperCase();
        if (!scope) return true;
        return formScope === 'RETURN' ? scope === 'RETURN' : scope !== 'RETURN';
      });
    }
    if (businessUnit) {
      const u = businessUnit.trim();
      filtered = groups.filter((g) => {
        const units = String(g.businessUnit ?? '')
          .split('/')
          .map((x) => x.trim());
        return units.includes(u);
      });
    }

    res.json({
      success: true,
      groups: filtered.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        businessUnit: g.businessUnit,
        isActive: g.isActive,
        formScope: g.formScope,
        requesterCount: g._count.requesters,
      })),
    });
  } catch (e) {
    next(e);
  }
};

export const createRequesterGroup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((e) => e.message).join('; '), 400);
    }
    const { name, businessUnit, code: codeIn } = parsed.data;
    let code = codeIn?.trim();
    if (!code) {
      let attempts = 0;
      do {
        code = uniqueCodeSuggestion();
        const exists = await prisma.requesterGroup.findUnique({ where: { code } });
        if (!exists) break;
        attempts++;
      } while (attempts < 10);
      if (attempts >= 10) throw new AppError('Could not allocate unique group code', 500);
    } else {
      const taken = await prisma.requesterGroup.findUnique({ where: { code } });
      if (taken) throw new AppError(`Group code "${code}" is already in use`, 409);
    }

    const group = await prisma.requesterGroup.create({
      data: { code: code!, name: name.trim(), businessUnit },
    });

    res.status(201).json({ success: true, group });
  } catch (e) {
    next(e);
  }
};

export const updateRequesterGroup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const parsed = updateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((e) => e.message).join('; '), 400);
    }

    const existing = await prisma.requesterGroup.findUnique({ where: { id } });
    if (!existing) throw new AppError('Requester group not found', 404);

    const group = await prisma.requesterGroup.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ success: true, group });
  } catch (e) {
    next(e);
  }
};

export const deleteRequesterGroup = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const count = await prisma.requester.count({ where: { requesterGroupId: id } });
    if (count > 0) {
      throw new AppError(
        `Cannot delete: ${count} requester(s) still in this group. Remove or move them first.`,
        400
      );
    }

    await prisma.requesterGroup.delete({ where: { id } });
    res.json({ success: true, message: 'Requester group deleted' });
  } catch (e) {
    next(e);
  }
};

/** Admin UI: typeahead for approval mapping requester name (active requesters across all groups). */
export const searchRequestersForPicker = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? '';
    const limitRaw = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 40, 1), 100);

    if (q.length < 1) {
      res.json({ success: true, requesters: [] });
      return;
    }

    const requesters = await prisma.requester.findMany({
      where: {
        isActive: true,
        name: { contains: q, mode: 'insensitive' },
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        // The id as well as the name: the Requesters screen shows one team at a time, so arriving
        // from a link that names a person has to be able to select the team holding them.
        requesterGroup: { select: { id: true, name: true, businessUnit: true, formScope: true } },
      },
    });

    res.json({
      success: true,
      requesters: requesters.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        requesterGroupId: r.requesterGroup.id,
        groupName: r.requesterGroup.name,
        businessUnit: r.requesterGroup.businessUnit,
        formScope: r.requesterGroup.formScope,
      })),
    });
  } catch (e) {
    next(e);
  }
};

export const listRequesters = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const requesterGroupId = req.query.requesterGroupId as string | undefined;
    if (!requesterGroupId) {
      throw new AppError('requesterGroupId query parameter is required', 400);
    }

    const group = await prisma.requesterGroup.findFirst({
      where: { OR: [{ id: requesterGroupId }, { code: requesterGroupId }] },
    });
    if (!group) throw new AppError('Requester group not found', 404);

    const requesters = await prisma.requester.findMany({
      where: { requesterGroupId: group.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        requesterGroupId: true,
        isActive: true,
        userId: true,
        sampleRequestType: true,
      },
    });

    res.json({ success: true, requesters, group: { id: group.id, code: group.code, name: group.name, businessUnit: group.businessUnit } });
  } catch (e) {
    next(e);
  }
};

export const createRequester = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createRequesterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((e) => e.message).join('; '), 400);
    }

    const group = await prisma.requesterGroup.findUnique({
      where: { id: parsed.data.requesterGroupId },
    });
    if (!group) throw new AppError('Requester group not found', 404);

    const nameNorm = parsed.data.name.trim();
    const codeNorm = parsed.data.code.trim();

    const dup = await prisma.requester.findFirst({
      where: { requesterGroupId: group.id, name: { equals: nameNorm, mode: 'insensitive' } },
    });
    if (dup) throw new AppError('A requester with this name already exists in this group', 409);

    const requester = await prisma.requester.create({
      data: {
        requesterGroupId: group.id,
        name: nameNorm,
        code: codeNorm,
        sampleRequestType: parsed.data.sampleRequestType ?? null,
      },
    });

    res.status(201).json({ success: true, requester });
  } catch (e) {
    next(e);
  }
};

export const updateRequester = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const parsed = updateRequesterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((e) => e.message).join('; '), 400);
    }

    const existing = await prisma.requester.findUnique({ where: { id } });
    if (!existing) throw new AppError('Requester not found', 404);

    if (parsed.data.requesterGroupId) {
      const g = await prisma.requesterGroup.findUnique({ where: { id: parsed.data.requesterGroupId } });
      if (!g) throw new AppError('Target requester group not found', 404);
    }

    if (parsed.data.name) {
      const gid = parsed.data.requesterGroupId ?? existing.requesterGroupId;
      const clash = await prisma.requester.findFirst({
        where: {
          requesterGroupId: gid,
          id: { not: id },
          name: { equals: parsed.data.name.trim(), mode: 'insensitive' },
        },
      });
      if (clash) throw new AppError('Another requester with this name exists in that group', 409);
    }

    const { sampleRequestType } = parsed.data;
    const data: Prisma.RequesterUpdateInput = {};
    if (parsed.data.requesterGroupId) {
      data.requesterGroup = { connect: { id: parsed.data.requesterGroupId } };
    }
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.code !== undefined) data.code = parsed.data.code.trim();
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (sampleRequestType !== undefined) data.sampleRequestType = sampleRequestType ?? null;

    const requester = await prisma.requester.update({
      where: { id },
      data,
    });

    res.json({ success: true, requester });
  } catch (e) {
    next(e);
  }
};

export const deleteRequester = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.requester.findUnique({ where: { id } });
    if (!existing) throw new AppError('Requester not found', 404);

    await prisma.requester.delete({ where: { id } });
    res.json({ success: true, message: 'Requester deleted' });
  } catch (e) {
    next(e);
  }
};
