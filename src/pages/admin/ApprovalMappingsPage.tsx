/**
 * Admin: CRUD for approval mapping rows (ZSAM, ZNC Installation, ZNC Claim, ZINT QC).
 * Same PostgreSQL tables as Bulk import → hierarchy files.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/api.service';
import { SearchableDirectoryField } from '../../components/admin/SearchableDirectoryField';
import { SearchableRequesterGroupField } from '../../components/admin/SearchableRequesterGroupField';
import { OffboardPersonPanel } from '../../components/admin/OffboardPersonPanel';

export type MappingFormType = 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return';

const TABS: { id: MappingFormType; label: string; short: string }[] = [
  { id: 'zsam', label: 'ZSAM', short: 'ZSAM' },
  { id: 'znc-installation', label: 'ZNC Installation', short: 'ZNC Inst' },
  { id: 'znc-claim', label: 'ZNC Claim', short: 'Claim' },
  { id: 'zint', label: 'ZINT QC', short: 'ZINT' },
  { id: 'return', label: 'Return', short: 'Return' },
];

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

const inputClass =
  'border border-gray-200 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-[#00A651]/30 focus:border-[#00A651] outline-none';
const labelClass = 'block text-xs font-medium text-gray-600 mb-0.5';

/** Modal + table: stable labels (avoid camelCase fragments). */
const APPROVER_FIELD_LABELS: Record<string, string> = {
  salesManager: 'Sales manager (SM)',
  districtSalesManager: 'District sales manager (DSM)',
  nationalSalesManager: 'National sales manager (NSM)',
  localFinanceController: 'Local finance controller (LFC)',
  directorCommercialManager: 'Director commercial manager (DCM)',
  technicalManager: 'Technical manager (TM)',
  nationalTSManager: 'National TS manager (NTSM)',
  csPsManager: 'CS/PS manager',
  raqaManager: 'RA/QA manager',
  globalRaqaManager: 'Global RA/QA manager',
  reviewer: 'Reviewer (service only, before approvals)',
  firstApprover: '1st Approver',
  secondApprover: '2nd Approver',
  finalApprover: 'Final Approver',
  // Service managers, from the two extra matrix columns. Filled for non-service groups only and
  // applied to service-related returns; titles are still being decided, hence the numbering.
  fourthApprover: '4th Approver (service)',
  fifthApprover: '5th Approver (service)',
  teamName: 'Team Name',
};

type TableCol = { key: string; label: string };

function tableColumnsForFormType(ft: MappingFormType): TableCol[] {
  switch (ft) {
    case 'zsam':
      return [
        { key: 'salesManager', label: 'SM' },
        { key: 'districtSalesManager', label: 'DSM' },
        { key: 'nationalSalesManager', label: 'NSM' },
        { key: 'localFinanceController', label: 'LFC' },
        { key: 'directorCommercialManager', label: 'DCM' },
      ];
    case 'znc-installation':
      return [
        { key: 'technicalManager', label: 'TM' },
        { key: 'nationalTSManager', label: 'NTSM' },
        { key: 'salesManager', label: 'SM' },
        { key: 'districtSalesManager', label: 'DSM' },
        { key: 'nationalSalesManager', label: 'NSM' },
        { key: 'localFinanceController', label: 'LFC' },
        { key: 'directorCommercialManager', label: 'DCM' },
      ];
    case 'znc-claim':
    case 'zint':
      return [
        { key: 'salesManager', label: 'SM' },
        { key: 'districtSalesManager', label: 'DSM' },
        { key: 'nationalSalesManager', label: 'NSM' },
        { key: 'csPsManager', label: 'CS/PS' },
        { key: 'raqaManager', label: 'RA/QA' },
        { key: 'globalRaqaManager', label: 'Global RA/QA' },
      ];
    case 'return':
      return [
        { key: 'teamName', label: 'Team' },
        { key: 'reviewer', label: 'Reviewer' },
        { key: 'firstApprover', label: '1st' },
        { key: 'secondApprover', label: '2nd' },
        { key: 'finalApprover', label: 'Final' },
        { key: 'fourthApprover', label: '4th (svc)' },
        { key: 'fifthApprover', label: '5th (svc)' },
      ];
  }
}

function cellText(row: Record<string, unknown>, key: string): string {
  const v = str(row[key]).trim();
  return v || '—';
}

type SortDir = 'asc' | 'desc';

function SortColHeader(props: {
  label: string;
  columnKey: string;
  activeSortBy: string;
  sortDir: SortDir;
  onSort: (columnKey: string) => void;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { label, columnKey, activeSortBy, sortDir, onSort, title, className, disabled } = props;
  const active = activeSortBy === columnKey;
  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? `Sort by ${label}`}
      onClick={() => onSort(columnKey)}
      className={
        'inline-flex items-center gap-1 text-left w-full hover:bg-gray-100/80 rounded px-0.5 -mx-0.5 disabled:opacity-40 disabled:pointer-events-none ' +
        (className ?? '')
      }
    >
      <span className="font-medium text-gray-700">{label}</span>
      {active ? (
        <span className="text-[#00A651] text-[10px] leading-none shrink-0" aria-hidden>
          {sortDir === 'asc' ? '▲' : '▼'}
        </span>
      ) : (
        <span className="text-gray-300 text-[10px] leading-none shrink-0 opacity-70" aria-hidden>
          ↕
        </span>
      )}
    </button>
  );
}

function trimOrNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

type DirectoryLink = { id: string; code: string; requesterGroupId: string; groupName: string };

function parseDirectoryLinks(row: Record<string, unknown>): DirectoryLink[] {
  const raw = row.requesterDirectoryLinks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is DirectoryLink =>
      x != null &&
      typeof x === 'object' &&
      typeof (x as DirectoryLink).id === 'string' &&
      typeof (x as DirectoryLink).code === 'string' &&
      typeof (x as DirectoryLink).requesterGroupId === 'string' &&
      typeof (x as DirectoryLink).groupName === 'string'
  );
}

/** Same shape as modal create/update for admin API. */
function buildPayloadFromRow(row: Record<string, unknown>, ft: MappingFormType): Record<string, unknown> {
  if (ft === 'return') {
    const rawBu = str(row.businessUnit).toUpperCase();
    const bu = rawBu === 'LSG' ? 'LSG' : rawBu === 'SERVICE' ? 'SERVICE' : 'CDG';
    return {
      requesterName: str(row.requesterName).trim(),
      businessUnit: bu,
      teamName: trimOrNull(str(row.teamName)),
      reviewer: trimOrNull(str(row.reviewer)),
      firstApprover: trimOrNull(str(row.firstApprover)),
      secondApprover: trimOrNull(str(row.secondApprover)),
      finalApprover: trimOrNull(str(row.finalApprover)),
      fourthApprover: trimOrNull(str(row.fourthApprover)),
      fifthApprover: trimOrNull(str(row.fifthApprover)),
    };
  }
  const bu = str(row.businessUnit) === 'LSG' ? 'LSG' : 'CDG';
  const payload: Record<string, unknown> = {
    requesterName: str(row.requesterName).trim(),
    businessUnit: bu,
    salesManager: trimOrNull(str(row.salesManager)),
    districtSalesManager: trimOrNull(str(row.districtSalesManager)),
    nationalSalesManager: trimOrNull(str(row.nationalSalesManager)),
  };
  if (ft === 'zsam') {
    payload.localFinanceController = trimOrNull(str(row.localFinanceController));
    payload.directorCommercialManager = trimOrNull(str(row.directorCommercialManager));
  } else if (ft === 'znc-installation') {
    payload.technicalManager = trimOrNull(str(row.technicalManager));
    payload.nationalTSManager = trimOrNull(str(row.nationalTSManager));
    payload.localFinanceController = trimOrNull(str(row.localFinanceController));
    payload.directorCommercialManager = trimOrNull(str(row.directorCommercialManager));
  } else {
    payload.csPsManager = trimOrNull(str(row.csPsManager));
    payload.raqaManager = trimOrNull(str(row.raqaManager));
    payload.globalRaqaManager = trimOrNull(str(row.globalRaqaManager));
  }
  return payload;
}

const TABLE_PAGE_LIMIT = 30;
const SPREADSHEET_PAGE_LIMIT = 100;

export default function ApprovalMappingsPage() {
  const [formType, setFormType] = React.useState<MappingFormType>('zsam');
  const [businessUnit, setBusinessUnit] = React.useState<'CDG' | 'LSG' | 'SERVICE' | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [appliedSearch, setAppliedSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  /** Spreadsheet: larger page size, inline cells; Table: compact read-only. */
  const [uiMode, setUiMode] = React.useState<'spreadsheet' | 'table'>('spreadsheet');
  const limit = uiMode === 'spreadsheet' ? SPREADSHEET_PAGE_LIMIT : TABLE_PAGE_LIMIT;

  const [rows, setRows] = React.useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [exportingMatrix, setExportingMatrix] = React.useState(false);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Record<string, string>>({});
  /** Requesters directory rows for this name + BU (from API); used to pre-fill team + sales rep code in the modal. */
  const [modalDirectoryLinks, setModalDirectoryLinks] = React.useState<DirectoryLink[]>([]);
  const [savingRowId, setSavingRowId] = React.useState<string | null>(null);
  /** One requester across all four mapping tables (GET /admin/approval-mappings/summary). */
  const [coverageInput, setCoverageInput] = React.useState('');
  const [coverageLoading, setCoverageLoading] = React.useState(false);
  const [coverageError, setCoverageError] = React.useState<string | null>(null);
  const [coverageResult, setCoverageResult] = React.useState<Awaited<
    ReturnType<typeof adminApi.getAdminApprovalMappingSummary>
  > | null>(null);
  const [sort, setSort] = React.useState<{ by: string; dir: SortDir }>({
    by: 'requesterName',
    dir: 'asc',
  });
  const sortBy = sort.by;
  const sortDir = sort.dir;

  /** Server always uses a DB column; Team is sorted on the client after load. */
  const serverSortBy = sort.by === 'requesterTeamNames' ? 'requesterName' : sort.by;
  const serverSortDir: SortDir = sort.by === 'requesterTeamNames' ? 'asc' : sort.dir;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const runCoverageLookup = async () => {
    const q = coverageInput.trim();
    if (!q) return;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const data = await adminApi.getAdminApprovalMappingSummary(q);
      setCoverageResult(data);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      setCoverageError(msg || 'Lookup failed');
      setCoverageResult(null);
    } finally {
      setCoverageLoading(false);
    }
  };

  /** Switch tab + filters to edit that mapping type; optional BU from a row. */
  const jumpToMappingTab = (ft: MappingFormType, businessUnitFromRow: string) => {
    const name = (coverageResult?.normalizedName ?? coverageInput).trim();
    if (!name) return;
    setFormType(ft);
    setSearchInput(name);
    setAppliedSearch(name);
    const bu = businessUnitFromRow.trim().toUpperCase();
    if (bu === 'CDG' || bu === 'LSG' || bu === 'SERVICE') setBusinessUnit(bu);
    else setBusinessUnit('');
    setPage(1);
    showToast(`Showing ${TABS.find((t) => t.id === ft)?.label ?? ft} — filter: “${name}”`);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAdminApprovalMappings(formType, {
        page,
        limit,
        ...(businessUnit ? { businessUnit } : {}),
        ...(appliedSearch.trim() ? { search: appliedSearch.trim() } : {}),
        sortBy: serverSortBy,
        sortDir: serverSortDir,
      });
      setRows(res.rows);
      setTotal(res.total);
      // #region agent log
      if (formType === 'znc-installation') {
        const approverKeys = ['salesManager', 'districtSalesManager', 'nationalSalesManager'] as const;
        fetch('http://127.0.0.1:7541/ingest/00000000-0000-4000-8000-a0a828311efb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '372d2a' },
          body: JSON.stringify({
            sessionId: '372d2a',
            location: 'ApprovalMappingsPage.tsx:load',
            message: 'znc-installation client load',
            data: {
              filterBu: businessUnit || '(all)',
              appliedSearch: appliedSearch.trim() ? '(set)' : '(none)',
              page,
              limit,
              total: res.total,
              rowsLen: res.rows.length,
              approverFilled: Object.fromEntries(
                approverKeys.map((k) => [k, res.rows.filter((r) => str(r[k]).trim()).length])
              ),
            },
            timestamp: Date.now(),
            hypothesisId: 'D,E',
          }),
        }).catch(() => {});
      }
      // #endregion
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      setError(msg || 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  }, [formType, page, limit, businessUnit, appliedSearch, serverSortBy, serverSortDir]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    setSort({ by: 'requesterName', dir: 'asc' });
  }, [formType]);

  React.useEffect(() => {
    setPage(1);
  }, [formType, businessUnit, uiMode, serverSortBy, serverSortDir]);

  const toggleSort = React.useCallback((columnKey: string) => {
    setSort((s) =>
      s.by === columnKey ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: columnKey, dir: 'asc' }
    );
  }, []);

  const displayRows = React.useMemo(() => {
    if (sortBy !== 'requesterTeamNames') return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const ta = str(a.requesterTeamNames);
      const tb = str(b.requesterTeamNames);
      const ea = !ta.trim();
      const eb = !tb.trim();
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      return dir * ta.localeCompare(tb, undefined, { sensitivity: 'base', numeric: true });
    });
  }, [rows, sortBy, sortDir]);

  const saveRowInline = async (rowId: string, rowSnapshot?: Record<string, unknown>) => {
    const row = rowSnapshot ?? rows.find((r) => str(r.id) === rowId);
    if (!row) return;
    setSavingRowId(rowId);
    setError(null);
    try {
      const payload = buildPayloadFromRow(row, formType);
      await adminApi.updateAdminApprovalMapping(formType, rowId, payload);
      await load();
    } catch (err: unknown) {
      const data =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
          : undefined;
      setError(data?.error || 'Save failed');
      await load();
    } finally {
      setSavingRowId(null);
    }
  };

  /**
   * The whole matrix, not the page — and in the columns the bulk importer accepts.
   *
   * The page-scoped export beside this one is for looking at: its header mixes naming styles and
   * includes derived columns (the requester's teams, their rep codes) that no importer can write
   * back. This one is the file Japan edits and re-uploads, so it has to be exactly what the
   * importer reads.
   */
  const exportWholeMatrix = async () => {
    setExportingMatrix(true);
    try {
      const { blob, filename } = await adminApi.exportReturnApprovalMatrix();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Matrix exported');
    } catch {
      setError('Could not export the matrix.');
    } finally {
      setExportingMatrix(false);
    }
  };

  const exportCurrentPageCsv = () => {
    const cols = tableCols;
    const csvEscape = (v: string) => {
      if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const header = ['requester_name', 'business_unit', 'requester_team', 'sales_rep_code', ...cols.map((c) => c.key)].join(',');
    const lines = displayRows.map((r) =>
      [
        csvEscape(str(r.requesterName)),
        csvEscape(str(r.businessUnit)),
        csvEscape(str(r.requesterTeamNames ?? '')),
        csvEscape(str(r.requesterRepCodesDisplay ?? '')),
        ...cols.map((c) => csvEscape(str(r[c.key] ?? ''))),
      ].join(',')
    );
    const body = `\uFEFF${header}\n${lines.join('\n')}`;
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `approval-mappings-${formType}-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('CSV downloaded');
  };

  const openCreate = () => {
    setEditingId(null);
    setModalDirectoryLinks([]);
    setForm({
      requesterName: '',
      businessUnit: 'CDG',
      requesterGroupId: '',
      requesterGroupName: '',
      salesRepCode: '',
      salesManager: '',
      districtSalesManager: '',
      nationalSalesManager: '',
      localFinanceController: '',
      directorCommercialManager: '',
      technicalManager: '',
      nationalTSManager: '',
      csPsManager: '',
      raqaManager: '',
      globalRaqaManager: '',
    });
    setModalOpen(true);
  };

  /**
   * Every approver field a row can carry, for the edit modal.
   *
   * Return rows keep their approvers in their own columns; listing only the sample fields here left
   * the return boxes blank on edit, and save() then wrote those blanks back over the row.
   */
  const approverFieldsFromRow = (row: Record<string, unknown>) => ({
    salesManager: str(row.salesManager),
    districtSalesManager: str(row.districtSalesManager),
    nationalSalesManager: str(row.nationalSalesManager),
    localFinanceController: str(row.localFinanceController),
    directorCommercialManager: str(row.directorCommercialManager),
    technicalManager: str(row.technicalManager),
    nationalTSManager: str(row.nationalTSManager),
    csPsManager: str(row.csPsManager),
    raqaManager: str(row.raqaManager),
    globalRaqaManager: str(row.globalRaqaManager),
    teamName: str(row.teamName),
    reviewer: str(row.reviewer),
    firstApprover: str(row.firstApprover),
    secondApprover: str(row.secondApprover),
    finalApprover: str(row.finalApprover),
    fourthApprover: str(row.fourthApprover),
    fifthApprover: str(row.fifthApprover),
  });

  const populateFormFromRow = (row: Record<string, unknown>) => {
    setEditingId(str(row.id));
    const links = parseDirectoryLinks(row);
    setModalDirectoryLinks(links);
    if (links.length === 1) {
      setForm({
        requesterName: str(row.requesterName),
        businessUnit: str(row.businessUnit) || 'CDG',
        requesterGroupId: links[0].requesterGroupId,
        requesterGroupName: links[0].groupName,
        salesRepCode: links[0].code,
        ...approverFieldsFromRow(row),
      });
      return;
    }
    setForm({
      requesterName: str(row.requesterName),
      businessUnit: str(row.businessUnit) || 'CDG',
      requesterGroupId: '',
      requesterGroupName: '',
      salesRepCode: '',
      ...approverFieldsFromRow(row),
    });
  };

  const openEdit = (row: Record<string, unknown>) => {
    populateFormFromRow(row);
    setModalOpen(true);
  };

  /** Open the edit modal for a row from another tab (e.g. Full picture panel). */
  const openEditFromCoverage = (ft: MappingFormType, row: Record<string, unknown>) => {
    setFormType(ft);
    populateFormFromRow(row);
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // `form` whole, not a hand-listed subset: it holds every field the modal renders, and
    // buildPayloadFromRow already picks the ones this form type sends. Listing them here meant the
    // return approvers were never sent, so saving a return mapping cleared them.
    const payload: Record<string, unknown> = buildPayloadFromRow(form, formType);
    if (form.requesterGroupId?.trim()) {
      payload.requesterGroupId = form.requesterGroupId.trim();
      payload.salesRepCode = (form.salesRepCode ?? '').trim();
    }

    try {
      if (editingId) {
        await adminApi.updateAdminApprovalMapping(formType, editingId, payload);
        showToast('Updated');
      } else {
        await adminApi.createAdminApprovalMapping(formType, payload);
        showToast('Created');
      }
      setModalOpen(false);
      await load();
      if (coverageInput.trim()) {
        try {
          const fresh = await adminApi.getAdminApprovalMappingSummary(coverageInput.trim());
          setCoverageResult(fresh);
        } catch {
          /* ignore refresh errors */
        }
      }
    } catch (err: unknown) {
      const data =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
          : undefined;
      setError(data?.error || 'Save failed');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this mapping row?')) return;
    setError(null);
    try {
      await adminApi.deleteAdminApprovalMapping(formType, id);
      showToast('Deleted');
      await load();
    } catch (err: unknown) {
      const data =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
          : undefined;
      setError(data?.error || 'Delete failed');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const tableCols = tableColumnsForFormType(formType);
  /** Requester + BU + Team + Rep code (read-only) + approver cols + Actions */
  const tableColSpan = 5 + tableCols.length;

  return (
    <div className="max-w-7xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{toast}</div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Approval mappings</h1>
        <p className="text-gray-600 text-sm mt-1">
          Edit rows in the same tables as <strong>Bulk import</strong> hierarchy files (per requester + CDG/LSG). Names are normalized like imports.
        </p>
        {formType === 'zsam' && (
          <p className="text-gray-600 text-sm mt-2 border-l-4 border-[#00A651]/40 pl-3">
            For <strong>ZSAM</strong>, <strong>team</strong> and <strong>sales rep code</strong> live on{' '}
            <Link to="/admin/requesters" className="text-[#00A651] font-medium hover:underline">
              Requesters
            </Link>
            — use <strong>Requesters</strong> in each row below to open the directory filtered to that name.
          </p>
        )}
        {formType === 'znc-installation' && (
          <p className="text-gray-600 text-sm mt-2 border-l-4 border-[#00A651]/40 pl-3">
            <strong>ZNC Installation</strong> is keyed by <strong>requester + CDG or LSG</strong>, not by name alone. Teams like Technical Support(CDG) vs Technical Support(LSG) can share the same people with different approver columns in the sheet — you should see <strong>two rows</strong> (different <strong>BU</strong>) when both apply. Use the{' '}
            <strong>Business unit</strong> filter and{' '}
            <Link to="/admin/requesters" className="text-[#00A651] font-medium hover:underline">
              Requesters
            </Link>{' '}
            (team / rep) to match the context of each request.
          </p>
        )}
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Full picture — one requester</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Each tab below is a <strong>separate</strong> database table (ZSAM, ZNC Installation, ZNC Claim, ZINT). Enter a name to see <strong>all rows</strong> for that person in every table, including legacy <strong>empty BU</strong> duplicates. Use <strong>Edit</strong> to change a row in the modal without switching tabs, or <strong>Open tab</strong> to work in the spreadsheet below.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[14rem]">
            <SearchableDirectoryField
              showHint={false}
              label="Requester name (exact / import style)"
              kind="requester"
              value={coverageInput}
              onChange={setCoverageInput}
              onEnterPress={() => void runCoverageLookup()}
            />
          </div>
          <button
            type="button"
            disabled={coverageLoading || !coverageInput.trim()}
            className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-40"
            onClick={() => void runCoverageLookup()}
          >
            {coverageLoading ? 'Loading…' : 'Look up all tables'}
          </button>
        </div>
        {coverageError && <p className="text-sm text-red-700">{coverageError}</p>}
        {coverageResult && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-700">
                  <th className="px-3 py-2 font-semibold">Sample / table</th>
                  <th className="px-3 py-2 font-semibold">Rows</th>
                  <th className="px-3 py-2 font-semibold">BU, team, edit</th>
                  <th className="px-3 py-2 font-semibold">Note</th>
                  <th className="px-3 py-2 font-semibold">Open tab</th>
                </tr>
              </thead>
              <tbody>
                {(
                  ['zsam', 'zncInstallation', 'zncClaim', 'zint', 'return'] as const
                ).map((key) => {
                  const block = coverageResult.tables[key];
                  if (!block) return null;
                  const primaryBu = str((block.rows[0] as { businessUnit?: string })?.businessUnit);
                  return (
                    <tr key={key} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="px-3 py-2 font-medium text-slate-900">{block.label}</td>
                      <td className="px-3 py-2 text-slate-800">{block.count}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[16rem]">
                        {block.rows.length === 0 ? (
                          <span className="text-slate-500">No mapping — add from the tab below</span>
                        ) : (
                          <ul className="space-y-1.5">
                            {block.rows.map((r) => {
                              const buRaw = str((r as { businessUnit?: string }).businessUnit);
                              const buLabel = buRaw.trim() ? buRaw : '(empty BU)';
                              const teams = str((r as { requesterTeamNames?: string }).requesterTeamNames);
                              const repCodes = str((r as { requesterRepCodesDisplay?: string }).requesterRepCodesDisplay);
                              return (
                                <li key={str((r as { id?: string }).id)} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="font-mono text-[11px] text-slate-800">{buLabel}</span>
                                  {teams ? (
                                    <span className="text-slate-500 text-[11px]">Team: {teams}</span>
                                  ) : null}
                                  {repCodes ? (
                                    <span className="text-slate-500 text-[11px] font-mono">Rep: {repCodes}</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="text-[#00A651] font-medium hover:underline text-[11px]"
                                    onClick={() => openEditFromCoverage(block.formType, r)}
                                  >
                                    Edit
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 text-amber-800">
                        {block.duplicateLegacyBuWarning ? 'Legacy empty BU + CDG/LSG — review duplicates' : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-[#00A651] font-medium hover:underline"
                          onClick={() => jumpToMappingTab(block.formType, primaryBu)}
                        >
                          Open tab
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">
              Normalized name: <span className="font-mono text-slate-800">{coverageResult.normalizedName}</span>
            </p>
          </div>
        )}
      </div>

      <OffboardPersonPanel onApplied={() => void load()} />

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFormType(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                formType === t.id ? 'bg-[#00A651] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className={labelClass}>Business unit</label>
            <select
              className={inputClass + ' w-40'}
              value={businessUnit}
              onChange={(e) => setBusinessUnit(e.target.value as 'CDG' | 'LSG' | 'SERVICE' | '')}
            >
              <option value="">All</option>
              <option value="CDG">CDG</option>
              <option value="LSG">LSG</option>
              {formType === 'return' && <option value="SERVICE">SERVICE</option>}
            </select>
          </div>
          <div className="flex-1 min-w-[12rem]">
            <SearchableDirectoryField
              showHint={false}
              label="Search requester name"
              kind="requester"
              value={searchInput}
              onChange={setSearchInput}
              onEnterPress={() => {
                setAppliedSearch(searchInput.trim());
                setPage(1);
              }}
            />
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm hover:bg-gray-200"
            onClick={() => {
              setAppliedSearch(searchInput.trim());
              setPage(1);
            }}
          >
            Apply
          </button>
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            <button
              type="button"
              onClick={() => setUiMode('spreadsheet')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                uiMode === 'spreadsheet' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Spreadsheet
            </button>
            <button
              type="button"
              onClick={() => setUiMode('table')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                uiMode === 'table' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Table
            </button>
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-800 text-sm hover:bg-gray-50 disabled:opacity-40"
            disabled={rows.length === 0 || loading}
            onClick={exportCurrentPageCsv}
          >
            Export CSV (this page)
          </button>
          {formType === 'return' && (
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-[#00A651] text-[#00785c] text-sm font-medium hover:bg-[#00A651]/5 disabled:opacity-40"
              disabled={exportingMatrix || loading}
              onClick={() => void exportWholeMatrix()}
              title="Every row, in the columns Bulk Import reads back"
            >
              {exportingMatrix ? 'Exporting…' : 'Export whole matrix (for bulk edit)'}
            </button>
          )}
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#009048] ml-auto"
            onClick={openCreate}
          >
            + Add row
          </button>
        </div>

        {uiMode === 'spreadsheet' && (
          <p className="text-xs text-gray-500">
            Editable cells match bulk import fields. Click a cell, edit, then Tab or click away to save. Requester, BU, and optional <strong>Team</strong> are set via <strong>Add row</strong> / <strong>Edit</strong>.{' '}
            <strong>Team</strong> in the table comes from <Link to="/admin/requesters">Requesters</Link> (name + BU); use the modal to add directory membership when needed.
          </p>
        )}
        <p className="text-xs text-gray-500">
          <strong>Sort:</strong> click a column header (▲/▼). <strong>Team</strong> sorts this page only; other columns are sorted on the server for pagination.
        </p>

        {error && <div className="bg-red-50 text-red-800 text-sm px-3 py-2 rounded-lg border border-red-100">{error}</div>}

        <div
          className={`border border-gray-100 rounded-xl ${
            uiMode === 'spreadsheet' ? 'max-h-[min(72vh,880px)] overflow-auto' : 'overflow-x-auto'
          }`}
        >
          <table className="min-w-full text-sm border-collapse">
            <thead className={uiMode === 'spreadsheet' ? 'sticky top-0 z-20 shadow-sm' : ''}>
              <tr className="bg-gray-50 text-left text-gray-600">
                <th
                  className={`px-2 py-2 whitespace-nowrap border-b border-gray-200 ${
                    uiMode === 'spreadsheet' ? 'sticky left-0 z-30 bg-gray-50 min-w-[9rem] border-r border-gray-100' : ''
                  }`}
                >
                  <SortColHeader
                    label="Requester"
                    columnKey="requesterName"
                    activeSortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    title="Sort by requester name"
                    disabled={loading}
                  />
                </th>
                <th
                  className={`px-2 py-2 border-b border-gray-200 ${
                    uiMode === 'spreadsheet' ? 'sticky left-[9rem] z-30 bg-gray-50 w-[3.25rem] border-r border-gray-100' : ''
                  }`}
                >
                  <SortColHeader
                    label="BU"
                    columnKey="businessUnit"
                    activeSortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    disabled={loading}
                  />
                </th>
                <th
                  className={`px-2 py-2 border-b border-gray-200 text-left min-w-[8rem] max-w-[14rem] ${
                    uiMode === 'spreadsheet'
                      ? 'sticky left-[12.25rem] z-30 bg-gray-50 border-r border-gray-100'
                      : ''
                  }`}
                >
                  <SortColHeader
                    label="Team"
                    columnKey="requesterTeamNames"
                    activeSortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    title="Sort by team (this page only; from Requesters)"
                    disabled={loading}
                  />
                </th>
                <th className="px-2 py-2 font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap text-left min-w-[5.5rem]">
                  Rep code
                </th>
                {tableCols.map((c) => (
                  <th
                    key={c.key}
                    className="px-2 py-2 whitespace-nowrap border-b border-gray-200 min-w-[7rem]"
                    title={APPROVER_FIELD_LABELS[c.key] ?? c.key}
                  >
                    <SortColHeader
                      label={c.label}
                      columnKey={c.key}
                      activeSortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleSort}
                      title={APPROVER_FIELD_LABELS[c.key] ?? c.key}
                      disabled={loading}
                    />
                  </th>
                ))}
                <th className="px-2 py-2 font-medium text-right border-b border-gray-200 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-3 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-3 py-8 text-center text-gray-500">
                    No rows. Add one or adjust filters.
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => {
                  const rq = str(row.requesterName);
                  const qParam = encodeURIComponent(rq);
                  const rid = str(row.id);
                  const busy = savingRowId === rid;
                  return (
                    <tr
                      key={rid}
                      className={`border-t border-gray-100 hover:bg-gray-50/80 ${busy ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <td
                        className={`px-2 py-1 align-top text-gray-900 font-medium text-xs max-w-[11rem] ${
                          uiMode === 'spreadsheet'
                            ? 'sticky left-0 z-10 bg-white border-r border-gray-100'
                            : 'truncate sm:whitespace-normal'
                        }`}
                        title={rq}
                      >
                        {rq}
                      </td>
                      <td
                        className={`px-2 py-1 align-top text-gray-700 text-xs whitespace-nowrap ${
                          uiMode === 'spreadsheet' ? 'sticky left-[9rem] z-10 bg-white border-r border-gray-100' : ''
                        }`}
                      >
                        {str(row.businessUnit)}
                      </td>
                      <td
                        className={`px-2 py-1 align-top text-gray-600 text-xs max-w-[14rem] ${
                          uiMode === 'spreadsheet'
                            ? 'sticky left-[12.25rem] z-10 bg-white border-r border-gray-100'
                            : ''
                        }`}
                        title={str(row.requesterTeamNames)}
                      >
                        {cellText(row, 'requesterTeamNames')}
                      </td>
                      <td
                        className="px-2 py-1 align-top text-gray-600 text-xs max-w-[12rem] font-mono"
                        title={str(row.requesterRepCodesDisplay)}
                      >
                        {cellText(row, 'requesterRepCodesDisplay')}
                      </td>
                      {tableCols.map((c) =>
                        uiMode === 'spreadsheet' ? (
                          <td key={c.key} className="p-0.5 align-top min-w-[7rem]">
                            <SearchableDirectoryField
                              compact
                              showHint={false}
                              label={APPROVER_FIELD_LABELS[c.key] ?? c.key}
                              kind="approver"
                              disabled={busy}
                              value={str(row[c.key])}
                              onChange={(v) => {
                                const snapshot = { ...row, [c.key]: v } as Record<string, unknown>;
                                setRows((prev) =>
                                  prev.map((r) => (str(r.id) === rid ? { ...r, [c.key]: v } : r))
                                );
                                void saveRowInline(rid, snapshot);
                              }}
                            />
                          </td>
                        ) : (
                          <td
                            key={c.key}
                            className="px-3 py-2 text-gray-600 text-xs max-w-[9rem] truncate align-top"
                            title={cellText(row, c.key)}
                          >
                            {cellText(row, c.key)}
                          </td>
                        )
                      )}
                      <td className="px-2 py-1 text-right space-x-2 whitespace-nowrap align-top">
                        <Link
                          /*
                           * The flow, so the Requesters screen looks in the right half of the
                           * directory. Sample Ordering and Return share it, and a Return requester
                           * sits in a `ret-…` team the sample scope does not list — which is why
                           * this link used to land on an empty table.
                           */
                          to={`/admin/requesters?q=${qParam}${
                            formType === 'return' ? '&scope=RETURN' : ''
                          }`}
                          className="text-gray-700 font-medium hover:underline text-xs"
                        >
                          Requesters
                        </Link>
                        <button
                          type="button"
                          className="text-[#00A651] font-medium hover:underline text-xs"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-red-600 font-medium hover:underline text-xs"
                          onClick={() => remove(rid)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>
            {total} row{total !== 1 ? 's' : ''} · page {page} of {totalPages}
          </span>
          <div className="space-x-2">
            <button
              type="button"
              disabled={page <= 1}
              className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editingId ? 'Edit mapping' : 'Add mapping'}</h3>
            <form onSubmit={save} className="space-y-3">
              <div>
                <SearchableDirectoryField
                  showHint={false}
                  label="Requester name"
                  kind="requester"
                  required
                  value={form.requesterName}
                  onChange={(v) => setForm((f) => ({ ...f, requesterName: v }))}
                />
              </div>
              <div>
                <label className={labelClass}>Business unit</label>
                <select
                  className={inputClass}
                  value={form.businessUnit}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      businessUnit: e.target.value,
                      requesterGroupId: '',
                      requesterGroupName: '',
                      salesRepCode: '',
                    }))
                  }
                >
                  <option value="CDG">CDG</option>
                  <option value="LSG">LSG</option>
                  {formType === 'return' && <option value="SERVICE">SERVICE</option>}
                </select>
              </div>
              <SearchableRequesterGroupField
                label="Team (requester group)"
                /* SERVICE used to be mapped to 'CDG' here, so choosing SERVICE listed CDG teams and
                   a Service requester's own team was unreachable. Pass the unit through. */
                businessUnit={
                  form.businessUnit === 'LSG'
                    ? 'LSG'
                    : form.businessUnit === 'SERVICE'
                      ? 'SERVICE'
                      : 'CDG'
                }
                selectedId={form.requesterGroupId ?? ''}
                selectedName={form.requesterGroupName ?? ''}
                showHint={false}
                onChange={(next) => {
                  if (!next) {
                    setForm((f) => ({ ...f, requesterGroupId: '', requesterGroupName: '', salesRepCode: '' }));
                  } else {
                    const link = modalDirectoryLinks.find((l) => l.requesterGroupId === next.id);
                    setForm((f) => ({
                      ...f,
                      requesterGroupId: next.id,
                      requesterGroupName: next.name,
                      salesRepCode: link ? link.code : '',
                    }));
                  }
                }}
              />
              <div>
                <label className={labelClass}>Sales rep code</label>
                <input
                  type="text"
                  className={inputClass}
                  maxLength={64}
                  placeholder="e.g. 9002312"
                  value={form.salesRepCode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, salesRepCode: e.target.value }))}
                />
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Stored on <Link to="/admin/requesters">Requesters</Link> for the selected team. Choose a team above to persist the code when you save.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-500 font-medium">
                  Approvers (blank = null) — search the Users directory; names must match an active user.
                </p>
                {formType === 'return' ? (
                  <>
                    <div>
                      <label className={labelClass}>Team Name (optional)</label>
                      <input
                        className={inputClass}
                        value={form.teamName || ''}
                        onChange={(e) => setForm((f) => ({ ...f, teamName: e.target.value }))}
                      />
                    </div>
                    {/* `reviewer` comes first because that is the order the chain runs: the service
                        admin team checks the entries before any approver is asked. It applies to
                        service requests only, via the SERVICE_ONLY row in approval_chain_config,
                        and is normally a shared mailbox rather than a person. */}
                    {(['reviewer', 'firstApprover', 'secondApprover', 'finalApprover', 'fourthApprover', 'fifthApprover'] as const).map((key) => (
                      <SearchableDirectoryField
                        key={key}
                        showHint={false}
                        label={APPROVER_FIELD_LABELS[key]}
                        kind="approver"
                        value={form[key] || ''}
                        onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                      />
                    ))}
                  </>
                ) : (
                  <>
                {['salesManager', 'districtSalesManager', 'nationalSalesManager'].map((key) => (
                  <SearchableDirectoryField
                    key={key}
                    showHint={false}
                    label={APPROVER_FIELD_LABELS[key]}
                    kind="approver"
                    value={form[key] || ''}
                    onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  />
                ))}
                {formType === 'zsam' && (
                  <>
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.localFinanceController}
                      kind="approver"
                      value={form.localFinanceController || ''}
                      onChange={(v) => setForm((f) => ({ ...f, localFinanceController: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.directorCommercialManager}
                      kind="approver"
                      value={form.directorCommercialManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, directorCommercialManager: v }))}
                    />
                  </>
                )}
                {formType === 'znc-installation' && (
                  <>
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.technicalManager}
                      kind="approver"
                      value={form.technicalManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, technicalManager: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.nationalTSManager}
                      kind="approver"
                      value={form.nationalTSManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, nationalTSManager: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.localFinanceController}
                      kind="approver"
                      value={form.localFinanceController || ''}
                      onChange={(v) => setForm((f) => ({ ...f, localFinanceController: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.directorCommercialManager}
                      kind="approver"
                      value={form.directorCommercialManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, directorCommercialManager: v }))}
                    />
                  </>
                )}
                {(formType === 'znc-claim' || formType === 'zint') && (
                  <>
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.csPsManager}
                      kind="approver"
                      value={form.csPsManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, csPsManager: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.raqaManager}
                      kind="approver"
                      value={form.raqaManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, raqaManager: v }))}
                    />
                    <SearchableDirectoryField
                      showHint={false}
                      label={APPROVER_FIELD_LABELS.globalRaqaManager}
                      kind="approver"
                      value={form.globalRaqaManager || ''}
                      onChange={(v) => setForm((f) => ({ ...f, globalRaqaManager: v }))}
                    />
                  </>
                )}
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-[#00A651] text-white rounded-lg font-medium hover:bg-[#009048]">
                  {editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
