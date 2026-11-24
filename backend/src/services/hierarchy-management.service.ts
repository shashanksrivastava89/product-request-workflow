/**
 * Hierarchy Management Service
 * Provides business logic for hierarchy CRUD operations, validation, and tree building
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface HierarchyUser {
  id: string;
  name: string;
  email: string;
  role: string;
  businessUnit: string | null;
  hierarchy: {
    salesManager?: { id: string; name: string; email: string } | null;
    districtSalesManager?: { id: string; name: string; email: string } | null;
    nationalSalesManager?: { id: string; name: string; email: string } | null;
    localFinanceController?: { id: string; name: string; email: string } | null;
    directorCommercialManager?: { id: string; name: string; email: string } | null;
    technicalManager?: { id: string; name: string; email: string } | null;
    nationalTSManager?: { id: string; name: string; email: string } | null;
  };
  subordinatesCount: number;
}

export interface HierarchyTreeNode {
  id: string;
  name: string;
  email: string;
  role: string;
  businessUnit: string | null;
  subordinates: HierarchyTreeNode[];
}

export interface HierarchyValidationIssue {
  type: 'MISSING_APPROVER' | 'CIRCULAR_REFERENCE' | 'INVALID_ROLE' | 'BUSINESS_UNIT_MISMATCH';
  userId: string;
  userName: string;
  field?: string;
  approverName?: string;
  approverId?: string;
  approverRole?: string;
  expectedRole?: string;
  severity: 'ERROR' | 'WARNING';
  userId2?: string;
  userName2?: string;
}

export interface HierarchyValidationResult {
  totalUsers: number;
  validUsers: number;
  issues: HierarchyValidationIssue[];
}

/**
 * Get all subordinates for a user (users who report to this user)
 * Note: Only includes DIRECT management relationships, not approval roles
 * Management chain: Sales Manager -> District Sales Manager -> National Sales Manager -> Director Commercial Manager
 * Approval roles (excluded): Local Finance Controller, Technical Manager, National TS Manager
 */
export async function getSubordinates(userId: string): Promise<HierarchyUser[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Find all users who have this user as their direct manager (management chain only)
  const subordinates = await prisma.user.findMany({
    where: {
      OR: [
        { salesManagerId: userId },
        { districtSalesManagerId: userId },
        { nationalSalesManagerId: userId },
        { directorCommercialManagerId: userId },
      ],
    },
    include: {
      salesManagerRelation: { select: { id: true, name: true, email: true } },
      districtSalesManagerRelation: { select: { id: true, name: true, email: true } },
      nationalSalesManagerRelation: { select: { id: true, name: true, email: true } },
      localFinanceControllerRelation: { select: { id: true, name: true, email: true } },
      directorCommercialManagerRelation: { select: { id: true, name: true, email: true } },
      technicalManagerRelation: { select: { id: true, name: true, email: true } },
      nationalTSManagerRelation: { select: { id: true, name: true, email: true } },
    },
  });

  return subordinates.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    businessUnit: u.businessUnit,
    hierarchy: {
      salesManager: u.salesManagerRelation
        ? { id: u.salesManagerRelation.id, name: u.salesManagerRelation.name, email: u.salesManagerRelation.email }
        : null,
      districtSalesManager: u.districtSalesManagerRelation
        ? {
            id: u.districtSalesManagerRelation.id,
            name: u.districtSalesManagerRelation.name,
            email: u.districtSalesManagerRelation.email,
          }
        : null,
      nationalSalesManager: u.nationalSalesManagerRelation
        ? {
            id: u.nationalSalesManagerRelation.id,
            name: u.nationalSalesManagerRelation.name,
            email: u.nationalSalesManagerRelation.email,
          }
        : null,
      localFinanceController: u.localFinanceControllerRelation
        ? {
            id: u.localFinanceControllerRelation.id,
            name: u.localFinanceControllerRelation.name,
            email: u.localFinanceControllerRelation.email,
          }
        : null,
      directorCommercialManager: u.directorCommercialManagerRelation
        ? {
            id: u.directorCommercialManagerRelation.id,
            name: u.directorCommercialManagerRelation.name,
            email: u.directorCommercialManagerRelation.email,
          }
        : null,
      technicalManager: u.technicalManagerRelation
        ? {
            id: u.technicalManagerRelation.id,
            name: u.technicalManagerRelation.name,
            email: u.technicalManagerRelation.email,
          }
        : null,
      nationalTSManager: u.nationalTSManagerRelation
        ? {
            id: u.nationalTSManagerRelation.id,
            name: u.nationalTSManagerRelation.name,
            email: u.nationalTSManagerRelation.email,
          }
        : null,
    },
    subordinatesCount: 0, // Will be calculated if needed
  }));
}

/**
 * Build hierarchy tree starting from a root user
 */
export async function buildHierarchyTree(
  rootUserId?: string,
  businessUnit?: string,
  maxDepth: number = 10
): Promise<HierarchyTreeNode | null> {
  if (!rootUserId) {
    // Find root users (users who are not subordinates of anyone)
    const rootUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(businessUnit ? { businessUnit } : {}),
        AND: [
          { salesManagerId: null },
          { districtSalesManagerId: null },
          { nationalSalesManagerId: null },
          { localFinanceControllerId: null },
          { directorCommercialManagerId: null },
          { technicalManagerId: null },
          { nationalTSManagerId: null },
        ],
      },
      take: 1,
    });

    if (rootUsers.length === 0) {
      return null;
    }

    rootUserId = rootUsers[0].id;
  }

  const rootUser = await prisma.user.findUnique({
    where: { id: rootUserId },
  });

  if (!rootUser) {
    return null;
  }

  async function buildNode(userId: string, depth: number): Promise<HierarchyTreeNode> {
    if (depth > maxDepth) {
      return {
        id: userId,
        name: '',
        email: '',
        role: '',
        businessUnit: null,
        subordinates: [],
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        businessUnit: true,
      },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Get subordinates
    const subordinates = await prisma.user.findMany({
      where: {
        OR: [
          { salesManagerId: userId },
          { districtSalesManagerId: userId },
          { nationalSalesManagerId: userId },
          { localFinanceControllerId: userId },
          { directorCommercialManagerId: userId },
          { technicalManagerId: userId },
          { nationalTSManagerId: userId },
        ],
        isActive: true,
        ...(businessUnit ? { businessUnit } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        businessUnit: true,
      },
    });

    const subordinateNodes = await Promise.all(
      subordinates.map((sub) => buildNode(sub.id, depth + 1))
    );

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessUnit: user.businessUnit,
      subordinates: subordinateNodes,
    };
  }

  return buildNode(rootUserId, 0);
}

/**
 * Check for circular references in hierarchy
 */
export async function findCircularReferences(): Promise<HierarchyValidationIssue[]> {
  const issues: HierarchyValidationIssue[] = [];
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      salesManagerId: true,
      districtSalesManagerId: true,
      nationalSalesManagerId: true,
      localFinanceControllerId: true,
      directorCommercialManagerId: true,
      technicalManagerId: true,
      nationalTSManagerId: true,
    },
  });

  // Check for direct circular references (A -> B -> A)
  for (const user of users) {
    const approverIds = [
      user.salesManagerId,
      user.districtSalesManagerId,
      user.nationalSalesManagerId,
      user.localFinanceControllerId,
      user.directorCommercialManagerId,
      user.technicalManagerId,
      user.nationalTSManagerId,
    ].filter((id): id is string => id !== null);

    for (const approverId of approverIds) {
      const approver = users.find((u) => u.id === approverId);
      if (!approver) continue;

      // Check if approver has user as their approver (direct circular)
      const approverApproverIds = [
        approver.salesManagerId,
        approver.districtSalesManagerId,
        approver.nationalSalesManagerId,
        approver.localFinanceControllerId,
        approver.directorCommercialManagerId,
        approver.technicalManagerId,
        approver.nationalTSManagerId,
      ].filter((id): id is string => id !== null);

      if (approverApproverIds.includes(user.id)) {
        issues.push({
          type: 'CIRCULAR_REFERENCE',
          userId: user.id,
          userName: user.name,
          userId2: approver.id,
          userName2: approver.name,
          severity: 'ERROR',
        });
      }
    }
  }

  return issues;
}

/**
 * Find missing approvers (approver IDs that don't exist)
 */
export async function findMissingApprovers(): Promise<HierarchyValidationIssue[]> {
  const issues: HierarchyValidationIssue[] = [];
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      salesManagerRelation: { select: { id: true } },
      districtSalesManagerRelation: { select: { id: true } },
      nationalSalesManagerRelation: { select: { id: true } },
      localFinanceControllerRelation: { select: { id: true } },
      directorCommercialManagerRelation: { select: { id: true } },
      technicalManagerRelation: { select: { id: true } },
      nationalTSManagerRelation: { select: { id: true } },
    },
  });

  const fieldMappings: Array<{
    field: string;
    idField: keyof typeof users[0];
    relationField: keyof typeof users[0];
  }> = [
    { field: 'salesManagerId', idField: 'salesManagerId', relationField: 'salesManagerRelation' },
    { field: 'districtSalesManagerId', idField: 'districtSalesManagerId', relationField: 'districtSalesManagerRelation' },
    { field: 'nationalSalesManagerId', idField: 'nationalSalesManagerId', relationField: 'nationalSalesManagerRelation' },
    { field: 'localFinanceControllerId', idField: 'localFinanceControllerId', relationField: 'localFinanceControllerRelation' },
    { field: 'directorCommercialManagerId', idField: 'directorCommercialManagerId', relationField: 'directorCommercialManagerRelation' },
    { field: 'technicalManagerId', idField: 'technicalManagerId', relationField: 'technicalManagerRelation' },
    { field: 'nationalTSManagerId', idField: 'nationalTSManagerId', relationField: 'nationalTSManagerRelation' },
  ];

  for (const user of users) {
    for (const mapping of fieldMappings) {
      const approverId = user[mapping.idField] as string | null;
      const approverRelation = user[mapping.relationField] as { id: string } | null | undefined;

      if (approverId && !approverRelation) {
        // Check if approver exists but is inactive
        const approver = await prisma.user.findUnique({
          where: { id: approverId },
          select: { id: true, name: true, isActive: true },
        });

        if (!approver) {
          issues.push({
            type: 'MISSING_APPROVER',
            userId: user.id,
            userName: user.name,
            field: mapping.field,
            approverId: approverId,
            severity: 'ERROR',
          });
        } else if (!approver.isActive) {
          issues.push({
            type: 'MISSING_APPROVER',
            userId: user.id,
            userName: user.name,
            field: mapping.field,
            approverId: approverId,
            approverName: approver.name,
            severity: 'WARNING',
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Validate all hierarchies
 */
export async function validateAllHierarchies(): Promise<HierarchyValidationResult> {
  const missingApprovers = await findMissingApprovers();
  const circularRefs = await findCircularReferences();

  // Get all active users count
  const totalUsers = await prisma.user.count({ where: { isActive: true } });
  const issues = [...missingApprovers, ...circularRefs];
  const validUsers = totalUsers - issues.filter((i) => i.severity === 'ERROR').length;

  return {
    totalUsers,
    validUsers,
    issues,
  };
}

/**
 * Validate a single user's hierarchy
 */
export async function validateUserHierarchy(userId: string): Promise<HierarchyValidationIssue[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      salesManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      districtSalesManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      nationalSalesManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      localFinanceControllerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      directorCommercialManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      technicalManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
      nationalTSManagerRelation: { select: { id: true, name: true, isActive: true, role: true } },
    },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const issues: HierarchyValidationIssue[] = [];

  // Check for missing approvers
  const approverChecks = [
    { field: 'salesManagerId', relation: user.salesManagerRelation, expectedRole: 'SALES_MANAGER' },
    { field: 'districtSalesManagerId', relation: user.districtSalesManagerRelation, expectedRole: 'DISTRICT_SALES_MANAGER' },
    { field: 'nationalSalesManagerId', relation: user.nationalSalesManagerRelation, expectedRole: 'NATIONAL_SALES_MANAGER' },
    { field: 'localFinanceControllerId', relation: user.localFinanceControllerRelation, expectedRole: 'FINANCE_CONTROLLER' },
    { field: 'directorCommercialManagerId', relation: user.directorCommercialManagerRelation, expectedRole: 'DIRECTOR_COMMERCIAL' },
    { field: 'technicalManagerId', relation: user.technicalManagerRelation, expectedRole: undefined },
    { field: 'nationalTSManagerId', relation: user.nationalTSManagerRelation, expectedRole: undefined },
  ];

  for (const check of approverChecks) {
    const approverId = user[check.field as keyof typeof user] as string | null;
    if (approverId && !check.relation) {
      issues.push({
        type: 'MISSING_APPROVER',
        userId: user.id,
        userName: user.name,
        field: check.field,
        approverId: approverId,
        severity: 'ERROR',
      });
    } else if (check.relation && !check.relation.isActive) {
      issues.push({
        type: 'MISSING_APPROVER',
        userId: user.id,
        userName: user.name,
        field: check.field,
        approverId: approverId || undefined,
        approverName: check.relation.name,
        severity: 'WARNING',
      });
    } else if (check.relation && check.expectedRole && check.relation.role !== check.expectedRole) {
      issues.push({
        type: 'INVALID_ROLE',
        userId: user.id,
        userName: user.name,
        field: check.field,
        approverId: approverId || undefined,
        approverName: check.relation.name,
        approverRole: check.relation.role,
        expectedRole: check.expectedRole,
        severity: 'WARNING',
      });
    }
  }

  // Check for circular references (simplified - check if user is their own approver indirectly)
  // This is a simplified check; full circular detection is in findCircularReferences
  const approverIds = [
    user.salesManagerId,
    user.districtSalesManagerId,
    user.nationalSalesManagerId,
    user.localFinanceControllerId,
    user.directorCommercialManagerId,
    user.technicalManagerId,
    user.nationalTSManagerId,
  ].filter((id): id is string => id !== null);

  if (approverIds.includes(user.id)) {
    issues.push({
      type: 'CIRCULAR_REFERENCE',
      userId: user.id,
      userName: user.name,
      severity: 'ERROR',
    });
  }

  return issues;
}

/** Role -> "reports to" FK (Option A: reuse existing schema) */
const REPORTS_TO_FK_BY_ROLE: Record<string, keyof Prisma.UserUncheckedUpdateInput> = {
  REQUESTER: 'salesManagerId',
  SALES_MANAGER: 'districtSalesManagerId',
  DISTRICT_SALES_MANAGER: 'nationalSalesManagerId',
  NATIONAL_SALES_MANAGER: 'localFinanceControllerId',
  FINANCE_CONTROLLER: 'directorCommercialManagerId',
  DIRECTOR_COMMERCIAL: 'directorCommercialManagerId', // optional: director can report to someone
  ADMIN: 'salesManagerId', // fallback; admins often have no hierarchy
};

type UserManagerIds = {
  salesManagerId: string | null;
  districtSalesManagerId: string | null;
  nationalSalesManagerId: string | null;
  localFinanceControllerId: string | null;
  directorCommercialManagerId: string | null;
  technicalManagerId: string | null;
  nationalTSManagerId: string | null;
};

/** Walk upward from `fromUserId` via "reports to" and return true if we ever reach `targetUserId` */
async function wouldCreateCycle(fromUserId: string, targetUserId: string): Promise<boolean> {
  const visited = new Set<string>();
  let current: string | null = targetUserId;
  while (current && !visited.has(current)) {
    if (current === fromUserId) return true;
    visited.add(current);
    const u: UserManagerIds | null = await prisma.user.findUnique({
      where: { id: current },
      select: {
        salesManagerId: true,
        districtSalesManagerId: true,
        nationalSalesManagerId: true,
        localFinanceControllerId: true,
        directorCommercialManagerId: true,
        technicalManagerId: true,
        nationalTSManagerId: true,
      },
    });
    if (!u) break;
    current =
      u.salesManagerId ??
      u.districtSalesManagerId ??
      u.nationalSalesManagerId ??
      u.localFinanceControllerId ??
      u.directorCommercialManagerId ??
      u.technicalManagerId ??
      u.nationalTSManagerId ??
      null;
  }
  return false;
}

/**
 * Update user hierarchy with validation
 * Supports simple mode: { name, email, reportsToId } and full form-type mode.
 */
export async function updateUserHierarchyWithValidation(
  userId: string,
  updates: {
    name?: string;
    email?: string;
    reportsToId?: string | null;
    formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';
    salesManagerId?: string | null;
    districtSalesManagerId?: string | null;
    nationalSalesManagerId?: string | null;
    localFinanceControllerId?: string | null;
    directorCommercialManagerId?: string | null;
    technicalManagerId?: string | null;
    nationalTSManagerId?: string | null;
  },
  _changedBy: string
): Promise<{
  user: Prisma.UserGetPayload<{
    include: {
      salesManagerRelation: { select: { id: true; name: true; email: true } };
      districtSalesManagerRelation: { select: { id: true; name: true; email: true } };
      nationalSalesManagerRelation: { select: { id: true; name: true; email: true } };
      localFinanceControllerRelation: { select: { id: true; name: true; email: true } };
      directorCommercialManagerRelation: { select: { id: true; name: true; email: true } };
      technicalManagerRelation: { select: { id: true; name: true; email: true } };
      nationalTSManagerRelation: { select: { id: true; name: true; email: true } };
    };
  }>;
  changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>;
}> {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!currentUser) {
    throw new Error(`User not found: ${userId}`);
  }

  const isSimpleMode =
    updates.name !== undefined || updates.email !== undefined || updates.reportsToId !== undefined;

  const updateData: Prisma.UserUncheckedUpdateInput = {};
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

  if (isSimpleMode) {
    if (updates.name !== undefined) {
      if (!updates.name.trim()) throw new Error('Name is required');
      updateData.name = updates.name.trim();
    }
    if (updates.email !== undefined) {
      const email = updates.email.trim();
      if (!email) throw new Error('Email is required');
      const existing = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), id: { not: userId } },
      });
      if (existing) throw new Error('Email is already in use by another user');
      updateData.email = email;
    }
    if (updates.reportsToId !== undefined) {
      const reportsToId = updates.reportsToId;
      if (reportsToId === userId) {
        throw new Error('User cannot report to themselves');
      }
      const fk = REPORTS_TO_FK_BY_ROLE[currentUser.role];
      if (fk) {
        if (reportsToId) {
          const target = await prisma.user.findUnique({
            where: { id: reportsToId },
            select: { id: true, isActive: true },
          });
          if (!target) throw new Error('Reports-to user not found');
          if (!target.isActive) throw new Error('Reports-to user is inactive');
          if (await wouldCreateCycle(userId, reportsToId)) {
            throw new Error('This would create a circular reporting chain');
          }
        }
        (updateData as Record<string, string | null>)[fk as string] = reportsToId;
      }
      // DIRECTOR_COMMERCIAL/ADMIN: fk may be set; we already handle directorCommercialManagerId for director
    }
  }

  if (!isSimpleMode) {
    const approverIds = [
      updates.salesManagerId,
      updates.districtSalesManagerId,
      updates.nationalSalesManagerId,
      updates.localFinanceControllerId,
      updates.directorCommercialManagerId,
      updates.technicalManagerId,
      updates.nationalTSManagerId,
    ].filter((id): id is string => id !== null && id !== undefined);

    if (approverIds.length > 0) {
      const approvers = await prisma.user.findMany({
        where: { id: { in: approverIds }, isActive: true },
        select: { id: true },
      });

      const missingApprovers = approverIds.filter((id) => !approvers.find((a) => a.id === id));
      if (missingApprovers.length > 0) {
        throw new Error(`Approvers not found or inactive: ${missingApprovers.join(', ')}`);
      }
    }

    if (approverIds.includes(userId)) {
      throw new Error('User cannot be their own approver');
    }

    // Build update data based on form type
    if (updates.formType === 'ZSAM') {
    // ZSAM: Clear ZNC fields, update ZSAM fields
    updateData.technicalManagerId = null;
    updateData.nationalTSManagerId = null;
    if (updates.salesManagerId !== undefined) updateData.salesManagerId = updates.salesManagerId;
    if (updates.districtSalesManagerId !== undefined) updateData.districtSalesManagerId = updates.districtSalesManagerId;
    if (updates.nationalSalesManagerId !== undefined) updateData.nationalSalesManagerId = updates.nationalSalesManagerId;
    if (updates.localFinanceControllerId !== undefined) updateData.localFinanceControllerId = updates.localFinanceControllerId;
    if (updates.directorCommercialManagerId !== undefined) updateData.directorCommercialManagerId = updates.directorCommercialManagerId;
  } else if (updates.formType === 'ZNC' || updates.formType === 'ZNCCLAIM' || updates.formType === 'ZINT') {
    // ZNC/ZNCCLAIM/ZINT: Clear ZSAM-specific fields, update ZNC fields
    updateData.nationalSalesManagerId = null;
    updateData.localFinanceControllerId = null;
    updateData.directorCommercialManagerId = null;
    if (updates.salesManagerId !== undefined) updateData.salesManagerId = updates.salesManagerId;
    if (updates.districtSalesManagerId !== undefined) updateData.districtSalesManagerId = updates.districtSalesManagerId;
    if (updates.technicalManagerId !== undefined) updateData.technicalManagerId = updates.technicalManagerId;
    if (updates.nationalTSManagerId !== undefined) updateData.nationalTSManagerId = updates.nationalTSManagerId;
  } else {
    // Update all fields if form type not specified
    if (updates.salesManagerId !== undefined) updateData.salesManagerId = updates.salesManagerId;
    if (updates.districtSalesManagerId !== undefined) updateData.districtSalesManagerId = updates.districtSalesManagerId;
    if (updates.nationalSalesManagerId !== undefined) updateData.nationalSalesManagerId = updates.nationalSalesManagerId;
    if (updates.localFinanceControllerId !== undefined) updateData.localFinanceControllerId = updates.localFinanceControllerId;
    if (updates.directorCommercialManagerId !== undefined) updateData.directorCommercialManagerId = updates.directorCommercialManagerId;
    if (updates.technicalManagerId !== undefined) updateData.technicalManagerId = updates.technicalManagerId;
    if (updates.nationalTSManagerId !== undefined) updateData.nationalTSManagerId = updates.nationalTSManagerId;
  }
  }

  // Track changes (simple mode: name, email, reportsToId; full mode: FK fields)
  if (isSimpleMode) {
    if (updates.name !== undefined && updates.name !== currentUser.name) {
      changes.push({ field: 'name', oldValue: currentUser.name, newValue: updates.name.trim() });
    }
    if (updates.email !== undefined && updates.email !== currentUser.email) {
      changes.push({ field: 'email', oldValue: currentUser.email, newValue: updates.email.trim() });
    }
    if (updates.reportsToId !== undefined) {
      const fk = REPORTS_TO_FK_BY_ROLE[currentUser.role];
      if (fk) {
        const oldVal = (currentUser as Record<string, unknown>)[fk] as string | null;
        const newVal = updates.reportsToId;
        if (oldVal !== newVal) {
          changes.push({ field: 'reportsToId', oldValue: oldVal, newValue: newVal });
        }
      }
    }
  }
  if (!isSimpleMode) {
    const fieldMappings: Array<{ field: string; dbField: keyof typeof currentUser }> = [
      { field: 'salesManagerId', dbField: 'salesManagerId' },
      { field: 'districtSalesManagerId', dbField: 'districtSalesManagerId' },
      { field: 'nationalSalesManagerId', dbField: 'nationalSalesManagerId' },
      { field: 'localFinanceControllerId', dbField: 'localFinanceControllerId' },
      { field: 'directorCommercialManagerId', dbField: 'directorCommercialManagerId' },
      { field: 'technicalManagerId', dbField: 'technicalManagerId' },
      { field: 'nationalTSManagerId', dbField: 'nationalTSManagerId' },
    ];
    for (const mapping of fieldMappings) {
      const oldValue = currentUser[mapping.dbField] as string | null;
      const updateValue = updateData[mapping.dbField as keyof Prisma.UserUncheckedUpdateInput];
      const newValue = updateValue !== undefined ? (updateValue as string | null) : oldValue;
      if (oldValue !== newValue) {
        changes.push({ field: mapping.field, oldValue, newValue });
      }
    }
  }

  // Update user
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    include: {
      salesManagerRelation: { select: { id: true, name: true, email: true } },
      districtSalesManagerRelation: { select: { id: true, name: true, email: true } },
      nationalSalesManagerRelation: { select: { id: true, name: true, email: true } },
      localFinanceControllerRelation: { select: { id: true, name: true, email: true } },
      directorCommercialManagerRelation: { select: { id: true, name: true, email: true } },
      technicalManagerRelation: { select: { id: true, name: true, email: true } },
      nationalTSManagerRelation: { select: { id: true, name: true, email: true } },
    },
  });

  // TODO: Track change history (extend ChangeHistory table or create UserHistory)

  return { user: updatedUser, changes };
}

/**
 * Role hierarchy levels for validation
 */
const ROLE_LEVELS: Record<string, number> = {
  REQUESTER: 0,
  SALES_MANAGER: 1,
  DISTRICT_SALES_MANAGER: 2,
  NATIONAL_SALES_MANAGER: 3,
  FINANCE_CONTROLLER: 3.5,
  TECHNICAL_MANAGER: 3,
  NATIONAL_TS_MANAGER: 4,
  DIRECTOR_COMMERCIAL: 4,
};

/**
 * Allowed roles for each hierarchy field
 */
const FIELD_ALLOWED_ROLES: Record<string, string[]> = {
  salesManagerId: ['SALES_MANAGER', 'DISTRICT_SALES_MANAGER', 'NATIONAL_SALES_MANAGER', 'DIRECTOR_COMMERCIAL'],
  districtSalesManagerId: ['DISTRICT_SALES_MANAGER', 'NATIONAL_SALES_MANAGER', 'DIRECTOR_COMMERCIAL'],
  nationalSalesManagerId: ['NATIONAL_SALES_MANAGER', 'DIRECTOR_COMMERCIAL'],
  localFinanceControllerId: ['FINANCE_CONTROLLER', 'DIRECTOR_COMMERCIAL'],
  directorCommercialManagerId: ['DIRECTOR_COMMERCIAL'],
  technicalManagerId: ['TECHNICAL_MANAGER', 'NATIONAL_TS_MANAGER'],
  nationalTSManagerId: ['NATIONAL_TS_MANAGER'],
};

/**
 * Validate approver role for a specific field
 */
export async function validateApproverRole(
  approverId: string | null,
  field: string,
  _formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'
): Promise<{ valid: boolean; message?: string; severity: 'ERROR' | 'WARNING' }> {
  if (!approverId) {
    return { valid: true, severity: 'WARNING' };
  }

  const approver = await prisma.user.findUnique({
    where: { id: approverId },
    select: { id: true, role: true, isActive: true },
  });

  if (!approver) {
    return { valid: false, message: 'Approver not found', severity: 'ERROR' };
  }

  if (!approver.isActive) {
    return { valid: false, message: 'User is inactive and cannot be assigned as approver', severity: 'ERROR' };
  }

  const allowedRoles = FIELD_ALLOWED_ROLES[field] || [];
  if (allowedRoles.length === 0) {
    return { valid: true, severity: 'WARNING' };
  }

  if (!allowedRoles.includes(approver.role)) {
    const expectedRole = allowedRoles[0];
    return {
      valid: false,
      message: `Invalid role: User must be ${expectedRole} or higher`,
      severity: 'ERROR',
    };
  }

  // Check if role is recommended (exact match) vs allowed (higher level)
  const recommendedRole = allowedRoles[0];
  if (approver.role !== recommendedRole && allowedRoles.includes(approver.role)) {
    return {
      valid: true,
      message: `User has role ${approver.role}, but ${recommendedRole} is recommended`,
      severity: 'WARNING',
    };
  }

  return { valid: true, severity: 'WARNING' };
}

/**
 * Check business unit compatibility
 */
export async function checkBusinessUnitCompatibility(
  requesterId: string,
  approverId: string | null,
  _field: string
): Promise<{ compatible: boolean; warning?: string }> {
  if (!approverId) {
    return { compatible: true };
  }

  const [requester, approver] = await Promise.all([
    prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, businessUnit: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: approverId },
      select: { id: true, businessUnit: true, role: true },
    }),
  ]);

  if (!requester || !approver) {
    return { compatible: true };
  }

  // Same BU - always compatible
  if (requester.businessUnit === approver.businessUnit) {
    return { compatible: true };
  }

  // Cross-BU exceptions
  const crossBURoles = ['DIRECTOR_COMMERCIAL', 'NATIONAL_SALES_MANAGER', 'FINANCE_CONTROLLER', 'TECHNICAL_MANAGER', 'NATIONAL_TS_MANAGER'];
  if (crossBURoles.includes(approver.role)) {
    return { compatible: true };
  }

  // Same level approvers - warning
  const requesterLevel = ROLE_LEVELS[requester.role] || 0;
  const approverLevel = ROLE_LEVELS[approver.role] || 0;
  
  if (approverLevel <= requesterLevel + 1) {
    return {
      compatible: true,
      warning: `Different business unit (${requester.businessUnit || 'N/A'} → ${approver.businessUnit || 'N/A'}). Allowed but not recommended.`,
    };
  }

  return { compatible: true };
}

/**
 * Detect circular reference in approval chain
 */
export async function detectCircularReference(
  userId: string,
  approverId: string | null,
  _field: string
): Promise<{ hasCycle: boolean; path?: string[] }> {
  if (!approverId || approverId === userId) {
    return { hasCycle: approverId === userId, path: approverId === userId ? [userId] : undefined };
  }

  const visited = new Set<string>();
  const path: string[] = [userId];
  
  let currentId: string | null = approverId;
  let depth = 0;
  const maxDepth = 10; // Prevent infinite loops

  while (currentId && depth < maxDepth) {
    if (currentId === userId) {
      return { hasCycle: true, path: [...path, currentId] };
    }

    if (visited.has(currentId)) {
      return { hasCycle: true, path: [...path, currentId] };
    }

    visited.add(currentId);
    path.push(currentId);

    // Get approvers for this user
    type UserApprovers = {
      salesManagerId: string | null;
      districtSalesManagerId: string | null;
      nationalSalesManagerId: string | null;
      localFinanceControllerId: string | null;
      directorCommercialManagerId: string | null;
      technicalManagerId: string | null;
      nationalTSManagerId: string | null;
    };
    
    const user: UserApprovers | null = await prisma.user.findUnique({
      where: { id: currentId },
      select: {
        salesManagerId: true,
        districtSalesManagerId: true,
        nationalSalesManagerId: true,
        localFinanceControllerId: true,
        directorCommercialManagerId: true,
        technicalManagerId: true,
        nationalTSManagerId: true,
      },
    });

    if (!user) {
      break;
    }

    // Check all approver fields
    const approverIds: (string | null)[] = [
      user.salesManagerId,
      user.districtSalesManagerId,
      user.nationalSalesManagerId,
      user.localFinanceControllerId,
      user.directorCommercialManagerId,
      user.technicalManagerId,
      user.nationalTSManagerId,
    ];
    const approvers: string[] = approverIds.filter((id): id is string => id !== null);

    if (approvers.length === 0) {
      break;
    }

    // Follow the first approver (simplified - could check all paths)
    currentId = approvers[0];
    depth++;
  }

  return { hasCycle: false };
}

/**
 * Validate hierarchy data before saving
 */
export interface HierarchyValidationResponse {
  valid: boolean;
  errors: Array<{
    field: string;
    type: 'INVALID_ROLE' | 'CIRCULAR_REFERENCE' | 'BUSINESS_UNIT_MISMATCH' | 'MISSING_APPROVER' | 'INACTIVE_USER';
    message: string;
    severity: 'ERROR' | 'WARNING';
  }>;
  warnings: Array<{
    field: string;
    type: string;
    message: string;
  }>;
}

export async function validateHierarchyData(
  userId: string,
  updates: {
    formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';
    salesManagerId?: string | null;
    districtSalesManagerId?: string | null;
    nationalSalesManagerId?: string | null;
    localFinanceControllerId?: string | null;
    directorCommercialManagerId?: string | null;
    technicalManagerId?: string | null;
    nationalTSManagerId?: string | null;
  }
): Promise<HierarchyValidationResponse> {
  const errors: HierarchyValidationResponse['errors'] = [];
  const warnings: HierarchyValidationResponse['warnings'] = [];

  const fields = [
    { key: 'salesManagerId', value: updates.salesManagerId },
    { key: 'districtSalesManagerId', value: updates.districtSalesManagerId },
    { key: 'nationalSalesManagerId', value: updates.nationalSalesManagerId },
    { key: 'localFinanceControllerId', value: updates.localFinanceControllerId },
    { key: 'directorCommercialManagerId', value: updates.directorCommercialManagerId },
    { key: 'technicalManagerId', value: updates.technicalManagerId },
    { key: 'nationalTSManagerId', value: updates.nationalTSManagerId },
  ];

  for (const { key, value } of fields) {
    if (value === null || value === undefined) continue;

    // Role validation
    const roleValidation = await validateApproverRole(value, key, updates.formType);
    if (!roleValidation.valid) {
      errors.push({
        field: key,
        type: roleValidation.message?.includes('inactive') ? 'INACTIVE_USER' : 'INVALID_ROLE',
        message: roleValidation.message || 'Invalid approver',
        severity: roleValidation.severity,
      });
    } else if (roleValidation.message) {
      warnings.push({
        field: key,
        type: 'ROLE_MISMATCH',
        message: roleValidation.message,
      });
    }

    // Circular reference check
    const circularCheck = await detectCircularReference(userId, value, key);
    if (circularCheck.hasCycle) {
      const pathStr = circularCheck.path ? circularCheck.path.join(' → ') : '';
      errors.push({
        field: key,
        type: 'CIRCULAR_REFERENCE',
        message: `Circular reference detected: This would create a loop${pathStr ? ` (${pathStr})` : ''}`,
        severity: 'ERROR',
      });
    }

    // Business unit check
    const buCheck = await checkBusinessUnitCompatibility(userId, value, key);
    if (buCheck.warning) {
      warnings.push({
        field: key,
        type: 'BUSINESS_UNIT_MISMATCH',
        message: buCheck.warning,
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'ERROR').length === 0,
    errors,
    warnings,
  };
}
