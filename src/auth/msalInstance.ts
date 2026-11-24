import { PublicClientApplication } from '@azure/msal-browser';
import { buildMsalConfiguration, isAzureSsoConfigured } from '../config/authConfig';

let instance: PublicClientApplication | null = null;

/** Singleton SPA client; null when SSO env vars are missing. */
export function getMsalInstance(): PublicClientApplication | null {
    if (!isAzureSsoConfigured()) return null;
    if (!instance) {
        instance = new PublicClientApplication(buildMsalConfiguration());
    }
    return instance;
}
