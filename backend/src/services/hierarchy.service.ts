/**
 * Hierarchy Service
 * Provides unified hierarchy lookup from database for all form types
 */

import { PrismaClient } from '@prisma/client';
import { getHierarchyName } from '../utils/hierarchy.util';
import { getZintApprovers, getZncApprovers, getZncclaimApprovers } from './static-data.service';

const prisma = new PrismaClient();

export interface UserHierarchy {
  salesManager?: string | null;
  districtSalesManager?: string | null;
  nationalSalesManager?: string | null;
  localFinanceController?: string | null;
  directorCommercialManager?: string | null;
  technicalManager?: string | null;
  nationalTSManager?: string | null;
  /** ZINT only */
  csPsManager?: string | null;
  raqaManager?: string | null;
  globalRaqaManager?: string | null;
}

/**
 * Get user hierarchy from database
 * Supports all form types: ZSAM, ZNC, ZNCCLAIM, ZINT
 * Uses business unit to handle duplicate names correctly
 * 
 * @param requesterName - Name of the requester/user
 * @param businessUnit - Business unit (CDG or LSG) - required for duplicate names
 * @param formType - Form type to determine which hierarchy fields to return
 * @returns Hierarchy object with appropriate fields based on form type
 */
export async function getUserHierarchy(
  requesterName: string,
  businessUnit?: string,
  formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'
): Promise<UserHierarchy | null> {
  if (!requesterName) return null;

  // Find user by name (case-insensitive)
  const user = await prisma.user.findFirst({
    where: {
      name: {
        equals: requesterName,
        mode: 'insensitive',
      },
      // If business unit provided, use it to filter (handles duplicate names)
      ...(businessUnit ? { businessUnit } : {}),
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

  if (!user) {
    // No User account: try form-type-specific mapping tables
    if (formType === 'ZNC') {
      const znc = await getZncApprovers(requesterName, businessUnit);
      if (znc) {
        return {
          salesManager: znc.salesManager ?? null,
          districtSalesManager: znc.districtSalesManager ?? null,
          nationalSalesManager: znc.nationalSalesManager ?? null,
          technicalManager: znc.technicalManager ?? null,
          nationalTSManager: znc.nationalTSManager ?? null,
          localFinanceController: znc.localFinanceController ?? null,
          directorCommercialManager: znc.directorCommercialManager ?? null,
        };
      }
    }
    if (formType === 'ZNCCLAIM') {
      const zncclaim = await getZncclaimApprovers(requesterName, businessUnit);
      if (zncclaim !== undefined) {
        return {
          salesManager: zncclaim.salesManager ?? null,
          districtSalesManager: zncclaim.districtSalesManager ?? null,
          nationalSalesManager: zncclaim.nationalSalesManager ?? null,
          csPsManager: zncclaim.csPsManager ?? null,
          raqaManager: zncclaim.raqaManager ?? null,
          globalRaqaManager: zncclaim.globalRaqaManager ?? null,
        };
      }
      return {
        salesManager: null,
        districtSalesManager: null,
        nationalSalesManager: null,
        csPsManager: null,
        raqaManager: null,
        globalRaqaManager: null,
      };
    }
    if (formType === 'ZINT') {
      const zint = await getZintApprovers(requesterName, businessUnit);
      if (zint) {
        return {
          salesManager: zint.salesManager ?? null,
          districtSalesManager: zint.districtSalesManager ?? null,
          nationalSalesManager: zint.nationalSalesManager ?? null,
          csPsManager: zint.csPsManager ?? null,
          raqaManager: zint.raqaManager ?? null,
          globalRaqaManager: zint.globalRaqaManager ?? null,
        };
      }
      return {
        salesManager: null,
        districtSalesManager: null,
        nationalSalesManager: null,
        csPsManager: null,
        raqaManager: null,
        globalRaqaManager: null,
      };
    }
    return null;
  }

  // Build hierarchy object with all fields
  const hierarchy: UserHierarchy = {
    salesManager: getHierarchyName(user as any, 'salesManager'),
    districtSalesManager: getHierarchyName(user as any, 'districtSalesManager'),
    nationalSalesManager: getHierarchyName(user as any, 'nationalSalesManager'),
    localFinanceController: getHierarchyName(user as any, 'localFinanceController'),
    directorCommercialManager: getHierarchyName(user as any, 'directorCommercialManager'),
    technicalManager: getHierarchyName(user as any, 'technicalManager'),
    nationalTSManager: getHierarchyName(user as any, 'nationalTSManager'),
  };

  // Filter based on form type if specified
  if (formType === 'ZSAM') {
    // ZSAM uses: Sales Manager, District Sales Manager, National Sales Manager, Local Finance Controller, Director Commercial Manager
    return {
      salesManager: hierarchy.salesManager,
      districtSalesManager: hierarchy.districtSalesManager,
      nationalSalesManager: hierarchy.nationalSalesManager,
      localFinanceController: hierarchy.localFinanceController,
      directorCommercialManager: hierarchy.directorCommercialManager,
    };
  } else if (formType === 'ZNC') {
    // ZNC (Installation): Data Management row in znc_approval_mapping is source of truth when present (no User FK fill-in).
    const zncApprovers = await getZncApprovers(requesterName, businessUnit);
    if (zncApprovers !== undefined) {
      return {
        salesManager: zncApprovers.salesManager ?? null,
        districtSalesManager: zncApprovers.districtSalesManager ?? null,
        nationalSalesManager: zncApprovers.nationalSalesManager ?? null,
        technicalManager: zncApprovers.technicalManager ?? null,
        nationalTSManager: zncApprovers.nationalTSManager ?? null,
        localFinanceController: zncApprovers.localFinanceController ?? null,
        directorCommercialManager: zncApprovers.directorCommercialManager ?? null,
      };
    }
    return {
      salesManager: hierarchy.salesManager ?? null,
      districtSalesManager: hierarchy.districtSalesManager ?? null,
      nationalSalesManager: hierarchy.nationalSalesManager ?? null,
      technicalManager: hierarchy.technicalManager ?? null,
      nationalTSManager: hierarchy.nationalTSManager ?? null,
      localFinanceController: hierarchy.localFinanceController ?? null,
      directorCommercialManager: hierarchy.directorCommercialManager ?? null,
    };
  } else if (formType === 'ZNCCLAIM') {
    // ZNCCLAIM: Data Management row in zncclaim_approval_mapping is source of truth when present (no User FK fill-in).
    const zncclaimApprovers = await getZncclaimApprovers(requesterName, businessUnit);
    if (zncclaimApprovers !== undefined) {
      return {
        salesManager: zncclaimApprovers.salesManager ?? null,
        districtSalesManager: zncclaimApprovers.districtSalesManager ?? null,
        nationalSalesManager: zncclaimApprovers.nationalSalesManager ?? null,
        csPsManager: zncclaimApprovers.csPsManager ?? null,
        raqaManager: zncclaimApprovers.raqaManager ?? null,
        globalRaqaManager: zncclaimApprovers.globalRaqaManager ?? null,
      };
    }
    // No zncclaim_approval_mapping row: do not fall back to User FK (would inject e.g. org-wide NSM).
    return {
      salesManager: null,
      districtSalesManager: null,
      nationalSalesManager: null,
      csPsManager: null,
      raqaManager: null,
      globalRaqaManager: null,
    };
  } else if (formType === 'ZINT') {
    // ZINT: zint_approval_mapping (bulk import) is source of truth when present.
    const zintApprovers = await getZintApprovers(requesterName, businessUnit);
    if (zintApprovers) {
      return {
        salesManager: zintApprovers.salesManager ?? null,
        districtSalesManager: zintApprovers.districtSalesManager ?? null,
        nationalSalesManager: zintApprovers.nationalSalesManager ?? null,
        csPsManager: zintApprovers.csPsManager ?? null,
        raqaManager: zintApprovers.raqaManager ?? null,
        globalRaqaManager: zintApprovers.globalRaqaManager ?? null,
      };
    }
    return {
      salesManager: null,
      districtSalesManager: null,
      nationalSalesManager: null,
      csPsManager: null,
      raqaManager: null,
      globalRaqaManager: null,
    };
  }

  // Return all fields if form type not specified
  return hierarchy;
}
