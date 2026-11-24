/**
 * User-specific reports (Hargadon-san approved ZNC Claim team report).
 */
import { Router } from 'express';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';
import {
  getZncClaimApprovedReportSummary,
  listZncClaimApprovedReportForms,
} from '../controllers/znc-claim-approved-report.controller';

const router = Router();

router.use(authenticate);
router.use(requireProvisionedUser);

router.get('/znc-claim-approved/summary', getZncClaimApprovedReportSummary);
router.get('/znc-claim-approved/forms', listZncClaimApprovedReportForms);

export default router;
