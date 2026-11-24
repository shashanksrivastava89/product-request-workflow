import { Router } from 'express';
import { sendDemoEmail } from '../controllers/test.controller';

const router = Router();

router.post('/email', sendDemoEmail);

export default router;
