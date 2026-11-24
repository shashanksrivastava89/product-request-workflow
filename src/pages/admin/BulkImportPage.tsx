/**
 * Bulk Import Page (Phase 1: Check upload)
 * Entity selection, file upload, validate-only with row-level errors and optional preview.
 */

import { useState, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../services/api.service';
import ImportConfirmModal from '../../components/admin/ImportConfirmModal';
import ImportColumnGuide from '../../components/admin/ImportColumnGuide';
import {
  IMPORT_ENTITY_LABELS,
  IMPORT_ENTITY_VALUES,
  isImportEntity,
  type ImportEntity,
} from '../../constants/importEntities';

type Entity = ImportEntity;

interface ValidationError {
  row: number;
  column: string;
  message: string;
  value: string;
  sheet?: string;
  rowInSheet?: number;
}

interface ValidateResult {
  success: boolean;
  entity: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ValidationError[];
  totalErrorCount?: number;
  errorsTruncated?: boolean;
  preview?: Array< { row: number; action: string; data: any }>;
  message?: string;
  requestedSheets?: string[];
  matchedSheets?: string[];
  /** ZSAM: explains Team Name + requester group sync */
  requesterGroupSyncHint?: string;
  /** Users: UPDATE column + LSG/CDG */
  userImportHint?: string;
  zncInstallHint?: string;
  zncClaimHint?: string;
  zintQcHint?: string;
  /** Return matrix: the key, the pruning, and what the Reviewer column's absence means. */
  returnMatrixHint?: string;
}

const ENTITY_LABELS = IMPORT_ENTITY_LABELS;
const ENTITY_VALUES = IMPORT_ENTITY_VALUES;
const isEntityParam = isImportEntity;

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_ROWS_PER_FILE = 500_000;

interface SheetInfo {
  sheetNames: string[];
  rowCountPerSheet: Record<string, number>;
}

export default function BulkImportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entity, setEntity] = useState<Entity>('customers');
  /** An old link to ?entity=products: products are no longer imported here. */
  const productsLink = searchParams.get('entity') === 'products';
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [progress, setProgress] = useState<{ uploadPercent: number; phase: 'uploading' | 'validating' } | null>(null);
  /**
   * Server-side id of a file staged in chunks. Set when the file is bigger than one request
   * body may be, and reused by execute so the upload is not repeated.
   */
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [staging, setStaging] = useState<{ sent: number; total: number; retrying?: boolean } | null>(null);
  const [sheetInfo, setSheetInfo] = useState<SheetInfo | null>(null);
  const [loadingSheetInfo, setLoadingSheetInfo] = useState(false);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [errorViewMode, setErrorViewMode] = useState<'summary' | 'full'>('summary');
  const [executeLoading, setExecuteLoading] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [importValidRowsOnly, setImportValidRowsOnly] = useState(false);

  useEffect(() => {
    const raw = searchParams.get('entity');
    if (isEntityParam(raw)) {
      setEntity(raw);
      setResult(null);
      setExecuteResult(null);
      setExecuteError(null);
      setImportValidRowsOnly(false);
    }
  }, [searchParams]);

  const [executeResult, setExecuteResult] = useState<{
    created: number;
    updated: number;
    message?: string;
    requesterSync?: { created: number; updated: number; moved: number };
    removedFromDb?: number;
    skippedInvalidRows?: number;
  } | null>(null);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setResult(null);
    setError(null);
    setSheetInfo(null);
    setSelectedSheets([]);
    setExecuteResult(null);
    setExecuteError(null);
    setImportValidRowsOnly(false);
    setUploadId((previous) => {
      if (previous) void adminApi.abortImportUpload(previous);
      return null;
    });
  }, []);

  const handleLoadSheetInfo = useCallback(async () => {
    if (!file) return;
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    if (!isXlsx) return;
    setLoadingSheetInfo(true);
    setError(null);
    try {
      const data = await adminApi.getImportSheetInfo(file, uploadId ?? undefined);
      if (data.success && data.sheetNames) {
        setSheetInfo({ sheetNames: data.sheetNames, rowCountPerSheet: data.rowCountPerSheet || {} });
        setSelectedSheets([]);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load worksheet list.');
    } finally {
      setLoadingSheetInfo(false);
    }
  }, [file, uploadId]);

  const toggleSheet = useCallback((sheetName: string) => {
    setSelectedSheets((prev) =>
      prev.includes(sheetName) ? prev.filter((s) => s !== sheetName) : [...prev, sheetName]
    );
  }, []);

  const selectedTotalRows = sheetInfo
    ? selectedSheets.reduce((sum, name) => sum + (sheetInfo.rowCountPerSheet[name] ?? 0), 0)
    : 0;

  const openImportConfirm = useCallback(() => {
    if (!file) {
      setExecuteError('Please select a file.');
      return;
    }
    if (!result || result.totalRows === 0) {
      setExecuteError('Run validation first (no data rows).');
      return;
    }
    if (result.validRows === 0) {
      setExecuteError('No valid rows to import. Fix the file.');
      return;
    }
    if (result.invalidRows > 0 && !importValidRowsOnly) {
      setExecuteError(
        'Fix all errors, or check "Import only valid rows" below to skip rows with errors and import the rest.'
      );
      return;
    }
    setExecuteError(null);
    setShowImportConfirm(true);
  }, [file, result, importValidRowsOnly]);

  const runImportConfirmed = useCallback(async () => {
    if (!file) return;
    setExecuteLoading(true);
    setExecuteError(null);
    setExecuteResult(null);
    try {
      const sheetsToUse = selectedSheets.length > 0 ? selectedSheets : undefined;
      const skipInvalid =
        !!result && result.invalidRows > 0 && importValidRowsOnly;
      const data = await adminApi.executeImport(entity, file, sheetsToUse, {
        skipInvalidRows: skipInvalid,
        ...(uploadId ? { uploadId } : {}),
      });
      if (data.success) {
        setExecuteResult({
          created: data.created,
          updated: data.updated,
          message: data.message,
          requesterSync: data.requesterSync,
          removedFromDb: data.removedFromDb,
          skippedInvalidRows: data.skippedInvalidRows,
        });
        setShowImportConfirm(false);
        // Execute consumes the staged upload server-side; re-validating must stage again.
        setUploadId(null);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Import failed.';
      setExecuteError(msg);
      setShowImportConfirm(false);
    } finally {
      setExecuteLoading(false);
    }
  }, [file, entity, selectedSheets, result, importValidRowsOnly, uploadId]);

  const handleValidate = useCallback(async () => {
    if (!file) {
      setError('Please select a file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    const sheetsToUse = selectedSheets.length > 0 ? selectedSheets : undefined;
    if (sheetsToUse && selectedTotalRows > MAX_ROWS_PER_FILE) {
      setError(`Selected worksheets have ${selectedTotalRows.toLocaleString()} rows. Maximum is ${MAX_ROWS_PER_FILE.toLocaleString()}. Clear selection or choose fewer sheets.`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setExecuteResult(null);
    setExecuteError(null);
    setProgress(null);
    try {
      // The load balancer in front of UAT/production drops request bodies over ~8KB, so anything
      // larger goes up as chunks and is reassembled server-side. Small files keep the old
      // single-request path, which is one round trip instead of many.
      let stagedId = uploadId;
      if (!stagedId && file.size > adminApi.IMPORT_CHUNK_BYTES) {
        setStaging({ sent: 0, total: Math.ceil(file.size / adminApi.IMPORT_CHUNK_BYTES) });
        stagedId = await adminApi.stageImportUpload(file, (p) => setStaging(p));
        setUploadId(stagedId);
        setStaging(null);
      }
      const data = await adminApi.validateImport(
        entity,
        file,
        (p) => setProgress(p),
        sheetsToUse,
        stagedId ? { uploadId: stagedId } : undefined
      );
      setResult(data as ValidateResult);
      setImportValidRowsOnly(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Validation request failed.';
      const isTooLarge = msg.toLowerCase().includes('file') && (msg.toLowerCase().includes('large') || msg.toLowerCase().includes('size') || err?.response?.status === 413);
      const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('exceeded');
      if (isTooLarge) setError(`File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      else if (isTimeout) setError('Validation took too long. Try a smaller file or split your data. Large files (e.g. 30+ MB with many sheets) can take several minutes and may time out.');
      else setError(msg);
    } finally {
      setLoading(false);
      setProgress(null);
      setStaging(null);
    }
  }, [entity, file, selectedSheets, selectedTotalRows, uploadId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bulk Import</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload an Excel (.xlsx) or CSV file to validate. Use <strong>Run import to database</strong> to save rows when
          validation is clean, or enable <strong>Import only valid rows</strong> to skip failing rows and import the
          rest.
          {(entity === 'zint-qc' || entity === 'znc-claim-replacement' || entity === 'znc-installation') && (
            <>
              {' '}
              For <strong>ZINT for QC</strong>, <strong>ZNC claim replacement</strong>, and{' '}
              <strong>ZNC installation</strong>, import also removes mapping rows for CDG/LSG that are no longer in your
              file so PostgreSQL stays aligned with the spreadsheet.
            </>
          )}
          Below step 1, open <strong>What your spreadsheet columns update</strong> to see—in plain language—which
          columns change which saved fields before you upload.
        </p>
        <p className={`text-sm mt-2 ${productsLink ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900' : 'text-gray-500'}`}>
          Products are not imported here. The product master comes only from the Power BI export, on{' '}
          <Link to="/admin/product-reconciliation" className="font-medium text-[#00A651] hover:underline">
            Product master sync
          </Link>
          , which previews every change, removes what the export no longer lists and keeps each upload as a version.
        </p>
      </div>

      {/* Entity selection */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">1. Select entity type</h2>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(ENTITY_LABELS) as Entity[]).map((e) => (
            <label
              key={e}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-colors ${
                entity === e
                  ? 'border-[#00A651] bg-[#00A651]/5 text-[#00A651]'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="entity"
                value={e}
                checked={entity === e}
                onChange={() => {
                  setEntity(e);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('entity', e);
                    return next;
                  });
                  setResult(null);
                  setError(null);
                  setExecuteResult(null);
                  setExecuteError(null);
                  setImportValidRowsOnly(false);
                }}
                className="sr-only"
              />
              <span className="text-sm font-medium">{ENTITY_LABELS[e]}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200">
          <ImportColumnGuide entity={entity} />
        </div>
      </div>

      {/* File upload */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">2. Select file</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer text-sm font-medium">
            <span>Choose file</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={onFileChange}
              className="hidden"
            />
          </label>
          {file && (
            <span className={`text-sm ${file.size > MAX_FILE_SIZE_BYTES ? 'text-amber-600' : 'text-gray-600'}`}>
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
              {file.size > MAX_FILE_SIZE_BYTES && (
                <span className="ml-2 font-medium">— over {MAX_FILE_SIZE_MB} MB limit</span>
              )}
            </span>
          )}
          {file?.name.toLowerCase().endsWith('.xlsx') && (
            <button
              type="button"
              onClick={handleLoadSheetInfo}
              disabled={!file || loadingSheetInfo}
              className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-300 disabled:opacity-50"
            >
              {loadingSheetInfo ? 'Loading…' : 'Load worksheets'}
            </button>
          )}
          <button
            type="button"
            onClick={handleValidate}
            disabled={!file || loading}
            className="px-4 py-2 rounded-lg bg-[#00A651] text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#008c44]"
          >
            {loading ? (progress?.phase === 'validating' ? 'Validating…' : 'Uploading…') : 'Check upload'}
          </button>
        </div>
        {sheetInfo && sheetInfo.sheetNames.length > 0 && (
          <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Select worksheets to validate (max {MAX_ROWS_PER_FILE.toLocaleString()} rows total). Leave none selected to use all.
            </p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {sheetInfo.sheetNames.map((name) => {
                const rows = sheetInfo.rowCountPerSheet[name] ?? 0;
                const isSelected = selectedSheets.includes(name);
                return (
                  <label key={name} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSheet(name)}
                      className="rounded border-gray-300"
                    />
                    <span className="font-mono text-gray-700">{name}</span>
                    <span className="text-gray-500">({rows.toLocaleString()} rows)</span>
                  </label>
                );
              })}
            </div>
            {selectedSheets.length > 0 && (
              <p className={`text-xs mt-2 ${selectedTotalRows > MAX_ROWS_PER_FILE ? 'text-red-600' : 'text-gray-500'}`}>
                Selected: {selectedTotalRows.toLocaleString()} rows
                {selectedTotalRows > MAX_ROWS_PER_FILE && ' — over limit'}
              </p>
            )}
          </div>
        )}
        {loading && staging != null && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>
                Uploading in {staging.total.toLocaleString()} parts… {staging.sent.toLocaleString()} sent
                {staging.retrying ? ' · retrying rejected parts' : ''}
              </span>
              <span>
                {staging.total > 0 ? Math.round((staging.sent / staging.total) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-[#00A651] transition-all duration-300 ease-out"
                style={{
                  width: `${staging.total > 0 ? Math.round((staging.sent / staging.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-500">
              Large files are sent in small parts and reassembled on the server, so no single
              request is big enough to be rejected by the network. Nothing is imported yet.
            </p>
          </div>
        )}
        {loading && staging == null && progress != null && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>
                {progress.phase === 'uploading'
                  ? `Uploading… ${progress.uploadPercent}%`
                  : 'Upload complete. Validating file (all sheets)…'}
              </span>
              {progress.phase === 'uploading' && (
                <span>{progress.uploadPercent}%</span>
              )}
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-[#00A651] transition-all duration-300 ease-out"
                style={{
                  width: progress.phase === 'validating' ? '100%' : `${progress.uploadPercent}%`,
                }}
              />
            </div>
            {progress.phase === 'validating' && file && file.size > 20 * 1024 * 1024 && (
              <p className="text-xs text-amber-600 mt-1">
                Large files (20+ MB) may take 2–5 minutes. Please wait. If it times out, try a smaller file or split the data.
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">Accepted: .xlsx, .csv (max 100 MB). First row must be header. All sheets are validated.</p>
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">
          {error}
        </div>
      )}


      {/* Validation result */}
      {result && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Validation result</h2>
            <p className="text-sm text-gray-600 mt-1">
              Total rows: <strong>{result.totalRows}</strong> · Valid: <strong>{result.validRows}</strong> · Invalid: <strong>{result.invalidRows}</strong>
            </p>
            {result.requesterGroupSyncHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.requesterGroupSyncHint}
              </p>
            )}
            {result.userImportHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.userImportHint}
              </p>
            )}
            {result.zncInstallHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.zncInstallHint}
              </p>
            )}
            {result.zncClaimHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.zncClaimHint}
              </p>
            )}
            {result.zintQcHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.zintQcHint}
              </p>
            )}
            {result.returnMatrixHint && (
              <p className="mt-2 text-xs text-gray-800 border border-blue-100 bg-blue-50 rounded-lg p-3 leading-relaxed">
                {result.returnMatrixHint}
              </p>
            )}
            {result.totalRows === 0 && result.message && (
              <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                {result.message}
                {result.requestedSheets && result.requestedSheets.length > 0 && (
                  <p className="mt-1 text-xs">Requested sheets: {result.requestedSheets.join(', ')}</p>
                )}
                {result.matchedSheets && result.matchedSheets.length > 0 && (
                  <p className="mt-1 text-xs">Matched in file: {result.matchedSheets.join(', ')}</p>
                )}
              </div>
            )}
          </div>

          {result.errors.length > 0 && (() => {
            type Group = { location: string; locationShort: string; errors: ValidationError[] };
            const groupKey = (e: ValidationError) =>
              (e.sheet != null && e.rowInSheet != null ? `Sheet "${e.sheet}", Row ${e.rowInSheet}` : `Row ${e.row}`);
            const groups = result.errors.reduce<Group[]>((acc, err) => {
              const key = groupKey(err);
              const locShort = err.sheet != null && err.rowInSheet != null
                ? `Row ${err.rowInSheet}` : `Row ${err.row}`;
              const existing = acc.find((g) => g.location === key);
              if (existing) existing.errors.push(err);
              else acc.push({ location: key, locationShort: locShort, errors: [err] });
              return acc;
            }, []);
            const summary = (g: Group) => {
              const cols = [...new Set(g.errors.map((e) => e.column))];
              const allRequired = g.errors.every((e) => e.message === 'Required');
              if (allRequired) return `Missing: ${cols.join(', ')}`;
              if (cols.length <= 3) return cols.join(', ');
              return `${cols.length} fields: ${cols.slice(0, 2).join(', ')}…`;
            };
            return (
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700">
                    Row-level errors · {groups.length} row(s) with errors
                    {result.errorsTruncated && result.totalErrorCount != null && (
                      <span className="ml-2 font-normal text-amber-600">
                        (first {result.errors.length} of {result.totalErrorCount} errors)
                      </span>
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setErrorViewMode((m) => (m === 'summary' ? 'full' : 'summary'))}
                    className="text-xs text-[#00A651] hover:underline"
                  >
                    {errorViewMode === 'summary' ? 'Show full detail' : 'Show summary'}
                  </button>
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  {errorViewMode === 'summary' ? (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Location</th>
                          <th className="py-2 pr-4 w-12">#</th>
                          <th className="py-2">Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-2 pr-4 font-mono text-gray-700">{g.locationShort}</td>
                            <td className="py-2 pr-4 text-gray-500">{g.errors.length}</td>
                            <td className="py-2 text-red-600 text-xs">{summary(g)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Location</th>
                          <th className="py-2 pr-4">Column</th>
                          <th className="py-2 pr-4">Message</th>
                          <th className="py-2">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((err, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-2 pr-4 font-mono text-gray-700">
                              {err.sheet != null && err.rowInSheet != null
                                ? `Row ${err.rowInSheet}` : `Row ${err.row}`}
                            </td>
                            <td className="py-2 pr-4">{err.column}</td>
                            <td className="py-2 pr-4 text-red-600 text-xs">{err.message}</td>
                            <td className="py-2 text-gray-500 truncate max-w-[120px]" title={err.value}>{err.value || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}

          {result.preview && result.preview.length > 0 && (
            <div className="p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Preview (first {result.preview.length} valid rows)</h3>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Row</th>
                      <th className="py-2 pr-4">Action</th>
                      <th className="py-2">Data (key fields)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.preview.map((p, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 pr-4 font-mono">{p.row}</td>
                        <td className="py-2 pr-4">{p.action}</td>
                        <td className="py-2 text-gray-600">
                          <pre className="text-xs whitespace-pre-wrap break-all">
                            {JSON.stringify(p.data, null, 0).slice(0, 200)}
                            {(JSON.stringify(p.data).length > 200) ? '…' : ''}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.success && result.totalRows > 0 && result.validRows > 0 && (
            <div className="p-4 border-t border-gray-100 space-y-3">
              {result.invalidRows === 0 ? (
                <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-green-800 text-sm">
                  All rows passed validation. You can import them into the database.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-sm">
                    {result.invalidRows} row{result.invalidRows === 1 ? '' : 's'} failed validation (see above). You can
                    fix the file and validate again, or import only the {result.validRows} valid row
                    {result.validRows === 1 ? '' : 's'}.
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                      checked={importValidRowsOnly}
                      onChange={(e) => {
                        setImportValidRowsOnly(e.target.checked);
                        setExecuteError(null);
                      }}
                    />
                    <span>
                      <strong>Import only valid rows</strong> — skip rows with errors (partial import). Problem rows are
                      not written to the database.
                    </span>
                  </label>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openImportConfirm}
                  disabled={
                    !file ||
                    executeLoading ||
                    (result.invalidRows > 0 && !importValidRowsOnly)
                  }
                  className="px-4 py-2 rounded-lg bg-[#00A651] text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#008c44]"
                >
                  {executeLoading ? 'Importing…' : 'Run import to database'}
                </button>
                <span className="text-xs text-gray-500">
                  {entity === 'zsam-hierarchy'
                    ? 'Upserts ZSAM approval mapping (requester + CDG/LSG) and syncs requester group membership from Team Name + Group.'
                    : entity === 'zint-qc'
                      ? 'Upserts zint_approval_mapping, then removes stale requesters for each CDG/LSG present in the file so row counts match.'
                      : entity === 'znc-claim-replacement'
                        ? 'Upserts zncclaim_approval_mapping, then removes stale requesters for each CDG/LSG present in the file so row counts match.'
                        : entity === 'znc-installation'
                          ? 'Upserts znc_approval_mapping, then removes stale requesters for each CDG/LSG present in the file so row counts match.'
                          : 'Upserts by business key (e.g. customer CDG+code, ZSAM requester+CDG/LSG, user email).'}
                </span>
              </div>
              {executeError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm space-y-2">
                  <p>{executeError}</p>
                  {entity === 'zsam-hierarchy' &&
                    /sales rep code|account number|requester/i.test(executeError) && (
                      <p className="text-xs text-red-900/90 border-t border-red-200 pt-2 mt-2">
                        See the <Link to="/admin/users" className="font-medium underline underline-offset-2">Users</Link>{' '}
                        page to add this person with a sales rep code (Bulk import → Users), or add a{' '}
                        <strong>Sales Rep Code / Account Number</strong> column to your ZSAM file and run import again.
                      </p>
                    )}
                </div>
              )}
              {executeResult && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-900 text-sm">
                  <strong>Done.</strong> Created: {executeResult.created.toLocaleString()} · Updated:{' '}
                  {executeResult.updated.toLocaleString()}
                  {executeResult.message && <span className="block mt-1 text-green-800">{executeResult.message}</span>}
                  {executeResult.requesterSync && (
                    <span className="block mt-2 text-green-900 text-xs">
                      Requester groups: {executeResult.requesterSync.created} created, {executeResult.requesterSync.updated}{' '}
                      updated, {executeResult.requesterSync.moved} moved.
                    </span>
                  )}
                  {executeResult.removedFromDb !== undefined && executeResult.removedFromDb > 0 && (
                    <span className="block mt-2 text-green-900 text-xs">
                      Removed {executeResult.removedFromDb.toLocaleString()} stale mapping row(s) from the database (no
                      longer in this file for that CDG/LSG).
                    </span>
                  )}
                  {executeResult.skippedInvalidRows !== undefined && executeResult.skippedInvalidRows > 0 && (
                    <span className="block mt-2 text-amber-900 text-xs">
                      Skipped {executeResult.skippedInvalidRows.toLocaleString()} row(s) with validation errors (not
                      imported).
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ImportConfirmModal
        isOpen={showImportConfirm}
        entityLabel={ENTITY_LABELS[entity]}
        rowCount={result?.validRows ?? 0}
        skippedRowCount={
          importValidRowsOnly && result && result.invalidRows > 0 ? result.invalidRows : undefined
        }
        onConfirm={runImportConfirmed}
        onCancel={() => setShowImportConfirm(false)}
        isLoading={executeLoading}
        detailNote={
          entity === 'zsam-hierarchy'
            ? 'This import updates approval chains (zsamm_approval_mapping) and assigns each sales rep to the requester group implied by Team Name + Group (e.g. FAS LSG). Requesters can be moved between groups when your file says so.'
            : entity === 'zint-qc'
              ? 'ZINT mappings for each CDG/LSG block in this file are replaced: requesters not listed anymore are deleted from zint_approval_mapping for that block so the database matches your spreadsheet.'
              : entity === 'znc-claim-replacement'
                ? 'ZNC claim replacement mappings for each CDG/LSG block in this file are replaced: requesters not listed anymore are deleted from zncclaim_approval_mapping for that block so the database matches your spreadsheet.'
                : entity === 'znc-installation'
                  ? 'ZNC installation mappings for each CDG/LSG block in this file are replaced: requesters not listed anymore are deleted from znc_approval_mapping for that block so the database matches your spreadsheet.'
                  : undefined
        }
      />
    </div>
  );
}
