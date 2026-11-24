/**
 * Prisma Service - Wraps Prisma Client with methods similar to db.service.ts
 * 
 * Phase 1: User operations implemented
 * Phase 2: Forms, Products, Approvals will be added
 */

import { PrismaClient, Prisma, UserRole, FormType, FormStatus, DeliveryMode, ApprovalStatus } from '@prisma/client';
import { User, SalesForm, FormProduct, Approval } from './db.service';
import { getHierarchyName } from '../utils/hierarchy.util';
import { RETURN_REVIEWER_ROLE_LABEL } from '../constants/return-form.constants';

const prisma = new PrismaClient();

/**
 * Prisma Service - Wraps Prisma Client with methods similar to db.service.ts
 */
export class PrismaService {
  
  /** Ping DB (same connection as findUserByEmail / login). */
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }

  // ============================================
  // USER OPERATIONS (Phase 1)
  // ============================================
  
  /**
   * Find many users with optional filter
   * Includes hierarchy relations for backward compatibility
   */
  async findManyUsers(filter?: Partial<User>): Promise<User[]> {
    const where: any = {};
    
    if (filter) {
      if (filter.role) where.role = filter.role as UserRole;
      if (filter.businessUnit) where.businessUnit = filter.businessUnit;
      if (filter.isActive !== undefined) where.isActive = filter.isActive;
      if (filter.requesterGroupId) where.requesterGroupId = filter.requesterGroupId;
      if (filter.department) where.department = filter.department;
      if (filter.salesRepCode) where.salesRepCode = filter.salesRepCode;
    }
    
    const users = await prisma.user.findMany({
      where,
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
    
    // Convert Prisma User to db.service User format
    return users.map(u => this.mapPrismaUserToUser(u));
  }
  
  /**
   * Find user by ID
   * Includes hierarchy relations for backward compatibility
   */
  async findUserById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id },
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
    if (!user) return null;
    
    return this.mapPrismaUserToUser(user);
  }
  
  /**
   * Find user by email (case-insensitive)
   * PostgreSQL supports case-insensitive search with mode: 'insensitive'
   * Includes hierarchy relations for backward compatibility
   */
  async findUserByEmail(email: string): Promise<User | null> {
    const users = await prisma.user.findMany({
      where: {
        email: {
          equals: email,
          mode: 'insensitive', // PostgreSQL supports this
        }
      },
      take: 1, // Only need first match
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
        isSuperApprover: data.isSuperApprover ?? false,
        isServiceAdmin: data.isServiceAdmin ?? false,
        isCustomerSupport: data.isCustomerSupport ?? false,
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
    if (data.salesManager !== undefined) updateData.salesManager = data.salesManager;
    if (data.districtSalesManager !== undefined) updateData.districtSalesManager = data.districtSalesManager;
    if (data.nationalSalesManager !== undefined) updateData.nationalSalesManager = data.nationalSalesManager;
    if (data.localFinanceController !== undefined) updateData.localFinanceController = data.localFinanceController;
    if (data.directorCommercialManager !== undefined) updateData.directorCommercialManager = data.directorCommercialManager;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isSuperApprover !== undefined) updateData.isSuperApprover = data.isSuperApprover;
    if (data.isServiceAdmin !== undefined) updateData.isServiceAdmin = data.isServiceAdmin;
    if (data.isCustomerSupport !== undefined) updateData.isCustomerSupport = data.isCustomerSupport;
    
    try {
      const user = await prisma.user.update({
        where: { id },
        data: updateData
      });
      
      return this.mapPrismaUserToUser(user);
    } catch (error: any) {
      // User not found (P2025) or other Prisma errors
      if (error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Helper: Map Prisma User to db.service User
   * Handles both string and foreign key formats for backward compatibility
   */
  private mapPrismaUserToUser(user: any): User {
    return {
      id: user.id,
      email: user.email,
      password: user.password,
      name: user.name,
      role: user.role as User['role'],
      isSuperApprover: user.isSuperApprover === true,
      isServiceAdmin: user.isServiceAdmin === true,
      isCustomerSupport: user.isCustomerSupport === true,
      businessUnit: user.businessUnit || undefined,
      department: user.department || undefined,
      salesRepCode: user.salesRepCode || undefined,
      requesterGroupId: user.requesterGroupId || undefined,
      // Use utility function to get name from either string or relation
      salesManager: getHierarchyName(user, 'salesManager') || undefined,
      districtSalesManager: getHierarchyName(user, 'districtSalesManager') || undefined,
      nationalSalesManager: getHierarchyName(user, 'nationalSalesManager') || undefined,
      localFinanceController: getHierarchyName(user, 'localFinanceController') || undefined,
      directorCommercialManager: getHierarchyName(user, 'directorCommercialManager') || undefined,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
  
  // ============================================
  // FORM OPERATIONS (Phase 2)
  // ============================================
  
  /**
   * Find many forms with optional filter
   */
  async findManyForms(filter?: Partial<SalesForm>): Promise<SalesForm[]> {
    const where: any = {};
    
    if (filter) {
      if (filter.requesterId) where.requesterId = filter.requesterId;
      if (filter.status) where.status = filter.status as FormStatus;
      if (filter.formType) where.formType = filter.formType as FormType;
      if (filter.businessUnit) where.businessUnit = filter.businessUnit;
      if (filter.referenceNumber) where.referenceNumber = filter.referenceNumber;
    }
    
    const forms = await prisma.salesForm.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    
    return forms.map(f => this.mapPrismaFormToForm(f));
  }

  /**
   * Fully approved forms visible to a user: ones they submitted and/or ones they approved.
   */
  async findApprovedFormsForUser(
    userId: string
  ): Promise<Array<SalesForm & { approvedRelation: 'requester' | 'approver' | 'both' }>> {
    const forms = await prisma.salesForm.findMany({
      where: {
        status: 'APPROVED',
        OR: [
          { requesterId: userId },
          {
            approvals: {
              some: {
                status: 'APPROVED',
                OR: [{ approverId: userId }, { actualActorUserId: userId }],
              },
            },
          },
        ],
      },
      orderBy: [{ completedAt: 'desc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        approvals: {
          where: {
            status: 'APPROVED',
            OR: [{ approverId: userId }, { actualActorUserId: userId }],
          },
          select: { id: true },
        },
      },
    });

    return forms.map((form) => {
      const isRequester = form.requesterId === userId;
      const isApprover = form.approvals.length > 0;
      const approvedRelation: 'requester' | 'approver' | 'both' =
        isRequester && isApprover ? 'both' : isRequester ? 'requester' : 'approver';
      const { approvals: _approvals, ...rest } = form;
      return {
        ...this.mapPrismaFormToForm(rest),
        approvedRelation,
      };
    });
  }

  /**
   * Every approved service return, whoever raised or approved it.
   *
   * The Service Admin team asked to see all Service = Yes requests in Approved Requests, because
   * that is where they enter the SAP sales order number once the credit memo exists. They are often
   * neither the requester nor an approver, so the requester-or-approver query returns them nothing.
   */
  async findApprovedServiceReturns(): Promise<SalesForm[]> {
    const forms = await prisma.salesForm.findMany({
      where: { status: 'APPROVED', formType: 'RETURN', isService: true },
      orderBy: [{ completedAt: 'desc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return forms.map((f) => this.mapPrismaFormToForm(f));
  }

  /**
   * Admin list: filterable, paginated sales forms (no nested products/approvals).
   */
  async findManyFormsAdmin(options: {
    status?: FormStatus;
    /** When set, filter to any of these statuses (overrides `status`). */
    statuses?: FormStatus[];
    formType?: FormType;
    businessUnit?: string;
    /** Case-insensitive exact match on requesterName (OR across names). */
    requesterNames?: string[];
    /** When true, include DRAFT rows. Default false = exclude drafts (submitted workflow only). */
    includeDraft?: boolean;
    search?: string;
    submittedFrom?: Date;
    submittedTo?: Date;
    skip?: number;
    take?: number;
    /** Sort by completedAt desc when set; otherwise submittedAt desc. */
    orderBy?: 'submittedAt' | 'completedAt';
  }): Promise<{ forms: SalesForm[]; total: number }> {
    const and: Prisma.SalesFormWhereInput[] = [];

    if (options.statuses?.length) {
      and.push({ status: { in: options.statuses } });
    } else if (options.status) {
      and.push({ status: options.status });
    } else if (!options.includeDraft) {
      and.push({ status: { not: 'DRAFT' } });
    }

    if (options.formType) {
      and.push({ formType: options.formType });
    }
    if (options.businessUnit?.trim()) {
      and.push({ businessUnit: options.businessUnit.trim() });
    }

    if (options.requesterNames?.length) {
      and.push({
        OR: options.requesterNames.map((name) => ({
          requesterName: { equals: name, mode: 'insensitive' as const },
        })),
      });
    }

    const q = options.search?.trim();
    if (q) {
      and.push({
        OR: [
          { referenceNumber: { contains: q, mode: 'insensitive' } },
          { requesterName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (options.submittedFrom) {
      and.push({ submittedAt: { gte: options.submittedFrom } });
    }
    if (options.submittedTo) {
      const end = new Date(options.submittedTo);
      end.setHours(23, 59, 59, 999);
      and.push({ submittedAt: { lte: end } });
    }

    const where: Prisma.SalesFormWhereInput = and.length > 0 ? { AND: and } : {};

    const skip = options.skip ?? 0;
    const take = Math.min(options.take ?? 50, 200);

    const orderBy =
      options.orderBy === 'completedAt'
        ? [{ completedAt: 'desc' as const }, { submittedAt: 'desc' as const }, { createdAt: 'desc' as const }]
        : [{ submittedAt: 'desc' as const }, { createdAt: 'desc' as const }];

    const [rows, total] = await Promise.all([
      prisma.salesForm.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
      prisma.salesForm.count({ where }),
    ]);

    return {
      forms: rows.map((f) => this.mapPrismaFormToForm(f)),
      total,
    };
  }

  /**
   * Find form by ID with relations (products, approvals)
   */
  async findFormById(id: string): Promise<SalesForm | null> {
    const form = await prisma.salesForm.findUnique({
      where: { id },
      include: {
        products: true,
        approvals: true
      }
    });
    
    if (!form) return null;
    return this.mapPrismaFormToForm(form);
  }
  
  /**
   * Create form
   */
  async createForm(data: Omit<SalesForm, 'id' | 'createdAt' | 'updatedAt'>): Promise<SalesForm> {
    const form = await prisma.salesForm.create({
      data: {
        referenceNumber: data.referenceNumber,
        formType: data.formType as FormType,
        requesterId: data.requesterId,
        requesterName: data.requesterName,
        salesRepCodeSap: data.salesRepCodeSap,
        businessUnit: data.businessUnit,
        requesterGroup: data.requesterGroup,
        requestDate: new Date(data.requestDate),
        expectedDeliveryDate: data.expectedDeliveryDate,
        purpose: data.purpose,
        deliveryMode: data.deliveryMode as DeliveryMode | undefined,
        soldToCode: data.soldToCode,
        soldToName: data.soldToName,
        shipToCode: data.shipToCode,
        shipToName: data.shipToName,
        attentionTo: data.attentionTo,
        endUserCode: data.endUserCode,
        endUserName: data.endUserName,
        address: data.address,
        postalCode: data.postalCode,
        prefecture: data.prefecture,
        phone: data.phone,
        salesManager: data.salesManager,
        districtSalesManager: data.districtSalesManager,
        nationalSalesManager: data.nationalSalesManager,
        localFinanceController: data.localFinanceController,
        directorCommercialManager: data.directorCommercialManager,
        commentsForApproval: data.commentsForApproval,
        freeDescription: data.freeDescription,
        returnType: data.returnType,
        isService: data.isService ?? false,
        originalOrderNumber: data.originalOrderNumber,
        invoiceDate: data.invoiceDate,
        isStandingOrder: data.isStandingOrder ?? false,
        quoteRefNo: data.quoteRefNo,
        orderReason: data.orderReason,
        justification: data.justification,
        dairitenContactName: data.dairitenContactName,
        dairitenContactEmail: data.dairitenContactEmail,
        salesOrderNumber: data.salesOrderNumber,
        totalAmount: data.totalAmount,
        currency: data.currency || 'JPY',
        status: data.status as FormStatus,
        submittedAt: data.submittedAt ? new Date(data.submittedAt) : undefined,
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
        approvalMaxLevel: data.approvalMaxLevel,
        approvalFinalRole: data.approvalFinalRole,
      }
    });
    
    return this.mapPrismaFormToForm(form);
  }
  
  /**
   * Update form
   */
  async updateForm(id: string, data: Partial<SalesForm>): Promise<SalesForm | null> {
    const updateData: any = {};
    
    if (data.referenceNumber !== undefined) updateData.referenceNumber = data.referenceNumber;
    if (data.formType !== undefined) updateData.formType = data.formType as FormType;
    if (data.requesterName !== undefined) updateData.requesterName = data.requesterName;
    if (data.salesRepCodeSap !== undefined) updateData.salesRepCodeSap = data.salesRepCodeSap;
    if (data.businessUnit !== undefined) updateData.businessUnit = data.businessUnit;
    if (data.requesterGroup !== undefined) updateData.requesterGroup = data.requesterGroup;
    if (data.requestDate !== undefined) updateData.requestDate = new Date(data.requestDate);
    if (data.expectedDeliveryDate !== undefined) updateData.expectedDeliveryDate = data.expectedDeliveryDate;
    if (data.purpose !== undefined) updateData.purpose = data.purpose;
    if (data.deliveryMode !== undefined) updateData.deliveryMode = data.deliveryMode as DeliveryMode;
    if (data.soldToCode !== undefined) updateData.soldToCode = data.soldToCode;
    if (data.soldToName !== undefined) updateData.soldToName = data.soldToName;
    if (data.shipToCode !== undefined) updateData.shipToCode = data.shipToCode;
    if (data.shipToName !== undefined) updateData.shipToName = data.shipToName;
    if (data.attentionTo !== undefined) updateData.attentionTo = data.attentionTo;
    if (data.endUserCode !== undefined) updateData.endUserCode = data.endUserCode;
    if (data.endUserName !== undefined) updateData.endUserName = data.endUserName;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
    if (data.prefecture !== undefined) updateData.prefecture = data.prefecture;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.salesManager !== undefined) updateData.salesManager = data.salesManager;
    if (data.districtSalesManager !== undefined) updateData.districtSalesManager = data.districtSalesManager;
    if (data.nationalSalesManager !== undefined) updateData.nationalSalesManager = data.nationalSalesManager;
    if (data.localFinanceController !== undefined) updateData.localFinanceController = data.localFinanceController;
    if (data.directorCommercialManager !== undefined) updateData.directorCommercialManager = data.directorCommercialManager;
    if (data.commentsForApproval !== undefined) updateData.commentsForApproval = data.commentsForApproval;
    if (data.freeDescription !== undefined) updateData.freeDescription = data.freeDescription;
    if (data.returnType !== undefined) updateData.returnType = data.returnType;
    if (data.isService !== undefined) updateData.isService = data.isService;
    if (data.originalOrderNumber !== undefined) updateData.originalOrderNumber = data.originalOrderNumber;
    if (data.invoiceDate !== undefined) updateData.invoiceDate = data.invoiceDate;
    if (data.isStandingOrder !== undefined) updateData.isStandingOrder = data.isStandingOrder;
    if (data.quoteRefNo !== undefined) updateData.quoteRefNo = data.quoteRefNo;
    if (data.orderReason !== undefined) updateData.orderReason = data.orderReason;
    if (data.justification !== undefined) updateData.justification = data.justification;
    if (data.dairitenContactName !== undefined) updateData.dairitenContactName = data.dairitenContactName;
    if (data.dairitenContactEmail !== undefined) updateData.dairitenContactEmail = data.dairitenContactEmail;
    if (data.salesOrderNumber !== undefined) updateData.salesOrderNumber = data.salesOrderNumber;
    if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.status !== undefined) updateData.status = data.status as FormStatus;
    if (data.submittedAt !== undefined) updateData.submittedAt = data.submittedAt ? new Date(data.submittedAt) : null;
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    if (data.approvalMaxLevel !== undefined) updateData.approvalMaxLevel = data.approvalMaxLevel;
    if (data.approvalFinalRole !== undefined) updateData.approvalFinalRole = data.approvalFinalRole;
    
    try {
      const form = await prisma.salesForm.update({
        where: { id },
        data: updateData
      });
      
      return this.mapPrismaFormToForm(form);
    } catch (error: any) {
      if (error.code === 'P2025') {
        return null; // Form not found
      }
      throw error;
    }
  }
  
  /**
   * Delete form (cascade deletes products and approvals)
   */
  async deleteForm(id: string): Promise<boolean> {
    try {
      await prisma.salesForm.delete({
        where: { id }
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') {
        return false; // Form not found
      }
      throw error;
    }
  }
  
  /**
   * Helper: Map Prisma SalesForm to db.service SalesForm
   */
  private mapPrismaFormToForm(form: any): SalesForm {
    return {
      id: form.id,
      referenceNumber: form.referenceNumber || undefined,
      formType: form.formType as 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | 'RETURN',
      requesterId: form.requesterId,
      requesterName: form.requesterName,
      salesRepCodeSap: form.salesRepCodeSap || undefined,
      businessUnit: form.businessUnit || undefined,
      requesterGroup: form.requesterGroup || undefined,
      requestDate: form.requestDate.toISOString(),
      expectedDeliveryDate: form.expectedDeliveryDate || undefined,
      purpose: form.purpose,
      deliveryMode: form.deliveryMode as string | undefined,
      soldToCode: form.soldToCode || undefined,
      soldToName: form.soldToName || undefined,
      shipToCode: form.shipToCode || undefined,
      shipToName: form.shipToName || undefined,
      attentionTo: form.attentionTo || undefined,
      endUserCode: form.endUserCode || undefined,
      endUserName: form.endUserName || undefined,
      address: form.address || undefined,
      postalCode: form.postalCode || undefined,
      prefecture: form.prefecture || undefined,
      phone: form.phone || undefined,
      salesManager: form.salesManager || undefined,
      districtSalesManager: form.districtSalesManager || undefined,
      nationalSalesManager: form.nationalSalesManager || undefined,
      localFinanceController: form.localFinanceController || undefined,
      directorCommercialManager: form.directorCommercialManager || undefined,
      commentsForApproval: form.commentsForApproval || undefined,
      freeDescription: form.freeDescription || undefined,
      returnType: form.returnType || undefined,
      // Boolean column with a default — pass it through as-is rather than `|| undefined`, which
      // would turn a legitimate false into undefined and lose the distinction on update.
      isService: form.isService ?? false,
      originalOrderNumber: form.originalOrderNumber || undefined,
      invoiceDate: form.invoiceDate || undefined,
      isStandingOrder: form.isStandingOrder === true,
      quoteRefNo: form.quoteRefNo || undefined,
      orderReason: form.orderReason || undefined,
      justification: form.justification || undefined,
      dairitenContactName: form.dairitenContactName || undefined,
      dairitenContactEmail: form.dairitenContactEmail || undefined,
      salesOrderNumber: form.salesOrderNumber || undefined,
      totalAmount: Number(form.totalAmount),
      currency: form.currency,
      status: form.status as 'DRAFT' | 'PENDING_APPROVAL' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
      submittedAt: form.submittedAt?.toISOString() || undefined,
      completedAt: form.completedAt?.toISOString() || undefined,
      approvalMaxLevel: form.approvalMaxLevel || undefined,
      approvalFinalRole: form.approvalFinalRole || undefined,
      approvalHistory: Array.isArray(form.approvalHistory) ? form.approvalHistory : [],
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
    };
  }
  
  // ============================================
  // PRODUCT OPERATIONS (Phase 2)
  // ============================================
  
  /**
   * Find products for a form
   */
  async findFormProducts(formId: string): Promise<FormProduct[]> {
    const products = await prisma.formProduct.findMany({
      where: { formId },
      orderBy: { createdAt: 'asc' }
    });
    
    return products.map(p => this.mapPrismaProductToProduct(p));
  }
  
  /**
   * Every invoice date on a form, in entry order.
   *
   * A standing order covers several billing periods, so one request can hold several dates. Falls
   * back to nothing when the table is empty — callers should then use `SalesForm.invoiceDate`,
   * which is always the first date and is what pre-standing-order requests carry.
   */
  async findFormInvoiceDates(formId: string): Promise<string[]> {
    const rows = await prisma.formInvoiceDate.findMany({
      where: { formId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { invoiceDate: true },
    });
    return rows.map((r) => r.invoiceDate);
  }

  /** Replace a form's invoice dates with exactly this list, in order. */
  async replaceFormInvoiceDates(formId: string, dates: string[]): Promise<void> {
    const clean = dates.map((d) => String(d ?? '').trim()).filter(Boolean);
    await prisma.$transaction([
      prisma.formInvoiceDate.deleteMany({ where: { formId } }),
      ...(clean.length > 0
        ? [
            prisma.formInvoiceDate.createMany({
              data: clean.map((invoiceDate, i) => ({ formId, invoiceDate, sortOrder: i })),
            }),
          ]
        : []),
    ]);
  }

  /**
   * Create form product
   */
  async createFormProduct(data: Omit<FormProduct, 'id' | 'createdAt' | 'updatedAt'>): Promise<FormProduct> {
    const product = await prisma.formProduct.create({
      data: {
        formId: data.formId,
        productCode: data.productCode,
        productName: data.productName,
        sapCode: data.sapCode,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        wholesalePrice: data.wholesalePrice,
        subtotal: data.subtotal,
        isConsumable: data.isConsumable,
        lotNumber: data.lotNumber,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        note: data.note,
        returnAmount: data.returnAmount,
        rebillAmount: data.rebillAmount,
      }
    });
    
    return this.mapPrismaProductToProduct(product);
  }
  
  /**
   * Delete all products for a form
   */
  async deleteFormProducts(formId: string): Promise<number> {
    const result = await prisma.formProduct.deleteMany({
      where: { formId }
    });
    
    return result.count;
  }
  
  /**
   * Helper: Map Prisma FormProduct to db.service FormProduct
   */
  private mapPrismaProductToProduct(product: any): FormProduct {
    return {
      id: product.id,
      formId: product.formId,
      productCode: product.productCode,
      productName: product.productName,
      sapCode: product.sapCode || undefined,
      // Decimal column: Prisma hands back a Decimal object, which serialises as "1.5" (a string) and
      // breaks every arithmetic that treated it as a number. Everything reading a product comes
      // through here, so one coercion covers the API, the mails and the print views.
      quantity: Number(product.quantity),
      unitPrice: Number(product.unitPrice),
      wholesalePrice: product.wholesalePrice ? Number(product.wholesalePrice) : undefined,
      subtotal: Number(product.subtotal),
      isConsumable: product.isConsumable,
      lotNumber: product.lotNumber || undefined,
      expiryDate: product.expiryDate?.toISOString() || undefined,
      note: product.note || undefined,
      // `!= null` not `?` — a genuine 0 (a fully re-billed line credits nothing) must survive.
      returnAmount: product.returnAmount != null ? Number(product.returnAmount) : undefined,
      rebillAmount: product.rebillAmount != null ? Number(product.rebillAmount) : undefined,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
  
  // ============================================
  // APPROVAL OPERATIONS (Phase 2)
  // ============================================
  
  /**
   * Find many approvals with optional filter
   */
  async findManyApprovals(filter?: Partial<Approval>): Promise<Approval[]> {
    const where: any = {};
    
    if (filter) {
      if (filter.formId) where.formId = filter.formId;
      if (filter.approverId) where.approverId = filter.approverId;
      if (filter.status) where.status = filter.status as ApprovalStatus;
      if (filter.level !== undefined) where.level = filter.level;
    }
    
    const approvals = await prisma.approval.findMany({
      where,
      orderBy: { level: 'asc' },
      include: { actualActor: { select: { name: true } } },
    });

    return approvals.map(a => this.mapPrismaApprovalToApproval(a));
  }

  /**
   * Rejected approval rows on forms that are still REJECTED — same assignee (or actor who rejected)
   * can reopen their step so the form returns to IN_PROGRESS (see reopenRejectedApproval).
   * Super approvers pass includeAllForSuper to list every such row (same pattern as inbox IN_PROGRESS).
   * ADMIN is excluded from the global list — they use Data Management for rejected forms.
   */
  async findRejectedApprovalsForReopen(userId: string, includeAllForSuper: boolean): Promise<Approval[]> {
    const where: any = {
      status: 'REJECTED' as ApprovalStatus,
      form: { status: 'REJECTED' },
    };
    if (!includeAllForSuper) {
      where.OR = [{ approverId: userId }, { actualActorUserId: userId }];
    }
    const approvals = await prisma.approval.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { actualActor: { select: { name: true } } },
    });
    return approvals.map((a) => this.mapPrismaApprovalToApproval(a));
  }

  /**
   * Review steps that sent their request back, while it is still sent back: the service team's
   * send-backs, whoever on the team pressed the button. A request that has since been reopened for
   * correction is a draft, not rejected, and drops out.
   */
  async findRejectedReviewSteps(): Promise<Approval[]> {
    const approvals = await prisma.approval.findMany({
      where: {
        status: 'REJECTED' as ApprovalStatus,
        role: { equals: RETURN_REVIEWER_ROLE_LABEL, mode: 'insensitive' },
        form: { status: 'REJECTED' },
      },
      orderBy: { updatedAt: 'desc' },
      include: { actualActor: { select: { name: true } } },
    });
    return approvals.map((a) => this.mapPrismaApprovalToApproval(a));
  }

  /**
   * When this person deleted each of these approvals from their inbox, by approval id. Only the
   * ones they deleted are in the map.
   */
  async findInboxDismissals(userId: string, approvalIds: string[]): Promise<Map<string, Date>> {
    if (approvalIds.length === 0) return new Map();
    const rows = await prisma.approvalInboxDismissal.findMany({
      where: { userId, approvalId: { in: approvalIds } },
      select: { approvalId: true, dismissedAt: true },
    });
    return new Map(rows.map((r) => [r.approvalId, r.dismissedAt]));
  }

  /** Record that this person deleted this approval from their inbox - now, whenever they did before. */
  async dismissApprovalFromInbox(approvalId: string, userId: string): Promise<Date> {
    const now = new Date();
    const row = await prisma.approvalInboxDismissal.upsert({
      where: { approvalId_userId: { approvalId, userId } },
      create: { approvalId, userId, dismissedAt: now },
      update: { dismissedAt: now },
    });
    return row.dismissedAt;
  }

  /**
   * Find approval by ID
   */
  async findApprovalById(id: string): Promise<Approval | null> {
    const approval = await prisma.approval.findUnique({
      where: { id },
      include: { actualActor: { select: { name: true } } },
    });

    if (!approval) return null;
    return this.mapPrismaApprovalToApproval(approval);
  }

  /**
   * Find approvals for a form
   */
  async findApprovalsByFormId(formId: string): Promise<Approval[]> {
    const approvals = await prisma.approval.findMany({
      where: { formId },
      orderBy: { level: 'asc' },
      include: { actualActor: { select: { name: true } } },
    });

    return approvals.map(a => this.mapPrismaApprovalToApproval(a));
  }
  
  /**
   * Create approval
   */
  async createApproval(data: Omit<Approval, 'id' | 'createdAt' | 'updatedAt'>): Promise<Approval> {
    const approval = await prisma.approval.create({
      data: {
        formId: data.formId,
        approverId: data.approverId,
        approverName: data.approverName,
        approverEmail: data.approverEmail,
        level: data.level,
        role: data.role,
        status: data.status as ApprovalStatus,
        decision: data.decision,
        comments: data.comments,
        approvalToken: data.approvalToken,
        tokenExpiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : undefined,
        notifiedAt: data.notifiedAt ? new Date(data.notifiedAt) : undefined,
        decidedAt: data.decidedAt ? new Date(data.decidedAt) : undefined,
        actualActorUserId: data.actualActorUserId === undefined ? undefined : data.actualActorUserId || null,
      },
      include: { actualActor: { select: { name: true } } },
    });
    
    return this.mapPrismaApprovalToApproval(approval);
  }
  
  /**
   * Update approval
   */
  async updateApproval(id: string, data: Partial<Approval>): Promise<Approval | null> {
    const updateData: any = {};
    
    if (data.approverId !== undefined) updateData.approverId = data.approverId;
    if (data.approverName !== undefined) updateData.approverName = data.approverName;
    if (data.approverEmail !== undefined) updateData.approverEmail = data.approverEmail;
    if (data.level !== undefined) updateData.level = data.level;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.status !== undefined) updateData.status = data.status as ApprovalStatus;
    if (data.decision !== undefined) updateData.decision = data.decision;
    if (data.comments !== undefined) updateData.comments = data.comments;
    if (data.approvalToken !== undefined) updateData.approvalToken = data.approvalToken || null;
    if (data.tokenExpiresAt !== undefined) updateData.tokenExpiresAt = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;
    if (data.notifiedAt !== undefined) updateData.notifiedAt = data.notifiedAt ? new Date(data.notifiedAt) : null;
    if (data.decidedAt !== undefined) updateData.decidedAt = data.decidedAt ? new Date(data.decidedAt) : null;
    if (data.actualActorUserId !== undefined) updateData.actualActorUserId = data.actualActorUserId || null;
    
    try {
      const approval = await prisma.approval.update({
        where: { id },
        data: updateData,
        include: { actualActor: { select: { name: true } } },
      });
      
      return this.mapPrismaApprovalToApproval(approval);
    } catch (error: any) {
      if (error.code === 'P2025') {
        return null; // Approval not found
      }
      throw error;
    }
  }
  
  /**
   * Delete all approvals for a form
   */
  async deleteApprovalsByFormId(formId: string): Promise<number> {
    const result = await prisma.approval.deleteMany({
      where: { formId }
    });
    
    return result.count;
  }

  /** The steps nobody has been asked to act on yet - what a route rebuild may replace. */
  async deletePendingApprovalsByFormId(formId: string): Promise<number> {
    const result = await prisma.approval.deleteMany({
      where: { formId, status: 'PENDING' }
    });
    return result.count;
  }

  /**
   * Helper: Map Prisma Approval to db.service Approval
   */
  private mapPrismaApprovalToApproval(approval: any): Approval {
    return {
      id: approval.id,
      formId: approval.formId,
      approverId: approval.approverId,
      approverName: approval.approverName,
      approverEmail: approval.approverEmail,
      actualActorUserId: approval.actualActorUserId ?? undefined,
      actualActorName: approval.actualActor?.name ?? undefined,
      level: approval.level,
      role: approval.role,
      status: approval.status as 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED',
      decision: approval.decision || undefined,
      comments: approval.comments || undefined,
      approvalToken: approval.approvalToken || undefined,
      tokenExpiresAt: approval.tokenExpiresAt?.toISOString() || undefined,
      notifiedAt: approval.notifiedAt?.toISOString() || undefined,
      decidedAt: approval.decidedAt?.toISOString() || undefined,
      createdAt: approval.createdAt.toISOString(),
      updatedAt: approval.updatedAt.toISOString(),
    };
  }

  /**
   * Find approval by token (for email-based approval)
   */
  async findApprovalByToken(token: string): Promise<Approval | null> {
    const approval = await prisma.approval.findUnique({
      where: { approvalToken: token },
      include: { actualActor: { select: { name: true } } },
    });
    
    if (!approval) return null;
    return this.mapPrismaApprovalToApproval(approval);
  }
  
  // ============================================
  // APP SETTINGS (key-value UI copy)
  // ============================================

  async getAppSetting(key: string): Promise<string | null> {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async upsertAppSetting(key: string, value: string): Promise<void> {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** How many rows the Return approval matrix holds. Used by the bulk import's safety interlock. */
  async countReturnApprovalMappings(): Promise<number> {
    return prisma.returnApprovalMapping.count();
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

