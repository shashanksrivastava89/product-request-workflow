/**
 * Product Management Page
 * List, create, edit, and manage products
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { adminApi, AdminProduct, CreateProductData, productSyncApi } from '../../services/api.service';
import StatusBadge from '../../components/admin/StatusBadge';
import ProductForm from '../../components/admin/ProductForm';
import ChangeHistory from '../../components/admin/ChangeHistory';
import DeleteConfirmationModal from '../../components/admin/DeleteConfirmationModal';
import IconButton, { EditIcon, HistoryIcon, DeactivateIcon } from '../../components/admin/IconButton';
import { AdminToast, useToast } from '../../hooks/useToast';

type ViewMode = 'list' | 'create' | 'edit';

/**
 * The filter the grid is showing, in the shape both the list call and the bulk action send.
 *
 * Deliberately one function: the grid lazy-loads, so a bulk action has to be expressed as "every
 * row matching this filter" rather than "the rows currently in the browser". If these two call
 * sites could drift apart, the confirmation count and the rows actually changed would drift with
 * them — which is the one failure this feature must not have.
 */
export function buildProductFilter(f: {
    businessGroup?: string;
    search?: string;
    status?: string;
    includeInactive?: boolean;
}): {
    businessGroup?: 'CDG' | 'LSG';
    search?: string;
    includeInactive?: boolean;
    status?: 'ALL' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    includePending?: boolean;
} {
    const out: any = {};
    if (f.businessGroup) out.businessGroup = f.businessGroup;
    if (f.search) out.search = f.search;
    if (f.includeInactive) out.includeInactive = true;
    if (f.status === 'ALL') {
        out.status = 'ALL';
    } else if (f.status) {
        out.status = f.status;
    } else {
        out.includePending = false; // Default: approved only
    }
    return out;
}

export default function ProductManagement() {
    const { toast, showToast, clearToast } = useToast();
    const [products, setProducts] = useState<AdminProduct[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [productToDelete, setProductToDelete] = useState<AdminProduct | null>(null);
    const [filters, setFilters] = useState({
        businessGroup: '',
        search: '',
        includeInactive: false,
        status: '',
    });
    const [hasMore, setHasMore] = useState(true);
    const [total, setTotal] = useState(0);
    /** Bulk approve / reactivate across the whole filter, not just the rows loaded so far. */
    const [bulkAction, setBulkAction] = useState<'approve' | 'activate' | 'approveAndActivate' | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkResult, setBulkResult] = useState<string | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [currentOffset, setCurrentOffset] = useState(0);
    const [exporting, setExporting] = useState(false);
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
            // Reset and load from beginning when view mode changes
            setProducts([]);
            setCurrentOffset(0);
            setHasMore(true);
            loadProducts(false);
        }
    }, [viewMode]);

    // Separate effect for filter changes to reset and reload
    useEffect(() => {
        if (viewMode === 'list') {
            setProducts([]);
            setCurrentOffset(0);
            setHasMore(true);
            loadProducts(false);
        }
    }, [filters.businessGroup, filters.search, filters.status, filters.includeInactive]);

    const loadProducts = useCallback(async (append = false) => {
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
                ...buildProductFilter(filtersRef.current),
            };

            const response = await adminApi.getProducts(params);
            
            if (append) {
                setProducts(prev => [...prev, ...(response.products || [])]);
                setCurrentOffset(prev => {
                    const newOffset = prev + (response.products?.length || 0);
                    currentOffsetRef.current = newOffset;
                    return newOffset;
                });
            } else {
                setProducts(response.products || []);
                const newOffset = response.products?.length || 0;
                setCurrentOffset(newOffset);
                currentOffsetRef.current = newOffset;
            }
            
            setTotal(response.total || 0);
            setHasMore(response.hasMore || false);
        } catch (err: any) {
            setError(err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to load products');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    // Refetch when tab becomes visible so UI reflects DB after seed/updates
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible' && viewMode === 'list') {
                loadProducts(false);
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [viewMode, loadProducts]);

    // Scroll detection for infinite scroll
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            const distanceFromBottom = documentHeight - (scrollTop + windowHeight);
            
            if (distanceFromBottom < 100 && hasMore && !loadingMore && !loading && viewMode === 'list') {
                loadProducts(true); // Append mode
            }
        };
        
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [hasMore, loadingMore, loading, viewMode, loadProducts]);

    const handleCreate = async (data: CreateProductData) => {
        setLoading(true);
        try {
            await adminApi.createProduct(data);
            const message = `Product ${data.code} (${data.businessGroup}) was created successfully.`;
            showToast(message, 'success');
            setViewMode('list');
            setProducts([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadProducts(false);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (data: CreateProductData) => {
        if (!selectedProduct) return;
        setLoading(true);
        try {
            await adminApi.updateProduct(selectedProduct.id, data);
            const message = `Product ${data.code} (${data.businessGroup}) was updated successfully.`;
            showToast(message, 'success');
            setViewMode('list');
            setSelectedProduct(null);
            setProducts([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadProducts(false);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteClick = (product: AdminProduct) => {
        setProductToDelete(product);
        setShowDeleteModal(true);
    };

    const handleDeleteConfirm = async (reason?: string) => {
        if (!productToDelete) return;
        
        try {
            setLoading(true);
            await adminApi.deleteProduct(productToDelete.id, reason);
            setProducts([]);
            setCurrentOffset(0);
            setHasMore(true);
            await loadProducts(false);
            setShowDeleteModal(false);
            setProductToDelete(null);
        } catch (err: any) {
            throw err; // Let the modal handle the error display
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (product: AdminProduct) => {
        if (product.status === 'REJECTED') {
            alert('Rejected products cannot be edited. Please deactivate and create a new one.');
            return;
        }
        setSelectedProduct(product);
        setViewMode('edit');
    };

    const resetFilters = () => {
        setFilters({ businessGroup: '', search: '', status: '', includeInactive: false });
        setProducts([]);
        setCurrentOffset(0);
        setHasMore(true);
    };

    /**
     * The one product export: every product requesters can select, both business units, in the Power BI
     * master's columns - the same file as "Download current products" on Product master sync, and the
     * layout that page uploads back.
     */
    const handleExport = async () => {
        setExporting(true);
        setExportStatus(null);
        try {
            const blob = await productSyncApi.exportCurrentProducts();
            const date = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `product-master-${date}.xlsx`;
            a.click();
            URL.revokeObjectURL(a.href);
            setExportStatus({ ok: true, text: 'Product master downloaded (CDG and LSG, Power BI layout).' });
        } catch (err: any) {
            setExportStatus({
                ok: false,
                text: err.response?.data?.message || err.response?.data?.error || err.message || 'Export failed.',
            });
        } finally {
            setExporting(false);
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
                            setSelectedProduct(null);
                        }}
                        className="text-sm text-gray-600 hover:text-gray-900 mb-4"
                    >
                        ← Back to List
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {viewMode === 'create' ? 'Create Product' : 'Edit Product'}
                    </h1>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <ProductForm
                        product={selectedProduct}
                        onSubmit={viewMode === 'create' ? handleCreate : handleUpdate}
                        onCancel={() => {
                            setViewMode('list');
                            setSelectedProduct(null);
                        }}
                        isLoading={loading}
                        onNotify={showToast}
                    />
                </div>
            </div>
        );
    }

    const runBulkAction = async () => {
        if (!bulkAction) return;
        setBulkBusy(true);
        setBulkError(null);
        setBulkResult(null);
        try {
            // Same filter object the grid used, and the same total it displayed. The server
            // recounts and refuses if the two disagree, so a stale screen cannot act on more
            // rows than the operator was shown.
            const res = await adminApi.bulkUpdateProducts({
                mode: 'filter',
                action: bulkAction,
                expectedCount: total,
                filter: buildProductFilter(filtersRef.current),
            });
            setBulkResult(res.message ?? `Updated ${res.updated} product(s).`);
            setBulkAction(null);
            await loadProducts(false);
        } catch (err: any) {
            setBulkError(
                err?.response?.data?.message ?? err?.message ?? 'Bulk update failed.'
            );
        } finally {
            setBulkBusy(false);
        }
    };

    return (
        <div className="w-full max-w-full">
            <AdminToast toast={toast} onDismiss={clearToast} />
            {/* Enhanced Header */}
            <div className="relative bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl shadow-xl p-6 mb-6 border border-gray-200/60 overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-1">Product Management</h1>
                        <p className="text-sm text-gray-600">Manage product catalog data</p>
                        {exportStatus && (
                            <p className={`mt-2 text-sm ${exportStatus.ok ? 'text-green-700' : 'text-red-700'}`}>
                                {exportStatus.text}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={exporting}
                            onClick={() => void handleExport()}
                            title="Every product requesters can select, CDG and LSG, in the Power BI master's columns"
                            className="px-4 py-2.5 border border-gray-300 bg-white text-gray-800 rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-offset-2 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                        >
                            {exporting ? 'Exporting…' : 'Export products (.xlsx)'}
                        </button>
                        <button
                            onClick={() => setViewMode('create')}
                            className="px-6 py-3 bg-gradient-to-r from-[#00A651] to-[#008A44] text-white rounded-xl hover:shadow-lg hover:shadow-[#00A651]/25 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-offset-2 transition-all duration-200 font-semibold text-sm"
                        >
                            <span className="flex items-center gap-2">
                                <span className="text-lg">+</span>
                                <span>Create Product</span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Enhanced Filters */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-gray-200/60">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                        <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={filters.includeInactive}
                                onChange={(e) => setFilters({ ...filters, includeInactive: e.target.checked })}
                                className="rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                            />
                            Include deactivated products
                        </label>
                        <p className="mt-1 text-xs text-gray-500">
                            Products the Power BI master no longer lists, or lists at a list price of 0 or 1, are removed by
                            Product master sync and are not shown here.
                        </p>
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
            {loading && products.length === 0 && (
                <div className="text-center py-16 bg-white rounded-xl shadow-lg border border-gray-200/60">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#00A651]"></div>
                    <p className="mt-4 text-sm font-medium text-gray-600">Loading products...</p>
                </div>
            )}

            {/* Enhanced Empty State */}
            {!loading && products.length === 0 && (
                <div className="text-center py-16 bg-white rounded-xl shadow-lg border border-gray-200/60">
                    <div className="text-5xl mb-4">📦</div>
                    <p className="text-gray-600 font-medium">No products found</p>
                    <p className="text-sm text-gray-500 mt-1">Try adjusting your filters</p>
                </div>
            )}

            {/* Enhanced Total Count */}
            {(bulkResult || bulkError) && (
                <div
                    className={`rounded-xl border p-3 text-sm ${
                        bulkError
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : 'border-green-200 bg-green-50 text-green-900'
                    }`}
                >
                    {bulkError ?? bulkResult}
                </div>
            )}

            {total > 0 &&
                (filters.status === 'PENDING_APPROVAL' ||
                    filters.status === 'ALL' ||
                    filters.includeInactive) && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm text-amber-900">
                                <span className="font-semibold">Bulk action</span> &mdash; applies to all{' '}
                                <span className="font-bold">{total.toLocaleString()}</span> product
                                {total === 1 ? '' : 's'} matching the current filter, not just the{' '}
                                {products.length.toLocaleString()} loaded on screen.
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBulkResult(null);
                                        setBulkError(null);
                                        setBulkAction('approve');
                                    }}
                                    className="px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100"
                                >
                                    Approve all {total.toLocaleString()}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBulkResult(null);
                                        setBulkError(null);
                                        setBulkAction('activate');
                                    }}
                                    className="px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100"
                                >
                                    Reactivate all {total.toLocaleString()}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBulkResult(null);
                                        setBulkError(null);
                                        setBulkAction('approveAndActivate');
                                    }}
                                    className="px-3 py-2 rounded-lg bg-[#00A651] text-white text-sm font-semibold hover:bg-[#008A44]"
                                >
                                    Approve &amp; reactivate all {total.toLocaleString()}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            {bulkAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-semibold text-gray-900">
                            {bulkAction === 'approve'
                                ? 'Approve'
                                : bulkAction === 'activate'
                                  ? 'Reactivate'
                                  : 'Approve and reactivate'}{' '}
                            {total.toLocaleString()} product{total === 1 ? '' : 's'}?
                        </h3>
                        <p className="mt-2 text-sm text-gray-600">
                            This applies to every product matching the current filter, including the
                            ones not yet loaded on screen.
                        </p>
                        <dl className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
                            <div>
                                <dt className="inline font-medium">Business unit: </dt>
                                <dd className="inline">{filters.businessGroup || 'all'}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Status filter: </dt>
                                <dd className="inline">{filters.status || 'Approved only'}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Deactivated included: </dt>
                                <dd className="inline">{filters.includeInactive ? 'yes' : 'no'}</dd>
                            </div>
                            {filters.search ? (
                                <div>
                                    <dt className="inline font-medium">Search: </dt>
                                    <dd className="inline">{filters.search}</dd>
                                </div>
                            ) : null}
                        </dl>
                        <div className="mt-5 flex justify-end gap-3">
                            <button
                                type="button"
                                disabled={bulkBusy}
                                onClick={() => setBulkAction(null)}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={bulkBusy}
                                onClick={runBulkAction}
                                className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-semibold hover:bg-[#008A44] disabled:opacity-50"
                            >
                                {bulkBusy ? 'Working...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {total > 0 && (
                <div className="mb-4 px-4 py-2 bg-gradient-to-r from-[#00A651]/5 to-transparent rounded-lg border border-[#00A651]/10">
                    <p className="text-sm font-medium text-gray-700">
                        Showing <span className="font-bold text-[#00A651]">{products.length}</span> of <span className="font-bold text-gray-900">{total}</span> products
                    </p>
                </div>
            )}

            {/* Enhanced Products Table */}
            {products.length > 0 && (
                <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-200/60">
                    <table className="w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
                            <tr>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Code</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[25%]">Name</th>
                                <th className="hidden xl:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[20%]">Name (Local)</th>
                                <th className="hidden lg:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Business Group</th>
                                <th className="hidden sm:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Price</th>
                                <th className="hidden xl:table-cell px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">List Price</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Status</th>
                                <th className="px-3 py-2 md:px-6 md:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {products.map((product) => (
                                <tr key={product.id} className="hover:bg-gradient-to-r hover:from-[#00A651]/5 hover:to-transparent transition-all duration-150">
                                    {/* Code with Business Group on 2nd line */}
                                    <td className="px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                        <div className="text-sm font-semibold text-gray-900 truncate" title={product.code}>
                                            {product.code}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate" title={product.businessGroup}>
                                            {product.businessGroup}
                                        </div>
                                    </td>
                                    {/* Name with Local Name on 2nd line */}
                                    <td className="px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                        <div className="text-sm font-semibold text-gray-900 truncate" title={product.name}>
                                            {product.name}
                                        </div>
                                        {product.productNameLocal && (
                                            <div className="text-xs text-gray-500 truncate" title={product.productNameLocal}>
                                                {product.productNameLocal}
                                            </div>
                                        )}
                                    </td>
                                    {/* Name (Local) - only show if different from main name */}
                                    <td className="hidden xl:table-cell px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                        {product.productNameLocal && product.productNameLocal !== product.name ? (
                                            <div className="text-sm text-gray-500 truncate" title={product.productNameLocal}>
                                                {product.productNameLocal}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400">-</span>
                                        )}
                                    </td>
                                    {/* Business Group - hidden on smaller screens since it's now in Code column */}
                                    <td className="hidden lg:table-cell px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-sm text-gray-500 overflow-hidden text-ellipsis">
                                        {product.businessGroup}
                                    </td>
                                    {/* Price with List Price on 2nd line */}
                                    <td className="hidden sm:table-cell px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                        <div className="text-sm font-semibold text-gray-900">
                                            ¥{product.price.toLocaleString()}
                                        </div>
                                        {product.listPrice !== product.price && (
                                            <div className="text-xs text-gray-500">
                                                List: ¥{product.listPrice.toLocaleString()}
                                            </div>
                                        )}
                                    </td>
                                    {/* List Price - only show if different */}
                                    <td className="hidden xl:table-cell px-3 py-2 md:px-6 md:py-4 overflow-hidden">
                                        {product.listPrice !== product.price ? (
                                            <div className="text-sm text-gray-500">
                                                ¥{product.listPrice.toLocaleString()}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap">
                                        <StatusBadge status={product.status} />
                                    </td>
                                    {/* Icon-based Actions */}
                                    <td className="px-3 py-2 md:px-6 md:py-4 whitespace-nowrap text-right">
                                        <div className="flex justify-end gap-1">
                                            <IconButton
                                                onClick={() => handleEdit(product)}
                                                icon={<EditIcon />}
                                                label="Edit"
                                                color="green"
                                            />
                                            <IconButton
                                                onClick={() => {
                                                    setHistoryRecordId(product.id);
                                                    setShowHistory(true);
                                                }}
                                                icon={<HistoryIcon />}
                                                label="History"
                                                color="blue"
                                            />
                                            <IconButton
                                                onClick={() => handleDeleteClick(product)}
                                                icon={<DeactivateIcon />}
                                                label="Deactivate"
                                                color="red"
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Enhanced Loading More Indicator */}
            {loadingMore && (
                <div className="text-center py-6 bg-white rounded-xl shadow-lg border border-gray-200/60 mt-4">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-[#00A651]"></div>
                    <p className="mt-3 text-sm font-medium text-gray-600">Loading more products...</p>
                </div>
            )}

            {/* Enhanced End of List Indicator */}
            {!hasMore && products.length > 0 && (
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
                    recordType="product"
                    onClose={() => {
                        setShowHistory(false);
                        setHistoryRecordId(null);
                    }}
                    onRollback={() => {
                        loadProducts(false);
                    }}
                />
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && productToDelete && (
                <DeleteConfirmationModal
                    isOpen={showDeleteModal}
                    recordType="product"
                    recordName={productToDelete.name}
                    recordCode={productToDelete.code}
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => {
                        setShowDeleteModal(false);
                        setProductToDelete(null);
                    }}
                    isLoading={loading}
                />
            )}
        </div>
    );
}
