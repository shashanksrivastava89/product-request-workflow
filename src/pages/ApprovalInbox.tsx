import { useState, useEffect } from 'react';
import CloneRequestButton from '../components/CloneRequestButton'
import { endUserLabel, matchesEndUser, withinDateRange } from '../utils/requestDates'
import { useI18n } from '../providers/I18nContext';
import apiClient, { approvalsApi, formsApi, Approval, staticDataApi, Product } from '../services/api.service';
import PrintButton from '../components/PrintButton';
import FormPrintView from '../components/FormPrintView';
import FormAttachmentsGallery from '../components/FormAttachmentsGallery';
import { BilingualFieldCaption } from '../components/BilingualFieldCaption';
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
import { useAuth } from '../providers/AuthContext';
import { approveActionButtonLabel } from '../utils/approval-display.util';
import { isReturnReviewerRole } from '../utils/return-approval.util'
import { RequestPeopleTiles } from '../components/RequestRowTiles'
import { Link, useSearchParams } from 'react-router-dom'
import {
    RETURN_REQUIRED_FIELD_LABEL_KEYS,
    missingReturnFieldsForApproval,
} from '../utils/returnCompleteness'

/**
 * `scope` decides which section this inbox serves. Both sections render this same page; the Return
 * tile used to point at a 31-line stub, so an approver saw return requests only in the Sample inbox.
 */
export default function ApprovalInbox({
    scope = 'sample',
    onlyReviewSteps = false,
}: {
    scope?: RequestSectionScope
    /**
     * Show ONLY the service review step, for the /return/review queue.
     *
     * The same component rather than a copy: a reviewer needs the whole detail view, the product
     * lines, the print sheet and the approve/reject buttons that already live here. The server
     * decides whether a review step is visible at all — this only narrows what is displayed.
     */
    onlyReviewSteps?: boolean
}) {
    const theme = mailboxTheme(scope, 'inbox');
    const accentBar = theme.accentBar;
    const isReturnScope = scope === 'return';
    const typeOptions = isReturnScope ? RETURN_REQUEST_TYPE_OPTIONS : SAMPLE_REQUEST_TYPE_OPTIONS;
    const { t } = useI18n();
    const { user } = useAuth();
    const [approvals, setApprovals] = useState<Approval[]>([]);
    const [allApprovals, setAllApprovals] = useState<Approval[]>([]);
    /**
     * Is there anybody else's request in this list?
     *
     * If not, a "Requester / entered by" box filters a column that never varies, so it goes - asked
     * for directly: *"for requestor, you can remove the requestor filter ... keep for other users"*.
     * Driven by the rows rather than the role on purpose: most Japanese managers are REQUESTERs who
     * also approve, and a role test would take the filter away from exactly the people who need it.
     */
    const showRequesterFilter = allApprovals.some((a) => a.form?.requesterId !== user?.id);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState<{ id: string; type: 'approve' | 'reject' | 'reopen' | 'delete' } | null>(null);
    const [comments, setComments] = useState<Record<string, string>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    // The correction screen sends the reviewer back here with the request they were on already
    // open (`?expand=<formId>`), so Cancel and Save both land where they left off.
    const [searchParams] = useSearchParams();
    const expandFormId = searchParams.get('expand');
    
    // Product catalog cache by business unit
    const [productCatalogs, setProductCatalogs] = useState<Record<string, Product[]>>({});
    const [loadingCatalogs, setLoadingCatalogs] = useState<Record<string, boolean>>({});
    
    // Filter states
    /*
     * The same set the two list pages carry, so the three screens filter alike.
     *
     * The old pair was labelled Date From / Date To and keyed on `requestDate`, the date the
     * requester typed into the form - which reads as the submission date and is not, and sat beside
     * a Submitted column that came from somewhere else entirely. One pair of dates, on the date
     * things actually happened.
     */
    const [filters, setFilters] = useState({
        formType: '',
        minAmount: '',
        maxAmount: '',
        requester: '',
        submittedFrom: '',
        submittedTo: '',
        endUser: ''
    });
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => {
        fetchApprovals();
    }, []);

    // Fetch product catalogs for all business units in approvals
    useEffect(() => {
        if (allApprovals.length === 0) return;

        const businessUnits = new Set<string>(
            allApprovals
                .map(a => a.form?.businessUnit)
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
    }, [allApprovals]);

    const fetchApprovals = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await approvalsApi.getPendingApprovals();
            setAllApprovals(data.approvals);
            applyFilters(data.approvals);
            if (expandFormId) {
                const hit = data.approvals.find((a: Approval) => a.formId === expandFormId);
                if (hit) {
                    setExpanded((prev) => ({ ...prev, [hit.id]: true }));
                    setTimeout(() => {
                        document.getElementById(`approval-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 150);
                }
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load approvals');
        } finally {
            setIsLoading(false);
        }
    };

    const applyFilters = (data: Approval[]) => {
        // Section scope first — see PendingApprovals. GET /approvals has never filtered by form
        // type, so without this the Sample inbox showed return approvals as if they were samples.
        let filtered = data.filter((a) => isFormTypeInScope(a.form?.formType, scope));

        // Each request belongs to exactly ONE queue: a review step appears in the Service review
        // queue, and nowhere else. Before this a reviewer saw the same single item twice, once in
        // each card, because their inbox contained nothing but review steps — two doors on one
        // thing. A reviewer who is also an approver still sees both cards, each with its own items.
        filtered = onlyReviewSteps
            ? filtered.filter((a) => isReturnReviewerRole(a.role))
            : filtered.filter((a) => !isReturnReviewerRole(a.role));

        if (filters.formType) {
            filtered = filtered.filter(a => a.form?.formType === filters.formType);
        }

        if (filters.minAmount) {
            const min = parseFloat(filters.minAmount);
            filtered = filtered.filter(a => (a.form?.totalAmount || 0) >= min);
        }

        if (filters.maxAmount) {
            const max = parseFloat(filters.maxAmount);
            filtered = filtered.filter(a => (a.form?.totalAmount || 0) <= max);
        }

        // The named requester or the account that entered it, as on the list pages.
        if (filters.requester) {
            const needle = filters.requester.toLowerCase();
            filtered = filtered.filter((a) =>
                [a.form?.requesterName, a.form?.requester?.name]
                    .some((n) => String(n ?? '').toLowerCase().includes(needle))
            );
        }

        if (filters.submittedFrom || filters.submittedTo) {
            filtered = filtered.filter((a) =>
                withinDateRange(a.form?.submittedAt, filters.submittedFrom, filters.submittedTo)
            );
        }

        if (filters.endUser.trim()) {
            filtered = filtered.filter((a) => matchesEndUser(a.form, filters.endUser));
        }

        setApprovals(filtered);
    };

    useEffect(() => {
        if (allApprovals.length > 0) {
            applyFilters(allApprovals);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const handleFilterChange = (key: string, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => {
        setFilters({
            formType: '',
            minAmount: '',
            maxAmount: '',
            requester: '',
            submittedFrom: '',
            submittedTo: '',
            endUser: ''
        });
    };

    const handleApprove = async (approvalId: string, formId?: string, currentLevel?: number, referenceNumber?: string) => {
        setProcessing({ id: approvalId, type: 'approve' });
        try {
            await approvalsApi.approveForm(approvalId, comments[approvalId]);
            // After approval, notify next approver (send email)
            if (formId) {
                try {
                    let next: Approval | undefined = undefined;
                    // Retry fetching updated history briefly to allow backend to advance the workflow state
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const { approvals: history } = await approvalsApi.getApprovalHistory(formId);
                        next = history
                            .filter(a => a.status === 'PENDING' && (currentLevel == null || a.level > currentLevel))
                            .sort((a, b) => a.level - b.level)[0];
                        if (next) break;
                        await new Promise(res => setTimeout(res, 500));
                    }
                    if (next?.approverEmail) {
                        const subj = `Approval needed — Form ${referenceNumber || formId} — Level ${next.level}`;
                        const body = `Role: ${next.role}\nApprover: ${next.approverName}\nForm: ${referenceNumber || formId}\nCurrent Level Approved: ${currentLevel ?? 'N/A'}`;
                        console.log('Notify next approver:', { level: next.level, role: next.role, approver: next.approverName });
                        await apiClient.post('/notifications/email', {
                            to: next.approverEmail,
                            subject: subj,
                            body,
                        }).catch(() => {});
                    }
                } catch {
                    // Ignore notification errors to avoid blocking UI
                }
            }
            // Refresh the list
            await fetchApprovals();
            // Clear comments
            setComments(prev => ({ ...prev, [approvalId]: '' }));
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || 'Failed to approve form';
            const isTimeout = err.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout');
            alert(isTimeout
                ? `${msg}\n\nNote: The approval have succeeded. Please refresh the page`
                : msg);
        } finally {
            setProcessing(null);
        }
    };

    const [discardingFormId, setDiscardingFormId] = useState<string | null>(null);

    /**
     * Undo every correction the review team made to this request. Confirmed first, because it
     * touches figures an approver may already have been emailed about; the trail records the
     * revert rather than erasing the edits, so nothing is hidden from them.
     */
    const handleDiscardCorrections = async (formId: string) => {
        if (!window.confirm(t('return.review.discardAllConfirm'))) return;
        setDiscardingFormId(formId);
        try {
            await formsApi.revertReviewEdits(formId);
            await fetchApprovals();
        } catch (err: any) {
            alert(err.response?.data?.message || err.response?.data?.error || 'Could not discard the corrections');
        } finally {
            setDiscardingFormId(null);
        }
    };

    /**
     * Fields still empty on a review step's request, which must be filled before it goes onward.
     *
     * Empty for every other queue: only the review step accepts an incomplete request, because the
     * requester is allowed to leave the order number and invoice date to this team.
     */
    const blockedFields = (approval: Approval): string[] => {
        if (!onlyReviewSteps || !approval.form) return [];
        return missingReturnFieldsForApproval({
            ...approval.form,
            products: approval.form.products ?? [],
        }).map((f) => t(RETURN_REQUIRED_FIELD_LABEL_KEYS[f]));
    };

    const handleReject = async (approvalId: string) => {
        const comment = comments[approvalId];
        if (!comment || comment.trim() === '') {
            alert('Comments are required when rejecting a form');
            return;
        }

        setProcessing({ id: approvalId, type: 'reject' });
        try {
            await approvalsApi.rejectForm(approvalId, comment);
            // Refresh the list
            await fetchApprovals();
            // Clear comments
            setComments(prev => ({ ...prev, [approvalId]: '' }));
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || 'Failed to reject form';
            const isTimeout = err.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout');
            alert(isTimeout
                ? `${msg}\n\nNote: The rejection may have succeeded. Please refresh the page to check.`
                : msg);
        } finally {
            setProcessing(null);
        }
    };

    const handleReopenRejected = async (approvalId: string) => {
        setProcessing({ id: approvalId, type: 'reopen' });
        try {
            await approvalsApi.reopenRejectedApproval(approvalId);
            await fetchApprovals();
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || 'Failed to reopen';
            alert(msg);
        } finally {
            setProcessing(null);
        }
    };

    /**
     * Take a rejected request out of this person's inbox. Only theirs: the request is kept, and a
     * super approver still sees it. Dropped from the list in place rather than reloading it, so the
     * page does not flash back to its spinner.
     */
    const handleDeleteRejected = async (approvalId: string) => {
        if (!window.confirm(t('approvals.inbox.deleteConfirm'))) return;
        setProcessing({ id: approvalId, type: 'delete' });
        try {
            await approvalsApi.dismissRejectedApproval(approvalId);
            setAllApprovals((prev) => prev.filter((a) => a.id !== approvalId));
            setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
        } catch (err: any) {
            alert(err.response?.data?.message || err.message || 'Could not delete it from your inbox');
        } finally {
            setProcessing(null);
        }
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
                                        <span className="text-lg">{onlyReviewSteps ? '🔎' : '📥'}</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h1 className="text-2xl font-extrabold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
                                            {onlyReviewSteps
                                                ? t('return.review.title')
                                                : t(isReturnScope ? 'return.inbox.title' : 'approvals.inbox.title')}
                                        </h1>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className={`h-0.5 w-6 rounded-full bg-gradient-to-r ${accentBar}`}></div>
                                        <p className="text-sm font-semibold text-gray-700">{onlyReviewSteps
                                            ? t('return.review.subtitle')
                                            : t(isReturnScope ? 'return.inbox.subtitle' : 'approvals.inbox.subtitle')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="ml-4 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#00A651]/20 to-[#008a42]/10 rounded-xl blur-md"></div>
                            <div className="relative bg-gradient-to-br from-[#00A651]/15 to-[#008a42]/5 px-4 py-3 rounded-xl border-2 border-[#00A651]/30 backdrop-blur-sm">
                                <div className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-1">Pending Items</div>
                                <div className={`text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r ${accentBar}`}>
                                    {approvals.length}
                                </div>
                </div>
                                </div>
                                </div>
                            </div>

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
                        {(filters.formType || filters.minAmount || filters.maxAmount || filters.requester || filters.submittedFrom || filters.submittedTo) && (
                            <button
                                onClick={clearFilters}
                                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors font-semibold"
                            >
                                Clear All
                            </button>
                        )}
                                            </div>

                    {showFilters && (
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-gray-200">
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

                {approvals.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-md p-10 text-center border border-gray-100">
                        <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-3xl">📭</span>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-1">{onlyReviewSteps ? t('return.review.emptyTitle') : 'No Pending Approvals'}</h3>
                        <p className="text-gray-500 text-sm">{onlyReviewSteps ? t('return.review.empty') : t('approvals.inbox.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {approvals.map((approval) => (
                            <div 
                                key={approval.id}
                                id={`approval-${approval.id}`} 
                                className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300"
                            >
                                <div className="w-full flex items-start justify-between p-4 hover:bg-gray-50 transition-colors gap-2">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="flex-1 min-w-0 text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#00A651] focus-visible:ring-offset-2 cursor-pointer"
                                        onClick={() => setExpanded((prev) => ({ ...prev, [approval.id]: !prev[approval.id] }))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setExpanded((prev) => ({ ...prev, [approval.id]: !prev[approval.id] }));
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                                            <div className={`px-3 py-1 text-white rounded-lg font-bold text-xs shadow-md bg-gradient-to-r ${accentBar}`}>
                                                Level {approval.level}
                                            </div>
                                            {approval.status === 'REJECTED' && (
                                                <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800 text-xs font-bold">
                                                    {t('approvals.status.rejected')}
                                                </span>
                                            )}
                                            <span className="text-base font-bold text-gray-900">
                                                {approval.form?.referenceNumber || approval.formId.slice(0, 8)}
                                            </span>
                                            {approval.status === 'REJECTED' && (
                                                <button
                                                    type="button"
                                                    disabled={processing?.id === approval.id}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleReopenRejected(approval.id);
                                                    }}
                                                    className="inline-flex items-center justify-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    {processing?.id === approval.id && processing?.type === 'reopen' ? (
                                                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                                                    ) : null}
                                                    <span>{t('approvals.inbox.reopenShort')}</span>
                                                </button>
                                            )}
                                            {approval.status === 'REJECTED' && (
                                                <button
                                                    type="button"
                                                    disabled={processing?.id === approval.id}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleDeleteRejected(approval.id);
                                                    }}
                                                    title={t('approvals.inbox.deleteHint')}
                                                    className="inline-flex items-center justify-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-700 text-xs font-bold shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    {processing?.id === approval.id && processing?.type === 'delete' ? (
                                                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-600 border-t-transparent" aria-hidden />
                                                    ) : null}
                                                    <span>{t('approvals.inbox.deleteShort')}</span>
                                                </button>
                                            )}
                                        </div>
                                        {isReturnScope ? (
                                        /* Requester, Submitter and Submitted lead every return row - see RequestPeopleTiles. */
                                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                                            <RequestPeopleTiles
                                                requesterName={approval.form?.requesterName}
                                                salesRepCode={approval.form?.salesRepCodeSap}
                                                submitterName={approval.form?.requester?.name}
                                                submittedAt={approval.form?.submittedAt}
                                            />
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{approval.form?.totalAmount?.toLocaleString() || '0'}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Return type</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={returnTypeLabel(approval.form?.returnType)}>{returnTypeLabel(approval.form?.returnType)}</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Products</div>
                                                <div className="text-xs font-bold text-gray-900">{approval.form?.products?.length || 0} items</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2 min-w-0">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(approval.form)}>{endUserLabel(approval.form)}</div>
                                            </div>
                                        </div>
                                        ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Requester</div>
                                                {/* A return names its requester on the form (a manager may raise one for a rep, and a
                                                    reviewer may correct it); the account that submitted it is not that person. */}
                                                <div className="text-xs font-bold text-gray-900">
                                                    {(approval.form?.formType === 'RETURN' && approval.form?.requesterName) ||
                                                        approval.form?.requester?.name ||
                                                        'Unknown'}
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Type</div>
                                                <div className="text-xs font-bold text-gray-900">{approval.form?.formType || 'N/A'}</div>
                                            </div>
                                            <div className="bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 rounded-lg p-2 border border-[#00A651]/20">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Total Amount</div>
                                                <div className="text-xs font-bold text-[#00A651]">¥{approval.form?.totalAmount?.toLocaleString() || '0'}</div>
                                            </div>
                                            {/* A return has no delivery date; show what it does have. */}
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                                                    {isReturnRequest(approval.form) ? 'Return type' : 'Delivery Date'}
                                                </div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={isReturnRequest(approval.form) ? returnTypeLabel(approval.form?.returnType) : undefined}>
                                                    {isReturnRequest(approval.form)
                                                        ? returnTypeLabel(approval.form?.returnType)
                                                        : approval.form?.expectedDeliveryDate === 'ASAP'
                                                          ? 'ASAP'
                                                          : approval.form?.expectedDeliveryDate
                                                            ? new Date(approval.form.expectedDeliveryDate).toLocaleDateString()
                                                            : '—'}
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Products</div>
                                                <div className="text-xs font-bold text-gray-900">{approval.form?.products?.length || 0} items</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">End User</div>
                                                <div className="text-xs font-bold text-gray-900 truncate" title={endUserLabel(approval.form)}>{endUserLabel(approval.form)}</div>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        aria-expanded={!!expanded[approval.id]}
                                        aria-label={expanded[approval.id] ? 'Collapse details' : 'Expand details'}
                                        className="ml-0 flex shrink-0 items-center self-start rounded-full p-1 text-[#00A651] hover:bg-[#00A651]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00A651]"
                                        onClick={() =>
                                            setExpanded((prev) => ({ ...prev, [approval.id]: !prev[approval.id] }))
                                        }
                                    >
                                        <div
                                            className={`flex h-8 w-8 items-center justify-center rounded-full bg-[#00A651]/10 transition-transform ${expanded[approval.id] ? 'rotate-90' : ''}`}
                                        >
                                            <span className="text-base font-bold">▶</span>
                                        </div>
                                    </button>
                                </div>

                                {expanded[approval.id] && (
                                    <div className="border-t border-gray-200 bg-gray-50">
                                        {/* Print View (hidden, for printing) */}
                                        {approval.form && (
                                            <div className="hidden">
                                                <FormPrintView
                                                    form={approval.form}
                                                    approval={approval}
                                                    id={`print-form-${approval.id}`}
                                                />
                                            </div>
                                        )}
                                        
                                        <div className="p-4 space-y-4">
                                            {/* Print Button */}
                                            {approval.form && (
                                                <div className="flex justify-end no-print">
                                                    <PrintButton
                                                        targetId={`print-form-${approval.id}`}
                                                        label="Print Form"
                                                        variant="outline"
                                                    />
                                                </div>
                                            )}
                                            
                                            {approval.form && (
                                                <>
                                                    <PartnerAndDeliverySection form={approval.form} accent={accentBar} />
                                                    <RequesterCommentsSection form={approval.form} accent={accentBar} />
                                                </>
                                            )}
                                            {approval.form?.formType === 'ZNCCLAIM' && approval.form?.id && (
                                                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                                    <FormAttachmentsGallery
                                                        formId={approval.form.id}
                                                        formType="ZNCCLAIM"
                                                    />
                                                </div>
                                            )}

                                            <ProductLinesSection form={approval.form} accent={accentBar} />

                                            {/*
                                              After the products, exactly where the mail puts it. It
                                              read as part of the request when it sat above them -
                                              *"should appear last - just like in email"*.
                                            */}
                                            {approval.form && (
                                                    <ReviewEditTrailSection
                                                        reviewEdits={approval.form.reviewEdits}
                                                        accent={accentBar}
                                                        // Only the review queue may discard, and only for a request still at its
                                                        // step - the server checks the same window before it does anything.
                                                        onDiscardAll={
                                                            onlyReviewSteps && approval.formId
                                                                ? () => void handleDiscardCorrections(approval.formId!)
                                                                : undefined
                                                        }
                                                        discarding={discardingFormId === approval.formId}
                                                    />
                                            )}
                                            {/* A resubmitted return: what it was rejected for last time, and by whom. */}
                                            {approval.form && (
                                                <SubmissionHistorySection history={approval.form.approvalHistory} accent={accentBar} />
                                            )}

                                            {/* Why the send button is disabled, and what to do about it. */}
                                            {onlyReviewSteps && blockedFields(approval).length > 0 && (
                                                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900">
                                                    <div className="font-semibold">{t('return.review.mustCompleteBeforeApproval')}</div>
                                                    <div className="mt-1 text-xs">
                                                        {t('return.review.blockedFields')}: {blockedFields(approval).join(', ')}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Raise the same request again, from here. Any request, at any stage. */}
                                            <div className="flex justify-end">
                                                <CloneRequestButton
                                                    formId={approval.formId}
                                                    variant="inline"
                                                    onError={setError}
                                                />
                                            </div>

                                            {/* What the earlier steps wrote when approving. A reviewer's note on what they
                                                corrected used to be stored and then shown to nobody. */}
                                            {Array.isArray(approval.priorComments) && approval.priorComments.length > 0 && (
                                                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <div className={`w-1 h-4 rounded-full bg-gradient-to-b ${accentBar}`}></div>
                                                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                                                            {t('approvals.inbox.priorComments')}
                                                        </h4>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {approval.priorComments.map((c) => (
                                                            <div key={`${c.level}-${c.approverName}`} className="text-sm">
                                                                <div className="text-xs text-gray-500">
                                                                    {c.role} · {c.approverName}
                                                                    {c.decidedAt ? ` · ${new Date(c.decidedAt).toLocaleString()}` : ''}
                                                                </div>
                                                                <p className="text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 mt-1">{c.comments}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {approval.status === 'REJECTED' && (
                                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                                                    <p className="text-sm text-amber-950">{t('approvals.inbox.reopenHint')}</p>
                                                    <p className="text-sm text-amber-950">{t('approvals.inbox.deleteHint')}</p>
                                                    {approval.comments && (
                                                        <p className="text-xs text-gray-700 whitespace-pre-wrap bg-white/80 rounded p-2 border border-amber-100">
                                                            <span className="font-semibold">Previous rejection comments:</span>
                                                            <br />
                                                            {approval.comments}
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {approval.status === 'IN_PROGRESS' && (
                                                <>
                                            <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <div className={`w-1 h-4 rounded-full bg-gradient-to-b ${accentBar}`}></div>
                                                    <label className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                                    {t('approvals.inbox.comments')}
                                </label>
                                                </div>
                                <textarea
                                    value={comments[approval.id] || ''}
                                    onChange={(e) => setComments(prev => ({ ...prev, [approval.id]: e.target.value }))}
                                                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:border-[#00A651] transition-all bg-gray-50 hover:bg-white text-sm"
                                    rows={3}
                                    placeholder={t('approvals.inbox.commentsPlaceholder')}
                                />
                            </div>

                            <div className="flex gap-3">
                                {/*
                                  Correcting a request is only offered on the service review step,
                                  and only while it is that step's turn — after it, editing is
                                  refused by the server anyway. Before this existed a reviewer who
                                  spotted a wrong price had to reject the whole request and ask the
                                  requester to raise it again.
                                */}
                                {isReturnReviewerRole(approval.role) && approval.formId && (
                                    <Link
                                        to={`/return/edit/${approval.formId}`}
                                        className="px-5 py-3 rounded-lg text-white font-bold shadow-md hover:shadow-lg transition-all text-sm flex items-center"
                                        style={{ backgroundImage: 'linear-gradient(to right, #9333EA, #6B21A8)' }}
                                    >
                                        {t('return.review.correct')}
                                    </Link>
                                )}
                                <button
                                                    onClick={() => handleApprove(approval.id, approval.formId, approval.level, approval.form?.referenceNumber)}
                                                    disabled={processing?.id === approval.id || blockedFields(approval).length > 0}
                                                    className="flex-1 px-6 py-3 bg-gradient-to-r from-[#00A651] to-[#008a42] text-white rounded-lg hover:from-[#008a42] hover:to-[#007a35] disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 text-sm"
                                >
                                                    {processing?.id === approval.id && processing?.type === 'approve' ? (
                                                        <span className="flex items-center justify-center gap-2">
                                                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                                                            Processing...
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center justify-center gap-2">
                                                            ✓{' '}
                                                            {onlyReviewSteps
                                                                ? t('return.review.sendForApproval')
                                                                : approveActionButtonLabel(
                                                                      user?.id,
                                                                      user?.role,
                                                                      approval,
                                                                      t('approvals.inbox.approve'),
                                                                      user?.isSuperApprover
                                                                  )}
                                                        </span>
                                                    )}
                                </button>
                                <button
                                    onClick={() => handleReject(approval.id)}
                                                    disabled={processing?.id === approval.id}
                                                    className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 text-sm"
                                >
                                                    {processing?.id === approval.id && processing?.type === 'reject' ? (
                                                        <span className="flex items-center justify-center gap-2">
                                                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                                                            Processing...
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center justify-center gap-2">
                                                            ✗ {onlyReviewSteps ? t('return.review.discard') : t('approvals.inbox.reject')}
                                                        </span>
                                                    )}
                                </button>
                            </div>
                                                </>
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
