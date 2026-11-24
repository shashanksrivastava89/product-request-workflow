import { Router } from 'express';
import {
    getPendingApprovals,
    getApprovalHistory,
    approveForm,
    rejectForm,
    reopenRejectedStep,
    dismissRejectedApproval,
    notifyApprover,
} from '../controllers/approvals.controller';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';
import { forbidCustomerSupportWrites } from '../middleware/forbid-customer-support-write.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireProvisionedUser);

router.get('/', getPendingApprovals);
router.get('/history/:formId', getApprovalHistory);
router.post('/:id/approve', forbidCustomerSupportWrites, approveForm);
router.post('/:id/reject', forbidCustomerSupportWrites, rejectForm);
router.post('/:id/reopen-rejection', forbidCustomerSupportWrites, reopenRejectedStep);
router.post('/:id/dismiss', forbidCustomerSupportWrites, dismissRejectedApproval);
router.post('/:id/notify-approver', forbidCustomerSupportWrites, notifyApprover);

export default router;
