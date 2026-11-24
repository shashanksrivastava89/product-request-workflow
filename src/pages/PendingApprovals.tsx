import { useState, useEffect } from 'react';
import CloneRequestButton from '../components/CloneRequestButton';
import ReopenRequestButton from '../components/ReopenRequestButton';
import { endUserLabel, enteredByLabel, firstProductLabel, formatRequestDate, formatSubmittedDate, matchesEndUser, withinDateRange } from '../utils/requestDates';
import { isReturnReviewerRole, isSamePerson } from '../utils/return-approval.util';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../providers/I18nContext';
import { useAuth } from '../providers/AuthContext';
import { approvalsApi, requestsApi, Approval, RequestSnapshot, staticDataApi, Product } from '../services/api.service';
import apiClient from '../services/api.service';
import { deliveryModeDisplayLabel } from '../utils/deliveryMode';
import { formatShipToLabel } from '../utils/shipToDisplay';
import { toNonNegativeIntOrEmpty, blockNegativeAndDecimal } from '../utils/numericInput';
import {
    RETURN_REQUEST_TYPE_OPTIONS,
    SAMPLE_REQUEST_TYPE_OPTIONS,
    isFormTypeInScope,
} from '../constants/requestTypes';
import { mailboxTheme, type RequestSectionScope } from '../constants/sectionTheme';
import {
    PartnerAndDeliverySection,
    ProductLinesSection,
    RequesterCommentsSection,
    ReviewEditTrailSection,
    SubmissionHistorySection,
    isReturnRequest,
    returnTypeLabel,
} from '../components/RequestDetailSections';
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util';
import { formatApprovalAssigneeLine } from '../utils/approval-display.util';
import { BilingualFieldCaption } from '../components/BilingualFieldCaption';
import FormAttachmentsGallery from '../components/FormAttachmentsGallery';
import { RequestPeopleTiles, ReturnStageChip, isAtServiceReview } from '../components/RequestRowTiles';
import { hasServiceAdminPrivileges } from '../utils/service-admin.util';
import { isOnPendingList } from '../utils/pendingList';
import { dataManagementRequestLink } from '../utils/linkedRequest';

type FormWithApprovals = RequestSnapshot & {
  approvals?: Approval[];
  formDetails?: any;
  commentsForApproval?: string;
  freeDescription?: string;
  salesRepCodeSap?: string;
};

/** A return that came back rejected. Sample rows are left exactly as they were. */
function isRejectedReturn(form: FormWithApprovals): boolean {
  return form.status === 'REJECTED' && form.formType === 'RETURN';
}

/**
 * Sent back at the service review - the only rejection that can be reopened (Corlett, 25 Sep: "allow
 * Reopen for cases that have been rejected at the Service Review level only"). An approver's
 * rejection stands; the requester copies it into a new request. The server enforces the same rule.
 */
function rejectedAtReview(form: FormWithApprovals): boolean {
  const rejected = (form.approvals ?? []).find((a) => a.status === 'REJECTED');
  return Boolean(rejected) && isReturnReviewerRole(rejected!.role);
}

/**
 * A return that was reopened and is being corrected: a draft again, but one that has been submitted
 * before, so it still carries its reference number. It stays on its owner's list until they submit.
 */
function isReopenedDraft(form: FormWithApprovals): boolean {
  return form.status === 'DRAFT' && form.formType === 'RETURN' && Boolean(form.referenceNumber);
}

/**
 * Why it was rejected, and by whom - first, where the requester lands from the rejection mail.
 *
 * The reason was already on the page, but at the very bottom of the approval path, below the copy
 * block, the products and the comments. Someone arriving to put a request right needs it before
 * anything else.
 */
function RejectionReason({ form }: { form: FormWithApprovals }) {
  const step = (form.approvals ?? []).find((a) => a.status === 'REJECTED');
  if (!step) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2" role="status">
      <p className="text-sm font-bold text-red-800">
        <span lang="ja">差し戻し</span> / Rejected by {formatApprovalAssigneeLine(step)}
        {step.role ? <span className="font-normal text-red-700"> ({step.role})</span> : null}
        {step.decidedAt ? (
          <span className="font-normal text-red-700"> · {new Date(step.decidedAt).toLocaleString()}</span>
        ) : null}
      </p>
      {step.comments?.trim() ? (
        <p className="text-sm text-red-900 whitespace-pre-wrap bg-white/70 rounded-lg p-3">{step.comments}</p>
      ) : null}
    </div>
  );
}

/**
 * `scope` decides which section this page serves. Both the Sample and Return sections render this
 * same page; the Return tiles used to point at 31-line stubs, so a submitted return showed up only
 * in the Sample list and nowhere under Return.
 */
export default function PendingApprovals({ scope = 'sample' }: { scope?: RequestSectionScope }) {
    const theme = mailboxTheme(scope, 'pending');
    const accentBar = theme.accentBar;
    const isReturnScope = scope === 'return';
    const typeOptions = isReturnScope ? RETURN_REQUEST_TYPE_OPTIONS : SAMPLE_REQUEST_TYPE_OPTIONS;
    const { t } = useI18n();
    const { user } = useAuth();
    /**
     * Is this row the viewer's own submission? Relation, not role - see ApprovedRequests. A reviewer
     * or approver looking at somebody else's request keeps the full row; their own collapses.
     */
    const isOwnRequest = (form: { requesterId?: string; pendingRelation?: 'requester' | 'reviewer' }) =>
        !!user?.id && (form.requesterId === user.id || form.pendingRelation === 'requester');
    const navigate = useNavigate();
    const [forms, setForms] = useState<FormWithApprovals[]>([]);
    const [allForms, setAllForms] = useState<FormWithApprovals[]>([]);
    /**
     * Is there anybody else's request in this list?
     *
     * If not, a "Requester / entered by" box filters a column that never varies, so it goes - asked
     * for directly: *"for requestor, you can remove the requestor filter ... keep for other users"*.
     * Driven by the rows rather than the role on purpose: most Japanese managers are REQUESTERs who
     * also approve, and a role test would take the filter away from exactly the people who need it.
     */
    const showRequesterFilter = allForms.some((f) => !isOwnRequest(f));
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    /*
     * A mail can link straight at one request: the rejection mail sends the requester here to correct
     * and resubmit it, and the submission confirmation to follow it. Same mechanism as the approved
     * list and the approval inbox.
     */
    const [searchParams] = useSearchParams();
    const expandFormId = searchParams.get('expand');
    const [linkHandled, setLinkHandled] = useState(false);
    
    // Product catalog cache by business unit
    const [productCatalogs, setProductCatalogs] = useState<Record<string, Product[]>>({});
    const [loadingCatalogs, setLoadingCatalogs] = useState<Record<string, boolean>>({});
    
    // Filter states
    const [filters, setFilters] = useState({
        status: '',
        formType: '',
        minAmount: '',
        maxAmount: '',
        submittedFrom: '',
        submittedTo: '',
        requester: '',
        endUser: ''
    });
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => {
        fetchMyForms();
    }, []);

    // Fetch product catalogs for all business units in forms
    useEffect(() => {
        if (allForms.length === 0) return;

        const businessUnits = new Set<string>(
            allForms
                .map(f => f.businessUnit)
                .filter((bu): bu is string => Boolean(bu))
        );

        businessUnits.forEach(bu => {
            // Only fetch if not already cached and not currently loading
            if (!productCatalogs[bu] && !loadingCatalogs[bu]) {
                setLoadingCatalogs(prev => ({ ...prev, [bu]: true }));
                staticDataApi.getProductCatalog(bu)
                    .then(response => {
                        setProductCatalogs(prev => ({ ...prev, [bu]: response.products }));
                    })
                    .catch(error => {
                        console.error(`Failed to load product catalog for ${bu}:`, error);
                    })
                    .finally(() => {
                        setLoadingCatalogs(prev => ({ ...prev, [bu]: false }));
                    });
            }
        });
    }, [allForms]);

    const fetchMyForms = async () => {
        setIsLoading(true);
        setError(null);
        try {
            // Get requests snapshot from backend/data/requests.json via API
            const { requests } = await requestsApi.getPendingRequests();
            // Own requests, plus any the server marked as the service team's to follow — every
            // Service case not yet approved, at any stage (see getPendingRequests).
            // 'requester' covers a return raised in your name by somebody else: you are the one
            // mailed about it, so it is on your list. The same rule counts the Return home tile.
            const myPending = requests.filter((r) => isOnPendingList(r, user?.id));

            // Fetch approval history and full form details per form
            // Note: Products are now included in the requests response from backend
            const withApprovals = await Promise.all(
                myPending.map(async (req) => {
                    try {
                        const [approvalsRes, formRes] = await Promise.all([
                            approvalsApi.getApprovalHistory(req.id).catch(() => ({ approvals: [] })),
                            apiClient.get(`/forms/${req.id}`).catch(() => ({ data: { form: null } }))
                        ]);
                        return { 
                            ...req, 
                            approvals: approvalsRes.approvals || [],
                            formDetails: formRes.data?.form || null,
                            // Use products from request if available, otherwise from formDetails
                            products: (req as any).products || formRes.data?.form?.products || []
                        };
                    } catch {
                        return { ...req, approvals: [], formDetails: null, products: (req as any).products || [] };
                    }
                })
            );

            setAllForms(withApprovals);
            applyFilters(withApprovals);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load forms');
        } finally {
            setIsLoading(false);
        }
    };

    /** A linked request opens itself once the rows have arrived. One-off, so it never fights the reader. */
    useEffect(() => {
        if (!expandFormId || linkHandled || isLoading) return;
        const hit = allForms.find((f) => f.id === expandFormId);
        if (!hit) return;
        setLinkHandled(true);
        setExpanded((prev) => ({ ...prev, [hit.id]: true }));
        setTimeout(() => {
            document.getElementById(`pending-form-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
    }, [expandFormId, linkHandled, isLoading, allForms]);

    /*
     * The same links reach people who are not on this list at all - administrators and super
     * approvers on copy of a mail. For them every request is in Data Management, so the link opens
     * it there instead of leaving an empty list; everyone else is told why there is nothing to show.
     */
    const linkedRequestMissing =
        !!expandFormId && !isLoading && !error && !allForms.some((f) => f.id === expandFormId);
    const dataManagementLink = linkedRequestMissing ? dataManagementRequestLink(user, expandFormId) : null;
    useEffect(() => {
        if (dataManagementLink) navigate(dataManagementLink, { replace: true });
    }, [dataManagementLink, navigate]);

    /** Somebody else's request is on the list only for the service team: every Service case. */
    const hasReviewedRows = allForms.some((f) => f.pendingRelation === 'reviewer');
    const isServiceTeam = hasServiceAdminPrivileges(user);

    const applyFilters = (data: FormWithApprovals[]) => {
        // Section scope first: the Return page lists returns only, the Sample page everything else.
        // Without this a return showed in both, which is how UAT found it.
        let filtered = data.filter((f) => isFormTypeInScope(f.formType, scope));

        if (filters.status) {
            filtered = filtered.filter(f => f.status === filters.status);
        }

        if (filters.formType) {
            filtered = filtered.filter(f => f.formType === filters.formType);
        }

        if (filters.minAmount) {
            const min = parseFloat(filters.minAmount);
            filtered = filtered.filter(f => f.totalAmount >= min);
        }

        if (filters.maxAmount) {
            const max = parseFloat(filters.maxAmount);
            filtered = filtered.filter(f => f.totalAmount <= max);
        }

        // Vidhi: "make easier submitted date from / submitted date to". Keyed on submittedAt, which
        // a review edit cannot move, unlike the requestDate field on the form.
        if (filters.submittedFrom || filters.submittedTo) {
            filtered = filtered.filter(f => withinDateRange(f.submittedAt, filters.submittedFrom, filters.submittedTo));
        }

        if (filters.endUser.trim()) {
            filtered = filtered.filter(f => matchesEndUser(f, filters.endUser));
        }


        if (filters.requester.trim()) {
            const needle = filters.requester.trim().toLowerCase();
            filtered = filtered.filter(f =>
                String(f.requesterName ?? '').toLowerCase().includes(needle) ||
                String(f.requester?.name ?? '').toLowerCase().includes(needle)
            );
        }

        setForms(filtered);
    };

    useEffect(() => {
        if (allForms.length > 0) {
            applyFilters(allForms);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const handleFilterChange = (key: string, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => {
        setFilters({
            status: '',
            formType: '',
            minAmount: '',
            maxAmount: '',
            submittedFrom: '',
            submittedTo: '',
            requester: '',
            endUser: ''
        });
    };

    const getStatusBadge = (status: string) => {
        const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
            'PENDING_APPROVAL': { bg: 'bg-gradient-to-r from-yellow-400 to-yellow-500', text: 'text-white', label: t('approvals.status.pending'), icon: '⏳' },
            'IN_PROGRESS': { bg: 'bg-gradient-to-r from-blue-500 to-blue-600', text: 'text-white', label: 'In Progress', icon: '🔄' },
            'APPROVED': { bg: 'bg-gradient-to-r from-green-500 to-green-600', text: 'text-white', label: t('approvals.status.approved'), icon: '✅' },
            'REJECTED': { bg: 'bg-gradient-to-r from-red-500 to-red-600', text: 'text-white', label: t('approvals.status.rejected'), icon: '❌' },
            // Only a reopened return reaches this list as a draft: it is being corrected.
            'DRAFT': { bg: 'bg-gradient-to-r from-amber-500 to-amber-600', text: 'text-white', label: '修正中 / Being corrected', icon: '✏️' },
        };

        const config = statusConfig[status] || { bg: 'bg-gray-500', text: 'text-white', label: status, icon: '📄' };

        return (
            <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold shadow-md ${config.bg} ${config.text}`}>
                <span>{config.icon}</span>
                {config.label}
            </span>
        );
    };

    const getApprovalBadge = (status: Approval['status']) => {
        const statusConfig: Record<Approval['status'], { bg: string; text: string; label: string }> = {
            'PENDING': { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
            'IN_PROGRESS': { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
            'APPROVED': { bg: 'bg-green-100', text: 'text-green-800', label: 'Approved' },
            'REJECTED': { bg: 'bg-red-100', text: 'text-red-800', label: 'Rejected' },
        };

        const config = statusConfig[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status };

        return (
            <span className={`inline-block px-3 py-1 rounded-lg text-xs font-semibold ${config.bg} ${config.text}`}>
                {config.label}
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-[#00A651] border-t-transparent"></div>
                    <p className="mt-6 text-gray-600 font-medium">{t('common.loading')}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
                <div className="max-w-7xl mx-auto px-6 py-8">
                    <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-6 py-4 rounded-lg shadow-md">
                        <div className="flex items-center">
                            <span className="text-xl mr-3">⚠️</span>
                            <p className="font-semibold">{error}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Header Section */}
                <div className="relative bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl shadow-xl p-5 mb-5 border border-gray-200 overflow-hidden">
                    {/* Decorative background elements */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-[#00A651]/5 to-transparent rounded-full blur-3xl"></div>
                    
                    <div className="relative flex items-center justify-between">
                        <div className="flex-1">
                            <div className="flex items-start gap-3">
                                <div className="relative">
                                    <div className={`absolute inset-0 rounded-xl blur-lg opacity-50 bg-gradient-to-br ${accentBar}`}></div>
                                    <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform bg-gradient-to-br ${accentBar}`}>
                                        <span className="text-lg">📋</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h1 className="text-2xl font-extrabold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
                                            {t(isReturnScope ? 'return.pending.title' : 'approvals.pending.title')}
                                        </h1>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className={`h-0.5 w-6 rounded-full bg-gradient-to-r ${accentBar}`}></div>
                                        <p className="text-sm font-semibold text-gray-700">
                                            {t(
                                                isReturnScope
                                                    ? hasReviewedRows
                                                        ? 'return.pending.subtitleWithReviewed'
                                                        : 'return.pending.subtitle'
                                                    : 'approvals.pending.subtitle'
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="ml-4 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#00A651]/20 to-[#008a42]/10 rounded-xl blur-md"></div>
                            <div className="relative bg-gradient-to-br from-[#00A651]/15 to-[#008a42]/5 px-4 py-3 rounded-xl border-2 border-[#00A651]/30 backdrop-blur-sm">
                                <div className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-1">Total Requests</div>
                                <div className={`text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r ${accentBar}`}>
                                    {forms.length}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {linkedRequestMissing && !dataManagementLink && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 mb-4 text-sm" role="status">
                        The request from your e-mail link is not on this list: it shows here only for its requester
                        {isReturnScope ? ' and, for Service cases, the service team' : ''}. Ask the requester or an
                        administrator if you need it.
                    </div>
                )}

                {/* Filters Section */}
                <div className="bg-white rounded-xl shadow-md p-4 mb-4 border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-semibold text-gray-700"
                        >
                            <span>🔍</span>
                            <span>Filters</span>
                            <span className={`transform transition-transform ${showFilters ? 'rotate-180' : ''}`}>▼</span>
                        </button>
                        {(filters.status || filters.formType || filters.minAmount || filters.maxAmount || filters.submittedFrom || filters.submittedTo || filters.requester || filters.endUser) && (
                            <button
                                onClick={clearFilters}
                                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors font-semibold"
                            >
                                Clear All
                            </button>
                        )}
                    </div>

                    {showFilters && (
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-3 border-t border-gray-200">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Status</label>
                                <select
                                    value={filters.status}
                                    onChange={(e) => handleFilterChange('status', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                >
                                    <option value="">All Status</option>
                                    <option value="PENDING_APPROVAL">Pending Approval</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="REJECTED">Rejected</option>
                                    <option value="DRAFT">Being corrected</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Form Type</label>
                                <select
                                    value={filters.formType}
                                    onChange={(e) => handleFilterChange('formType', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                >
                                    <option value="">All Types</option>
                                    {typeOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Min Amount (¥)</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={filters.minAmount}
                                    onKeyDown={blockNegativeAndDecimal}
                                    onChange={(e) => handleFilterChange('minAmount', toNonNegativeIntOrEmpty(e.target.value))}
                                    placeholder="0"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Max Amount (¥)</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={filters.maxAmount}
                                    onKeyDown={blockNegativeAndDecimal}
                                    onChange={(e) => handleFilterChange('maxAmount', toNonNegativeIntOrEmpty(e.target.value))}
                                    placeholder="∞"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Submitted From</label>
                                <input
                                    type="date"
                                    value={filters.submittedFrom}
                                    onChange={(e) => handleFilterChange('submittedFrom', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Submitted To</label>
                                <input
                                    type="date"
                                    value={filters.submittedTo}
                                    onChange={(e) => handleFilterChange('submittedTo', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                            {/* Matches the named requester or the account that entered it. */}
                            {showRequesterFilter && (
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Requester / entered by</label>
                                <input
                                    type="text"
                                    value={filters.requester}
                                    onChange={(e) => handleFilterChange('requester', e.target.value)}
                                    placeholder="Name"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                            )}
                            {/* End User, by name or by customer code. */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">End User</label>
                                <input
                                    type="text"
                                    value={filters.endUser}
                                    onChange={(e) => handleFilterChange('endUser', e.target.value)}
                                    placeholder="Name or code"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] text-sm"
                                />
                            </div>
                        </div>
                    )}
                </div>

            {forms.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-md p-10 text-center border border-gray-100">
                        <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-3xl">📋</span>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-1">No Pending Requests</h3>
                        <p className="text-gray-500 text-sm">{t('approvals.pending.empty')}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {forms.map((form) => (
                            <div 
                                key={form.id} 
                                id={`pending-form-${form.id}`}
                                className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300"
                            >
                                <button
                                    className="w-full flex items-start justify-between p-4 hover:bg-gray-50 transition-colors"
                                    onClick={() => setExpanded(prev => ({ ...prev, [form.id]: !prev[form.id] }))}
                                >
                                <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className="text-base font-bold text-gray-900">
                                        {form.referenceNumber || form.id.slice(0, 8)}
                                            </span>
                                            {getStatusBadge(form.status)}
                                            {/* Where it stands: at review, with which approver, sent back or rejected. */}
                                            {isReturnScope && <ReturnStageChip form={form} />}
                                            {/* The sample compact row has no requester tile, so say it here. */}
                                            {!isReturnScope && isOwnRequest(form) && !isSamePerson(form.requesterName, user?.name) && form.requesterName && (
                                                <span className="text-xs text-gray-500 truncate">for {form.requesterName}</span>
                                            )}
                                        </div>
                                        {isReturnScope ? (
                                        /* Requester, Submitter and Submitted lead every return row - see RequestPeopleTiles. */
                                        <div className={`grid gap-3 ${isOwnRequest(form) ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>
                                            <RequestPeopleTiles
                                                requesterName={form.requesterName}
                                                salesRepCode={form.salesRepCodeSap}
                                                submitterName={form.requester?.name}
                                                submittedAt={form.submittedAt}
                                            />
                                            {isOwnRequest(form) ? (
                                                <>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                                            </div>
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{form.totalAmount.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Product</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={firstProductLabel(form)}>{firstProductLabel(form)}</div>
                                            </div>
                                                </>
                                            ) : (
                                                <>
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{form.totalAmount.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Return type</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={returnTypeLabel(form.returnType)}>{returnTypeLabel(form.returnType)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Products</div>
                                                <div className="text-xs font-bold text-gray-900">{(form as any).products?.length || form.formDetails?.products?.length || 0} items</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Date requesting</div>
                                                <div className="text-xs font-bold text-gray-900">{formatRequestDate(form.requestDate)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                                            </div>
                                                </>
                                            )}
                                        </div>
                                        ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            {isOwnRequest(form) ? (
                                                <>
                                            {/*
                                              A rep's own request collapses to what they scan for
                                              when hunting the one to clone. Everybody else's row is
                                              unchanged below.
                                            */}
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Submitted</div>
                                                <div className="text-xs font-bold text-gray-900">{formatSubmittedDate(form.submittedAt)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                                            </div>
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{form.totalAmount.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Product</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={firstProductLabel(form)}>{firstProductLabel(form)}</div>
                                            </div>
                                                </>
                                            ) : (
                                                <>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Requester</div>
                                                <div className="text-xs font-bold text-gray-900">
                                                    {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap) || 'Unknown'}
                                                </div>
                                                {/* Shown only when the account that filled it in is not the named requester. */}
                                                {enteredByLabel(form.requesterName, form.requester?.name) && (
                                                    <div className="text-[10px] text-gray-500 truncate">
                                                        entered by {enteredByLabel(form.requesterName, form.requester?.name)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Type</div>
                                                <div className="text-xs font-bold text-gray-900">{form.formType || 'N/A'}</div>
                                            </div>
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{form.totalAmount.toLocaleString()}</div>
                                            </div>
                                            {/* A return has no delivery date; show what it does have. */}
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                                                    {isReturnRequest(form) ? 'Return type' : 'Delivery Date'}
                                                </div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={isReturnRequest(form) ? returnTypeLabel(form.returnType) : undefined}>
                                                    {isReturnRequest(form)
                                                        ? returnTypeLabel(form.returnType)
                                                        : form.expectedDeliveryDate === 'ASAP'
                                                          ? 'ASAP'
                                                          : form.expectedDeliveryDate
                                                            ? new Date(form.expectedDeliveryDate).toLocaleDateString()
                                                            : '—'}
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Products</div>
                                                <div className="text-xs font-bold text-gray-900">{(form as any).products?.length || form.formDetails?.products?.length || 0} items</div>
                                            </div>
                                            {/* The row carried no date at all. Two of them, never conflated. */}
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Submitted</div>
                                                <div className="text-xs font-bold text-gray-900">{formatSubmittedDate(form.submittedAt)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Date requesting</div>
                                                <div className="text-xs font-bold text-gray-900">{formatRequestDate(form.requestDate)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(form)}>{endUserLabel(form)}</div>
                                            </div>
                                                </>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                    <div className="ml-4 flex items-center">
                                        <div className={`w-8 h-8 rounded-full bg-[#00A651]/10 flex items-center justify-center transition-transform ${expanded[form.id] ? 'rotate-90' : ''}`}>
                                            <span className="text-[#00A651] text-base font-bold">▶</span>
                                        </div>
                                    </div>
                                </button>

                                {expanded[form.id] && (
                                    <div className="border-t border-gray-200 bg-gray-50">
                                        <div className="p-4 space-y-4">
                                            {isRejectedReturn(form) && <RejectionReason form={form} />}
                                            {/* A case at its review step, seen from the service team's list: act on it in the queue. */}
                                            {isReturnScope && isServiceTeam && isAtServiceReview(form) && (
                                                <button
                                                    type="button"
                                                    onClick={() => navigate(`/return/review?expand=${encodeURIComponent(form.id)}`)}
                                                    className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-900 text-sm font-bold transition-colors"
                                                >
                                                    <span lang="ja">サービス確認で開く</span> / Open in Service Review →
                                                </button>
                                            )}
                                            {/* A rejected return is reopened and corrected in place, keeping
                                                its reference number and history - offered to whoever may
                                                (the person who entered it, or the rep it names). */}
                                            {isRejectedReturn(form) && isOwnRequest(form) && rejectedAtReview(form) && (
                                                <ReopenRequestButton formId={form.id} onError={setError} />
                                            )}
                                            {/* Somebody else is correcting it: the service team sees the case, not a draft to continue. */}
                                            {isReopenedDraft(form) && form.requesterId !== user?.id && (
                                                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-1">
                                                    <p className="text-sm font-semibold text-amber-950" lang="ja">
                                                        この申請は{form.requester?.name ? `${form.requester.name}さん` : '申請者'}が修正中です。送信されると、同じ参照番号で再び承認へ回ります。
                                                    </p>
                                                    <p className="text-xs text-amber-900">
                                                        {form.requester?.name || 'The requester'} reopened this request and is correcting it. When they submit it, it goes for approval again under the same reference number.
                                                    </p>
                                                </div>
                                            )}
                                            {isReopenedDraft(form) && form.requesterId === user?.id && (
                                                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                                                    <p className="text-sm font-semibold text-amber-950" lang="ja">
                                                        この申請は修正中です。修正を終えて送信すると、同じ参照番号で再申請されます。
                                                    </p>
                                                    <p className="text-xs text-amber-900">
                                                        You reopened this request to correct it. Submitting sends it for approval again under the same reference number.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(`/return/new?draft=${encodeURIComponent(form.id)}`)}
                                                        className="min-h-[44px] px-4 py-2.5 rounded-lg bg-[#00A651] hover:bg-[#008a42] text-white text-sm font-bold shadow-md transition-colors"
                                                        lang="ja"
                                                    >
                                                        修正を続ける / Continue correcting
                                                    </button>
                                                </div>
                                            )}
                                            {/* Any request, at any stage. See CloneRequestButton. Beside a reopen
                                                it is the second choice, so it drops to a plain button. */}
                                            {!isReopenedDraft(form) && (
                                                <CloneRequestButton
                                                    formId={form.id}
                                                    onError={setError}
                                                    variant={isRejectedReturn(form) && isOwnRequest(form) && rejectedAtReview(form) ? 'inline' : 'block'}
                                                />
                                            )}
                                            {form && (
                                                <>
                                                    <PartnerAndDeliverySection form={form} accent={accentBar} />
                                                    <ProductLinesSection form={form} accent={accentBar} />
                                                    <RequesterCommentsSection form={form} accent={accentBar} />
                                                    <ReviewEditTrailSection reviewEdits={form.reviewEdits} accent={accentBar} />
                                                    <SubmissionHistorySection history={form.approvalHistory} accent={accentBar} />
                                                </>
                                            )}
                                            {form.formType === 'ZNCCLAIM' && form.id && (
                                                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                                    <FormAttachmentsGallery formId={form.id} formType="ZNCCLAIM" />
                                                </div>
                                            )}


                                            {form.approvals && form.approvals.length > 0 && (
                                                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <div className={`w-1 h-4 rounded-full bg-gradient-to-b ${accentBar}`}></div>
                                                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Approval Path</h4>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {form.approvals
                                                            .slice()
                                                            .sort((a, b) => a.level - b.level)
                                                            .map((approval) => {
                                                                return (
                                                                    <div
                                                                        key={approval.id}
                                                                        className="rounded-xl border-2 border-gray-200 bg-gradient-to-r from-gray-50 to-white hover:border-[#00A651] transition-all overflow-hidden"
                                                                    >
                                                                        <div className="flex items-center justify-between px-5 py-4">
                                                                            <div className="flex items-center gap-4 flex-1">
                                                                                <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#00A651] to-[#008a42] text-white flex items-center justify-center text-sm font-bold shadow-md">
                                                                                    {approval.level}
                                                                                </span>
                                                                                <div className="flex-1">
                                                                                    <p className="text-sm font-bold text-gray-900">
                                                                                        {approval.role}
                                                                                    </p>
                                                                                    <p className="text-xs text-gray-600 mt-1 font-medium">
                                                                                        {formatApprovalAssigneeLine(approval)}
                                                                                    </p>
                                                                                    {approval.decidedAt && (
                                                                                        <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                                                                                            <span className="font-semibold">{approval.status === 'APPROVED' ? '✓ Approved' : '✗ Rejected'}</span>
                                                                                            <span className="text-gray-400">•</span>
                                                                                            <span>{new Date(approval.decidedAt).toLocaleString()}</span>
                                                                                        </p>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            {getApprovalBadge(approval.status)}
                                                                        </div>
                                                                        {approval.comments && (
                                                                            <div className="px-5 pb-4 pt-0 border-t border-gray-200 bg-white">
                                                                                <p className="text-xs font-semibold text-gray-700 mb-1 mt-3">Comments:</p>
                                                                                <p className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{approval.comments}</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                        </div>
                    ))}
                </div>
            )}
            </div>
        </div>
    );
}
