/**
 * Customer List Reconciliation
 * After bulk import: compare official file vs DB and disable removed customers.
 */

import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/api.service';

type CustomerType = '1' | '2' | '8';
type Tab = 'removed' | 'updated' | 'added' | 'alreadyInactive';

const CUSTOMER_TYPES: Array<{ value: CustomerType; label: string }> = [
  { value: '1', label: 'SOLD-TO' },
  { value: '8', label: 'End User' },
  { value: '2', label: 'Ship-to' },
];

interface CustomerDiffRow {
  id?: string;
  businessGroup: string;
  code: string;
  sapCode: string;
  nameJp: string;
  nameEn: string;
  updatedAt?: string;
  fieldChanges?: Array<{ field: string; fileValue: string | number | null; dbValue: string | number | null }>;
}

interface CompareResult {
  customerType: CustomerType;
  customerTypeLabel: string;
  summary: {
    added: number;
    updated: number;
    removed: number;
    alreadyInactive: number;
    unchanged: number;
    invalidRows: number;
    fileRowsForType: number;
  };
  added: CustomerDiffRow[];
  updated: CustomerDiffRow[];
  removed: CustomerDiffRow[];
  alreadyInactive: CustomerDiffRow[];
  errors: Array<{ row: number; column: string; message: string; value: string }>;
  totalErrorCount?: number;
  errorsTruncated?: boolean;
  excludedOtherTypeRows?: number;
  emptySelectedType?: boolean;
  warning?: string;
  hint?: string;
}

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function rowKey(row: CustomerDiffRow): string {
  return row.id ?? `${row.businessGroup}|${row.code}`;
}

export default function CustomerReconciliationPage() {
  const [customerType, setCustomerType] = useState<CustomerType>('1');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ uploadPercent: number; phase: 'uploading' | 'comparing' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('removed');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [disableReason, setDisableReason] = useState('');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableSuccess, setDisableSuccess] = useState<string | null>(null);

  const customerTypeLabel = useMemo(
    () => CUSTOMER_TYPES.find((t) => t.value === customerType)?.label ?? customerType,
    [customerType]
  );

  const selectedTypeHelp = useMemo(() => {
    if (customerType === '1') return 'Upload the official SOLD-TO customer list.';
    if (customerType === '8') return 'Upload the official End User customer list.';
    return 'Upload the official Ship-to / Direct Delivery customer list.';
  }, [customerType]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError(null);
    setDisableSuccess(null);
    setSelectedIds(new Set());
    if (f && f.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_MB} MB.`);
      setFile(null);
    }
  }, []);

  const handleCompare = useCallback(async () => {
    if (!file) {
      setError('Please select a file.');
      return;
    }
    setLoading(true);
    setError(null);
    setDisableSuccess(null);
    setProgress({ uploadPercent: 0, phase: 'uploading' });
    try {
      const data = await adminApi.compareCustomerList(file, customerType, (p) => setProgress(p));
      if (data.success) {
        const compareResult: CompareResult = {
          customerType: data.customerType,
          customerTypeLabel: data.customerTypeLabel,
          summary: data.summary,
          added: data.added,
          updated: data.updated,
          removed: data.removed,
          alreadyInactive: data.alreadyInactive,
          errors: data.errors,
          totalErrorCount: data.totalErrorCount,
          errorsTruncated: data.errorsTruncated,
          excludedOtherTypeRows: data.excludedOtherTypeRows,
          emptySelectedType: data.emptySelectedType,
          warning: data.warning,
          hint: data.hint,
        };
        setResult(compareResult);
        const removedIds = data.removed.map((r) => r.id).filter((id): id is string => Boolean(id));
        setSelectedIds(new Set(removedIds));
        setActiveTab(data.removed.length > 0 ? 'removed' : 'updated');
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Compare failed.';
      setError(msg);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [file, customerType]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllRemoved = useCallback(() => {
    if (!result) return;
    const allIds = result.removed.map((r) => r.id).filter((id): id is string => Boolean(id));
    setSelectedIds((prev) => {
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }, [result]);

  const runDisable = useCallback(async () => {
    if (!result) return;
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setDisableError('Select at least one customer to disable.');
      return;
    }
    setDisableLoading(true);
    setDisableError(null);
    try {
      const data = await adminApi.disableRemovedCustomers({
        customerType: result.customerType,
        customerIds: ids,
        reason: disableReason.trim() || undefined,
      });
      if (data.success) {
        setShowDisableConfirm(false);
        setDisableSuccess(data.message ?? `Disabled ${data.disabled} customer(s).`);
        const disabledSet = new Set(ids);
        setResult((prev) => {
          if (!prev) return prev;
          const movedToInactive = prev.removed.filter((r) => r.id && disabledSet.has(r.id));
          return {
            ...prev,
            removed: prev.removed.filter((r) => !r.id || !disabledSet.has(r.id)),
            alreadyInactive: [...prev.alreadyInactive, ...movedToInactive],
            summary: {
              ...prev.summary,
              removed: prev.summary.removed - data.disabled,
              alreadyInactive: prev.summary.alreadyInactive + data.disabled,
            },
          };
        });
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Disable failed.';
      setDisableError(msg);
      setShowDisableConfirm(false);
    } finally {
      setDisableLoading(false);
    }
  }, [result, selectedIds, disableReason]);

  const allRemovedSelected = useMemo(() => {
    if (!result || result.removed.length === 0) return false;
    const allIds = result.removed.map((r) => r.id).filter((id): id is string => Boolean(id));
    return allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  }, [result, selectedIds]);

  const tabs: Array<{ id: Tab; label: string; count: number }> = useMemo(() => {
    if (!result) return [];
    return [
      { id: 'removed', label: 'Removed from list', count: result.summary.removed },
      { id: 'updated', label: 'Updated', count: result.summary.updated },
      { id: 'added', label: 'Added', count: result.summary.added },
      { id: 'alreadyInactive', label: 'Already inactive', count: result.summary.alreadyInactive },
    ];
  }, [result]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer list reconciliation</h1>
        <p className="mt-1 text-sm text-gray-600">
          After{' '}
          <Link to="/admin/bulk-import?entity=customers" className="text-[#00A651] hover:underline">
            bulk import
          </Link>
          , upload the same official list here to find customers removed from the directory and disable them.
        </p>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-gray-800 leading-relaxed">
        <strong>Workflow:</strong> Import the new {customerTypeLabel} customer list via Bulk import first, then upload
        the same file on this page. Customers active in the database but absent from the file appear under{' '}
        <em>Removed from list</em> — all are selected by default; uncheck any you want to keep active.
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Customer type</label>
          <div className="flex flex-wrap gap-4">
            {CUSTOMER_TYPES.map((type) => (
              <label key={type.value} className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="customerType"
                  value={type.value}
                  checked={customerType === type.value}
                  onChange={() => {
                    setCustomerType(type.value);
                    setResult(null);
                    setSelectedIds(new Set());
                  }}
                  className="text-[#00A651] focus:ring-[#00A651]"
                />
                <span className="text-sm text-gray-800">{type.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Official customer list file</label>
          <p className="mb-2 text-xs text-gray-500">{selectedTypeHelp}</p>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#00A651]/10 file:text-[#00A651] hover:file:bg-[#00A651]/20"
          />
          {file && <p className="mt-1 text-xs text-gray-500">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
        </div>

        {loading && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>
                {progress.phase === 'uploading'
                  ? `Uploading… ${progress.uploadPercent}%`
                  : 'Upload complete. Comparing with database…'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-[#00A651] transition-all duration-300"
                style={{ width: progress.phase === 'comparing' ? '100%' : `${progress.uploadPercent}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleCompare}
          disabled={loading || !file}
          className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
        >
          {loading ? 'Comparing…' : 'Compare with database'}
        </button>

        <p className="text-xs text-gray-500">
          Accepted: .xlsx, .csv (max {MAX_FILE_SIZE_MB} MB). Same format as bulk import. Rows for other customer types
          in the file are ignored.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">{error}</div>
      )}

      {disableSuccess && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 text-sm">{disableSuccess}</div>
      )}

      {disableError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">{disableError}</div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">
              Comparison result — {result.customerTypeLabel}
            </h2>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'In file', value: result.summary.fileRowsForType, color: 'text-gray-700' },
                { label: 'Added', value: result.summary.added, color: 'text-blue-700' },
                { label: 'Updated', value: result.summary.updated, color: 'text-amber-700' },
                { label: 'Removed', value: result.summary.removed, color: 'text-red-700' },
                { label: 'Already inactive', value: result.summary.alreadyInactive, color: 'text-gray-500' },
                { label: 'Unchanged', value: result.summary.unchanged, color: 'text-green-700' },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                  <div className={`text-xl font-bold ${card.color}`}>{card.value.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
                </div>
              ))}
            </div>
            {result.summary.invalidRows > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {result.summary.invalidRows} row(s) had validation errors and were excluded from comparison.
              </p>
            )}
            {result.excludedOtherTypeRows != null && result.excludedOtherTypeRows > 0 && (
              <p className="mt-1 text-xs text-gray-600">
                {result.excludedOtherTypeRows} valid row(s) for other customer types were ignored.
              </p>
            )}
            {result.warning && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {result.warning}
              </div>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="p-4 border-b border-gray-100 max-h-48 overflow-y-auto">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Validation errors
                {result.errorsTruncated && result.totalErrorCount != null && (
                  <span className="font-normal text-amber-600 ml-2">
                    (first {result.errors.length} of {result.totalErrorCount})
                  </span>
                )}
              </h3>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-3">Row</th>
                    <th className="py-1 pr-3">Column</th>
                    <th className="py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.slice(0, 50).map((e, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1 pr-3 font-mono">{e.row}</td>
                      <td className="py-1 pr-3">{e.column}</td>
                      <td className="py-1">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-b border-gray-100 flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#00A651] text-[#00A651]'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
              </button>
            ))}
          </div>

          {activeTab === 'removed' && (
            <div>
              {result.removed.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  No active customers to disable — all codes for this type are in the file.
                </p>
              ) : (
                <>
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex flex-wrap items-center gap-4 justify-between">
                    <p className="text-sm text-amber-900">
                      These customers are active in the database but not in the official list.
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allRemovedSelected}
                          onChange={toggleSelectAllRemoved}
                          className="rounded text-[#00A651] focus:ring-[#00A651]"
                        />
                        Select all
                      </label>
                      <input
                        type="text"
                        placeholder="Reason (optional)"
                        value={disableReason}
                        onChange={(e) => setDisableReason(e.target.value)}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-48"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setDisableError(null);
                          setShowDisableConfirm(true);
                        }}
                        disabled={selectedIds.size === 0 || result.emptySelectedType}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        Disable selected ({selectedIds.size})
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-2 px-4 w-10" />
                          <th className="py-2 pr-4">Group</th>
                          <th className="py-2 pr-4">Code</th>
                          <th className="py-2 pr-4">SAP</th>
                          <th className="py-2 pr-4">Name (JP)</th>
                          <th className="py-2 pr-4">Name (EN)</th>
                          <th className="py-2">Last updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.removed.map((row) => (
                          <tr key={rowKey(row)} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-2 px-4">
                              {row.id && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(row.id)}
                                  onChange={() => toggleSelect(row.id!)}
                                  className="rounded text-[#00A651] focus:ring-[#00A651]"
                                />
                              )}
                            </td>
                            <td className="py-2 pr-4 text-gray-600">{row.businessGroup}</td>
                            <td className="py-2 pr-4 font-mono text-gray-800">{row.code}</td>
                            <td className="py-2 pr-4 font-mono text-gray-600">{row.sapCode}</td>
                            <td className="py-2 pr-4 text-gray-800">{row.nameJp}</td>
                            <td className="py-2 pr-4 text-gray-600">{row.nameEn || '—'}</td>
                            <td className="py-2 text-gray-500 text-xs">{formatDate(row.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'updated' && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              {result.updated.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No field differences between file and database.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 px-4">Group</th>
                      <th className="py-2 pr-4">Code</th>
                      <th className="py-2 pr-4">Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.updated.map((row) => (
                      <tr key={rowKey(row)} className="border-b border-gray-50">
                        <td className="py-2 px-4 text-gray-600">{row.businessGroup}</td>
                        <td className="py-2 pr-4 font-mono text-gray-800">{row.code}</td>
                        <td className="py-2 pr-4">
                          <ul className="space-y-1">
                            {(row.fieldChanges ?? []).map((fc, i) => (
                              <li key={i} className="text-xs text-gray-700">
                                <span className="font-medium">{fc.field}</span>:{' '}
                                <span className="text-red-600 line-through">{String(fc.dbValue ?? '—')}</span>
                                {' → '}
                                <span className="text-green-700">{String(fc.fileValue ?? '—')}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'added' && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              {result.added.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">
                  No new customers — every file code already exists in the database (import may have already applied
                  these).
                </p>
              ) : (
                <>
                  <p className="px-4 py-2 text-xs text-gray-600 bg-gray-50 border-b">
                    Informational only. Use Bulk import to add these if not yet imported.
                  </p>
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 px-4">Group</th>
                        <th className="py-2 pr-4">Code</th>
                        <th className="py-2 pr-4">SAP</th>
                        <th className="py-2 pr-4">Name (JP)</th>
                        <th className="py-2">Name (EN)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.added.map((row) => (
                        <tr key={rowKey(row)} className="border-b border-gray-50">
                          <td className="py-2 px-4 text-gray-600">{row.businessGroup}</td>
                          <td className="py-2 px-4 font-mono">{row.code}</td>
                          <td className="py-2 pr-4 font-mono text-gray-600">{row.sapCode}</td>
                          <td className="py-2 pr-4">{row.nameJp}</td>
                          <td className="py-2">{row.nameEn || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {activeTab === 'alreadyInactive' && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              {result.alreadyInactive.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No inactive customers missing from the file.</p>
              ) : (
                <>
                  <p className="px-4 py-2 text-xs text-gray-600 bg-gray-50 border-b">
                    These customers are already disabled and not in the official list. No action needed.
                  </p>
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 px-4">Group</th>
                        <th className="py-2 pr-4">Code</th>
                        <th className="py-2 pr-4">SAP</th>
                        <th className="py-2 pr-4">Name (JP)</th>
                        <th className="py-2">Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.alreadyInactive.map((row) => (
                        <tr key={rowKey(row)} className="border-b border-gray-50 text-gray-500">
                          <td className="py-2 px-4 text-gray-600">{row.businessGroup}</td>
                          <td className="py-2 px-4 font-mono">{row.code}</td>
                          <td className="py-2 pr-4 font-mono">{row.sapCode}</td>
                          <td className="py-2 pr-4">{row.nameJp}</td>
                          <td className="py-2 text-xs">{formatDate(row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showDisableConfirm && result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !disableLoading) setShowDisableConfirm(false);
          }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900">Disable selected customers?</h2>
            <p className="mt-2 text-sm text-gray-600">
              You are about to disable <strong>{selectedIds.size}</strong> {result.customerTypeLabel} customer(s) that
              are no longer on the official list. They will be hidden from the sample request customer picker but remain
              in history.
            </p>
            {disableReason.trim() && (
              <p className="mt-2 text-sm text-gray-700">
                Reason: <em>{disableReason.trim()}</em>
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDisableConfirm(false)}
                disabled={disableLoading}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runDisable}
                disabled={disableLoading}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {disableLoading ? 'Disabling…' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
