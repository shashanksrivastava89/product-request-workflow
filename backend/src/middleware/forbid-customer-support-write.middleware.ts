import { Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import { AuthRequest } from './auth.middleware';
import { isCustomerSupportRole } from '../utils/auth-roles.util';

/** Blocks mutating API calls for read-only customer support accounts. */
export function forbidCustomerSupportWrites(req: AuthRequest, _res: Response, next: NextFunction) {
    if (isCustomerSupportRole(req.user?.role)) {
        return next(new AppError('Read-only access', 403));
    }
    next();
}
