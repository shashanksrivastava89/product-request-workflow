/**
 * Data Approval Queue Page
 * Shows all pending approval records (customers and products)
 */

import { useState, useEffect } from 'react';
import { adminApi, AdminCustomer, AdminProduct } from '../../services/api.service';
import StatusBadge from '../../components/admin/StatusBadge';
import ApproveRejectModal from '../../components/admin/ApproveRejectModal';

type TabType = 'customers' | 'products';

export default function DataApprovalQueue() {
    const [activeTab, setActiveTab] = useState<TabType>('customers');
    const [customers, setCustomers] = useState<AdminCustomer[]>([]);
    const [products, setProducts] = useState<AdminProduct[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [modalState, setModalState] = useState<{
        isOpen: boolean;
        type: 'approve' | 'reject';
        recordType: 'customer' | 'product';
        recordId?: string;
        recordName?: string;
    }>({
        isOpen: false,
        type: 'approve',
        recordType: 'customer',
    });

    useEffect(() => {
        loadPendingData();
    }, [activeTab]);

    const loadPendingData = async () => {
        setLoading(true);
        setError(null);
        try {
            if (activeTab === 'customers') {
                const response = await adminApi.getPendingCustomers({ limit: 100 });
                setCustomers(response.customers || []);
            } else {
                const response = await adminApi.getPendingProducts({ limit: 100 });
                setProducts(response.products || []);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to load pending data');
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (id?: string, reason?: string) => {
        try {
            setLoading(true);
            if (id) {
                // Single approve
                if (activeTab === 'customers') {
                    await adminApi.approveCustomer(id);
                } else {
                    await adminApi.approveProduct(id);
                }
            } else {
                // Bulk approve
                const ids = Array.from(selectedIds);
                if (ids.length === 0) return;
                if (activeTab === 'customers') {
                    await adminApi.bulkApproveCustomers(ids);
                } else {
                    await adminApi.bulkApproveProducts(ids);
                }
                setSelectedIds(new Set());
            }
            setModalState({ ...modalState, isOpen: false });
            await loadPendingData();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to approve');
        } finally {
            setLoading(false);
        }
    };

    const handleReject = async (id: string, reason: string) => {
        try {
            setLoading(true);
            if (activeTab === 'customers') {
                await adminApi.rejectCustomer(id, reason);
            } else {
                await adminApi.rejectProduct(id, reason);
            }
            setModalState({ ...modalState, isOpen: false });
            await loadPendingData();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to reject');
        } finally {
            setLoading(false);
        }
    };

    const handleBulkReject = async (reason: string) => {
        try {
            setLoading(true);
            const ids = Array.from(selectedIds);
            if (ids.length === 0) return;
            if (activeTab === 'customers') {
                await adminApi.bulkRejectCustomers(ids, reason);
            } else {
                await adminApi.bulkRejectProducts(ids, reason);
            }
            setSelectedIds(new Set());
            setModalState({ ...modalState, isOpen: false });
            await loadPendingData();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to reject');
        } finally {
            setLoading(false);
        }
    };

    const openModal = (type: 'approve' | 'reject', id?: string, name?: string) => {
        setModalState({
            isOpen: true,
            type,
            recordType: activeTab === 'customers' ? 'customer' : 'product',
            recordId: id,
            recordName: name,
        });
    };

    const toggleSelection = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const toggleSelectAll = () => {
        if (activeTab === 'customers') {
            if (selectedIds.size === customers.length) {
                setSelectedIds(new Set());
            } else {
                setSelectedIds(new Set(customers.map((c) => c.id)));
            }
        } else {
            if (selectedIds.size === products.length) {
                setSelectedIds(new Set());
            } else {
                setSelectedIds(new Set(products.map((p) => p.id)));
            }
        }
    };

    const currentRecords = activeTab === 'customers' ? customers : products;
    const hasSelection = selectedIds.size > 0;

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Data Approval Queue</h1>
                <p className="mt-1 text-sm text-gray-500">Review and approve pending customer and product records</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => {
                            setActiveTab('customers');
                            setSelectedIds(new Set());
                        }}
                        className={`py-4 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'customers'
                                ? 'border-[#00A651] text-[#00A651]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Customers ({customers.length})
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('products');
                            setSelectedIds(new Set());
                        }}
                        className={`py-4 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'products'
                                ? 'border-[#00A651] text-[#00A651]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Products ({products.length})
                    </button>
                </nav>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{error}</p>
                </div>
            )}

            {/* Bulk Actions */}
            {hasSelection && (
                <div className="mb-4 p-4 bg-[#00A651]/10 border border-[#00A651] rounded-md flex items-center justify-between">
                    <span className="text-sm font-medium text-[#00A651]">
                        {selectedIds.size} {activeTab === 'customers' ? 'customer(s)' : 'product(s)'} selected
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => openModal('approve')}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-[#00A651] rounded-md hover:bg-[#008A44]"
                        >
                            Approve Selected
                        </button>
                        <button
                            onClick={() => openModal('reject')}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                        >
                            Reject Selected
                        </button>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && currentRecords.length === 0 && (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading...</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && currentRecords.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                    <p className="text-gray-500">No pending {activeTab} records</p>
                </div>
            )}

            {/* Records Table */}
            {currentRecords.length > 0 && (
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.size === currentRecords.length && currentRecords.length > 0}
                                        onChange={toggleSelectAll}
                                        className="rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                                    />
                                </th>
                                {activeTab === 'customers' ? (
                                    <>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Code
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Name (JP)
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Name (EN)
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Business Group
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Type
                                        </th>
                                    </>
                                ) : (
                                    <>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Code
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Name
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Name (Local)
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Business Group
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Price
                                        </th>
                                    </>
                                )}
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Submitted By
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Submitted At
                                </th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {activeTab === 'customers'
                                ? customers.map((customer) => (
                                      <tr key={customer.id} className="hover:bg-gray-50">
                                          <td className="px-6 py-4 whitespace-nowrap">
                                              <input
                                                  type="checkbox"
                                                  checked={selectedIds.has(customer.id)}
                                                  onChange={() => toggleSelection(customer.id)}
                                                  className="rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                                              />
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{customer.code}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{customer.nameJp}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{customer.nameEn}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{customer.businessGroup}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              {customer.firstDigit === '1' ? 'SOLD-TO' : customer.firstDigit === '2' ? 'Direct Delivery' : 'End User'}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              {customer.submitter?.name || 'N/A'}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              {customer.submittedAt ? new Date(customer.submittedAt).toLocaleDateString() : 'N/A'}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                              <div className="flex justify-end gap-2">
                                                  <button
                                                      onClick={() => openModal('approve', customer.id, customer.nameJp)}
                                                      className="text-green-600 hover:text-green-900"
                                                  >
                                                      Approve
                                                  </button>
                                                  <button
                                                      onClick={() => openModal('reject', customer.id, customer.nameJp)}
                                                      className="text-red-600 hover:text-red-900"
                                                  >
                                                      Reject
                                                  </button>
                                              </div>
                                          </td>
                                      </tr>
                                  ))
                                : products.map((product) => (
                                      <tr key={product.id} className="hover:bg-gray-50">
                                          <td className="px-6 py-4 whitespace-nowrap">
                                              <input
                                                  type="checkbox"
                                                  checked={selectedIds.has(product.id)}
                                                  onChange={() => toggleSelection(product.id)}
                                                  className="rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                                              />
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.code}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{product.name}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.productNameLocal}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.businessGroup}</td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              ¥{product.price.toLocaleString()}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              {product.submitter?.name || 'N/A'}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                              {product.submittedAt ? new Date(product.submittedAt).toLocaleDateString() : 'N/A'}
                                          </td>
                                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                              <div className="flex justify-end gap-2">
                                                  <button
                                                      onClick={() => openModal('approve', product.id, product.name)}
                                                      className="text-green-600 hover:text-green-900"
                                                  >
                                                      Approve
                                                  </button>
                                                  <button
                                                      onClick={() => openModal('reject', product.id, product.name)}
                                                      className="text-red-600 hover:text-red-900"
                                                  >
                                                      Reject
                                                  </button>
                                              </div>
                                          </td>
                                      </tr>
                                  ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Approve/Reject Modal */}
            <ApproveRejectModal
                isOpen={modalState.isOpen}
                type={modalState.type}
                recordType={modalState.recordType}
                recordName={modalState.recordName || ''}
                isBulk={!modalState.recordId}
                count={selectedIds.size}
                onConfirm={async (reason) => {
                    if (modalState.type === 'approve') {
                        await handleApprove(modalState.recordId, reason);
                    } else {
                        if (modalState.recordId) {
                            await handleReject(modalState.recordId, reason || '');
                        } else {
                            await handleBulkReject(reason || '');
                        }
                    }
                }}
                onCancel={() => setModalState({ ...modalState, isOpen: false })}
                isLoading={loading}
            />
        </div>
    );
}
