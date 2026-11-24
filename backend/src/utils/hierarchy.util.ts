/**
 * Hierarchy Utility Functions
 * Handles backward compatibility between string and foreign key fields
 */

import { User } from '@prisma/client';

export interface HierarchyData {
  salesManager?: string | { id: string; name: string; email: string } | null;
  districtSalesManager?: string | { id: string; name: string; email: string } | null;
  nationalSalesManager?: string | { id: string; name: string; email: string } | null;
  localFinanceController?: string | { id: string; name: string; email: string } | null;
  directorCommercialManager?: string | { id: string; name: string; email: string } | null;
}

export interface HierarchyUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Get hierarchy name from User record (supports both old and new format)
 */
export function getHierarchyName(
  user: User & {
    salesManagerRelation?: User | null;
    districtSalesManagerRelation?: User | null;
    nationalSalesManagerRelation?: User | null;
    localFinanceControllerRelation?: User | null;
    directorCommercialManagerRelation?: User | null;
    technicalManagerRelation?: User | null;
    nationalTSManagerRelation?: User | null;
  },
  field: 'salesManager' | 'districtSalesManager' | 'nationalSalesManager' | 'localFinanceController' | 'directorCommercialManager' | 'technicalManager' | 'nationalTSManager'
): string | null {
  // Try to get from relation first (new format)
  const relationField = field === 'salesManager' ? 'salesManagerRelation' :
                       field === 'districtSalesManager' ? 'districtSalesManagerRelation' :
                       field === 'nationalSalesManager' ? 'nationalSalesManagerRelation' :
                       field === 'localFinanceController' ? 'localFinanceControllerRelation' :
                       field === 'directorCommercialManager' ? 'directorCommercialManagerRelation' :
                       field === 'technicalManager' ? 'technicalManagerRelation' :
                       'nationalTSManagerRelation';
  
  const relation = (user as any)[relationField];
  if (relation && typeof relation === 'object' && relation.name) {
    return relation.name;
  }
  
  // Fallback to string field (old format)
  const stringField = field === 'salesManager' ? 'salesManager' :
                      field === 'districtSalesManager' ? 'districtSalesManager' :
                      field === 'nationalSalesManager' ? 'nationalSalesManager' :
                      field === 'localFinanceController' ? 'localFinanceController' :
                      field === 'directorCommercialManager' ? 'directorCommercialManager' :
                      field === 'technicalManager' ? 'technicalManager' :
                      'nationalTSManager';
  
  return (user as any)[stringField] || null;
}

/**
 * Get hierarchy user object from User record (supports both old and new format)
 */
export function getHierarchyUser(
  user: User & {
    salesManagerRelation?: User | null;
    districtSalesManagerRelation?: User | null;
    nationalSalesManagerRelation?: User | null;
    localFinanceControllerRelation?: User | null;
    directorCommercialManagerRelation?: User | null;
    technicalManagerRelation?: User | null;
    nationalTSManagerRelation?: User | null;
  },
  field: 'salesManager' | 'districtSalesManager' | 'nationalSalesManager' | 'localFinanceController' | 'directorCommercialManager' | 'technicalManager' | 'nationalTSManager'
): HierarchyUser | null {
  // Try to get from relation first (new format)
  const relationField = field === 'salesManager' ? 'salesManagerRelation' :
                       field === 'districtSalesManager' ? 'districtSalesManagerRelation' :
                       field === 'nationalSalesManager' ? 'nationalSalesManagerRelation' :
                       field === 'localFinanceController' ? 'localFinanceControllerRelation' :
                       field === 'directorCommercialManager' ? 'directorCommercialManagerRelation' :
                       field === 'technicalManager' ? 'technicalManagerRelation' :
                       'nationalTSManagerRelation';
  
  const relation = (user as any)[relationField];
  if (relation && typeof relation === 'object' && relation.id) {
    return {
      id: relation.id,
      name: relation.name || '',
      email: relation.email || '',
    };
  }
  
  // Fallback to string field (old format) - return null as we don't have ID
  const stringField = field === 'salesManager' ? 'salesManager' :
                      field === 'districtSalesManager' ? 'districtSalesManager' :
                      field === 'nationalSalesManager' ? 'nationalSalesManager' :
                      field === 'localFinanceController' ? 'localFinanceController' :
                      field === 'directorCommercialManager' ? 'directorCommercialManager' :
                      field === 'technicalManager' ? 'technicalManager' :
                      'nationalTSManager';
  
  const name = (user as any)[stringField];
  if (!name) return null;
  
  // Return partial object (no ID available)
  return {
    id: '',
    name: name,
    email: '',
  };
}

/**
 * Normalize hierarchy data for API responses
 * Returns object format with id, name, email
 */
export function normalizeHierarchyForResponse(
  user: User & {
    salesManagerRelation?: User | null;
    districtSalesManagerRelation?: User | null;
    nationalSalesManagerRelation?: User | null;
    localFinanceControllerRelation?: User | null;
    directorCommercialManagerRelation?: User | null;
    technicalManagerRelation?: User | null;
    nationalTSManagerRelation?: User | null;
  }
): HierarchyData {
  const userAny = user as any;
  return {
    salesManager: userAny.salesManagerId || user.salesManager
      ? {
          id: userAny.salesManagerId || '',
          name: getHierarchyName(user, 'salesManager') || '',
          email: user.salesManagerRelation?.email || '',
        }
      : null,
    districtSalesManager: userAny.districtSalesManagerId || user.districtSalesManager
      ? {
          id: userAny.districtSalesManagerId || '',
          name: getHierarchyName(user, 'districtSalesManager') || '',
          email: user.districtSalesManagerRelation?.email || '',
        }
      : null,
    nationalSalesManager: userAny.nationalSalesManagerId || user.nationalSalesManager
      ? {
          id: userAny.nationalSalesManagerId || '',
          name: getHierarchyName(user, 'nationalSalesManager') || '',
          email: user.nationalSalesManagerRelation?.email || '',
        }
      : null,
    localFinanceController: userAny.localFinanceControllerId || user.localFinanceController
      ? {
          id: userAny.localFinanceControllerId || '',
          name: getHierarchyName(user, 'localFinanceController') || '',
          email: user.localFinanceControllerRelation?.email || '',
        }
      : null,
    directorCommercialManager: userAny.directorCommercialManagerId || user.directorCommercialManager
      ? {
          id: userAny.directorCommercialManagerId || '',
          name: getHierarchyName(user, 'directorCommercialManager') || '',
          email: user.directorCommercialManagerRelation?.email || '',
        }
      : null,
  };
}

/**
 * Extract name from hierarchy field (supports both string and object formats)
 */
export function extractHierarchyName(
  field: string | { id: string; name: string } | null | undefined
): string | null {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field.name) return field.name;
  return null;
}

/**
 * Extract ID from hierarchy field (supports both string and object formats)
 */
export function extractHierarchyId(
  field: string | { id: string; name: string } | null | undefined
): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field.id) return field.id;
  return null;
}
