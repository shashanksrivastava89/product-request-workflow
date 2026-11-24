import { Router, Request, Response } from 'express';
import { getMe, logout } from '../controllers/auth.controller';
// import { login, register, authCheck } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

/** Password login / public register removed — return 404 before other /api routers handle the path. */
const passwordLoginDisabled = (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Password login is disabled. Use Microsoft SSO.',
  });
};

router.post('/login', passwordLoginDisabled);
router.post('/register', passwordLoginDisabled);
// router.get('/check', authCheck);
router.get('/me', authenticate, getMe);
router.post('/logout', authenticate, logout);

export default router;
