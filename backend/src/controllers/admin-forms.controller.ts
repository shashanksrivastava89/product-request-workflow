/**
 * GET /api/admin/forms — list submitted requests with filters (ADMIN + SUPER_APPROVER)
 *
 * Every form type, returns included. Vidhi asked whether sample and return requests were one list
 * or two and accepted one filtered list — "submitted request record will be combined together" —
 * so RETURN belongs in the Request Type filter here, not excluded from it.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { FormStatus, FormType } from '@prisma/client';
import { prismaService } from '../services/prisma.service';
import { AuthRequest } from '../middleware/auth.middleware';

const querySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  formType: z.enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT', 'RETURN']).optional(),
  businessUnit: z.string().optional(),
  includeDraft: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listAdminForms = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid query parameters', errors: parsed.error.flatten() });
      return;
    }

    const q = parsed.data;
    const includeDraft = q.includeDraft === 'true';

    let submittedFrom: Date | undefined;
    let submittedTo: Date | undefined;
    if (q.submittedFrom) {
      submittedFrom = new Date(q.submittedFrom);
      if (Number.isNaN(submittedFrom.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid submittedFrom date' });
        return;
      }
    }
    if (q.submittedTo) {
      submittedTo = new Date(q.submittedTo);
      if (Number.isNaN(submittedTo.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid submittedTo date' });
        return;
      }
    }

    const { forms, total } = await prismaService.findManyFormsAdmin({
      status: q.status as FormStatus | undefined,
      formType: q.formType as FormType | undefined,
      businessUnit: q.businessUnit,
      includeDraft,
      search: q.search,
      submittedFrom,
      submittedTo,
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
