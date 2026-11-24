/**
 * Admin: remove a person who has left the organization from every approval hierarchy.
 * Preview is a read; the removal needs the name typed back, and runs as one transaction.
 */

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { normalizeNameForMatch } from '../services/named-requester.service';
import { executeOffboarding, previewOffboarding } from '../services/people-offboarding.service';

const previewSchema = z.object({ name: z.string().trim().min(1).max(200) });

const executeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** The same name typed again: a removal touches every table, so a mis-click must not run it. */
  confirmName: z.string().trim().min(1).max(200),
  successorName: z.string().trim().max(200).optional().nullable(),
});

/** GET /admin/people/offboarding?name=MAIRTIN+YODER */
export const previewPersonOffboarding = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = previewSchema.parse(req.query);
    res.json({ success: true, scope: await previewOffboarding(name) });
  } catch (e) {
    next(e);
  }
};

/** POST /admin/people/offboarding { name, confirmName, successorName? } */
export const executePersonOffboarding = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = executeSchema.parse(req.body);
    if (normalizeNameForMatch(body.confirmName) !== normalizeNameForMatch(body.name)) {
      throw new AppError('Type the name exactly as shown to confirm the removal', 400);
    }
    const result = await executeOffboarding(body.name, {
      successorName: body.successorName ?? null,
      changedBy: req.user?.id ?? null,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
};
