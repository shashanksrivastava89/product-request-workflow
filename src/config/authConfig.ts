import type { Configuration, RedirectRequest } from '@azure/msal-browser';

/** True when Vite env has tenant + SPA client id (same app registration as Entra "Application ID"). */
export function isAzureSsoConfigured(): boolean {
    const id = import.meta.env.VITE_AZURE_CLIENT_ID?.trim();
    const tenant = import.meta.env.VITE_AZURE_TENANT_ID?.trim();
    return !!(id && tenant);
}

export function buildMsalConfiguration(): Configuration {
    const clientId = import.meta.env.VITE_AZURE_CLIENT_ID?.trim() ?? '';
    const tenantId = import.meta.env.VITE_AZURE_TENANT_ID?.trim() ?? '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    /** Must match a SPA redirect URI in Entra exactly. Default `/login` matches common portal entries (localhost + prod). */
    const redirect =
        import.meta.env.VITE_AZURE_REDIRECT_URI?.trim() || `${origin}/login`;
    const postLogout = `${origin}/login`;

    return {
        auth: {
            clientId,
            authority: `https://login.microsoftonline.com/${tenantId}`,
            redirectUri: redirect,
            postLogoutRedirectUri: postLogout,
        },
        cache: {
            cacheLocation: 'localStorage',
            storeAuthStateInCookie: false,
        },
    };
}

/** Initial sign-in (includes User.Read for Entra consent; not sent to Product Request API). */
export const msalLoginRequest: RedirectRequest = {
    scopes: ['openid', 'profile', 'email', 'User.Read'],
};

/** Token for backend API — openid yields an ID token (aud = client id). Optional VITE_AZURE_API_SCOPE for exposed API scope. */
function buildApiTokenScopes(): string[] {
    const custom = import.meta.env.VITE_AZURE_API_SCOPE?.trim();
    if (custom) {
        return custom.split(/[\s,]+/).filter(Boolean);
    }
    return ['openid', 'profile', 'email'];
}

export const msalApiTokenRequest: RedirectRequest = {
    scopes: buildApiTokenScopes(),
};
