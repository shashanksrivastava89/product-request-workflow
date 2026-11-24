/**
 * Hargadon-san only: read-only report of approved ZNC Claim requests for his CTS team.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { canViewZncClaimApprovedReport } from '../utils/znc-claim-approved-report.util';
import {
  getApprovedZncClaimReportSummary,
  listApprovedZncClaimReportForms,
} from '../services/znc-claim-approved-report.service';

const querySchema = z.object({
  businessUnit: z.enum(['CDG', 'LSG']).optional(),
  search: z.string().optional(),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const summaryQuerySchema = z.object({
  businessUnit: z.enum(['CDG', 'LSG']).optional(),
});

function assertKunimiReportAccess(req: AuthRequest): void {
  if (!canViewZncClaimApprovedReport(req.user?.email)) {
    throw new AppError('Access denied', 403);
  }
}

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

export const getZncClaimApprovedReportSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    assertKunimiReportAccess(req);
    const parsed = summaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: parsed.error.flatten(),
      });
      return;
    }
    const summary = await getApprovedZncClaimReportSummary({
      businessUnit: parsed.data.businessUnit,
    });
    res.json({ success: true, ...summary });
  } catch (error) {
    next(error);
  }
};

export const listZncClaimApprovedReportForms = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    assertKunimiReportAccess(req);

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: parsed.error.flatten(),
      });
      return;
    }

    const q = parsed.data;
    const range = parseSubmittedRange(q);
    if ('error' in range) {
      res.status(400).json({ success: false, message: range.error });
      return;
    }

    const { forms, total } = await listApprovedZncClaimReportForms({
      businessUnit: q.businessUnit,
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
