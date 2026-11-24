/**
 * Validate Microsoft Entra ID tokens (ID token or access token for this app).
 * Rejects Graph-only tokens (aud = Microsoft Graph).
 */
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { JwksClient } from 'jwks-rsa';
import { emailFromMicrosoftTokenClaims } from './sso-email-from-claims.util';

const GRAPH_AUDIENCES = new Set([
    '00000000-0000-4000-8000-ed48ce6a9279',
    'https://graph.microsoft.com',
    'https://graph.microsoft.us',
]);

export type VerifiedMicrosoftIdentity = {
    email: string;
    name?: string;
    oid?: string;
};

function getTenantId(): string {
    return (process.env.AZURE_TENANT_ID || '').trim();
}

function getClientId(): string {
    return (process.env.AZURE_CLIENT_ID || '').trim();
}

export function isAzureAdApiAuthConfigured(): boolean {
    return !!(getTenantId() && getClientId());
}

function allowedAudiences(): string[] {
    const clientId = getClientId();
    const extra = (process.env.AZURE_API_AUDIENCE || '').trim();
    const set = new Set<string>([clientId, `api://${clientId}`]);
    if (extra) {
        for (const a of extra.split(',')) {
            const t = a.trim();
            if (t) set.add(t);
        }
    }
    return [...set];
}

function allowedIssuers(tenantId: string): string[] {
    return [
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
        `https://sts.windows.net/${tenantId}/`,
    ];
}

let jwks: JwksClient | null = null;

function getJwksClient(tenantId: string) {
    if (!jwks) {
        jwks = jwksClient({
            jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
            cache: true,
            rateLimit: true,
        });
    }
    return jwks;
}

function getSigningKey(tenantId: string, kid: string): Promise<string> {
    return new Promise((resolve, reject) => {
        getJwksClient(tenantId).getSigningKey(kid, (err, key) => {
            if (err) return reject(err);
            const pub = key?.getPublicKey();
            if (!pub) return reject(new Error('No signing key'));
            resolve(pub);
        });
    });
}

function decodePayloadUnsafe(token: string): jwt.JwtPayload | null {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.payload) return null;
    return decoded.payload as jwt.JwtPayload;
}

function isGraphToken(payload: jwt.JwtPayload): boolean {
    const aud = payload.aud;
    if (typeof aud === 'string') return GRAPH_AUDIENCES.has(aud);
    if (Array.isArray(aud)) return aud.some((a) => GRAPH_AUDIENCES.has(String(a)));
    return false;
}

export async function verifyMicrosoftIdentityToken(
    token: string
): Promise<VerifiedMicrosoftIdentity> {
    if (!isAzureAdApiAuthConfigured()) {
        throw new Error('Azure AD API auth is not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID)');
    }

    const tenantId = getTenantId();
    const header = jwt.decode(token, { complete: true });
    if (!header || typeof header === 'string' || !header.header.kid) {
        throw new Error('Invalid token format');
    }

    const pre = decodePayloadUnsafe(token);
    if (!pre) throw new Error('Invalid token payload');
    if (isGraphToken(pre)) {
        throw new Error('Microsoft Graph tokens cannot be used for API authentication');
    }

    const signingKey = await getSigningKey(tenantId, header.header.kid);
    const audiences = allowedAudiences();
    const issuers = allowedIssuers(tenantId);

    let payload: jwt.JwtPayload | undefined;
    let lastErr: Error | undefined;
    for (const issuer of issuers) {
        for (const audience of audiences) {
            try {
                payload = jwt.verify(token, signingKey, {
                    algorithms: ['RS256'],
                    audience,
                    issuer,
                    clockTolerance: 60,
                }) as jwt.JwtPayload;
                break;
            } catch (e) {
                lastErr = e instanceof Error ? e : new Error(String(e));
            }
        }
        if (payload) break;
    }

    if (!payload) {
        throw lastErr ?? new Error('Token validation failed');
    }

    const email = emailFromMicrosoftTokenClaims(payload as Record<string, unknown>);
    if (!email) {
        throw new Error('Token has no usable email claim');
    }

    const name =
        (typeof payload.name === 'string' && payload.name.trim()) ||
        (typeof payload.given_name === 'string' ? payload.given_name : undefined);

    return {
        email,
        name,
        oid: typeof payload.oid === 'string' ? payload.oid : undefined,
    };
}
