/**
 * Token-based approval page (no login required)
 * Accessed via email links with approval tokens
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import apiClient, { type ReviewEditRecord } from '../services/api.service';
import { ReviewEditTrailSection, SubmissionHistorySection } from '../components/RequestDetailSections';
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util';
import { BilingualFieldCaption } from '../components/BilingualFieldCaption';
import FormAttachmentsGallery from '../components/FormAttachmentsGallery';
import type { FormAttachmentMeta } from '../utils/form-attachments.util';
import { formatProductCodes } from '../utils/productCodes'
import { formatQuantity } from '../utils/numericInput'
import { formatUnitYen, lineShowsUnitPrices, returnLineUnitPrice } from '../utils/returnLinePrices'

/** Backend AppError uses `error`; some routes use `message`. */
function apiErrorMessage(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
    const d = e?.response?.data;
    return d?.error || d?.message || e?.message || fallback;
}

interface ApprovalData {
    approval: {
        id: string;
        formId: string;
        approverName: string;
        approverEmail: string;
        level: number;
        role: string;
        status: string;
        form: {
            id: string;
            referenceNumber?: string;
            formType: string;
            requesterName: string;
            salesRepCodeSap?: string;
            // CDG or LSG. Spread from the form row like the rest; declared so the codes can obey
            // the rule that LSG has no SAP number.
            businessUnit?: string | null;
            totalAmount: number;
            requestDate: string;
            commentsForApproval?: string;
            freeDescription?: string;
            products: Array<{
                productCode: string;
                // Present in the payload all along — the controller spreads the whole form row — but
                // never declared here, so the page could only ever show one of the two codes.
                sapCode?: string | null;
                productName: string;
                /** The requester's batch / lot, when they gave one. In the payload all along, never shown. */
                lotNumber?: string | null;
                quantity: number;
                unitPrice: number;
                subtotal: number;
                wholesalePrice?: number;
                /** Return only: what is credited and re-billed on this line. */
                returnAmount?: number | null;
                rebillAmount?: number | null;
            }>;
            requester: {
                name: string;
                email: string;
            } | null;
            attachments?: FormAttachmentMeta[];
            /** What the service review team corrected before this approver was asked. Returns only. */
            reviewEdits?: ReviewEditRecord[];
        };
    };
}

type ReturnLine = ApprovalData['approval']['form']['products'][number];

/**
 * The requester's batch / lot under the product's codes. Always shown, "—" when none was given, as
 * the emails do: hidden when blank, a request without a lot looked as if the screen lacked the field.
 */
function LotLine({ lotNumber }: { lotNumber?: string | null }) {
    const lot = String(lotNumber ?? '').trim();
    return <div className="text-sm text-gray-500">Batch / lot: {lot || '—'}</div>;
}

/**
 * A return's lines as the approver is asked to sign them: what is credited and re-billed.
 *
 * This page showed the catalogue unit price and subtotal for every form type, so an approver who
 * followed the mail link saw ¥30,000 on a line crediting ¥9,000 - never the credit itself. Same
 * columns as the mails (Damian Diggin, 30 Sep 2026): unit prices only where the quantity is a whole
 * number of 2 or more, and none at all when no line has one.
 */
function ReturnLinesTable({ products, businessUnit }: { products: ReturnLine[]; businessUnit?: string | null }) {
    const unitCols = products.some((p) => lineShowsUnitPrices(p.quantity));
    const yen = (n: number | null | undefined) => (n == null ? '—' : `¥${Number(n).toLocaleString('ja-JP')}`);
    const unit = (p: ReturnLine, total: number | null | undefined) =>
        lineShowsUnitPrices(p.quantity) && total != null
            ? formatUnitYen(returnLineUnitPrice(Number(total), p.quantity, p.wholesalePrice ?? p.unitPrice))
            : '—';
    const returnTotal = products.reduce((sum, p) => sum + Number(p.returnAmount ?? 0), 0);
    const rebillTotal = products.reduce((sum, p) => sum + Number(p.rebillAmount ?? 0), 0);
    const th = 'px-4 py-2 text-right text-sm font-medium text-gray-700';
    return (
        <table className="w-full">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Product</th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">Qty</th>
                    {unitCols && <th className={th}>Return unit price</th>}
                    {unitCols && <th className={th}>Re-bill unit price</th>}
                    <th className={th}>Total returns</th>
                    <th className={th}>Total re-bills</th>
                </tr>
            </thead>
            <tbody>
                {products.map((product, idx) => (
                    <tr key={idx} className="border-t">
                        <td className="px-4 py-2">
                            <div className="font-medium">{product.productName}</div>
                            <div className="text-sm text-gray-500">{formatProductCodes(product, '—', businessUnit)}</div>
                            <LotLine lotNumber={product.lotNumber} />
                        </td>
                        <td className="px-4 py-2 text-center">{formatQuantity(product.quantity)}</td>
                        {unitCols && <td className="px-4 py-2 text-right">{unit(product, product.returnAmount)}</td>}
                        {unitCols && <td className="px-4 py-2 text-right">{unit(product, product.rebillAmount)}</td>}
                        <td className="px-4 py-2 text-right font-semibold">{yen(product.returnAmount)}</td>
                        <td className="px-4 py-2 text-right font-semibold">{yen(product.rebillAmount)}</td>
                    </tr>
                ))}
                <tr className="border-t bg-gray-50">
                    <td colSpan={unitCols ? 4 : 2} className="px-4 py-2 text-right font-semibold">
                        Total
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{yen(returnTotal)}</td>
                    <td className="px-4 py-2 text-right font-bold">{yen(rebillTotal)}</td>
                </tr>
            </tbody>
        </table>
    );
}

export default function TokenApproval() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const token = searchParams.get('token');
    
    // Determine action from URL path
    const isView = location.pathname.includes('/approval/view');
    const isApprove = !isView && location.pathname.includes('/approval/approve');
    const isReject = location.pathname.includes('/approval/reject');
    const action = isView ? 'view' : isApprove ? 'approve' : isReject ? 'reject' : 'view';
    const viewAttachmentsOnly = isView || location.hash === '#attachments';

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [approvalData, setApprovalData] = useState<ApprovalData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [comments, setComments] = useState('');
    const [success, setSuccess] = useState(false);
    
    // Refs to prevent race conditions and handle cleanup
    const isMountedRef = useRef(true);
    const hasProcessedRef = useRef(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Cleanup function
        return () => {
            isMountedRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        // Reset mounted ref on mount
        isMountedRef.current = true;
        hasProcessedRef.current = false;
        
        if (!token) {
            if (isMountedRef.current) {
                setError('Approval token is missing');
                setLoading(false);
            }
            return;
        }

        // Prevent duplicate processing
        if (hasProcessedRef.current) {
            return;
        }

        // Fetch approval data
        const fetchApproval = async () => {
            try {
                const response = await apiClient.get<ApprovalData>(`/public/approvals/token?token=${encodeURIComponent(token)}`);
                
                if (!isMountedRef.current) return;
                
                setApprovalData(response.data);
                setError(null);
                
                // Auto-approve only from explicit Approve email button — never from view/attachments links.
                if (isApprove && !viewAttachmentsOnly && response.data && !hasProcessedRef.current) {
                    const st = response.data.approval.status;
                    if (st === 'APPROVED' || st === 'REJECTED') {
                        if (isMountedRef.current) {
                            setError('This approval has already been processed');
                            setLoading(false);
                        }
                        return;
                    }
                    if (st === 'PENDING') {
                        if (isMountedRef.current) {
                            setError(
                                'This approval step is not active yet. Earlier approvers must complete their steps first. You will be notified when it is your turn.'
                            );
                            setLoading(false);
                        }
                        return;
                    }
                    if (st !== 'IN_PROGRESS') {
                        if (isMountedRef.current) {
                            setError(`This approval cannot be submitted (status: ${st}).`);
                            setLoading(false);
                        }
                        return;
                    }

                    hasProcessedRef.current = true;
                    setSubmitting(true);
                    try {
                        await apiClient.post(`/public/approvals/approve?token=${encodeURIComponent(token)}`, { comments: '' });
                        
                        if (!isMountedRef.current) return;
                        
                        setSubmitting(false);
                        setLoading(false);
                        setSuccess(true);
                        
                        // Set up navigation timeout
                        timeoutRef.current = setTimeout(() => {
                            if (isMountedRef.current) {
                                navigate('/');
                            }
                        }, 8000);
                    } catch (err: unknown) {
                        console.error('Error approving:', err);
                        if (isMountedRef.current) {
                            setError(apiErrorMessage(err, 'Failed to approve form'));
                            setSubmitting(false);
                            setLoading(false);
                            hasProcessedRef.current = false; // Allow retry
                        }
                    }
                } else {
                    if (isMountedRef.current) {
                        setLoading(false);
                    }
                }
            } catch (err: unknown) {
                console.error('Error fetching approval:', err);
                if (isMountedRef.current) {
                    setError(apiErrorMessage(err, 'Failed to load approval details'));
                    setLoading(false);
                }
            }
        };

        fetchApproval();
    }, [token, isApprove, viewAttachmentsOnly, navigate]);

    useEffect(() => {
        if (!approvalData || location.hash !== '#attachments') return;
        const el = document.getElementById('attachments');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [approvalData, location.hash]);

    const handleApprove = async () => {
        if (!token || submitting || hasProcessedRef.current) return;
        if (approvalData && approvalData.approval.status !== 'IN_PROGRESS') {
            setError(
                approvalData.approval.status === 'PENDING'
                    ? 'This approval step is not active yet. Earlier approvers must complete their steps first.'
                    : 'This approval cannot be submitted right now.'
            );
            return;
        }

        setError(null); // Clear any previous errors
        setSubmitting(true);
        hasProcessedRef.current = true;
        
        try {
            await apiClient.post(`/public/approvals/approve?token=${encodeURIComponent(token)}`, { comments });
            
            if (!isMountedRef.current) return;
            
            setSuccess(true);
            timeoutRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                    navigate('/');
                }
            }, 8000);
        } catch (err: unknown) {
            console.error('Error approving:', err);
            if (isMountedRef.current) {
                setError(apiErrorMessage(err, 'Failed to approve form'));
                hasProcessedRef.current = false; // Allow retry
            }
        } finally {
            if (isMountedRef.current) {
                setSubmitting(false);
            }
        }
    };

    const handleReject = async () => {
        if (!token || submitting || hasProcessedRef.current) return;
        if (approvalData && approvalData.approval.status !== 'IN_PROGRESS') {
            setError(
                approvalData.approval.status === 'PENDING'
                    ? 'This approval step is not active yet. Earlier approvers must complete their steps first.'
                    : 'This approval cannot be submitted right now.'
            );
            return;
        }

        if (!comments.trim()) {
            setError('Comments are required when rejecting a form');
            return;
        }

        setError(null); // Clear any previous errors
        setSubmitting(true);
        hasProcessedRef.current = true;
        
        try {
            await apiClient.post(`/public/approvals/reject?token=${encodeURIComponent(token)}`, { comments });
            
            if (!isMountedRef.current) return;
            
            setSuccess(true);
            timeoutRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                    navigate('/');
                }
            }, 5000);
        } catch (err: unknown) {
            console.error('Error rejecting:', err);
            if (isMountedRef.current) {
                setError(apiErrorMessage(err, 'Failed to reject form'));
                hasProcessedRef.current = false; // Allow retry
            }
        } finally {
            if (isMountedRef.current) {
                setSubmitting(false);
            }
        }
    };

    // Show success page first if success
    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 py-8">
                <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
                    <div className="text-center mb-6">
                        <div className="text-green-500 text-6xl mb-4">✅</div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            {isApprove ? 'Form Approved Successfully!' : 'Form Rejected'}
                        </h1>
                        <p className="text-gray-600 mb-6">
                            Your decision has been recorded and the requester has been notified.
                        </p>
                    </div>
                    
                    {approvalData && (
                        <div className="bg-gray-50 rounded-lg p-6 mb-6">
                            <h2 className="text-lg font-semibold mb-4">Form Summary</h2>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-600">Reference Number:</span>
                                    <p className="font-semibold text-[#00A651]">
                                        {approvalData.approval.form.referenceNumber || 'Pending'}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-gray-600">Form Type:</span>
                                    <p className="font-semibold">{approvalData.approval.form.formType}</p>
                                </div>
                                <div>
                                    <span className="text-gray-600">Requester:</span>
                                    <p className="font-semibold">
                                        {formatRequesterWithSalesRepCode(
                                            approvalData.approval.form.requesterName,
                                            approvalData.approval.form.salesRepCodeSap
                                        )}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-gray-600">Total Amount:</span>
                                    <p className="font-semibold text-[#00A651]">
                                        ¥{approvalData.approval.form.totalAmount.toLocaleString('ja-JP')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="text-center">
                        <p className="text-gray-500 text-sm mb-4">
                            Redirecting to home page in a few seconds...
                        </p>
                        <button
                            onClick={() => navigate('/')}
                            className="px-6 py-2 bg-[#00A651] text-white rounded-lg hover:bg-[#008a43] transition-colors"
                        >
                            Return to Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (loading || (isApprove && submitting)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#00A651]"></div>
                    <p className="mt-4 text-gray-600">
                        {isApprove ? 'Processing approval...' : 'Loading approval details...'}
                    </p>
                </div>
            </div>
        );
    }

    if (error && !approvalData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
                    <div className="text-red-500 text-5xl mb-4">⚠️</div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Error</h1>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <button
                        onClick={() => navigate('/')}
                        className="px-4 py-2 bg-[#00A651] text-white rounded hover:bg-[#008a43] transition-colors"
                    >
                        Go to Home
                    </button>
                </div>
            </div>
        );
    }

    if (!approvalData) return null;

    const { approval } = approvalData;
    const form = approval.form as typeof approval.form & { commentsForApproval?: string; freeDescription?: string };

    // For reject action, show minimal form
    if (isReject) {
        return (
            <div className="min-h-screen bg-gray-50 py-8">
                <div className="max-w-2xl mx-auto px-4">
                    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                        {/* Header */}
                        <div className="bg-red-600 text-white p-6">
                            <h1 className="text-2xl font-bold mb-2">Reject Approval Request</h1>
                            <p className="text-red-100">
                                Level {approval.level} - {approval.role}
                            </p>
                        </div>

                        {/* Form Summary */}
                        <div className="p-6 space-y-6">
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h2 className="font-semibold mb-3">Form Details</h2>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="text-gray-600">Reference Number:</span>
                                        <p className="font-semibold text-[#00A651]">
                                            {form.referenceNumber || 'Pending'}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Form Type:</span>
                                        <p className="font-semibold">{form.formType}</p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Requester:</span>
                                        <p className="font-semibold">
                                            {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Total Amount:</span>
                                        <p className="font-semibold text-[#00A651]">
                                            ¥{form.totalAmount.toLocaleString('ja-JP')}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {approval.status === 'PENDING' && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded text-sm">
                                    Your turn has not started yet. Rejection is only available when this step is active
                                    (after earlier approvers complete).
                                </div>
                            )}

                            {/* Comments (Required) */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Rejection Comments <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={comments}
                                    onChange={(e) => {
                                        setComments(e.target.value);
                                        setError(null); // Clear error when user types
                                    }}
                                    rows={5}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                    placeholder="Please provide a reason for rejection..."
                                    required
                                    disabled={submitting || approval.status !== 'IN_PROGRESS'}
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Comments are required when rejecting a form.
                                </p>
                            </div>

                            {/* Error Message */}
                            {error && (
                                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                                    {error}
                                </div>
                            )}

                            {/* Action Button */}
                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={handleReject}
                                    disabled={submitting || !comments.trim() || approval.status !== 'IN_PROGRESS'}
                                    className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submitting ? 'Processing...' : 'Confirm Rejection'}
                                </button>
                            </div>

                            <p className="text-sm text-gray-500 text-center mt-4">
                                You are rejecting as <strong>{approval.approverName}</strong> ({approval.role})
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // This should not be reached for approve (auto-processed) or reject (handled above)
    // But keeping as fallback
    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                    {/* Header */}
                    <div className="bg-[#00A651] text-white p-6">
                        <h1 className="text-2xl font-bold mb-2">
                            {isView ? 'View Approval Request' : 'Approval Request'}
                        </h1>
                        <p className="text-green-100">
                            Level {approval.level} - {approval.role}
                        </p>
                    </div>

                    {/* Form Details */}
                    <div className="p-6 space-y-6">
                        {/* Basic Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700">Reference Number</label>
                                <p className="text-lg font-semibold text-[#00A651]">
                                    {form.referenceNumber || 'Pending'}
                                </p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700">Form Type</label>
                                <p className="text-lg">{form.formType}</p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700">Requester</label>
                                <p className="text-lg">
                                    {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                                </p>
                                {form.requester && (
                                    <p className="text-sm text-gray-500">{form.requester.email}</p>
                                )}
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700">Request Date</label>
                                <p className="text-lg">
                                    {new Date(form.requestDate).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </p>
                            </div>
                            <div className="col-span-2">
                                <label className="text-sm font-medium text-gray-700">Total Amount</label>
                                <p className="text-2xl font-bold text-[#00A651]">
                                    ¥{form.totalAmount.toLocaleString('ja-JP')}
                                </p>
                            </div>
                        </div>

                        {/* Products */}
                        {form.products && form.products.length > 0 && (
                            <div>
                                <h3 className="text-lg font-semibold mb-3">Products</h3>
                                <div className="border rounded-lg overflow-hidden">
                                    {form.formType === 'RETURN' ? (
                                        <ReturnLinesTable products={form.products} businessUnit={form.businessUnit} />
                                    ) : (
                                    <table className="w-full">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Product</th>
                                                <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">Qty</th>
                                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Unit Price</th>
                                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {form.products.map((product, idx) => (
                                                <tr key={idx} className="border-t">
                                                    <td className="px-4 py-2">
                                                        <div className="font-medium">{product.productName}</div>
                                                        <div className="text-sm text-gray-500">{formatProductCodes(product, '—', form.businessUnit)}</div>
                                                        <LotLine lotNumber={product.lotNumber} />
                                                    </td>
                                                    <td className="px-4 py-2 text-center">{formatQuantity(product.quantity)}</td>
                                                    <td className="px-4 py-2 text-right">¥{product.unitPrice.toLocaleString('ja-JP')}</td>
                                                    <td className="px-4 py-2 text-right font-semibold">
                                                        ¥{product.subtotal.toLocaleString('ja-JP')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* An approver reached by the emailed link signs off the same figures as one in the
                            inbox, so they see what the review team changed before them too. */}
                        <ReviewEditTrailSection reviewEdits={form.reviewEdits} />
                        <SubmissionHistorySection history={(form as { approvalHistory?: any[] }).approvalHistory} />

                        {/* Requester's comments (visible at all approval levels) */}
                        {(form.commentsForApproval || form.freeDescription) && (
                            <div className="bg-[#00A651]/5 border border-[#00A651]/20 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-800 mb-2">Requester&apos;s comments</h3>
                                {form.commentsForApproval && (
                                    <div className="mb-2">
                                        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">Comments for approval</p>
                                        <p className="text-sm text-gray-900 whitespace-pre-wrap">{form.commentsForApproval}</p>
                                    </div>
                                )}
                                {form.freeDescription && (
                                    <div>
                                        <div className="mb-1">
                                            <BilingualFieldCaption labelKey="wizard.bilingual.freeSample" compact />
                                        </div>
                                        <p className="text-sm text-gray-900 whitespace-pre-wrap">{form.freeDescription}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {form.formType === 'ZNCCLAIM' && form.id && token && (
                            <div id="attachments" className="scroll-mt-4">
                                <FormAttachmentsGallery
                                    formId={form.id}
                                    formType="ZNCCLAIM"
                                    approvalToken={token}
                                    initialAttachments={form.attachments}
                                />
                            </div>
                        )}

                        {approval.status === 'PENDING' && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded text-sm">
                                Your turn has not started yet. This request is still with an earlier approver. Approve and
                                reject are disabled until this step becomes active (you will typically get another email).
                            </div>
                        )}

                        {/* Comments + actions — hidden on read-only view (e.g. supporting documents link) */}
                        {!isView && (
                          <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Your comments {action === 'reject' && <span className="text-red-500">*</span>}
                            </label>
                            <textarea
                                value={comments}
                                onChange={(e) => setComments(e.target.value)}
                                rows={4}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#00A651] focus:border-transparent"
                                placeholder={action === 'reject' ? 'Please provide a reason for rejection...' : 'Optional comments...'}
                                disabled={approval.status !== 'IN_PROGRESS'}
                            />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                                {error}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-4 pt-4">
                            <button
                                onClick={handleApprove}
                                disabled={submitting || approval.status !== 'IN_PROGRESS'}
                                className="flex-1 bg-[#00A651] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#008a43] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'Processing...' : '✓ Approve'}
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={submitting || approval.status !== 'IN_PROGRESS'}
                                className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'Processing...' : '✗ Reject'}
                            </button>
                        </div>

                        <p className="text-sm text-gray-500 text-center mt-4">
                            You are approving as <strong>{approval.approverName}</strong> ({approval.role})
                        </p>
                          </>
                        )}

                        {isView && error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                                {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

