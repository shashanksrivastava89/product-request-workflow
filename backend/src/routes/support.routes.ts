/**
 * Customer support routes — read-only sample requests (all statuses).
 */
import { Router, Response, NextFunction } from 'express';
import { authenticate, requireProvisionedUser, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { hasCustomerSupportView } from '../utils/auth-roles.util';
import {
  getSupportForm,
  getSupportFormsSummary,
  listSupportForms,
} from '../controllers/support-forms.controller';

const router = Router();

router.use(authenticate);
router.use(requireProvisionedUser);
// The CUSTOMER_SUPPORT role, or any role carrying the Customer Service view flag.
router.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError('Unauthorized', 401));
  if (!hasCustomerSupportView(req.user.role, req.user.isCustomerSupport)) {
    return next(new AppError('Insufficient permissions', 403));
  }
  next();
});

router.get('/forms/summary', getSupportFormsSummary);
router.get('/forms', listSupportForms);
router.get('/forms/:id', getSupportForm);

export default router;
