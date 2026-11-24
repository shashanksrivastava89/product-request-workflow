/**
 * What a return must have before its review step can be passed on to the approvers.
 *
 * The requester may submit without the original order number or the invoice date; the service review
 * team completes them. Vidhi: *"she can submit without mandatory field … but after the service admin
 * team review, this cannot be accepted for any \[empty\] space"*.
 *
 * The client shows the same list on the reviewer's screen and disables the queue's send button, but
 * a Reviewer step can also be approved from the emailed link, which never loads that screen — so the
 * gate has to live here too. Kept in step with `src/utils/returnCompleteness.ts`.
 *
 * That allowance is for a Service = Yes return only - the one kind with a review step. A Service = No
 * return goes straight to its approvers, so nobody completed it later: Damian Diggin found one at
 * Customer Service with its order no. blank (30 Sep 2026). Those are held to the same list at submit.
 */
import { SalesForm } from '../services/db.service';
import { AppError } from '../middleware/error.middleware';
import { prismaService } from '../services/prisma.service';
import { isReturnReviewerRole } from '../constants/return-form.constants';

/** Exactly 10 digits starting with 1 — the same rule the form applies. */
const RETURN_ORDER_NUMBER = /^1\d{9}$/;

/** A given order number is a real one: 10 digits, starting with 1. */
export function isValidReturnOrderNumber(value: unknown): boolean {
    return RETURN_ORDER_NUMBER.test(String(value ?? '').trim());
}

const blank = (v: unknown) => String(v ?? '').trim() === '';

/** Human labels, used in the refusal message the reviewer sees. */
const FIELD_LABELS: Record<string, string> = {
    returnType: 'Return type',
    requestDate: 'Date requesting',
    businessUnit: 'Business unit',
    requesterName: 'Requester',
    soldToCode: 'Sold-To',
    dairitenContactName: 'Contact name of Dairiten',
    originalOrderNumber: 'Order No.',
    invoiceDate: 'Invoice date',
    orderReason: 'Order reason',
    justification: 'Justification',
    products: 'Products',
};

/**
 * The fields still missing, by label. Empty means the request may go for approval.
 *
 * `products` is passed separately because a form row does not carry its lines.
 */
export function missingFieldsBeforeApproval(
    form: SalesForm,
    productCount: number
): string[] {
    const missing: string[] = [];
    const need = (key: keyof typeof FIELD_LABELS, isMissing: boolean) => {
        if (isMissing) missing.push(FIELD_LABELS[key]);
    };

    need('returnType', blank((form as { returnType?: string }).returnType));
    need('requestDate', blank(form.requestDate));
    need('businessUnit', blank(form.businessUnit));
    need('requesterName', blank(form.requesterName));
    need('soldToCode', blank(form.soldToCode));
    need('dairitenContactName', blank((form as { dairitenContactName?: string }).dairitenContactName));
    // Blank at submit, required now — and a value that is present must be a real order number.
    const orderNo = String((form as { originalOrderNumber?: string }).originalOrderNumber ?? '').trim();
    need('originalOrderNumber', orderNo === '' || !RETURN_ORDER_NUMBER.test(orderNo));
    need('invoiceDate', blank((form as { invoiceDate?: string }).invoiceDate));
    need('orderReason', blank((form as { orderReason?: string }).orderReason));
    need('justification', blank((form as { justification?: string }).justification));
    need('products', productCount === 0);

    return missing;
}

/** The message a requester gets when a return that has no review is submitted incomplete. */
export function incompleteForSubmitMessage(missing: string[]): string {
    return (
        `This request cannot be submitted yet: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} still empty.`
    );
}

/**
 * Refuse to pass a review step on while its request is incomplete - whichever way the approve came.
 *
 * The screen, the queue and the logged-in endpoint all checked; the Approve button in the review
 * mail did not, because it lands on the public token endpoint, which went straight to
 * processApproval. One check, called by both endpoints.
 */
export async function assertReviewStepComplete(approval: { role: string; formId: string }): Promise<void> {
    if (!isReturnReviewerRole(approval.role)) return;
    const form = await prismaService.findFormById(approval.formId);
    if (!form) return;
    const products = await prismaService.findFormProducts(approval.formId);
    const missing = missingFieldsBeforeApproval(form, products.length);
    if (missing.length > 0) throw new AppError(incompleteForApprovalMessage(missing), 400);
}

/** The message the reviewer gets when they try to send an incomplete request onward. */
export function incompleteForApprovalMessage(missing: string[]): string {
    return (
        `This request cannot go for approval yet: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} still empty. Use "Edit entries" to complete it first.`
    );
}
