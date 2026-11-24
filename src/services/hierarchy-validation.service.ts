/**
 * Hierarchy Validation Service
 * Client-side validation for hierarchy editing
 */

import { adminApi } from './api.service';

export interface ValidationResult {
    valid: boolean;
    message?: string;
    severity: 'ERROR' | 'WARNING';
}

export interface FieldValidation {
    field: string;
    valid: boolean;
    message?: string;
    severity: 'ERROR' | 'WARNING';
}

// Role hierarchy levels
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

// Allowed roles for each hierarchy field
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
export function validateApproverRole(
    approver: { id: string; role: string; isActive?: boolean } | null,
    field: string
): ValidationResult {
    if (!approver) {
        return { valid: true, severity: 'WARNING' };
    }

    if (approver.isActive === false) {
        return {
            valid: false,
            message: 'User is inactive and cannot be assigned as approver',
            severity: 'ERROR',
        };
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
export function checkBusinessUnitCompatibility(
    requester: { businessUnit: string | null },
    approver: { businessUnit: string | null; role: string } | null,
    field: string
): ValidationResult {
    if (!approver) {
        return { valid: true, severity: 'WARNING' };
    }

    // Same BU - always compatible
    if (requester.businessUnit === approver.businessUnit) {
        return { valid: true, severity: 'WARNING' };
    }

    // Cross-BU exceptions
    const crossBURoles = ['DIRECTOR_COMMERCIAL', 'NATIONAL_SALES_MANAGER', 'FINANCE_CONTROLLER', 'TECHNICAL_MANAGER', 'NATIONAL_TS_MANAGER'];
    if (crossBURoles.includes(approver.role)) {
        return { valid: true, severity: 'WARNING' };
    }

    // Same level approvers - warning
    const requesterLevel = 0; // Assume requester is at base level
    const approverLevel = ROLE_LEVELS[approver.role] || 0;
    
    if (approverLevel <= requesterLevel + 1) {
        return {
            valid: true,
            message: `Different business unit (${requester.businessUnit || 'N/A'} → ${approver.businessUnit || 'N/A'}). Allowed but not recommended.`,
            severity: 'WARNING',
        };
    }

    return { valid: true, severity: 'WARNING' };
}

/**
 * Filter users by role for a specific field.
 * Preserves full user shape (id, name, email, businessUnit, isActive, etc.)
 */
export function filterUsersByRole<T extends { role: string }>(users: T[], field: string): T[] {
    const allowedRoles = FIELD_ALLOWED_ROLES[field] || [];
    if (allowedRoles.length === 0) {
        return users;
    }
    return users.filter((user) => allowedRoles.includes(user.role));
}

/**
 * Validate entire hierarchy (server-side)
 */
export async function validateHierarchy(
    userId: string,
    formData: Record<string, string | null>,
    formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'
): Promise<{
    valid: boolean;
    errors: Array<{ field: string; type: string; message: string; severity: 'ERROR' | 'WARNING' }>;
    warnings: Array<{ field: string; type: string; message: string }>;
}> {
    try {
        const response = await adminApi.validateHierarchy(userId, {
            formType,
            ...formData,
        });
        return response.validation;
    } catch (error: any) {
        console.error('Validation error:', error);
        return {
            valid: false,
            errors: [{ field: 'general', type: 'VALIDATION_ERROR', message: error.message || 'Validation failed', severity: 'ERROR' }],
            warnings: [],
        };
    }
}
