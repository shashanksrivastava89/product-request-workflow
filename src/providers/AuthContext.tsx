import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useMemo,
    useCallback,
    ReactNode,
} from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { msalLoginRequest } from '../config/authConfig';
import { authApi, User, LoginRequest, LoginResponse, clearClientAuthSession } from '../services/api.service';
import type { AccountInfo } from '@azure/msal-browser';
import { resolveAppEmailFromMsalAccount } from '../utils/ssoEmail';
import { ensureMicrosoftApiBearerToken } from '../utils/msalApiToken';

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (credentials: LoginRequest) => Promise<void>;
    /** MSAL redirect; no-op if SSO not configured */
    loginWithMicrosoft: () => Promise<void>;
    logout: () => Promise<void>;
    /** Re-fetch profile from /auth/me (e.g. after BU change on New Application). Safe no-op if not logged in. */
    refreshUser: () => Promise<void>;
    error: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

type AuthProviderProps = {
    children: ReactNode;
    /** When set, handles MSAL redirect and Microsoft sign-out */
    msalInstance?: PublicClientApplication | null;
};

function applySsoSession(account: AccountInfo) {
    const email = resolveAppEmailFromMsalAccount(account);
    if (!email) return false;
    localStorage.setItem('auth_mode', 'sso');
    localStorage.setItem('sso_email', email);
    localStorage.setItem('sso_name', (account.name || email).trim());
    localStorage.removeItem('auth_token');
    return true;
}

export function AuthProvider({ children, msalInstance }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            setError(null);
            try {
                if (msalInstance) {
                    const redirect = await msalInstance.handleRedirectPromise();
                    if (!cancelled && redirect?.account) {
                        if (!applySsoSession(redirect.account)) {
                            if (!cancelled) setError('Microsoft account has no email (username).');
                            clearClientAuthSession();
                        } else {
                            msalInstance.setActiveAccount(redirect.account);
                            await ensureMicrosoftApiBearerToken(msalInstance);
                            const { user: currentUser } = await authApi.getMe();
                            if (!cancelled) {
                                setUser(currentUser);
                                localStorage.setItem('auth_user', JSON.stringify(currentUser));
                            }
                        }
                        return;
                    }
                }

                if (!cancelled && localStorage.getItem('auth_mode') === 'sso') {
                    const email = localStorage.getItem('sso_email');
                    if (!email) {
                        clearClientAuthSession();
                    } else {
                        if (msalInstance) {
                            const acc =
                                msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
                            if (acc) {
                                msalInstance.setActiveAccount(acc);
                            }
                            await ensureMicrosoftApiBearerToken(msalInstance);
                        }
                        try {
                            const { user: currentUser } = await authApi.getMe();
                            if (!cancelled) {
                                setUser(currentUser);
                                localStorage.setItem('auth_user', JSON.stringify(currentUser));
                            }
                            return;
                        } catch {
                            if (!cancelled) {
                                clearClientAuthSession();
                                setUser(null);
                            }
                        }
                    }
                }

                const token = localStorage.getItem('auth_token');
                if (token && localStorage.getItem('auth_mode') !== 'sso') {
                    try {
                        const { user: currentUser } = await authApi.getMe();
                        if (!cancelled) {
                            setUser(currentUser);
                            localStorage.setItem('auth_user', JSON.stringify(currentUser));
                        }
                    } catch {
                        if (!cancelled) {
                            clearClientAuthSession();
                            setUser(null);
                        }
                    }
                }
            } catch (err: unknown) {
                console.error('Auth bootstrap error:', err);
                const data = (err as { response?: { data?: { message?: string; error?: string } } })
                    ?.response?.data;
                const msg =
                    (typeof data?.error === 'string' && data.error) ||
                    (typeof data?.message === 'string' && data.message) ||
                    (err as Error)?.message ||
                    'Sign-in failed';
                if (!cancelled) setError(msg);
                clearClientAuthSession();
                setUser(null);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        bootstrap();
        return () => {
            cancelled = true;
        };
    }, [msalInstance]);

    const refreshUser = useCallback(async () => {
        const mode = localStorage.getItem('auth_mode');
        if (mode === 'sso') {
            if (!localStorage.getItem('sso_email')) return;
        } else if (!localStorage.getItem('auth_token')) {
            return;
        }
        try {
            const { user: currentUser } = await authApi.getMe();
            setUser(currentUser);
            localStorage.setItem('auth_user', JSON.stringify(currentUser));
        } catch (err) {
            console.error('refreshUser failed', err);
        }
    }, []);

    const applyLoginResponse = useCallback(async (response: LoginResponse) => {
        localStorage.setItem('auth_mode', 'jwt');
        localStorage.removeItem('sso_email');
        localStorage.removeItem('sso_name');
        localStorage.setItem('auth_token', response.token);
        localStorage.setItem('auth_user', JSON.stringify(response.user));
        setUser(response.user);
        try {
            const { user: currentUser } = await authApi.getMe();
            setUser(currentUser);
            localStorage.setItem('auth_user', JSON.stringify(currentUser));
        } catch {
            /* keep login payload */
        }
    }, []);

    const login = useCallback(
        async (credentials: LoginRequest) => {
            setError(null);
            setIsLoading(true);
            try {
                const response = await authApi.login(credentials);
                await applyLoginResponse(response);
            } catch (err: unknown) {
                const apiError = (err as { response?: { data?: { error?: string; message?: string } } })
                    ?.response?.data?.error;
                const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message;
                const errorMessage =
                    apiError ||
                    apiMessage ||
                    'Login failed. Please check your email and password.';
                setError(errorMessage);
                throw new Error(errorMessage);
            } finally {
                setIsLoading(false);
            }
        },
        [applyLoginResponse]
    );

    const loginWithMicrosoft = useCallback(async () => {
        if (!msalInstance) {
            throw new Error(
                'Microsoft sign-in is not initialized. Restart the dev server after adding VITE_AZURE_* to .env.'
            );
        }
        setError(null);
        try {
            await msalInstance.loginRedirect(msalLoginRequest);
        } catch (e) {
            console.error('MSAL loginRedirect failed:', e);
            throw e instanceof Error ? e : new Error('Microsoft sign-in could not start');
        }
    }, [msalInstance]);

    const logout = async () => {
        setIsLoading(true);
        try {
            await authApi.logout();
        } catch (err) {
            console.error('Logout error:', err);
        }
        setUser(null);
        clearClientAuthSession();

        if (msalInstance) {
            const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
            try {
                await msalInstance.logoutRedirect({
                    account: account ?? undefined,
                    postLogoutRedirectUri: `${window.location.origin}/login`,
                });
            } catch (e) {
                console.error('MSAL logout error:', e);
            }
            setIsLoading(false);
            return;
        }

        setIsLoading(false);
    };

    const value = useMemo(
        () => ({
            user,
            isAuthenticated: !!user,
            isLoading,
            login,
            loginWithMicrosoft,
            logout,
            refreshUser,
            error,
        }),
        [user, isLoading, error, refreshUser, loginWithMicrosoft, login]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
