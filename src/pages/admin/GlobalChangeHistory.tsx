/**
 * Global Change History Page
 * Shows all changes across customers and products in a unified audit log
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { adminApi } from '../../services/api.service';
import ChangeHistoryItem from '../../components/admin/ChangeHistoryItem';

interface ChangeEntry {
    id: string;
    recordType: 'customer' | 'product';
    recordId: string;
    recordCode: string;
    recordName: string;
    version: number;
    changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
    changedBy: {
        id: string;
        name: string;
        email: string;
    } | null;
    changedAt: string;
    changeReason: string | null;
    fieldChanges: Array<{
        field: string;
        oldValue: any;
        newValue: any;
    }> | null;
}

export default function GlobalChangeHistory() {
    const [changes, setChanges] = useState<ChangeEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        recordType: 'all' as 'all' | 'customer' | 'product',
        changeType: 'all' as 'all' | 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
        changedBy: '',
        fromDate: '',
        toDate: '',
        search: '',
    });
    const [hasMore, setHasMore] = useState(true);
    const [total, setTotal] = useState(0);
    const [currentOffset, setCurrentOffset] = useState(0);
    const filtersRef = useRef(filters);
    const currentOffsetRef = useRef(0);

    // Keep refs in sync
    useEffect(() => {
        filtersRef.current = filters;
        currentOffsetRef.current = currentOffset;
    }, [filters, currentOffset]);

    useEffect(() => {
        setChanges([]);
        setCurrentOffset(0);
        setHasMore(true);
        loadChanges(false);
    }, [filters.recordType, filters.changeType, filters.changedBy, filters.fromDate, filters.toDate, filters.search]);

    const loadChanges = useCallback(async (append = false) => {
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
            if (currentFilters.recordType !== 'all') {
                params.recordType = currentFilters.recordType;
            }
            if (currentFilters.changeType !== 'all') {
                params.changeType = currentFilters.changeType;
            }
            if (currentFilters.changedBy) {
                params.changedBy = currentFilters.changedBy;
            }
            if (currentFilters.fromDate) {
                params.fromDate = currentFilters.fromDate;
            }
            if (currentFilters.toDate) {
                params.toDate = currentFilters.toDate;
            }
            if (currentFilters.search) {
                params.search = currentFilters.search;
            }

            const response = await adminApi.getChangeHistory(params);

            if (append) {
                setChanges(prev => [...prev, ...(response.changes || [])]);
                setCurrentOffset(prev => {
                    const newOffset = prev + (response.changes?.length || 0);
                    currentOffsetRef.current = newOffset;
                    return newOffset;
                });
            } else {
                setChanges(response.changes || []);
                const newOffset = response.changes?.length || 0;
                setCurrentOffset(newOffset);
                currentOffsetRef.current = newOffset;
            }

            setTotal(response.total || 0);
            setHasMore(response.hasMore || false);
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to load change history');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    // Infinite scroll
    useEffect(() => {
        const handleScroll = () => {
            if (
                window.innerHeight + document.documentElement.scrollTop >=
                document.documentElement.offsetHeight - 1000
            ) {
                if (hasMore && !loadingMore && !loading) {
                    loadChanges(true);
                }
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [hasMore, loadingMore, loading, loadChanges]);

    const resetFilters = () => {
        setFilters({
            recordType: 'all',
            changeType: 'all',
            changedBy: '',
            fromDate: '',
            toDate: '',
            search: '',
        });
    };

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Change History</h1>
                <p className="text-sm text-gray-600 mt-1">View all changes made to customers and products</p>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Record Type</label>
                        <select
                            value={filters.recordType}
                            onChange={(e) => setFilters({ ...filters, recordType: e.target.value as any })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        >
                            <option value="all">All</option>
                            <option value="customer">Customer</option>
                            <option value="product">Product</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Change Type</label>
                        <select
                            value={filters.changeType}
                            onChange={(e) => setFilters({ ...filters, changeType: e.target.value as any })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        >
                            <option value="all">All</option>
                            <option value="CREATE">Create</option>
                            <option value="UPDATE">Update</option>
                            <option value="DELETE">Deactivate</option>
                            <option value="RESTORE">Restore</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                        <input
                            type="date"
                            value={filters.fromDate}
                            onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                        <input
                            type="date"
                            value={filters.toDate}
                            onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            placeholder="Code, Name..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={resetFilters}
                            className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{error}</p>
                </div>
            )}

            {/* Loading State */}
            {loading && changes.length === 0 && (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading change history...</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && changes.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                    <p className="text-gray-500">No changes found</p>
                </div>
            )}

            {/* Total Count */}
            {total > 0 && (
                <div className="mb-4 text-sm text-gray-700">
                    Showing {changes.length} of {total} changes
                </div>
            )}

            {/* Changes Timeline */}
            {changes.length > 0 && (
                <div className="space-y-4">
                    {changes.map((change) => (
                        <ChangeHistoryItem 
                            key={change.id} 
                            change={change}
                            onRestore={() => {
                                // Reload changes after restore
                                setChanges([]);
                                setCurrentOffset(0);
                                setHasMore(true);
                                loadChanges(false);
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Loading More Indicator */}
            {loadingMore && (
                <div className="text-center py-4">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading more changes...</p>
                </div>
            )}

            {/* End of List Indicator */}
            {!hasMore && changes.length > 0 && (
                <div className="text-center py-4 text-sm text-gray-500">
                    Showing all {total} changes
                </div>
            )}
        </div>
    );
}
