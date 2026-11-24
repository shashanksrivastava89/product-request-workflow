/**
 * The service review window: who may edit a submitted return, and recording what they changed.
 *
 * The Service Admin team asked to correct a request before the approval chain starts, because
 * service credit and return is intricate, requesters often get it wrong, and today a wrong entry
 * that reaches the end has to be raised again from scratch (Corlett, 2 Sep).
 *
 * A submitted form is otherwise immutable, so the window is deliberately narrow: only a return,
 * only while its *review* step is still the one in progress, and only for the Service Admin team.
 * Once any approver has acted the form locks again exactly as before.
 *
 * Every edit is recorded. Without that an approver could be signing off figures the requester never
 * submitted and have no way to tell.
 */

import { PrismaClient } from '@prisma/client';
import { SalesForm } from './db.service';
import { hasServiceAdminPrivileges } from '../utils/auth-roles.util';
import { isReturnReviewerRole } from '../constants/return-form.constants';

const prisma = new PrismaClient();

export type ReviewEditActor = {
    userId: string;
    role?: string | null;
    isServiceAdmin?: boolean;
};

/** Why an edit is not allowed, or null when it is. Wording is shown to the caller. */
export type ReviewWindowDenial = string | null;

/**
 * Whether `actor` may edit `form` right now.
 *
 * Returns null when allowed, otherwise the reason — so the caller can answer with something a
 * person can act on rather than a bare 403.
 */
export async function reviewWindowDenial(
    form: SalesForm,
    actor: ReviewEditActor
): Promise<ReviewWindowDenial> {
    if (form.formType !== 'RETURN') {
        return 'Only a return request can be edited during review.';
    }
    if (!hasServiceAdminPrivileges(actor.role ?? undefined, actor.isServiceAdmin)) {
        return 'Only the Service Admin team can edit a request during review.';
    }

    const approvals = await prisma.approval.findMany({
        where: { formId: form.id },
        orderBy: { level: 'asc' },
        select: { role: true, status: true },
    });

    if (approvals.length === 0) {
        return 'This request has no approval steps yet.';
    }

    const current = approvals.find((a) => a.status === 'IN_PROGRESS');
    if (!current) {
        return 'This request is not awaiting review.';
    }
    if (!isReturnReviewerRole(current.role)) {
        // Deliberately specific: an approver has already acted, so an edit now would change what
        // they signed off.
        return 'This request has moved past review and can no longer be edited.';
    }
    return null;
}

/** The form fields a reviewer may change, and the label each carries in the trail. */
const TRACKED_FORM_FIELDS: Array<{ key: keyof SalesForm; label: string }> = [
    { key: 'returnType', label: 'Return type' },
    { key: 'isService', label: 'Service - TS有償作業WOと保守' },
    { key: 'businessUnit', label: 'Business unit' },
    { key: 'requesterName', label: 'Requester' },
    { key: 'originalOrderNumber', label: 'Original order no.' },
    { key: 'invoiceDate', label: 'Invoice date' },
    { key: 'quoteRefNo', label: 'Quote ref no.' },
    { key: 'orderReason', label: 'Order reason' },
    { key: 'justification', label: 'Justification' },
    { key: 'dairitenContactName', label: 'Dealer contact name' },
    { key: 'dairitenContactEmail', label: 'Dealer contact email' },
    { key: 'soldToCode', label: 'Sold-To' },
    { key: 'endUserCode', label: 'End user' },
    { key: 'isStandingOrder', label: 'Standing order' },
    { key: 'totalAmount', label: 'Total credited' },
];

export type FieldChange = { field: string; oldValue: string | null; newValue: string | null };

function display(v: unknown): string | null {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
}

/**
 * What changed between two versions of a form, plus a single summary line per product line.
 *
 * Product lines are summarised rather than diffed field by field: an approver needs to see that
 * a line's quantity or credit moved, not a row per column.
 */
export function diffForReview(
    before: SalesForm & { products?: any[]; invoiceDates?: string[] },
    after: SalesForm & { products?: any[]; invoiceDates?: string[] }
): FieldChange[] {
    const changes: FieldChange[] = [];

    for (const { key, label } of TRACKED_FORM_FIELDS) {
        const oldValue = display(before[key]);
        const newValue = display(after[key]);
        if (oldValue !== newValue) {
            changes.push({ field: label, oldValue, newValue });
        }
    }

    // The lot only when the line has one, so a line without reads exactly as it always did. Without
    // it a correction to the lot alone recorded nothing - no trail entry for the approvers, and no
    // snapshot for "discard all corrections" to restore the requester's lot from.
    const summarise = (lines: any[] | undefined) =>
        (Array.isArray(lines) ? lines : [])
            .map(
                (p) =>
                    `${p.productCode ?? '?'}` +
                    (String(p.lotNumber ?? '').trim() ? ` lot ${String(p.lotNumber).trim()}` : '') +
                    ` x${p.quantity ?? 0}` +
                    ` return ${Number(p.returnAmount ?? 0)}` +
                    ` rebill ${Number(p.rebillAmount ?? 0)}`
            )
            .sort()
            .join('; ');

    const oldLines = summarise(before.products);
    const newLines = summarise(after.products);
    if (oldLines !== newLines) {
        changes.push({ field: 'Products', oldValue: oldLines || null, newValue: newLines || null });
    }

    // A standing order carries several invoice dates; the scalar above is only the first of them.
    // Compared only when both sides supplied the list, so a caller that never loaded it cannot
    // make the trail claim the dates changed.
    if (Array.isArray(before.invoiceDates) && Array.isArray(after.invoiceDates)) {
        const oldDates = before.invoiceDates.join(', ');
        const newDates = after.invoiceDates.join(', ');
        if (oldDates !== newDates && (before.invoiceDates.length > 1 || after.invoiceDates.length > 1)) {
            changes.push({ field: 'Invoice dates', oldValue: oldDates || null, newValue: newDates || null });
        }
    }

    return changes;
}

/**
 * The request exactly as it stood before the review team's FIRST correction — form columns, product
 * lines and invoice dates. Stored once per form, on that first edit, so a whole run of corrections
 * can be discarded and the request returned to what the requester submitted.
 */
export type ReviewSnapshot = {
    form: Record<string, unknown>;
    products: unknown[];
    invoiceDates: string[];
};

/**
 * Record an edit. No-ops when nothing actually changed, so the trail holds only real edits.
 *
 * `beforeSnapshot` is kept only when this is the form's first edit: later edits are already
 * covered by it, and the point of a snapshot is what the REQUESTER submitted, not what the previous
 * reviewer left behind.
 */
export async function recordReviewEdit(
    formId: string,
    changedById: string,
    fieldChanges: FieldChange[],
    beforeSnapshot?: ReviewSnapshot | null
): Promise<void> {
    if (fieldChanges.length === 0) return;
    let snapshot: ReviewSnapshot | null = null;
    if (beforeSnapshot) {
        const priorEdits = await prisma.formReviewEdit.count({ where: { formId } });
        if (priorEdits === 0) snapshot = beforeSnapshot;
    }
    await prisma.formReviewEdit.create({
        data: {
            formId,
            changedById,
            fieldChanges: fieldChanges as any,
            ...(snapshot ? { beforeSnapshot: snapshot as any } : {}),
        },
    });
}

/** The pre-correction snapshot for a form, or null when it has never been corrected. */
export async function getReviewSnapshot(formId: string): Promise<ReviewSnapshot | null> {
    // The trail is a handful of rows, so pick the snapshot in code rather than through Prisma's
    // JSON-null filter, whose DbNull/JsonNull distinction is easy to get wrong.
    const edits = await prisma.formReviewEdit.findMany({
        where: { formId },
        orderBy: { changedAt: 'asc' },
        select: { beforeSnapshot: true },
    });
    const first = edits.find((e) => e.beforeSnapshot !== null && e.beforeSnapshot !== undefined);
    return (first?.beforeSnapshot as unknown as ReviewSnapshot | null) ?? null;
}

export type ReviewEditRecord = {
    changedAt: string;
    changedByName: string;
    fieldChanges: FieldChange[];
};

/** The edits made to a form during review, oldest first, for the detail view and approval emails. */
export async function listReviewEdits(formId: string): Promise<ReviewEditRecord[]> {
    const rows = await prisma.formReviewEdit.findMany({
        where: { formId },
        orderBy: { changedAt: 'asc' },
        include: { changedBy: { select: { name: true } } },
    });
    return rows.map((r) => ({
        changedAt: r.changedAt.toISOString(),
        changedByName: r.changedBy?.name ?? 'Unknown',
        fieldChanges: (r.fieldChanges as unknown as FieldChange[]) ?? [],
    }));
}
