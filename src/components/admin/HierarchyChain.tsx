/**
 * Hierarchy Chain Component
 * Visual representation of the approval chain
 */

import { useNavigate } from 'react-router-dom';

interface Approver {
    id: string;
    name: string;
    email: string;
}

interface HierarchyChainProps {
    user: {
        name: string;
        role: string;
    };
    hierarchy: {
        salesManager?: Approver | null;
        districtSalesManager?: Approver | null;
        nationalSalesManager?: Approver | null;
        localFinanceController?: Approver | null;
        directorCommercialManager?: Approver | null;
        technicalManager?: Approver | null;
        nationalTSManager?: Approver | null;
    };
    formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | '';
}

export default function HierarchyChain({ user, hierarchy, formType }: HierarchyChainProps) {
    const navigate = useNavigate();

    const handleApproverClick = (approverId: string) => {
        navigate(`/admin/hierarchy/user/${approverId}`);
    };

    const getRoleBadgeColor = (role: string) => {
        if (role.includes('SALES_MANAGER')) return 'bg-green-100 text-green-800 border-green-300';
        if (role.includes('DISTRICT')) return 'bg-green-100 text-green-800 border-green-300';
        if (role.includes('NATIONAL')) return 'bg-blue-100 text-blue-800 border-blue-300';
        if (role.includes('DIRECTOR')) return 'bg-purple-100 text-purple-800 border-purple-300';
        if (role.includes('FINANCE')) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
        if (role.includes('TECHNICAL')) return 'bg-indigo-100 text-indigo-800 border-indigo-300';
        return 'bg-gray-100 text-gray-800 border-gray-300';
    };

    const formatRole = (role: string) => {
        return role
            .split('_')
            .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
            .join(' ');
    };

    // Build management chain
    const managementChain = [];
    if (hierarchy.salesManager) managementChain.push({ ...hierarchy.salesManager, role: 'Sales Manager' });
    if (hierarchy.districtSalesManager) managementChain.push({ ...hierarchy.districtSalesManager, role: 'District Sales Manager' });
    if (hierarchy.nationalSalesManager) managementChain.push({ ...hierarchy.nationalSalesManager, role: 'National Sales Manager' });
    if (hierarchy.directorCommercialManager) managementChain.push({ ...hierarchy.directorCommercialManager, role: 'Director Commercial Manager' });

    // Build approval chains
    const financeChain = [];
    if (hierarchy.localFinanceController) financeChain.push({ ...hierarchy.localFinanceController, role: 'Local Finance Controller' });

    const technicalChain = [];
    if (hierarchy.technicalManager) technicalChain.push({ ...hierarchy.technicalManager, role: 'Technical Manager' });
    if (hierarchy.nationalTSManager) technicalChain.push({ ...hierarchy.nationalTSManager, role: 'National TS Manager' });

    const ArrowIcon = () => (
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
    );

    return (
        <div className="space-y-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Approval Chain</h4>

            {/* Management Chain */}
            {managementChain.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600 mb-2">Management Chain</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded-lg text-xs font-medium border border-gray-300">
                            {user.name}
                        </div>
                        {managementChain.map((approver, index) => (
                            <div key={approver.id} className="flex items-center gap-2">
                                <ArrowIcon />
                                <button
                                    onClick={() => handleApproverClick(approver.id)}
                                    className="px-3 py-1.5 bg-gradient-to-r from-green-50 to-green-100/50 text-green-800 rounded-lg text-xs font-medium border border-green-300 hover:shadow-md hover:from-green-100 hover:to-green-200 transition-all cursor-pointer"
                                    title={`${approver.name} - ${approver.email}`}
                                >
                                    {approver.name}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Finance Chain */}
            {financeChain.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600 mb-2">Finance Approval</div>
                    <div className="flex flex-wrap items-center gap-2">
                        {financeChain.map((approver) => (
                            <button
                                key={approver.id}
                                onClick={() => handleApproverClick(approver.id)}
                                className="px-3 py-1.5 bg-gradient-to-r from-yellow-50 to-yellow-100/50 text-yellow-800 rounded-lg text-xs font-medium border border-yellow-300 hover:shadow-md hover:from-yellow-100 hover:to-yellow-200 transition-all cursor-pointer"
                                title={`${approver.name} - ${approver.email}`}
                            >
                                {approver.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Technical Chain */}
            {technicalChain.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600 mb-2">Technical Approval</div>
                    <div className="flex flex-wrap items-center gap-2">
                        {technicalChain.map((approver, index) => (
                            <div key={approver.id} className="flex items-center gap-2">
                                {index > 0 && <ArrowIcon />}
                                <button
                                    onClick={() => handleApproverClick(approver.id)}
                                    className="px-3 py-1.5 bg-gradient-to-r from-indigo-50 to-indigo-100/50 text-indigo-800 rounded-lg text-xs font-medium border border-indigo-300 hover:shadow-md hover:from-indigo-100 hover:to-indigo-200 transition-all cursor-pointer"
                                    title={`${approver.name} - ${approver.email}`}
                                >
                                    {approver.name}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* No Hierarchy */}
            {managementChain.length === 0 && financeChain.length === 0 && technicalChain.length === 0 && (
                <div className="text-sm text-gray-500 italic">No hierarchy assigned</div>
            )}
        </div>
    );
}
