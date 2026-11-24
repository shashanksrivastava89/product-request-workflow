/**
 * Customer list reconciliation: compare official file vs DB, disable removed customers.
 */

import { Response, NextFunction } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import type { ImportFileKind } from '../utils/import-file-validation.util';
import {
  compareCustomerList,
  disableRemovedCustomers,
  type CustomerType,
} from '../services/customer-reconciliation.service';

function parseCustomerType(body: any, query?: any): CustomerType | undefined {
  const raw = (body?.customerType ?? query?.customerType ?? '').toString().trim();
  if (raw === '1' || raw === '2' || raw === '8') return raw;
  const lower = raw.toLowerCase();
  if (lower === 'sold-to' || lower === 'sold to') return '1';
  if (lower === 'ship-to' || lower === 'ship to' || lower === 'direct delivery') return '2';
  if (lower === 'end user' || lower === 'end-user') return '8';
  return undefined;
}

function requireImportFileKind(req: AuthRequest): ImportFileKind {
  const kind = req.importFileKind;
  if (!kind) {
    throw new Error('Upload validation did not run');
  }
  return kind;
}

const disableBodySchema = z.object({
  customerType: z.enum(['1', '2', '8']),
  customerIds: z.array(z.string().uuid()).min(1),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/admin/customers/reconcile/compare
 * Upload file + customerType → diff (no writes).
 */
export async function compareCustomers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const file = req.file as Express.Multer.File | undefined;
  const customerType = parseCustomerType(req.body, req.query);

  if (!file?.path) {
    res.status(400).json({
      success: false,
      message: 'No file uploaded. Use multipart field "file" and "customerType".',
    });
    return;
  }

  if (!customerType) {
    res.status(400).json({
      success: false,
      message: 'customerType is required (1=SOLD-TO, 2=Ship-to, 8=End User).',
    });
    return;
  }

  try {
    const result = await compareCustomerList(file.path, requireImportFileKind(req), customerType);
    res.json({
      success: true,
      ...result,
      hint:
        'Run Bulk import first for this customer type, then use this page to disable customers removed from the official list.',
    });
  } catch (err: any) {
    next(err);
  } finally {
    if (file?.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (_) {}
    }
  }
}

/**
 * POST /api/admin/customers/reconcile/disable
 * Disable selected customers (removed from official list).
 */
export async function disableCustomers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const parsed = disableBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: parsed.error.flatten(),
      });
      return;
    }

    const { customerType, customerIds, reason } = parsed.data;
    const result = await disableRemovedCustomers(customerIds, customerType, userId, reason);

    res.json({
      success: true,
      customerType,
      disabled: result.disabled,
      skipped: result.skipped,
      message:
        result.disabled > 0
          ? `Disabled ${result.disabled} customer(s).`
          : 'No customers were disabled.',
    });
  } catch (error) {
    next(error);
  }
}
