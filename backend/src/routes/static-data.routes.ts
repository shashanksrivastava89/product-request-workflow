import { Router } from 'express';
import { getRequesterGroups, getSalesReps, getRequesterPersonalAccounts, getZsamApproversController, getReturnApproversController, getChannelPartners, getEndUsers, getDirectDeliveryLocations, getProductCatalog, getProductCatalogExact,
  getMyRequesterScope,
  getMyReturnMatrixRoles,
} from '../controllers/static-data.controller';
import { getUserHierarchyController } from '../controllers/hierarchy.controller';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireProvisionedUser);

// GET /api/requester-groups?businessUnit=CDG
router.get('/requester-groups', getRequesterGroups);

// GET /api/sales-reps?requesterGroupId=cdg-2
router.get('/sales-reps', getSalesReps);

/** The caller's own teams and requester rows — see getMyRequesterScope. */
router.get('/my-requester-scope', getMyRequesterScope);

/** The caller's parts in the return approval matrix — see getMyReturnMatrixRoles. */
router.get('/my-return-matrix-roles', getMyReturnMatrixRoles);

// GET /api/requester-personal-accounts?formType=ZSAM&search=<name|code>&limit=50&offset=0
router.get('/requester-personal-accounts', getRequesterPersonalAccounts);

// GET /api/zsam-approvers?requesterName=LONNIE DUNGAN
router.get('/zsam-approvers', getZsamApproversController);

// GET /api/return-approvers?requesterName=DAMIAN DIGGIN&businessUnit=CDG
router.get('/return-approvers', getReturnApproversController);

// GET /api/user-hierarchy?requesterName=LONNIE DUNGAN&businessUnit=CDG&formType=ZSAM
router.get('/user-hierarchy', getUserHierarchyController);

// GET /api/channel-partners?businessUnit=CDG&codePrefix=1
router.get('/channel-partners', getChannelPartners);

// GET /api/channel-partners?businessUnit=CDG&codePrefix=1
router.get('/channel-partners', getChannelPartners);

// GET /api/end-users?businessUnit=CDG&codePrefix=8
router.get('/end-users', getEndUsers);

// GET /api/direct-delivery-locations?businessUnit=CDG&codePrefix=2
router.get('/direct-delivery-locations', getDirectDeliveryLocations);

// GET /api/product-catalog/exact?businessUnit=CDG&code=12000 - one product, never paged
router.get('/product-catalog/exact', getProductCatalogExact);

// GET /api/product-catalog?businessUnit=CDG
router.get('/product-catalog', getProductCatalog);

export default router;

