/**
 * Confirmation dialog for admin permanent request deletion.
 */

import { useEffect, useState } from 'react';

interface DeleteRequestModalProps {
  isOpen: boolean;
  referenceNumber: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DeleteRequestModal({
  isOpen,
  referenceNumber,
  onConfirm,
  onCancel,
}: DeleteRequestModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onConfirm();
      onCancel();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Delete failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-request-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 id="delete-request-title" className="text-lg font-semibold text-gray-900">
                Delete request permanently?
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 break-all" title={referenceNumber}>
                {referenceNumber}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>
          )}

          <p className="text-sm text-gray-600 leading-relaxed">
            This permanently removes the request, all products, and approval rows. This action cannot be undone.
          </p>

          <div className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-3">
            <div className="flex items-start gap-2">
              <svg
                className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="text-xs text-red-800 leading-relaxed">
                The request will be removed from submitted requests and cannot be recovered.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Deleting…
              </>
            ) : (
              'Delete permanently'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
