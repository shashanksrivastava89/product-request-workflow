/**
 * Customer Management Page
 * List, create, edit, and manage customers
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { adminApi, AdminCustomer, CreateCustomerData } from '../../services/api.service';
import StatusBadge from '../../components/admin/StatusBadge';
import CustomerForm from '../../components/admin/CustomerForm';
import ChangeHistory from '../../components/admin/ChangeHistory';
import DeleteConfirmationModal from '../../components/admin/DeleteConfirmationModal';
import IconButton, { EditIcon, HistoryIcon, DeactivateIcon } from '../../components/admin/IconButton';
import { AdminToast, useToast } from '../../hooks/useToast';

type ViewMode = 'list' | 'create' | 'edit';

type CustomerExportType = 'all' | 'sold-to' | 'direct-delivery' | 'ship-to';

const CUSTOMER_EXPORT_OPTIONS: { type: CustomerExportType; label: string }[] = [
    { type: 'all', label: 'Export All' },
    { type: 'sold-to', label: 'Export SOLD-TO' },
    { type: 'direct-delivery', label: 'Export Direct Delivery' },
    { type: 'ship-to', label: 'Export Ship-to' },
];

export default function CustomerManagement() {
    const { toast, showToast, clearToast } = useToast();
    const [customers, setCustomers] = useState<AdminCustomer[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomer | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [customerToDelete, setCustomerToDelete] = useState<AdminCustomer | null>(null);
    const [filters, setFilters] = useState({
        businessGroup: '',
        firstDigit: '',
        search: '',
        status: '',
    });
    const [hasMore, setHasMore] = useState(true);
    const [total, setTotal] = useState(0);
    const [currentOffset, setCurrentOffset] = useState(0);
    const [exportingType, setExportingType] = useState<CustomerExportType | null>(null);
    const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);
    const filtersRef = useRef(filters);
    const currentOffsetRef = useRef(0);

    // Keep refs in sync
    useEffect(() => {
        filtersRef.current = filters;
        currentOffsetRef.current = currentOffset;
    }, [filters, currentOffset]);

    useEffect(() => {
        if (viewMode === 'list') {
            // Reset and load from beginning when filters change
            setCustomers([]);
            setCurrentOffset(0);
            setHasMore(true);
            loadCustomers(false);
        }
    }, [viewMode]);

    // Separate effect for filter changes to reset and reload
    useEffect(() => {
        if (viewMode === 'list') {
            setCustomers([]);
            setCurrentOffset(0);
            setHasMore(true);
            loadCustomers(false);
        }
    }, [filters.businessGroup, filters.firstDigit, filters.search, filters.status]);

    const loadCustomers = useCallback(async (append = false) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setError(null);
        try {
            const params: any = {
                limit: 50,
                offset: append ? currentOffsetRef.current : 0,
            };
            const currentFilters = filtersRef.current;
            if (currentFilters.businessGroup) params.businessGroup = currentFilters.businessGroup;
            if (currentFilters.firstDigit) params.firstDigit = currentFilters.firstDigit;
            if (currentFilters.search) params.search = currentFilters.search;
            if (currentFilters.status === 'ALL') {
                params.status = 'ALL';
            } else if (currentFilters.status) {
                params.status = currentFilters.status;
            } else {
                params.includePending = false; // Default to approved only
            }

            const response = await adminApi.getCustomers(params);
            
            if (append) {
                setCustomers(prev => [...prev, ...(response.customers || [])]);
                setCurrentOffset(prev => {
                    const newOffset = prev + (response.customers?.length || 0);
                    currentOffsetRef.current = newOffset;
                    return newOffset;
                });
            } else {
                setCustomers(response.customers || []);
                const newOffset = response.customers?.length || 0;
                setCurrentOffset(newOffset);
                currentOffsetRef.current = newOffset;
            }
            
            setTotal(response.total || 0);
            setHasMore(response.hasMore || false);
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to load customers');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    // Refetch when tab becomes visible so UI reflects DB after seed/updates
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible' && viewMode === 'list') {
                loadCustomers(false);
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [viewMode, loadCustomers]);

    // Scroll detection for infinite scroll
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            const distanceFromBottom = documentHeight - (scrollTop + windowHeight);
            
            if (distanceFromBottom < 100 && hasMore && !loadingMore && !loading && viewMode === 'list') {
                loadCustomers(true); // Append mode
            }
        };
        
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [hasMore, loadingMore, loading, viewMode, loadCustomers]);

    const handleCreate = async (data: CreateCustomerData) => {
        setLoading(true);
        try {
            await adminApi.createCustomer(data);
            const typeLabel =
                data.firstDigit === '1' ? 'SOLD-TO' : data.firstDigit === '8' ? 'End User' : 'Ship-to';
            const message = `${typeLabel} customer ${data.code} (${data.businessGroup}) was created successfully.`;
            showToast(message, 'success');
            setViewMode('list');
            setCustomers([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadCustomers(false);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (data: CreateCustomerData) => {
        if (!selectedCustomer) return;
        setLoading(true);
        try {
            await adminApi.updateCustomer(selectedCustomer.id, data);
            const typeLabel =
                data.firstDigit === '1' ? 'SOLD-TO' : data.firstDigit === '8' ? 'End User' : 'Ship-to';
            const message = `${typeLabel} customer ${data.code} (${data.businessGroup}) was updated successfully.`;
            showToast(message, 'success');
            setViewMode('list');
            setSelectedCustomer(null);
            setCustomers([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadCustomers(false);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteClick = (customer: AdminCustomer) => {
        setCustomerToDelete(customer);
        setShowDeleteModal(true);
    };

    const handleDeleteConfirm = async (reason?: string) => {
        if (!customerToDelete) return;
        
        try {
            setLoading(true);
            await adminApi.deleteCustomer(customerToDelete.id, reason);
            setCustomers([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadCustomers(false);
            setShowDeleteModal(false);
            setCustomerToDelete(null);
        } catch (err: any) {
            throw err; // Let the modal handle the error display
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (customer: AdminCustomer) => {
        if (customer.status === 'REJECTED') {
            alert('Rejected customers cannot be edited. Please deactivate and create a new one.');
            return;
        }
        setSelectedCustomer(customer);
        setViewMode('edit');
    };

    const resetFilters = () => {
        setFilters({ businessGroup: '', firstDigit: '', search: '', status: '' });
        setCustomers([]);
        setCurrentOffset(0);
        setHasMore(true);
    };

    const handleExportMaster = async (customerType: CustomerExportType) => {
        setExportingType(customerType);
        setExportStatus(null);
        try {
            const blob = await adminApi.exportCustomerMaster(customerType, 'xlsx');
            const date = new Date().toISOString().slice(0, 10);
            const slug = customerType === 'all' ? 'all-customers' : `customers-${customerType}`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${slug}-${date}.xlsx`;
            a.click();
            URL.revokeObjectURL(a.href);
            const label =
                CUSTOMER_EXPORT_OPTIONS.find((o) => o.type === customerType)?.label ?? 'Customer export';
            setExportStatus({ ok: true, text: `${label} downloaded.` });
        } catch (err: any) {
            setExportStatus({
                ok: false,
                text:
                    err.response?.data?.error ||
                    err.response?.data?.message ||
                    err.message ||
                    'Export failed.',
            });
        } finally {
            setExportingType(null);
        }
    };

    if (viewMode === 'create' || viewMode === 'edit') {
        return (
            <div className="max-w-4xl mx-auto">
                <AdminToast toast={toast} onDismiss={clearToast} />
                <div className="mb-6">
                    <button
                        onClick={() => {
                            setViewMode('list');
                            setSelectedCustomer(null);
                        }}
                        className="text-sm text-gray-600 hover:text-gray-900 mb-4"
                    >
                        ← Back to List
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {viewMode === 'create' ? 'Create Customer' : 'Edit Customer'}
                    </h1>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <CustomerForm
                        customer={selectedCustomer}
                        onSubmit={viewMode === 'create' ? handleCreate : handleUpdate}
                        onCancel={() => {
                            setViewMode('list');
                            setSelectedCustomer(null);
                        }}
                        isLoading={loading}
                        onNotify={showToast}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full">
            <AdminToast toast={toast} onDismiss={clearToast} />
            {/* Enhanced Header */}
            <div className="relative bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl shadow-xl p-6 mb-6 border border-gray-200/60 overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-1">Customer Management</h1>
                        <p className="text-sm text-gray-600">Manage customer data (SOLD-TO, Direct Delivery, End Users)</p>
                        {exportStatus && (
                            <p className={`mt-2 text-sm ${exportStatus.ok ? 'text-green-700' : 'text-red-700'}`}>
                                {exportStatus.text}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {CUSTOMER_EXPORT_OPTIONS.map(({ type, label }) => (
                            <button
                                key={type}
                                type="button"
                                disabled={exportingType !== null}
                                onClick={() => void handleExportMaster(type)}
                                className="px-4 py-2.5 border border-gray-300 bg-white text-gray-800 rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-offset-2 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                            >
                                {exportingType === type ? 'Exporting…' : label}
                            </button>
                        ))}
                        <button
                            onClick={() => setViewMode('create')}
                            className="px-6 py-3 bg-gradient-to-r from-[#00A651] to-[#008A44] text-white rounded-xl hover:shadow-lg hover:shadow-[#00A651]/25 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-offset-2 transition-all duration-200 font-semibold text-sm"
                        >
                            <span className="flex items-center gap-2">
                                <span className="text-lg">+</span>
                                <span>Create Customer</span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Enhanced Filters */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-gray-200/60">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Business Group</label>
                        <select
                            value={filters.businessGroup}
                            onChange={(e) => {
                                setFilters({ ...filters, businessGroup: e.target.value });
                            }}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">All</option>
                            <option value="CDG">CDG</option>
                            <option value="LSG">LSG</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Customer Type</label>
                        <select
                            value={filters.firstDigit}
                            onChange={(e) => {
                                setFilters({ ...filters, firstDigit: e.target.value });
                            }}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">All</option>
                            <option value="1">SOLD-TO</option>
                            <option value="2">Direct Delivery</option>
                            <option value="8">End User</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                        <select
                            value={filters.status}
                            onChange={(e) => {
                                setFilters({ ...filters, status: e.target.value });
                            }}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-white"
                        >
                            <option value="">Approved Only</option>
                            <option value="ALL">All</option>
                            <option value="PENDING_APPROVAL">Pending Approval</option>
                            <option value="APPROVED">Approved</option>
                            <option value="REJECTED">Rejected</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(e) => {
                                setFilters({ ...filters, search: e.target.value });
                            }}
                            placeholder="Code, Name..."
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all"
                        />
                    </div>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-200">
                    <button
                        onClick={resetFilters}
                        className="text-sm font-medium text-gray-600 hover:text-[#00A651] transition-colors"
                    >
                        Clear Filters
                    </button>
                </div>
            </div>

            {/* Enhanced Error Message */}
            {error && (
                <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg shadow-sm">
                    <div className="flex items-center">
                        <span className="text-xl mr-3">⚠️</span>
                        <p className="text-sm font-medium text-red-800">{error}</p>
                    </div>
                </div>
            )}

            {/* Enhanced Loading State */}
            {loading && customers.length === 0 && (
                <div className="text-center py-16 bg-white rounded-xl shadow-lg border border-gray-200/60">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#00A651]"></div>
                    <p className="mt-4 text-sm font-medium text-gray-600">Loading customers...</p>
                </div>
            )}

            {/* Enhanced Empty State */}
            {!loading && customers.length === 0 && (
                <div className="text-center py-16 bg-white rounded-xl shadow-lg border border-gray-200/60">
                    <div className="text-5xl mb-4">👥</div>
                    <p className="text-gray-600 font-medium">No customers found</p>
                    <p className="text-sm text-gray-500 mt-1">Try adjusting your filters</p>
                </div>
            )}

            {/* Enhanced Total Count */}
            {total > 0 && (
                <div className="mb-4 px-4 py-2 bg-gradient-to-r from-[#00A651]/5 to-transparent rounded-lg border border-[#00A651]/10">
                    <p className="text-sm font-medium text-gray-700">
                        Showing <span className="font-bold text-[#00A651]">{customers.length}</span> of <span className="font-bold text-gray-900">{total}</span> customers
                    </p>
                </div>
            )}

            {/* Enhanced Customers Table */}
            {customers.length > 0 && (
                <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-200/60">
                    <table className="w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
                            <tr>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Code</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[28%]">Name</th>
                                <th className="hidden lg:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[25%]">Name (EN)</th>
                                <th className="hidden md:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Business Group</th>
                                <th className="hidden sm:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[13%]">Type</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Status</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {customers.map((customer) => {
                                const customerType = customer.firstDigit === '1' ? 'SOLD-TO' : customer.firstDigit === '2' ? 'Direct Delivery' : 'End User';
                                return (
                                    <tr key={customer.id} className="hover:bg-gradient-to-r hover:from-[#00A651]/5 hover:to-transparent transition-all duration-150">
                                        {/* Code with Business Group on 2nd line */}
                                        <td className="px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                            <div className="text-sm font-semibold text-gray-900 truncate" title={customer.code}>
                                                {customer.code}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate" title={customer.businessGroup}>
                                                {customer.businessGroup}
                                            </div>
                                        </td>
                                        {/* Name (JP) with Type on 2nd line */}
                                        <td className="px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                            <div className="text-sm font-semibold text-gray-900 truncate" title={customer.nameJp}>
                                                {customer.nameJp}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate" title={customerType}>
                                                {customerType}
                                            </div>
                                        </td>
                                        {/* Name (EN) */}
                                        <td className="hidden lg:table-cell px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                            {customer.nameEn ? (
                                                <div className="text-sm text-gray-500 truncate" title={customer.nameEn}>
                                                    {customer.nameEn}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                        {/* Business Group - hidden on smaller screens since it's now in Code column */}
                                        <td className="hidden md:table-cell px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-sm text-gray-500 overflow-hidden text-ellipsis">
                                            {customer.businessGroup}
                                        </td>
                                        {/* Type - hidden on smaller screens since it's now in Name column */}
                                        <td className="hidden sm:table-cell px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-sm text-gray-500 overflow-hidden text-ellipsis">
                                            {customerType}
                                        </td>
                                        <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap">
                                            <StatusBadge status={customer.status} />
                                        </td>
                                        {/* Icon-based Actions */}
                                        <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-right">
                                            <div className="flex justify-end gap-1">
                                                <IconButton
                                                    onClick={() => handleEdit(customer)}
                                                    icon={<EditIcon />}
                                                    label="Edit"
                                                    color="green"
                                                />
                                                <IconButton
                                                    onClick={() => {
                                                        setHistoryRecordId(customer.id);
                                                        setShowHistory(true);
                                                    }}
                                                    icon={<HistoryIcon />}
                                                    label="History"
                                                    color="blue"
                                                />
                                                <IconButton
                                                    onClick={() => handleDeleteClick(customer)}
                                                    icon={<DeactivateIcon />}
                                                    label="Deactivate"
                                                    color="red"
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Enhanced Loading More Indicator */}
            {loadingMore && (
                <div className="text-center py-6 bg-white rounded-xl shadow-lg border border-gray-200/60 mt-4">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-[#00A651]"></div>
                    <p className="mt-3 text-sm font-medium text-gray-600">Loading more customers...</p>
                </div>
            )}

            {/* Enhanced End of List Indicator */}
            {!hasMore && customers.length > 0 && (
                <div className="text-center py-4 px-4 bg-gradient-to-r from-[#00A651]/5 to-transparent rounded-lg border border-[#00A651]/10 mt-4">
                    <p className="text-sm font-medium text-gray-600">
                        Showing all <span className="font-bold text-[#00A651]">{total}</span> records
                    </p>
                </div>
            )}

            {/* Change History Modal */}
            {showHistory && historyRecordId && (
                <ChangeHistory
                    recordId={historyRecordId}
                    recordType="customer"
                    onClose={() => {
                        setShowHistory(false);
                        setHistoryRecordId(null);
                    }}
                    onRollback={() => {
                        loadCustomers(false);
                    }}
                />
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && customerToDelete && (
                <DeleteConfirmationModal
                    isOpen={showDeleteModal}
                    recordType="customer"
                    recordName={customerToDelete.nameJp}
                    recordCode={customerToDelete.code}
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => {
                        setShowDeleteModal(false);
                        setCustomerToDelete(null);
                    }}
                    isLoading={loading}
                />
            )}
        </div>
    );
}
