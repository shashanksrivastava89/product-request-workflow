/**
 * Deactivate Confirmation Modal Component
 * Proper confirmation dialog for deactivating records
 */

import { useState } from 'react';

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    recordType: 'customer' | 'product';
    recordName: string;
    recordCode: string;
    onConfirm: (reason?: string) => Promise<void>;
    onCancel: () => void;
    isLoading?: boolean;
}

export default function DeleteConfirmationModal({
    isOpen,
    recordType,
    recordName,
    recordCode,
    onConfirm,
    onCancel,
    isLoading = false,
}: DeleteConfirmationModalProps) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            await onConfirm(reason.trim() || undefined);
            // Reset form on success
            setReason('');
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to deactivate record');
        }
    };

    const handleCancel = () => {
        setReason('');
        setError('');
        onCancel();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-orange-100">
                            <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900">
                            Deactivate {recordType === 'customer' ? 'Customer' : 'Product'}
                        </h2>
                    </div>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-4">
                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                                {error}
                            </div>
                        )}

                        <div className="mb-4">
                            <p className="text-sm text-gray-600 mb-2">
                                Are you sure you want to deactivate this {recordType}?
                            </p>
                            <div className="bg-gray-50 p-3 rounded border border-gray-200">
                                <div className="text-sm">
                                    <div className="font-medium text-gray-900 mb-1">
                                        {recordName}
                                    </div>
                                    <div className="text-gray-600">
                                        Code: <span className="font-mono">{recordCode}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Reason for deactivation (optional)
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Enter reason for deactivation..."
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-[#00A651] focus:border-[#00A651] text-sm resize-none"
                                disabled={isLoading}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                This will be recorded in the change history for audit purposes.
                            </p>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                            <div className="flex items-start gap-2">
                                <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <p className="text-sm text-yellow-800">
                                    <strong>Note:</strong> The record will be marked as inactive and hidden from active lists. It can be restored later if needed.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleCancel}
                            disabled={isLoading}
                            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Deactivating...
                                </>
                            ) : (
                                'Deactivate'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
