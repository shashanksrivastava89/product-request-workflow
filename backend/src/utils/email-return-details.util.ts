/**
 * The return-only fields every return email shows, and what to call them.
 *
 * Its own module because two mail renderers need the same wording and cannot import each other:
 * `email.templates.ts` already imports the order-taking print body, so anything shared has to sit
 * below both. Before this, the order-taking handoff carried none of these fields at all - the one
 * mail whose job is "here is what to key into SAP" did not say which SAP document type to raise.
 */

import { roundYen } from './money.util';

export type EmailReturnFields = {
  formType?: string;
  returnType?: string;
  isService?: boolean;
  originalOrderNumber?: string;
  invoiceDate?: string;
  /**
   * Every invoice date on the request, first one included.
   *
   * A standing order (定期予約) is price-adjusted across several billing periods and carries one
   * date per period, stored in `form_invoice_dates`. The mails only ever showed `invoiceDate`, which
   * is `invoiceDates[0]` - so the desk was told to raise a credit memo against one period out of N.
   * Present but of length 1 for an ordinary return, where it renders exactly as before.
   */
  invoiceDates?: string[];
  isStandingOrder?: boolean;
  /**
   * The catalogue the product lines came from: CDG or LSG.
   *
   * Named for its job rather than 'businessUnit', because the order-taking mail's business
   * unit is the DESK it routed to - SERVICE for a service return - which is not a catalogue.
   */
  productCodeUnit?: string | null;
  quoteRefNo?: string;
  orderReason?: string;
  justification?: string;
  dairitenContactName?: string;
  dairitenContactEmail?: string;
};

export type EmailReturnLabels = {
  sectionHeading: string;
  returnType: string;
  orderReason: string;
  originalOrderNumber: string;
  invoiceDate: string;
  /** Used in place of `invoiceDate` when a standing order carries more than one. */
  invoiceDates: string;
  quoteRefNo: string;
  serviceRelated: string;
  serviceYes: string;
  serviceNo: string;
  dairitenContact: string;
  /**
   * The contact's email, on its own row.
   *
   * It used to be glued to the name as "Dealer contact: NAME - address". Damian Diggin asked for it
   * as a field of its own so Customer Service can reply from the mail without opening the app.
   */
  dairitenContactEmail: string;
  justification: string;
};

export const RETURN_LABELS_EN: EmailReturnLabels = {
  sectionHeading: 'Return details',
  returnType: 'Return type:',
  orderReason: 'Order reason:',
  originalOrderNumber: 'Original order no.:',
  invoiceDate: 'Invoice date:',
  invoiceDates: 'Invoice dates:',
  quoteRefNo: 'Quote ref. no.:',
  // Corlett Siobhan, 25 Sep 2026: the field is named so it cannot be mistaken - the same name the form uses.
  serviceRelated: 'Service - TS有償作業WOと保守:',
  serviceYes: 'Yes',
  serviceNo: 'No',
  dairitenContact: 'Dealer contact:',
  dairitenContactEmail: 'Contact email:',
  justification: 'Justification:',
};

export const RETURN_LABELS_JP: EmailReturnLabels = {
  sectionHeading: '返品内容',
  returnType: '返品タイプ:',
  orderReason: '返品理由:',
  originalOrderNumber: '元の受注番号:',
  invoiceDate: '請求日:',
  invoiceDates: '請求日:',
  quoteRefNo: '見積番号:',
  serviceRelated: 'サービス - TS有償作業WOと保守:',
  serviceYes: 'はい',
  serviceNo: 'いいえ',
  dairitenContact: '代理店担当者:',
  dairitenContactEmail: 'ご担当者様のメールアドレス:',
  justification: '理由:',
};

/** True for a return, whatever case the caller stored the form type in. */
export function isReturnMail(formType?: string | null): boolean {
  return String(formType ?? '').trim().toUpperCase() === 'RETURN';
}

/**
 * The invoice-date row a return mail should show: the label, and the dates joined.
 *
 * One date behaves exactly as it always did, so an ordinary return's mail is unchanged to the byte.
 * More than one - only a standing order has more - lists them all under the plural label.
 */
export function emailInvoiceDateRow(
  data: EmailReturnFields,
  labels: EmailReturnLabels
): { label: string; value: string } | null {
  const all = (data.invoiceDates ?? []).map((d) => String(d ?? '').trim()).filter(Boolean);
  if (all.length > 1) return { label: labels.invoiceDates, value: all.join(', ') };
  const one = all[0] || String(data.invoiceDate ?? '').trim();
  return one ? { label: labels.invoiceDate, value: one } : null;
}

/**
 * The product codes a mail should print, for the unit the request was raised in.
 *
 * **CDG always shows both codes; LSG shows only the local product code**, because LSG materials have
 * no SAP number (Vidhi Parsons, 17 Sep). This used to be guessed from `sapCode !== productCode`,
 * which is wrong for CDG far more often than anyone realised: the product importer copies the local
 * code into `sapCode` for any sheet without a SAP column, and that is true of 4,192 of 5,776 CDG
 * catalogue rows - so 73% of CDG products had their SAP number hidden in every mail.
 *
 * A CDG line whose SAP code merely repeats the local one prints a dash: a dash says "we do not have
 * this number", which is true and fixable, where repeating the local code presents a number that is
 * not a SAP number at all.
 */
export function emailProductCodeParts(
  product: { productCode?: unknown; sapCode?: unknown },
  unit: string | null | undefined
): { code: string; sap: string; sapMissing: boolean } {
  const code = String(product.productCode ?? '').trim();
  const raw = String(product.sapCode ?? '').trim();
  const real = raw && raw !== code ? raw : '';
  const isLsg = String(unit ?? '').trim().toUpperCase() === 'LSG';
  if (isLsg) return { code, sap: '', sapMissing: false };
  // No unit on the payload (an older caller): keep the previous behaviour rather than inventing one.
  if (unit == null || String(unit).trim() === '') return { code, sap: real, sapMissing: false };
  return { code, sap: real, sapMissing: !real };
}

/**
 * Does this product line print unit prices? Only a whole quantity of 2 or more.
 *
 * Damian Diggin, 30 Sep 2026: show the return and re-bill unit prices "when the qty is more than
 * 2EA", and "only Total returns / Total re-bills when the qty is 1EA only" - at qty 1 the unit is
 * the total. A fractional quantity (service hours: 0.5, 1.5) shows totals only too, as Shashank
 * Srivastava decided the same day: a price per hour beside a total for 1.5 hours invites a sum that
 * does not come out in whole yen.
 */
export function lineShowsUnitPrices(quantity: unknown): boolean {
  const q = Number(quantity);
  return Number.isInteger(q) && q >= 2;
}

/**
 * What a line total comes to per unit.
 *
 * The standard price when the total is simply quantity x standard price - exact, whatever rounding
 * the total went through. Otherwise the total over the quantity: an amount the requester overwrote
 * is a price for the whole line, and this is what it means per unit.
 */
export function returnLineUnitPrice(total: number, quantity: unknown, standardUnit?: unknown): number {
  const q = Number(quantity);
  if (!(q > 0)) return total;
  const std = Number(standardUnit);
  if (std > 0 && roundYen(q * std) === total) return std;
  return total / q;
}

/** A unit price in yen: whole when it divides evenly, otherwise to the sen (¥10,000 / 3 = ¥3,333.33). */
export function formatUnitYen(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 1e-9;
  return whole
    ? `¥${Math.round(amount).toLocaleString('ja-JP')}`
    : `¥${amount.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Column headings for a return's amounts, in the words the wizard uses ("Total Returns" /
 * 返品合計), so the figure a requester typed carries the same name in every mail about it.
 */
export const RETURN_AMOUNT_HEADINGS = {
  en: {
    returnUnit: 'Return unit price',
    rebillUnit: 'Re-bill unit price',
    returnTotal: 'Total returns',
    rebillTotal: 'Total re-bills',
  },
  jp: {
    returnUnit: '返品単価',
    rebillUnit: '再請求単価',
    returnTotal: '返品合計',
    rebillTotal: '再請求合計',
  },
} as const;
