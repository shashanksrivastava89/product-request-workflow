import { useAuth } from '../providers/AuthContext';
import { useI18n } from '../providers/I18nContext';

/**
 * Shown when the user signed in with Microsoft but has no application profile yet.
 */
export default function PendingAccessPage() {
    const { user, logout } = useAuth();
    const { t } = useI18n();

    return (
        <div className="max-w-lg mx-auto px-6 py-16">
            <h1 className="text-2xl font-semibold text-gray-900 mb-3">{t('pendingAccess.title')}</h1>
            <p className="text-gray-600 mb-2">{t('pendingAccess.body')}</p>
            {user?.email && (
                <p className="text-sm text-gray-500 mb-6">
                    {t('pendingAccess.signedInAs')} <strong className="text-gray-800">{user.email}</strong>
                </p>
            )}
            <p className="text-sm text-gray-600 mb-4">{t('pendingAccess.contact')}</p>
            <p className="text-xs text-gray-500 mb-8">{t('pendingAccess.adminHint')}</p>
            <button
                type="button"
                onClick={() => void logout()}
                className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
            >
                {t('app.logout')}
            </button>
        </div>
    );
}
