/**
 * Customer support: read-only list/detail/summary of submitted sample requests (all statuses).
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { FormStatus, FormType } from '@prisma/client';
import { prismaService } from '../services/prisma.service';
import { AuthRequest } from '../middleware/auth.middleware';
import { assertUserCanReadForm } from '../utils/form-access.util';

const querySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  statusGroup: z.enum(['awaiting', 'closed']).optional(),
  formType: z.enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT']).optional(),
  businessUnit: z.enum(['CDG', 'LSG']).optional(),
  includeDraft: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function parseSubmittedRange(q: { submittedFrom?: string; submittedTo?: string }) {
  let submittedFrom: Date | undefined;
  let submittedTo: Date | undefined;
  if (q.submittedFrom) {
    submittedFrom = new Date(q.submittedFrom);
    if (Number.isNaN(submittedFrom.getTime())) {
      return { error: 'Invalid submittedFrom date' as const };
    }
  }
  if (q.submittedTo) {
    submittedTo = new Date(q.submittedTo);
    if (Number.isNaN(submittedTo.getTime())) {
      return { error: 'Invalid submittedTo date' as const };
    }
  }
  return { submittedFrom, submittedTo };
}

function resolveStatusFilters(q: z.infer<typeof querySchema>): {
  status?: FormStatus;
  statuses?: FormStatus[];
  includeDraft: boolean;
} {
  const includeDraft = q.includeDraft === 'true';
  if (q.statusGroup === 'awaiting') {
    return {
      statuses: ['PENDING_APPROVAL', 'IN_PROGRESS'],
      includeDraft: false,
    };
  }
  if (q.statusGroup === 'closed') {
    return {
      statuses: ['REJECTED', 'CANCELLED'],
      includeDraft: false,
    };
  }
  return {
    status: q.status as FormStatus | undefined,
    includeDraft,
  };
}

export const listSupportForms = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid query parameters', errors: parsed.error.flatten() });
      return;
    }

    const q = parsed.data;
    const range = parseSubmittedRange(q);
    if ('error' in range) {
      res.status(400).json({ success: false, message: range.error });
      return;
    }

    const { status, statuses, includeDraft } = resolveStatusFilters(q);

    const { forms, total } = await prismaService.findManyFormsAdmin({
      status,
      statuses,
      formType: q.formType as FormType | undefined,
      businessUnit: q.businessUnit,
      includeDraft,
      search: q.search,
      submittedFrom: range.submittedFrom,
      submittedTo: range.submittedTo,
      skip: q.offset ?? 0,
      take: q.limit ?? 50,
    });

    res.json({
      success: true,
      forms,
      total,
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    });
  } catch (error) {
    next(error);
  }
};

/** Dashboard counts: all submitted (excl. draft), awaiting, approved, closed unsuccessful. */
export const getSupportFormsSummary = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [all, awaiting, approved, closed] = await Promise.all([
      prismaService.findManyFormsAdmin({ includeDraft: false, take: 1 }),
      prismaService.findManyFormsAdmin({
        statuses: ['PENDING_APPROVAL', 'IN_PROGRESS'],
        take: 1,
      }),
      prismaService.findManyFormsAdmin({ status: 'APPROVED', take: 1 }),
      prismaService.findManyFormsAdmin({
        statuses: ['REJECTED', 'CANCELLED'],
        take: 1,
      }),
    ]);

    res.json({
      success: true,
      all: all.total,
      awaiting: awaiting.total,
      approved: approved.total,
      closed: closed.total,
    });
  } catch (error) {
    next(error);
  }
};

export const getSupportForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await assertUserCanReadForm(req, id);

    const products = await prismaService.findFormProducts(id);
    const approvals = await prismaService.findApprovalsByFormId(id);
    const form = await prismaService.findFormById(id);

    res.json({
      success: true,
      form: form ? { ...form, products, approvals } : null,
    });
  } catch (error) {
    next(error);
  }
};

/** @deprecated Use listSupportForms */
export const listSupportApprovedForms = listSupportForms;

/** @deprecated Use getSupportForm */
export const getSupportApprovedForm = getSupportForm;
