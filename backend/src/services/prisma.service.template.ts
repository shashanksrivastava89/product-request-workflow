/**
 * Prisma Service - Template
 * 
 * This is a template showing the structure of the Prisma service.
 * Copy this to prisma.service.ts and implement all methods.
 * 
 * This service provides a similar interface to db.service.ts but uses Prisma.
 */

import { PrismaClient, UserRole, FormType, FormStatus, DeliveryMode, ApprovalStatus } from '@prisma/client';
import { User, SalesForm, FormProduct, Approval } from './db.service';

const prisma = new PrismaClient();

/**
 * Prisma Service - Wraps Prisma Client with methods similar to db.service.ts
 */
export class PrismaService {
  
  // ============================================
  // USER OPERATIONS
  // ============================================
  
  /**
   * Find many users with optional filter
   */
  async findManyUsers(filter?: Partial<User>): Promise<User[]> {
    const where: any = {};
    
    if (filter) {
      if (filter.role) where.role = filter.role as UserRole;
      if (filter.businessUnit) where.businessUnit = filter.businessUnit;
      if (filter.isActive !== undefined) where.isActive = filter.isActive;
      if (filter.requesterGroupId) where.requesterGroupId = filter.requesterGroupId;
      // Add more filters as needed
    }
    
    const users = await prisma.user.findMany({ where });
    
    // Convert Prisma User to db.service User format
    return users.map(u => ({
      id: u.id,
      email: u.email,
      password: u.password,
      name: u.name,
      role: u.role as string,
      businessUnit: u.businessUnit || undefined,
      department: u.department || undefined,
      salesRepCode: u.salesRepCode || undefined,
      requesterGroupId: u.requesterGroupId || undefined,
      salesManager: u.salesManager || undefined,
      districtSalesManager: u.districtSalesManager || undefined,
      nationalSalesManager: u.nationalSalesManager || undefined,
      localFinanceController: u.localFinanceController || undefined,
      directorCommercialManager: u.directorCommercialManager || undefined,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));
  }
  
  /**
   * Find user by ID
   */
  async findUserById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    
    return this.mapPrismaUserToUser(user);
  }
  
  /**
   * Find user by email (case-insensitive)
   */
  async findUserByEmail(email: string): Promise<User | null> {
    // Prisma doesn't support case-insensitive search directly
    // We'll need to query and filter in memory, or use raw SQL
    const users = await prisma.user.findMany({
      where: {
        email: {
          equals: email,
          mode: 'insensitive', // PostgreSQL supports this
        }
      }
    });
    
    if (users.length === 0) return null;
    return this.mapPrismaUserToUser(users[0]);
  }
  
  /**
   * Create a new user
   */
  async createUser(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        name: data.name,
        role: data.role as UserRole,
        businessUnit: data.businessUnit,
        department: data.department,
        salesRepCode: data.salesRepCode,
        requesterGroupId: data.requesterGroupId,
        salesManager: data.salesManager,
        districtSalesManager: data.districtSalesManager,
        nationalSalesManager: data.nationalSalesManager,
        localFinanceController: data.localFinanceController,
        directorCommercialManager: data.directorCommercialManager,
        isActive: data.isActive,
      }
    });
    
    return this.mapPrismaUserToUser(user);
  }
  
  /**
   * Update user
   */
  async updateUser(id: string, data: Partial<User>): Promise<User | null> {
    const updateData: any = {};
    
    if (data.email !== undefined) updateData.email = data.email;
    if (data.password !== undefined) updateData.password = data.password;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.role !== undefined) updateData.role = data.role as UserRole;
    if (data.businessUnit !== undefined) updateData.businessUnit = data.businessUnit;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.salesRepCode !== undefined) updateData.salesRepCode = data.salesRepCode;
    if (data.requesterGroupId !== undefined) updateData.requesterGroupId = data.requesterGroupId;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    // Add more fields as needed
    
    try {
      const user = await prisma.user.update({
        where: { id },
        data: updateData
      });
      
      return this.mapPrismaUserToUser(user);
    } catch (error) {
      // User not found
      return null;
    }
  }
  
  /**
   * Helper: Map Prisma User to db.service User
   */
  private mapPrismaUserToUser(user: any): User {
    return {
      id: user.id,
      email: user.email,
      password: user.password,
      name: user.name,
      role: user.role as string,
      businessUnit: user.businessUnit || undefined,
      department: user.department || undefined,
      salesRepCode: user.salesRepCode || undefined,
      requesterGroupId: user.requesterGroupId || undefined,
      salesManager: user.salesManager || undefined,
      districtSalesManager: user.districtSalesManager || undefined,
      nationalSalesManager: user.nationalSalesManager || undefined,
      localFinanceController: user.localFinanceController || undefined,
      directorCommercialManager: user.directorCommercialManager || undefined,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
  
  // ============================================
  // FORM OPERATIONS
  // ============================================
  
  /**
   * Find many forms with optional filter
   */
  async findManyForms(filter?: Partial<SalesForm>): Promise<SalesForm[]> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Find form by ID with relations
   */
  async findFormById(id: string): Promise<SalesForm | null> {
    // TODO: Implement with products and approvals
    throw new Error('Not implemented');
  }
  
  /**
   * Create form
   */
  async createForm(data: Omit<SalesForm, 'id' | 'createdAt' | 'updatedAt'>): Promise<SalesForm> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Update form
   */
  async updateForm(id: string, data: Partial<SalesForm>): Promise<SalesForm | null> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Delete form and related data
   */
  async deleteForm(id: string): Promise<boolean> {
    // TODO: Implement with cascade delete
    throw new Error('Not implemented');
  }
  
  // ============================================
  // FORM PRODUCT OPERATIONS
  // ============================================
  
  /**
   * Find products for a form
   */
  async findFormProducts(formId: string): Promise<FormProduct[]> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Create form product
   */
  async createFormProduct(data: Omit<FormProduct, 'id' | 'createdAt' | 'updatedAt'>): Promise<FormProduct> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Delete all products for a form
   */
  async deleteFormProducts(formId: string): Promise<number> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  // ============================================
  // APPROVAL OPERATIONS
  // ============================================
  
  /**
   * Find many approvals with optional filter
   */
  async findManyApprovals(filter?: Partial<Approval>): Promise<Approval[]> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Find approval by ID
   */
  async findApprovalById(id: string): Promise<Approval | null> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Create approval
   */
  async createApproval(data: Omit<Approval, 'id' | 'createdAt' | 'updatedAt'>): Promise<Approval> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Update approval
   */
  async updateApproval(id: string, data: Partial<Approval>): Promise<Approval | null> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  /**
   * Find approvals for a form
   */
  async findApprovalsByFormId(formId: string): Promise<Approval[]> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
  
  // ============================================
  // UTILITY METHODS
  // ============================================
  
  /**
   * Disconnect Prisma client (for cleanup)
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}

// Export singleton instance
export const prismaService = new PrismaService();

