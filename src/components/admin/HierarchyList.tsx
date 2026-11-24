/**
 * Hierarchy List Component
 * Displays users with their hierarchy relationships in a table
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { adminApi } from '../../services/api.service';
import { useNavigate } from 'react-router-dom';
import IconButton, { ViewIcon, EditIcon } from './IconButton';
import HierarchyChain from './HierarchyChain';

interface HierarchyUser {
    id: string;
    name: string;
    email: string;
    role: string;
    businessUnit: string | null;
    hierarchy: {
        salesManager?: { id: string; name: string; email: string } | null;
        districtSalesManager?: { id: string; name: string; email: string } | null;
        nationalSalesManager?: { id: string; name: string; email: string } | null;
        localFinanceController?: { id: string; name: string; email: string } | null;
        directorCommercialManager?: { id: string; name: string; email: string } | null;
        technicalManager?: { id: string; name: string; email: string } | null;
        nationalTSManager?: { id: string; name: string; email: string } | null;
    };
    subordinatesCount: number;
}

export default function HierarchyList() {
    const navigate = useNavigate();
    const [users, setUsers] = useState<HierarchyUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
    const [editingRowId, setEditingRowId] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [editFormData, setEditFormData] = useState<Record<string, any>>({});
    const [availableUsers, setAvailableUsers] = useState<any[]>([]);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        businessUnit: '' as '' | 'CDG' | 'LSG',
        role: '',
        formType: '' as '' | 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT',
        search: '',
    });
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
    });
    const filtersRef = useRef(filters);
    const pageRef = useRef(1);

    const loadAvailableUsers = useCallback(async (searchTerm: string = '') => {
        try {
            const response = await adminApi.getHierarchyList({
                limit: 100,
                search: searchTerm,
            });
            setAvailableUsers(response.users || []);
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }, []);

    const loadUsers = useCallback(async (append = false) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setError(null);

        try {
            const currentPage = append ? pageRef.current + 1 : 1;
            const params: any = {
                page: currentPage,
                limit: pagination.limit,
            };

            // Use filtersRef.current for append operations, but get fresh filters for new loads
            const currentFilters = append ? filtersRef.current : filters;
            if (currentFilters.businessUnit) params.businessUnit = currentFilters.businessUnit;
            if (currentFilters.role) params.role = currentFilters.role;
            if (currentFilters.formType) params.formType = currentFilters.formType;
            if (currentFilters.search) params.search = currentFilters.search;

            const response = await adminApi.getHierarchyList(params);

            if (append) {
                setUsers((prev) => [...prev, ...(response.users || [])]);
                setPagination((prev) => ({ ...prev, page: currentPage }));
                pageRef.current = currentPage;
            } else {
                setUsers(response.users || []);
                setPagination({
                    page: 1,
                    limit: response.pagination.limit,
                    total: response.pagination.total,
                    totalPages: response.pagination.totalPages,
                });
                pageRef.current = 1;
            }
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to load hierarchy');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [pagination.limit, filters]);

    const handleRowClick = (userId: string, e: React.MouseEvent) => {
        // Don't expand if clicking on action button
        if ((e.target as HTMLElement).closest('button')) {
            return;
        }
        setExpandedRowId(expandedRowId === userId ? null : userId);
    };

    const handleViewDetails = (userId: string, e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        navigate(`/admin/hierarchy/user/${userId}`);
    };

    // Update filtersRef when filters change
    useEffect(() => {
        filtersRef.current = filters;
    }, [filters]);

    useEffect(() => {
        setUsers([]);
        setPagination((prev) => ({ ...prev, page: 1 }));
        loadUsers(false);
    }, [filters.businessUnit, filters.role, filters.formType, filters.search, loadUsers]);

    // Refetch when tab becomes visible so UI reflects DB after seed/updates
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                loadUsers(false);
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [loadUsers]);

    useEffect(() => {
        if (editingRowId) {
            loadAvailableUsers();
        }
    }, [editingRowId, loadAvailableUsers]);

    // "Reports to" id by role (matches backend REPORTS_TO_FK_BY_ROLE)
    const getReportsToId = (user: HierarchyUser): string | null => {
        const h = user.hierarchy;
        const byRole: Record<string, string | null> = {
            REQUESTER: h.salesManager?.id ?? null,
            SALES_MANAGER: h.districtSalesManager?.id ?? null,
            DISTRICT_SALES_MANAGER: h.nationalSalesManager?.id ?? null,
            NATIONAL_SALES_MANAGER: h.localFinanceController?.id ?? null,
            FINANCE_CONTROLLER: h.directorCommercialManager?.id ?? null,
            DIRECTOR_COMMERCIAL: h.directorCommercialManager?.id ?? null,
            ADMIN: h.salesManager?.id ?? null,
        };
        return byRole[user.role] ?? null;
    };

    const handleEditClick = (userId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const user = users.find((u) => u.id === userId);
        if (!user) return;

        setEditingRowId(userId);
        setEditFormData((prev) => ({
            ...prev,
            [userId]: {
                name: user.name,
                email: user.email,
                reportsToId: getReportsToId(user),
            },
        }));
        loadAvailableUsers();
    };

    const handleEditIconClick = (userId: string, e?: React.MouseEvent) => {
        e?.stopPropagation(); // Prevent row expansion toggle
        
        // Expand row if not already expanded
        if (expandedRowId !== userId) {
            setExpandedRowId(userId);
        }
        
        // Create a synthetic event for handleEditClick
        const syntheticEvent = {
            stopPropagation: () => {},
        } as React.MouseEvent;
        
        // Call existing handleEditClick function
        handleEditClick(userId, syntheticEvent);
        
        // Optional: Scroll to expanded section after a short delay
        setTimeout(() => {
            const expandedRow = document.getElementById(`expanded-row-${userId}`);
            if (expandedRow) {
                expandedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100);
    };

    const handleCancelEdit = (userId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingRowId(null);
        setEditFormData((prev) => {
            const newData = { ...prev };
            delete newData[userId];
            return newData;
        });
    };

    const handleSaveEdit = async (userId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSaving(userId);
        setError(null);
        setSuccessMessage(null);

        try {
            const form = editFormData[userId] as { name?: string; email?: string; reportsToId?: string | null } | undefined;
            if (!form) {
                setError('No edit data');
                setSaving(null);
                return;
            }
            const name = (form.name ?? '').trim();
            const email = (form.email ?? '').trim();
            if (!name || !email) {
                setError('Name and email are required');
                setSaving(null);
                return;
            }

            await adminApi.updateUserHierarchy(userId, {
                name,
                email,
                reportsToId: form.reportsToId ?? null,
            });

            setSuccessMessage(`Updated ${name}`);
            setEditingRowId(null);
            await loadUsers(false);
            setEditFormData((prev) => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to update hierarchy');
        } finally {
            setSaving(null);
        }
    };

    const handleFieldSelect = (userId: string, field: string, value: string | null) => {
        setEditFormData((prev) => ({
            ...prev,
            [userId]: {
                ...prev[userId],
                [field]: value,
            },
        }));
        // Simple form (name, email, reportsToId): no client-side hierarchy validation; backend validates on save.
    };

    const formatRole = (role: string) => {
        return role
            .split('_')
            .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
            .join(' ');
    };

    const getHierarchyDisplay = (user: HierarchyUser) => {
        if (filters.formType === 'ZSAM') {
            return {
                salesManager: user.hierarchy.salesManager?.name || '-',
                districtSalesManager: user.hierarchy.districtSalesManager?.name || '-',
                nationalSalesManager: user.hierarchy.nationalSalesManager?.name || '-',
                localFinanceController: user.hierarchy.localFinanceController?.name || '-',
                directorCommercialManager: user.hierarchy.directorCommercialManager?.name || '-',
            };
        } else if (filters.formType === 'ZNC' || filters.formType === 'ZNCCLAIM' || filters.formType === 'ZINT') {
            return {
                salesManager: user.hierarchy.salesManager?.name || '-',
                districtSalesManager: user.hierarchy.districtSalesManager?.name || '-',
                technicalManager: user.hierarchy.technicalManager?.name || '-',
                nationalTSManager: user.hierarchy.nationalTSManager?.name || '-',
            };
        }
        // Show all fields if no form type filter
        return {
            salesManager: user.hierarchy.salesManager?.name || '-',
            districtSalesManager: user.hierarchy.districtSalesManager?.name || '-',
            nationalSalesManager: user.hierarchy.nationalSalesManager?.name || '-',
            localFinanceController: user.hierarchy.localFinanceController?.name || '-',
            directorCommercialManager: user.hierarchy.directorCommercialManager?.name || '-',
            technicalManager: user.hierarchy.technicalManager?.name || '-',
            nationalTSManager: user.hierarchy.nationalTSManager?.name || '-',
        };
    };

    return (
        <div className="space-y-6">
            {/* Enhanced Filters */}
            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200/60">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Business Unit
                        </label>
                        <select
                            value={filters.businessUnit}
                            onChange={(e) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    businessUnit: e.target.value as '' | 'CDG' | 'LSG',
                                }))
                            }
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">All</option>
                            <option value="CDG">CDG</option>
                            <option value="LSG">LSG</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                        <select
                            value={filters.role}
                            onChange={(e) => setFilters((prev) => ({ ...prev, role: e.target.value }))}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">All</option>
                            <option value="REQUESTER">Requester</option>
                            <option value="SALES_MANAGER">Sales Manager</option>
                            <option value="DISTRICT_SALES_MANAGER">District Sales Manager</option>
                            <option value="NATIONAL_SALES_MANAGER">National Sales Manager</option>
                            <option value="FINANCE_CONTROLLER">Finance Controller</option>
                            <option value="DIRECTOR_COMMERCIAL">Director Commercial</option>
                            <option value="ADMIN">Admin</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Form Type</label>
                        <select
                            value={filters.formType}
                            onChange={(e) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    formType: e.target.value as '' | 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT',
                                }))
                            }
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">All</option>
                            <option value="ZSAM">ZSAM</option>
                            <option value="ZNC">ZNC</option>
                            <option value="ZNCCLAIM">ZNCCLAIM</option>
                            <option value="ZINT">ZINT</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                            placeholder="Name or email..."
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Enhanced Error Message */}
            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-6 py-4 rounded-lg shadow-sm">
                    <div className="flex items-center">
                        <span className="text-xl mr-3">⚠️</span>
                        <p className="font-medium">{error}</p>
                    </div>
                </div>
            )}

            {/* Enhanced Table */}
            <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-gray-200/60">
                <table className="w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[30%]">
                                    User
                                </th>
                                {filters.formType === 'ZSAM' || !filters.formType ? (
                                    <>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                                            Sales Manager
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                                            District Sales Manager
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                                            National Sales Manager
                                        </th>
                                        {!filters.formType && (
                                            <>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                                                    Local Finance Controller
                                                </th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                                                    Director Commercial Manager
                                                </th>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[17%]">
                                            Sales Manager
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[17%]">
                                            District Sales Manager
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[17%]">
                                            Technical Manager
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[17%]">
                                            National TS Manager
                                        </th>
                                    </>
                                )}
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading && users.length === 0 ? (
                                <tr>
                                    <td colSpan={filters.formType === 'ZSAM' || !filters.formType ? (!filters.formType ? 7 : 5) : 5} className="px-6 py-12 text-center">
                                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-[#00A651]"></div>
                                        <p className="mt-3 text-sm font-medium text-gray-600">Loading...</p>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={filters.formType === 'ZSAM' || !filters.formType ? (!filters.formType ? 7 : 5) : 5} className="px-6 py-12 text-center">
                                        <div className="text-5xl mb-4">👥</div>
                                        <p className="text-gray-600 font-medium">No users found</p>
                                        <p className="text-sm text-gray-500 mt-1">Try adjusting your filters</p>
                                    </td>
                                </tr>
                            ) : (
                                users.map((user) => {
                                    const hierarchy = getHierarchyDisplay(user);
                                    const isExpanded = expandedRowId === user.id;
                                    return (
                                        <>
                                            <tr
                                                key={user.id}
                                                onClick={(e) => handleRowClick(user.id, e)}
                                                className="hover:bg-gradient-to-r hover:from-[#00A651]/5 hover:to-transparent transition-all duration-150 cursor-pointer"
                                            >
                                                <td className="px-4 py-4 overflow-hidden text-ellipsis">
                                                    <div className="flex items-center gap-2">
                                                        <svg
                                                            className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                                            fill="none"
                                                            stroke="currentColor"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                        </svg>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-medium text-gray-900 truncate" title={user.name}>
                                                                {user.name}
                                                            </div>
                                                            <div className="text-xs text-gray-500 truncate" title={user.email}>{user.email}</div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                                                                    {formatRole(user.role)}
                                                                </span>
                                                                {user.businessUnit && (
                                                                    <span className="text-xs text-gray-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                                                        {user.businessUnit}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                {filters.formType === 'ZSAM' || !filters.formType ? (
                                                    <>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {hierarchy.salesManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{hierarchy.salesManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {hierarchy.districtSalesManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{hierarchy.districtSalesManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {hierarchy.nationalSalesManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{hierarchy.nationalSalesManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {!filters.formType && (
                                                            <>
                                                                <td className="px-4 py-4 text-sm text-gray-900">
                                                                    <div className="leading-relaxed">
                                                                        {hierarchy.localFinanceController !== '-' ? (
                                                                            <div className="whitespace-normal break-normal">{hierarchy.localFinanceController}</div>
                                                                        ) : (
                                                                            <div className="text-gray-400">-</div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4 text-sm text-gray-900">
                                                                    <div className="leading-relaxed">
                                                                        {hierarchy.directorCommercialManager !== '-' ? (
                                                                            <div className="whitespace-normal break-normal">{hierarchy.directorCommercialManager}</div>
                                                                        ) : (
                                                                            <div className="text-gray-400">-</div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {hierarchy.salesManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{hierarchy.salesManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {hierarchy.districtSalesManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{hierarchy.districtSalesManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {(hierarchy as any).technicalManager && (hierarchy as any).technicalManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{(hierarchy as any).technicalManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900">
                                                            <div className="leading-relaxed">
                                                                {(hierarchy as any).nationalTSManager && (hierarchy as any).nationalTSManager !== '-' ? (
                                                                    <div className="whitespace-normal break-normal">{(hierarchy as any).nationalTSManager}</div>
                                                                ) : (
                                                                    <div className="text-gray-400">-</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </>
                                                )}
                                                <td className="px-4 py-4 whitespace-nowrap text-right overflow-hidden text-ellipsis" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end gap-2">
                                                        <IconButton
                                                            onClick={(e) => handleEditIconClick(user.id, e)}
                                                            icon={<EditIcon />}
                                                            label="Edit Hierarchy"
                                                            color="blue"
                                                        />
                                                        <IconButton
                                                            onClick={() => handleViewDetails(user.id)}
                                                            icon={<ViewIcon />}
                                                            label="View Details"
                                                            color="green"
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* Expanded Row Content */}
                                            {isExpanded && (
                                                <tr id={`expanded-row-${user.id}`} className="bg-gradient-to-r from-[#00A651]/5 to-transparent">
                                                    <td colSpan={filters.formType === 'ZSAM' || !filters.formType ? (!filters.formType ? 7 : 5) : 5} className="px-4 py-6">
                                                        <div className="bg-white rounded-lg border border-[#00A651]/20 shadow-sm p-6">
                                                            {successMessage && editingRowId === user.id && (
                                                                <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                                                                    {successMessage}
                                                                </div>
                                                            )}
                                                            {error && editingRowId === user.id && (
                                                                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                                                                    {error}
                                                                </div>
                                                            )}
                                                            {editingRowId === user.id ? (
                                                                // Simple edit: Name, Email, Reports to
                                                                <div className="space-y-6">
                                                                    <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                                                            <input
                                                                                type="text"
                                                                                value={editFormData[user.id]?.name ?? ''}
                                                                                onChange={(e) => handleFieldSelect(user.id, 'name', e.target.value)}
                                                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                                                            <input
                                                                                type="email"
                                                                                value={editFormData[user.id]?.email ?? ''}
                                                                                onChange={(e) => handleFieldSelect(user.id, 'email', e.target.value)}
                                                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
                                                                            />
                                                                        </div>
                                                                        <div className="md:col-span-2">
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Reports to</label>
                                                                            <select
                                                                                value={editFormData[user.id]?.reportsToId ?? ''}
                                                                                onChange={(e) => {
                                                                                    const v = e.target.value;
                                                                                    handleFieldSelect(user.id, 'reportsToId', v === '' ? null : v);
                                                                                }}
                                                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
                                                                            >
                                                                                <option value="">— None —</option>
                                                                                {availableUsers.filter((u) => u.id !== user.id).map((u) => (
                                                                                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                                                                        <button
                                                                            onClick={(e) => handleCancelEdit(user.id, e)}
                                                                            disabled={saving === user.id}
                                                                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => handleSaveEdit(user.id, e)}
                                                                            disabled={saving === user.id}
                                                                            title="Save name, email, and reports-to"
                                                                            className="px-4 py-2 bg-gradient-to-r from-[#00A651] to-[#008A44] text-white rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-[#00A651]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                                                        >
                                                                            {saving === user.id ? (
                                                                                <>
                                                                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                                                                    Saving...
                                                                                </>
                                                                            ) : (
                                                                                'Save Changes'
                                                                            )}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                // View Mode
                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                                    {/* User Info */}
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">User Information</h4>
                                                                        <div className="space-y-1">
                                                                            <div className="text-sm">
                                                                                <span className="font-medium text-gray-700">Name:</span>{' '}
                                                                                <span className="text-gray-900">{user.name}</span>
                                                                            </div>
                                                                            <div className="text-sm">
                                                                                <span className="font-medium text-gray-700">Email:</span>{' '}
                                                                                <span className="text-gray-900">{user.email}</span>
                                                                            </div>
                                                                            <div className="text-sm">
                                                                                <span className="font-medium text-gray-700">Role:</span>{' '}
                                                                                <span className="text-gray-900">{formatRole(user.role)}</span>
                                                                            </div>
                                                                            <div className="text-sm">
                                                                                <span className="font-medium text-gray-700">Business Unit:</span>{' '}
                                                                                <span className="text-gray-900">{user.businessUnit || '-'}</span>
                                                                            </div>
                                                                            <div className="text-sm">
                                                                                <span className="font-medium text-gray-700">Subordinates:</span>{' '}
                                                                                <span className="text-gray-900">{user.subordinatesCount}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Visual Hierarchy Chain */}
                                                                    <div className="space-y-2">
                                                                        <HierarchyChain
                                                                            user={{ name: user.name, role: user.role }}
                                                                            hierarchy={user.hierarchy}
                                                                            formType={filters.formType}
                                                                        />
                                                                    </div>

                                                                    {/* Quick Actions */}
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</h4>
                                                                        <div className="flex flex-col gap-2">
                                                                            <button
                                                                                onClick={(e) => handleEditClick(user.id, e)}
                                                                                className="px-4 py-2 bg-gradient-to-r from-[#00A651] to-[#008A44] text-white rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-[#00A651]/25 transition-all text-left"
                                                                            >
                                                                                ✏️ Edit Hierarchy
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleViewDetails(user.id)}
                                                                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-all text-left"
                                                                            >
                                                                                👁️ View Full Details →
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                {/* Enhanced Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="bg-gradient-to-r from-gray-50 to-gray-100/50 px-6 py-4 flex items-center justify-between border-t border-gray-200">
                        <div className="text-sm font-medium text-gray-700">
                            Showing page <span className="font-bold text-[#00A651]">{pagination.page}</span> of <span className="font-bold text-gray-900">{pagination.totalPages}</span> ({pagination.total} total)
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    if (pagination.page > 1) {
                                        setPagination((prev) => ({ ...prev, page: prev.page - 1 }));
                                        loadUsers(false);
                                    }
                                }}
                                disabled={pagination.page === 1 || loading}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                            >
                                Previous
                            </button>
                            <button
                                onClick={() => {
                                    if (pagination.page < pagination.totalPages) {
                                        setPagination((prev) => ({ ...prev, page: prev.page + 1 }));
                                        loadUsers(false);
                                    }
                                }}
                                disabled={pagination.page >= pagination.totalPages || loading}
                                className="px-4 py-2 bg-gradient-to-r from-[#00A651] to-[#008A44] text-white rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-[#00A651]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}

                {loadingMore && (
                    <div className="bg-gray-50 px-6 py-3 text-center text-sm text-gray-500">
                        Loading more...
                    </div>
                )}
            </div>
        </div>
    );
}
