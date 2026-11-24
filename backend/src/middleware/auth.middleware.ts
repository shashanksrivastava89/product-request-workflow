import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import { prismaService } from '../services/prisma.service';
import { mapIncomingSsoEmailToDbEmail } from '../utils/sso-email-map.util';
import { hasSuperApproverPrivileges } from '../utils/auth-roles.util';
import {
    isAzureAdApiAuthConfigured,
    verifyMicrosoftIdentityToken,
} from '../utils/azure-ad-jwt.util';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
        name: string;
        isSuperApprover?: boolean;
        /** Service Admin team: may review, edit at review, and set the SAP sales order number. */
        isServiceAdmin?: boolean;
        /** Customer Service view: the read-only all-requests pages on top of the role. */
        isCustomerSupport?: boolean;
        /** Microsoft SSO OK but no row in `users` — see ALLOW_UNPROVISIONED_SSO */
        isUnprovisionedSso?: boolean;
    };
    /** How authenticate resolved the caller (for stricter routes e.g. file import). */
    authMethod?: 'jwt' | 'azure' | 'header';
    /** Set by validateImportUpload after magic-byte check */
    importFileKind?: 'xlsx' | 'csv';
    importClientFilename?: string;
}

function readHeaderEmail(req: Request): string {
    const raw = req.headers['x-user-email'];
    const s = Array.isArray(raw) ? raw[0] : raw;
    return (s || '').trim().toLowerCase();
}

function readHeaderName(req: Request): string {
    const raw = req.headers['x-user-name'];
    const s = Array.isArray(raw) ? raw[0] : raw;
    return (s || '').trim();
}

async function attachUserFromSsoEmail(
    req: AuthRequest,
    email: string,
    displayName: string | undefined,
    authMethod: 'azure' | 'header'
): Promise<void> {
    const dbEmail = mapIncomingSsoEmailToDbEmail(email);
    const user = await prismaService.findUserByEmail(dbEmail);
    const allowUnprovisioned = process.env.ALLOW_UNPROVISIONED_SSO !== 'false';
    if (!user) {
        if (allowUnprovisioned) {
            req.user = {
                id: 'unprovisioned',
                email: dbEmail,
                role: 'UNPROVISIONED',
                name: displayName || dbEmail,
                isSuperApprover: false,
                isServiceAdmin: false,
                isCustomerSupport: false,
                isUnprovisionedSso: true,
            };
            req.authMethod = authMethod;
            return;
        }
        throw new AppError(
            `No application user for "${dbEmail}" (Microsoft: "${email}"). Align users.email with your work mailbox, configure Entra optional "email" claim, or set SSO_EMAIL_MAP in backend .env.`,
            401
        );
    }
    if (!user.isActive) {
        throw new AppError(`User "${email}" is inactive.`, 401);
    }
    req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isSuperApprover: user.isSuperApprover === true,
        isServiceAdmin: user.isServiceAdmin === true,
        isCustomerSupport: user.isCustomerSupport === true,
    };
    req.authMethod = authMethod;
}

/**
 * Auth: Entra Bearer token (ID or API access token, JWKS-validated),
 * optional legacy X-User-Email when ALLOW_SSO_HEADER_AUTH is not false.
 * Password-login app JWT is disabled.
 */
export const authenticate = async (
    req: AuthRequest,
    _res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7);

            if (!isAzureAdApiAuthConfigured()) {
                return next(new AppError('Authentication requires Microsoft SSO', 401));
            }

            try {
                const identity = await verifyMicrosoftIdentityToken(token);
                await attachUserFromSsoEmail(req, identity.email, identity.name, 'azure');
                return next();
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Invalid Microsoft token';
                return next(new AppError(msg, 401));
            }
        }

        const allowHeaderAuth = process.env.ALLOW_SSO_HEADER_AUTH !== 'false';
        const email = readHeaderEmail(req);

        if (allowHeaderAuth && email.includes('@')) {
            await attachUserFromSsoEmail(req, email, readHeaderName(req) || undefined, 'header');
            return next();
        }

        throw new AppError('No token provided', 401);
    } catch (error) {
        if (error instanceof AppError) {
            return next(error);
        }
        next(error);
    }
};

/**
 * Blocks synthetic SSO users until an admin creates a matching `users` row.
 * Use after `authenticate` on routes that must not run without a real DB user.
 */
/** Admin file import: block header-only auth when SSO headers are disabled (prevents X-User-Email spoofing). */
export const requireSecureImportAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
        return next(new AppError('Unauthorized', 401));
    }

    if (process.env.ADMIN_IMPORT_REQUIRE_BEARER === 'true') {
        const authHeader = req.headers.authorization;
        if (
            !authHeader?.startsWith('Bearer ') ||
            req.authMethod !== 'azure'
        ) {
            return next(new AppError('Admin file import requires a Microsoft Bearer token', 401));
        }
        return next();
    }

    if (process.env.ALLOW_SSO_HEADER_AUTH === 'false' && req.authMethod === 'header') {
        return next(
            new AppError(
                'File import is not available with header-only authentication. Use a Bearer token or enable trusted SSO at the edge.',
                401
            )
        );
    }

    next();
};

export const requireProvisionedUser = (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (req.user?.isUnprovisionedSso) {
        return next(
            new AppError(
                'Your Microsoft account is signed in, but this application has no user profile for you yet. You cannot access data until an administrator adds your account.',
                403
            )
        );
    }
    next();
};

export const authorize = (...roles: string[]) => {
    return (req: AuthRequest, _res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(new AppError('Unauthorized', 401));
        }

        const allowed =
            roles.includes(req.user.role) ||
            (roles.includes('SUPER_APPROVER') &&
                hasSuperApproverPrivileges(req.user.role, req.user.isSuperApprover));
        if (!allowed) {
            return next(new AppError('Insufficient permissions', 403));
        }

        next();
    };
};
