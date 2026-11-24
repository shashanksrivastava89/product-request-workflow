import { Request, Response, NextFunction } from 'express';
import { looksLikeApproverEmail } from '../utils/return-approval.util';
import { prismaService } from '../services/prisma.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import {
  getRequesterGroupsByBusinessUnit,
  getSalesRepsByRequesterGroup,
  getRequesterPersonalAccountsPaginated,
  getZsamApproversForMerge,
  getReturnApproversForMerge,
  resolveRequesterTeamName,
  resolveRequesterScope,
  getCustomersFormatted,
  getProductsByBusinessUnit,
  getProductExact,
  getReturnMatrixRolesForName,
} from '../services/static-data.service';
import { getUserHierarchy } from '../services/hierarchy.service';
import { AppError } from '../middleware/error.middleware';

/**
 * GET /api/requester-groups
 * Query params: ?businessUnit=CDG
 * Response: { success: true, groups: Array<{ id: string, name: string }>, count: number }
 */
export const getRequesterGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, formType } = req.query;

    // Validate businessUnit if provided
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }
    if (formType && typeof formType !== 'string') {
      throw new AppError('Invalid formType parameter', 400);
    }

    const groups = await getRequesterGroupsByBusinessUnit(businessUnit as string, formType as string);

    res.json({
      success: true,
      groups,
      count: groups.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sales-reps
 * Query params: ?requesterGroupId=cdg-2
 * Response: { success: true, salesReps: Array<SalesRep>, count: number }
 */
export const getSalesReps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requesterGroupId, formType } = req.query;

    // Validate requesterGroupId if provided
    if (requesterGroupId && typeof requesterGroupId !== 'string') {
      throw new AppError('Invalid requesterGroupId parameter', 400);
    }
    if (formType && typeof formType !== 'string') {
      throw new AppError('Invalid formType parameter', 400);
    }

    const salesReps = await getSalesRepsByRequesterGroup(requesterGroupId as string, formType as string);

    res.json({
      success: true,
      salesReps,
      count: salesReps.length
    });
  } catch (error) {
    console.error('[GET /api/sales-reps]', error);
    next(error);
  }
};

/**
 * GET /api/requester-personal-accounts
 * Query params: ?formType=ZSAM&search=<name|code>&limit=50&offset=0
 * Personal (sales) Sold-To / End User: active requesters (all groups) with code starting with 9.
 * `search` is required (min 1 character); matches name or code (incl. padded codes e.g. 0009002301).
 */
export const getRequesterPersonalAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requesterGroupId, formType, search, limit, offset } = req.query;

    if (formType && typeof formType !== 'string') {
      throw new AppError('Invalid formType parameter', 400);
    }

    const limitNum = limit ? parseInt(limit as string, 10) : 50;
    const offsetNum = offset ? parseInt(offset as string, 10) : 0;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new AppError('Invalid limit parameter (must be between 1 and 100)', 400);
    }
    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new AppError('Invalid offset parameter (must be >= 0)', 400);
    }

    const searchStr = search && typeof search === 'string' ? search.trim() : '';
    if (!searchStr) {
      throw new AppError('search query parameter is required', 400);
    }

    const groupId =
      requesterGroupId && typeof requesterGroupId === 'string' ? requesterGroupId.trim() : undefined;

    const result = await getRequesterPersonalAccountsPaginated(
      groupId,
      formType as string | undefined,
      { search: searchStr, limit: limitNum, offset: offsetNum }
    );

    res.json({
      success: true,
      accounts: result.accounts,
      count: result.accounts.length,
      total: result.total,
      hasMore: result.hasMore,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/zsam-approvers
 * Query params: ?requesterName=LONNIE DUNGAN&businessUnit=CDG
 * Response: { success: true, approvers: { salesManager?, districtSalesManager?, ... } | null }
 * 
 * When a zsamm row exists, approvers come only from bulk import (no User fallback for cleared fields).
 */
export const getZsamApproversController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requesterName, businessUnit } = req.query;

    // Validate requesterName if provided
    if (requesterName && typeof requesterName !== 'string') {
      throw new AppError('Invalid requesterName parameter', 400);
    }

    if (!requesterName) {
      res.json({
        success: true,
        approvers: null,
        found: false,
      });
      return;
    }

    let hierarchy = null;
    try {
      hierarchy = await getUserHierarchy(
        requesterName as string,
        businessUnit as string | undefined,
        'ZSAM'
      );
    } catch (error) {
      console.warn(`Database hierarchy lookup failed for ${requesterName}:`, error);
    }

    const zsam = await getZsamApproversForMerge(
      requesterName as string,
      businessUnit as string | undefined
    );

    let approvers: {
      salesManager: string | null;
      districtSalesManager: string | null;
      nationalSalesManager: string | null;
      localFinanceController: string | null;
      directorCommercialManager: string | null;
    } | null = null;

    if (zsam.hasMappingRow) {
      approvers = {
        salesManager: zsam.approvers.salesManager ?? null,
        districtSalesManager: zsam.approvers.districtSalesManager ?? null,
        nationalSalesManager: zsam.approvers.nationalSalesManager ?? null,
        localFinanceController: zsam.approvers.localFinanceController ?? null,
        directorCommercialManager: zsam.approvers.directorCommercialManager ?? null,
      };
    } else if (hierarchy) {
      approvers = {
        salesManager: hierarchy.salesManager ?? null,
        districtSalesManager: hierarchy.districtSalesManager ?? null,
        nationalSalesManager: hierarchy.nationalSalesManager ?? null,
        localFinanceController: hierarchy.localFinanceController ?? null,
        directorCommercialManager: hierarchy.directorCommercialManager ?? null,
      };
    }

    res.json({
      success: true,
      approvers: approvers || null,
      found: approvers !== undefined && approvers !== null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * What to call the reviewer in the route preview.
 *
 * The Reviewer column holds a shared mailbox address, and the approval rows and every email already
 * show the `users` row's name for it (see `resolveApprover` in approval.service). Reading the cell
 * verbatim here put a bare address in front of the requester where every other step shows a name.
 */
async function reviewerDisplayName(reviewer?: string | null): Promise<string | null> {
  const raw = String(reviewer ?? '').trim();
  if (!raw) return null;
  if (!looksLikeApproverEmail(raw)) return raw;
  const user = await prismaService.findUserByEmail(raw);
  return user?.name?.trim() || raw;
}

/**
 * GET /api/return-approvers
 * Query: ?requesterName=DAMIAN DIGGIN&businessUnit=CDG|LSG|SERVICE
 * Source of truth: return_approval_mapping (1st → 2nd → Final). No User hierarchy fallback.
 */
export const getReturnApproversController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requesterName, businessUnit, requesterGroup } = req.query;

    if (requesterName && typeof requesterName !== 'string') {
      throw new AppError('Invalid requesterName parameter', 400);
    }
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }
    // Optional, and the wizard sends it: the team decides which of a person's matrix rows applies,
    // so without it the preview can name a different chain from the one the submit will build.
    if (requesterGroup && typeof requesterGroup !== 'string') {
      throw new AppError('Invalid requesterGroup parameter', 400);
    }

    if (!requesterName) {
      res.json({ success: true, approvers: null, found: false });
      return;
    }

    const result = await getReturnApproversForMerge(
      requesterName as string,
      businessUnit as string | undefined,
      await resolveRequesterTeamName(requesterGroup as string | undefined)
    );

    if (!result.hasMappingRow) {
      res.json({ success: true, approvers: null, found: false });
      return;
    }

    res.json({
      success: true,
      found: true,
      approvers: {
        // The service review step. Already gated by RETURN_REVIEW_STEP_ENABLED in the service, so
        // the wizard's preview shows it exactly when the built chain will have one. Dropping it
        // here is what left a requester unaware that their request could be corrected mid-flight.
        reviewer: await reviewerDisplayName(result.approvers.reviewer),
        firstApprover: result.approvers.firstApprover ?? null,
        secondApprover: result.approvers.secondApprover ?? null,
        finalApprover: result.approvers.finalApprover ?? null,
        // Service managers (levels 4-5). The caller decides whether they apply, based on whether
        // the request is service-related.
        fourthApprover: result.approvers.fourthApprover ?? null,
        fifthApprover: result.approvers.fifthApprover ?? null,
        teamName: result.approvers.teamName ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/channel-partners
 * Query params: ?businessUnit=CDG&codePrefix=1&limit=20&offset=0&search=...
 * Response: { success: true, partners: Array<ChannelPartner>, count: number, total: number, hasMore: boolean }
 */
export const getChannelPartners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, codePrefix, limit, offset, search } = req.query;

    // Validate parameters
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }
    if (codePrefix && typeof codePrefix !== 'string') {
      throw new AppError('Invalid codePrefix parameter', 400);
    }

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit as string, 10) : 20;
    const offsetNum = offset ? parseInt(offset as string, 10) : 0;
    const searchStr = search && typeof search === 'string' ? search : undefined;

    // Validate pagination
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new AppError('Invalid limit parameter (must be between 1 and 100)', 400);
    }
    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new AppError('Invalid offset parameter (must be >= 0)', 400);
    }

    const firstDigit = codePrefix === '1' ? '1' : undefined;
    const { customers: partners, total } = await getCustomersFormatted(
      businessUnit as string,
      firstDigit,
      {
        limit: limitNum,
        offset: offsetNum,
        search: searchStr,
      }
    );

    res.json({
      success: true,
      partners,
      count: partners.length,
      total,
      hasMore: offsetNum + partners.length < total,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/end-users
 * Query params: ?businessUnit=CDG&codePrefix=8&limit=20&offset=0&search=...
 * Response: { success: true, endUsers: Array<EndUser>, count: number, total: number, hasMore: boolean }
 */
export const getEndUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, codePrefix, limit, offset, search } = req.query;

    // Validate parameters
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }
    if (codePrefix && typeof codePrefix !== 'string') {
      throw new AppError('Invalid codePrefix parameter', 400);
    }

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit as string, 10) : 20;
    const offsetNum = offset ? parseInt(offset as string, 10) : 0;
    const searchStr = search && typeof search === 'string' ? search : undefined;

    // Validate pagination
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new AppError('Invalid limit parameter (must be between 1 and 100)', 400);
    }
    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new AppError('Invalid offset parameter (must be >= 0)', 400);
    }

    const firstDigit = codePrefix === '8' ? '8' : undefined;
    const { customers: endUsers, total } = await getCustomersFormatted(
      businessUnit as string,
      firstDigit,
      {
        limit: limitNum,
        offset: offsetNum,
        search: searchStr,
      }
    );

    res.json({
      success: true,
      endUsers,
      count: endUsers.length,
      total,
      hasMore: offsetNum + endUsers.length < total,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/direct-delivery-locations
 * Query params: ?businessUnit=CDG&codePrefix=2&limit=20&offset=0&search=...
 * Response: { success: true, locations: Array<DirectDeliveryLocation>, count: number, total: number, hasMore: boolean }
 */
export const getDirectDeliveryLocations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, codePrefix, limit, offset, search } = req.query;

    // Validate parameters
    if (businessUnit && typeof businessUnit !== 'string') {
      throw new AppError('Invalid businessUnit parameter', 400);
    }
    if (codePrefix && typeof codePrefix !== 'string') {
      throw new AppError('Invalid codePrefix parameter', 400);
    }

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit as string, 10) : 20;
    const offsetNum = offset ? parseInt(offset as string, 10) : 0;
    const searchStr = search && typeof search === 'string' ? search : undefined;

    // Validate pagination
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new AppError('Invalid limit parameter (must be between 1 and 100)', 400);
    }
    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new AppError('Invalid offset parameter (must be >= 0)', 400);
    }

    // For Direct Delivery, use firstDigit = "2"
    const firstDigit = codePrefix === '2' ? '2' : undefined;
    const { customers: locations, total } = await getCustomersFormatted(
      businessUnit as string,
      firstDigit,
      {
        limit: limitNum,
        offset: offsetNum,
        search: searchStr,
      }
    );

    res.json({
      success: true,
      locations,
      count: locations.length,
      total,
      hasMore: offsetNum + locations.length < total,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/product-catalog/exact?businessUnit=CDG&code=12000
 * Response: { success: true, product } or 404. See getProductExact for why this exists.
 */
export const getProductCatalogExact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, code } = req.query;
    if (!businessUnit || typeof businessUnit !== 'string') {
      throw new AppError('businessUnit parameter is required', 400);
    }
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new AppError('code parameter is required', 400);
    }
    const product = await getProductExact(businessUnit, code);
    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/product-catalog
 * Query params: ?businessUnit=CDG&limit=20&offset=0&search=...
 * Response: { success: true, products: Array<Product>, count: number, total: number, hasMore: boolean }
 */
export const getProductCatalog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { businessUnit, limit, offset, search } = req.query;

    // Validate businessUnit (required)
    if (!businessUnit || typeof businessUnit !== 'string') {
      throw new AppError('businessUnit parameter is required', 400);
    }

    // Parse pagination parameters
    const limitNum = limit ? parseInt(limit as string, 10) : 20; // Default: 20
    const offsetNum = offset ? parseInt(offset as string, 10) : 0; // Default: 0
    const searchStr = search && typeof search === 'string' ? search : undefined;

    // Validate pagination
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new AppError('Invalid limit parameter (must be between 1 and 100)', 400);
    }
    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new AppError('Invalid offset parameter (must be >= 0)', 400);
    }

    const { products, total } = await getProductsByBusinessUnit(
      businessUnit as string,
      {
        limit: limitNum,
        offset: offsetNum,
        search: searchStr,
      }
    );

    res.json({
      success: true,
      products,
      count: products.length,
      total,
      hasMore: offsetNum + products.length < total,
    });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/static-data/my-requester-scope
 *
 * Which teams and requester rows belong to the caller. The Return wizard uses this instead of
 * `users.requesterGroupId` + `users.salesRepCode`, neither of which can express a person who
 * belongs to more than one team or who has no sales rep code.
 *
 * Always describes the caller — it takes no parameters, so one signed-in user cannot inspect
 * another's scope.
 */
/** The caller's parts in the return approval matrix - see getReturnMatrixRolesForName. */
export const getMyReturnMatrixRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthRequest).user;
    if (!user?.id) throw new AppError('Not authenticated', 401);
    res.json(await getReturnMatrixRolesForName(user.name));
  } catch (error) {
    next(error);
  }
};

export const getMyRequesterScope = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthRequest).user;
    if (!user?.id) throw new AppError('Not authenticated', 401);
    const scope = await resolveRequesterScope(user.id);
    res.json(scope);
  } catch (error) {
    next(error);
  }
};
