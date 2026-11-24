import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthContext';
import { isCustomerSupport } from '../utils/user-roles';

const ALLOWED_PATHS = new Set(['/', '/support/requests', '/support/approved', '/pending-access', '/login']);

/** Customer support may only use home and the read-only requests list. */
export default function CustomerSupportRouteGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (isCustomerSupport(user?.role) && location.pathname === '/support/approved') {
    return <Navigate to="/support/requests" replace />;
  }

  if (isCustomerSupport(user?.role) && !ALLOWED_PATHS.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
