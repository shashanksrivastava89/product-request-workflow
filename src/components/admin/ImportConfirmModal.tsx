/**
 * Confirmation dialog for bulk import (replaces window.confirm).
 */

interface ImportConfirmModalProps {
  isOpen: boolean;
  entityLabel: string;
  /** Rows that will be written (valid rows only). */
  rowCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  /** Extra context below the main warning (e.g. ZSAM also updates requester groups). */
  detailNote?: string;
  /** When set, user chose to skip failing rows (partial import). */
  skippedRowCount?: number;
}

export default function ImportConfirmModal({
  isOpen,
  entityLabel,
  rowCount,
  onConfirm,
  onCancel,
  isLoading = false,
  detailNote,
  skippedRowCount,
}: ImportConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-[#00A651]/10">
              <svg className="h-5 w-5 text-[#00A651]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
            </div>
            <div>
              <h2 id="import-confirm-title" className="text-lg font-semibold text-gray-900">
                Import into database?
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                <span className="font-medium text-gray-800">{entityLabel}</span>
                <span className="mx-1">·</span>
                <span>
                  {skippedRowCount != null && skippedRowCount > 0 ? (
                    <>
                      Import <strong>{rowCount.toLocaleString()}</strong> valid row
                      {rowCount === 1 ? '' : 's'} · Skip <strong>{skippedRowCount.toLocaleString()}</strong> row
                      {skippedRowCount === 1 ? '' : 's'} with errors
                    </>
                  ) : (
                    <>
                      {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
                    </>
                  )}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Existing records that match the same business keys will be <strong className="text-gray-800">updated</strong>.
            New keys will be <strong className="text-gray-800">created</strong>.
            {skippedRowCount != null && skippedRowCount > 0 ? (
              <> Rows that failed validation are not imported.</>
            ) : null}{' '}
            This action cannot be undone from this screen.
          </p>
          {detailNote && (
            <p className="mt-3 text-sm text-gray-700 leading-relaxed border-t border-gray-100 pt-3">{detailNote}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                Importing…
              </>
            ) : (
              'Import'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
