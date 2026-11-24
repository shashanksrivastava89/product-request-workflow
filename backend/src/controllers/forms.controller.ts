import { Response, NextFunction } from 'express';
import { SalesForm } from '../services/db.service';
import { prismaService } from '../services/prisma.service';
import { generateReferenceNumber } from '../services/reference.service';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { reconcileMissingInProgressStep } from '../services/approval.service';
import { z } from 'zod';
import { hasServiceAdminPrivileges, hasSuperApproverPrivileges } from '../utils/auth-roles.util';
import { assertUserCanReadForm } from '../utils/form-access.util';
import { deleteAllAttachmentsForForm, copyAttachmentsToNewForm } from '../services/form-attachment.service';
import { diffForReview, recordReviewEdit, reviewWindowDenial, getReviewSnapshot, listReviewEdits } from '../services/form-review-edit.service';
import { QUANTITY_DECIMALS, isValidQuantity, roundYen } from '../utils/money.util';
import { reopenRejectedReturn } from '../services/form-reopen.service';
import { assertNoFutureInvoiceDates } from '../utils/invoice-date.util';
import {
    incompleteForSubmitMessage,
    isValidReturnOrderNumber,
    missingFieldsBeforeApproval,
} from '../utils/return-approval-readiness.util';

// Validation schemas (base object: `.partial()` is not available on ZodEffects after superRefine)
const createFormBaseSchema = z.object({
    formType: z.enum(['ZSAM', 'ZNC', 'ZNCCLAIM', 'ZINT', 'RETURN']),
    requestDate: z.string(),
    /** SAP sales rep code from wizard; required for NAME (code) in approval emails */
    salesRepCodeSap: z.string().optional(),
    businessUnit: z.string().optional(),
    requesterGroup: z.string().optional(),
    purpose: z.string(),
    expectedDeliveryDate: z.string().optional(),
    deliveryMode: z.string().optional(),
    soldToCode: z.string().optional(),
    soldToName: z.string().optional(),
    shipToCode: z.string().optional(),
    shipToName: z.string().optional(),
    attentionTo: z.string().optional(),
    endUserCode: z.string().optional(),
    endUserName: z.string().optional(),
    address: z.string().optional(),
    salesManager: z.string().optional(),
    districtSalesManager: z.string().optional(),
    nationalSalesManager: z.string().optional(),
    localFinanceController: z.string().optional(),
    directorCommercialManager: z.string().optional(),
    commentsForApproval: z.string().optional(),
    freeDescription: z.string().optional(),
    // Return-only. Optional here and enforced for formType RETURN in the superRefine below, so the
    // four sample types are validated exactly as before.
    returnType: z.string().optional(),
    isService: z.boolean().optional(),
    originalOrderNumber: z.string().optional(),
    invoiceDate: z.string().optional(),
    /** 定期予約 / Standing order — when set the request may carry several invoice dates. */
    isStandingOrder: z.boolean().optional(),
    /**
     * Every invoice date on the request, in entry order. `invoiceDate` above stays the first of
     * them so anything reading a single date is unaffected. A non-standing order sends one date, or
     * none at all and just uses `invoiceDate`.
     */
    invoiceDates: z.array(z.string()).max(24).optional(),
    quoteRefNo: z.string().optional(),
    orderReason: z.string().optional(),
    justification: z.string().optional(),
    dairitenContactName: z.string().optional(),
    dairitenContactEmail: z.string().optional(),
    products: z.array(z.object({
        productCode: z.string(),
        productName: z.string(),
        sapCode: z.string().optional(),
        /*
         * Decimal, but only for a return.
         *
         * Service lines are booked in hours (1.5, 0.35). The sample flows have been in production
         * for months with whole quantities - the Int column used to guarantee that and no longer
         * can, so the rule moves to assertQuantitiesValid rather than quietly disappearing.
         */
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        wholesalePrice: z.number().nonnegative().optional(),
        isConsumable: z.boolean().optional(),
        lotNumber: z.string().optional(),
        expiryDate: z.string().optional(),
        note: z.string().optional(),
        returnAmount: z.number().nonnegative().optional(),
        rebillAmount: z.number().nonnegative().optional()
    }))
});

/**
 * A return justifies itself with `justification`; a sample uses `freeDescription`. Both are the
 * same idea — the free-text reason the wizard makes mandatory — but they are separate fields and
 * separate labels, so require whichever one applies to the form type instead of demanding both.
 */
const createFormSchema = createFormBaseSchema.superRefine((data, ctx) => {
    if (data.formType === 'RETURN') {
        if (!String(data.justification ?? '').trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Justification is required for a return request',
                path: ['justification'],
            });
        }
        if (!String(data.returnType ?? '').trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Return type is required for a return request',
                path: ['returnType'],
            });
        }
        return;
    }
    if (!String(data.freeDescription ?? '').trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Comment to justify free sample is required',
            path: ['freeDescription'],
        });
    }
});

// A reviewer may also correct who raised the request. The wizard never sends this on update (the
// name is taken from the signed-in user at creation), so it is an update-only field.
const updateFormSchema = createFormBaseSchema.partial().extend({ requesterName: z.string().optional() });

/** One line per step, in order - what the trail records when a correction rebuilds the route. */
function describeRoute(approvals: Array<{ level: number; role: string; approverName: string }>): string {
    return [...approvals]
        .sort((a, b) => a.level - b.level)
        .map((a) => `${a.role}: ${a.approverName}`)
        .join(' -> ');
}

export const getForms = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const { status, formType } = req.query;

        // Build filter
        const filter: Partial<SalesForm> = {};
        if (status) filter.status = status as any;
        if (formType) filter.formType = formType as any;
        
        if (
            req.user?.role !== 'ADMIN' &&
            !hasSuperApproverPrivileges(req.user?.role ?? '', req.user?.isSuperApprover)
        ) {
            filter.requesterId = userId;
        }

        // Get forms from Prisma
        const forms = await prismaService.findManyForms(filter);

        // Get products and approvals for each form
        const formsWithProducts = await Promise.all(
            forms.map(async (form) => {
                const products = await prismaService.findFormProducts(form.id);
                const approvals = await prismaService.findApprovalsByFormId(form.id);
                return {
                    ...form,
                    products,
                    approvals
                };
            })
        );

        res.json({ forms: formsWithProducts });
    } catch (error) {
        next(error);
    }
};

export const getFormById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const form = await assertUserCanReadForm(req, id);

        await reconcileMissingInProgressStep(id, form.status);

        const products = await prismaService.findFormProducts(id);
        const approvals = await prismaService.findApprovalsByFormId(id);

        const formWithDetails = {
            ...form,
            products,
            approvals,
            // Standing orders carry several; everything else carries the one on the form.
            invoiceDates: await prismaService.findFormInvoiceDates(id),
            // What the review team has corrected so far. Only a return can have any.
            reviewEdits: form.formType === 'RETURN' ? await listReviewEdits(id) : []
        };

        res.json({ form: formWithDetails });
    } catch (error) {
        next(error);
    }
};

/**
 * The number an approver is being asked to sign off, and the one AMOUNT_LTE / AMOUNT_GT rules in
 * approval_chain_config compare against.
 *
 * For a sample it is what the goods are worth: quantity x price. For a return it is what is being
 * credited, which the requester may have overwritten line by line — so sum the stored returnAmount
 * and fall back to the catalogue total only for a line that never carried one.
 */
function formTotalAmount(
    formType: string,
    products: Array<{
        quantity: number;
        unitPrice: number;
        wholesalePrice?: number;
        returnAmount?: number;
    }>
): number {
    // Each line is rounded to whole yen before it is added, so the total is the figure a reader gets
    // by adding up the rows - not a rounded sum of fractions, which can differ by a yen or two.
    return products.reduce((sum, p) => {
        const catalogTotal = roundYen(p.quantity * (p.wholesalePrice || p.unitPrice));
        if (formType === 'RETURN') {
            return sum + (p.returnAmount ?? catalogTotal);
        }
        return sum + catalogTotal;
    }, 0);
}

/**
 * Quantities are decimal for a return and whole for everything else.
 *
 * The `Int` column carried that invariant for the sample flows until it widened for service hours,
 * so the check has to live somewhere - and every create, update and submit path passes through here
 * with the form type in hand.
 */
function assertQuantitiesValid(formType: string, products: Array<{ quantity: number }>): void {
    for (const p of products) {
        if (!isValidQuantity(p.quantity)) {
            throw new AppError(
                `Quantity must be greater than 0 with at most ${QUANTITY_DECIMALS} decimal places`,
                400
            );
        }
        if (formType !== 'RETURN' && !Number.isInteger(p.quantity)) {
            throw new AppError('Quantity must be a whole number for this request type', 400);
        }
    }
}

export const createForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);
        
        const userName = req.body.requesterName || req.user?.name || 'Unknown User';

        console.log('📝 Creating form with requester:', userName);

        const data = createFormSchema.parse(req.body);
        assertQuantitiesValid(data.formType, data.products);
        if (data.formType === 'RETURN') {
            assertNoFutureInvoiceDates(
                data.invoiceDates && data.invoiceDates.length > 0 ? data.invoiceDates : [data.invoiceDate]
            );
        }

        const totalAmount = formTotalAmount(data.formType, data.products);

        // Create form using Prisma
        const form = await prismaService.createForm({
            formType: data.formType,
            requesterId: userId,
            requesterName: userName,
            salesRepCodeSap: data.salesRepCodeSap,
            businessUnit: data.businessUnit,
            requesterGroup: data.requesterGroup,
            requestDate: data.requestDate,
            expectedDeliveryDate: data.expectedDeliveryDate,
            purpose: data.purpose,
            deliveryMode: data.deliveryMode,
            soldToCode: data.soldToCode,
            soldToName: data.soldToName,
            shipToCode: data.shipToCode,
            shipToName: data.shipToName,
            attentionTo: data.attentionTo,
            endUserCode: data.endUserCode,
            endUserName: data.endUserName,
            address: data.address,
            salesManager: data.salesManager,
            districtSalesManager: data.districtSalesManager,
            nationalSalesManager: data.nationalSalesManager,
            localFinanceController: data.localFinanceController,
            directorCommercialManager: data.directorCommercialManager,
            commentsForApproval: data.commentsForApproval,
            freeDescription: data.freeDescription,
            returnType: data.returnType,
            isService: data.isService ?? false,
            originalOrderNumber: data.originalOrderNumber,
            // Keep the scalar as the first date so print, email and SAP always have exactly one.
            invoiceDate: data.invoiceDates?.[0] ?? data.invoiceDate,
            isStandingOrder: data.isStandingOrder ?? false,
            quoteRefNo: data.quoteRefNo,
            orderReason: data.orderReason,
            justification: data.justification,
            dairitenContactName: data.dairitenContactName,
            dairitenContactEmail: data.dairitenContactEmail,
            totalAmount,
            currency: 'JPY',
            status: 'DRAFT'
        });

        // Every invoice date on the request, in entry order. A standing order carries several;
        // anything else carries the one already stored on the form.
        await prismaService.replaceFormInvoiceDates(
            form.id,
            data.invoiceDates && data.invoiceDates.length > 0
                ? data.invoiceDates
                : data.invoiceDate
                  ? [data.invoiceDate]
                  : []
        );

        // Create products
        const products = await Promise.all(
            data.products.map(p =>
                prismaService.createFormProduct({
                    formId: form.id,
                    productCode: p.productCode,
                    productName: p.productName,
                    sapCode: p.sapCode,
                    quantity: p.quantity,
                    unitPrice: p.unitPrice,
                    wholesalePrice: p.wholesalePrice || p.unitPrice,
                    subtotal: roundYen(p.quantity * (p.wholesalePrice || p.unitPrice)),
                    isConsumable: p.isConsumable || false,
                    lotNumber: p.lotNumber,
                    expiryDate: p.expiryDate,
                    note: p.note,
                    returnAmount: p.returnAmount,
                    rebillAmount: p.rebillAmount
                })
            )
        );

        res.status(201).json({ form: { ...form, products } });
    } catch (error) {
        next(error);
    }
};


/**
 * Create a new DRAFT by copying an existing submitted request (same requester only).
 * Does not alter the source record; the new form gets a new id and no reference number until submit.
 */
export const copyFormFromRejected = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        /*
         * Anything you can read, you can clone - at any stage.
         *
         * It used to be your own requests only, and only while rejected, pending, in progress or
         * approved. Both limits got in the way of what people actually do with this button: a
         * reviewer raising the same return for a colleague, an approver copying a request they have
         * just seen, anyone reusing a cancelled one. A clone is a DRAFT owned by whoever made it
         * and visible to nobody else until they submit it, so the only question that matters is
         * whether they were allowed to see the original - which is what assertUserCanReadForm
         * answers, and it is the same rule the detail screen uses.
         */
        const source = await assertUserCanReadForm(req, id);

        const requesterUser = await prismaService.findUserById(userId);
        /*
         * A return names its requester from a dropdown, and that name drives the approval chain and
         * the reference number, so it must survive the copy — the person doing the copying is
         * already recorded as the enterer through `requesterId`, which is set to them below.
         *
         * The sample flow keeps its long-standing behaviour of renaming the copy to the signed-in
         * user: it has been in production for months and is not what this round is changing.
         */
        const requesterDisplayName =
            source.formType === 'RETURN'
                ? source.requesterName
                : requesterUser?.name || source.requesterName;

        const sourceProducts = await prismaService.findFormProducts(id);
        const sourceInvoiceDates = await prismaService.findFormInvoiceDates(id);
        const totalAmount = formTotalAmount(source.formType, sourceProducts);

        const requestDate = new Date().toISOString().slice(0, 10);

        const newForm = await prismaService.createForm({
            formType: source.formType,
            requesterId: userId,
            requesterName: requesterDisplayName,
            salesRepCodeSap: source.salesRepCodeSap,
            businessUnit: source.businessUnit,
            requesterGroup: source.requesterGroup,
            requestDate,
            expectedDeliveryDate: source.expectedDeliveryDate,
            purpose: source.purpose,
            deliveryMode: source.deliveryMode,
            soldToCode: source.soldToCode,
            soldToName: source.soldToName,
            shipToCode: source.shipToCode,
            shipToName: source.shipToName,
            attentionTo: source.attentionTo,
            endUserCode: source.endUserCode,
            endUserName: source.endUserName,
            address: source.address,
            postalCode: source.postalCode,
            prefecture: source.prefecture,
            phone: source.phone,
            salesManager: source.salesManager,
            districtSalesManager: source.districtSalesManager,
            nationalSalesManager: source.nationalSalesManager,
            localFinanceController: source.localFinanceController,
            directorCommercialManager: source.directorCommercialManager,
            commentsForApproval: source.commentsForApproval,
            freeDescription: source.freeDescription,
            returnType: source.returnType,
            isService: source.isService ?? false,
            originalOrderNumber: source.originalOrderNumber,
            invoiceDate: source.invoiceDate,
            isStandingOrder: source.isStandingOrder ?? false,
            quoteRefNo: source.quoteRefNo,
            orderReason: source.orderReason,
            justification: source.justification,
            dairitenContactName: source.dairitenContactName,
            dairitenContactEmail: source.dairitenContactEmail,
            totalAmount,
            currency: source.currency || 'JPY',
            status: 'DRAFT',
        });

        if (source.formType === 'ZNCCLAIM') {
            await copyAttachmentsToNewForm(id, newForm.id, userId);
        }

        /*
         * Every invoice date, not only the scalar first one.
         *
         * A standing order carries several dates in `FormInvoiceDate`; copying only
         * `source.invoiceDate` silently dropped the rest, so a copied standing order came back with
         * one date and its extra rows gone.
         */
        const copiedInvoiceDates =
            sourceInvoiceDates.length > 0
                ? sourceInvoiceDates
                : source.invoiceDate
                  ? [String(source.invoiceDate)]
                  : [];
        await prismaService.replaceFormInvoiceDates(newForm.id, copiedInvoiceDates);

        const products = await Promise.all(
            sourceProducts.map((p) =>
                prismaService.createFormProduct({
                    formId: newForm.id,
                    productCode: p.productCode,
                    productName: p.productName,
                    sapCode: p.sapCode,
                    quantity: p.quantity,
                    unitPrice: p.unitPrice,
                    wholesalePrice: p.wholesalePrice ?? p.unitPrice,
                    subtotal: p.subtotal,
                    isConsumable: p.isConsumable,
                    lotNumber: p.lotNumber,
                    expiryDate: p.expiryDate,
                    note: p.note,
                    returnAmount: p.returnAmount,
                    rebillAmount: p.rebillAmount,
                })
            )
        );

        res.status(201).json({ form: { ...newForm, products, invoiceDates: copiedInvoiceDates } });
    } catch (error) {
        next(error);
    }
};

export const updateForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const existingForm = await prismaService.findFormById(id);

        if (!existingForm) {
            throw new AppError('Form not found', 404);
        }

        // A draft belongs to its requester (or an admin). A submitted return is a different case:
        // the Service Admin team may correct it while it is still at the review step, so ownership
        // is not the test there — reviewWindowDenial is.
        const isOwnDraft = existingForm.requesterId === userId || req.user?.role === 'ADMIN';

        let reviewEdit = false;
        if (existingForm.status !== 'DRAFT') {
            const denial = await reviewWindowDenial(existingForm, {
                userId,
                role: req.user?.role,
                isServiceAdmin: req.user?.isServiceAdmin,
            });
            if (denial) {
                // Keep the old wording for anyone who is simply editing too late, so existing
                // callers see no change in behaviour.
                throw new AppError(
                    denial === 'This request has moved past review and can no longer be edited.'
                        ? denial
                        : `Cannot update submitted form. ${denial}`,
                    400
                );
            }
            reviewEdit = true;
        } else if (!isOwnDraft) {
            throw new AppError('Access denied', 403);
        }

        // Snapshot before the write, so the trail can say what actually moved - and, on the first
        // correction, so the whole run of corrections can later be discarded.
        const before = reviewEdit
            ? {
                  ...existingForm,
                  products: await prismaService.findFormProducts(id),
                  invoiceDates: await prismaService.findFormInvoiceDates(id),
              }
            : null;

        const data = updateFormSchema.parse(req.body);
        if (existingForm.formType === 'RETURN' && (data.invoiceDates !== undefined || data.invoiceDate !== undefined)) {
            assertNoFutureInvoiceDates(data.invoiceDates ?? [data.invoiceDate]);
        }

        // A corrected requester, business unit or service flag changes who approves. The new route is
        // built BEFORE anything is written: a requester with no row in the return matrix has no
        // route, and that is refused outright rather than stored - the same state that blocks Next
        // in the wizard. Only a request at its review step ever gets here with reviewEdit set.
        const routeInputsChanged =
            reviewEdit &&
            ((data.requesterName !== undefined && data.requesterName !== existingForm.requesterName) ||
                (data.businessUnit !== undefined && data.businessUnit !== existingForm.businessUnit) ||
                (data.isService !== undefined && data.isService !== existingForm.isService));
        const { routeAfterReview, rebuildRouteAfterReviewEdit } = await import('../services/approval.service');
        if (routeInputsChanged) {
            const followers = await routeAfterReview({
                ...existingForm,
                requesterName: data.requesterName ?? existingForm.requesterName,
                businessUnit: data.businessUnit ?? existingForm.businessUnit,
                isService: data.isService ?? existingForm.isService,
            } as any);
            if (followers.length === 0) {
                throw new AppError(
                    `No approval route is defined for ${data.requesterName ?? existingForm.requesterName} in ${
                        data.businessUnit ?? existingForm.businessUnit ?? ''
                    }. Pick a requester who is in the return approval matrix.`,
                    400
                );
            }
        }

        // Calculate new total if products changed
        let totalAmount = existingForm.totalAmount;
        if (data.products) {
            assertQuantitiesValid(data.formType ?? existingForm.formType, data.products);
            totalAmount = formTotalAmount(data.formType ?? existingForm.formType, data.products);

            // Delete old products and create new ones
            await prismaService.deleteFormProducts(id);
            await Promise.all(
                data.products.map(p =>
                    prismaService.createFormProduct({
                        formId: id,
                        productCode: p.productCode,
                        productName: p.productName,
                        sapCode: p.sapCode,
                        quantity: p.quantity,
                        unitPrice: p.unitPrice,
                        wholesalePrice: p.wholesalePrice || p.unitPrice,
                        subtotal: roundYen(p.quantity * (p.wholesalePrice || p.unitPrice)),
                        isConsumable: p.isConsumable || false,
                        lotNumber: p.lotNumber,
                        expiryDate: p.expiryDate,
                        note: p.note,
                        returnAmount: p.returnAmount,
                        rebillAmount: p.rebillAmount
                    })
                )
            );
        }

        // The invoice dates live in their own table, so they are replaced rather than patched.
        if (data.invoiceDates !== undefined) {
            await prismaService.replaceFormInvoiceDates(id, data.invoiceDates);
        }

        // Update form (products and invoice dates are stored separately, so drop them here)
        const { products: _, invoiceDates: _dates, ...updateData } = data;
        const updatedForm = await prismaService.updateForm(id, {
            ...updateData,
            // Keep the scalar as the first date whenever a list was supplied.
            ...(data.invoiceDates !== undefined
                ? { invoiceDate: data.invoiceDates[0] ?? undefined }
                : {}),
            totalAmount
        });

        if (!updatedForm) {
            throw new AppError('Failed to update form', 500);
        }

        const products = await prismaService.findFormProducts(id);

        if (reviewEdit && before) {
            const routeBefore = describeRoute(await prismaService.findApprovalsByFormId(id));
            if (routeInputsChanged) await rebuildRouteAfterReviewEdit(updatedForm);
            const routeAfter = describeRoute(await prismaService.findApprovalsByFormId(id));

            const invoiceDates = await prismaService.findFormInvoiceDates(id);
            const changes = diffForReview(before, { ...updatedForm, products, invoiceDates });
            if (routeBefore !== routeAfter) {
                changes.push({ field: 'Approval route', oldValue: routeBefore || null, newValue: routeAfter || null });
            }
            const { products: beforeProducts, invoiceDates: beforeDates, ...beforeForm } = before;
            await recordReviewEdit(id, userId, changes, {
                form: beforeForm as Record<string, unknown>,
                products: beforeProducts,
                invoiceDates: beforeDates,
            });
        }

        res.json({ form: { ...updatedForm, products } });
    } catch (error) {
        next(error);
    }
};

/**
 * Discard every correction made during service review, returning the request to exactly what the
 * requester submitted.
 *
 * The trail's field diffs are display strings and a products summary, so they cannot rebuild a
 * request; the snapshot taken on the first correction can. Restoring is itself recorded as a
 * further trail entry rather than by deleting history - the approvers should be able to see that
 * corrections were made and then withdrawn.
 *
 * Same window as editing: a Service Admin, while the request sits at its review step.
 */
export const revertReviewEdits = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);
        const { id } = req.params;

        const existingForm = await prismaService.findFormById(id);
        if (!existingForm) throw new AppError('Form not found', 404);

        const denial = await reviewWindowDenial(existingForm, {
            userId,
            role: req.user?.role,
            isServiceAdmin: req.user?.isServiceAdmin,
        });
        if (denial) throw new AppError(denial, 400);

        const snapshot = await getReviewSnapshot(id);
        if (!snapshot) {
            throw new AppError('This request has not been corrected, so there is nothing to discard.', 400);
        }

        const before = {
            ...existingForm,
            products: await prismaService.findFormProducts(id),
            invoiceDates: await prismaService.findFormInvoiceDates(id),
        };

        // Products and invoice dates live in their own tables: replace them, as updateForm does.
        await prismaService.deleteFormProducts(id);
        await Promise.all(
            (snapshot.products as any[]).map((p) =>
                prismaService.createFormProduct({
                    formId: id,
                    productCode: p.productCode,
                    productName: p.productName,
                    sapCode: p.sapCode ?? undefined,
                    quantity: Number(p.quantity ?? 0),
                    unitPrice: Number(p.unitPrice ?? 0),
                    wholesalePrice: Number(p.wholesalePrice ?? p.unitPrice ?? 0),
                    subtotal: Number(p.subtotal ?? 0),
                    isConsumable: Boolean(p.isConsumable),
                    lotNumber: p.lotNumber ?? undefined,
                    expiryDate: p.expiryDate ?? undefined,
                    note: p.note ?? undefined,
                    returnAmount: p.returnAmount == null ? undefined : Number(p.returnAmount),
                    rebillAmount: p.rebillAmount == null ? undefined : Number(p.rebillAmount),
                })
            )
        );
        await prismaService.replaceFormInvoiceDates(id, snapshot.invoiceDates ?? []);

        // Only the columns a reviewer can touch. Identity, chain and bookkeeping columns stay.
        const f = snapshot.form as Record<string, any>;
        const restored = await prismaService.updateForm(id, {
            returnType: f.returnType ?? undefined,
            isService: f.isService ?? undefined,
            businessUnit: f.businessUnit ?? undefined,
            requesterName: f.requesterName ?? undefined,
            requesterGroup: f.requesterGroup ?? undefined,
            salesRepCodeSap: f.salesRepCodeSap ?? undefined,
            requestDate: f.requestDate ?? undefined,
            soldToCode: f.soldToCode ?? undefined,
            soldToName: f.soldToName ?? undefined,
            endUserCode: f.endUserCode ?? undefined,
            endUserName: f.endUserName ?? undefined,
            dairitenContactName: f.dairitenContactName ?? undefined,
            dairitenContactEmail: f.dairitenContactEmail ?? undefined,
            originalOrderNumber: f.originalOrderNumber ?? undefined,
            invoiceDate: f.invoiceDate ?? undefined,
            isStandingOrder: f.isStandingOrder ?? undefined,
            quoteRefNo: f.quoteRefNo ?? undefined,
            orderReason: f.orderReason ?? undefined,
            justification: f.justification ?? undefined,
            totalAmount: f.totalAmount ?? undefined,
        } as any);
        if (!restored) throw new AppError('Failed to restore the request', 500);

        // The route followed the corrected requester / unit / flag; it follows them back.
        const routeBefore = describeRoute(await prismaService.findApprovalsByFormId(id));
        if (
            restored.requesterName !== existingForm.requesterName ||
            restored.businessUnit !== existingForm.businessUnit ||
            restored.isService !== existingForm.isService
        ) {
            const { rebuildRouteAfterReviewEdit } = await import('../services/approval.service');
            await rebuildRouteAfterReviewEdit(restored);
        }
        const routeAfter = describeRoute(await prismaService.findApprovalsByFormId(id));

        const products = await prismaService.findFormProducts(id);
        const invoiceDates = await prismaService.findFormInvoiceDates(id);
        const changes = diffForReview(before as any, { ...restored, products, invoiceDates } as any);
        if (routeBefore !== routeAfter) {
            changes.push({ field: 'Approval route', oldValue: routeBefore || null, newValue: routeAfter || null });
        }
        // No snapshot argument: the first edit already holds the one that matters.
        await recordReviewEdit(id, userId, changes);

        res.json({ form: { ...restored, products, invoiceDates }, reverted: changes.length });
    } catch (error) {
        next(error);
    }
};

/**
 * Set the SAP sales order number on a fully approved service return.
 *
 * The Service Admin team creates the credit/debit memo in SAP once every approval is in, and asked
 * to record its number back on the request so the paperwork matches (Corlett, 2 Sep). Service returns
 * only: Emi confirmed CS reads those numbers from the SAP document flow instead, and asked to
 * "minimize manual input, especially after approval has been completed".
 *
 * Deliberately not part of updateForm: an approved form is otherwise immutable, and this touches
 * exactly one column without reopening the rest.
 */
const salesOrderNumberSchema = z.object({
    salesOrderNumber: z.string().trim().max(64),
});

export const setSalesOrderNumber = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        if (!hasServiceAdminPrivileges(req.user?.role, req.user?.isServiceAdmin)) {
            throw new AppError('Only the Service Admin team can set the sales order number', 403);
        }

        const { salesOrderNumber } = salesOrderNumberSchema.parse(req.body);

        const form = await prismaService.findFormById(id);
        if (!form) throw new AppError('Form not found', 404);
        if (form.formType !== 'RETURN') {
            throw new AppError('A sales order number applies to return requests only', 400);
        }
        if (form.isService !== true) {
            throw new AppError(
                'A sales order number applies to service returns only',
                400
            );
        }
        if (form.status !== 'APPROVED') {
            throw new AppError(
                'The sales order number can only be set once the request is fully approved',
                400
            );
        }

        // Blank clears it, so a mistyped number can be corrected rather than being permanent.
        // Explicitly null, not undefined: Prisma drops undefined fields, which would silently keep
        // the old number instead of clearing it.
        const updated = await prismaService.updateForm(id, {
            salesOrderNumber: salesOrderNumber || null,
        } as any);
        if (!updated) throw new AppError('Failed to update form', 500);

        res.json({ form: updated, message: 'Sales order number saved' });
    } catch (error) {
        next(error);
    }
};

export const deleteForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const form = await prismaService.findFormById(id);

        if (!form) {
            throw new AppError('Form not found', 404);
        }

        if (form.requesterId !== userId && req.user?.role !== 'ADMIN') {
            throw new AppError('Access denied', 403);
        }

        const isAdmin = req.user?.role === 'ADMIN';
        // Requesters may delete only their own drafts; ADMIN may delete any status (including APPROVED)
        if (!isAdmin && form.status !== 'DRAFT') {
            throw new AppError('Cannot delete submitted form', 400);
        }

        // Delete attachment files then form (cascade deletes DB rows)
        await deleteAllAttachmentsForForm(id);
        const deleted = await prismaService.deleteForm(id);

        if (!deleted) {
            throw new AppError('Failed to delete form', 500);
        }

        res.json({ message: 'Form deleted successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * Reopen a rejected return so it can be corrected and resubmitted in place.
 *
 * The request goes back to a draft - same id, same reference number - owned by whoever reopened it,
 * and its rejected round is kept in approval_history. The wizard then opens it like any draft, and
 * submitting routes it through the approval chain again. See form-reopen.service.
 */
export const reopenForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);
        const form = await reopenRejectedReturn(req.params.id, userId);
        const [products, invoiceDates] = await Promise.all([
            prismaService.findFormProducts(form.id),
            prismaService.findFormInvoiceDates(form.id),
        ]);
        res.json({ form: { ...form, products, invoiceDates } });
    } catch (error) {
        next(error);
    }
};

export const submitForm = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        const form = await prismaService.findFormById(id);

        if (!form) {
            throw new AppError('Form not found', 404);
        }

        if (form.requesterId !== userId && req.user?.role !== 'ADMIN') {
            throw new AppError('Access denied', 403);
        }

        if (form.status !== 'DRAFT') {
            throw new AppError('Form already submitted', 400);
        }

        const products = await prismaService.findFormProducts(id);

        if (products.length === 0) {
            throw new AppError('Cannot submit form without products', 400);
        }

        if (form.formType === 'RETURN') {
            // Stored dates too: a draft saved before the rule must not go out with a future one.
            assertNoFutureInvoiceDates([form.invoiceDate, ...(await prismaService.findFormInvoiceDates(id))]);
            // A given order number is a real one, whoever submits it - the form checks the same.
            const orderNo = String(form.originalOrderNumber ?? '').trim();
            if (orderNo && !isValidReturnOrderNumber(orderNo)) {
                throw new AppError('Original order no. must be 10 digits starting with 1', 400);
            }
            /*
             * A Service = No return has no review step to complete it, so it must be complete now.
             * The blank allowance (9 Sep) was for the service review; without it a return reached
             * Customer Service with no order number (Damian Diggin, 30 Sep 2026).
             */
            if (form.isService !== true) {
                const missing = missingFieldsBeforeApproval(form, products.length);
                if (missing.length > 0) throw new AppError(incompleteForSubmitMessage(missing), 400);
            }
        }

        /*
         * A reopened return keeps the reference it was rejected under - that continuity is the point
         * of reopening instead of copying (Corlett Siobhan, 25 Sep). Only a request that has never been
         * submitted gets a new one.
         */
        const referenceNumber =
            form.referenceNumber ||
            generateReferenceNumber(form.formType, form.businessUnit || 'NA', form.salesRepCodeSap);

        // Update form status and add reference number
        const updatedForm = await prismaService.updateForm(id, {
            referenceNumber,
            status: 'PENDING_APPROVAL',
            submittedAt: new Date().toISOString()
        });

        if (!updatedForm) {
            throw new AppError('Failed to update form', 500);
        }

        // Log form details before creating approval workflow
        console.log('📝 Form submitted:', {
            id: updatedForm.id,
            formType: updatedForm.formType,
            requester: updatedForm.requesterName,
            totalAmount: `¥${updatedForm.totalAmount.toLocaleString()}`,
            deliveryInfo: {
                soldTo: updatedForm.soldToName,
                shipTo: updatedForm.shipToName,
                endUser: updatedForm.endUserName
            },
            approvers: {
                salesManager: updatedForm.salesManager,
                districtSalesManager: updatedForm.districtSalesManager,
                nationalSalesManager: updatedForm.nationalSalesManager
            },
            products: products.length
        });

        // Import and call approval workflow
        const { createApprovalWorkflow, sendReturnSubmissionConfirmation } = await import(
            '../services/approval.service'
        );
        await createApprovalWorkflow(updatedForm);

        // "Request Submitted" to the requester, CC the submitter. After the workflow, so the mail can
        // show the route; awaited only so a send failure is logged - it never fails the submission.
        await sendReturnSubmissionConfirmation(updatedForm.id);

        // Reload form with workflow updates (e.g., final approval tracking)
        const finalForm = await prismaService.findFormById(id);

        if (!finalForm) {
            throw new AppError('Form not found after submission', 500);
        }

        // Form is already saved in database via Prisma
        // No need to create a separate snapshot

        res.json({
            form: { ...finalForm, products },
            message: 'Form submitted successfully'
        });
    } catch (error) {
        console.error('Submit form error:', error);
        next(error);
    }
};
