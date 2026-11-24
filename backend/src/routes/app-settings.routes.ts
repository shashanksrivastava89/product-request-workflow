import { Router } from 'express';
import { authenticate, requireProvisionedUser } from '../middleware/auth.middleware';
import { getWizardStep2DataBanner } from '../controllers/app-settings.controller';

const router = Router();

router.get(
    '/wizard-step2-data-banner',
    authenticate,
    requireProvisionedUser,
    getWizardStep2DataBanner
);

export default router;
