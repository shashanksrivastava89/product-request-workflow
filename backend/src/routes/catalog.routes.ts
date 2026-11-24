import { Router } from 'express';
import {
    getProducts,
    getProductByCode,
    getChannelPartners,
    getEndUsers,
    getSalesReps
} from '../controllers/catalog.controller';
import { authenticate, authorize, requireProvisionedUser } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireProvisionedUser);

// The wizards use /api/product-catalog (paged, filtered). This pair returns the whole table with no
// filter at all, so it is kept for admins only.
router.get('/products', authorize('ADMIN'), getProducts);
router.get('/products/:code', authorize('ADMIN'), getProductByCode);
router.get('/partners/channel', getChannelPartners);
router.get('/partners/end-users', getEndUsers);
router.get('/sales-reps', getSalesReps);

export default router;
