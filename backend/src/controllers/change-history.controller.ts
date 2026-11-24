/**
 * Change History Controller
 * Handles global change history/audit log queries
 * ADMIN only access
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();

/**
 * GET /api/admin/change-history
 * Get all changes from both customer_history and product_history
 * Supports filtering by record type, change type, user, date range, and search
 */
export const getChangeHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      recordType = 'all',
      changeType = 'all',
      changedBy,
      fromDate,
      toDate,
      search,
      limit = 50,
      offset = 0,
    } = req.query;

    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 500);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    const window = offsetNum + limitNum;

    // Build where clauses for customer history
    const customerWhere: any = {};
    if (changeType !== 'all') {
      customerWhere.changeType = changeType;
    }
    if (changedBy) {
      customerWhere.changedBy = changedBy;
    }
    if (fromDate) {
      customerWhere.changedAt = { ...customerWhere.changedAt, gte: new Date(fromDate as string) };
    }
    if (toDate) {
      customerWhere.changedAt = { ...customerWhere.changedAt, lte: new Date(toDate as string) };
    }
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchTerm = search.trim();
      customerWhere.OR = [
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { nameJp: { contains: searchTerm, mode: 'insensitive' } },
        { nameEn: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Build where clauses for product history
    const productWhere: any = {};
    if (changeType !== 'all') {
      productWhere.changeType = changeType;
    }
    if (changedBy) {
      productWhere.changedBy = changedBy;
    }
    if (fromDate) {
      productWhere.changedAt = { ...productWhere.changedAt, gte: new Date(fromDate as string) };
    }
    if (toDate) {
      productWhere.changedAt = { ...productWhere.changedAt, lte: new Date(toDate as string) };
    }
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchTerm = search.trim();
      productWhere.OR = [
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { productNameLocal: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Query customer history (only if recordType is 'all' or 'customer')
    const customerHistory = recordType === 'all' || recordType === 'customer'
      ? await prisma.customerHistory.findMany({
          where: customerWhere,
          // The two tables are merged and then paged, so each must supply every row that could land
          // on this page: its first offset + limit rows. (It used to fetch limit * 2 from the top,
          // which left every page past the second wrong or empty - one product sync writes thousands.)
          take: window,
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          include: {
            changer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            customer: {
              select: {
                id: true,
                code: true,
                nameJp: true,
                nameEn: true,
              },
            },
          },
        })
      : [];

    // Query product history (only if recordType is 'all' or 'product')
    const productHistory = recordType === 'all' || recordType === 'product'
      ? await prisma.productHistory.findMany({
          where: productWhere,
          take: window,
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          include: {
            changer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                productNameLocal: true,
              },
            },
          },
        })
      : [];

    // Combine and format results
    const allChanges = [
      ...customerHistory.map((ch) => ({
        id: ch.id,
        recordType: 'customer' as const,
        recordId: ch.customerId,
        recordCode: ch.code,
        recordName: ch.nameJp,
        version: ch.version,
        changeType: ch.changeType,
        changedBy: ch.changer,
        changedAt: ch.changedAt,
        changeReason: ch.changeReason,
        fieldChanges: ch.fieldChanges,
        // Additional customer-specific fields
        businessGroup: ch.businessGroup,
        firstDigit: ch.firstDigit,
      })),
      ...productHistory.map((ph) => ({
        id: ph.id,
        recordType: 'product' as const,
        recordId: ph.productId,
        recordCode: ph.code,
        recordName: ph.name,
        version: ph.version,
        changeType: ph.changeType,
        changedBy: ph.changer,
        changedAt: ph.changedAt,
        changeReason: ph.changeReason,
        fieldChanges: ph.fieldChanges,
        // Additional product-specific fields
        businessGroup: ph.businessGroup,
      })),
    ];

    // Same order as each query, so the merge is exact
    allChanges.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

    // Get total count (for both tables)
    const customerCount = recordType === 'all' || recordType === 'customer'
      ? await prisma.customerHistory.count({
          where: customerWhere,
        })
      : 0;

    const productCount = recordType === 'all' || recordType === 'product'
      ? await prisma.productHistory.count({
          where: productWhere,
        })
      : 0;

    const total = customerCount + productCount;

    // Apply pagination
    const paginatedChanges = allChanges.slice(offsetNum, offsetNum + limitNum);

    res.json({
      success: true,
      changes: paginatedChanges,
      count: paginatedChanges.length,
      total,
      hasMore: offsetNum + paginatedChanges.length < total,
    });
  } catch (error) {
    next(error);
  }
};
