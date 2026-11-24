/**
 * Hierarchy Management Controller
 * Handles CRUD operations for user approval hierarchies
 * ADMIN only access
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  getSubordinates,
  buildHierarchyTree,
  validateAllHierarchies,
  validateUserHierarchy,
  findCircularReferences,
  findMissingApprovers,
  updateUserHierarchyWithValidation,
  validateHierarchyData,
  HierarchyUser,
} from '../services/hierarchy-management.service';
import { hierarchyListQuerySchema, updateHierarchySchema } from '../validators/hierarchy.validators';

const prisma = new PrismaClient();

/**
 * GET /api/admin/hierarchy
 * List users with hierarchy relationships
 */
export const getHierarchyList = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = hierarchyListQuerySchema.parse(req.query);
    const {
      businessUnit,
      role,
      formType,
      page = 1,
      limit = 20,
      search,
      includeInactive = false,
    } = query;

    // Build where clause
    const where: any = {};

    if (businessUnit) {
      where.businessUnit = businessUnit;
    }

    if (role) {
      where.role = role;
    }

    if (!includeInactive) {
      where.isActive = true;
    }

    // Search across name and email
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Get total count (before pagination)
    const total = await prisma.user.count({ where });

    // Get users with pagination
    const users = await prisma.user.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      include: {
        salesManagerRelation: { select: { id: true, name: true, email: true } },
        districtSalesManagerRelation: { select: { id: true, name: true, email: true } },
        nationalSalesManagerRelation: { select: { id: true, name: true, email: true } },
        localFinanceControllerRelation: { select: { id: true, name: true, email: true } },
        directorCommercialManagerRelation: { select: { id: true, name: true, email: true } },
        technicalManagerRelation: { select: { id: true, name: true, email: true } },
        nationalTSManagerRelation: { select: { id: true, name: true, email: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Count subordinates for each user
    // Note: Only count DIRECT management relationships, not approval roles
    // Management chain: Sales Manager -> District Sales Manager -> National Sales Manager -> Director Commercial Manager
    // Approval roles (excluded): Local Finance Controller, Technical Manager, National TS Manager
    const usersWithSubordinates: HierarchyUser[] = await Promise.all(
      users.map(async (user) => {
        const subordinatesCount = await prisma.user.count({
          where: {
            OR: [
              { salesManagerId: user.id },
              { districtSalesManagerId: user.id },
              { nationalSalesManagerId: user.id },
              { directorCommercialManagerId: user.id },
            ],
            isActive: true,
          },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          businessUnit: user.businessUnit,
          hierarchy: {
            salesManager: user.salesManagerRelation
              ? {
                  id: user.salesManagerRelation.id,
                  name: user.salesManagerRelation.name,
                  email: user.salesManagerRelation.email,
                }
              : null,
            districtSalesManager: user.districtSalesManagerRelation
              ? {
                  id: user.districtSalesManagerRelation.id,
                  name: user.districtSalesManagerRelation.name,
                  email: user.districtSalesManagerRelation.email,
                }
              : null,
            nationalSalesManager: user.nationalSalesManagerRelation
              ? {
                  id: user.nationalSalesManagerRelation.id,
                  name: user.nationalSalesManagerRelation.name,
                  email: user.nationalSalesManagerRelation.email,
                }
              : null,
            localFinanceController: user.localFinanceControllerRelation
              ? {
                  id: user.localFinanceControllerRelation.id,
                  name: user.localFinanceControllerRelation.name,
                  email: user.localFinanceControllerRelation.email,
                }
              : null,
            directorCommercialManager: user.directorCommercialManagerRelation
              ? {
                  id: user.directorCommercialManagerRelation.id,
                  name: user.directorCommercialManagerRelation.name,
                  email: user.directorCommercialManagerRelation.email,
                }
              : null,
            technicalManager: user.technicalManagerRelation
              ? {
                  id: user.technicalManagerRelation.id,
                  name: user.technicalManagerRelation.name,
                  email: user.technicalManagerRelation.email,
                }
              : null,
            nationalTSManager: user.nationalTSManagerRelation
              ? {
                  id: user.nationalTSManagerRelation.id,
                  name: user.nationalTSManagerRelation.name,
                  email: user.nationalTSManagerRelation.email,
                }
              : null,
          },
          subordinatesCount,
        };
      })
    );

    // Filter hierarchy fields based on form type if specified
    let filteredUsers = usersWithSubordinates;
    if (formType === 'ZSAM') {
      filteredUsers = usersWithSubordinates.map((u) => ({
        ...u,
        hierarchy: {
          salesManager: u.hierarchy.salesManager,
          districtSalesManager: u.hierarchy.districtSalesManager,
          nationalSalesManager: u.hierarchy.nationalSalesManager,
          localFinanceController: u.hierarchy.localFinanceController,
          directorCommercialManager: u.hierarchy.directorCommercialManager,
        },
      }));
    } else if (formType === 'ZNC' || formType === 'ZNCCLAIM' || formType === 'ZINT') {
      filteredUsers = usersWithSubordinates.map((u) => ({
        ...u,
        hierarchy: {
          salesManager: u.hierarchy.salesManager,
          districtSalesManager: u.hierarchy.districtSalesManager,
          technicalManager: u.hierarchy.technicalManager,
          nationalTSManager: u.hierarchy.nationalTSManager,
        },
      }));
    }

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      users: filteredUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/hierarchy/tree
 * Get hierarchy tree structure
 */
export const getHierarchyTree = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rootUserId = req.query.rootUserId as string | undefined;
    const businessUnit = req.query.businessUnit as 'CDG' | 'LSG' | undefined;

    const tree = await buildHierarchyTree(rootUserId, businessUnit);

    if (!tree) {
      return res.json({
        success: true,
        tree: null,
        message: 'No root user found',
      });
    }

    return res.json({
      success: true,
      tree: {
        root: tree,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/admin/hierarchy/user/:id
 * Get user hierarchy details
 */
export const getUserHierarchyDetails = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        salesManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        districtSalesManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        nationalSalesManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        localFinanceControllerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        directorCommercialManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        technicalManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
        nationalTSManagerRelation: { select: { id: true, name: true, email: true, role: true, businessUnit: true } },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get subordinates
    const subordinates = await getSubordinates(id);

    // Get validation issues
    const validationIssues = await validateUserHierarchy(id);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessUnit: user.businessUnit,
        department: user.department,
        salesRepCode: user.salesRepCode,
        hierarchy: {
          salesManager: user.salesManagerRelation
            ? {
                id: user.salesManagerRelation.id,
                name: user.salesManagerRelation.name,
                email: user.salesManagerRelation.email,
                role: user.salesManagerRelation.role,
                businessUnit: user.salesManagerRelation.businessUnit,
              }
            : null,
          districtSalesManager: user.districtSalesManagerRelation
            ? {
                id: user.districtSalesManagerRelation.id,
                name: user.districtSalesManagerRelation.name,
                email: user.districtSalesManagerRelation.email,
                role: user.districtSalesManagerRelation.role,
                businessUnit: user.districtSalesManagerRelation.businessUnit,
              }
            : null,
          nationalSalesManager: user.nationalSalesManagerRelation
            ? {
                id: user.nationalSalesManagerRelation.id,
                name: user.nationalSalesManagerRelation.name,
                email: user.nationalSalesManagerRelation.email,
                role: user.nationalSalesManagerRelation.role,
                businessUnit: user.nationalSalesManagerRelation.businessUnit,
              }
            : null,
          localFinanceController: user.localFinanceControllerRelation
            ? {
                id: user.localFinanceControllerRelation.id,
                name: user.localFinanceControllerRelation.name,
                email: user.localFinanceControllerRelation.email,
                role: user.localFinanceControllerRelation.role,
                businessUnit: user.localFinanceControllerRelation.businessUnit,
              }
            : null,
          directorCommercialManager: user.directorCommercialManagerRelation
            ? {
                id: user.directorCommercialManagerRelation.id,
                name: user.directorCommercialManagerRelation.name,
                email: user.directorCommercialManagerRelation.email,
                role: user.directorCommercialManagerRelation.role,
                businessUnit: user.directorCommercialManagerRelation.businessUnit,
              }
            : null,
          technicalManager: user.technicalManagerRelation
            ? {
                id: user.technicalManagerRelation.id,
                name: user.technicalManagerRelation.name,
                email: user.technicalManagerRelation.email,
                role: user.technicalManagerRelation.role,
                businessUnit: user.technicalManagerRelation.businessUnit,
              }
            : null,
          nationalTSManager: user.nationalTSManagerRelation
            ? {
                id: user.nationalTSManagerRelation.id,
                name: user.nationalTSManagerRelation.name,
                email: user.nationalTSManagerRelation.email,
                role: user.nationalTSManagerRelation.role,
                businessUnit: user.nationalTSManagerRelation.businessUnit,
              }
            : null,
        },
      },
      subordinates,
      validationIssues,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/hierarchy/user/:id
 * Update user hierarchy
 */
export const updateUserHierarchy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    const updateData = updateHierarchySchema.parse(req.body);

    const result = await updateUserHierarchyWithValidation(id, updateData, userId);

    res.json({
      success: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        hierarchy: {
          salesManager: result.user.salesManagerRelation
            ? {
                id: result.user.salesManagerRelation.id,
                name: result.user.salesManagerRelation.name,
                email: result.user.salesManagerRelation.email,
              }
            : null,
          districtSalesManager: result.user.districtSalesManagerRelation
            ? {
                id: result.user.districtSalesManagerRelation.id,
                name: result.user.districtSalesManagerRelation.name,
                email: result.user.districtSalesManagerRelation.email,
              }
            : null,
          nationalSalesManager: result.user.nationalSalesManagerRelation
            ? {
                id: result.user.nationalSalesManagerRelation.id,
                name: result.user.nationalSalesManagerRelation.name,
                email: result.user.nationalSalesManagerRelation.email,
              }
            : null,
          localFinanceController: result.user.localFinanceControllerRelation
            ? {
                id: result.user.localFinanceControllerRelation.id,
                name: result.user.localFinanceControllerRelation.name,
                email: result.user.localFinanceControllerRelation.email,
              }
            : null,
          directorCommercialManager: result.user.directorCommercialManagerRelation
            ? {
                id: result.user.directorCommercialManagerRelation.id,
                name: result.user.directorCommercialManagerRelation.name,
                email: result.user.directorCommercialManagerRelation.email,
              }
            : null,
          technicalManager: result.user.technicalManagerRelation
            ? {
                id: result.user.technicalManagerRelation.id,
                name: result.user.technicalManagerRelation.name,
                email: result.user.technicalManagerRelation.email,
              }
            : null,
          nationalTSManager: result.user.nationalTSManagerRelation
            ? {
                id: result.user.nationalTSManagerRelation.id,
                name: result.user.nationalTSManagerRelation.name,
                email: result.user.nationalTSManagerRelation.email,
              }
            : null,
        },
      },
      changes: result.changes,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/hierarchy/user/:id/subordinates
 * Get user's subordinates
 */
export const getUserSubordinates = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const subordinates = await getSubordinates(id);

    res.json({
      success: true,
      subordinates,
      count: subordinates.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/hierarchy/validate
 * Validate hierarchy data before saving
 */
export const validateHierarchy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, formType, ...updates } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    const validation = await validateHierarchyData(userId, {
      formType,
      ...updates,
    });

    return res.json({
      success: true,
      validation,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/admin/hierarchy/validate
 * Validate all hierarchies
 */
export const validateHierarchies = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = await validateAllHierarchies();

    res.json({
      success: true,
      validation,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/hierarchy/circular
 * Find circular references
 */
export const getCircularReferences = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const issues = await findCircularReferences();

    res.json({
      success: true,
      issues,
      count: issues.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/hierarchy/missing-approvers
 * Find missing approvers
 */
export const getMissingApprovers = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const issues = await findMissingApprovers();

    res.json({
      success: true,
      issues,
      count: issues.length,
    });
  } catch (error) {
    next(error);
  }
};
