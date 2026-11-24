import { Router } from 'express';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';
import { getPendingRequests } from '../controllers/requests.controller';

const router = Router();

router.use(authenticate);
router.use(requireProvisionedUser);
router.get('/', getPendingRequests);

export default router;


