import { prismaService } from './prisma.service';
import { loadNamedRequesterIndex, resolveNamedRequesterFrom } from './named-requester.service';
import { SalesForm } from './db.service';
import { listReviewEdits } from './form-review-edit.service';

/**
 * Save a submitted form to requests.json
 * NOTE: This is now a no-op since forms are already saved in the database.
 * Kept for backward compatibility but does nothing.
 */
export const saveRequest = (formData: any): void => {
    // Forms are already saved in the database via Prisma
    // No need to create a separate snapshot
    console.log(`💾 Form already saved in database: ${formData.referenceNumber}`);
};

/**
 * Get a request by reference number
 * Now queries the SalesForm table directly
 */
export const getRequestByReferenceNumber = async (referenceNumber: string): Promise<any | null> => {
    const forms = await prismaService.findManyForms({ referenceNumber });
    if (forms.length === 0) return null;
    
    const form = forms[0];
    const products = await prismaService.findFormProducts(form.id);
    const approvals = await prismaService.findApprovalsByFormId(form.id);
    
    return {
        ...form,
        products,
        approvals,
        invoiceDates: await prismaService.findFormInvoiceDates(form.id),
    };
};

/**
 * Get all requests with optional filtering
 * Now queries the SalesForm table directly
 * Includes products for each form
 */
export const getAllRequests = async (filters?: {
    formType?: string;
    businessUnit?: string;
    status?: string;
}): Promise<any[]> => {
    const filter: Partial<SalesForm> = {};
    
    if (filters) {
        if (filters.formType) filter.formType = filters.formType as any;
        if (filters.businessUnit) filter.businessUnit = filters.businessUnit;
        // Don't set status filter here - we'll filter in memory to handle multiple statuses
    }
    
    // Get all forms (excluding drafts)
    const allForms = await prismaService.findManyForms(filter);
    
    // Filter out drafts
    const submittedForms = allForms.filter(f => f.status !== 'DRAFT');
    
    // Apply status filter if provided
    let filteredForms = submittedForms;
    if (filters?.status) {
        filteredForms = submittedForms.filter(f => f.status === filters.status);
    }
    
    // Include products for each form
    const formsWithProducts = await Promise.all(
        filteredForms.map(async (form) => {
            const products = await prismaService.findFormProducts(form.id);
            return {
                ...form,
                products
            };
        })
    );
    
    return formsWithProducts;
};

export type ApprovedFormRelation = 'requester' | 'approver' | 'both';

/**
 * Approved forms for a user: submitted by them and/or approved by them at any level.
 *
 * A Service Admin additionally sees every approved *service* return, whoever raised it — that list
 * is where they enter the SAP sales order number, and they are usually neither its requester nor one
 * of its approvers. Their own requests keep their real relation; the extra ones are marked
 * `approver`, since that is how the UI reads "someone else's request I have business with".
 */
export const getApprovedRequestsForUser = async (
    userId: string,
    options?: { isServiceAdmin?: boolean }
): Promise<Array<Record<string, unknown> & { approvedRelation: ApprovedFormRelation }>> => {
    const own = await prismaService.findApprovedFormsForUser(userId);

    let forms: Array<Record<string, any> & { id: string; approvedRelation: ApprovedFormRelation }> = own;

    /*
     * Approved returns raised in this person's name by somebody else: they were mailed the outcome,
     * so they can see it. Marked 'both' where they also approved it, which the 'mine' tab and the
     * compact row already read as their own.
     */
    const approvedReturns = await prismaService.findManyForms({ formType: 'RETURN' as any, status: 'APPROVED' as any });
    if (approvedReturns.length > 0) {
        const index = await loadNamedRequesterIndex();
        const namedIds = new Set(
            approvedReturns
                .filter((f) => resolveNamedRequesterFrom(f, index)?.userId === userId)
                .map((f) => f.id)
        );
        if (namedIds.size > 0) {
            const seenIds = new Set(forms.map((f) => f.id));
            forms = forms.map((f) =>
                namedIds.has(f.id) && f.approvedRelation === 'approver' ? { ...f, approvedRelation: 'both' as const } : f
            );
            const added = approvedReturns
                .filter((f) => namedIds.has(f.id) && !seenIds.has(f.id))
                .map((f) => ({ ...f, approvedRelation: 'requester' as ApprovedFormRelation }));
            forms = [...forms, ...added];
        }
    }

    if (options?.isServiceAdmin) {
        const seen = new Set(forms.map((f) => f.id));
        const serviceReturns = (await prismaService.findApprovedServiceReturns())
            .filter((f) => !seen.has(f.id))
            .map((f) => ({ ...f, approvedRelation: 'approver' as ApprovedFormRelation }));
        forms = [...forms, ...serviceReturns];
    }

    const formsWithProducts = await Promise.all(
        forms.map(async (form) => {
            const products = await prismaService.findFormProducts(form.id);
            // Only a return can have been corrected at review, so don't query for the rest.
            const reviewEdits =
                form.formType === 'RETURN' ? await listReviewEdits(form.id) : [];
            return {
                ...form,
                products,
                reviewEdits,
            };
        })
    );

    return formsWithProducts;
};

/**
 * Update status (and optional fields) of a request by form id
 * Now updates the SalesForm table directly
 */
export const updateRequestStatus = async (
    formId: string,
    status: 'PENDING_APPROVAL' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
    patch?: Record<string, any>
): Promise<void> => {
    await prismaService.updateForm(formId, {
        status: status as any,
        ...patch
    });
};
