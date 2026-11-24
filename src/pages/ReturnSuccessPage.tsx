import { Link, useLocation } from 'react-router-dom'
import PrintButton from '../components/PrintButton'
import PrintLayout from '../components/PrintLayout'
import { useI18n } from '../providers/I18nContext'
import { useReturnFormCtx } from '../providers/ReturnFormContext'
import { RETURN_TYPE_OPTIONS } from '../constants/returnTypes'
import { RETURN_ORDER_REASON_OPTIONS } from '../constants/returnOrderReasons'
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util'
import ProductCodeLine from '../components/ProductCodeLine'
import { formatQuantity } from '../utils/numericInput'

/**
 * Confirmation after a return request is submitted.
 *
 * Deliberately the same page as the sample flow's SuccessPage — same shell, same green header, same
 * reference-number block, same print behaviour — so a requester who already uses the sample flow
 * recognises this instantly. What differs is the field set: a return is described by its SAP
 * document type, the order it reverses and the credit per line, none of which SuccessPage has a
 * place for, and it has no ship-to or delivery mode at all.
 *
 * The form is read from context, not from the navigation state: the wizard clears the *stored*
 * draft on submit, but the in-memory form is still there — the same thing SuccessPage relies on.
 */
export default function ReturnSuccessPage() {
  const { t } = useI18n()
  const { form } = useReturnFormCtx()
  const location = useLocation()
  const { referenceNumber } = (location.state || {}) as { referenceNumber?: string }

  const returnTypeLabel =
    RETURN_TYPE_OPTIONS.find((o) => o.value === form.returnType)?.label || form.returnType || '—'
  const orderReasonLabel =
    RETURN_ORDER_REASON_OPTIONS.find((o) => o.value === form.orderReason)?.label ||
    form.orderReason ||
    '—'

  const products = form.products ?? []
  // LSG materials have no SAP number, so the column goes rather than showing dashes.
  const totalReturn = products.reduce((sum, p) => sum + (p.returnAmount ?? 0), 0)
  const totalRebill = products.reduce((sum, p) => sum + (p.rebillAmount ?? 0), 0)

  const partnerLine = (name: string, code: string) => {
    if (!name && !code) return '—'
    return code ? `${name || '—'} | ${code}` : name || '—'
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <PrintLayout
          title="Return Request Confirmation"
          referenceNumber={referenceNumber}
          status="SUBMITTED"
        >
          <div id="print-content" className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="hidden print:!block border-b border-black pb-1 mb-2 text-[9pt] leading-tight">
              <span className="font-semibold">Acme — Return / credit request</span>
              {referenceNumber && <span className="font-mono"> | Ref: {referenceNumber}</span>}
              <span> | Status: SUBMITTED</span>
            </div>

            <div className="bg-[#00A651] p-8 text-center text-white print:bg-white print:text-black print:p-3 print-success-strip">
              <div className="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg print:bg-transparent print:shadow-none no-print">
                <svg
                  className="w-10 h-10 text-[#00A651] print:text-black"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold mb-2 print:text-base print:mb-0">
                {t('return.success.title')}
              </h1>
              <p className="text-green-100 text-lg print:text-black print:text-xs print:mb-1">
                {t('return.success.subtitle')}
              </p>

              {referenceNumber && (
                <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30 print:bg-transparent print:border print:border-black print:p-2 print:mt-2">
                  <p className="text-green-100 text-sm font-medium mb-2 print:text-black print:text-xs print:mb-0">
                    {t('return.success.reference')}
                  </p>
                  <p className="text-4xl font-bold tracking-wider font-mono print:text-xl">
                    {referenceNumber}
                  </p>
                  <p className="text-green-100 text-xs mt-2 print:text-black print:text-[9px] print:mt-1">
                    {t('return.success.referenceHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-b border-gray-200 flex justify-end no-print">
              <PrintButton targetId="print-content" label="Print Confirmation" variant="primary" />
            </div>

            <div className="p-8 space-y-8 print:p-3 print:space-y-3">
              <div className="grid md:grid-cols-2 gap-8 print:gap-3 print-section print-cols-2">
                <div className="space-y-4 print:space-y-1 print-section">
                  <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 print-section-title print:text-[10pt] print:pb-1">
                    {t('return.success.requestSection')}
                  </h3>
                  <div className="grid grid-cols-2 gap-y-2 text-sm print:gap-y-0.5 print:text-[9pt]">
                    <span className="text-gray-500">{t('return.summary.requester')}:</span>
                    <span className="font-medium text-gray-900">
                      {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap)}
                    </span>
                    <span className="text-gray-500">{t('return.summary.date')}:</span>
                    <span className="font-medium text-gray-900">{form.requestDate || '—'}</span>
                    <span className="text-gray-500">{t('return.summary.businessUnit')}:</span>
                    <span className="font-medium text-gray-900">{form.businessUnit || '—'}</span>
                    <span className="text-gray-500">{t('return.summary.type')}:</span>
                    <span className="font-medium text-gray-900">{returnTypeLabel}</span>
                    <span className="text-gray-500">{t('return.form.serviceRequest')}:</span>
                    <span className="font-medium text-gray-900">
                      {form.isService ? t('return.form.serviceYes') : t('return.form.serviceNo')}
                    </span>
                  </div>
                </div>

                <div className="space-y-4 print:space-y-1 print-section">
                  <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 print-section-title print:text-[10pt] print:pb-1">
                    {t('return.success.returnSection')}
                  </h3>
                  <div className="grid grid-cols-2 gap-y-2 text-sm print:gap-y-0.5 print:text-[9pt]">
                    <span className="text-gray-500">{t('return.summary.orderNumber')}:</span>
                    <span className="font-medium text-gray-900">
                      {form.originalOrderNumber || '—'}
                    </span>
                    <span className="text-gray-500">{t('return.summary.invoiceDate')}:</span>
                    <span className="font-medium text-gray-900">{form.invoiceDate || '—'}</span>
                    <span className="text-gray-500">{t('return.summary.quoteRef')}:</span>
                    <span className="font-medium text-gray-900">{form.quoteRefNo || '—'}</span>
                    <span className="text-gray-500">{t('return.summary.orderReason')}:</span>
                    <span className="font-medium text-gray-900">{orderReasonLabel}</span>
                    <span className="text-gray-500">{t('return.summary.soldTo')}:</span>
                    <span className="font-medium text-gray-900">
                      {partnerLine(form.soldToName, form.soldToCode)}
                    </span>
                    <span className="text-gray-500">{t('return.summary.endUser')}:</span>
                    <span className="font-medium text-gray-900">
                      {partnerLine(form.endUserName, form.endUserCode)}
                    </span>
                    <span className="text-gray-500">{t('return.summary.dairitenContact')}:</span>
                    <span className="font-medium text-gray-900">
                      {form.dairitenContactName || '—'}
                    </span>
                    <span className="text-gray-500">{t('return.summary.dairitenEmail')}:</span>
                    <span className="font-medium text-gray-900 break-all">
                      {form.dairitenContactEmail || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {form.justification?.trim() ? (
                <div className="print-section">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2 print-section-title print:mb-1 print:text-[10pt]">
                    {t('return.summary.justification')}
                  </h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap print:text-[9pt]">
                    {form.justification}
                  </p>
                </div>
              ) : null}

              <div className="print-section">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 print-section-title print:mb-2 print:text-[10pt]">
                  {t('return.summary.products')}
                </h3>
                {/* overflow-x-auto: five columns with yen amounts do not fit a phone, and the page
                    body must never scroll sideways. */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-x-auto print:bg-white">
                  <table className="w-full text-sm text-left print-table-dense">
                    <thead className="bg-gray-100 text-gray-600 font-medium border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 print:px-2 print:py-1">
                          {t('return.summary.products')}
                        </th>
                        {/* As on the sample confirmation; the lot the requester gave was never shown here. */}
                        <th className="px-4 py-3 print:px-2 print:py-1">Batch / lot</th>
                        <th className="px-4 py-3 text-right print:px-2 print:py-1">
                          {t('return.form.quantity')}
                        </th>
                        <th className="px-4 py-3 text-right print:px-2 print:py-1">
                          {t('return.form.returnAmount')}
                        </th>
                        <th className="px-4 py-3 text-right print:px-2 print:py-1">
                          {t('return.form.rebillAmount')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {products.map((p, i) => (
                        <tr key={p.id || i}>
                          <td className="px-4 py-3 font-medium text-gray-900 print:px-2 print:py-1">
                            {p.productName}
                            <ProductCodeLine product={p} unit={form.businessUnit} className="text-xs font-normal text-gray-500" />
                          </td>
                          <td className="px-4 py-3 text-gray-600 print:px-2 print:py-1">
                            {String(p.lotNumber ?? '').trim() || '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900 print:px-2 print:py-1">
                            {formatQuantity(p.quantity)}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 print:px-2 print:py-1">
                            ¥{(p.returnAmount ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 print:px-2 print:py-1">
                            ¥{(p.rebillAmount ?? 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold text-gray-900">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 text-right print:px-2 print:py-1">
                          {t('return.summary.grandTotal')}
                        </td>
                        <td className="px-4 py-3 text-right text-[#00A651] print:px-2 print:py-1">
                          ¥{totalReturn.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-[#00A651] print:px-2 print:py-1">
                          ¥{totalRebill.toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-center pt-6 border-t border-gray-100 no-print">
                <Link
                  to="/return"
                  className="px-8 py-3 bg-[#00A651] text-white rounded-lg font-semibold shadow-md hover:bg-[#008A44] hover:shadow-lg transition-all transform hover:-translate-y-0.5"
                >
                  {t('return.back')}
                </Link>
              </div>
            </div>
          </div>
        </PrintLayout>
      </div>
    </div>
  )
}
