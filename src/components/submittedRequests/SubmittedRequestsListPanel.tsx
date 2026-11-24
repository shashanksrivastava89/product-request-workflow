/**
 * Shared filters + table + request detail modal (Data Management / Super approver inbox).
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import apiClient, { adminApi, approvalsApi, reportsApi, Approval, RequestSnapshot } from '../../services/api.service';
import {
  isFormTypeInScope,
  requestTypeOptionsForScope,
  type RequestListScope,
} from '../../constants/requestTypes';
import { useAuth } from '../../providers/AuthContext';
import {
    approveActionButtonLabel,
    formatApprovalAssigneeLine,
    formatCompactApprovalDateTime,
    rejectActionButtonLabel,
} from '../../utils/approval-display.util';
import { hasSuperApproverAccess } from '../../utils/user-roles';
import PrintButton from '../PrintButton';
import FormPrintView from '../FormPrintView';
import FormAttachmentsGallery from '../FormAttachmentsGallery';
import { BilingualFieldCaption } from '../BilingualFieldCaption';
import NotifyApproverModal from './NotifyApproverModal';
import DeleteRequestModal from './DeleteRequestModal';
import { formatProductCodes } from '../../utils/productCodes'
import { isReturnRequest, returnCreditTotal, returnRebillTotal } from '../RequestDetailSections'
import { formatQuantity } from '../../utils/numericInput'

const FORM_STATUSES = [
  { value: '', label: 'All (excl. drafts)' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'DRAFT', label: 'Draft only' },
] as const;

function statusStyle(s: string): string {
  switch (s) {
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'PENDING_APPROVAL':
    case 'IN_PROGRESS':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'REJECTED':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700 border-gray-200';
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    default:
      return 'bg-gray-50 text-gray-800 border-gray-200';
  }
}

function formatMoney(n: number, currency = 'JPY') {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(n);
}

export interface SubmittedRequestsListPanelProps {
  title: string;
  description: string;
  /** `support` = customer support read-only list via /api/support/forms */
  mode?: 'admin' | 'support' | 'znc-claim-approved';
  initialStatus?: string;
  initialStatusGroup?: '' | 'awaiting' | 'closed';
  /**
   * Which list this panel is serving. `return` pins the server-side form-type filter to RETURN and
   * offers only that option, so the Return super-approver inbox is not a second copy of the Sample
   * one. `sample` leaves the four sample types and drops returns. `all` filters nothing — that is
   * Data Management -> Submitted requests, which is deliberately one combined list.
   */
  scope?: RequestListScope;
}

export function SubmittedRequestsListPanel({
  title,
  description,
  mode = 'admin',
  initialStatus = '',
  initialStatusGroup = '',
  scope = 'sample',
}: SubmittedRequestsListPanelProps) {
  const { user } = useAuth();
  const isSupportMode = mode === 'support';
  const isZncClaimApprovedMode = mode === 'znc-claim-approved';
  const readOnly = isSupportMode || isZncClaimApprovedMode;
  const defaultBusinessUnit = isZncClaimApprovedMode ? 'CDG' : '';
  const [forms, setForms] = useState<RequestSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const [filters, setFilters] = useState({
    search: '',
    status: isSupportMode ? initialStatus : '',
    statusGroup: isSupportMode ? initialStatusGroup : ('' as '' | 'awaiting' | 'closed'),
    formType: '',
    businessUnit: defaultBusinessUnit,
    submittedFrom: '',
    submittedTo: '',
    includeDraft: false,
  });

  useEffect(() => {
    if (!isSupportMode) return;
    setPage(0);
    setFilters((f) => ({
      ...f,
      status: initialStatus,
      statusGroup: initialStatusGroup,
    }));
  }, [initialStatus, initialStatusGroup, isSupportMode]);

  const [detail, setDetail] = useState<{ form: any | null; loading: boolean }>({ form: null, loading: false });
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [stepComments, setStepComments] = useState<Record<string, string>>({});
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const activeApproval: Approval | undefined = Array.isArray(detail.form?.approvals)
    ? [...detail.form.approvals]
        .sort((a: Approval, b: Approval) => a.level - b.level)
        .find((a: Approval) => a.status === 'IN_PROGRESS')
    : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listParams = {
        search: filters.search.trim() || undefined,
        // The Return scope is pinned server-side; the others filter after the fetch, since the
        // list endpoint takes one form type rather than an exclusion.
        formType: scope === 'return' ? 'RETURN' : filters.formType || undefined,
        businessUnit: (filters.businessUnit || undefined) as 'CDG' | 'LSG' | undefined,
        submittedFrom: filters.submittedFrom || undefined,
        submittedTo: filters.submittedTo || undefined,
        limit: pageSize,
        offset: page * pageSize,
      };
      const res = isZncClaimApprovedMode
        ? await reportsApi.listZncClaimApprovedForms(listParams)
        : isSupportMode
        ? await adminApi.listSupportForms({
            ...listParams,
            status: filters.status || undefined,
            statusGroup: filters.statusGroup || undefined,
          })
        : await adminApi.listForms({
            ...listParams,
            status: filters.status || undefined,
            includeDraft: filters.includeDraft,
          });
      const rows = (res.forms || []).filter((f: { formType?: string }) =>
        isFormTypeInScope(f.formType, scope)
      );
      setForms(rows);
      setTotal(res.total ?? 0);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to load requests');
      setForms([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page, isSupportMode, isZncClaimApprovedMode]);

  useEffect(() => {
    load();
  }, [load]);

  const closeDetail = () => {
    setDetail({ form: null, loading: false });
    setDetailLoadError(null);
    setNotifyModalOpen(false);
    setDeleteModalOpen(false);
  };

  const openDetail = async (id: string) => {
    if (!id?.trim()) {
      setDetailLoadError('Missing request id.');
      return;
    }
    setDetailLoadError(null);
    setDetail({ form: null, loading: true });
    try {
      const { data } = await apiClient.get(`/forms/${id.trim()}`);
      setDetail({ form: data.form, loading: false });
    } catch (err: any) {
      setDetail({ form: null, loading: false });
      setDetailLoadError(
        err.response?.data?.message || err.message || 'Could not load request detail.'
      );
    }
  };

  /*
   * A link can name one request (`?expand=<formId>`, the parameter the list pages share). The
   * Pending and Approved lists send administrators and super approvers here when a mail's request
   * is not on their own list, so it opens at once - fetched by id, whatever page or filter the
   * table shows. One-off, so closing it does not reopen it.
   */
  const [searchParams] = useSearchParams();
  const linkedFormId = searchParams.get('expand');
  const [linkHandled, setLinkHandled] = useState(false);
  useEffect(() => {
    if (!linkedFormId || linkHandled) return;
    setLinkHandled(true);
    void openDetail(linkedFormId);
  }, [linkedFormId, linkHandled, openDetail]);

  const canActOnStep = (a: Approval) =>
    !readOnly &&
    a.status === 'IN_PROGRESS' &&
    (a.approverId === user?.id || hasSuperApproverAccess(user?.role, user?.isSuperApprover));

  const canReopenRejectedStep = (a: Approval) =>
    !readOnly &&
    detail.form?.status === 'REJECTED' &&
    a.status === 'REJECTED' &&
    (user?.role === 'ADMIN' ||
      hasSuperApproverAccess(user?.role, user?.isSuperApprover) ||
      a.approverId === user?.id ||
      (a.actualActorUserId != null && a.actualActorUserId === user?.id));

  const reloadDetailForm = async (formId: string) => {
    try {
      const { data } = await apiClient.get(`/forms/${formId}`);
      setDetail((prev) => ({ ...prev, form: data.form, loading: false }));
    } catch {
      /* keep existing detail */
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleNotifyApproverConfirm = async (): Promise<string> => {
    const approval = activeApproval;
    if (!approval || user?.role !== 'ADMIN' || detail.form?.status !== 'IN_PROGRESS') {
      throw new Error('Cannot send notification for this request');
    }
    setNotifyBusy(true);
    try {
      const res = await approvalsApi.notifyApprover(approval.id);
      if (detail.form?.id) await reloadDetailForm(detail.form.id);
      return res.message || `Notification sent to ${approval.approverName}`;
    } finally {
      setNotifyBusy(false);
    }
  };

  const handleDeleteRequestConfirm = async (): Promise<void> => {
    const id = detail.form?.id;
    if (!id || user?.role !== 'ADMIN') {
      throw new Error('Cannot delete this request');
    }
    setDeleteBusy(true);
    try {
      await apiClient.delete(`/forms/${id}`);
      closeDetail();
      await load();
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <label className="block text-xs font-medium text-gray-600">
            Search (ref or requester)
            <input
              type="text"
              value={filters.search}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, search: e.target.value }));
              }}
              placeholder="Reference or name…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          {!isZncClaimApprovedMode && (
          <label className="block text-xs font-medium text-gray-600">
            Status
            <select
              value={
                isSupportMode && filters.statusGroup === 'awaiting'
                  ? '__awaiting__'
                  : isSupportMode && filters.statusGroup === 'closed'
                    ? '__closed__'
                    : filters.status
              }
              onChange={(e) => {
                setPage(0);
                const v = e.target.value;
                if (v === '__awaiting__') {
                  setFilters((f) => ({ ...f, status: '', statusGroup: 'awaiting' }));
                } else if (v === '__closed__') {
                  setFilters((f) => ({ ...f, status: '', statusGroup: 'closed' }));
                } else {
                  setFilters((f) => ({ ...f, status: v, statusGroup: '' }));
                }
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              {FORM_STATUSES.filter((o) => !isSupportMode || o.value !== 'DRAFT').map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
              {isSupportMode && (
                <>
                  <option value="__awaiting__">Pending / in progress</option>
                  <option value="__closed__">Rejected / cancelled</option>
                </>
              )}
            </select>
          </label>
          )}
          {!isZncClaimApprovedMode && (
          <label className="block text-xs font-medium text-gray-600">
            Request type
            <select
              value={filters.formType}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, formType: e.target.value }));
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">All types</option>
              {requestTypeOptionsForScope(scope).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          )}
          <label className="block text-xs font-medium text-gray-600">
            Business unit
            <select
              value={filters.businessUnit}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, businessUnit: e.target.value }));
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              {!isZncClaimApprovedMode && <option value="">All</option>}
              <option value="CDG">CDG</option>
              <option value="LSG">LSG</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Submitted from
            <input
              type="date"
              value={filters.submittedFrom}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, submittedFrom: e.target.value }));
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Submitted to
            <input
              type="date"
              value={filters.submittedTo}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, submittedTo: e.target.value }));
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          {!isSupportMode && !isZncClaimApprovedMode && (
            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.includeDraft}
                  onChange={(e) => {
                    setPage(0);
                    setFilters((f) => ({ ...f, includeDraft: e.target.checked }));
                  }}
                  className="rounded border-gray-300 text-[#00A651] focus:ring-[#00A651]"
                />
                Include drafts (only when status not set)
              </label>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPage(0);
              setFilters({
                search: '',
                status: '',
                statusGroup: '',
                formType: '',
                businessUnit: defaultBusinessUnit,
                submittedFrom: '',
                submittedTo: '',
                includeDraft: false,
              });
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="px-3 py-1.5 text-sm rounded-lg bg-[#00A651] text-white hover:bg-[#008f45]"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">{error}</div>
      )}

      {detailLoadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{detailLoadError}</span>
          <button
            type="button"
            onClick={() => setDetailLoadError(null)}
            className="text-red-900 underline text-xs font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2">
          <span className="text-sm text-gray-600">
            {total} request{total !== 1 ? 's' : ''} total
            {loading && ' · Loading…'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">BU</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3 w-24"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {forms.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No requests match your filters.
                  </td>
                </tr>
              )}
              {forms.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-mono text-xs">{f.referenceNumber || '—'}</td>
                  <td className="px-4 py-3">{f.formType}</td>
                  <td className="px-4 py-3 max-w-[200px] truncate" title={f.requesterName}>
                    {f.requesterName}
                  </td>
                  <td className="px-4 py-3">{f.businessUnit || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle(f.status)}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(Number(f.totalAmount || 0))}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {f.submittedAt ? new Date(f.submittedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void openDetail(f.id);
                      }}
                      className="text-[#0066CC] hover:underline text-xs font-medium"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail.loading &&
        createPortal(
          <div className="fixed inset-0 bg-black/30 z-[200] flex items-center justify-center">
            <div className="bg-white rounded-lg px-6 py-4 shadow-xl">Loading…</div>
          </div>,
          document.body
        )}

      {detail.form &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
            onClick={closeDetail}
            role="presentation"
          >
            <div
              className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-start gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Request detail</h2>
                  <p className="text-sm text-gray-500 font-mono">{detail.form.referenceNumber || detail.form.id}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {readOnly && (
                    <PrintButton
                      targetId={`support-print-${detail.form.id}`}
                      label="Print"
                      variant="secondary"
                      className="text-xs py-1.5 px-3"
                    />
                  )}
                  <button
                    type="button"
                    onClick={closeDetail}
                    className="text-gray-500 hover:text-gray-800 text-xl leading-none px-2"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              {readOnly && (
                <div className="hidden">
                  <FormPrintView
                    id={`support-print-${detail.form.id}`}
                    form={detail.form}
                    approvals={detail.form.approvals}
                  />
                </div>
              )}
              <div className="px-6 py-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-gray-500">Type</span>
                    <div className="font-medium">{detail.form.formType}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Status</span>
                    <div className="font-medium">{detail.form.status}</div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Requester</span>
                    <div className="font-medium">{detail.form.requesterName}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Business unit</span>
                    <div>{detail.form.businessUnit || '—'}</div>
                  </div>
                  {isReturnRequest(detail.form) ? (
                    <div>
                      <span className="text-gray-500">Return total</span>
                      <div>
                        {formatMoney(returnCreditTotal(detail.form))}
                        {returnRebillTotal(detail.form) > 0 && (
                          <span className="text-gray-500"> · Re-bill {formatMoney(returnRebillTotal(detail.form))}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-gray-500">Total</span>
                      <div>{formatMoney(Number(detail.form.totalAmount || 0))}</div>
                    </div>
                  )}
                </div>
                {detail.form.products?.length > 0 && (
                  <div>
                    <span className="text-gray-500 block mb-1">Products</span>
                    <ul className="border rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                      {detail.form.products.map((p: any) => (
                        <li key={p.id} className="px-3 py-2 text-xs">
                          {/* A return line is credited and re-billed by the amounts the requester set
                              (catalogue price by default, overridable), as the approver's table and the
                              emails show - not by the catalogue subtotal this line used to show. */}
                          <div>
                            {p.productName} × {formatQuantity(p.quantity)} —{' '}
                            {isReturnRequest(detail.form) ? (
                              <>
                                Return {formatMoney(Number(p.returnAmount ?? 0))} · Re-bill{' '}
                                {formatMoney(Number(p.rebillAmount ?? 0))}
                              </>
                            ) : (
                              formatMoney(Number(p.subtotal || 0))
                            )}
                          </div>
                          {/* This list showed neither code, so a request could not be tied back to
                              the products it names. */}
                          <div className="text-gray-500">{formatProductCodes(p, '', detail.form.businessUnit)}</div>
                          {/* The lot the requester gave - always shown, "—" when none was given, as the
                              emails do. Hidden when blank, a request without a lot looked as if this
                              pop-up lacked the field. */}
                          <div className="text-gray-500">Batch / lot: {String(p.lotNumber ?? '').trim() || '—'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(detail.form.freeDescription || detail.form.commentsForApproval) && (
                  <div className="border-t border-gray-100 pt-3">
                    <span className="text-gray-500 block mb-2 font-medium">Justification / comments</span>
                    {detail.form.commentsForApproval && (
                      <p className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-2 mb-2">
                        {detail.form.commentsForApproval}
                      </p>
                    )}
                    {detail.form.freeDescription && (
                      <div>
                        <BilingualFieldCaption labelKey="wizard.bilingual.freeSample" compact className="mb-1" />
                        <p className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-2">
                          {detail.form.freeDescription}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {detail.form.formType === 'ZNCCLAIM' && detail.form.id && (
                  <FormAttachmentsGallery formId={detail.form.id} formType="ZNCCLAIM" className="border-t border-gray-100 pt-3" />
                )}

                {Array.isArray(detail.form.approvals) && detail.form.approvals.length > 0 && (
                  <div className="border-t border-gray-100 pt-3 mt-3">
                    <span className="text-gray-500 block mb-2 font-medium">Approval path</span>
                    <ul className="space-y-2">
                      {[...detail.form.approvals]
                        .sort((a: Approval, b: Approval) => a.level - b.level)
                        .map((a: Approval) => (
                          <li key={a.id} className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="font-semibold text-gray-900">
                                L{a.level} · {a.role}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  a.status === 'IN_PROGRESS'
                                    ? 'bg-amber-100 text-amber-900'
                                    : a.status === 'APPROVED'
                                      ? 'bg-emerald-100 text-emerald-900'
                                      : a.status === 'REJECTED'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-gray-200 text-gray-800'
                                }`}
                              >
                                {a.status}
                              </span>
                            </div>
                            <p className="text-gray-700 mt-1">{formatApprovalAssigneeLine(a)}</p>
                            {a.decidedAt && (
                              <p className="text-gray-500 mt-0.5">
                                {new Date(a.decidedAt).toLocaleString()}
                              </p>
                            )}
                            {a.comments && (
                              <p className="text-gray-600 mt-1 whitespace-pre-wrap border-t border-gray-200 pt-1">
                                {a.comments}
                              </p>
                            )}
                            {canReopenRejectedStep(a) && (
                              <div className="mt-2 border-t border-amber-200 pt-2">
                                <p className="text-[11px] text-amber-900 mb-2">
                                  Same form: reopen this step to approve or reject again.
                                </p>
                                <button
                                  type="button"
                                  disabled={stepBusy === a.id}
                                  onClick={async () => {
                                    setStepBusy(a.id);
                                    try {
                                      await approvalsApi.reopenRejectedApproval(a.id);
                                      if (detail.form?.id) await reloadDetailForm(detail.form.id);
                                      await load();
                                    } catch (err: any) {
                                      alert(err.response?.data?.message || err.message || 'Reopen failed');
                                    } finally {
                                      setStepBusy(null);
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50"
                                >
                                  {stepBusy === a.id ? '…' : 'Reopen step'}
                                </button>
                              </div>
                            )}
                            {canActOnStep(a) && (
                              <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                                <textarea
                                  value={stepComments[a.id] ?? ''}
                                  onChange={(e) =>
                                    setStepComments((prev) => ({ ...prev, [a.id]: e.target.value }))
                                  }
                                  placeholder="Optional comments (required to reject)"
                                  rows={2}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={stepBusy === a.id}
                                    onClick={async () => {
                                      setStepBusy(a.id);
                                      try {
                                        await approvalsApi.approveForm(a.id, stepComments[a.id]);
                                        setStepComments((prev) => ({ ...prev, [a.id]: '' }));
                                        if (detail.form?.id) await reloadDetailForm(detail.form.id);
                                        await load();
                                      } catch (err: any) {
                                        alert(err.response?.data?.message || err.message || 'Approve failed');
                                      } finally {
                                        setStepBusy(null);
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-[#00A651] text-white text-xs font-semibold disabled:opacity-50"
                                  >
                                    {stepBusy === a.id
                                      ? '…'
                                      : approveActionButtonLabel(user?.id, user?.role, a, 'Approve step', user?.isSuperApprover)}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={stepBusy === a.id}
                                    onClick={async () => {
                                      const c = (stepComments[a.id] || '').trim();
                                      if (!c) {
                                        alert('Comments are required when rejecting');
                                        return;
                                      }
                                      setStepBusy(a.id);
                                      try {
                                        await approvalsApi.rejectForm(a.id, c);
                                        setStepComments((prev) => ({ ...prev, [a.id]: '' }));
                                        if (detail.form?.id) await reloadDetailForm(detail.form.id);
                                        await load();
                                      } catch (err: any) {
                                        alert(err.response?.data?.message || err.message || 'Reject failed');
                                      } finally {
                                        setStepBusy(null);
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-50"
                                  >
                                    {rejectActionButtonLabel(user?.id, user?.role, a, 'Reject', user?.isSuperApprover)}
                                  </button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {user?.role === 'ADMIN' && (
                  <div className="border-t border-gray-100 pt-3 mt-3">
                    <span className="text-gray-500 block mb-2 font-medium">Administrator</span>
                    {detail.form?.status === 'IN_PROGRESS' && activeApproval && (
                      <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 text-xs">
                            <p className="text-gray-700">
                              Current approver:{' '}
                              <span className="font-semibold text-gray-900">{activeApproval.approverName}</span>
                              <span className="text-gray-600">
                                {' '}
                                (L{activeApproval.level} · {activeApproval.role})
                              </span>
                            </p>
                            {activeApproval.notifiedAt && (
                              <p className="text-gray-500 mt-1">
                                Last sent: {formatCompactApprovalDateTime(activeApproval.notifiedAt)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={notifyBusy || deleteBusy}
                            onClick={() => setNotifyModalOpen(true)}
                            className="shrink-0 w-full sm:w-auto px-3 py-2 rounded-lg border border-blue-300 bg-white text-blue-800 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
                          >
                            {notifyBusy ? 'Sending…' : 'Send notification to approver'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        disabled={deleteBusy || notifyBusy}
                        onClick={() => setDeleteModalOpen(true)}
                        className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-800 text-xs font-semibold hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        {deleteBusy ? 'Deleting…' : 'Delete request permanently'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {activeApproval && (
        <NotifyApproverModal
          isOpen={notifyModalOpen}
          approverName={activeApproval.approverName}
          level={activeApproval.level}
          role={activeApproval.role}
          referenceNumber={detail.form?.referenceNumber}
          lastSentAt={activeApproval.notifiedAt}
          onConfirm={handleNotifyApproverConfirm}
          onCancel={() => setNotifyModalOpen(false)}
        />
      )}

      {detail.form && (
        <DeleteRequestModal
          isOpen={deleteModalOpen}
          referenceNumber={detail.form.referenceNumber || detail.form.id}
          onConfirm={handleDeleteRequestConfirm}
          onCancel={() => setDeleteModalOpen(false)}
        />
      )}
    </div>
  );
}
