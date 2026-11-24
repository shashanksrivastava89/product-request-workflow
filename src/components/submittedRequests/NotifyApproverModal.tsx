/**
 * Confirmation dialog for admin resend of approval-request email.
 */

import { useEffect, useState } from 'react';
import { formatCompactApprovalDateTime } from '../../utils/approval-display.util';

interface NotifyApproverModalProps {
  isOpen: boolean;
  approverName: string;
  level: number;
  role: string;
  referenceNumber?: string;
  lastSentAt?: string;
  onConfirm: () => Promise<string | void>;
  onCancel: () => void;
}

export default function NotifyApproverModal({
  isOpen,
  approverName,
  level,
  role,
  referenceNumber,
  lastSentAt,
  onConfirm,
  onCancel,
}: NotifyApproverModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const message = await onConfirm();
      setSuccessMessage(message || `Notification sent to ${approverName}`);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to send notification');
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
      aria-labelledby="notify-approver-title"
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
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <svg className="h-5 w-5 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <h2 id="notify-approver-title" className="text-lg font-semibold text-gray-900">
                {successMessage ? 'Notification sent' : 'Send notification to approver'}
              </h2>
              {referenceNumber && (
                <p className="mt-0.5 text-xs text-gray-500 truncate" title={referenceNumber}>
                  {referenceNumber}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>
          )}

          {successMessage ? (
            <p className="text-sm text-gray-700 leading-relaxed">{successMessage}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 leading-relaxed">
                Send the approval request email again to the current approver? They will receive the same message
                with approve and reject links.
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm">
                <div className="font-semibold text-gray-900">{approverName}</div>
                <div className="text-gray-600 mt-0.5">
                  L{level} · {role}
                </div>
                {lastSentAt && (
                  <div className="text-gray-500 text-xs mt-2">
                    Last sent: {formatCompactApprovalDateTime(lastSentAt)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {successMessage ? (
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44]"
            >
              Done
            </button>
          ) : (
            <>
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
                className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                    Sending…
                  </>
                ) : (
                  'Send notification'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
