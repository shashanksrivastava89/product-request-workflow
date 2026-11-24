/**
 * What a return must have before the approvers see it.
 *
 * The requester may now submit without the original order number or the invoice date — a Technical
 * Service engineer raising a credit for a repair often does not have the order to hand. Vidhi:
 * *"she can submit without mandatory field … but after the service admin team review, this cannot be
 * accepted for any \[empty\] space"*; Corlett: 「私たちが直してオッケーしてから、プルーブに回ってほしい
 * です」 — we fix it and OK it, then it goes for approval.
 *
 * So the completeness gate did not disappear, it moved to the review step. This is the one
 * definition of it: the reviewer's screen shows what is still empty, the review queue refuses to
 * send while anything is, and `return-approval-readiness.util.ts` on the server enforces the same
 * list so the emailed approval link cannot get around it. Keep the two in step.
 */
import { isValidOptionalReturnOrderNumber } from './returnOrderNumber'

/** A field that must be filled before a return can go for approval. */
export type ReturnRequiredField =
  | 'returnType'
  | 'requestDate'
  | 'businessUnit'
  | 'requester'
  | 'soldTo'
  | 'dairitenContactName'
  | 'originalOrderNumber'
  | 'invoiceDate'
  | 'orderReason'
  | 'justification'
  | 'products'

/** What a request looks like to this check, from either the wizard's form or a stored row. */
export type ReturnCompletenessInput = {
  returnType?: string | null
  requestDate?: string | null
  businessUnit?: string | null
  requesterName?: string | null
  soldToCode?: string | null
  dairitenContactName?: string | null
  originalOrderNumber?: string | null
  invoiceDate?: string | null
  orderReason?: string | null
  justification?: string | null
  products?: unknown[] | null
}

const blank = (v: unknown) => String(v ?? '').trim() === ''

/**
 * The fields still empty, in the order a person reads the form.
 *
 * Only emptiness — a badly formed order number is a different complaint, reported where it is typed.
 * An empty list means the request is ready to go for approval.
 */
export function missingReturnFieldsForApproval(form: ReturnCompletenessInput): ReturnRequiredField[] {
  const missing: ReturnRequiredField[] = []
  if (blank(form.returnType)) missing.push('returnType')
  if (blank(form.requestDate)) missing.push('requestDate')
  if (blank(form.businessUnit)) missing.push('businessUnit')
  if (blank(form.requesterName)) missing.push('requester')
  if (blank(form.soldToCode)) missing.push('soldTo')
  if (blank(form.dairitenContactName)) missing.push('dairitenContactName')
  // Blank at submit, required here. A value that is present must also be a real order number, which
  // the format check reports separately.
  if (blank(form.originalOrderNumber) || !isValidOptionalReturnOrderNumber(form.originalOrderNumber)) {
    missing.push('originalOrderNumber')
  }
  if (blank(form.invoiceDate)) missing.push('invoiceDate')
  if (blank(form.orderReason)) missing.push('orderReason')
  if (blank(form.justification)) missing.push('justification')
  if (!Array.isArray(form.products) || form.products.length === 0) missing.push('products')
  return missing
}

/** The i18n key naming each field, for a "still empty" list. */
export const RETURN_REQUIRED_FIELD_LABEL_KEYS: Record<ReturnRequiredField, string> = {
  returnType: 'return.summary.type',
  requestDate: 'return.summary.date',
  businessUnit: 'return.summary.businessUnit',
  requester: 'return.summary.requester',
  soldTo: 'return.summary.soldTo',
  dairitenContactName: 'return.summary.dairitenContact',
  originalOrderNumber: 'return.summary.orderNumber',
  invoiceDate: 'return.summary.invoiceDate',
  orderReason: 'return.summary.orderReason',
  justification: 'return.summary.justification',
  products: 'return.summary.products',
}
