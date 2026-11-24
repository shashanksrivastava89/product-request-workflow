/**
 * Remove a person who has left the organization from every approval hierarchy at once.
 *
 * Preview first: the server lists every place the name is found - accounts, approver cells in the
 * five mapping tables, the person's own mapping rows, manager links on other accounts, requester
 * directory rows, and approval steps still open on their name. The administrator then types the
 * name back and the removal runs as one transaction. An optional successor takes over the approver
 * cells and manager links; without one the slots are cleared and the chain skips them.
 */

import React from 'react';
import { adminApi } from '../../services/api.service';
import {
  offboardingFieldLabel,
  offboardingNameKey,
  type OffboardingResult,
  type OffboardingScope,
} from '../../utils/offboarding';
import { SearchableDirectoryField } from './SearchableDirectoryField';

const MAX_LISTED_ROWS = 12;

function errorMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error || data?.message || fallback;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
        <span className="text-xs font-mono text-slate-700">{count}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-700">{count === 0 ? <span className="text-slate-400">none</span> : children}</div>
    </div>
  );
}

function RowList<T>({ rows, render }: { rows: T[]; render: (row: T) => React.ReactNode }) {
  const shown = rows.slice(0, MAX_LISTED_ROWS);
  return (
    <ul className="space-y-0.5">
      {shown.map((row, i) => (
        <li key={i}>{render(row)}</li>
      ))}
      {rows.length > shown.length && <li className="text-slate-500">… and {rows.length - shown.length} more</li>}
    </ul>
  );
}

export function OffboardPersonPanel({ onApplied }: { onApplied?: () => void }) {
  const [name, setName] = React.useState('');
  const [successor, setSuccessor] = React.useState('');
  const [confirmName, setConfirmName] = React.useState('');
  const [scope, setScope] = React.useState<OffboardingScope | null>(null);
  const [result, setResult] = React.useState<OffboardingResult | null>(null);
  const [busy, setBusy] = React.useState<'preview' | 'remove' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const preview = async () => {
    const q = name.trim();
    if (!q) return;
    setBusy('preview');
    setError(null);
    setResult(null);
    setConfirmName('');
    try {
      const res = await adminApi.previewPersonOffboarding(q);
      setScope(res.scope);
    } catch (e) {
      setError(errorMessage(e, 'Lookup failed'));
      setScope(null);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!scope) return;
    setBusy('remove');
    setError(null);
    try {
      const res = await adminApi.executePersonOffboarding({
        name: scope.name,
        confirmName: confirmName.trim(),
        ...(successor.trim() ? { successorName: successor.trim() } : {}),
      });
      setResult(res);
      setScope(null);
      setConfirmName('');
      onApplied?.();
    } catch (e) {
      setError(errorMessage(e, 'Removal failed'));
    } finally {
      setBusy(null);
    }
  };

  const confirmed = !!scope && offboardingNameKey(confirmName) === scope.key;
  const approverTables = scope ? scope.mappings.filter((m) => m.asApprover.length > 0) : [];
  const ownTables = scope ? scope.mappings.filter((m) => m.asRequester.length > 0) : [];
  const approverRows = approverTables.reduce((n, m) => n + m.asApprover.length, 0);
  const ownRows = ownTables.reduce((n, m) => n + m.asRequester.length, 0);
  const successorShown = successor.trim();

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Remove a person who left the organization</h2>
      <p className="text-xs text-slate-600 leading-relaxed">
        One name can sit in every tab below as an approver, on other people's hierarchy links, in the requester directory and on an
        account. Find all of it first; the removal then clears every approver cell (or hands it to a successor), deletes the
        person's own mapping rows, and deactivates their directory rows and account - in one go. Approval steps still open on their
        name are listed for you to decide; they are not changed.
      </p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[14rem]">
          <SearchableDirectoryField
            showHint={false}
            label="Name (as written in the tables)"
            kind="approver"
            value={name}
            onChange={setName}
            onEnterPress={() => void preview()}
          />
        </div>
        <div className="flex-1 min-w-[14rem]">
          <SearchableDirectoryField
            showHint={false}
            label="Hand their approvals to (optional)"
            kind="approver"
            value={successor}
            onChange={setSuccessor}
          />
        </div>
        <button
          type="button"
          disabled={busy !== null || !name.trim()}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-40"
          onClick={() => void preview()}
        >
          {busy === 'preview' ? 'Looking…' : 'Find everywhere'}
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {scope && !scope.found && (
        <p className="text-sm text-slate-700">
          <span className="font-mono">{scope.name}</span> is not an approver, a requester or an account anywhere.
          {scope.openApprovals.length > 0 && ' Open approval steps still carry the name, listed below.'}
        </p>
      )}

      {scope && (scope.found || scope.openApprovals.length > 0) && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Accounts (deactivated)" count={scope.accounts.length}>
              <RowList
                rows={scope.accounts}
                render={(a) => (
                  <span>
                    <span className="font-mono">{a.email}</span> · {a.role}
                    {a.isActive ? '' : ' · already inactive'}
                  </span>
                )}
              />
            </Section>
            <Section title="Manager links on other accounts (cleared or handed over)" count={scope.hierarchyReferences.length}>
              <RowList
                rows={scope.hierarchyReferences}
                render={(r) => (
                  <span>
                    {r.name} — {r.fields.map(offboardingFieldLabel).join(', ')}
                  </span>
                )}
              />
            </Section>
            <Section title="Approver on mapping rows (cleared or handed over)" count={approverRows}>
              <div className="space-y-1.5">
                {approverTables.map((m) => (
                  <div key={m.table}>
                    <div className="font-semibold text-slate-800">
                      {m.label} · {m.asApprover.length}
                    </div>
                    <RowList
                      rows={m.asApprover}
                      render={(r) => (
                        <span>
                          {r.requesterName} <span className="font-mono text-slate-500">{r.businessUnit || '(empty BU)'}</span>
                          {r.teamName ? <span className="text-slate-500"> {r.teamName}</span> : null} —{' '}
                          {r.columns.map(offboardingFieldLabel).join(', ')}
                        </span>
                      )}
                    />
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Their own mapping rows (deleted)" count={ownRows}>
              <div className="space-y-1.5">
                {ownTables.map((m) => (
                  <div key={m.table}>
                    <div className="font-semibold text-slate-800">
                      {m.label} · {m.asRequester.length}
                    </div>
                    <RowList
                      rows={m.asRequester}
                      render={(r) => (
                        <span>
                          <span className="font-mono text-slate-500">{r.businessUnit || '(empty BU)'}</span>
                          {r.teamName ? <span className="text-slate-500"> {r.teamName}</span> : null}
                        </span>
                      )}
                    />
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Requester directory rows (deactivated)" count={scope.directoryRows.length}>
              <RowList
                rows={scope.directoryRows}
                render={(r) => (
                  <span>
                    {r.group} <span className="font-mono text-slate-500">{r.groupCode}</span> · rep {r.code}
                    {r.isActive ? '' : ' · already inactive'}
                  </span>
                )}
              />
            </Section>
            <Section title="Open approval steps on their name (not changed)" count={scope.openApprovals.length}>
              <RowList
                rows={scope.openApprovals}
                render={(a) => (
                  <span>
                    <span className="font-mono">{a.referenceNumber ?? a.formId}</span> · L{a.level} {a.role} · {a.status}
                  </span>
                )}
              />
              {scope.openApprovals.length > 0 && (
                <p className="mt-1 text-amber-800">
                  Decide these in Submitted requests (approve or reject on their behalf) so they do not wait for someone who has left.
                </p>
              )}
            </Section>
          </div>

          {scope.found && (
            <div className="rounded-lg border border-rose-300 bg-white p-3 space-y-2">
              <p className="text-xs text-slate-700">
                {successorShown ? (
                  <>
                    Approver cells and manager links go to <span className="font-mono">{successorShown}</span>;
                  </>
                ) : (
                  <>Approver cells and manager links are cleared, so those steps are skipped until someone is assigned;</>
                )}{' '}
                the person's own mapping rows are deleted, their directory rows and account deactivated. This cannot be undone from
                here - the Return matrix can be re-imported, the other tables edited row by row.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[14rem]">
                  <label htmlFor="offboard-confirm-name" className="block text-xs font-medium text-gray-600 mb-0.5">
                    Type <span className="font-mono">{scope.name}</span> to confirm
                  </label>
                  <input
                    id="offboard-confirm-name"
                    type="text"
                    className="border border-gray-200 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-rose-300 focus:border-rose-400 outline-none"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  disabled={!confirmed || busy !== null}
                  className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-medium hover:bg-rose-800 disabled:opacity-40"
                  onClick={() => void remove()}
                >
                  {busy === 'remove' ? 'Removing…' : `Remove ${scope.name} everywhere`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1" role="status">
          <p className="font-semibold">
            {result.scope.name} removed
            {result.successor ? (
              <>
                {' '}
                — approvals handed to <span className="font-mono">{result.successor.name}</span>
                {result.successor.userId ? '' : ' (no account with that name: links cleared, names written)'}
              </>
            ) : null}
            .
          </p>
          <p>
            Mapping rows updated {result.applied.mappingRowsUpdated} · deleted {result.applied.mappingRowsDeleted} · manager links
            updated {result.applied.hierarchyLinksUpdated} · directory rows deactivated {result.applied.directoryRowsDeactivated} ·
            accounts deactivated {result.applied.accountsDeactivated}
            {result.scope.openApprovals.length > 0 && ` · open approval steps left for you: ${result.scope.openApprovals.length}`}
          </p>
        </div>
      )}
    </div>
  );
}
