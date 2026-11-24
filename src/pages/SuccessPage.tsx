import { useFormCtx } from '../providers/FormContext'
import { Link, useLocation } from 'react-router-dom'
import PrintButton from '../components/PrintButton'
import PrintLayout from '../components/PrintLayout'
import { deliveryModeDisplayLabel } from '../utils/deliveryMode'
import { formatShipToDisplayCode, formatShipToDisplayName } from '../utils/shipToDisplay'
import { BilingualFieldCaption } from '../components/BilingualFieldCaption'
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util'
import ProductCodeLine from '../components/ProductCodeLine'

// ZINT (QC Test) fixed partner/delivery values – same as Wizard Step 2
const ZINT_SOLD_TO_CODE = '5002909'
const ZINT_SOLD_TO_NAME = 'ACME QUALITY ASSUARANCE'
const ZINT_END_USER_MSG = 'No end-user exist for internal orders.'

export default function SuccessPage() {
    const { form } = useFormCtx()
    const location = useLocation()
    const { referenceNumber, formType, requester } = location.state || {}
    const isZintPurpose = form.purpose === 'ZINT' || formType === 'ZINT'

    // Calculate total amount
    const totalAmount = form.products.reduce((sum, p) => {
        const price = p.wholesalePrice ?? p.unitPrice
        return sum + (price * p.quantity)
    }, 0)

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <PrintLayout
                    title="Form Submission Confirmation"
                    referenceNumber={referenceNumber}
                    status="SUBMITTED"
                >
                    <div id="print-content" className="bg-white rounded-2xl shadow-xl overflow-hidden">
                        {/* When printing this fragment only (Print button), show header line — parent PrintLayout is outside #print-content */}
                        <div className="hidden print:!block border-b border-black pb-1 mb-2 text-[9pt] leading-tight">
                            <span className="font-semibold">Acme — Form submission</span>
                            {referenceNumber && (
                                <span className="font-mono"> | Ref: {referenceNumber}</span>
                            )}
                            <span> | Status: SUBMITTED</span>
                        </div>

                        {/* Success Header */}
                        <div className="bg-[#00A651] p-8 text-center text-white print:bg-white print:text-black print:p-3 print-success-strip">
                            <div className="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg print:bg-transparent print:shadow-none no-print">
                                <svg className="w-10 h-10 text-[#00A651] print:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h1 className="text-3xl font-bold mb-2 print:text-base print:mb-0">Application Submitted Successfully!</h1>
                            <p className="text-green-100 text-lg print:text-black print:text-xs print:mb-1">Your request has been processed and sent for approval.</p>

                            {/* Reference Number Display */}
                            {referenceNumber && (
                                <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30 print:bg-transparent print:border print:border-black print:p-2 print:mt-2">
                                    <p className="text-green-100 text-sm font-medium mb-2 print:text-black print:text-xs print:mb-0">Your Reference Number</p>
                                    <p className="text-4xl font-bold tracking-wider font-mono print:text-xl">{referenceNumber}</p>
                                    <p className="text-green-100 text-xs mt-2 print:text-black print:text-[9px] print:mt-1">Please save this number for tracking your request</p>
                                </div>
                            )}
                        </div>

                        {/* Print Button */}
                        <div className="p-4 border-b border-gray-200 flex justify-end no-print">
                            <PrintButton targetId="print-content" label="Print Confirmation" variant="primary" />
                        </div>

                        {/* Summary Content */}
                        <div className="p-8 space-y-8 print:p-3 print:space-y-3">
                            {/* Key Details Grid */}
                            <div className="grid md:grid-cols-2 gap-8 print:gap-3 print-section print-cols-2">
                                <div className="space-y-4 print:space-y-1 print-section">
                                    <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 print-section-title print:text-[10pt] print:pb-1">Requester Information</h3>
                                    <div className="grid grid-cols-2 gap-y-2 text-sm print:gap-y-0.5 print:text-[9pt]">
                                        <span className="text-gray-500">Name:</span>
                                        <span className="font-medium text-gray-900">
                                            {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                                        </span>
                                        <span className="text-gray-500">Request Date:</span>
                                        <span className="font-medium text-gray-900">{form.requestDate}</span>
                                        <span className="text-gray-500">Business Unit:</span>
                                        <span className="font-medium text-gray-900">{form.businessUnit}</span>
                                        <span className="text-gray-500">Purpose:</span>
                                        <span className="font-medium text-gray-900">{form.purpose}</span>
                                    </div>
                                </div>

                                <div className="space-y-4 print:space-y-1 print-section">
                                    <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 print-section-title print:text-[10pt] print:pb-1">Partner Details</h3>
                                    <div className="space-y-3 text-sm print:space-y-1 print:text-[9pt]">
                                        <div>
                                            <span className="block text-gray-500 text-xs uppercase tracking-wide">Sold-To</span>
                                            {isZintPurpose ? (
                                                <span className="block text-xl font-bold text-gray-900 mt-1">
                                                    {ZINT_SOLD_TO_CODE} - {ZINT_SOLD_TO_NAME}
                                                </span>
                                            ) : (
                                                <>
                                                    <span className="font-medium text-gray-900">{form.soldToName || '-'}</span>
                                                    {form.soldToCode && <><span className="text-gray-400 mx-2">|</span><span className="text-gray-600">{form.soldToCode}</span></>}
                                                </>
                                            )}
                                        </div>
                                        <div>
                                            <span className="block text-gray-500 text-xs uppercase tracking-wide">End User</span>
                                            {isZintPurpose ? (
                                                <span className="font-medium text-gray-900">{ZINT_END_USER_MSG}</span>
                                            ) : (
                                                <>
                                                    <span className="font-medium text-gray-900">{form.endUserName || '-'}</span>
                                                    {form.endUserCode && <><span className="text-gray-400 mx-2">|</span><span className="text-gray-600">{form.endUserCode}</span></>}
                                                </>
                                            )}
                                        </div>
                                        <div>
                                            <span className="block text-gray-500 text-xs uppercase tracking-wide">Ship-To</span>
                                            {isZintPurpose ? (
                                                <span className="font-bold text-gray-900">Ship-To: {formatShipToDisplayName(form.shipToName, form.shipToCode)}</span>
                                            ) : (
                                                <>
                                                    <span className="font-medium text-gray-900">{formatShipToDisplayName(form.shipToName, form.shipToCode)}</span>
                                                    {formatShipToDisplayCode(form.shipToCode) && (
                                                        <><span className="text-gray-400 mx-2">|</span><span className="text-gray-600">{formatShipToDisplayCode(form.shipToCode)}</span></>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        {form.attentionTo && (
                                            <div>
                                                <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="mb-0.5" />
                                                <span className="font-medium text-gray-900">{form.attentionTo}</span>
                                            </div>
                                        )}
                                        <div>
                                            <span className="block text-gray-500 text-xs uppercase tracking-wide">Delivery</span>
                                            <span className="font-medium text-gray-900">{deliveryModeDisplayLabel(form.deliveryMode, {
                                                shipToCode: form.shipToCode,
                                                formType: form.formType ?? form.purpose,
                                              }) || '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Products Table */}
                            <div className="print-section">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 print-section-title print:mb-2 print:text-[10pt]">Product Summary</h3>
                                <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden print:bg-white">
                                    <table className="w-full text-sm text-left print-table-dense">
                                        <thead className="bg-gray-100 text-gray-600 font-medium border-b border-gray-200">
                                            <tr>
                                                <th className="px-4 py-3 print:px-2 print:py-1">Product Name</th>
                                                <th className="px-4 py-3 print:px-2 print:py-1">Batch / lot</th>
                                                <th className="px-4 py-3 text-right print:px-2 print:py-1">Qty</th>
                                                <th className="px-4 py-3 text-right print:px-2 print:py-1">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {form.products.map((p, i) => (
                                                <tr key={i}>
                                                    <td className="px-4 py-3 font-medium text-gray-900 print:px-2 print:py-1">
                                                        {p.productName}
                                                        <ProductCodeLine product={p} unit={form?.businessUnit} className="text-xs font-normal text-gray-500" />
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 print:px-2 print:py-1">{p.lotNumber?.trim() || '—'}</td>
                                                    <td className="px-4 py-3 text-right text-gray-900 print:px-2 print:py-1">{p.quantity}</td>
                                                    <td className="px-4 py-3 text-right font-semibold text-gray-900 print:px-2 print:py-1">
                                                        ¥{((p.wholesalePrice ?? p.unitPrice) * p.quantity).toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-gray-100 font-bold text-gray-900">
                                            <tr>
                                                {/* Product Name, Batch / lot, Qty - then the Total column. */}
                                                <td colSpan={3} className="px-4 py-3 text-right print:px-2 print:py-1">Grand Total</td>
                                                <td className="px-4 py-3 text-right text-[#00A651] print:px-2 print:py-1">¥{totalAmount.toLocaleString()}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-center pt-6 border-t border-gray-100 no-print">
                                <Link
                                    to="/"
                                    className="px-8 py-3 bg-[#00A651] text-white rounded-lg font-semibold shadow-md hover:bg-[#008A44] hover:shadow-lg transition-all transform hover:-translate-y-0.5"
                                    onClick={() => {
                                        // Optional: Clear form context here if needed, but usually done on new form start
                                    }}
                                >
                                    Back to Home
                                </Link>
                            </div>
                        </div>
                    </div>
                </PrintLayout>
            </div>
        </div>
    )
}
