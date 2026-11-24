/**
 * Product master sync.
 *
 * Upload the Power BI material master export, preview exactly what applying it would do (adds,
 * price changes, removals, holds), and apply it as one run. The file is the whole master: after an
 * apply, the products requesters can select are exactly its rows, minus what an admin deactivated.
 * The preview is persisted, so it can be reviewed and signed off over days; the apply re-checks
 * everything under a lock and refuses if the catalogue moved in between.
 *
 * Every applied file is a version: it can be downloaded as it was uploaded, its changes listed, and
 * restored - which previews that file against today's catalogue and applies it as the next version.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  productSyncApi,
  type ProductMasterVersion,
  type ProductSyncHistoryRow,
  type ProductSyncRow,
  type ProductSyncRowAction,
  type ProductSyncRun,
} from '../../services/api.service';

const MAX_FILE_SIZE_MB = 20;
const PAGE = 50;

const ACTION_TABS: Array<{ id: ProductSyncRowAction; label: string; countKey: keyof NonNullable<ProductSyncRun['counts']>; tone: string }> = [
  { id: 'RETIRE', label: 'Remove', countKey: 'retire', tone: 'text-red-700' },
  { id: 'CREATE', label: 'Add', countKey: 'create', tone: 'text-blue-700' },
  { id: 'UPDATE', label: 'Update', countKey: 'update', tone: 'text-amber-700' },
  { id: 'REACTIVATE', label: 'Bring back', countKey: 'reactivate', tone: 'text-emerald-700' },
  { id: 'KEEP_INACTIVE', label: 'Kept deactivated', countKey: 'keepInactive', tone: 'text-gray-600' },
  { id: 'HELD', label: 'Held back', countKey: 'held', tone: 'text-purple-700' },
  { id: 'SKIPPED', label: 'Skipped by rule', countKey: 'skippedByRule', tone: 'text-gray-500' },
  { id: 'INVALID', label: 'Invalid', countKey: 'invalid', tone: 'text-red-600' },
  { id: 'UNCHANGED', label: 'Unchanged', countKey: 'unchanged', tone: 'text-green-700' },
];

const STATUS_BADGE: Record<ProductSyncRun['status'], string> = {
  PREVIEWING: 'bg-blue-100 text-blue-800',
  PREVIEWED: 'bg-amber-100 text-amber-800',
  APPLYING: 'bg-blue-100 text-blue-800',
  APPLIED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  SUPERSEDED: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<ProductSyncRun['status'], string> = {
  PREVIEWING: 'Previewing…',
  PREVIEWED: 'Previewed - awaiting apply',
  APPLYING: 'Applying…',
  APPLIED: 'Applied',
  FAILED: 'Failed',
  SUPERSEDED: 'Superseded',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString();
}

function changesText(changes: ProductSyncRow['fieldChanges']): string {
  if (!changes || changes.length === 0) return '';
  return changes.map((c) => `${c.field}: ${c.oldValue ?? '—'} → ${c.newValue ?? '—'}`).join('; ');
}

function errorMessage(err: any, fallback: string): string {
  return err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? fallback;
}

function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function runTitle(run: ProductSyncRun): string {
  return run.version ? `Version ${run.version}` : `Run ${run.id.slice(0, 8)}`;
}

export default function ProductReconciliationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [staging, setStaging] = useState<{ sent: number; total: number; retrying?: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<ProductSyncRun[]>([]);
  const [versions, setVersions] = useState<ProductMasterVersion[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ProductSyncRun | null>(null);

  const [tab, setTab] = useState<ProductSyncRowAction>('RETIRE');
  const [rows, setRows] = useState<ProductSyncRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsOffset, setRowsOffset] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [overrideReason, setOverrideReason] = useState('');
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [restoreTarget, setRestoreTarget] = useState<ProductMasterVersion | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [history, setHistory] = useState<ProductSyncHistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);

  const refreshRuns = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([productSyncApi.listRuns(20), productSyncApi.listVersions(50)]);
      setRuns(r);
      setVersions(v);
    } catch {
      /* the lists are a convenience; the selected run still polls on its own */
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  // The selected run: fetch now, and keep polling while the backend is working on it.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await productSyncApi.getRun(runId);
        if (!cancelled) setRun(r);
      } catch (err: any) {
        if (!cancelled) setError(errorMessage(err, 'Could not load the run.'));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (run && run.id === runId && run.status !== 'PREVIEWING' && run.status !== 'APPLYING') return;
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, run?.status]);

  // When a run settles, refresh the lists so its status there matches.
  useEffect(() => {
    if (run && (run.status === 'PREVIEWED' || run.status === 'APPLIED' || run.status === 'FAILED')) void refreshRuns();
  }, [run?.status, run, refreshRuns]);

  const loadRows = useCallback(
    async (id: string, action: ProductSyncRowAction, offset: number) => {
      setRowsLoading(true);
      try {
        const page = await productSyncApi.getRows(id, action, offset, PAGE);
        setRows(page.rows);
        setRowsTotal(page.total);
        setRowsOffset(offset);
      } catch (err: any) {
        setError(errorMessage(err, 'Could not load rows.'));
      } finally {
        setRowsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (run && (run.status === 'PREVIEWED' || run.status === 'APPLIED')) void loadRows(run.id, tab, 0);
    else {
      setRows([]);
      setRowsTotal(0);
    }
  }, [run?.id, run?.status, tab, loadRows, run]);

  const loadHistory = useCallback(async (id: string, offset: number) => {
    try {
      const page = await productSyncApi.getHistory(id, offset, PAGE);
      setHistory(page.rows);
      setHistoryTotal(page.total);
      setHistoryOffset(offset);
    } catch {
      /* shown only for applied runs; a miss is not worth an error banner */
    }
  }, []);

  useEffect(() => {
    if (run && run.status === 'APPLIED') void loadHistory(run.id, 0);
    else {
      setHistory([]);
      setHistoryTotal(0);
    }
  }, [run?.id, run?.status, loadHistory, run]);

  const selectRun = useCallback((id: string) => {
    setRunId(id);
    setRun(null);
    setApplyError(null);
    setTab('RETIRE');
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f && f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_MB} MB.`);
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const handlePreview = useCallback(async () => {
    if (!file) return;
    setStarting(true);
    setError(null);
    setApplyError(null);
    setStaging({ sent: 0, total: 1 });
    try {
      const id = await productSyncApi.startPreview(file, (p) => setStaging(p));
      selectRun(id);
      void refreshRuns();
    } catch (err: any) {
      setError(errorMessage(err, 'Could not start the preview.'));
    } finally {
      setStarting(false);
      setStaging(null);
    }
  }, [file, refreshRuns, selectRun]);

  const blocked = useMemo(() => (run?.guards ?? []).some((g) => g.severity === 'fail' && !g.ok), [run]);

  const handleApply = useCallback(async () => {
    if (!run) return;
    setApplyError(null);
    try {
      await productSyncApi.apply(run.id, blocked ? overrideReason.trim() : undefined);
      setShowApplyConfirm(false);
      setRun({ ...run, status: 'APPLYING' });
    } catch (err: any) {
      setApplyError(errorMessage(err, 'Apply was refused.'));
      setShowApplyConfirm(false);
    }
  }, [run, blocked, overrideReason]);

  const handleDownloadCurrent = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      saveBlob(await productSyncApi.exportCurrentProducts(), `product-master-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err: any) {
      setError(errorMessage(err, 'Download failed.'));
    } finally {
      setDownloading(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!run) return;
    setExporting(true);
    try {
      const label = run.version ? `v${run.version}` : run.id.slice(0, 8);
      saveBlob(await productSyncApi.exportRows(run.id, tab), `product-master-${label}-${tab.toLowerCase()}.xlsx`);
    } catch (err: any) {
      setError(errorMessage(err, 'Export failed.'));
    } finally {
      setExporting(false);
    }
  }, [run, tab]);

  const handleDownloadVersionFile = useCallback(async (v: ProductMasterVersion) => {
    setError(null);
    try {
      const ext = (v.fileName ?? '').toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
      saveBlob(await productSyncApi.downloadRunFile(v.runId), `product-master-v${v.version}.${ext}`);
    } catch (err: any) {
      setError(errorMessage(err, 'Download failed.'));
    }
  }, []);

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const id = await productSyncApi.restoreVersion(restoreTarget.runId, restoreReason.trim());
      setRestoreTarget(null);
      setRestoreReason('');
      selectRun(id);
      void refreshRuns();
    } catch (err: any) {
      setRestoreError(errorMessage(err, 'Could not start the restore.'));
    } finally {
      setRestoring(false);
    }
  }, [restoreTarget, restoreReason, refreshRuns, selectRun]);

  const counts = run?.counts ?? null;
  const written = counts?.written;
  const busy = run?.status === 'PREVIEWING' || run?.status === 'APPLYING';
  const latestVersion = versions[0]?.version;
  const restoredFrom = run?.restoredFromRunId ? versions.find((v) => v.runId === run.restoredFromRunId) : undefined;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Product master sync</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload the Power BI material master export (<em>MaterialMasterForReturnRequest</em>). The file is the whole product
          master: once applied, the products requesters can select are exactly its rows. The preview shows every product that
          would be added, changed, removed or brought back; nothing is written until you apply it. Each applied file becomes a
          version you can download or restore.
        </p>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-gray-800 leading-relaxed">
        <strong>Rules applied:</strong> GS1 is the CDG product code, exactly as written (the SAP code when GS1 is blank); a blank
        contract price is filled from the list price; rows with a list price of 0, 1 or blank are skipped and their products
        removed; products the export does not list are removed too, including ones created by hand. A removed product
        disappears from product selection, the export and the Products page (existing requests keep what they have); its
        history is kept, and it comes back if a later export or a restored version lists it. A product an admin deactivated
        stays deactivated. A row that fails validation never removes anything. Every change is written to the product history
        under <em>SYSTEM - Product sync</em>.
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Current products</h2>
            <p className="mt-1 text-xs text-gray-500">
              Every product requesters can select, in the same columns as the Power BI export, so you can compare it with a new
              export, or edit it and upload it below. Codes are text, so leading zeros stay. Unedited, it uploads back with no
              changes.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadCurrent}
            disabled={downloading}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download current products (.xlsx)'}
          </button>
        </div>
        <div className="border-t border-gray-100" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Material master export</label>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileChange}
            disabled={starting}
            className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#00A651]/10 file:text-[#00A651] hover:file:bg-[#00A651]/20"
          />
          {file && <p className="mt-1 text-xs text-gray-500">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
        </div>
        {staging && (
          <div className="space-y-1">
            <div className="text-xs text-gray-600">
              {staging.retrying ? 'Network busy, retrying… ' : ''}Uploading part {Math.min(staging.sent + 1, staging.total)} of {staging.total}
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full bg-[#00A651] transition-all duration-300" style={{ width: `${Math.round((staging.sent / Math.max(staging.total, 1)) * 100)}%` }} />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={handlePreview}
          disabled={starting || !file}
          className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
        >
          {starting ? 'Uploading…' : 'Preview'}
        </button>
        <p className="text-xs text-gray-500">
          Accepted: the Power BI export as .xlsx or .csv (max {MAX_FILE_SIZE_MB} MB). Large files are sent in small parts because of
          the network limit in front of this environment; an 800 KB export takes about a minute.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">{error}</div>}

      {versions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Versions</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Every applied master, newest first. Restoring a version previews its file against today&apos;s catalogue; you
              apply it like any upload and it becomes the next version, so nothing in the history is lost.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Applied</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2">File</th>
                  <th className="px-4 py-2 text-right">Add</th>
                  <th className="px-4 py-2 text-right">Update</th>
                  <th className="px-4 py-2 text-right">Remove</th>
                  <th className="px-4 py-2 text-right">Back</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.runId} className={`border-b border-gray-50 ${v.runId === runId ? 'bg-[#00A651]/5' : ''}`}>
                    <td className="px-4 py-2 whitespace-nowrap font-medium">
                      v{v.version}
                      {v.version === latestVersion && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">current</span>}
                      {v.restoredFromVersion && <div className="text-xs font-normal text-gray-500">restore of v{v.restoredFromVersion}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(v.appliedAt)}</td>
                    <td className="px-4 py-2">{v.appliedBy ?? '—'}</td>
                    <td className="px-4 py-2">
                      {v.fileKept ? (
                        <button type="button" onClick={() => void handleDownloadVersionFile(v)} className="text-[#00A651] hover:underline text-left">
                          {v.fileName ?? 'file'}
                        </button>
                      ) : (
                        <span className="text-gray-500" title="Applied before files were kept">{v.fileName ?? '—'} (file not kept)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{money(v.counts?.create)}</td>
                    <td className="px-4 py-2 text-right">{money(v.counts?.update)}</td>
                    <td className="px-4 py-2 text-right">{money(v.counts?.retire)}</td>
                    <td className="px-4 py-2 text-right">{money(v.counts?.reactivate)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                      <button type="button" onClick={() => selectRun(v.runId)} className="text-xs text-gray-700 hover:text-gray-900 hover:underline">
                        Changes
                      </button>
                      <button
                        type="button"
                        disabled={!v.fileKept || v.version === latestVersion}
                        title={!v.fileKept ? 'The file of this version was not kept' : v.version === latestVersion ? 'This is the current version' : undefined}
                        onClick={() => {
                          setRestoreTarget(v);
                          setRestoreReason('');
                          setRestoreError(null);
                        }}
                        className="text-xs text-[#00A651] hover:underline disabled:text-gray-300 disabled:no-underline"
                      >
                        Restore…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Recent runs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="px-4 py-2">Started</th>
                  <th className="px-4 py-2">File</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2 text-right">Kept</th>
                  <th className="px-4 py-2 text-right">Add</th>
                  <th className="px-4 py-2 text-right">Update</th>
                  <th className="px-4 py-2 text-right">Remove</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => selectRun(r.id)}
                    className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${r.id === runId ? 'bg-[#00A651]/5' : ''}`}
                  >
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.startedAt)}</td>
                    <td className="px-4 py-2">
                      {r.fileName ?? r.source}
                      {r.source === 'restore' ? ' (restore)' : ''}
                      {r.mode === 'upsert-only' ? ' (old bulk import)' : ''}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status]}`}>
                        {r.version ? `v${r.version} · ` : ''}{STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2">{r.triggeredByName ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{money(r.counts?.kept)}</td>
                    <td className="px-4 py-2 text-right">{money(r.counts?.create)}</td>
                    <td className="px-4 py-2 text-right">{money(r.counts?.update)}</td>
                    <td className="px-4 py-2 text-right">{money(r.counts?.retire)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {runId && !run && <div className="text-sm text-gray-500">Loading run…</div>}

      {run && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              {runTitle(run)} — {run.fileName ?? run.source}
            </h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[run.status]}`}>{STATUS_LABEL[run.status]}</span>
            {busy && <span className="text-xs text-gray-500 animate-pulse">working…</span>}
            <span className="text-xs text-gray-500 ml-auto">
              {run.mode === 'upsert-only' ? 'Old bulk import: added and changed only' : 'Whole master: products it does not list are removed'}
              {run.appliedFilter ? ` · Report filter: ${run.appliedFilter}` : ''}
            </span>
          </div>

          {(run.restoredFromRunId || run.note) && (
            <div className="mx-4 mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-gray-800">
              {run.restoredFromRunId && <>Restore of {restoredFrom ? `v${restoredFrom.version}` : 'an earlier version'}. </>}
              {run.note && <>Reason: {run.note}</>}
            </div>
          )}

          {run.error && (
            <div className={`m-4 rounded-lg p-3 text-sm ${run.status === 'FAILED' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
              {run.error}
            </div>
          )}

          {counts && (
            <div className="p-4 border-b border-gray-100 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: 'Rows in file', value: counts.read, color: 'text-gray-700' },
                  { label: 'Kept', value: counts.kept, color: 'text-gray-700' },
                  { label: 'Add', value: counts.create, color: 'text-blue-700' },
                  { label: 'Update', value: counts.update, color: 'text-amber-700' },
                  { label: 'Remove', value: counts.retire, color: 'text-red-700' },
                  { label: 'Bring back', value: counts.reactivate, color: 'text-emerald-700' },
                  { label: 'Unchanged', value: counts.unchanged, color: 'text-green-700' },
                  { label: 'Skipped / invalid / held', value: `${counts.skippedByRule} / ${counts.invalid} / ${counts.held}`, color: 'text-gray-600' },
                ].map((card) => (
                  <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                    <div className={`text-xl font-bold ${card.color}`}>{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
                {Object.entries(counts.perBusinessGroup).map(([bg, c]) => (
                  <span key={bg}>
                    <strong>{bg}</strong>: {c.kept.toLocaleString()} in file · {c.activeBefore.toLocaleString()} active before · +{c.create} / ~{c.update} / −{c.retire} / ↺{c.reactivate}
                  </span>
                ))}
                {(counts.manualRetire ?? 0) > 0 && <span>{counts.manualRetire} of the removals were created by hand in the app.</span>}
                {counts.keepInactive > 0 && <span>{counts.keepInactive} product(s) deactivated by an admin stay deactivated.</span>}
                {(counts.protectedInvalid ?? 0) > 0 && <span>{counts.protectedInvalid} product(s) left alone because their row failed validation.</span>}
              </div>
              {written && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-900">
                  Written: {written.created} added, {written.updated} updated, {written.reactivated} brought back, {written.retired} removed,{' '}
                  {written.keptInactiveUpdated} deactivated updated · {written.historyRows} history rows ({written.baselineRows} baselines).
                </div>
              )}
            </div>
          )}

          {run.guards && run.guards.length > 0 && (
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Checks</h3>
              <ul className="space-y-1 text-sm">
                {run.guards.map((g) => (
                  <li key={g.name} className="flex gap-2">
                    <span className={`shrink-0 w-12 text-xs font-semibold ${g.ok ? 'text-green-700' : g.severity === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>
                      {g.ok ? 'OK' : g.severity === 'fail' ? 'FAIL' : 'WARN'}
                    </span>
                    <span className="text-gray-800">{g.detail}</span>
                  </li>
                ))}
              </ul>
              {run.guardOverrideReason && <p className="mt-2 text-xs text-amber-700">Applied over a failed check. Reason: {run.guardOverrideReason}</p>}
            </div>
          )}

          {run.samples?.errors && run.samples.errors.length > 0 && (
            <div className="p-4 border-b border-gray-100 max-h-48 overflow-y-auto">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Validation errors{run.samples.totalErrorCount && run.samples.totalErrorCount > run.samples.errors.length ? ` (first ${run.samples.errors.length} of ${run.samples.totalErrorCount})` : ''}
              </h3>
              <table className="min-w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b"><th className="py-1 pr-3">Row</th><th className="py-1 pr-3">Column</th><th className="py-1">Message</th></tr></thead>
                <tbody>
                  {run.samples.errors.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50"><td className="py-1 pr-3 font-mono">{e.row}</td><td className="py-1 pr-3">{e.column}</td><td className="py-1">{e.message}{e.value ? ` (${e.value})` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(run.status === 'PREVIEWED' || run.status === 'APPLIED') && counts && (
            <>
              <div className="border-b border-gray-100 flex overflow-x-auto">
                {ACTION_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === t.id ? 'border-[#00A651] text-[#00A651] font-medium' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
                  >
                    {t.label} <span className={`ml-1 ${t.tone}`}>{((counts[t.countKey] as number | undefined) ?? 0).toLocaleString()}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || rowsTotal === 0}
                  className="ml-auto px-4 py-2 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-40"
                >
                  {exporting ? 'Exporting…' : 'Download this list (.xlsx)'}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-4 py-2">BU</th>
                      <th className="px-4 py-2">Code</th>
                      <th className="px-4 py-2">SAP</th>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2 text-right">Contract</th>
                      <th className="px-4 py-2 text-right">List</th>
                      <th className="px-4 py-2">Group</th>
                      <th className="px-4 py-2">{tab === 'UPDATE' || tab === 'REACTIVATE' || tab === 'KEEP_INACTIVE' ? 'Changes' : 'Reason'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsLoading && rows.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">Loading…</td></tr>
                    )}
                    {!rowsLoading && rows.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">Nothing in this list.</td></tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50">
                        <td className="px-4 py-2">{r.businessGroup}</td>
                        <td className="px-4 py-2 font-mono">{r.code}</td>
                        <td className="px-4 py-2 font-mono text-gray-600">{r.sapCode}</td>
                        <td className="px-4 py-2">{r.productNameLocal || r.name}</td>
                        <td className="px-4 py-2 text-right">{money(r.price)}</td>
                        <td className="px-4 py-2 text-right">{money(r.listPrice)}</td>
                        <td className="px-4 py-2 text-gray-600">{r.priceGroup ?? ''}</td>
                        <td className="px-4 py-2 text-gray-700 max-w-md">
                          {tab === 'UPDATE' || tab === 'REACTIVATE' || tab === 'KEEP_INACTIVE'
                            ? changesText(r.fieldChanges) || r.reason || ''
                            : r.reason || changesText(r.fieldChanges)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rowsTotal > PAGE && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-600">
                  <span>{rowsOffset + 1}–{Math.min(rowsOffset + PAGE, rowsTotal)} of {rowsTotal.toLocaleString()}</span>
                  <div className="space-x-2">
                    <button type="button" disabled={rowsOffset === 0 || rowsLoading} onClick={() => void loadRows(run.id, tab, Math.max(0, rowsOffset - PAGE))} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={rowsOffset + PAGE >= rowsTotal || rowsLoading} onClick={() => void loadRows(run.id, tab, rowsOffset + PAGE)} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
              {run.status === 'APPLIED' && rowsTotal === 0 && !rowsLoading && (
                <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                  Lists are kept for the most recent runs only; the changes this version wrote are below.
                </p>
              )}
            </>
          )}

          {run.status === 'PREVIEWED' && (
            <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-3">
              {blocked && (
                <div>
                  <label className="block text-sm font-medium text-red-800 mb-1">
                    A check failed. To apply anyway, say why (recorded on the run):
                  </label>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. Confirmed with Vidhi-san that the LSG removals are expected"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
              {applyError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{applyError}</div>}
              <button
                type="button"
                onClick={() => setShowApplyConfirm(true)}
                disabled={blocked && overrideReason.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
              >
                Apply this run
              </button>
            </div>
          )}

          {run.status === 'APPLIED' && history.length > 0 && (
            <div className="border-t border-gray-100">
              <div className="p-4 bg-gray-50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Changes written by this version ({historyTotal.toLocaleString()} history rows)</h3>
                <Link to="/admin/change-history" className="text-xs text-[#00A651] hover:underline">Open change history</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-4 py-2">BU</th>
                      <th className="px-4 py-2">Code</th>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Change</th>
                      <th className="px-4 py-2">v</th>
                      <th className="px-4 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-gray-50">
                        <td className="px-4 py-2">{h.businessGroup}</td>
                        <td className="px-4 py-2 font-mono">{h.code}</td>
                        <td className="px-4 py-2">{h.name}</td>
                        <td className="px-4 py-2">{h.changeType}</td>
                        <td className="px-4 py-2">{h.version}</td>
                        <td className="px-4 py-2 text-gray-700 max-w-md">{h.fieldChanges && h.fieldChanges.length > 0 ? changesText(h.fieldChanges) : h.changeReason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyTotal > PAGE && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-600">
                  <span>{historyOffset + 1}–{Math.min(historyOffset + PAGE, historyTotal)} of {historyTotal.toLocaleString()}</span>
                  <div className="space-x-2">
                    <button type="button" disabled={historyOffset === 0} onClick={() => void loadHistory(run.id, Math.max(0, historyOffset - PAGE))} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={historyOffset + PAGE >= historyTotal} onClick={() => void loadHistory(run.id, historyOffset + PAGE)} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showApplyConfirm && run && counts && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Apply {run.restoredFromRunId ? 'this restore' : 'this run'}?</h3>
            <p className="text-sm text-gray-700">
              This will add <strong>{counts.create.toLocaleString()}</strong>, update <strong>{counts.update.toLocaleString()}</strong>, bring back{' '}
              <strong>{counts.reactivate.toLocaleString()}</strong> and remove <strong>{counts.retire.toLocaleString()}</strong> products in one
              transaction, write a history row for each, and become version {(latestVersion ?? 0) + 1}. Removed products disappear from
              product selection, the export and the Products page; existing requests are unchanged.
            </p>
            {blocked && <p className="text-sm text-amber-800">Reason recorded: {overrideReason.trim()}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowApplyConfirm(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancel</button>
              <button type="button" onClick={handleApply} className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44]">Apply</button>
            </div>
          </div>
        </div>
      )}

      {restoreTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Restore version {restoreTarget.version}?</h3>
            <p className="text-sm text-gray-700">
              This previews v{restoreTarget.version}&apos;s file ({restoreTarget.fileName ?? 'file'}) against the catalogue as it is now.
              Nothing changes until you apply that preview. When applied, products v{restoreTarget.version} listed come back with their
              prices, products added since are removed, and products an admin deactivated stay deactivated. It becomes the next
              version; the versions in between stay in the history.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Why are you restoring it? (recorded)</label>
              <input
                type="text"
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder="e.g. v8 was exported with the wrong report filter"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {restoreError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{restoreError}</div>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setRestoreTarget(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancel</button>
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={restoring || restoreReason.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
              >
                {restoring ? 'Starting…' : 'Preview the restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
