/**
 * ADMIN-only pages (not SUPER_APPROVER).
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../providers/AuthContext';
import { isUnprovisionedSsoUser } from '../utils/sso-access';

interface ProtectedStrictAdminRouteProps {
    children: React.ReactNode;
}

export default function ProtectedStrictAdminRoute({ children }: ProtectedStrictAdminRouteProps) {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (isUnprovisionedSsoUser(user)) {
        return <Navigate to="/pending-access" replace />;
    }

    if (user?.role !== 'ADMIN') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
                    <p className="text-gray-600">You do not have permission to access this page.</p>
                    <a href="/admin/requests" className="mt-4 inline-block text-blue-600 hover:text-blue-800">
                        Submitted requests
                    </a>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
