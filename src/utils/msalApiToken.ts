import { InteractionRequiredAuthError, type AccountInfo, type IPublicClientApplication } from '@azure/msal-browser';
import { getMsalInstance } from '../auth/msalInstance';
import { msalApiTokenRequest } from '../config/authConfig';

/** Acquire Entra ID token for API Bearer auth (validated server-side). */
export async function acquireMicrosoftApiBearerToken(
    msalInstance?: IPublicClientApplication | null
): Promise<string | null> {
    const msal = msalInstance ?? getMsalInstance();
    if (!msal) return null;

    const account: AccountInfo | null =
        msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
    if (!account) return null;

    const trySilent = async (): Promise<string | null> => {
        const result = await msal.acquireTokenSilent({
            ...msalApiTokenRequest,
            account,
        });
        if (result.idToken?.trim()) return result.idToken;
        if (result.accessToken?.trim()) return result.accessToken;
        return null;
    };

    try {
        return await trySilent();
    } catch (e) {
        if (!(e instanceof InteractionRequiredAuthError)) {
            console.warn('acquireTokenSilent failed:', e);
            return null;
        }
    }

    try {
        const result = await msal.acquireTokenPopup({
            ...msalApiTokenRequest,
            account,
        });
        if (result.idToken?.trim()) return result.idToken;
        if (result.accessToken?.trim()) return result.accessToken;
    } catch (e) {
        console.warn('acquireTokenPopup failed:', e);
    }
    return null;
}

/** Call after MSAL redirect / before first API request in SSO mode. */
export async function ensureMicrosoftApiBearerToken(
    msalInstance?: IPublicClientApplication | null
): Promise<string | null> {
    return acquireMicrosoftApiBearerToken(msalInstance);
}
