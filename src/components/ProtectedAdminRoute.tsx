/**
 * Admin shell: ADMIN (full data management) or SUPER_APPROVER (submitted requests + approvals only).
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../providers/AuthContext';
import { hasSuperApproverAccess } from '../utils/user-roles';
import { isUnprovisionedSsoUser } from '../utils/sso-access';

interface ProtectedAdminRouteProps {
    children: React.ReactNode;
}

function isDataMgmtRole(role: string | undefined, isSuperApprover?: boolean): boolean {
    return role === 'ADMIN' || hasSuperApproverAccess(role, isSuperApprover);
}

export default function ProtectedAdminRoute({ children }: ProtectedAdminRouteProps) {
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

    if (!isDataMgmtRole(user?.role, user?.isSuperApprover)) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
                    <p className="text-gray-600">You do not have permission to access this page.</p>
                    <a href="/" className="mt-4 inline-block text-blue-600 hover:text-blue-800">
                        Return to Home
                    </a>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
