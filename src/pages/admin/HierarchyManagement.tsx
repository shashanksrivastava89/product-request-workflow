/**
 * Hierarchy Management Page
 * View and manage user approval hierarchies
 */

import { Link } from 'react-router-dom';
import HierarchyList from '../../components/admin/HierarchyList';
// import HierarchyTree from '../../components/admin/HierarchyTree';
// import HierarchyValidation from '../../components/admin/HierarchyValidation';

export default function HierarchyManagement() {

    return (
        <div className="space-y-6">
            {/* Enhanced Header */}
            <div className="relative bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl shadow-xl p-6 border border-gray-200/60 overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="relative">
                    <h1 className="text-3xl font-bold text-gray-900 mb-1">Hierarchy Management</h1>
                    <p className="text-sm text-gray-600">
                        The approval chain recorded on each <strong>user</strong> account — their sales
                        manager, district and national manager, finance controller and commercial director.
                    </p>
                    {/*
                      * Why there is no Return / Credit option in the form-type filter below.
                      *
                      * This screen shows the per-user hierarchy on the `users` table. The four sample
                      * flows fall back to it when a requester has no row in their mapping table. A
                      * return never does: its chain comes only from the Return approval matrix, and
                      * a blank cell there means "no approver at that step", not "look at the user".
                      * An empty Return tab here would have been the wrong answer to a fair question.
                      */}
                    <p className="mt-3 text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <strong>Sample Ordering only.</strong> ZSAM, ZNC, ZNC Claim and ZINT use this as a
                        fallback when a requester has no row in their mapping table. Return / Credit does
                        not use it at all — a return&apos;s chain comes only from{' '}
                        <Link
                            to="/admin/approval-mappings?formType=return"
                            className="text-[#00A651] font-semibold hover:underline"
                        >
                            Approval mappings → Return
                        </Link>
                        , where a blank cell means no approver at that step.
                    </p>
                </div>
            </div>

            {/* Hierarchy List Content */}
            <div className="mt-6">
                <HierarchyList />
            </div>
        </div>
    );
}
