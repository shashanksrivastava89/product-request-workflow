/**
 * Hierarchy User Detail Component
 * View and edit a specific user's hierarchy
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../../services/api.service';

export default function HierarchyUserDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userData, setUserData] = useState<any>(null);
    const [subordinates, setSubordinates] = useState<any[]>([]);
    const [validationIssues, setValidationIssues] = useState<any[]>([]);
    const [editMode, setEditMode] = useState(false);
    const [formData, setFormData] = useState<{ name: string; email: string; reportsToId: string | null }>({ name: '', email: '', reportsToId: null });
    const [availableUsers, setAvailableUsers] = useState<any[]>([]);

    useEffect(() => {
        if (id) {
            loadUserDetails();
        }
    }, [id]);

    const loadUserDetails = async () => {
        if (!id) return;
        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.getUserHierarchyDetails(id);
            setUserData(response.user);
            setSubordinates(response.subordinates);
            setValidationIssues(response.validationIssues);
            const u = response.user;
            const h = u.hierarchy || {};
            const reportsToByRole: Record<string, string | null> = {
                REQUESTER: h.salesManager?.id ?? null,
                SALES_MANAGER: h.districtSalesManager?.id ?? null,
                DISTRICT_SALES_MANAGER: h.nationalSalesManager?.id ?? null,
                NATIONAL_SALES_MANAGER: h.localFinanceController?.id ?? null,
                FINANCE_CONTROLLER: h.directorCommercialManager?.id ?? null,
                DIRECTOR_COMMERCIAL: h.directorCommercialManager?.id ?? null,
                ADMIN: h.salesManager?.id ?? null,
            };
            setFormData({
                name: u.name ?? '',
                email: u.email ?? '',
                reportsToId: reportsToByRole[u.role] ?? null,
            });
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to load user details');
        } finally {
            setLoading(false);
        }
    };

    const loadAvailableUsers = async (searchTerm: string = '') => {
        try {
            const response = await adminApi.getHierarchyList({
                limit: 100,
                search: searchTerm,
            });
            setAvailableUsers(response.users || []);
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    };

    useEffect(() => {
        if (editMode) {
            loadAvailableUsers();
        }
    }, [editMode]);

    const handleSave = async () => {
        if (!id) return;
        const name = (formData.name ?? '').trim();
        const email = (formData.email ?? '').trim();
        if (!name || !email) {
            setError('Name and email are required');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await adminApi.updateUserHierarchy(id, {
                name,
                email,
                reportsToId: formData.reportsToId ?? null,
            });
            setEditMode(false);
            await loadUserDetails();
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to update hierarchy');
        } finally {
            setSaving(false);
        }
    };

    const formatRole = (role: string) => {
        return role
            .split('_')
            .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
            .join(' ');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">Loading...</div>
            </div>
        );
    }

    if (!userData) {
        return (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                User not found
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <button
                        onClick={() => navigate('/admin/hierarchy')}
                        className="text-sm text-gray-600 hover:text-gray-900 mb-2"
                    >
                        ← Back to Hierarchy List
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">{userData.name}</h1>
                    <p className="text-sm text-gray-600 mt-1">{userData.email}</p>
                </div>
                {!editMode && (
                    <button
                        onClick={() => setEditMode(true)}
                        className="px-4 py-2 bg-[#00A651] text-white rounded-md hover:bg-[#008844]"
                    >
                        Edit Hierarchy
                    </button>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            )}

            {/* User Information */}
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">User Information</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium text-gray-500">Role</label>
                        <div className="text-sm text-gray-900">{formatRole(userData.role)}</div>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-500">Business Unit</label>
                        <div className="text-sm text-gray-900">{userData.businessUnit || '-'}</div>
                    </div>
                    {userData.department && (
                        <div>
                            <label className="text-sm font-medium text-gray-500">Department</label>
                            <div className="text-sm text-gray-900">{userData.department}</div>
                        </div>
                    )}
                    {userData.salesRepCode && (
                        <div>
                            <label className="text-sm font-medium text-gray-500">Sales Rep Code</label>
                            <div className="text-sm text-gray-900">{userData.salesRepCode}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Hierarchy */}
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Approval Hierarchy</h2>

                {editMode ? (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-[#00A651] focus:border-[#00A651]"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-[#00A651] focus:border-[#00A651]"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Reports to</label>
                            <select
                                value={formData.reportsToId ?? ''}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setFormData((prev) => ({ ...prev, reportsToId: v === '' ? null : v }));
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-[#00A651] focus:border-[#00A651]"
                            >
                                <option value="">— None —</option>
                                {availableUsers.filter((u) => u.id !== id).map((u) => (
                                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2 pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-4 py-2 bg-[#00A651] text-white rounded-md hover:bg-[#008844] disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                            <button
                                onClick={() => {
                                    setEditMode(false);
                                    loadUserDetails();
                                }}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {userData.hierarchy.salesManager && (
                            <HierarchyFieldDisplay
                                label="Sales Manager"
                                approver={userData.hierarchy.salesManager}
                            />
                        )}
                        {userData.hierarchy.districtSalesManager && (
                            <HierarchyFieldDisplay
                                label="District Sales Manager"
                                approver={userData.hierarchy.districtSalesManager}
                            />
                        )}
                        {userData.hierarchy.nationalSalesManager && (
                            <HierarchyFieldDisplay
                                label="National Sales Manager"
                                approver={userData.hierarchy.nationalSalesManager}
                            />
                        )}
                        {userData.hierarchy.localFinanceController && (
                            <HierarchyFieldDisplay
                                label="Local Finance Controller"
                                approver={userData.hierarchy.localFinanceController}
                            />
                        )}
                        {userData.hierarchy.directorCommercialManager && (
                            <HierarchyFieldDisplay
                                label="Director Commercial Manager"
                                approver={userData.hierarchy.directorCommercialManager}
                            />
                        )}
                        {userData.hierarchy.technicalManager && (
                            <HierarchyFieldDisplay
                                label="Technical Manager"
                                approver={userData.hierarchy.technicalManager}
                            />
                        )}
                        {userData.hierarchy.nationalTSManager && (
                            <HierarchyFieldDisplay
                                label="National TS Manager"
                                approver={userData.hierarchy.nationalTSManager}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Subordinates */}
            {subordinates.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Subordinates ({subordinates.length})
                    </h2>
                    <div className="space-y-2">
                        {subordinates.map((sub) => (
                            <div
                                key={sub.id}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                                onClick={() => navigate(`/admin/hierarchy/user/${sub.id}`)}
                            >
                                <div>
                                    <div className="font-medium text-gray-900">{sub.name}</div>
                                    <div className="text-sm text-gray-500">{sub.email}</div>
                                </div>
                                <div className="text-sm text-gray-500">{formatRole(sub.role)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Validation Issues */}
            {validationIssues.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Validation Issues</h2>
                    <div className="space-y-2">
                        {validationIssues.map((issue, index) => (
                            <div
                                key={index}
                                className={`p-3 rounded-lg ${
                                    issue.severity === 'ERROR'
                                        ? 'bg-red-50 border border-red-200'
                                        : 'bg-yellow-50 border border-yellow-200'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`text-xs font-medium px-2 py-1 rounded ${
                                            issue.severity === 'ERROR'
                                                ? 'bg-red-200 text-red-800'
                                                : 'bg-yellow-200 text-yellow-800'
                                        }`}
                                    >
                                        {issue.severity}
                                    </span>
                                    <span className="text-sm text-gray-900">{issue.field}</span>
                                </div>
                                <div className="text-sm text-gray-700 mt-1">{issue.approverName || issue.approverId}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Helper component for displaying hierarchy fields
function HierarchyFieldDisplay({ label, approver }: { label: string; approver: any }) {
    return (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
                <div className="text-sm font-medium text-gray-500">{label}</div>
                <div className="text-sm text-gray-900">{approver.name}</div>
                <div className="text-xs text-gray-500">{approver.email}</div>
            </div>
            <div className="text-xs text-gray-500">{approver.role}</div>
        </div>
    );
}

