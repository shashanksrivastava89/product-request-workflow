/**
 * Change History Item Component
 * Displays a single change entry in the global change history
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../services/api.service';
import ChangeHistory from './ChangeHistory';
import RestoreConfirmationModal from './RestoreConfirmationModal';

interface ChangeHistoryItemProps {
    change: {
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
    };
    onRestore?: () => void;
}

export default function ChangeHistoryItem({ change, onRestore }: ChangeHistoryItemProps) {
    const [showFullHistory, setShowFullHistory] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const navigate = useNavigate();

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

    const handleViewRecord = () => {
        if (change.recordType === 'customer') {
            navigate(`/admin/customers`);
            // Could navigate to specific customer if we had a detail view
        } else {
            navigate(`/admin/products`);
            // Could navigate to specific product if we had a detail view
        }
    };

    const handleRestoreClick = () => {
        setShowRestoreModal(true);
    };

    const handleRestoreConfirm = async (reason?: string) => {
        try {
            if (change.recordType === 'customer') {
                await adminApi.restoreCustomer(change.recordId, reason);
            } else {
                await adminApi.restoreProduct(change.recordId, reason);
            }

            // Refresh the change history list
            if (onRestore) {
                onRestore();
            }
            setShowRestoreModal(false);
        } catch (err: any) {
            throw err; // Let the modal handle the error display
        }
    };

    return (
        <>
            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1">
                        {/* Record Type Icon */}
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            change.recordType === 'customer' ? 'bg-blue-100' : 'bg-purple-100'
                        }`}>
                            <span className="text-lg">
                                {change.recordType === 'customer' ? '👥' : '📦'}
                            </span>
                        </div>

                        {/* Record Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-gray-900">
                                    {change.recordType === 'customer' ? 'Customer' : 'Product'}
                                </span>
                                <span className="text-sm text-gray-500">|</span>
                                <span className="text-sm font-mono text-gray-700">{change.recordCode}</span>
                                <span className="text-sm text-gray-500">|</span>
                                <span className="text-sm text-gray-700 truncate" title={change.recordName}>
                                    {change.recordName}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getChangeTypeColor(change.changeType)}`}>
                                    {formatChangeType(change.changeType)}
                                </span>
                                <span>Version {change.version}</span>
                            </div>
                        </div>
                    </div>

                    {/* Timestamp */}
                    <div className="text-xs text-gray-500 whitespace-nowrap ml-4">
                        {new Date(change.changedAt).toLocaleString()}
                    </div>
                </div>

                {/* Changed By */}
                {change.changedBy && (
                    <div className="text-sm text-gray-600 mb-2">
                        Changed by: <strong>{change.changedBy.name}</strong> ({change.changedBy.email})
                    </div>
                )}

                {/* Change Reason */}
                {change.changeReason && (
                    <div className="mb-2 p-2 bg-gray-50 rounded text-sm text-gray-700">
                        <strong>Reason:</strong> {change.changeReason}
                    </div>
                )}

                {/* Field Changes */}
                {change.fieldChanges && change.fieldChanges.length > 0 && (
                    <div className="mb-3">
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="text-sm text-[#00A651] hover:text-[#008A44] font-medium flex items-center gap-1"
                        >
                            <svg
                                className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {expanded ? 'Hide' : 'Show'} {change.fieldChanges.length} change{change.fieldChanges.length !== 1 ? 's' : ''}
                        </button>
                        {expanded && (
                            <div className="mt-2 space-y-2">
                                {change.fieldChanges.map((fieldChange, idx) => (
                                    <div key={idx} className="text-sm bg-gray-50 p-2 rounded">
                                        <div className="font-medium text-gray-700">
                                            {formatFieldName(fieldChange.field)}:
                                        </div>
                                        <div className="flex gap-2 mt-1">
                                            <span className="text-red-600 line-through">
                                                {formatValue(fieldChange.oldValue)}
                                            </span>
                                            <span className="text-gray-400">→</span>
                                            <span className="text-green-600 font-medium">
                                                {formatValue(fieldChange.newValue)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-gray-200 flex-wrap">
                    <button
                        onClick={() => setShowFullHistory(true)}
                        className="text-sm text-blue-600 hover:text-blue-900 font-medium"
                    >
                        View Full History
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={handleViewRecord}
                        className="text-sm text-[#00A651] hover:text-[#008A44] font-medium"
                    >
                        Go to {change.recordType === 'customer' ? 'Customer' : 'Product'} Management
                    </button>
                    {change.changeType === 'DELETE' && (
                        <>
                            <span className="text-gray-300">|</span>
                            <button
                                onClick={handleRestoreClick}
                                className="text-sm text-[#00A651] hover:text-[#008A44] font-medium"
                            >
                                Restore
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Full History Modal */}
            {showFullHistory && (
                <ChangeHistory
                    recordId={change.recordId}
                    recordType={change.recordType}
                    onClose={() => setShowFullHistory(false)}
                    onRollback={() => {
                        // Refresh could be added here if needed
                        setShowFullHistory(false);
                    }}
                />
            )}

            {/* Restore Confirmation Modal */}
            {showRestoreModal && (
                <RestoreConfirmationModal
                    isOpen={showRestoreModal}
                    recordType={change.recordType}
                    recordName={change.recordName}
                    recordCode={change.recordCode}
                    onConfirm={handleRestoreConfirm}
                    onCancel={() => setShowRestoreModal(false)}
                />
            )}
        </>
    );
}
