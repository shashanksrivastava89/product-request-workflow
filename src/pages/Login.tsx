import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthContext';
import { useI18n } from '../providers/I18nContext';
import { isAzureSsoConfigured } from '../config/authConfig';
import { consumeLastAuthErrorFromSession } from '../services/api.service';
import { isUnprovisionedSsoUser } from '../utils/sso-access';
import { clearPostLoginPath, isSafeInternalPath, peekPostLoginPath } from '../utils/postLoginRedirect';

export default function Login() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const {
        // login,
        loginWithMicrosoft,
        error: authError,
        isAuthenticated,
        isLoading: authLoading,
        user,
    } = useAuth();

    // const [email, setEmail] = useState('');
    // const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // const [showPasswordHint, setShowPasswordHint] = useState(false);

    /*
     * Where to go after signing in: the page the reader was sent to, query string included. Router
     * state covers an in-app hop; after the Microsoft redirect it is gone, and the path remembered
     * in sessionStorage by ProtectedRoute takes over. Only same-origin app paths are accepted.
     */
    const fromState = (location.state as { from?: { pathname?: string; search?: string } })?.from;
    const fromStatePath = fromState?.pathname ? `${fromState.pathname}${fromState.search ?? ''}` : '';
    const from = isSafeInternalPath(fromStatePath) ? fromStatePath : peekPostLoginPath() ?? '/';
    const ssoCallbackError = (location.state as { ssoError?: string | null })?.ssoError;
    const showMicrosoft = isAzureSsoConfigured();

    /** After bootstrap / 401, read message (on mount it may not exist yet — wait until authLoading is false). */
    useEffect(() => {
        if (authLoading) return;
        const persisted = consumeLastAuthErrorFromSession();
        if (persisted) setError(persisted);
    }, [authLoading]);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (isUnprovisionedSsoUser(user)) {
            navigate('/pending-access', { replace: true });
            return;
        }
        clearPostLoginPath();
        navigate(from, { replace: true });
    }, [isAuthenticated, from, navigate, user]);

    // const handleSubmit = async (e: FormEvent) => {
    //     e.preventDefault();
    //     setError(null);
    //     setIsLoading(true);
    //
    //     try {
    //         await login({ email, password });
    //     } catch (err: unknown) {
    //         setError((err as Error)?.message || 'Login failed');
    //     } finally {
    //         setIsLoading(false);
    //     }
    // };

    const handleMicrosoftSignIn = async () => {
        setError(null);
        setIsLoading(true);
        try {
            await loginWithMicrosoft();
        } catch (err: unknown) {
            setError((err as Error)?.message || 'Microsoft sign-in failed');
        } finally {
            // Always clear (redirect may not run if MSAL errors; avoids stuck disabled button)
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <img src="/acme-logo.svg" alt="Acme" className="h-12 mx-auto mb-6" />
                    <h2 className="text-3xl font-bold text-gray-900">{t('login.title')}</h2>
                    <p className="mt-2 text-sm text-gray-600">{t('login.subtitle')}</p>
                </div>

                <div className="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-md">
                    {(error || authError || ssoCallbackError) && (
                        <div
                            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative"
                            role="alert"
                        >
                            <span className="block sm:inline">
                                {error || authError || ssoCallbackError}
                            </span>
                        </div>
                    )}

                    {showMicrosoft && (
                        <div className="space-y-4">
                            <button
                                type="button"
                                onClick={() => void handleMicrosoftSignIn()}
                                disabled={isLoading}
                                className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-800 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 21 21" aria-hidden="true">
                                    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                                    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                                    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                                </svg>
                                {t('login.microsoft')}
                            </button>
                            {/* <p className="text-center text-xs text-gray-500">{t('login.orPassword')}</p> */}
                        </div>
                    )}

                    {/* Email + password login disabled — Microsoft SSO only
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                                    {t('login.email')}
                                </label>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                    placeholder={t('login.emailPlaceholder')}
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between">
                                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                        {t('login.password')}
                                    </label>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onMouseEnter={() => setShowPasswordHint(true)}
                                            onMouseLeave={() => setShowPasswordHint(false)}
                                            className="text-gray-400 hover:text-gray-600 focus:outline-none"
                                            aria-label="Password information"
                                        >
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                                <path
                                                    fillRule="evenodd"
                                                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                        </button>
                                        {showPasswordHint && (
                                            <div className="absolute right-0 top-8 z-10 w-48 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg">
                                                {t('login.defaultPassword')}
                                                <div className="absolute -top-1 right-2 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                    placeholder={t('login.passwordPlaceholder')}
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: isLoading ? '#999' : '#00A651',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) e.currentTarget.style.backgroundColor = '#008A44';
                                }}
                                onMouseLeave={(e) => {
                                    if (!isLoading) e.currentTarget.style.backgroundColor = '#00A651';
                                }}
                            >
                                {isLoading ? t('login.loggingIn') : t('login.submit')}
                            </button>
                        </div>
                    </form>
                    */}
                </div>
            </div>
        </div>
    );
}
