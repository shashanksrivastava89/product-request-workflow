import { useState, useEffect } from 'react';
import { appSettingsApi, adminApi } from '../../services/api.service';

const DEFAULT_HINT = 'Data last updated on: April 1, 2026';

export default function AppSettingsPage() {
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { message: m } = await appSettingsApi.getWizardStep2DataBanner();
                if (!cancelled) setMessage(m);
            } catch {
                if (!cancelled) {
                    setMessage(DEFAULT_HINT);
                    setStatus({ ok: false, text: 'Could not load current text. Showing default; save will apply.' });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const { message: saved } = await adminApi.updateWizardStep2DataBanner(message);
            setMessage(saved);
            setStatus({ ok: true, text: 'Saved. Users will see this on the Home welcome area.' });
        } catch (e: unknown) {
            const msg =
                (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                (e as Error)?.message ||
                'Save failed';
            setStatus({ ok: false, text: msg });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">App messages</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Text shown in the light box next to the welcome title on <strong>Home</strong>. Leave empty to hide
                    the line.
                </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <label htmlFor="wizard-step2-banner" className="block text-sm font-semibold text-gray-800">
                    Home welcome banner
                </label>
                <textarea
                    id="wizard-step2-banner"
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={loading}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] disabled:bg-gray-100"
                    placeholder={DEFAULT_HINT}
                />
                <p className="text-xs text-gray-500">
                    Example: <span className="font-mono bg-gray-50 px-1 rounded">{DEFAULT_HINT}</span>
                </p>
                <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={loading || saving}
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
                {status && (
                    <p
                        className={`text-sm ${status.ok ? 'text-green-700' : 'text-red-700'}`}
                        role="status"
                    >
                        {status.text}
                    </p>
                )}
            </div>
        </div>
    );
}
