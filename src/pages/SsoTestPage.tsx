import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { buildMsalConfiguration, isAzureSsoConfigured, msalLoginRequest } from '../config/authConfig';

function maskId(id: string): string {
    if (id.length <= 12) return '***';
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Public page to verify Vite env + MSAL redirect without going through /login. */
export default function SsoTestPage() {
    if (!isAzureSsoConfigured()) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-10">
                <h1 className="text-2xl font-bold text-gray-900 mb-4">SSO test</h1>
                <p className="text-red-700 bg-red-50 border border-red-200 rounded p-4 mb-4">
                    MSAL is not loaded: set <code className="bg-white px-1">VITE_AZURE_TENANT_ID</code> and{' '}
                    <code className="bg-white px-1">VITE_AZURE_CLIENT_ID</code> in the project root{' '}
                    <code className="bg-white px-1">.env</code>, then <strong>restart</strong>{' '}
                    <code className="bg-white px-1">npm run dev</code>.
                </p>
                <Link to="/login" className="text-[#00A651] underline">
                    Back to login
                </Link>
            </div>
        );
    }

    return <SsoTestPageInner />;
}

function SsoTestPageInner() {
    const { instance, accounts } = useMsal();
    const [log, setLog] = useState<string[]>([]);
    const [redirectOutcome, setRedirectOutcome] = useState<string>('(pending)');
    const [busy, setBusy] = useState(false);

    const tenant = import.meta.env.VITE_AZURE_TENANT_ID?.trim() ?? '';
    const clientId = import.meta.env.VITE_AZURE_CLIENT_ID?.trim() ?? '';
    let redirectUri = '(n/a)';
    try {
        redirectUri = buildMsalConfiguration().auth.redirectUri ?? '';
    } catch {
        redirectUri = '(error reading config)';
    }

    const append = (line: string) => {
        setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)} ${line}`]);
    };

    useEffect(() => {
        instance
            .handleRedirectPromise()
            .then((res) => {
                if (res?.account) {
                    setRedirectOutcome(`OK — account: ${res.account.username ?? '?'}`);
                    append(`handleRedirectPromise: got account ${res.account.username}`);
                } else {
                    setRedirectOutcome('No redirect response (normal if you opened this page directly)');
                    append('handleRedirectPromise: null (no OAuth redirect in progress)');
                }
            })
            .catch((e: unknown) => {
                const msg = e instanceof Error ? e.message : String(e);
                setRedirectOutcome(`Error: ${msg}`);
                append(`handleRedirectPromise error: ${msg}`);
            });
    }, [instance]);

    const runLoginRedirect = async () => {
        setBusy(true);
        append('Calling loginRedirect…');
        try {
            await instance.loginRedirect(msalLoginRequest);
            append('loginRedirect promise settled (browser should navigate to Microsoft)');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            append(`loginRedirect FAILED: ${msg}`);
        } finally {
            setBusy(false);
        }
    };

    const clearMsalCache = () => {
        try {
            instance.clearCache();
            append('clearCache() done — reload page');
        } catch (e: unknown) {
            append(`clearCache error: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    return (
        <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">SSO test (MSAL)</h1>
                <p className="text-sm text-gray-600 mt-1">
                    MSAL uses <code className="bg-gray-100 px-1 rounded">{window.location.origin}/login</code> by default
                    — it must be listed under App registration → Authentication → Single-page application (your portal
                    already includes localhost and prod <code className="bg-gray-100 px-1 rounded">/login</code> URIs).
                </p>
            </div>

            <section className="bg-white border rounded-lg p-4 shadow-sm space-y-2 text-sm">
                <h2 className="font-semibold text-gray-800">Environment (Vite)</h2>
                <ul className="font-mono text-xs space-y-1 break-all">
                    <li>
                        <span className="text-gray-500">VITE_AZURE_TENANT_ID:</span> {tenant || '(empty)'}
                    </li>
                    <li>
                        <span className="text-gray-500">VITE_AZURE_CLIENT_ID:</span>{' '}
                        {clientId ? maskId(clientId) : '(empty)'}
                    </li>
                    <li>
                        <span className="text-gray-500">redirectUri (MSAL config):</span> {redirectUri}
                    </li>
                    <li>
                        <span className="text-gray-500">window.location.origin:</span> {window.location.origin}
                    </li>
                </ul>
            </section>

            <section className="bg-white border rounded-lg p-4 shadow-sm space-y-3">
                <h2 className="font-semibold text-gray-800">Redirect handler</h2>
                <p className="text-sm text-gray-700">{redirectOutcome}</p>
                <p className="text-sm text-gray-600">
                    MSAL accounts in cache: <strong>{accounts.length}</strong>
                    {accounts[0]?.username && (
                        <>
                            {' '}
                            — <span className="font-mono">{accounts[0].username}</span>
                        </>
                    )}
                </p>
            </section>

            <section className="flex flex-wrap gap-3">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runLoginRedirect()}
                    className="px-4 py-2 rounded-md bg-[#0078d4] text-white text-sm font-medium disabled:opacity-50"
                >
                    {busy ? 'Working…' : 'Start Microsoft loginRedirect'}
                </button>
                <button
                    type="button"
                    onClick={clearMsalCache}
                    className="px-4 py-2 rounded-md border border-gray-300 text-sm"
                >
                    Clear MSAL cache
                </button>
                <Link
                    to="/login"
                    className="px-4 py-2 rounded-md border border-gray-300 text-sm inline-flex items-center"
                >
                    Back to login
                </Link>
            </section>

            <section className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-xs overflow-auto max-h-64">
                <div className="text-gray-400 mb-2">Log</div>
                {log.length === 0 ? <div className="text-gray-500">(empty — click the blue button)</div> : null}
                {log.map((line, i) => (
                    <div key={i}>{line}</div>
                ))}
            </section>
        </div>
    );
}
