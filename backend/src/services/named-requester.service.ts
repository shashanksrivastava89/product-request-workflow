/**
 * Who a return's Requester is — the one definition, shared by the mail and by access.
 *
 * A return names its Requester from a dropdown: the sales rep the request belongs to. That is often
 * not the person who pressed Submit (`form.requesterId`) — a manager raising a request for a rep is
 * the ordinary case in Japan, and on UAT eight of the eight latest returns were raised that way.
 *
 * Round 33 started mailing the named Requester, which was right, but the Pending list, the Approved
 * list and the read check still recognised only the submitter. So a rep was mailed "Request
 * Rejected", followed the link, and could neither see the request, open it, nor copy it to put it
 * right. The rule this module exists to enforce is simply: **whoever a "requester" mail is addressed
 * to can open what it links to.** Both sides call the same resolver, so they cannot drift apart.
 *
 * Resolution, most specific first: the `requesters` directory row, which carries an explicit link to
 * a user account and whose sales rep code separates two people who share a name; then a plain name
 * match over `users`. Exactly one person is ever resolved per form, so this widens read access to
 * the mail's recipient and nobody else. There is deliberately no fallback to the submitter here —
 * the submitter already has access in their own right, and the mail adds its own fallback.
 */
import { PrismaClient } from '@prisma/client';
import { prismaService } from './prisma.service';
import type { SalesForm, User } from './db.service';

const prisma = new PrismaClient();

/** Normalize name for comparison: fullwidth space (U+3000) and other unicode spaces → single ASCII space, trim, lowercase */
export function normalizeNameForMatch(name: string): string {
    return (name || '')
        .replace(/\s+/g, ' ')
        .replace(/　/g, ' ')
        .trim()
        .toLowerCase();
}

/** Legacy CDG-only login suffix from create-cdg-users.ts — canonical email is without _cdg */
function isCdgDuplicateEmail(email: string): boolean {
    return /_cdg@/i.test(email || '');
}

/** Prefer active canonical account when multiple users share the same display name */
function rankUserForNameLookup(user: User): number {
    let score = 0;
    if (user.isActive !== false) score += 100;
    if (!isCdgDuplicateEmail(user.email)) score += 50;
    if (user.salesRepCode) score += 10;
    if (user.businessUnit === 'CDG/LSG') score += 5;
    return score;
}

/** The best account for a display name, from an already-loaded user list. */
function pickUserByName(users: User[], name: string): User | null {
    const needle = normalizeNameForMatch(name);
    if (!needle) return null;
    const matches = users.filter((u) => normalizeNameForMatch(u.name || '') === needle);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches.reduce((best, u) => (rankUserForNameLookup(u) > rankUserForNameLookup(best) ? u : best));
}

/**
 * Helper function to find user by name (case-insensitive, ignores fullwidth vs normal space).
 * When duplicate names exist (e.g. Geoffrey_Bhattacharyya@ vs Geoffrey_Bhattacharyya_cdg@), prefers the canonical account.
 */
export const findUserByName = async (name: string): Promise<User | null> => {
    if (!normalizeNameForMatch(name)) return null;
    return pickUserByName(await prismaService.findManyUsers(), name);
};

export type NamedRequester = {
    userId: string;
    email: string;
    resolvedBy: 'requesterRow' | 'userName';
};

/**
 * What resolving needs, loaded once.
 *
 * A list resolves many forms; loading the directory and the users once and resolving in memory keeps
 * that at two queries instead of two per form.
 */
export type NamedRequesterIndex = {
    rows: Array<{ name: string; code: string | null; userId: string | null }>;
    users: User[];
};

export async function loadNamedRequesterIndex(): Promise<NamedRequesterIndex> {
    const [rows, users] = await Promise.all([
        // Normalisation (U+3000, case) cannot be expressed in the query, so filter in memory over the
        // rows that carry a user link at all.
        prisma.requester.findMany({
            where: { isActive: true, NOT: { userId: null } },
            select: { name: true, code: true, userId: true },
        }),
        prismaService.findManyUsers(),
    ]);
    return { rows, users };
}

/** Resolve a form's named Requester against preloaded data. Null when the name matches nobody. */
export function resolveNamedRequesterFrom(
    form: Pick<SalesForm, 'requesterName' | 'salesRepCodeSap'>,
    index: NamedRequesterIndex
): NamedRequester | null {
    const named = String(form.requesterName ?? '').trim();
    if (!named) return null;

    const key = normalizeNameForMatch(named);
    const code = String(form.salesRepCodeSap ?? '').trim();
    const sameName = index.rows.filter((r) => normalizeNameForMatch(r.name) === key);
    // One person legitimately holds several requester rows, one per team; the sales rep code on the
    // form says which of them raised this request.
    const row = (code ? sameName.find((r) => String(r.code ?? '').trim() === code) : undefined) ?? sameName[0];
    if (row?.userId) {
        const user = index.users.find((u) => u.id === row.userId);
        const email = (user?.email ?? '').trim();
        if (user && email) return { userId: user.id, email, resolvedBy: 'requesterRow' };
    }

    const byName = pickUserByName(index.users, named);
    const email = (byName?.email ?? '').trim();
    if (byName && email) return { userId: byName.id, email, resolvedBy: 'userName' };
    return null;
}

/** Resolve one form's named Requester. Re-resolved every call, so a corrected name takes effect. */
export async function resolveNamedRequester(
    form: Pick<SalesForm, 'requesterName' | 'salesRepCodeSap'>
): Promise<NamedRequester | null> {
    return resolveNamedRequesterFrom(form, await loadNamedRequesterIndex());
}
