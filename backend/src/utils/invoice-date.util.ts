/**
 * An invoice date is when the original sales order was invoiced, so it cannot be in the future -
 * Shashank Srivastava, 1 Oct 2026. Every invoice date on a return, a standing order's extra ones
 * included. Mirrored in src/utils/returnInvoiceDate.ts.
 */
import { AppError } from '../middleware/error.middleware';

/**
 * Today in Japan, as YYYY-MM-DD: the business day an invoice date is judged against.
 *
 * Japan's day, not the machine's: UAT runs in us-west-2, sixteen hours behind Tokyo, so judging by
 * the server's clock would refuse a Japanese user's "today" every morning; and a reviewer elsewhere
 * would see a different cut-off from the requester. Both sides use the same rule.
 */
export function todayInJapan(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The invoice dates given that have not happened yet. YYYY-MM-DD compares correctly as text. */
export function futureInvoiceDates(
    dates: ReadonlyArray<string | null | undefined>,
    today: string = todayInJapan()
): string[] {
    return dates
        .map((d) => String(d ?? '').trim().slice(0, 10))
        .filter((d) => d !== '' && d > today);
}

/** Refuse a return whose invoice dates include one in the future. */
export function assertNoFutureInvoiceDates(
    dates: ReadonlyArray<string | null | undefined>,
    today: string = todayInJapan()
): void {
    const future = [...new Set(futureInvoiceDates(dates, today))];
    if (future.length > 0) {
        throw new AppError(
            `The invoice date of the original sales order cannot be in the future (${future.join(', ')}; today is ${today}).`,
            400
        );
    }
}
