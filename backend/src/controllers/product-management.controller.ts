/**
 * Product Management Controller
 * Handles CRUD operations for product catalog
 * ADMIN only access
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { createProductSchema, updateProductSchema, listQuerySchema,
  bulkProductUpdateSchema,
} from '../validators/admin.validators';
import { AuthRequest } from '../middleware/auth.middleware';
import { trackProductChange } from '../services/product-history.service';
import { DO_NOT_USE_LIST_PRICES, isDoNotUseListPrice, searchTextWhere } from '../services/product-catalog/selectable';

const prisma = new PrismaClient();

/** A list price of 0 or 1 is the master's "do not use this code" (27 Aug 2026); no screen may set one. */
function refuseDoNotUseListPrice(listPrice: unknown): void {
  if (listPrice !== undefined && isDoNotUseListPrice(listPrice)) {
    throw new AppError('A list price of 0 or 1 means "do not use this code", so such a product cannot be in the catalogue. Enter the real list price.', 400);
  }
}

/**
 * The `where` behind the product grid.
 *
 * Extracted so a bulk action can operate on exactly the rows the operator is looking at. The grid
 * lazy-loads, so "select all" can only ever mean "everything matching this filter" — the client has
 * no way to enumerate the rest, and sending it a page of ids would silently act on a subset.
 */
export function buildProductListWhere(query: {
  businessGroup?: 'CDG' | 'LSG';
  search?: string;
  includeInactive?: boolean;
  status?: 'ALL' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  includePending?: boolean;
}): any {
  const {
    businessGroup,
    search,
    includeInactive = false,
    status: statusFilter,
    includePending = false,
  } = query;

  // A product the master sync removed (not in the master, or priced 0/1) is gone from every screen,
  // this one included, even with "include deactivated": the master decides, not this grid. Only an
  // admin's own deactivation shows here, so it can be undone.
  const where: any = { retiredBySync: false };

  if (businessGroup) {
    where.businessGroup = businessGroup;
  }

  if (statusFilter === 'ALL') {
    if (!includeInactive) {
      where.isActive = true;
    }
  } else if (statusFilter) {
    where.status = statusFilter;
    if (statusFilter === 'REJECTED') {
      // Rejected rows may be inactive (e.g. duplicate cleanup)
    } else if (!includeInactive) {
      where.isActive = true;
    }
  } else if (includePending) {
    if (!includeInactive) {
      where.isActive = true;
    }
  } else {
    // Default: approved active products only
    where.status = 'APPROVED';
    if (!includeInactive) {
      where.isActive = true;
    }
  }

  // Every word must appear in the code, SAP code or either name; width and case do not matter.
  const tokens = searchTextWhere(search);
  if (tokens.length > 0) {
    where.AND = tokens;
  }

  return where;
}

/**
 * POST /api/admin/products/bulk-update
 *
 * Approve and/or reactivate every product matching a filter — the same filter the grid is showing.
 *
 * Two modes:
 *   filter — act on all rows the grid's current filter selects, however many that is. This is the
 *            point of the endpoint: the grid pages as you scroll, so the browser only ever holds a
 *            slice, and acting on "what is loaded" would quietly do a fraction of the job.
 *   codes  — act on an explicit list, for the cases a filter cannot express.
 *
 * `expectedCount` must equal what the server counts. The operator is told "this will change N
 * products" before confirming; if N moved in between (another import, someone else editing), the
 * request is refused rather than silently doing something bigger than was agreed.
 */
export const bulkUpdateProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = bulkProductUpdateSchema.parse(req.body);
    const { action, expectedCount } = body;

    const scope: any =
      body.mode === 'codes'
        ? { retiredBySync: false, OR: body.codes.map((c) => ({ businessGroup: c.businessGroup, code: c.code })) }
        : buildProductListWhere(body.filter ?? {});
    // Never switches on a product priced 0/1: the master says not to use it.
    const where: any = action === 'approve' ? scope : { AND: [scope, { listPrice: { notIn: DO_NOT_USE_LIST_PRICES } }] };

    const matched = await prisma.productCatalog.count({ where });

    if (matched !== expectedCount) {
      res.status(409).json({
        success: false,
        message:
          `This would affect ${matched} product(s), but ${expectedCount} was expected. ` +
          `The data changed since the list was loaded. Refresh and try again.`,
        matched,
        expectedCount,
      });
      return;
    }
    if (matched === 0) {
      res.json({ success: true, action, matched: 0, updated: 0, message: 'Nothing matched the filter.' });
      return;
    }

    const data: any = {};
    if (action === 'approve' || action === 'approveAndActivate') {
      data.status = 'APPROVED';
      data.approvedAt = new Date();
      data.rejectedBy = null;
      data.rejectedAt = null;
      data.rejectionReason = null;
    }
    if (action === 'activate' || action === 'approveAndActivate') {
      data.isActive = true;
    }

    const result = await prisma.productCatalog.updateMany({ where, data });

    console.log(
      `[products/bulk-update] ${req.user?.email ?? 'unknown'} action=${action} mode=${body.mode} ` +
        `matched=${matched} updated=${result.count} ` +
        `scope=${JSON.stringify(body.mode === 'filter' ? body.filter : { codes: body.codes.length })}`
    );

    res.json({
      success: true,
      action,
      matched,
      updated: result.count,
      message:
        action === 'approve'
          ? `Approved ${result.count} product(s).`
          : action === 'activate'
            ? `Reactivated ${result.count} product(s).`
            : `Approved and reactivated ${result.count} product(s).`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/products
 * List all products with pagination, search, and filters
 */
export const getProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const { limit = 20, offset = 0 } = query;

    const where = buildProductListWhere(query);

    // Get total count (before pagination)
    const total = await prisma.productCatalog.count({ where });

    // Get products with pagination
    const products = await prisma.productCatalog.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [
        { businessGroup: 'asc' },
        { code: 'asc' },
      ],
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      success: true,
      products,
      count: products.length,
      total,
      hasMore: offset + products.length < total,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/products/:id
 * Get single product by ID
 */
export const getProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const product = await prisma.productCatalog.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    res.json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/products
 * Create new product
 */
export const createProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const data = createProductSchema.parse(req.body);

    // Validate: SAP code is required for CDG, optional for LSG
    if (data.businessGroup === 'CDG' && (!data.sapCode || data.sapCode.trim() === '')) {
      throw new AppError('SAP code is required for CDG products', 400);
    }
    refuseDoNotUseListPrice(data.listPrice);

    // Check for duplicate [businessGroup, code] combination.
    // The database enforces this across all statuses, including inactive records.
    const existing = await prisma.productCatalog.findUnique({
      where: {
        businessGroup_code: {
          businessGroup: data.businessGroup,
          code: data.code,
        },
      },
    });

    const now = new Date();

    // The code belongs to a product the master sync removed: it is invisible, but the row is still
    // there, so creating "it" again brings that row back with the new details and its history intact.
    if (existing?.retiredBySync) {
      const revived = await prisma.productCatalog.update({
        where: { id: existing.id },
        data: {
          ...data,
          sapCode: data.sapCode || '',
          updatedBy: userId,
          isActive: true,
          retiredBySync: false,
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: now,
        },
        include: {
          creator: { select: { id: true, name: true, email: true } },
          updater: { select: { id: true, name: true, email: true } },
        },
      });
      await trackProductChange(revived.id, 'RESTORE', userId, existing, revived, 'Created again by hand; it had been removed by the product master sync');
      res.status(201).json({ success: true, product: revived, revived: true });
      return;
    }

    if (existing) {
      const recordState = existing.isActive ? existing.status : `inactive ${existing.status}`;
      throw new AppError(
        `Product with code ${data.code} already exists for business group ${data.businessGroup} (${recordState})`,
        409
      );
    }

    const product = await prisma.productCatalog.create({
      data: {
        ...data,
        sapCode: data.sapCode || '', // Default to empty string if not provided
        createdBy: userId,
        updatedBy: userId,
        // Created by hand. The Power BI master is the only source, so the next sync removes it unless
        // the master carries it too.
        sourceSystem: 'manual',
        isActive: true, // Directly active (direct approval)
        status: 'APPROVED',
        submittedBy: userId,
        submittedAt: now,
        approvedBy: userId, // Auto-approved by creator
        approvedAt: now,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Track change history
    await trackProductChange(product.id, 'CREATE', userId, null, product);

    res.status(201).json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/products/:id
 * Update existing product
 */
export const updateProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const data = updateProductSchema.parse(req.body);

    // Check if product exists
    const existing = await prisma.productCatalog.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError('Product not found', 404);
    }

    // Validate: SAP code is required for CDG
    const businessGroup = data.businessGroup || existing.businessGroup;
    const sapCode = data.sapCode !== undefined ? data.sapCode : existing.sapCode;
    
    if (businessGroup === 'CDG' && (!sapCode || sapCode.trim() === '')) {
      throw new AppError('SAP code is required for CDG products', 400);
    }
    refuseDoNotUseListPrice(data.listPrice);

    // If code or businessGroup is being updated, check for duplicates
    if (data.code || data.businessGroup) {
      const newCode = data.code || existing.code;
      const newBusinessGroup = data.businessGroup || existing.businessGroup;

      const duplicate = await prisma.productCatalog.findUnique({
        where: {
          businessGroup_code: {
            businessGroup: newBusinessGroup,
            code: newCode,
          },
        },
      });

      // Any other row on that code blocks the change - the database's unique key would refuse it anyway.
      if (duplicate && duplicate.id !== id) {
        throw new AppError(
          duplicate.retiredBySync
            ? `Code ${newCode} belongs to a product the master sync removed for business group ${newBusinessGroup}; create the product instead to bring it back`
            : `Product with code ${newCode} already exists for business group ${newBusinessGroup}`,
          409
        );
      }
    }

    // Direct approval: Keep status as APPROVED, just update the record
    const product = await prisma.productCatalog.update({
      where: { id },
      data: {
        ...data,
        updatedBy: userId,
        // Keep status as APPROVED (direct approval - no re-approval needed)
        status: 'APPROVED',
        // An edit is not a restore: a retired product stays retired until someone restores it.
        // Keep original approvedBy and approvedAt unchanged
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Track change history
    await trackProductChange(product.id, 'UPDATE', userId, existing, product);

    res.json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/products/:id
 * Deactivate product (set isActive = false)
 */
export const deleteProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { reason } = req.body; // Optional deletion reason

    const product = await prisma.productCatalog.findUnique({
      where: { id },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Deactivate (soft delete)
    const deactivated = await prisma.productCatalog.update({
      where: { id },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });

    // Track change history with reason
    await trackProductChange(product.id, 'DELETE', userId, product, deactivated, reason);

    res.json({
      success: true,
      message: 'Product deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/products/:id/restore
 * Restore soft-deleted product (set isActive = true)
 */
export const restoreProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { reason } = req.body; // Optional restoration reason

    const product = await prisma.productCatalog.findUnique({
      where: { id },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }
    refuseDoNotUseListPrice(product.listPrice);

    // Restore. The product is selectable again until the next master sync, which keeps it only if
    // the Power BI master carries it - the master is the only source.
    const restored = await prisma.productCatalog.update({
      where: { id },
      data: {
        isActive: true,
        retiredBySync: false,
        updatedBy: userId,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Track change history with reason
    await trackProductChange(product.id, 'RESTORE', userId, product, restored, reason);

    res.json({
      success: true,
      product: restored,
      message: 'Product restored successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/products/:id/history
 * Get change history for a product
 */
export const getProductHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const product = await prisma.productCatalog.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const history = await prisma.productHistory.findMany({
      where: { productId: id },
      orderBy: { version: 'desc' },
      include: {
        changer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/products/:id/history/:version
 * Get specific version of product
 */
export const getProductVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      throw new AppError('Invalid version number', 400);
    }

    const historyRecord = await prisma.productHistory.findFirst({
      where: {
        productId: id,
        version: versionNum,
      },
      include: {
        changer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!historyRecord) {
      throw new AppError('Version not found', 404);
    }

    res.json({
      success: true,
      version: historyRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/products/:id/rollback
 * Rollback product to a previous version
 */
export const rollbackProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { version, reason } = req.body;

    if (!version || typeof version !== 'number') {
      throw new AppError('Version number is required', 400);
    }

    // Get the version to rollback to
    const historyRecord = await prisma.productHistory.findFirst({
      where: {
        productId: id,
        version: version,
      },
    });

    if (!historyRecord) {
      throw new AppError('Version not found', 404);
    }

    // Get current product
    const current = await prisma.productCatalog.findUnique({
      where: { id },
    });

    if (!current) {
      throw new AppError('Product not found', 404);
    }
    if (historyRecord.isActive) refuseDoNotUseListPrice(historyRecord.listPrice);

    // Restore from history
    const rolledBack = await prisma.productCatalog.update({
      where: { id },
      data: {
        businessGroup: historyRecord.businessGroup,
        code: historyRecord.code,
        sapCode: historyRecord.sapCode,
        name: historyRecord.name,
        productNameLocal: historyRecord.productNameLocal,
        price: historyRecord.price,
        listPrice: historyRecord.listPrice,
        division: historyRecord.division,
        statisticsGroup: historyRecord.statisticsGroup,
        priceGroup: historyRecord.priceGroup,
        isActive: historyRecord.isActive,
        // Back to an active version means back on the screens, not still hidden as removed.
        ...(historyRecord.isActive ? { retiredBySync: false } : {}),
        updatedBy: userId,
        status: 'APPROVED',
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updater: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Track rollback as an UPDATE
    await trackProductChange(rolledBack.id, 'UPDATE', userId, current, rolledBack, reason || 'Rollback to version ' + version);

    res.json({
      success: true,
      product: rolledBack,
      message: `Product rolled back to version ${version}`,
    });
  } catch (error) {
    next(error);
  }
};
