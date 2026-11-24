/**
 * Validation schemas for hierarchy management operations
 */

import { z } from 'zod';

// Hierarchy list query schema
export const hierarchyListQuerySchema = z.object({
  businessUnit: z.enum(['CDG', 'LSG']).optional(),
  role: z
    .enum([
      'REQUESTER',
      'SALES_MANAGER',
      'DISTRICT_SALES_MANAGER',
      'NATIONAL_SALES_MANAGER',
      'FINANCE_CONTROLLER',
      'DIRECTOR_COMMERCIAL',
      'ADMIN',
    ])
    .optional(),
  formType: z.enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT']).optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().min(1))
    .optional()
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().min(1).max(100))
    .optional()
    .default('20'),
  search: z.string().optional(),
  includeInactive: z
    .string()
    .transform((val) => val === 'true')
    .optional()
    .default('false'),
});

// Simple hierarchy update: name, email, and one "Reports to" (or blank)
export const updateHierarchySimpleSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  email: z.string().email('Invalid email').optional(),
  reportsToId: z.string().uuid().nullable().optional(),
});

// Update hierarchy schema (full form-type mode or simple mode)
export const updateHierarchySchema = z
  .object({
    // Simple mode
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    reportsToId: z.string().uuid().nullable().optional(),
    // Full mode
    formType: z.enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT']).optional(),
    salesManagerId: z.string().uuid().nullable().optional(),
    districtSalesManagerId: z.string().uuid().nullable().optional(),
    nationalSalesManagerId: z.string().uuid().nullable().optional(),
    localFinanceControllerId: z.string().uuid().nullable().optional(),
    directorCommercialManagerId: z.string().uuid().nullable().optional(),
    technicalManagerId: z.string().uuid().nullable().optional(),
    nationalTSManagerId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (data) => {
      // If formType is ZSAM, technicalManagerId and nationalTSManagerId should not be set
      if (data.formType === 'ZSAM') {
        return !data.technicalManagerId && !data.nationalTSManagerId;
      }
      // If formType is ZNC/ZNCCLAIM/ZINT, ZSAM-specific fields should not be set
      if (data.formType === 'ZNC' || data.formType === 'ZNCCLAIM' || data.formType === 'ZINT') {
        return (
          !data.nationalSalesManagerId &&
          !data.localFinanceControllerId &&
          !data.directorCommercialManagerId
        );
      }
      return true;
    },
    {
      message: 'Form type and hierarchy fields mismatch',
    }
  );
