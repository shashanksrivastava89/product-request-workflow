/**
 * GET /api/user-hierarchy
 * Query params: ?requesterName=LONNIE DUNGAN&businessUnit=CDG&formType=ZSAM
 * Response: { success: true, hierarchy: { salesManager?, districtSalesManager?, ... } | null }
 *
 * ZSAM / ZNC / ZNCCLAIM: when a Data Management mapping row exists, that table is the source of truth
 * (not User FK hierarchy). See hierarchy.service.ts and approval.service.ts.
 */
import { Request, Response, NextFunction } from 'express';
import { getUserHierarchy } from '../services/hierarchy.service';
import {
  getZsamApproversForMerge,
  getZintApprovers,
  getZncApprovers,
  getZncclaimApprovers,
} from '../services/static-data.service';
import { AppError } from '../middleware/error.middleware';

export const getUserHierarchyController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requesterName, businessUnit, formType } = req.query;

    // Validate requesterName (required)
    if (!requesterName || typeof requesterName !== 'string') {
      throw new AppError('requesterName parameter is required', 400);
    }

    // Validate businessUnit if provided
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }

    // Validate formType if provided
    if (formType && !['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT'].includes(formType as string)) {
      throw new AppError('Invalid formType parameter. Must be one of: ZSAM, ZNC, ZNCCLAIM, ZINT', 400);
    }

    const bu = businessUnit as string | undefined;

    let hierarchy = await getUserHierarchy(
      requesterName as string,
      bu,
      formType as 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | undefined
    );

    // For ZSAM: zsamm_approval_mapping (bulk import) is the source of truth when present; do not fill gaps from User
    if (formType === 'ZSAM' && requesterName) {
      const zsam = await getZsamApproversForMerge(requesterName as string, bu);
      if (zsam.hasMappingRow) {
        hierarchy = {
          salesManager: zsam.approvers.salesManager ?? null,
          districtSalesManager: zsam.approvers.districtSalesManager ?? null,
          nationalSalesManager: zsam.approvers.nationalSalesManager ?? null,
          localFinanceController: zsam.approvers.localFinanceController ?? null,
          directorCommercialManager: zsam.approvers.directorCommercialManager ?? null,
          technicalManager: hierarchy?.technicalManager ?? null,
          nationalTSManager: hierarchy?.nationalTSManager ?? null,
        };
      }
    }

    // For ZNC: znc_approval_mapping is source of truth when a row exists (getUserHierarchy already enforces; keep aligned)
    if (formType === 'ZNC' && requesterName) {
      const zncApprovers = await getZncApprovers(requesterName as string, bu);
      if (zncApprovers) {
        hierarchy = {
          salesManager: zncApprovers.salesManager ?? null,
          districtSalesManager: zncApprovers.districtSalesManager ?? null,
          nationalSalesManager: zncApprovers.nationalSalesManager ?? null,
          localFinanceController: zncApprovers.localFinanceController ?? null,
          directorCommercialManager: zncApprovers.directorCommercialManager ?? null,
          technicalManager: zncApprovers.technicalManager ?? null,
          nationalTSManager: zncApprovers.nationalTSManager ?? null,
        };
      }
    }

    // For ZNCCLAIM: zncclaim row overrides same as ZNC (covers edge cases; getUserHierarchy already mapping-first)
    if (formType === 'ZNCCLAIM' && requesterName) {
      const zncclaimApprovers = await getZncclaimApprovers(requesterName as string, bu);
      if (zncclaimApprovers !== undefined) {
        hierarchy = {
          salesManager: zncclaimApprovers.salesManager ?? null,
          districtSalesManager: zncclaimApprovers.districtSalesManager ?? null,
          nationalSalesManager: zncclaimApprovers.nationalSalesManager ?? null,
          csPsManager: zncclaimApprovers.csPsManager ?? null,
          raqaManager: zncclaimApprovers.raqaManager ?? null,
          globalRaqaManager: zncclaimApprovers.globalRaqaManager ?? null,
        };
      } else {
        hierarchy = {
          salesManager: null,
          districtSalesManager: null,
          nationalSalesManager: null,
          csPsManager: null,
          raqaManager: null,
          globalRaqaManager: null,
        };
      }
    }

    // For ZINT: zint_approval_mapping is source of truth (same as ZNCCLAIM).
    if (formType === 'ZINT' && requesterName) {
      const zintApprovers = await getZintApprovers(requesterName as string, bu);
      if (zintApprovers) {
        hierarchy = {
          salesManager: zintApprovers.salesManager ?? null,
          districtSalesManager: zintApprovers.districtSalesManager ?? null,
          nationalSalesManager: zintApprovers.nationalSalesManager ?? null,
          csPsManager: zintApprovers.csPsManager ?? null,
          raqaManager: zintApprovers.raqaManager ?? null,
          globalRaqaManager: zintApprovers.globalRaqaManager ?? null,
        };
      } else {
        hierarchy = {
          salesManager: null,
          districtSalesManager: null,
          nationalSalesManager: null,
          csPsManager: null,
          raqaManager: null,
          globalRaqaManager: null,
        };
      }
    }

    res.json({
      success: true,
      hierarchy: hierarchy || null,
      found: hierarchy !== null,
    });
  } catch (error) {
    next(error);
  }
};
