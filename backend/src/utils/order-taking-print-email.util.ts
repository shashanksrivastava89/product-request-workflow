/**
 * Order-taking email body — mirrors frontend FormPrintView layout (table-based, email-safe HTML).
 */

import {
  formatApprovalAssigneeLine,
  formatApprovalDecisionLine,
} from './approval-display.util';
import { formTypeDisplayLabel } from '../services/reference.service';
import { returnOrderReasonLabel, returnTypeLabel } from '../constants/return-form.constants';
import {
  RETURN_LABELS_EN,
  emailInvoiceDateRow,
  isReturnMail,
  type EmailReturnFields,
} from './email-return-details.util';
import { applyZintDeliveryDisplayFields } from './zint-form-display.util';
import { formatQuantity } from './money.util';
import {
  RETURN_AMOUNT_HEADINGS,
  formatUnitYen,
  lineShowsUnitPrices,
  returnLineUnitPrice,
} from './email-return-details.util';

/** Primary UI font for order-taking mail (Windows / Outlook). */
export const ORDER_TAKING_EMAIL_FONT_FAMILY =
  "'Meiryo UI', Meiryo, 'メイリオ', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif";

const EMAIL_FONT_FAMILY = ORDER_TAKING_EMAIL_FONT_FAMILY;

const ORDER_TAKING_MSO_FONT_BLOCK = `<!--[if mso]>
<style type="text/css">
  body, table, td, th, p, span, div {
    font-family: Meiryo UI, Meiryo, sans-serif !important;
  }
</style>
<![endif]-->`;

const ORDER_TAKING_TABLE_WRAP = `border-collapse: collapse; font-family: ${EMAIL_FONT_FAMILY};`;

const formatYen = (amount: number) => `¥${amount.toLocaleString('ja-JP', { minimumFractionDigits: 0 })}`;

/*
 * A return handoff wears the same restrained purple as the other return mails, so the order-taking
 * desk can tell a credit memo from a sample order before reading a word. Rules and one header fill
 * only - chosen to read on white and on near-black, because the classic Outlook client renders
 * through Word with no media queries while new Outlook may invert a light palette for dark mode.
 */
type PrintAccent = { rule: string; grid: string; headFill: string };
const PRINT_ACCENT_NEUTRAL: PrintAccent = { rule: '#000', grid: '#ccc', headFill: '#f3f4f6' };
const PRINT_ACCENT_RETURN: PrintAccent = { rule: '#8b6fc9', grid: '#c9bce6', headFill: '#f2eefb' };

const EMAIL_FIELD_BILINGUAL = {
  attention: {
    jp: 'ご担当者部署及びご氏名（任意）',
  },
  freeSample: {
    jp: '販促／不良交換／装置設置のため、など必ず理由を入力してください。（必須）',
  },
} as const;

const PERSONAL_SHIP_TO_TENNOZ_CODE = 'TENNOZ_HO';
const PERSONAL_SHIP_TO_TENNOZ_NAME = 'TENNOZ HEAD OFFICE';

const PRINT_MAIL_FONT_SIZE = '10px';
const PRINT_MAIL_TEXT = `font-family: ${EMAIL_FONT_FAMILY}; font-size: ${PRINT_MAIL_FONT_SIZE}; color: #111; line-height: 1.35; font-weight: 400;`;
const PRINT_TABLE_TEXT = `font-family: ${EMAIL_FONT_FAMILY}; font-size: ${PRINT_MAIL_FONT_SIZE}; color: #111; line-height: 1.2; font-weight: 400;`;
const PRINT_SUBTITLE = `font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #374151; margin: 0 0 4px 0; font-family: ${EMAIL_FONT_FAMILY};`;
const printSectionTitleBase = (a: PrintAccent) =>
  `padding-bottom: 4px; border-bottom: 1px solid ${a.rule}; font-size: 11px; font-weight: 700; color: #111; font-family: ${EMAIL_FONT_FAMILY};`;
const printSectionTitle = (a: PrintAccent) => `margin: 10px 0 4px 0; ${printSectionTitleBase(a)}`;
const printSectionTitleFollow = (a: PrintAccent) => `margin: 4px 0 4px 0; ${printSectionTitleBase(a)}`;
const printTh = (a: PrintAccent) =>
  `padding: 2px 4px; border: 1px solid ${a.grid}; background-color: ${a.headFill}; text-align: left; vertical-align: top; ${PRINT_TABLE_TEXT} font-weight: 700;`;
const printTd = (a: PrintAccent) =>
  `padding: 2px 4px; border: 1px solid ${a.grid}; vertical-align: top; ${PRINT_TABLE_TEXT}`;
const printTdRight = (a: PrintAccent) => `${printTd(a)} text-align: right;`;


function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayCell(value: unknown): string {
  const s = String(value ?? '').trim();
  return s ? escapeHtml(s) : '—';
}

function formatDateOnly(date: Date | string): string {
  return new Date(date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatOrderTakingCurrency(): string {
  return '¥0';
}

function formatSalesRepCodeForPublicDisplay(code: string | null | undefined): string {
  const c = String(code ?? '').trim();
  return /^\d{5,10}$/.test(c) ? c : '';
}

function formatRequesterWithSalesRepCode(
  name: string | null | undefined,
  code: string | null | undefined
): string {
  const n = String(name ?? '').trim();
  if (!n) return '';
  const c = formatSalesRepCodeForPublicDisplay(code);
  return c ? `${n} (${c})` : n;
}

function formatShipToForEmail(name?: string | null, code?: string | null): string {
  const c = String(code ?? '').trim();
  const n = String(name ?? '').trim();
  const displayName = n || (c === PERSONAL_SHIP_TO_TENNOZ_CODE ? PERSONAL_SHIP_TO_TENNOZ_NAME : '');
  if (!displayName && !c) return '—';
  const nameHtml = escapeHtml(displayName || '—');
  if (!c || c === PERSONAL_SHIP_TO_TENNOZ_CODE) return nameHtml;
  return `${nameHtml} (${escapeHtml(c)})`;
}

function formatDeliveryDate(expected?: string | null): string {
  if (expected === 'ASAP') return 'ASAP';
  if (expected && String(expected).trim().length >= 10) {
    return formatDateOnly(expected);
  }
  return '—';
}

function lv(label: string, valueHtml: string): string {
  return `<div style="margin: 0 0 2px 0; ${PRINT_MAIL_TEXT}"><span style="font-weight: 700;">${label}</span> ${valueHtml}</div>`;
}

export type OrderTakingPrintApprovalRow = {
  level: number;
  role: string;
  approverName: string;
  actualActorUserId?: string | null;
  actualActorName?: string | null;
  status: string;
  decidedAt?: string | Date | null;
  notifiedAt?: string | Date | null;
  comments?: string | null;
};

export type OrderTakingPrintEmailData = EmailReturnFields & {
  referenceNumber?: string;
  formId: string;
  formType: string;
  businessUnit: string;
  requesterName: string;
  requesterDisplay?: string;
  requestDate: Date | string;
  approvedAt: Date | string;
  purpose?: string | null;
  requesterGroup?: string | null;
  salesRepCodeSap?: string | null;
  deliveryMode?: string | null;
  soldToName?: string | null;
  soldToCode?: string | null;
  shipToName?: string | null;
  shipToCode?: string | null;
  attentionTo?: string | null;
  endUserName?: string | null;
  endUserCode?: string | null;
  expectedDeliveryDate?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  address?: string | null;
  phone?: string | null;
  commentsForApproval?: string | null;
  freeDescription?: string | null;
  products?: unknown[];
  approvals?: OrderTakingPrintApprovalRow[];
  /** Everyone this copy went to, resolved at send time. See renderRecipientsSection. */
  recipientsTo?: string[];
  recipientsCc?: string[];
};

function renderPrintEmailHeader(data: OrderTakingPrintEmailData, accent: PrintAccent): string {
  const ref = data.referenceNumber || data.formId.slice(0, 8);
  /*
   * A return's handoff carries no Reference row. Its reference starts with 返品(RETURN) - SAP order
   * type ZRE - which contradicts the return type the subject and Return details now name (Emi
   * Diggin, 1 Oct 2026: "the order type does not match"). The subject keeps the number itself.
   * A sample handoff is unchanged.
   */
  const referenceRow = isReturnMail(data.formType)
    ? ''
    : `
      <div style="font-size: ${PRINT_MAIL_FONT_SIZE}; color: #4b5563; font-family: ${EMAIL_FONT_FAMILY};">
        Reference: <span style="font-weight: 700; font-family: ${EMAIL_FONT_FAMILY};">${escapeHtml(ref)}</span>
      </div>`;
  return `
    <div style="margin-bottom: 10px; border-bottom: 1px solid ${accent.rule}; padding-bottom: 8px; ${PRINT_MAIL_TEXT}">
      <div style="font-size: 14px; font-weight: 700; margin: 0 0 4px 0; font-family: ${EMAIL_FONT_FAMILY};">Product Request Details</div>${referenceRow}
      <div style="font-size: ${PRINT_MAIL_FONT_SIZE}; color: #4b5563; font-family: ${EMAIL_FONT_FAMILY};">
        Status: <span style="font-weight: 700;">Approved</span>
      </div>
    </div>`;
}

function renderApplicationSummary(data: OrderTakingPrintEmailData, accent: PrintAccent): string {
  const display = applyZintDeliveryDisplayFields(data);
  /*
   * A credit memo has no delivery: the return wizard never asks for a ship-to or a delivery date, so
   * both fields could only ever print an em dash. Damian Diggin asked for them to go
   * ("these fields are blank for Credit/Customer return orders"). Sample handoffs keep them.
   */
  const isReturn = isReturnMail(data.formType);
  const soldTo =
    display.soldToName || display.soldToCode
      ? `${displayCell(display.soldToName)}${display.soldToCode ? ` (${escapeHtml(display.soldToCode)})` : ''}`
      : '—';
  const endUser =
    display.endUserName || display.endUserCode
      ? `${displayCell(display.endUserName)}${display.endUserCode ? ` (${escapeHtml(display.endUserCode)})` : ''}`
      : '—';

  const col = (subtitle: string, rows: string) => `
    <td style="width: 33%; vertical-align: top; padding: 0 8px 0 0; ${PRINT_MAIL_TEXT}">
      <div style="${PRINT_SUBTITLE}">${subtitle}</div>
      ${rows}
    </td>`;

  return `
    <div style="${printSectionTitle(accent)}">Application summary</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${ORDER_TAKING_TABLE_WRAP} margin-bottom: 0;">
      <tr>
        ${col(
          'Form',
          [
            // A return's type for Customer Service is its return type, printed under Return
            // details. 返品(RETURN) is SAP order type ZRE and only confused the desk (Damian Diggin).
            isReturn ? '' : lv('Type:', escapeHtml(formTypeDisplayLabel(data.formType))),
            lv('BU:', displayCell(data.businessUnit)),
            lv('Request date:', escapeHtml(formatDateOnly(data.requestDate))),
          ].join('')
        )}
        ${col(
          'Requester',
          [
            lv(
              'Name:',
              displayCell(
                formatRequesterWithSalesRepCode(data.requesterName, data.salesRepCodeSap)
              )
            ),
            isReturn ? '' : lv('Delivery Date:', escapeHtml(formatDeliveryDate(data.expectedDeliveryDate))),
            data.attentionTo
              ? `<div style="margin: 4px 0 2px 0; ${PRINT_MAIL_TEXT}"><div style="font-weight: 700;">${escapeHtml(EMAIL_FIELD_BILINGUAL.attention.jp)}</div><div>${escapeHtml(data.attentionTo)}</div></div>`
              : '',
            data.phone ? lv('Phone:', displayCell(data.phone)) : '',
          ].join('')
        )}
        ${col(
          'Delivery',
          [
            lv('SOLD-TO:', soldTo),
            isReturn ? '' : lv('Ship-TO:', formatShipToForEmail(data.shipToName, data.shipToCode)),
            lv('End user:', endUser),
          ].join('')
        )}
      </tr>
    </table>`;
}

function renderProductsTable(
  products: unknown[] | undefined,
  accent: PrintAccent,
  isReturn: boolean,
  /** CDG or LSG. LSG has no SAP number, so the column is dropped entirely. */
  productCodeUnit?: string | null
): string {
  if (!Array.isArray(products) || products.length === 0) return '';
  const showSap = String(productCodeUnit ?? '').trim().toUpperCase() !== 'LSG';
  /*
   * A return prints what is credited and re-billed, never the catalogue. Damian Diggin, 30 Sep: the
   * Subtotal (quantity x standard price) sat beside an overwritten Return and read as a second
   * credit; the wizard shows neither it nor the standard price. Unit prices only on a whole
   * quantity of 2 or more - see lineShowsUnitPrices - and the two columns go when no line has one.
   */
  const unitCols =
    isReturn && products.some((raw) => lineShowsUnitPrices((raw as { quantity?: unknown }).quantity));
  const H = RETURN_AMOUNT_HEADINGS.en;

  let returnTotal = 0;
  let rebillTotal = 0;
  const rows = products
    .map((raw) => {
      const p = raw as Record<string, number | string | null | undefined>;
      const name = displayCell(p.productName);
      const productCode = String(p.productCode ?? '').trim();
      const sapCode = String(p.sapCode ?? '').trim();
      const code = displayCell(productCode);
      // Only when it differs. The product import copies the local code into `sapCode` for sheets
      // with no SAP column (LSG), so repeating one number across both columns would read as an
      // error. CDG products must carry a real SAP code, so CDG always fills both.
      const sap = displayCell(sapCode && sapCode !== productCode ? sapCode : '');
      const lot = displayCell(p.lotNumber);
      const qty = escapeHtml(formatQuantity(p.quantity));
      /*
       * A sample handoff prints zeros on purpose - a free sample has no price and the desk keys the
       * order without one. A return is the opposite: the credit is the request. Sending the desk
       * "\u00a50" for a credit memo is not a formatting quirk, it is the wrong number, so a return
       * prints what was actually agreed, and the two return columns beside it.
       */
      if (isReturn) {
        const standard = p.wholesalePrice ?? p.unitPrice;
        const ret = p.returnAmount == null ? null : Number(p.returnAmount);
        const reb = p.rebillAmount == null ? null : Number(p.rebillAmount);
        if (ret != null) returnTotal += ret;
        if (reb != null) rebillTotal += reb;
        const withUnits = lineShowsUnitPrices(p.quantity);
        const unitCell = (total: number | null) =>
          withUnits && total != null ? formatUnitYen(returnLineUnitPrice(total, p.quantity, standard)) : '—';
        return `
        <tr>
          <td style="${printTd(accent)}">${name}</td>
          <td style="${printTd(accent)}">${code}</td>
          ${showSap ? `<td style="${printTd(accent)}">${sap}</td>` : ''}
          <td style="${printTd(accent)}">${lot}</td>
          <td style="${printTdRight(accent)}">${qty}</td>
          ${unitCols ? `<td style="${printTdRight(accent)}">${unitCell(ret)}</td>` : ''}
          ${unitCols ? `<td style="${printTdRight(accent)}">${unitCell(reb)}</td>` : ''}
          <td style="${printTdRight(accent)}">${ret == null ? '—' : formatYen(ret)}</td>
          <td style="${printTdRight(accent)}">${reb == null ? '—' : formatYen(reb)}</td>
        </tr>`;
      }
      const zero = formatOrderTakingCurrency();
      return `
        <tr>
          <td style="${printTd(accent)}">${name}</td>
          <td style="${printTd(accent)}">${code}</td>
          ${showSap ? `<td style="${printTd(accent)}">${sap}</td>` : ''}
          <td style="${printTd(accent)}">${lot}</td>
          <td style="${printTdRight(accent)}">${qty}</td>
          <td style="${printTdRight(accent)}">${zero}</td>
          <td style="${printTdRight(accent)}">${zero}</td>
        </tr>`;
    })
    .join('');

  const grandTotal = formatOrderTakingCurrency();

  return `
    <div style="${printSectionTitleFollow(accent)}">Products</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${ORDER_TAKING_TABLE_WRAP} margin-bottom: 8px;">
      <thead>
        <tr>
          <th style="${printTh(accent)}">Product</th>
          <th style="${printTh(accent)}">Code</th>
          ${showSap ? `<th style="${printTh(accent)}">SAP</th>` : ''}
          <th style="${printTh(accent)}">Batch / lot</th>
          <th style="${printTh(accent)}; text-align: right;">Qty</th>
          ${isReturn ? (unitCols ? `<th style="${printTh(accent)}; text-align: right;">${H.returnUnit}</th>` : '') : `<th style="${printTh(accent)}; text-align: right;">Unit</th>`}
          ${isReturn ? (unitCols ? `<th style="${printTh(accent)}; text-align: right;">${H.rebillUnit}</th>` : '') : `<th style="${printTh(accent)}; text-align: right;">Subtotal</th>`}
          ${isReturn ? `<th style="${printTh(accent)}; text-align: right;">${H.returnTotal}</th>` : ''}
          ${isReturn ? `<th style="${printTh(accent)}; text-align: right;">${H.rebillTotal}</th>` : ''}
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${
          isReturn
            ? `<tr>
          <td colspan="${(showSap ? 5 : 4) + (unitCols ? 2 : 0)}" style="${printTdRight(accent)} font-weight: 700;">Total</td>
          <td style="${printTdRight(accent)} font-weight: 700;">${formatYen(returnTotal)}</td>
          <td style="${printTdRight(accent)} font-weight: 700;">${formatYen(rebillTotal)}</td>
        </tr>`
            : `<tr>
          <td colspan="6" style="${printTdRight(accent)} font-weight: 700;">Grand total</td>
          <td style="${printTdRight(accent)} font-weight: 700;">${grandTotal}</td>
        </tr>`
        }
      </tbody>
    </table>`;
}

function renderApprovalHistory(approvals: OrderTakingPrintApprovalRow[] | undefined, accent: PrintAccent): string {
  if (!Array.isArray(approvals) || approvals.length === 0) return '';

  const sorted = [...approvals].sort((a, b) => a.level - b.level);
  const rows = sorted
    .map((app) => {
      const approver = escapeHtml(formatApprovalAssigneeLine(app));
      const decision = escapeHtml(formatApprovalDecisionLine(app));
      const comments = app.comments?.trim() ? escapeHtml(app.comments) : '—';
      return `
        <tr>
          <td style="${printTd(accent)}">${approver}</td>
          <td style="${printTd(accent)}">${decision}</td>
          <td style="${printTd(accent)}">${comments}</td>
        </tr>`;
    })
    .join('');

  return `
    <div style="${printSectionTitleFollow(accent)}">Approval history</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${ORDER_TAKING_TABLE_WRAP} margin-bottom: 8px;">
      <thead>
        <tr>
          <th style="${printTh(accent)}">Approver</th>
          <th style="${printTh(accent)}">Status / When</th>
          <th style="${printTh(accent)}">Comments</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCommentsSection(data: OrderTakingPrintEmailData, accent: PrintAccent): string {
  if (!data.commentsForApproval?.trim() && !data.freeDescription?.trim()) return '';

  return `
    <div style="${printSectionTitle(accent)}">Comments</div>
    <div style="${PRINT_MAIL_TEXT}">
      ${
        data.commentsForApproval?.trim()
          ? `<div style="margin-bottom: 6px;"><span style="font-weight: 700;">For approval:</span> <span style="white-space: pre-wrap;">${escapeHtml(data.commentsForApproval)}</span></div>`
          : ''
      }
      ${
        data.freeDescription?.trim()
          ? `<div><div style="font-weight: 700; margin-bottom: 2px;">${escapeHtml(EMAIL_FIELD_BILINGUAL.freeSample.jp)}</div><span style="white-space: pre-wrap;">${escapeHtml(data.freeDescription)}</span></div>`
          : ''
      }
    </div>`;
}

/**
 * Who received this copy.
 *
 * Vidhi Parsons, 9 Sep, on the handoff mail: *"we didn't understand who received this one, looks
 * like only me"*. Under MAIL_TEST the real To was replaced by one sink address and the Cc dropped
 * entirely, so the mail genuinely named nobody; turning the flag off restores both. This line is
 * what makes it legible even so - this mail goes to shared mailboxes, where "was this handled?"
 * cannot be answered from a client's own To field.
 */
function renderRecipientsSection(data: OrderTakingPrintEmailData, accent: PrintAccent): string {
  const to = (data.recipientsTo ?? []).filter(Boolean);
  const cc = (data.recipientsCc ?? []).filter(Boolean);
  if (to.length === 0 && cc.length === 0) return '';
  const line = (label: string, list: string[]) =>
    list.length === 0
      ? ''
      : `<div><span style="font-weight: 700;">${label}</span> ${escapeHtml(list.join(', '))}</div>`;
  return `
    <div style="${printSectionTitleFollow(accent)}">Recipients</div>
    <div style="${PRINT_MAIL_TEXT}">
      ${line('To:', to)}
      ${line('Cc:', cc)}
    </div>`;
}

/**
 * What the desk needs to raise the document, for a return.
 *
 * This mail's whole job is the SAP handoff, and it carried none of it: not the document type
 * (ZCMR / ZDMR / ZRE), not the original order it reverses, not the invoice date, not the reason.
 * Every other return mail shows this block; the one mail that acts on it did not.
 */
function renderReturnDetailsSection(data: OrderTakingPrintEmailData, accent: PrintAccent): string {
  if (!isReturnMail(data.formType)) return '';
  const L = RETURN_LABELS_EN;
  const row = (label: string, value: string) =>
    `<tr><td style="${printTd(accent)} width: 160px; font-weight: 700;">${escapeHtml(label)}</td><td style="${printTd(accent)}">${value}</td></tr>`;
  /*
   * The fields Customer Service keys the document from are shown ALWAYS, with an em dash when they
   * are blank.
   *
   * Every row here used to be conditional, so a field nobody had filled simply disappeared - which
   * is why Damian Diggin reported the invoice date, quote ref and contact address as "missing from
   * the attached approved email" when they were only absent. A dash says "nobody entered this",
   * which is a fact CS can act on; a vanished row says nothing at all.
   */
  const always = (label: string, value: unknown) => {
    const v = String(value ?? '').trim();
    return row(label, v ? escapeHtml(v) : '—');
  };
  // Every invoice date, not just the first: a standing order is credited across several billing
  // periods, and this renderer still read the scalar after the plural fix reached the other mails.
  const invoiceRow = emailInvoiceDateRow(data, L);
  const rows = [
    data.returnType ? row(L.returnType, escapeHtml(returnTypeLabel(data.returnType))) : '',
    data.orderReason ? row(L.orderReason, escapeHtml(returnOrderReasonLabel(data.orderReason))) : '',
    always(L.originalOrderNumber, data.originalOrderNumber),
    invoiceRow ? row(invoiceRow.label, escapeHtml(invoiceRow.value)) : always(L.invoiceDate, ''),
    always(L.quoteRefNo, data.quoteRefNo),
    row(L.serviceRelated, data.isService ? L.serviceYes : L.serviceNo),
    data.dairitenContactName ? row(L.dairitenContact, escapeHtml(String(data.dairitenContactName).trim())) : '',
    always(L.dairitenContactEmail, data.dairitenContactEmail),
    data.justification
      ? row(L.justification, `<span style="white-space: pre-wrap;">${escapeHtml(data.justification)}</span>`)
      : '',
  ].join('');
  return `
    <div style="${printSectionTitleFollow(accent)}">${escapeHtml(L.sectionHeading)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${ORDER_TAKING_TABLE_WRAP} margin-bottom: 8px;">
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * A way back into the request itself.
 *
 * *"Please add the related link at the bottom of the approved email, so that CS can visit the link
 * directly when we need more details in the system"* - Damian Diggin, 18 Sep. The approved list is
 * where a completed request lives, and `?expand=` opens this one already unfolded.
 */
function renderRequestLink(data: OrderTakingPrintEmailData): string {
  if (!isReturnMail(data.formType)) return '';
  const base = String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const href = `${base}/return/approved?expand=${encodeURIComponent(data.formId)}`;
  return `
    <div style="margin: 10px 0 0 0; ${PRINT_MAIL_TEXT}">
      <a href="${href}" style="color: #6d28d9; font-weight: 700; font-family: ${EMAIL_FONT_FAMILY};">View this request in the system</a>
    </div>`;
}

/** Full print-style HTML body for order-taking mailbox emails. */
export function renderOrderTakingPrintStyleMailBody(data: OrderTakingPrintEmailData): string {
  const isReturn = isReturnMail(data.formType);
  const accent = isReturn ? PRINT_ACCENT_RETURN : PRINT_ACCENT_NEUTRAL;
  return `
    ${ORDER_TAKING_MSO_FONT_BLOCK}
    <div style="width: 100%; max-width: 100%; margin: 0; padding: 12px 0; background-color: #ffffff; font-family: ${EMAIL_FONT_FAMILY}; ${PRINT_MAIL_TEXT}">
      ${renderPrintEmailHeader(data, accent)}
      ${renderApplicationSummary(data, accent)}
      ${renderReturnDetailsSection(data, accent)}
      ${renderProductsTable(data.products, accent, isReturn, data.productCodeUnit ?? data.businessUnit)}
      ${renderApprovalHistory(data.approvals, accent)}
      ${renderCommentsSection(data, accent)}
      ${renderRecipientsSection(data, accent)}${renderRequestLink(data)}
    </div>`;
}
