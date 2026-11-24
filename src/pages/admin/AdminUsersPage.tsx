/**
 * Admin: add user accounts (ADMIN, REQUESTER, approver roles), list accounts, activate/deactivate, set password.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, AdminUserRole, AdminUserSummary } from '../../services/api.service';
import { useAuth } from '../../providers/AuthContext';
import { canSaveRoleChange } from '../../utils/adminUserRoleSave';

const ROLE_OPTIONS: { value: AdminUserRole; label: string }[] = [
  { value: 'ADMIN', label: 'Administrator (Data Management)' },
  { value: 'SUPER_APPROVER', label: 'Super approver only (legacy)' },
  { value: 'REQUESTER', label: 'Requester (New Application — sales rep)' },
  { value: 'SALES_MANAGER', label: 'Sales manager' },
  { value: 'DISTRICT_SALES_MANAGER', label: 'District sales manager' },
  { value: 'NATIONAL_SALES_MANAGER', label: 'National sales manager' },
  { value: 'FINANCE_CONTROLLER', label: 'Finance controller' },
  { value: 'DIRECTOR_COMMERCIAL', label: 'Director commercial' },
  { value: 'CUSTOMER_SUPPORT', label: 'Customer support (read-only sample requests)' },
];

/** Primary job role; super-approver is a separate flag (`isSuperApprover`). Legacy enum-only row may still show SUPER_APPROVER. */
const PRIMARY_ROLE_OPTIONS = ROLE_OPTIONS.filter((o) => o.value !== 'SUPER_APPROVER');

const LEGACY_SUPER_OPTION: { value: AdminUserRole; label: string } = {
  value: 'SUPER_APPROVER',
  label: 'Super approver only (legacy)',
};

function extractError(e: unknown): string {
  const err = e as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    'Request failed'
  );
}

function roleLabel(r: AdminUserRole | undefined): string {
  if (!r) return '—';
  return ROLE_OPTIONS.find((x) => x.value === r)?.label ?? r;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [businessUnit, setBusinessUnit] = useState<'CDG' | 'LSG' | ''>('');
  const [role, setRole] = useState<AdminUserRole>('ADMIN');
  const [isSuperApproverCreate, setIsSuperApproverCreate] = useState(false);
  const [requesterGroupId, setRequesterGroupId] = useState('');
  const [salesRepCode, setSalesRepCode] = useState('');
  const [groupOptions, setGroupOptions] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [pwById, setPwById] = useState<Record<string, string>>({});
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  /** Pending role change per row (cleared after successful save). */
  const [roleDraftById, setRoleDraftById] = useState<Record<string, AdminUserRole>>({});
  /** When converting to REQUESTER and the user has no BU, admin picks CDG/LSG here. */
  const [reqBuById, setReqBuById] = useState<Record<string, 'CDG' | 'LSG'>>({});
  const [reqGroupById, setReqGroupById] = useState<Record<string, string>>({});
  const [reqRepById, setReqRepById] = useState<Record<string, string>>({});
  const [rowGroupOptions, setRowGroupOptions] = useState<Record<string, Array<{ id: string; name: string; code: string }>>>(
    {}
  );
  const [rowGroupLoading, setRowGroupLoading] = useState<Record<string, boolean>>({});
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    try {
      const { users: list } = await adminApi.listAdminUsers({ scope: 'all' });
      setUsers(list);
    } catch (e) {
      setListError(extractError(e));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (role !== 'REQUESTER') {
      setGroupOptions([]);
      setRequesterGroupId('');
      setSalesRepCode('');
    }
  }, [role]);

  useEffect(() => {
    if (role !== 'REQUESTER' || !businessUnit) {
      setGroupOptions([]);
      setRequesterGroupId('');
      return;
    }
    setLoadingGroups(true);
    adminApi
      .getAdminRequesterGroups({ businessUnit, includeInactive: false })
      .then((res) => {
        setGroupOptions(res.groups.map((g) => ({ id: g.id, name: g.name, code: g.code })));
      })
      .catch(() => setGroupOptions([]))
      .finally(() => setLoadingGroups(false));
  }, [role, businessUnit]);

  const requesterGroupsFetchKey = useMemo(
    () =>
      users
        .map((u) => {
          const r = roleDraftById[u.id] ?? u.role;
          const bu = u.businessUnit || reqBuById[u.id];
          if (r !== 'REQUESTER' || !bu) return null;
          return `${u.id}:${bu}`;
        })
        .filter(Boolean)
        .sort()
        .join('|'),
    [users, roleDraftById, reqBuById]
  );

  useEffect(() => {
    if (!requesterGroupsFetchKey) return;
    let cancelled = false;
    for (const u of users) {
      const effective = roleDraftById[u.id] ?? u.role;
      const bu = (u.businessUnit || reqBuById[u.id]) as 'CDG' | 'LSG' | undefined;
      if (effective !== 'REQUESTER' || !bu) continue;
      setRowGroupLoading((prev) => ({ ...prev, [u.id]: true }));
      adminApi
        .getAdminRequesterGroups({ businessUnit: bu, includeInactive: false })
        .then((res) => {
          if (cancelled) return;
          setRowGroupOptions((prev) => ({
            ...prev,
            [u.id]: res.groups.map((g) => ({ id: g.id, name: g.name, code: g.code })),
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setRowGroupOptions((prev) => ({ ...prev, [u.id]: [] }));
        })
        .finally(() => {
          if (cancelled) return;
          setRowGroupLoading((prev) => ({ ...prev, [u.id]: false }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [requesterGroupsFetchKey, users, roleDraftById, reqBuById]);

  const resetCreateForm = () => {
    setEmail('');
    setName('');
    setPassword('');
    setBusinessUnit('');
    setRole('ADMIN');
    setIsSuperApproverCreate(false);
    setRequesterGroupId('');
    setSalesRepCode('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateStatus(null);
    setCreating(true);
    try {
      await adminApi.createAdminUser({
        email: email.trim(),
        name: name.trim(),
        password,
        businessUnit: businessUnit === '' ? null : businessUnit,
        role,
        ...(isSuperApproverCreate ? { isSuperApprover: true } : {}),
        ...(role === 'REQUESTER'
          ? {
                requesterGroupId: requesterGroupId || undefined,
                salesRepCode: salesRepCode.trim() || undefined,
            }
          : {}),
      });
      setCreateStatus({
        ok: true,
        text:
          role === 'REQUESTER'
            ? 'User created. They can sign in with email/password; requester directory was linked when group and rep code were provided.'
            : 'User created. They can sign in with email and password (password login).',
      });
      resetCreateForm();
      await load();
    } catch (err) {
      setCreateStatus({ ok: false, text: extractError(err) });
    } finally {
      setCreating(false);
    }
  };

  const saveNameFor = async (u: AdminUserSummary) => {
    const draft = (nameById[u.id] ?? u.name).trim();
    if (draft.length < 2) {
      setRowMessage({ id: u.id, ok: false, text: 'Name must be at least 2 characters.' });
      return;
    }
    if (draft === u.name.trim()) {
      setRowMessage({ id: u.id, ok: false, text: 'No name change to save.' });
      return;
    }
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { name: draft });
      setNameById((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
      setRowMessage({ id: u.id, ok: true, text: 'Name updated.' });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  const setPasswordFor = async (id: string) => {
    const pw = (pwById[id] || '').trim();
    if (pw.length < 8) {
      setRowMessage({ id, ok: false, text: 'Password must be at least 8 characters.' });
      return;
    }
    setRowBusy(id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(id, { password: pw });
      setPwById((prev) => ({ ...prev, [id]: '' }));
      setRowMessage({ id, ok: true, text: 'Password updated.' });
      await load();
    } catch (err) {
      setRowMessage({ id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  const effectiveRowRole = (u: AdminUserSummary) => roleDraftById[u.id] ?? u.role;

  const serverHasSuperAccess = (u: AdminUserSummary) =>
    !!(u.isSuperApprover || u.role === 'SUPER_APPROVER');

  const hasPendingRoleChange = (u: AdminUserSummary) => (effectiveRowRole(u) ?? 'ADMIN') !== u.role;

  const onRowRoleChange = (u: AdminUserSummary, next: AdminUserRole) => {
    setRoleDraftById((prev) => ({ ...prev, [u.id]: next }));
    if (next === 'REQUESTER') {
      setReqGroupById((prev) => ({ ...prev, [u.id]: u.requesterGroupId ?? prev[u.id] ?? '' }));
      setReqRepById((prev) => ({ ...prev, [u.id]: u.salesRepCode ?? prev[u.id] ?? '' }));
      if (u.businessUnit) {
        setReqBuById((prev) => ({ ...prev, [u.id]: u.businessUnit as 'CDG' | 'LSG' }));
      }
    }
  };

  const saveRowAccess = async (u: AdminUserSummary) => {
    if (currentUser?.id === u.id) {
      setRowMessage({ id: u.id, ok: false, text: 'Use Add / Remove super approver to change that access on your account.' });
      return;
    }

    const nextRole = effectiveRowRole(u) ?? 'ADMIN';
    const roleChanged = hasPendingRoleChange(u);

    if (!roleChanged) {
      setRowMessage({ id: u.id, ok: false, text: 'No role change to save.' });
      return;
    }

    let requesterBu: 'CDG' | 'LSG' | undefined;
    if (nextRole === 'REQUESTER') {
      requesterBu = (u.businessUnit || reqBuById[u.id]) as 'CDG' | 'LSG' | undefined;
      /**
       * Neither a team nor a sales rep code is required any more, so neither is the business unit
       * that was only needed in order to look a team up.
       *
       * Requiring all three is what made a legitimate account impossible to save here: most Return
       * requesters have no SAP code, and anyone belonging to several teams cannot be described by
       * one of them. A team may still be chosen to pin someone to it; left blank, the wizard reads
       * their rows from the Requesters directory instead.
       */
      const gid = (reqGroupById[u.id] ?? '').trim() || (u.requesterGroupId ?? '');
      if (gid && !requesterBu) {
        setRowMessage({
          id: u.id,
          ok: false,
          text: 'Choose a business unit (or set BU on the account) to pick a team, or leave the team blank.',
        });
        return;
      }
    }

    setRowBusy(u.id);
    setRowMessage(null);
    try {
      const patch: Parameters<typeof adminApi.patchAdminUser>[1] = {};
      if (nextRole === 'REQUESTER') {
        const gid = (reqGroupById[u.id] ?? '').trim() || (u.requesterGroupId ?? '');
        const rep = (reqRepById[u.id] ?? u.salesRepCode ?? '').trim();
        const bu = (u.businessUnit || reqBuById[u.id]) as 'CDG' | 'LSG';
        patch.role = 'REQUESTER';
        // An empty box means "no fixed team" / "no code" — send null so the API clears it, rather
        // than '' which fails the uuid check.
        patch.requesterGroupId = gid || null;
        patch.salesRepCode = rep || null;
        if (!u.businessUnit && bu) patch.businessUnit = bu;
      } else {
        patch.role = nextRole;
      }

      await adminApi.patchAdminUser(u.id, patch);

      setRoleDraftById((prev) => {
        const n = { ...prev };
        delete n[u.id];
        return n;
      });
      setRowMessage({ id: u.id, ok: true, text: 'Role updated.' });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  /**
   * Service Admin team membership.
   *
   * A flag rather than a role because the same people raise the requests they review — Nia Hargreaves
   * and Baljiwan Woodward are requesters — so their primary role stays untouched. Grants the service
   * review step, editing at review, sight of every approved service return, and SAP sales-order
   * entry.
   */
  const setServiceAdmin = async (u: AdminUserSummary, on: boolean) => {
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { isServiceAdmin: on });
      setRowMessage({
        id: u.id,
        ok: true,
        text: on
          ? 'Service Admin access granted. User should sign in again to refresh their session.'
          : 'Service Admin access removed.',
      });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  const grantSuperApprover = async (u: AdminUserSummary) => {
    if (serverHasSuperAccess(u)) {
      setRowMessage({ id: u.id, ok: false, text: 'This account already has super approver access.' });
      return;
    }
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { isSuperApprover: true });
      setRowMessage({ id: u.id, ok: true, text: 'Super approver access granted. User should sign in again to refresh their session.' });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  const revokeSuperApprover = async (u: AdminUserSummary) => {
    if (!serverHasSuperAccess(u)) return;
    if (u.role === 'SUPER_APPROVER') {
      setRowMessage({
        id: u.id,
        ok: false,
        text: 'Primary role is still “Super approver only (legacy)”. Change primary role first, then remove access if needed.',
      });
      return;
    }
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { isSuperApprover: false });
      setRowMessage({ id: u.id, ok: true, text: 'Super approver access removed.' });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  /**
   * Customer Service view: the read-only all-requests pages on top of the primary role.
   *
   * The five Customer Service members became requesters on 23 Oct 2026 so they could raise returns,
   * and lost the view the CUSTOMER_SUPPORT role had given them. The flag puts it back without
   * making anybody an administrator.
   */
  const setCustomerSupportView = async (u: AdminUserSummary, on: boolean) => {
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { isCustomerSupport: on });
      setRowMessage({
        id: u.id,
        ok: true,
        text: on
          ? 'Customer Service view granted. User should sign in again to refresh their session.'
          : 'Customer Service view removed.',
      });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  /** Mirrors what saveRowAccess accepts; the rule itself lives in utils/adminUserRoleSave. */
  const isRowSaveDisabled = (u: AdminUserSummary) => {
    if (rowBusy === u.id || currentUser?.id === u.id) return true;
    return !canSaveRoleChange(u, {
      role: roleDraftById[u.id],
      businessUnit: reqBuById[u.id],
      requesterGroupId: reqGroupById[u.id],
    });
  };

  const toggleActive = async (u: AdminUserSummary) => {
    const next = !u.isActive;
    if (!next && !window.confirm(`Deactivate ${u.email}? They will not be able to sign in until reactivated.`)) {
      return;
    }
    setRowBusy(u.id);
    setRowMessage(null);
    try {
      await adminApi.patchAdminUser(u.id, { isActive: next });
      setRowMessage({ id: u.id, ok: true, text: next ? 'Account activated.' : 'Account deactivated.' });
      await load();
    } catch (err) {
      setRowMessage({ id: u.id, ok: false, text: extractError(err) });
    } finally {
      setRowBusy(null);
    }
  };

  const exportUsersCsv = async () => {
    setExportingCsv(true);
    setExportStatus(null);
    try {
      const blob = await adminApi.exportAdminUsersCsv();
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `users-${date}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExportStatus({ ok: true, text: 'CSV downloaded.' });
    } catch (e) {
      setExportStatus({ ok: false, text: extractError(e) });
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create individual accounts by role. <strong>Administrators</strong> get Data Management access.{' '}
          <strong>Super approver</strong> is granted with the per-row <strong>Add super approver</strong> button (primary role
          stays the same). <strong>Requesters</strong> use New Application and are linked to a
          requester group + sales rep code (same as bulk user import). For large batches, use{' '}
          <Link to="/admin/bulk-import" className="text-[#00A651] font-medium hover:underline">
            Bulk import
          </Link>
          .
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Add user</h2>
        <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-gray-700">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Display name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AdminUserRole)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
            >
              {PRIMARY_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-gray-700 block mb-1">Super approver (optional)</span>
            <button
              type="button"
              onClick={() => setIsSuperApproverCreate((v) => !v)}
              disabled={creating}
              className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                isSuperApproverCreate
                  ? 'border-[#00A651] bg-emerald-50 text-emerald-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              } disabled:opacity-50`}
            >
              {isSuperApproverCreate ? 'Super approver: on' : 'Add super approver for new user'}
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              Business unit{role === 'REQUESTER' ? ' (required for requester)' : ' (optional)'}
            </span>
            <select
              value={businessUnit}
              required={role === 'REQUESTER'}
              onChange={(e) => setBusinessUnit(e.target.value as 'CDG' | 'LSG' | '')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
            >
              <option value="">—</option>
              <option value="CDG">CDG</option>
              <option value="LSG">LSG</option>
            </select>
          </label>
          {role === 'REQUESTER' && (
            <>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-gray-700">Requester group (optional)</span>
                <select
                  value={requesterGroupId}
                  onChange={(e) => setRequesterGroupId(e.target.value)}
                  disabled={!businessUnit || loadingGroups}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] disabled:opacity-50"
                >
                  <option value="">{!businessUnit ? 'Select business unit first' : loadingGroups ? 'Loading…' : 'No fixed team'}</option>
                  {groupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Optional. Pins this person to one team in the request wizard. Leave as{' '}
                  <strong>No fixed team</strong> for anyone who belongs to several — the wizard reads
                  their rows from the Requesters directory and offers all of their teams.
                </p>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-gray-700">Sales rep code (optional)</span>
                <input
                  type="text"
                  value={salesRepCode}
                  onChange={(e) => setSalesRepCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
                  placeholder="e.g. 9002310 — leave blank if they have none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Optional. Most Return requesters have no SAP code; leave it blank rather than
                  entering a placeholder. The column is unique, so <code>TBD</code>-style values can
                  only ever be used once.
                </p>
              </label>
            </>
          )}
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-gray-700">Initial password (min. 8 characters)</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651]"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-[#00A651] text-white text-sm font-medium hover:bg-[#008c44] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create user'}
            </button>
            {createStatus && (
              <p className={`mt-2 text-sm ${createStatus.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
                {createStatus.text}
              </p>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-800">Accounts</h2>
          <button
            type="button"
            disabled={exportingCsv || loading}
            onClick={() => void exportUsersCsv()}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {exportingCsv ? 'Exporting…' : 'Export all users (CSV)'}
          </button>
        </div>
        {exportStatus && (
          <p className={`text-sm ${exportStatus.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
            {exportStatus.text}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : listError ? (
          <p className="text-sm text-red-700">{listError}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-600">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="py-2 pr-4 font-semibold">Name</th>
                  <th className="py-2 pr-4 font-semibold">Email</th>
                  <th className="py-2 pr-4 font-semibold">Role</th>
                  <th className="py-2 pr-4 font-semibold">BU</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 align-top">
                    <td className="py-3 pr-4 min-w-[10rem]">
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={nameById[u.id] ?? u.name}
                          onChange={(e) => setNameById((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          disabled={rowBusy === u.id}
                          className="w-full min-w-[8rem] rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:bg-gray-100"
                        />
                        <button
                          type="button"
                          disabled={
                            rowBusy === u.id ||
                            (nameById[u.id] ?? u.name).trim() === u.name.trim() ||
                            (nameById[u.id] ?? u.name).trim().length < 2
                          }
                          onClick={() => void saveNameFor(u)}
                          className="text-[11px] font-medium text-[#00A651] hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Save name
                        </button>
                        {currentUser?.id === u.id && (
                          <span className="block text-xs text-[#00A651] font-medium">(you)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-gray-800">{u.email}</td>
                    <td className="py-3 pr-4 text-gray-700 text-xs max-w-[14rem]">
                      <div className="space-y-1">
                        <select
                          value={effectiveRowRole(u) ?? 'ADMIN'}
                          disabled={rowBusy === u.id || currentUser?.id === u.id}
                          onChange={(e) => onRowRoleChange(u, e.target.value as AdminUserRole)}
                          title={
                            currentUser?.id === u.id
                              ? 'You cannot change your own role here.'
                              : roleLabel(effectiveRowRole(u))
                          }
                          className="w-full max-w-[13rem] rounded border border-gray-300 px-1 py-0.5 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                        >
                          {(u.role === 'SUPER_APPROVER'
                            ? [...PRIMARY_ROLE_OPTIONS, LEGACY_SUPER_OPTION]
                            : PRIMARY_ROLE_OPTIONS
                          ).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-col gap-1 pt-0.5">
                          {serverHasSuperAccess(u) ? (
                            <>
                              <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[10px] font-semibold border border-emerald-200">
                                Super approver
                              </span>
                              {u.role !== 'SUPER_APPROVER' && (
                                <button
                                  type="button"
                                  disabled={rowBusy === u.id}
                                  onClick={() => void revokeSuperApprover(u)}
                                  className="w-full max-w-[13rem] px-2 py-1.5 rounded-md border border-gray-300 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Remove super approver
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={rowBusy === u.id}
                              onClick={() => void grantSuperApprover(u)}
                              className="w-full max-w-[13rem] px-2 py-1.5 rounded-md bg-[#00A651] text-white text-[11px] font-semibold hover:bg-[#008A44] disabled:opacity-50 shadow-sm"
                            >
                              Add super approver
                            </button>
                          )}
                          {u.isServiceAdmin ? (
                            <>
                              <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 text-[10px] font-semibold border border-sky-200">
                                Service Admin
                              </span>
                              <button
                                type="button"
                                disabled={rowBusy === u.id}
                                onClick={() => void setServiceAdmin(u, false)}
                                className="w-full max-w-[13rem] px-2 py-1.5 rounded-md border border-gray-300 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Remove Service Admin
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={rowBusy === u.id}
                              onClick={() => void setServiceAdmin(u, true)}
                              className="w-full max-w-[13rem] px-2 py-1.5 rounded-md border border-sky-300 bg-white text-[11px] font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-50"
                            >
                              Add Service Admin
                            </button>
                          )}
                          {u.role !== 'CUSTOMER_SUPPORT' &&
                            (u.isCustomerSupport ? (
                              <>
                                <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[10px] font-semibold border border-indigo-200">
                                  Customer Service view
                                </span>
                                <button
                                  type="button"
                                  disabled={rowBusy === u.id}
                                  onClick={() => void setCustomerSupportView(u, false)}
                                  className="w-full max-w-[13rem] px-2 py-1.5 rounded-md border border-gray-300 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Remove Customer Service view
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={rowBusy === u.id}
                                onClick={() => void setCustomerSupportView(u, true)}
                                className="w-full max-w-[13rem] px-2 py-1.5 rounded-md border border-indigo-300 bg-white text-[11px] font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
                              >
                                Add Customer Service view
                              </button>
                            ))}
                        </div>
                        {effectiveRowRole(u) === 'REQUESTER' && currentUser?.id !== u.id && (
                          <div className="space-y-1 pl-0.5 border-l border-gray-200">
                            {!u.businessUnit && (
                              <label className="block">
                                <span className="text-[10px] text-gray-500">BU</span>
                                <select
                                  value={reqBuById[u.id] ?? ''}
                                  onChange={(e) =>
                                    setReqBuById((prev) => ({
                                      ...prev,
                                      [u.id]: e.target.value as 'CDG' | 'LSG',
                                    }))
                                  }
                                  className="mt-0.5 w-full rounded border border-gray-300 px-1 py-0.5 text-[11px]"
                                >
                                  <option value="">Select…</option>
                                  <option value="CDG">CDG</option>
                                  <option value="LSG">LSG</option>
                                </select>
                              </label>
                            )}
                            <label className="block">
                              <span className="text-[10px] text-gray-500">Group</span>
                              <select
                                value={reqGroupById[u.id] ?? ''}
                                onChange={(e) =>
                                  setReqGroupById((prev) => ({ ...prev, [u.id]: e.target.value }))
                                }
                                disabled={
                                  !(u.businessUnit || reqBuById[u.id]) || rowGroupLoading[u.id]
                                }
                                className="mt-0.5 w-full rounded border border-gray-300 px-1 py-0.5 text-[11px] disabled:opacity-50"
                              >
                                <option value="">
                                  {!(u.businessUnit || reqBuById[u.id])
                                    ? 'Set BU first'
                                    : rowGroupLoading[u.id]
                                      ? 'Loading…'
                                      : 'Select group…'}
                                </option>
                                {(rowGroupOptions[u.id] ?? []).map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name} ({g.code})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-gray-500">Sales rep code</span>
                              <input
                                type="text"
                                value={reqRepById[u.id] ?? u.salesRepCode ?? ''}
                                onChange={(e) =>
                                  setReqRepById((prev) => ({ ...prev, [u.id]: e.target.value }))
                                }
                                className="mt-0.5 w-full rounded border border-gray-300 px-1 py-0.5 text-[11px]"
                                placeholder="e.g. 9002310"
                              />
                            </label>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={isRowSaveDisabled(u)}
                          onClick={() => void saveRowAccess(u)}
                          className="text-[11px] font-medium text-[#00A651] hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Save role
                        </button>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-gray-600">{u.businessUnit ?? '—'}</td>
                    <td className="py-3 pr-4">
                      {u.isActive ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 space-y-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        {u.isActive ? (
                          <button
                            type="button"
                            disabled={rowBusy === u.id}
                            onClick={() => void toggleActive(u)}
                            className="text-xs font-medium text-amber-800 hover:underline disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={rowBusy === u.id}
                            onClick={() => void toggleActive(u)}
                            className="text-xs font-medium text-[#00A651] hover:underline disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center max-w-md">
                        <input
                          type="password"
                          placeholder="New password"
                          value={pwById[u.id] || ''}
                          onChange={(e) => setPwById((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          autoComplete="new-password"
                          className="flex-1 min-w-[140px] rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={rowBusy === u.id}
                          onClick={() => void setPasswordFor(u.id)}
                          className="text-xs font-medium px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Set password
                        </button>
                      </div>
                      {rowMessage?.id === u.id && (
                        <p className={`text-xs ${rowMessage.ok ? 'text-green-700' : 'text-red-700'}`}>{rowMessage.text}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Add or update via Excel / CSV</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Bulk import still supports large spreadsheets and extra columns (e.g. hierarchy fields).
        </p>
        <Link
          to="/admin/bulk-import?entity=users"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium hover:bg-gray-200"
        >
          Open Bulk import — Users
        </Link>
      </div>
    </div>
  );
}
