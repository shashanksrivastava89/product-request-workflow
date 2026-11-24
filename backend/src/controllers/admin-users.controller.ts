/**
 * ADMIN-only: create and manage user accounts (ADMIN and other roles), list administrators or all users.
 */

import bcrypt from 'bcrypt';
import { Response, NextFunction } from 'express';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncRequesterRecordForImportedUser } from '../services/import/execute-import.service';

const prisma = new PrismaClient();

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Extended create: any `UserRole`; REQUESTER requires group + sales rep code for directory sync. */
/**
 * A REQUESTER used to be required to carry both a requester group and a sales rep code. Neither
 * holds up:
 *
 * - A person belongs to as many teams as they have `requesters` rows (38 people on UAT hold two
 *   or three), so one `requesterGroupId` cannot describe them. The Return wizard now reads the
 *   `requesters` table via `resolveRequesterScope`, and a null group simply means "not pinned to
 *   one team".
 * - 120 of 123 REQUESTER accounts have no sales rep code, and the two that are set hold the
 *   placeholders `TBD` and `N/A` that someone typed to satisfy this very rule. Because
 *   `users.salesRepCode` is UNIQUE, placeholders cannot scale past one row each, while NULLs are
 *   exempt from a unique index — so optional is the only workable answer for Return, where most
 *   requesters have no code.
 *
 * Both columns are nullable in the schema and every consumer already tolerates absence: the
 * wizard falls back to the requester rows, and the email formatter prints a code only when it
 * looks like a real one (5-10 digits).
 */
const createUserByAdminSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(2, 'Name is required').max(200),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    businessUnit: z.enum(['CDG', 'LSG']).optional().nullable(),
    role: z.nativeEnum(UserRole).optional().default(UserRole.ADMIN),
    isSuperApprover: z.boolean().optional(),
    isServiceAdmin: z.boolean().optional(),
    isCustomerSupport: z.boolean().optional(),
    requesterGroupId: z.string().uuid().nullable().optional(),
    salesRepCode: z.string().max(64).nullable().optional(),
  });

const patchAdminSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    businessUnit: z.enum(['CDG', 'LSG']).nullable().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').optional(),
    role: z.nativeEnum(UserRole).optional(),
    isSuperApprover: z.boolean().optional(),
    isServiceAdmin: z.boolean().optional(),
    isCustomerSupport: z.boolean().optional(),
    requesterGroupId: z.string().uuid().nullable().optional(),
    salesRepCode: z.string().max(64).nullable().optional(),
  })

export const listAdminUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scope = (req.query.scope as string | undefined)?.toLowerCase();
    const listAll = scope === 'all';

    const users = await prisma.user.findMany({
      where: listAll ? {} : { role: 'ADMIN' },
      orderBy: listAll ? [{ role: 'asc' }, { email: 'asc' }] : [{ isActive: 'desc' }, { email: 'asc' }],
      take: listAll ? 500 : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        businessUnit: true,
        role: true,
        isActive: true,
        isSuperApprover: true,
        isServiceAdmin: true,
        isCustomerSupport: true,
        ...(listAll
          ? {
              requesterGroupId: true,
              salesRepCode: true,
            }
          : {}),
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ success: true, users });
  } catch (e) {
    next(e);
  }
};

/** ADMIN-only CSV export of all users (passwords omitted). */
export const exportAdminUsersCsv = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperApprover: true,
        isServiceAdmin: true,
        isCustomerSupport: true,
        isActive: true,
        businessUnit: true,
        department: true,
        salesRepCode: true,
        requesterGroupId: true,
        salesManager: true,
        districtSalesManager: true,
        nationalSalesManager: true,
        localFinanceController: true,
        directorCommercialManager: true,
        technicalManager: true,
        nationalTSManager: true,
        salesManagerRelation: { select: { email: true } },
        districtSalesManagerRelation: { select: { email: true } },
        nationalSalesManagerRelation: { select: { email: true } },
        localFinanceControllerRelation: { select: { email: true } },
        directorCommercialManagerRelation: { select: { email: true } },
        technicalManagerRelation: { select: { email: true } },
        nationalTSManagerRelation: { select: { email: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    const groupIds = [...new Set(users.map((u) => u.requesterGroupId).filter(Boolean))] as string[];
    const groups =
      groupIds.length > 0
        ? await prisma.requesterGroup.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, code: true, name: true },
          })
        : [];
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const headers = [
      'Email',
      'Name',
      'Role',
      'LSG/CDG',
      'Sales Rep Code',
      'Requester Group',
      'Requester Group Code',
      'isSuperApprover',
      'isActive',
      'department',
      'salesManager',
      'districtSalesManager',
      'nationalSalesManager',
      'localFinanceController',
      'directorCommercialManager',
      'technicalManager',
      'nationalTSManager',
      'salesManagerEmail',
      'districtSalesManagerEmail',
      'nationalSalesManagerEmail',
      'localFinanceControllerEmail',
      'directorCommercialManagerEmail',
      'technicalManagerEmail',
      'nationalTSManagerEmail',
      'id',
      'createdAt',
      'updatedAt',
    ];

    const lines = users.map((u) => {
      const g = u.requesterGroupId ? groupById.get(u.requesterGroupId) : undefined;
      const row = [
        u.email,
        u.name,
        u.role,
        u.businessUnit ?? '',
        u.salesRepCode ?? '',
        g?.name ?? '',
        g?.code ?? '',
        u.isSuperApprover,
        u.isActive,
        u.department ?? '',
        u.salesManager ?? '',
        u.districtSalesManager ?? '',
        u.nationalSalesManager ?? '',
        u.localFinanceController ?? '',
        u.directorCommercialManager ?? '',
        u.technicalManager ?? '',
        u.nationalTSManager ?? '',
        u.salesManagerRelation?.email ?? '',
        u.districtSalesManagerRelation?.email ?? '',
        u.nationalSalesManagerRelation?.email ?? '',
        u.localFinanceControllerRelation?.email ?? '',
        u.directorCommercialManagerRelation?.email ?? '',
        u.technicalManagerRelation?.email ?? '',
        u.nationalTSManagerRelation?.email ?? '',
        u.id,
        u.createdAt,
        u.updatedAt,
      ];
      return row.map((v) => csvEscape(csvCell(v))).join(',');
    });

    const body = `\uFEFF${headers.join(',')}\n${lines.join('\n')}`;
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="users-${date}.csv"`);
    res.send(body);
  } catch (e) {
    next(e);
  }
};

/** Approval mapping approver slots match any active User by name — not limited to ADMIN accounts. */
export const listUsersForApprovalPicker = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? '';
    const limitRaw = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 1), 100);

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(q.length > 0 ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      take: limit,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        businessUnit: true,
        role: true,
      },
    });

    res.json({ success: true, users });
  } catch (e) {
    next(e);
  }
};

export const createAdminUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createUserByAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const data = parsed.data;
    const email = data.email.trim().toLowerCase();
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      throw new AppError('An account with this email already exists', 409);
    }

    if (data.requesterGroupId) {
      const g = await prisma.requesterGroup.findFirst({
        where: { id: data.requesterGroupId, isActive: true },
      });
      if (!g) throw new AppError('Requester group not found or inactive', 400);
    }

    const salesRepTrim = data.salesRepCode?.trim() ?? '';
    if (salesRepTrim) {
      const codeTaken = await prisma.user.findFirst({
        where: {
          salesRepCode: { equals: salesRepTrim, mode: 'insensitive' },
        },
      });
      if (codeTaken) {
        throw new AppError(`Sales rep code "${salesRepTrim}" is already assigned to another user`, 409);
      }
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const role = data.role;
    const bu = data.businessUnit ?? undefined;
    const isSuperApprover =
      data.isSuperApprover === true || role === UserRole.SUPER_APPROVER;

    try {
      const user = await prisma.user.create({
        data: {
          email,
          name: data.name.trim(),
          password: hashedPassword,
          role,
          isSuperApprover,
          isCustomerSupport: data.isCustomerSupport === true,
          businessUnit: bu,
          salesRepCode: salesRepTrim || null,
          requesterGroupId:
            role === UserRole.REQUESTER && data.requesterGroupId ? data.requesterGroupId : undefined,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          businessUnit: true,
          role: true,
          isSuperApprover: true,
          isServiceAdmin: true,
          isCustomerSupport: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (role === UserRole.REQUESTER && data.requesterGroupId && salesRepTrim) {
        await syncRequesterRecordForImportedUser({
          id: user.id,
          name: user.name,
          salesRepCode: salesRepTrim,
          requesterGroupId: data.requesterGroupId,
        });
      }

      res.status(201).json({ success: true, user });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = (e.meta?.target as string[])?.join(', ') ?? 'unique field';
        throw new AppError(`Duplicate value (${target}). Check email or sales rep code.`, 409);
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
};

export const patchAdminUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actorId = req.user?.id;
    if (!actorId) throw new AppError('Unauthorized', 401);

    const parsed = patchAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new AppError('User not found', 404);
    }

    const {
      name,
      businessUnit,
      isActive,
      password,
      role: nextRole,
      isSuperApprover: nextIsSuper,
      isServiceAdmin: nextIsServiceAdmin,
      isCustomerSupport: nextIsCustomerSupport,
      requesterGroupId,
      salesRepCode,
    } = parsed.data;

    if (nextRole !== undefined) {
      if (id === actorId && nextRole !== UserRole.ADMIN) {
        throw new AppError('You cannot remove your own administrator role. Ask another administrator.', 400);
      }
      if (target.role === UserRole.ADMIN && nextRole !== UserRole.ADMIN) {
        const otherActiveAdmins = await prisma.user.count({
          where: {
            role: UserRole.ADMIN,
            isActive: true,
            id: { not: id },
          },
        });
        if (otherActiveAdmins === 0) {
          throw new AppError(
            'Cannot change role: at least one other active administrator must exist',
            400
          );
        }
      }
    }

    if (isActive === false) {
      if (id === actorId) {
        throw new AppError('You cannot deactivate your own account. Ask another administrator.', 400);
      }
      if (target.role === 'ADMIN') {
        const activeAdmins = await prisma.user.count({
          where: { role: 'ADMIN', isActive: true },
        });
        if (activeAdmins <= 1) {
          throw new AppError('Cannot deactivate the only active administrator', 400);
        }
      }
    }

    if (nextRole === UserRole.REQUESTER && requesterGroupId) {
      const g = await prisma.requesterGroup.findFirst({
        where: { id: requesterGroupId, isActive: true },
      });
      if (!g) throw new AppError('Requester group not found or inactive', 400);
    }

    const salesRepTrim = salesRepCode?.trim() ?? '';
    if (nextRole === UserRole.REQUESTER && salesRepTrim) {
      const codeTaken = await prisma.user.findFirst({
        where: {
          salesRepCode: { equals: salesRepTrim, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (codeTaken) {
        throw new AppError(`Sales rep code "${salesRepTrim}" is already assigned to another user`, 409);
      }
    }

    const updateData: {
      name?: string;
      businessUnit?: string | null;
      isActive?: boolean;
      password?: string;
      role?: UserRole;
      isSuperApprover?: boolean;
      isServiceAdmin?: boolean;
      isCustomerSupport?: boolean;
      requesterGroupId?: string | null;
      salesRepCode?: string | null;
    } = {};

    if (name !== undefined) updateData.name = name.trim();
    if (businessUnit !== undefined) updateData.businessUnit = businessUnit;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password !== undefined) updateData.password = await bcrypt.hash(password, 10);

    if (nextRole !== undefined) {
      updateData.role = nextRole;
      if (nextRole === UserRole.REQUESTER) {
        // Only touch these when the caller actually sent them: `undefined` means "unchanged",
        // while an explicit `null` (or empty string) clears the field.
        if (requesterGroupId !== undefined) updateData.requesterGroupId = requesterGroupId;
        if (salesRepCode !== undefined) updateData.salesRepCode = salesRepTrim || null;
      } else {
        updateData.requesterGroupId = null;
        updateData.salesRepCode = null;
      }
    }
    if (nextIsSuper !== undefined) {
      updateData.isSuperApprover = nextIsSuper;
    }
    // Independent of role: Nia Hargreaves and Baljiwan Woodward stay REQUESTERs while being Service Admins.
    if (nextIsServiceAdmin !== undefined) {
      updateData.isServiceAdmin = nextIsServiceAdmin;
    }
    // Also independent of role: the Customer Service members are REQUESTERs who keep the all-requests view.
    if (nextIsCustomerSupport !== undefined) {
      updateData.isCustomerSupport = nextIsCustomerSupport;
    }
    if (nextRole === UserRole.SUPER_APPROVER) {
      updateData.isSuperApprover = true;
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError('No changes provided', 400);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        businessUnit: true,
        role: true,
        isSuperApprover: true,
        isServiceAdmin: true,
        isCustomerSupport: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (nextRole === UserRole.REQUESTER && requesterGroupId && salesRepTrim) {
      await syncRequesterRecordForImportedUser({
        id: user.id,
        name: user.name,
        salesRepCode: salesRepTrim,
        requesterGroupId,
      });
    }

    res.json({ success: true, user });
  } catch (e) {
    next(e);
  }
};
