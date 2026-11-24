/**
 * Admin Layout Component
 * Sidebar navigation for admin pages with modern design
 */

import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../providers/AuthContext';
import { hasSuperApproverAccess } from '../../utils/user-roles';

const ALL_NAV_ITEMS = [
    { path: '/admin/requests', label: 'Submitted requests', icon: '📑', description: 'All sample requests & filters', superOk: true },
    { path: '/admin/app-settings', label: 'App messages', icon: '💬', description: 'Wizard step 2 banner text', superOk: false },
    { path: '/admin/customers', label: 'Customers', icon: '👥', description: 'Manage customer data', superOk: false },
    { path: '/admin/products', label: 'Products', icon: '📦', description: 'Manage product catalog', superOk: false },
    { path: '/admin/hierarchy', label: 'Hierarchy', icon: '🔗', description: 'User approval hierarchies', superOk: false },
    { path: '/admin/users', label: 'Users', icon: '👤', description: 'Administrators & bulk import', superOk: false },
    { path: '/admin/requesters', label: 'Requesters', icon: '📇', description: 'Groups & requesters (step 1)', superOk: false },
    { path: '/admin/change-history', label: 'Change History', icon: '📋', description: 'View all changes', superOk: false },
    { path: '/admin/bulk-import', label: 'Bulk import', icon: '📤', description: 'Upload Excel/CSV', superOk: false },
    { path: '/admin/product-reconciliation', label: 'Product master sync', icon: '🔄', description: 'Preview & apply the Power BI export', superOk: false },
    { path: '/admin/customer-reconciliation', label: 'Customer reconciliation', icon: '🔄', description: 'Disable removed customers', superOk: false },
    { path: '/admin/approval-mappings', label: 'Approval mappings', icon: '📊', description: 'ZSAM / ZNC / ZINT chains', superOk: false },
] as const;

export default function AdminLayout() {
    const location = useLocation();
    const { user } = useAuth();
    const restrictToSuperNav =
        hasSuperApproverAccess(user?.role, user?.isSuperApprover) && user?.role !== 'ADMIN';
    const navItems = restrictToSuperNav ? ALL_NAV_ITEMS.filter((i) => i.superOk) : [...ALL_NAV_ITEMS];

    const isActive = (path: string) => {
        return location.pathname === path || location.pathname.startsWith(path + '/');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-50 to-gray-100 overflow-x-hidden">
            <div className="flex">
                {/* Fixed Sidebar */}
                <aside className="fixed left-0 top-0 h-screen w-72 bg-gradient-to-b from-white via-white to-gray-50 border-r border-gray-200/60 shadow-lg overflow-y-auto z-10">
                    {/* Header with gradient */}
                    <div className="relative p-6 border-b border-gray-200/60 bg-gradient-to-r from-[#00A651]/5 via-transparent to-transparent overflow-hidden sticky top-0 bg-white z-20">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#00A651]/10 to-transparent rounded-full blur-2xl"></div>
                        <div className="relative">
                            <h2 className="text-xl font-bold text-gray-900 mb-1">Data Management</h2>
                            <p className="text-xs text-gray-500">Centralized data administration</p>
                        </div>
                    </div>
                    
                    {/* Navigation */}
                    <nav className="p-4 space-y-2">
                        {navItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`
                                    group relative flex items-start gap-4 px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-200
                                    ${
                                        isActive(item.path)
                                            ? 'bg-gradient-to-r from-[#00A651]/10 to-[#00A651]/5 text-[#00A651] shadow-md shadow-[#00A651]/10 border-2 border-[#00A651]/30'
                                            : 'text-gray-700 hover:bg-gray-50/80 hover:shadow-sm border-2 border-transparent'
                                    }
                                `}
                            >
                                <span className={`text-xl transition-transform ${isActive(item.path) ? 'scale-110' : 'group-hover:scale-110'}`}>
                                    {item.icon}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className={`font-semibold ${isActive(item.path) ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                        {item.label}
                                    </div>
                                    <div className={`text-xs mt-0.5 ${isActive(item.path) ? 'text-[#00A651]/70' : 'text-gray-500'}`}>
                                        {item.description}
                                    </div>
                                </div>
                                {isActive(item.path) && (
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-[#00A651] rounded-full"></div>
                                )}
                            </Link>
                        ))}
                    </nav>
                </aside>

                {/* Main Content with margin for fixed sidebar */}
                <main className="flex-1 ml-72 min-h-screen overflow-x-hidden">
                    <div className="p-6 lg:p-8 max-w-full">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
