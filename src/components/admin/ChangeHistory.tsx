/**
 * Change History Component
 * Displays change history for a record and allows rollback
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api.service';

interface ChangeHistoryProps {
    recordId: string;
    recordType: 'customer' | 'product';
    onClose: () => void;
    onRollback?: () => void;
}

interface HistoryRecord {
    id: string;
    version: number;
    changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
    changedBy: string;
    changedAt: string;
    changeReason?: string;
    fieldChanges?: Array<{
        field: string;
        oldValue: any;
        newValue: any;
    }>;
    changer?: {
        id: string;
        name: string;
        email: string;
    };
}

export default function ChangeHistory({ recordId, recordType, onClose, onRollback }: ChangeHistoryProps) {
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [rollbackReason, setRollbackReason] = useState('');
    const [rollingBack, setRollingBack] = useState(false);

    useEffect(() => {
        loadHistory();
    }, [recordId, recordType]);

    const loadHistory = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = recordType === 'customer'
                ? await adminApi.getCustomerHistory(recordId)
                : await adminApi.getProductHistory(recordId);
            setHistory(response.history || []);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load history');
        } finally {
            setLoading(false);
        }
    };

    const handleRollback = async () => {
        if (!selectedVersion) return;

        try {
            setRollingBack(true);
            if (recordType === 'customer') {
                await adminApi.rollbackCustomer(recordId, selectedVersion, rollbackReason || undefined);
            } else {
                await adminApi.rollbackProduct(recordId, selectedVersion, rollbackReason || undefined);
            }
            if (onRollback) {
                onRollback();
            }
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to rollback');
        } finally {
            setRollingBack(false);
        }
    };

    const getChangeTypeColor = (type: string) => {
        switch (type) {
            case 'CREATE':
                return 'bg-green-100 text-green-800';
            case 'UPDATE':
                return 'bg-blue-100 text-blue-800';
            case 'DELETE':
                return 'bg-orange-100 text-orange-800';
            case 'RESTORE':
                return 'bg-yellow-100 text-yellow-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    const formatChangeType = (type: string) => {
        switch (type) {
            case 'DELETE':
                return 'DEACTIVATE';
            default:
                return type;
        }
    };

    const formatFieldName = (field: string) => {
        return field
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    };

    const formatValue = (value: any) => {
        if (value === null || value === undefined) return '(empty)';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
                    <div className="text-center">Loading history...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-gray-900">
                        Change History - {recordType === 'customer' ? 'Customer' : 'Product'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
                            {error}
                        </div>
                    )}

                    {history.length === 0 ? (
                        <div className="text-center text-gray-500 py-8">
                            No change history available
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {history.map((record, index) => (
                                <div
                                    key={record.id}
                                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                                >
                                    {/* Version Header */}
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-gray-500">
                                                Version {record.version}
                                            </span>
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${getChangeTypeColor(record.changeType)}`}>
                                                {formatChangeType(record.changeType)}
                                            </span>
                                        </div>
                                        <div className="text-sm text-gray-500">
                                            {new Date(record.changedAt).toLocaleString()}
                                        </div>
                                    </div>

                                    {/* Changer Info */}
                                    {record.changer && (
                                        <div className="text-sm text-gray-600 mb-3">
                                            Changed by: <strong>{record.changer.name}</strong> ({record.changer.email})
                                        </div>
                                    )}

                                    {/* Change Reason */}
                                    {record.changeReason && (
                                        <div className="mb-3 p-2 bg-gray-50 rounded text-sm text-gray-700">
                                            <strong>Reason:</strong> {record.changeReason}
                                        </div>
                                    )}

                                    {/* Field Changes */}
                                    {record.fieldChanges && record.fieldChanges.length > 0 && (
                                        <div className="mt-3">
                                            <div className="text-sm font-medium text-gray-700 mb-2">Changes:</div>
                                            <div className="space-y-2">
                                                {record.fieldChanges.map((change, idx) => (
                                                    <div key={idx} className="text-sm bg-gray-50 p-2 rounded">
                                                        <div className="font-medium text-gray-700">
                                                            {formatFieldName(change.field)}:
                                                        </div>
                                                        <div className="flex gap-2 mt-1">
                                                            <span className="text-red-600 line-through">
                                                                {formatValue(change.oldValue)}
                                                            </span>
                                                            <span className="text-gray-400">→</span>
                                                            <span className="text-green-600 font-medium">
                                                                {formatValue(change.newValue)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Rollback Button */}
                                    {index > 0 && (
                                        <div className="mt-3 pt-3 border-t border-gray-200">
                                            <button
                                                onClick={() => setSelectedVersion(record.version)}
                                                className="text-sm text-[#00A651] hover:text-[#008040] font-medium"
                                            >
                                                Rollback to this version
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Rollback Confirmation */}
                {selectedVersion && (
                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                        <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Rollback to Version {selectedVersion}
                            </label>
                            <textarea
                                value={rollbackReason}
                                onChange={(e) => setRollbackReason(e.target.value)}
                                placeholder="Optional reason for rollback..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-[#00A651] focus:border-[#00A651] text-sm"
                                rows={2}
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleRollback}
                                disabled={rollingBack}
                                className="flex-1 bg-[#00A651] text-white px-4 py-2 rounded-md hover:bg-[#008040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                            >
                                {rollingBack ? 'Rolling back...' : 'Confirm Rollback'}
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedVersion(null);
                                    setRollbackReason('');
                                }}
                                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Footer */}
                {!selectedVersion && (
                    <div className="px-6 py-4 border-t border-gray-200">
                        <button
                            onClick={onClose}
                            className="w-full px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
