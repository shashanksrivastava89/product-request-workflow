import React from 'react';
import PrintLayout from './PrintLayout';
import { BilingualFieldCaption } from './BilingualFieldCaption';
import { Approval, RequestSnapshot, type ReviewEditRecord } from '../services/api.service';
import { SERVICE_FIELD_LABEL, canCarrySalesOrderNumber } from './RequestDetailSections';
import { deliveryModeDisplayLabel } from '../utils/deliveryMode';
import { formatShipToLabel } from '../utils/shipToDisplay';
import { formatRequesterWithSalesRepCode } from '../utils/sales-rep-display.util';
import {
  formatApprovalAssigneeLine,
  formatApprovalDecisionLine,
} from '../utils/approval-display.util';
import { formTypeDisplayLabel } from '../utils/formTypeDisplay';
import { returnOrderReasonLabel, returnTypeLabel } from './RequestDetailSections';
import FormAttachmentsGallery from './FormAttachmentsGallery';
import ProductCodeLine from './ProductCodeLine'
import { formatQuantity } from '../utils/numericInput'

interface FormPrintViewProps {
  form: RequestSnapshot | any;
  approval?: Approval;
  approvals?: Approval[];
  id: string;
}

export default function FormPrintView({ form, approval, approvals, id }: FormPrintViewProps) {
  if (!form) return null;

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      DRAFT: 'Draft',
      PENDING_APPROVAL: 'Pending Approval',
      IN_PROGRESS: 'In Progress',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      CANCELLED: 'Cancelled',
    };
    return statusMap[status] || status;
  };

  const isReturn = String(form.formType ?? form.purpose ?? '').trim().toUpperCase() === 'RETURN';

  /**
   * For a sample this is what the goods are worth. For a return it is what is being credited, which
   * the requester may have overwritten line by line — so summing quantity x price would print a
   * different figure from the one on the request and in the approval email.
   */
  const totalAmount = isReturn
    ? (form.products?.reduce((sum: number, p: any) => sum + Number(p.returnAmount ?? 0), 0) ??
        form.totalAmount ??
        0)
    : form.products?.reduce((sum: number, p: any) => {
        const price = p.wholesalePrice ?? p.unitPrice ?? 0;
        return sum + (price * (p.quantity || 0));
      }, 0) || form.totalAmount || 0;

  return (
    <div id={id} className="print-form-content">
      <PrintLayout
        title="Product Request Details"
        referenceNumber={form.referenceNumber || form.id?.slice(0, 8)}
        status={getStatusLabel(form.status)}
      >
        <div className="print-content space-y-4 print:space-y-1 text-sm print:text-xs">
          {/* Dense 3-column summary */}
          <div className="print-section print-section--tight print-section--keep">
            <h3 className="print-section-title">Application summary</h3>
            <div className="print-cols-3">
              <div>
                <div className="print-subtitle">Form</div>
                <div>
                  <span className="font-semibold">Type:</span> {formTypeDisplayLabel(form.formType)}
                </div>
                <div>
                  <span className="font-semibold">BU:</span> {form.businessUnit || '—'}
                </div>
                <div>
                  <span className="font-semibold">Request date:</span>{' '}
                  {form.requestDate ? new Date(form.requestDate).toLocaleDateString() : '—'}
                </div>
              </div>
              <div>
                <div className="print-subtitle">Requester</div>
                <div>
                  <span className="font-semibold">Name:</span>{' '}
                  {formatRequesterWithSalesRepCode(form.requesterName, form.salesRepCodeSap) || '—'}
                </div>
                {isReturn ? (
                  <div>
                    <span className="font-semibold">{SERVICE_FIELD_LABEL}:</span>{' '}
                    {form.isService ? 'Yes' : 'No'}
                  </div>
                ) : (
                  <div>
                    <span className="font-semibold">Delivery Date:</span>{' '}
                    {form.expectedDeliveryDate === 'ASAP'
                      ? 'ASAP'
                      : form.expectedDeliveryDate
                        ? new Date(form.expectedDeliveryDate).toLocaleDateString()
                        : '—'}
                  </div>
                )}
                {form.attentionTo && (
                  <div>
                    <BilingualFieldCaption labelKey="wizard.bilingual.attention" compact className="mb-0.5" />
                    <div className="font-medium">{form.attentionTo}</div>
                  </div>
                )}
                {form.phone && (
                  <div>
                    <span className="font-semibold">Phone:</span> {form.phone}
                  </div>
                )}
              </div>
              {isReturn ? (
                <div>
                  {/* No Mode or Ship-To: a return collects neither, and two empty rows told the
                      reader nothing. These are the fields it does have. */}
                  <div className="print-subtitle">Return</div>
                  <div>
                    <span className="font-semibold">Type:</span> {returnTypeLabel(form.returnType)}
                  </div>
                  <div>
                    <span className="font-semibold">Reason:</span>{' '}
                    {returnOrderReasonLabel(form.orderReason)}
                  </div>
                  <div>
                    <span className="font-semibold">Order no.:</span> {form.originalOrderNumber || '—'}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {(form.invoiceDates?.length ?? 0) > 1 ? 'Invoice dates:' : 'Invoice date:'}
                    </span>{' '}
                    {(form.invoiceDates?.length ?? 0) > 1
                      ? form.invoiceDates!.join(' / ')
                      : form.invoiceDate || '—'}
                    {form.isStandingOrder && (
                      <span className="ml-2 text-xs font-semibold">(定期予約 / standing order)</span>
                    )}
                  </div>
                  {form.quoteRefNo && (
                    <div>
                      <span className="font-semibold">Quote ref:</span> {form.quoteRefNo}
                    </div>
                  )}
                  <div>
                    <span className="font-semibold">SOLD-TO:</span> {form.soldToName || '—'}
                    {form.soldToCode && ` (${form.soldToCode})`}
                  </div>
                  <div>
                    <span className="font-semibold">End user:</span> {form.endUserName || '—'}
                    {form.endUserCode && ` (${form.endUserCode})`}
                  </div>
                  {(form.dairitenContactName || form.dairitenContactEmail) && (
                    <div>
                      <span className="font-semibold">Dealer contact:</span>{' '}
                      {[form.dairitenContactName, form.dairitenContactEmail].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="print-subtitle">Delivery</div>
                  <div>
                    <span className="font-semibold">Mode:</span> {deliveryModeDisplayLabel(form.deliveryMode, {
                      shipToCode: form.shipToCode,
                      formType: form.formType ?? form.purpose,
                    })}
                  </div>
                  <div>
                    <span className="font-semibold">SOLD-TO:</span> {form.soldToName || '—'}
                    {form.soldToCode && ` (${form.soldToCode})`}
                  </div>
                  <div>
                    <span className="font-semibold">Ship-TO:</span> {formatShipToLabel(form.shipToName, form.shipToCode)}
                  </div>
                  <div>
                    <span className="font-semibold">End user:</span> {form.endUserName || '—'}
                    {form.endUserCode && ` (${form.endUserCode})`}
                  </div>
                </div>
              )}
            </div>
          </div>

          {form.products && form.products.length > 0 && (
            <div className="print-section print-section--tight print-section--follow">
              <h3 className="print-section-title">Products</h3>
              <table className="w-full print-table-dense">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch / lot</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit</th>
                    {isReturn ? (
                      <>
                        <th className="text-right">Return</th>
                        <th className="text-right">Re-bill</th>
                      </>
                    ) : (
                      <th className="text-right">Subtotal</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {form.products.map((p: any, idx: number) => (
                    <tr key={idx}>
                      <td>
                        <div>{p.productName || p.name}</div>
                        {p.productNameLocal && (
                          <div className="text-[10px] text-gray-600 leading-tight">{p.productNameLocal}</div>
                        )}
                        <ProductCodeLine product={p} unit={form.businessUnit} className="text-[10px] text-gray-600 leading-tight" />
                      </td>
                      <td>{p.lotNumber?.trim() || '—'}</td>
                      <td className="text-right">{formatQuantity(p.quantity || 0)}</td>
                      <td className="text-right">¥{(p.wholesalePrice ?? p.unitPrice ?? 0).toLocaleString()}</td>
                      {isReturn ? (
                        <>
                          <td className="text-right font-semibold">
                            ¥{Number(p.returnAmount ?? 0).toLocaleString()}
                          </td>
                          <td className="text-right font-semibold">
                            ¥{Number(p.rebillAmount ?? 0).toLocaleString()}
                          </td>
                        </>
                      ) : (
                        <td className="text-right font-semibold">
                          ¥{((p.wholesalePrice ?? p.unitPrice ?? 0) * (p.quantity || 0)).toLocaleString()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    {/* Product, Batch / lot, Qty, Unit - then the money columns it totals. */}
                    <td colSpan={4} className="text-right font-bold">
                      {isReturn ? 'Total credited / re-billed' : 'Grand total'}
                    </td>
                    <td className="text-right font-bold">¥{totalAmount.toLocaleString()}</td>
                    {isReturn && (
                      <td className="text-right font-bold">
                        ¥{(form.products?.reduce((sum: number, p: any) => sum + Number(p.rebillAmount ?? 0), 0) ?? 0).toLocaleString()}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {approvals && approvals.length > 0 && (
            <div className="print-section">
              <h3 className="print-section-title">Approval history</h3>
              <table className="w-full print-table-dense">
                <thead>
                  <tr>
                    <th>Approver</th>
                    <th>Status / When</th>
                    <th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals
                    .sort((a, b) => a.level - b.level)
                    .map((app, idx) => (
                      <tr key={idx}>
                        <td>{formatApprovalAssigneeLine(app)}</td>
                        <td>{formatApprovalDecisionLine(app)}</td>
                        <td className="text-[9px] leading-tight max-w-[40%]">{app.comments || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {approval && (
            <div className="print-section print-section--keep print-section--tight">
              <h3 className="print-section-title">Current approval</h3>
              <div className="print-cols-2">
                <div>
                  <span className="font-semibold">Approver:</span>{' '}
                  {formatApprovalAssigneeLine(approval)} ({approval.approverEmail})
                </div>
                <div>
                  <span className="font-semibold">Level / role:</span> {approval.level} — {approval.role}
                </div>
                <div className="print-span-2">
                  <span className="font-semibold">Status:</span> {approval.status}
                </div>
              </div>
            </div>
          )}

          {canCarrySalesOrderNumber(form) && (
            <div className="print-section print-section--keep print-section--tight">
              <h3 className="print-section-title">SAP sales order number</h3>
              <div className="text-sm font-semibold">
                {String(form.salesOrderNumber ?? '').trim() || 'Not yet created in SAP'}
              </div>
            </div>
          )}

          {Array.isArray(form.reviewEdits) && form.reviewEdits.length > 0 && (
            <div className="print-section">
              <h3 className="print-section-title">Corrected during service review</h3>
              <table className="w-full print-table-dense">
                <thead>
                  <tr>
                    <th>When / who</th>
                    <th>Field</th>
                    <th>Was</th>
                    <th>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {(form.reviewEdits as ReviewEditRecord[]).flatMap((edit, i) =>
                    edit.fieldChanges.map((c, j) => (
                      <tr key={`${i}-${j}`}>
                        <td className="text-[9px] leading-tight">
                          {j === 0 ? `${new Date(edit.changedAt).toLocaleString()} — ${edit.changedByName}` : ''}
                        </td>
                        <td>{c.field}</td>
                        <td className="text-[9px] leading-tight">{c.oldValue ?? '—'}</td>
                        <td className="text-[9px] leading-tight">{c.newValue ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {(form.commentsForApproval || form.freeDescription) && (
            <div className="print-section">
              <h3 className="print-section-title">Comments</h3>
              <div className="space-y-1 text-xs">
                {form.commentsForApproval && (
                  <div>
                    <span className="font-semibold">For approval:</span>{' '}
                    <span className="whitespace-pre-wrap">{form.commentsForApproval}</span>
                  </div>
                )}
                {form.freeDescription && (
                  <div>
                    <BilingualFieldCaption labelKey="wizard.bilingual.freeSample" compact className="mb-0.5" />
                    <span className="whitespace-pre-wrap">{form.freeDescription}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {form.formType === 'ZNCCLAIM' && form.id && (
            <div className="print-section">
              <FormAttachmentsGallery formId={form.id} formType="ZNCCLAIM" />
            </div>
          )}
        </div>
      </PrintLayout>
    </div>
  );
}
