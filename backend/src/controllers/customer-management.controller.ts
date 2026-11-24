/**
 * Customer Management Controller
 * Handles CRUD operations for customers (SOLD-TO, End Users, Direct Delivery)
 * ADMIN only access
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { createCustomerSchema, updateCustomerSchema, listQuerySchema } from '../validators/admin.validators';
import { AuthRequest } from '../middleware/auth.middleware';
import { trackCustomerChange } from '../services/customer-history.service';
import {
  buildCustomerExportCsv,
  buildCustomerExportXlsx,
  customerExportFilename,
  fetchMasterCustomers,
  parseCustomerExportFormat,
  parseCustomerExportType,
} from '../services/customer-export.service';

const prisma = new PrismaClient();

/**
 * GET /api/admin/customers
 * List all customers with pagination, search, and filters
 */
export const getCustomers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const {
      businessGroup,
      firstDigit,
      limit = 20,
      offset = 0,
      search,
      includeInactive = false,
      status: statusFilter,
      includePending = false,
    } = query;

    // Build where clause
    const where: any = {};

    if (businessGroup) {
      where.businessGroup = businessGroup;
    }

    if (firstDigit) {
      where.firstDigit = firstDigit;
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
      // Default: approved active customers only
      where.status = 'APPROVED';
      if (!includeInactive) {
        where.isActive = true;
      }
    }

    // Search across code, nameJp, nameEn, sapCode
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { sapCode: { contains: searchTerm, mode: 'insensitive' } },
        { nameJp: { contains: searchTerm, mode: 'insensitive' } },
        { nameEn: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Get total count (before pagination)
    const total = await prisma.customer.count({ where });

    // Get customers with pagination
    const customers = await prisma.customer.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [
        { businessGroup: 'asc' },
        { firstDigit: 'asc' },
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
      customers,
      count: customers.length,
      total,
      hasMore: offset + customers.length < total,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/customers/export?customerType=all|sold-to|direct-delivery|ship-to&format=xlsx|csv
 * Download active approved customers in master-list column layout.
 */
export const exportCustomers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const customerType = parseCustomerExportType(req.query.customerType);
    if (!customerType) {
      throw new AppError(
        'customerType is required (all, sold-to, direct-delivery, or ship-to)',
        400
      );
    }

    const format = parseCustomerExportFormat(req.query.format);
    const customers = await fetchMasterCustomers(customerType);
    const filename = customerExportFilename(customerType, format);

    if (format === 'csv') {
      const body = `\uFEFF${buildCustomerExportCsv(customers)}`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(body);
      return;
    }

    const buffer = buildCustomerExportXlsx(customerType, customers);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/customers/:id
 * Get single customer by ID
 */
export const getCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
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

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/customers
 * Create new customer
 */
export const createCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const data = createCustomerSchema.parse(req.body);

    // Check for duplicate [businessGroup, code] — same key as product catalog upsert
    const existing = await prisma.customer.findFirst({
      where: {
        businessGroup: data.businessGroup,
        code: data.code,
      },
    });

    if (existing) {
      const recordState = existing.isActive ? existing.status : `inactive ${existing.status}`;
      throw new AppError(
        `Customer with code ${data.code} already exists for business group ${data.businessGroup} (${recordState})`,
        409
      );
    }

    const now = new Date();
    const customer = await prisma.customer.create({
      data: {
        ...data,
        createdBy: userId,
        updatedBy: userId,
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
    await trackCustomerChange(customer.id, 'CREATE', userId, null, customer);

    res.status(201).json({
      success: true,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/customers/:id
 * Update existing customer
 */
export const updateCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const data = updateCustomerSchema.parse(req.body);

    // Check if customer exists
    const existing = await prisma.customer.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError('Customer not found', 404);
    }

    // If code or businessGroup is being updated, check for duplicates
    if (data.code || data.businessGroup) {
      const newCode = data.code || existing.code;
      const newBusinessGroup = data.businessGroup || existing.businessGroup;

      const duplicate = await prisma.customer.findFirst({
        where: {
          businessGroup: newBusinessGroup,
          code: newCode,
          status: 'APPROVED',
          id: { not: id }, // Exclude current record
        },
      });

      if (duplicate) {
        throw new AppError(
          `Customer with code ${newCode} already exists for business group ${newBusinessGroup}`,
          409
        );
      }
    }
    
    // Direct approval: Keep status as APPROVED, just update the record
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...data,
        updatedBy: userId,
        // Keep status as APPROVED (direct approval - no re-approval needed)
        status: 'APPROVED',
        isActive: true,
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
    await trackCustomerChange(customer.id, 'UPDATE', userId, existing, customer);

    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/customers/:id
 * Deactivate customer (set isActive = false)
 */
export const deleteCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { reason } = req.body; // Optional deletion reason

    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Deactivate (soft delete)
    const deactivated = await prisma.customer.update({
      where: { id },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });

    // Track change history with reason
    await trackCustomerChange(customer.id, 'DELETE', userId, customer, deactivated, reason);

    res.json({
      success: true,
      message: 'Customer deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/customers/:id/restore
 * Restore soft-deleted customer (set isActive = true)
 */
export const restoreCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const { id } = req.params;
    const { reason } = req.body; // Optional restoration reason

    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Restore
    const restored = await prisma.customer.update({
      where: { id },
      data: {
        isActive: true,
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
    await trackCustomerChange(customer.id, 'RESTORE', userId, customer, restored, reason);

    res.json({
      success: true,
      customer: restored,
      message: 'Customer restored successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/customers/:id/history
 * Get change history for a customer
 */
export const getCustomerHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const history = await prisma.customerHistory.findMany({
      where: { customerId: id },
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
 * GET /api/admin/customers/:id/history/:version
 * Get specific version of customer
 */
export const getCustomerVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      throw new AppError('Invalid version number', 400);
    }

    const historyRecord = await prisma.customerHistory.findFirst({
      where: {
        customerId: id,
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
 * POST /api/admin/customers/:id/rollback
 * Rollback customer to a previous version
 */
export const rollbackCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    const historyRecord = await prisma.customerHistory.findFirst({
      where: {
        customerId: id,
        version: version,
      },
    });

    if (!historyRecord) {
      throw new AppError('Version not found', 404);
    }

    // Get current customer
    const current = await prisma.customer.findUnique({
      where: { id },
    });

    if (!current) {
      throw new AppError('Customer not found', 404);
    }

    // Restore from history
    const rolledBack = await prisma.customer.update({
      where: { id },
      data: {
        businessGroup: historyRecord.businessGroup,
        firstDigit: historyRecord.firstDigit,
        code: historyRecord.code,
        sapCode: historyRecord.sapCode,
        nameJp: historyRecord.nameJp,
        nameEn: historyRecord.nameEn,
        postalCode: historyRecord.postalCode,
        prefecture: historyRecord.prefecture,
        address: historyRecord.address,
        phone: historyRecord.phone,
        isActive: historyRecord.isActive,
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
    await trackCustomerChange(rolledBack.id, 'UPDATE', userId, current, rolledBack, reason || 'Rollback to version ' + version);

    res.json({
      success: true,
      customer: rolledBack,
      message: `Customer rolled back to version ${version}`,
    });
  } catch (error) {
    next(error);
  }
};
