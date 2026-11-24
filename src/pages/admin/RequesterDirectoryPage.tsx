/**
 * Admin: edit requester groups and requesters (same fields as New Application step 1).
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchSelect from '../../components/SearchSelect';
import { adminApi } from '../../services/api.service';

/** Same values as New Application → Sample Request Type */
const SAMPLE_REQUEST_OPTIONS: { value: '' | 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'; label: string }[] = [
  { value: '', label: 'All sample request types' },
  { value: 'ZSAM', label: 'ZSAM for SALES PROMOTION' },
  { value: 'ZNC', label: 'ZNC for INSTALLATION' },
  { value: 'ZNCCLAIM', label: 'ZNC for CLAIM REPLACEMENT' },
  { value: 'ZINT', label: 'ZINT for QC TEST' },
];

type SamplePurpose = 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';

function labelSampleRequestType(v: string | null | undefined): string {
  if (!v) return 'All types';
  const o = SAMPLE_REQUEST_OPTIONS.find((x) => x.value === v);
  return o?.label ?? v;
}

function sampleTypeFromApiRow(v: string | null): '' | SamplePurpose {
  if (v === 'ZSAM' || v === 'ZNC' || v === 'ZNCCLAIM' || v === 'ZINT') return v;
  return '';
}

/**
 * SERVICE is a business unit here too — the approval matrix's Group column has CDG, LSG and
 * Service, and the four Service teams already exist. Without it this page could not reach them, so
 * a Service requester such as NIA HARGREAVES could not be listed, added or given a sales rep code.
 */
type Bu = 'CDG' | 'LSG' | 'CDG/LSG' | 'SERVICE';

type GroupRow = {
  id: string;
  code: string;
  name: string;
  businessUnit: string;
  isActive: boolean;
  requesterCount: number;
};

type RequesterRow = {
  id: string;
  name: string;
  code: string;
  requesterGroupId: string;
  isActive: boolean;
  userId: string | null;
  sampleRequestType: string | null;
};

export default function RequesterDirectoryPage() {
  const [searchParams] = useSearchParams();

  /** Step 1 (first): same control as New Application — filters which requesters appear in the table below */
  const [directorySampleTypeFilter, setDirectorySampleTypeFilter] = React.useState<'' | SamplePurpose>('');
  /** Optional: from `/admin/requesters?q=` (e.g. link from Approval mappings) */
  const [requesterNameFilter, setRequesterNameFilter] = React.useState(() => searchParams.get('q') ?? '');

  /*
   * Which flow's teams to show.
   *
   * Sample Ordering and Return share this directory, and a group records which flow it belongs to
   * (NULL meaning both). Without this control the Return teams sat in the same list as the sample
   * ones with nothing to distinguish them - and a link from the Return matrix, which names a
   * person, landed on whichever team happened to be selected and showed nothing.
   */
  const [formScope, setFormScope] = React.useState<'' | 'RETURN' | 'SAMPLE'>(
    () => (searchParams.get('scope') ?? '').toUpperCase() === 'RETURN' ? 'RETURN' : ''
  );
  const [businessUnit, setBusinessUnit] = React.useState<Bu>('CDG');
  const [groups, setGroups] = React.useState<GroupRow[]>([]);
  const [selectedGroupId, setSelectedGroupId] = React.useState<string>('');
  const [requesters, setRequesters] = React.useState<RequesterRow[]>([]);
  const [groupMeta, setGroupMeta] = React.useState<{ name: string; code: string } | null>(null);
  const [loadingGroups, setLoadingGroups] = React.useState(false);
  const [loadingRequesters, setLoadingRequesters] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const [showGroupModal, setShowGroupModal] = React.useState(false);
  const [groupForm, setGroupForm] = React.useState({ name: '', code: '', businessUnit: 'CDG' as Bu });
  const [showEditGroupModal, setShowEditGroupModal] = React.useState(false);
  const [editGroupForm, setEditGroupForm] = React.useState({ name: '', businessUnit: 'CDG' as Bu });

  const [showRequesterModal, setShowRequesterModal] = React.useState(false);
  const [requesterForm, setRequesterForm] = React.useState({
    name: '',
    code: '',
    sampleRequestType: '' as '' | 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT',
  });
  const [editingRequester, setEditingRequester] = React.useState<RequesterRow | null>(null);
  const [togglingRequesterId, setTogglingRequesterId] = React.useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadGroups = React.useCallback(async () => {
    setLoadingGroups(true);
    setError(null);
    try {
      const res = await adminApi.getAdminRequesterGroups({
        businessUnit,
        includeInactive: true,
        ...(formScope ? { formScope } : {}),
      });
      setGroups(res.groups);
      setSelectedGroupId((prev) => {
        if (prev && res.groups.some((g) => g.id === prev)) return prev;
        return res.groups[0]?.id ?? '';
      });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { error?: string } } }).response?.data?.error : null;
      setError(msg || 'Failed to load requester groups');
    } finally {
      setLoadingGroups(false);
    }
  }, [businessUnit, formScope]);

  const loadRequesters = React.useCallback(async () => {
    if (!selectedGroupId) {
      setRequesters([]);
      setGroupMeta(null);
      return;
    }
    setLoadingRequesters(true);
    setError(null);
    try {
      const res = await adminApi.getAdminRequesters(selectedGroupId);
      setRequesters(res.requesters);
      setGroupMeta({ name: res.group.name, code: res.group.code });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { error?: string } } }).response?.data?.error : null;
      setError(msg || 'Failed to load requesters');
    } finally {
      setLoadingRequesters(false);
    }
  }, [selectedGroupId]);

  React.useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  React.useEffect(() => {
    loadRequesters();
  }, [loadRequesters]);

  React.useEffect(() => {
    setRequesterNameFilter(searchParams.get('q') ?? '');
  }, [searchParams]);

  /*
   * A link that names a person selects the team holding them.
   *
   * The Return matrix links each row to `/admin/requesters?q=<name>`, and this screen shows one
   * team at a time - so the name filter was applied to whichever team was selected by default,
   * which for a Return requester was almost never theirs. The screen looked empty and the link
   * looked broken. Resolving the name here also switches the unit and the flow scope to match, so
   * the team is actually in the list it is being selected from.
   */
  const nameFromUrl = searchParams.get('q') ?? '';
  React.useEffect(() => {
    const q = nameFromUrl.trim();
    if (!q) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminApi.searchAdminRequestersForPicker(q, 5);
        const hit = res.requesters[0];
        if (cancelled || !hit?.requesterGroupId) return;
        const scope = String(hit.formScope ?? '').toUpperCase() === 'RETURN' ? 'RETURN' : '';
        setFormScope(scope as '' | 'RETURN' | 'SAMPLE');
        const units = String(hit.businessUnit ?? '').split('/').map((u) => u.trim());
        if (units.length > 0 && units[0]) setBusinessUnit(hit.businessUnit as Bu);
        setSelectedGroupId(hit.requesterGroupId);
      } catch {
        /* the name filter still applies to whatever is selected */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFromUrl]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  const visibleRequesters = React.useMemo(() => {
    let list = requesters;
    if (directorySampleTypeFilter) {
      list = list.filter(
        (r) => r.sampleRequestType == null || r.sampleRequestType === directorySampleTypeFilter
      );
    }
    const t = requesterNameFilter.trim().toLowerCase();
    if (t) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(t) ||
          String(r.code ?? '')
            .toLowerCase()
            .includes(t)
      );
    }
    return list;
  }, [requesters, directorySampleTypeFilter, requesterNameFilter]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await adminApi.createAdminRequesterGroup({
        name: groupForm.name.trim(),
        businessUnit: groupForm.businessUnit,
        ...(groupForm.code.trim() ? { code: groupForm.code.trim() } : {}),
      });
      setShowGroupModal(false);
      setGroupForm({ name: '', code: '', businessUnit: 'CDG' });
      showToast('Requester group created');
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Create failed');
    }
  };

  const handleToggleGroupActive = async (g: GroupRow) => {
    setError(null);
    try {
      await adminApi.updateAdminRequesterGroup(g.id, { isActive: !g.isActive });
      showToast(g.isActive ? 'Group deactivated' : 'Group activated');
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Update failed');
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    const name = editGroupForm.name.trim();
    if (!name) {
      setError('Group name is required');
      return;
    }
    setError(null);
    try {
      await adminApi.updateAdminRequesterGroup(selectedGroup.id, {
        name,
        businessUnit: editGroupForm.businessUnit,
      });
      showToast('Requester group updated');
      setShowEditGroupModal(false);
      await loadGroups();
      await loadRequesters();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Update failed');
    }
  };

  const handleDeleteGroup = async (g: GroupRow) => {
    if (!window.confirm(`Delete group "${g.name}"? Only allowed when it has no requesters.`)) return;
    setError(null);
    try {
      await adminApi.deleteAdminRequesterGroup(g.id);
      showToast('Group deleted');
      setSelectedGroupId('');
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Delete failed');
    }
  };

  const handleSaveRequester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;
    setError(null);
    try {
      const sr: SamplePurpose | null =
        requesterForm.sampleRequestType === '' ? null : requesterForm.sampleRequestType;
      if (editingRequester) {
        await adminApi.updateAdminRequester(editingRequester.id, {
          name: requesterForm.name.trim(),
          code: requesterForm.code.trim(),
          sampleRequestType: sr,
        });
        showToast('Requester updated');
      } else {
        await adminApi.createAdminRequester({
          requesterGroupId: selectedGroupId,
          name: requesterForm.name.trim(),
          code: requesterForm.code.trim(),
          sampleRequestType: sr,
        });
        showToast('Requester added');
      }
      setShowRequesterModal(false);
      setEditingRequester(null);
      setRequesterForm({ name: '', code: '', sampleRequestType: '' });
      await loadRequesters();
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Save failed');
    }
  };

  const handleDeleteRequester = async (r: RequesterRow) => {
    if (!window.confirm(`Delete requester "${r.name}"?`)) return;
    setError(null);
    try {
      await adminApi.deleteAdminRequester(r.id);
      showToast('Requester deleted');
      await loadRequesters();
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Delete failed');
    }
  };

  const handleToggleRequesterActive = async (r: RequesterRow) => {
    const next = !r.isActive;
    if (
      !next &&
      !window.confirm(`Deactivate "${r.name}"? They will not appear in New Application step 1 until reactivated.`)
    ) {
      return;
    }
    setError(null);
    setTogglingRequesterId(r.id);
    try {
      await adminApi.updateAdminRequester(r.id, { isActive: next });
      showToast(next ? 'Requester activated' : 'Requester deactivated');
      await loadRequesters();
      await loadGroups();
    } catch (err: unknown) {
      const data = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: string } } }).response?.data : undefined;
      setError(data?.error || 'Update failed');
    } finally {
      setTogglingRequesterId(null);
    }
  };

  const inputClass =
    'border border-gray-200 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-[#00A651]/30 focus:border-[#00A651] outline-none';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

  return (
    <div className="max-w-4xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Requester directory</h1>
        <p className="text-gray-600 text-sm mt-1">
          Same data as <strong>New Application</strong> step 1 — manage requester groups and requesters without a spreadsheet.
        </p>
      </div>

      <div className="bg-white border-2 border-gray-100 rounded-2xl shadow-sm p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 pb-2 border-b border-gray-100">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#00A651] text-white font-semibold text-sm">
            1
          </span>
          <span className="font-semibold text-gray-800">Sample request type, business unit &amp; requester group</span>
        </div>

        {error && (
          <div className="bg-red-50 text-red-800 text-sm px-4 py-3 rounded-lg border border-red-100">{error}</div>
        )}

        <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/70 p-3">
          <label className="block text-sm mb-1">Sample Request Type</label>
          <SearchSelect<string>
            options={SAMPLE_REQUEST_OPTIONS}
            value={directorySampleTypeFilter}
            onChange={(val) => setDirectorySampleTypeFilter((val ?? '') as '' | SamplePurpose)}
            placeholder="Select request type..."
          />
          <p className="text-xs text-gray-500 mt-2">
            Same control as <strong>New Application</strong> step 1. Filters the requester list in step 2 (includes people set to
            &quot;all types&quot;). Choose &quot;All sample request types&quot; to show everyone.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Flow</label>
            <select
              className={inputClass}
              value={formScope}
              onChange={(e) => {
                setFormScope(e.target.value as '' | 'RETURN' | 'SAMPLE');
                setSelectedGroupId('');
              }}
            >
              <option value="">All flows</option>
              <option value="SAMPLE">Sample Ordering</option>
              <option value="RETURN">Return / Credit</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Teams shared by both flows appear under either.
            </p>
          </div>
          <div>
            <label className={labelClass}>Business unit</label>
            <select
              className={inputClass}
              value={businessUnit}
              onChange={(e) => {
                setBusinessUnit(e.target.value as Bu);
                setSelectedGroupId('');
              }}
            >
              <option value="CDG">CDG</option>
              <option value="LSG">LSG</option>
              <option value="CDG/LSG">CDG/LSG</option>
              <option value="SERVICE">SERVICE</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                setGroupForm((f) => ({ ...f, businessUnit }));
                setShowGroupModal(true);
              }}
              className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#009048] w-full md:w-auto"
            >
              + Add requester group
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>Requester group</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              className={inputClass + ' flex-1'}
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              disabled={loadingGroups}
            >
              <option value="">Select group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.code}){!g.isActive ? ' — inactive' : ''}
                </option>
              ))}
            </select>
            {selectedGroup && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditGroupForm({
                      name: selectedGroup.name,
                      businessUnit: selectedGroup.businessUnit as Bu,
                    });
                    setShowEditGroupModal(true);
                  }}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#00A651] font-medium hover:bg-[#00A651]/5"
                >
                  Edit group
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleGroupActive(selectedGroup)}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {selectedGroup.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteGroup(selectedGroup)}
                  className="px-3 py-2 rounded-lg border border-red-200 text-sm text-red-700 hover:bg-red-50"
                >
                  Delete group
                </button>
              </>
            )}
          </div>
          {loadingGroups && <p className="text-xs text-gray-500 mt-1">Loading groups…</p>}
        </div>

        {selectedGroupId && (
          <>
            <div className="flex items-center gap-2 text-sm text-gray-500 pt-2 border-t border-gray-100">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-semibold text-sm">
                2
              </span>
              <span className="font-semibold text-gray-800">Requesters in this group</span>
              {groupMeta && (
                <span className="text-gray-500 font-normal">
                  — {groupMeta.name} <code className="text-xs bg-gray-100 px-1 rounded">{groupMeta.code}</code>
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
              <div className="flex-1 max-w-sm">
                <label className={labelClass}>Filter name or sales rep code</label>
                <input
                  type="search"
                  className={inputClass}
                  value={requesterNameFilter}
                  onChange={(e) => setRequesterNameFilter(e.target.value)}
                  placeholder="e.g. from Approval mappings link…"
                  autoComplete="off"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Narrows the table below. Use with the correct <strong>requester group</strong> selected.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingRequester(null);
                  setRequesterForm({
                    name: '',
                    code: '',
                    sampleRequestType: directorySampleTypeFilter || '',
                  });
                  setShowRequesterModal(true);
                }}
                className="px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#009048] shrink-0"
              >
                + Add requester
              </button>
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Sales rep code</th>
                    <th className="px-4 py-3 font-medium">Sample request type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingRequesters ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        Loading…
                      </td>
                    </tr>
                  ) : requesters.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        No requesters in this group yet.
                      </td>
                    </tr>
                  ) : visibleRequesters.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        No requesters match this sample request type in this group. Try &quot;All sample request types&quot; in step 1
                        or add a requester for this purpose.
                      </td>
                    </tr>
                  ) : (
                    visibleRequesters.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/80">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-3 text-gray-700">{r.code}</td>
                        <td className="px-4 py-3 text-gray-700 text-sm max-w-[14rem]">
                          {labelSampleRequestType(r.sampleRequestType)}
                        </td>
                        <td className="px-4 py-3">{r.isActive ? <span className="text-green-700">Active</span> : <span className="text-gray-500">Inactive</span>}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                            <button
                              type="button"
                              disabled={togglingRequesterId === r.id}
                              className={
                                r.isActive
                                  ? 'text-amber-800 font-medium hover:underline disabled:opacity-50'
                                  : 'text-[#00A651] font-medium hover:underline disabled:opacity-50'
                              }
                              onClick={() => void handleToggleRequesterActive(r)}
                            >
                              {togglingRequesterId === r.id ? '…' : r.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              className="text-[#00A651] font-medium hover:underline"
                              onClick={() => {
                                setEditingRequester(r);
                                setRequesterForm({
                                  name: r.name,
                                  code: r.code,
                                  sampleRequestType: sampleTypeFromApiRow(r.sampleRequestType),
                                });
                                setShowRequesterModal(true);
                              }}
                            >
                              Edit
                            </button>
                            <button type="button" className="text-red-600 font-medium hover:underline" onClick={() => handleDeleteRequester(r)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showEditGroupModal && selectedGroup && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit requester group</h3>
            <p className="text-xs text-gray-500 mb-4">
              Code <code className="bg-gray-100 px-1 rounded">{selectedGroup.code}</code> is fixed (used in imports and links).
            </p>
            <form onSubmit={handleUpdateGroup} className="space-y-4">
              <div>
                <label className={labelClass}>Display name</label>
                <input
                  className={inputClass}
                  required
                  value={editGroupForm.name}
                  onChange={(e) => setEditGroupForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. TECHNICAL SERVICE"
                />
              </div>
              <div>
                <label className={labelClass}>Business unit</label>
                <select
                  className={inputClass}
                  value={editGroupForm.businessUnit}
                  onChange={(e) => setEditGroupForm((f) => ({ ...f, businessUnit: e.target.value as Bu }))}
                >
                  <option value="CDG">CDG</option>
                  <option value="LSG">LSG</option>
                  <option value="CDG/LSG">CDG/LSG</option>
                  <option value="SERVICE">SERVICE</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                  onClick={() => setShowEditGroupModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-[#00A651] text-white rounded-lg font-medium hover:bg-[#009048]">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New requester group</h3>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className={labelClass}>Display name</label>
                <input
                  className={inputClass}
                  required
                  value={groupForm.name}
                  onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. TECHNICAL SERVICE"
                />
              </div>
              <div>
                <label className={labelClass}>Business unit</label>
                <select
                  className={inputClass}
                  value={groupForm.businessUnit}
                  onChange={(e) => setGroupForm((f) => ({ ...f, businessUnit: e.target.value as Bu }))}
                >
                  <option value="CDG">CDG</option>
                  <option value="LSG">LSG</option>
                  <option value="CDG/LSG">CDG/LSG</option>
                  <option value="SERVICE">SERVICE</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Code (optional)</label>
                <input
                  className={inputClass}
                  value={groupForm.code}
                  onChange={(e) => setGroupForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="Leave empty to auto-generate"
                />
                <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, hyphens. Must be unique.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg" onClick={() => setShowGroupModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-[#00A651] text-white rounded-lg font-medium hover:bg-[#009048]">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRequesterModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[min(32rem,90vh)] overflow-y-auto p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editingRequester ? 'Edit requester' : 'Add requester'}</h3>
            <form onSubmit={handleSaveRequester} className="space-y-4">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  className={inputClass}
                  required
                  value={requesterForm.name}
                  onChange={(e) => setRequesterForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/70 p-3">
                <label className="block text-sm mb-1">Sample Request Type</label>
                <SearchSelect<string>
                  options={SAMPLE_REQUEST_OPTIONS}
                  value={requesterForm.sampleRequestType}
                  onChange={(val) =>
                    setRequesterForm((f) => ({
                      ...f,
                      sampleRequestType: (val ?? '') as '' | SamplePurpose,
                    }))
                  }
                  placeholder="Select request type..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  Same choices as <strong>New Application</strong> step 1. &quot;All sample request types&quot; includes this requester for every purpose.
                </p>
              </div>
              <div>
                <label className={labelClass}>Sales rep code</label>
                <input
                  className={inputClass}
                  required
                  value={requesterForm.code}
                  onChange={(e) => setRequesterForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. 9002441"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                  onClick={() => {
                    setShowRequesterModal(false);
                    setEditingRequester(null);
                    setRequesterForm({ name: '', code: '', sampleRequestType: '' });
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-[#00A651] text-white rounded-lg font-medium hover:bg-[#009048]">
                  {editingRequester ? 'Save' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
