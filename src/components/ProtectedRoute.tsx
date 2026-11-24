import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthContext';
import { isUnprovisionedSsoUser } from '../utils/sso-access';
import { rememberPostLoginPath } from '../utils/postLoginRedirect';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, user } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
                    <p className="mt-4 text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        // Redirect to login page, but save the attempted location - in router state for an in-app
        // hop, and in sessionStorage, because the Microsoft sign-in redirect discards router state
        // and a mail link's ?expand= is what opens the right request.
        rememberPostLoginPath(`${location.pathname}${location.search}`);
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    const pending = isUnprovisionedSsoUser(user);
    if (pending && location.pathname !== '/pending-access') {
        return <Navigate to="/pending-access" replace />;
    }
    if (!pending && location.pathname === '/pending-access') {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}
