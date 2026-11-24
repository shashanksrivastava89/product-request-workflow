/**
 * Validation schemas for admin operations
 */

import { z } from 'zod';

// Customer validation schemas
export const createCustomerSchema = z.object({
  businessGroup: z.enum(['CDG', 'LSG']),
  firstDigit: z.enum(['1', '2', '8']), // '1' = SOLD-TO, '2' = Direct Delivery, '8' = End User
  code: z.string().length(7, 'Code must be exactly 7 digits').regex(/^\d+$/, 'Code must contain only digits'),
  sapCode: z.string().min(1, 'SAP Code is required'),
  nameJp: z.string().min(1, 'Japanese name is required'),
  nameEn: z.string().min(1, 'English name is required'),
  postalCode: z.string().optional(),
  prefecture: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  code: z.string().length(7, 'Code must be exactly 7 digits').regex(/^\d+$/, 'Code must contain only digits').optional(),
  businessGroup: z.enum(['CDG', 'LSG']).optional(),
  firstDigit: z.enum(['1', '2', '8']).optional(),
});

// Product validation schemas
export const createProductSchema = z.object({
  businessGroup: z.enum(['CDG', 'LSG']),
  code: z.string().min(1, 'Product code is required'),
  sapCode: z.string().optional(), // Optional for LSG, but we'll validate in controller
  name: z.string().min(1, 'Product name is required'),
  productNameLocal: z.string().min(1, 'Product name (local) is required'),
  price: z.coerce.number().min(0, 'Price must be >= 0'),
  listPrice: z.coerce
    .number()
    .min(0, 'List price must be >= 0')
    // The master's "do not use this code" (27 Aug 2026): such a product is not in the catalogue.
    .refine((n) => n !== 0 && n !== 1, 'A list price of 0 or 1 means "do not use this code"; enter the real list price'),
  division: z.string().optional(),
  statisticsGroup: z.string().optional(),
  priceGroup: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({
  code: z.string().min(1, 'Product code is required').optional(),
  businessGroup: z.enum(['CDG', 'LSG']).optional(),
});

// User validation schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['REQUESTER', 'SALES_MANAGER', 'DISTRICT_SALES_MANAGER', 'NATIONAL_SALES_MANAGER', 'FINANCE_CONTROLLER', 'DIRECTOR_COMMERCIAL', 'ADMIN']),
  businessUnit: z.enum(['CDG', 'LSG']).optional(),
  department: z.string().optional(),
  salesRepCode: z.string().optional(),
  requesterGroupId: z.string().optional(),
  salesManager: z.string().optional(),
  districtSalesManager: z.string().optional(),
  nationalSalesManager: z.string().optional(),
  localFinanceController: z.string().optional(),
  directorCommercialManager: z.string().optional(),
});

export const updateUserSchema = createUserSchema.partial().extend({
  email: z.string().email('Invalid email address').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

// Approval schemas
export const rejectSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

export const bulkApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
});

export const bulkRejectSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
  reason: z.string().min(1, 'Rejection reason is required'),
});

// Query parameter schemas
export const listQuerySchema = z.object({
  businessGroup: z.enum(['CDG', 'LSG']).optional(),
  firstDigit: z.enum(['1', '2', '8']).optional(), // For customers only
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0)).optional(),
  search: z.string().optional(),
  includeInactive: z.string().transform(val => val === 'true').optional(), // For showing deleted records
  status: z.enum(['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
  includePending: z.string().transform(val => val === 'true').optional(),
});

/**
 * Bulk approve / reactivate. The filter mirrors listQuerySchema, but as JSON rather than query
 * strings, so the booleans are real booleans here.
 */
export const bulkProductUpdateSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('filter'),
    action: z.enum(['approve', 'activate', 'approveAndActivate']),
    expectedCount: z.number().int().min(0),
    filter: z
      .object({
        businessGroup: z.enum(['CDG', 'LSG']).optional(),
        search: z.string().optional(),
        includeInactive: z.boolean().optional(),
        status: z.enum(['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
        includePending: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    mode: z.literal('codes'),
    action: z.enum(['approve', 'activate', 'approveAndActivate']),
    expectedCount: z.number().int().min(0),
    codes: z
      .array(z.object({ businessGroup: z.enum(['CDG', 'LSG']), code: z.string().min(1) }))
      .min(1)
      .max(5000),
  }),
]);
