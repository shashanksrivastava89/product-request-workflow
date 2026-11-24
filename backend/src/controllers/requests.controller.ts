import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { getAllRequests, getApprovedRequestsForUser } from '../services/requests.service';
import { loadNamedRequesterIndex, resolveNamedRequesterFrom } from '../services/named-requester.service';
import { hasServiceAdminPrivileges, isCustomerSupportRole } from '../utils/auth-roles.util';
import { isServiceCaseForServiceTeam } from '../utils/form-access.util';
import { prismaService } from '../services/prisma.service';

/**
 * Attach the account that submitted each request, as `requester`.
 *
 * `requesterId` is the signed-in account that filled the form in; `requesterName` is the person
 * chosen in the wizard's requester dropdown. A manager raising a request for a rep makes them
 * differ, and Corlett asked to see which - 「本当にこのこれを入力したのは誰っていうのを逆に知りたい」.
 * The list payload only ever carried the id, so the name was unavailable to show.
 *
 * Mirrors what the approvals inbox already does per row (approvals.controller), but resolves each
 * distinct account once rather than per request.
 */
async function withSubmitter<T extends { requesterId?: string }>(rows: T[]): Promise<T[]> {
    const ids = [...new Set(rows.map((r) => r.requesterId).filter((v): v is string => Boolean(v)))];
    const byId = new Map<string, { id: string; name: string; email: string }>();
    await Promise.all(
        ids.map(async (id) => {
            const u = await prismaService.findUserById(id);
            if (u) byId.set(id, { id: u.id, name: u.name, email: u.email });
        })
    );
    return rows.map((r) => ({ ...r, requester: r.requesterId ? byId.get(r.requesterId) ?? null : null }));
}

export const getPendingRequests = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) throw new AppError('Unauthorized', 401);

        // Optionally filter by status
        const statusFilter = (req.query.status as string) || 'PENDING_APPROVAL';
        
        // Build filter
        const filters: any = {};
        if (statusFilter === 'PENDING_APPROVAL') {
            // For PENDING_APPROVAL, we'll get all and filter in memory
            // to include PENDING_APPROVAL, IN_PROGRESS, and REJECTED
        } else {
            filters.status = statusFilter;
        }
        
        // Load all non-draft forms
        const all = await getAllRequests(filters);
        
        // Handle multi-status filtering (pending includes in-progress)
        const requests = statusFilter === 'PENDING_APPROVAL'
            ? all.filter(r => r.status === 'PENDING_APPROVAL' || r.status === 'IN_PROGRESS' || r.status === 'REJECTED')
            : all.filter(r => r.status === statusFilter);

        let visibleRequests = requests;
        if (isCustomerSupportRole(req.user?.role)) {
            if (statusFilter !== 'APPROVED') {
                visibleRequests = [];
            }
        } else if (statusFilter === 'APPROVED') {
            visibleRequests = await getApprovedRequestsForUser(userId, {
                isServiceAdmin: hasServiceAdminPrivileges(req.user?.role, req.user?.isServiceAdmin),
            });
        } else {
            const own = requests
                .filter((r) => r.requesterId === userId)
                .map((r) => ({ ...r, pendingRelation: 'requester' as const }));

            /*
             * Returns raised in this person's name by somebody else.
             *
             * They are the one being mailed about it - submitted, each step, rejected - so the link
             * in those mails has to land somewhere they can see it. Same resolver as the mail, so
             * nobody gains sight of a request they were not told about.
             */
            const ownIds = new Set(own.map((r) => r.id));
            const namedCandidates = requests.filter((r) => !ownIds.has(r.id) && r.formType === 'RETURN');
            let named: typeof own = [];
            if (namedCandidates.length > 0) {
                const index = await loadNamedRequesterIndex();
                named = namedCandidates
                    .filter((r) => resolveNamedRequesterFrom(r, index)?.userId === userId)
                    .map((r) => ({ ...r, pendingRelation: 'requester' as const }));
            }

            /*
             * Every Service return that is not yet approved, at whatever stage, for the whole
             * Service Admin team - Corlett Siobhan, 25 Sep 2026: *"grant access to all service admin
             * members (Nia Hargreaves & Baljiwan Woodward & Siobhan Corlett) to view all Service cases (Service =
             * Yes) at any stages."*
             *
             * The list used to carry only the ones already reviewed and sent on, so what a team
             * member saw depended on what they had personally touched: Corlett, who had raised and
             * sent back requests herself, saw three where Nia saw one. Now a case at its review
             * step, with the approvers, rejected at any step, or reopened and being corrected is on
             * every team member's list alike; approved ones are on the approved list, as before.
             */
            const isServiceTeam = hasServiceAdminPrivileges(req.user?.role, req.user?.isServiceAdmin);
            let serviceCases: Array<Record<string, unknown>> = [];
            if (isServiceTeam) {
                const mine = new Set([...own, ...named].map((r) => r.id));
                serviceCases = requests
                    .filter((r) => !mine.has(r.id) && isServiceCaseForServiceTeam(r))
                    .map((c) => ({ ...c, pendingRelation: 'reviewer' as const }));
            }

            /*
             * A return that was reopened and is being corrected. It is a DRAFT again, and every list
             * hides drafts, but this one has been submitted before - it still carries its reference
             * number - so it stays on its owner's list rather than vanishing the moment they leave
             * the form half-corrected. A Service one also stays in the service team's sight: it is
             * one of their cases, only at the correcting stage.
             */
            const reopenedDrafts = (
                await prismaService.findManyForms(
                    isServiceTeam
                        ? { status: 'DRAFT' as any, formType: 'RETURN' as any }
                        : { requesterId: userId, status: 'DRAFT' as any, formType: 'RETURN' as any }
                )
            ).filter(
                (f) =>
                    Boolean(f.referenceNumber) &&
                    (f.requesterId === userId || (isServiceTeam && isServiceCaseForServiceTeam(f)))
            );
            const reopened = await Promise.all(
                reopenedDrafts.map(async (f) => ({
                    ...f,
                    products: await prismaService.findFormProducts(f.id),
                    pendingRelation: f.requesterId === userId ? ('requester' as const) : ('reviewer' as const),
                }))
            );

            visibleRequests = [...own, ...named, ...serviceCases, ...reopened] as typeof requests;
        }

        res.json({ requests: await withSubmitter(visibleRequests) });
    } catch (error) {
        next(error);
    }
};


