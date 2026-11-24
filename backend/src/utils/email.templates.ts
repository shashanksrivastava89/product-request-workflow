/**
 * Email templates for various notifications
 */

import { formTypeDisplayLabel } from '../services/reference.service';
import { returnOrderReasonLabel, returnTypeLabel } from '../constants/return-form.constants';
import {
  ORDER_TAKING_EMAIL_FONT_FAMILY,
  renderOrderTakingPrintStyleMailBody,
  type OrderTakingPrintEmailData,
} from './order-taking-print-email.util';
import { applyZintDeliveryDisplayFields } from './zint-form-display.util';
import { formatQuantity, roundYen } from './money.util';
import {
  RETURN_LABELS_EN,
  RETURN_LABELS_JP,
  emailInvoiceDateRow,
  emailProductCodeParts,
  isReturnMail,
  type EmailReturnFields,
  type EmailReturnLabels,
  RETURN_AMOUNT_HEADINGS,
  formatUnitYen,
  lineShowsUnitPrices,
  returnLineUnitPrice,
} from './email-return-details.util';

/** Same label as reference number prefix — use for all mail-visible request types. */
function mailFormTypeLabel(formType?: string | null): string {
  return formTypeDisplayLabel(formType);
}

/** Primary font for all notification emails (JP-friendly UI font on Windows / Outlook). */
const EMAIL_FONT_FAMILY =
  "'Meiryo UI', Meiryo, 'メイリオ', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif";

/** All email body text uses normal weight (no bold). */
const EMAIL_FONT_WEIGHT = 'font-weight: 400;';

const buttonStyle = `
  display: inline-block;
  padding: 12px 24px;
  background-color: #00A651;
  color: #ffffff;
  text-decoration: none;
  border-radius: 4px;
  ${EMAIL_FONT_WEIGHT}
  margin: 20px 0;
  font-family: ${EMAIL_FONT_FAMILY};
`;

const formatCurrency = (amount: number) => {
  return `¥${amount.toLocaleString('ja-JP', { minimumFractionDigits: 0 })}`;
};

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/** JP primary + EN subline (same wording as frontend `wizard.bilingual.*`). */
const EMAIL_FIELD_BILINGUAL = {
  attention: {
    jp: 'ご担当者部署及びご氏名（任意）',
    en: 'Attention to — department and contact name for sample shipment (optional)',
  },
  freeSample: {
    jp: '販促／不良交換／装置設置のため、など必ず理由を入力してください。（必須）',
    en: 'Free sample justification — e.g. sales promotion, defective exchange, equipment installation. Required.',
  },
} as const;

/** User-facing mail copy (form → request; no “sales” except sales promotion in freeSample.en). */
const EMAIL_COPY = {
  en: {
    footer: 'This is an automated message.',
    requestType: 'Request type:',
    viewRequestDetails: 'View request details',
    summary: 'Summary',
    approvalRequest: {
      title: 'New Approval Request',
      /*
       * The service review is its own event in the recipient matrix ("Pre-approval validation
       * step"), but it went out as an ordinary approval request: same template, same subject, and a
       * body telling the P&OP team that a validation step "requires your approval" at "Level 1".
       * Nobody could find it in a mailbox by searching for what it is.
       */
      reviewTitle: 'Service Review Required / サービス確認依頼',
      reviewIntro: (requester: string, formType: string) =>
        `A new ${formType} request from ${requester} needs the service team's review before it goes to the approvers. ` +
        `Please check the details below and correct them if necessary.`,
    },
    approvalNotification: {
      title: 'Approval Notification',
      approvedAtLevel: (level: number) =>
        `Your request has been approved at Level ${level}.`,
      /*
       * A return says which step cleared it, not which level number.
       *
       * On a service return the P&OP review IS level 1, so "approved at Level 2" named the first
       * approver as the second, and "Level 1" described a review as an approval. The role is what
       * the requester recognises.
       */
      approvedByStep: (role: string) => `Your request has been approved by the ${role}.`,
      reviewCompletedTitle: 'Service Review Completed',
      reviewCompleted:
        'The service team has reviewed your request. It now goes to the approvers.',
      footnote:
        'The request will proceed to the next approval level. We will notify you again once all approvals are complete.',
    },
    requestSubmitted: {
      title: 'Request Submitted',
      intro: 'Your request has been submitted and is now in the approval process.',
      footnote:
        'No action is needed from you. You will be notified as the request moves through each step.',
      resubmittedTitle: 'Request Resubmitted',
      resubmittedIntro:
        'Your corrected request has been resubmitted and is back in the approval process. It keeps its ' +
        'reference number, and its earlier submission and the reason it was rejected stay on the request.',
    },
    approvalCancelled: {
      title: 'Approval Request Cancelled',
      intro: (level: number) =>
        `The request you approved has been rejected at Level ${level}, so your approval has been cancelled.`,
      footnote: (level: number) =>
        `This request was rejected at Level ${level}, so your approval has been cancelled.`,
    },
    requestApproved: {
      title: 'Request approved',
      intro: 'Your request has been fully approved.',
      footnote:
        'Your request has completed all required approval levels and is now ready for processing.',
    },
    requestRejected: {
      title: 'Request Rejected',
      intro: (approverLine: string) => `Your request has been rejected by ${approverLine}.`,
      footnote:
        'You may create a new request with the necessary corrections or contact the approver for clarification.',
      /*
       * A return says where to go and what to press. The button used to point at /forms/<id>, a
       * page that does not exist, so a rejected requester (Derrick Borde, 24 Sep) followed it to a
       * blank screen and concluded the request could not be reopened - when a pre-filled copy was one
       * click away on the Pending list, under a label that did not say "correct and resubmit".
       */
      returnButton: 'View and resubmit / 確認して再申請',
      // Sent back at the service review: the same request can be reopened and corrected.
      returnFootnote:
        'Open the request and choose 修正して再申請 (Reopen and correct): the same request opens for you to ' +
        'correct and submit again, keeping its reference number and its history. If you would rather start ' +
        'over, you can also create a new request from a copy.',
      // Rejected by an approver: that decision stands, so the way forward is a new request.
      returnCopyFootnote:
        'An approver\'s rejection is final for this request. If it should go ahead with changes, open it and ' +
        'choose 新規申請にコピーを使用します。: a new request is created with everything filled in, for you to ' +
        'correct and submit. The rejected request stays as the record of what was rejected and why.',
    },
  },
  jp: {
    footer: 'これは自動送信メールです。',
    requestType: '申請タイプ:',
    viewRequestDetails: '申請詳細を確認',
    summary: '概要',
    approvalRequest: {
      title: '新規承認依頼',
      intro: (requester: string, formType: string) =>
        `${requester}からの${formType}申請の承認が必要です。`,
      reviewTitle: 'サービス確認依頼',
      reviewIntro: (requester: string, formType: string) =>
        `${requester}からの${formType}申請について、承認者に進む前にサービスチームの確認が必要です。`,
    },
    approvalNotification: {
      title: '承認完了通知',
      approvedAtLevel: (level: number) => `あなたの申請がレベル ${level}で承認されました。`,
      approvedByStep: (role: string) => `あなたの申請が${role}により承認されました。`,
      reviewCompletedTitle: 'サービス確認完了',
      reviewCompleted: 'サービスチームによる確認が完了しました。承認者に進みます。',
      footnote:
        '申請は次の承認レベルに進みます。すべての承認が完了次第、再度ご連絡いたします。',
    },
    requestSubmitted: {
      title: '申請受付完了',
      intro: '申請を受け付けました。承認プロセスを開始します。',
      footnote: 'お客様の対応は不要です。各ステップの進捗をお知らせします。',
    },
    approvalCancelled: {
      title: '承認依頼キャンセル',
      intro: (level: number) =>
        `あなたが承認した申請がレベル ${level}で却下されたため、承認がキャンセルされました。`,
      footnote: (level: number) =>
        `この申請はレベル ${level}で却下されたため、あなたの承認はキャンセルされました。`,
    },
    requestApproved: {
      title: '申請承認完了',
      intro: 'あなたの申請が完全に承認されました。',
      footnote: '申請はすべての必要な承認レベルを完了し、処理の準備が整いました。',
    },
    requestRejected: {
      title: '申請却下',
      intro: (approverLine: string) =>
        `あなたの申請が${approverLine}により却下されました。`,
      footnote:
        '必要な修正を行って新しい申請を作成するか、承認者に問い合わせて詳細を確認してください。',
    },
  },
} as const;

/**
 * `formatApprovalAssigneeLine` yields e.g. "NAME (super approver) on behalf of ASSIGNEE".
 * Templates must not append (step role) after that — it reads like part of the assignee name.
 */
function isSuperApproverOnBehalfLine(text: string): boolean {
  return text.includes('on behalf of');
}

/** HTML table cell: approver line plus muted role, unless the line is already complete. */
function approverNameWithRoleCell(name: string, role: string): string {
  if (isSuperApproverOnBehalfLine(name)) return name;
  return `${name} <span style="color: #666; font-size: 14px;">(${role})</span>`;
}

/** Plain inline "Name (role)" for opening sentences. */
function approverNameWithRoleInline(name: string, role: string): string {
  if (isSuperApproverOnBehalfLine(name)) return name;
  return `${name} (${role})`;
}

/** Prefer NAME (SAP code); fallback to plain requester name. */
function displayRequester(data: { requesterDisplay?: string; requesterName: string }): string {
  const s = data.requesterDisplay?.trim();
  return s ? s : data.requesterName;
}

/** ZSAM Personal ship-to: Tennoz default (TENNOZ_HO) or optional 9… directory code — keep in sync with src/utils/personalShipTo.ts */
const PERSONAL_SHIP_TO_TENNOZ_CODE = 'TENNOZ_HO';
const PERSONAL_SHIP_TO_TENNOZ_NAME = 'TENNOZ HEAD OFFICE';

function isZsamPersonalShipToForEmail(
  shipToCode?: string | null,
  formType?: string | null
): boolean {
  if (formType !== 'ZSAM') return false;
  const code = String(shipToCode ?? '').trim();
  return code.startsWith('9') || code === PERSONAL_SHIP_TO_TENNOZ_CODE;
}

/** Human-readable delivery mode for email bodies (DB stores enum values). */
function formatDeliveryModeForEmail(
  deliveryMode?: string | null,
  opts?: { shipToCode?: string | null; formType?: string | null }
): string {
  if (isZsamPersonalShipToForEmail(opts?.shipToCode, opts?.formType)) {
    return 'Personal (Tennoz Head Office)';
  }
  switch (deliveryMode) {
    case 'CHANNEL':
      return 'Channel Partner';
    case 'HEIWA':
      return 'HEIWAJIMA SERVICE CENTER';
    case 'DIRECT':
      return 'Direct Delivery';
    case 'INTERNAL':
      return 'Internal';
    default:
      return deliveryMode ? escapeHtml(deliveryMode) : '—';
  }
}

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

/** Ship-to line for emails — hides internal TENNOZ_HO code. */
function formatShipToForEmail(name?: string | null, code?: string | null): string {
  const c = String(code ?? '').trim();
  const n = String(name ?? '').trim();
  const displayName = n || (c === PERSONAL_SHIP_TO_TENNOZ_CODE ? PERSONAL_SHIP_TO_TENNOZ_NAME : '');
  if (!displayName && !c) return '—';
  const nameHtml = escapeHtml(displayName || '—');
  if (!c || c === PERSONAL_SHIP_TO_TENNOZ_CODE) return nameHtml;
  return `${nameHtml} (${escapeHtml(c)})`;
}

function productUnitPrice(p: { unitPrice?: number; wholesalePrice?: number }): number {
  return Number(p.wholesalePrice ?? p.unitPrice ?? 0);
}

function productSubtotal(p: { quantity?: number; subtotal?: number; unitPrice?: number; wholesalePrice?: number }): number {
  const sub = Number(p.subtotal);
  if (!Number.isNaN(sub) && sub >= 0) return sub;
  return roundYen(productUnitPrice(p) * Number(p.quantity ?? 0));
}

type ProductTableLabels = {
  heading: string;
  product: string;
  lot: string;
  qty: string;
  unitPrice: string;
  subtotal: string;
  /** Return lines only; appended after subtotal when the line carries the amounts. */
  returnAmount: string;
  rebillAmount: string;
  productCode: string;
  sapCode: string;
};

const PRODUCT_TABLE_LABELS_EN: ProductTableLabels = {
  heading: 'Products',
  product: 'Product',
  lot: 'Batch / Lot #',
  qty: 'Qty',
  unitPrice: 'Unit Price',
  subtotal: 'Subtotal',
  returnAmount: 'Return',
  rebillAmount: 'Re-bill',
  productCode: 'Code',
  sapCode: 'SAP',
};

const PRODUCT_TABLE_LABELS_JP: ProductTableLabels = {
  heading: '製品',
  product: '製品',
  lot: 'ロット番号',
  qty: '数量',
  unitPrice: '単価',
  subtotal: '小計',
  returnAmount: '返品合計',
  rebillAmount: '再請求合計',
  productCode: '製品コード',
  sapCode: 'SAPコード',
};

/** Compact form-detail emails: single grey panel, 11px, fixed label column. */
const COMPACT_MAIL_FONT_SIZE = '11px';
const COMPACT_MAIL_LINE_HEIGHT = 'line-height: 1.25;';
const COMPACT_MAIL_WRAPPER_STYLE = `font-family: ${EMAIL_FONT_FAMILY}; ${EMAIL_FONT_WEIGHT} font-size: ${COMPACT_MAIL_FONT_SIZE}; ${COMPACT_MAIL_LINE_HEIGHT} color: #333;`;
const COMPACT_MAIL_CONTAINER_STYLE = `max-width: 720px; margin: 0 auto; padding: 8px; background-color: #f9f9f9; font-family: ${EMAIL_FONT_FAMILY};`;
const COMPACT_MAIL_CARD_STYLE = `background-color: #ffffff; padding: 10px; font-family: ${EMAIL_FONT_FAMILY};`;
const COMPACT_MAIL_PANEL_STYLE = `background-color: #f5f5f5; padding: 6px 8px; border-radius: 4px; margin: 0; font-size: ${COMPACT_MAIL_FONT_SIZE}; font-family: ${EMAIL_FONT_FAMILY}; ${COMPACT_MAIL_LINE_HEIGHT}`;
const COMPACT_MAIL_LABEL_COL_PX = 180;
const COMPACT_MAIL_SUBHEADING_TD = `padding: 4px 0 2px 0; ${EMAIL_FONT_WEIGHT} font-size: ${COMPACT_MAIL_FONT_SIZE}; color: #111; font-family: ${EMAIL_FONT_FAMILY}; vertical-align: top;`;
const COMPACT_MAIL_LABEL_TD = `width: ${COMPACT_MAIL_LABEL_COL_PX}px; padding: 1px 8px 1px 0; ${EMAIL_FONT_WEIGHT} vertical-align: top; color: #111; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE};`;
const COMPACT_MAIL_VALUE_TD = `padding: 1px 0; ${EMAIL_FONT_WEIGHT} vertical-align: top; color: #111; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE};`;
const COMPACT_MAIL_TABLE_STYLE = `width: 100%; table-layout: fixed; border-collapse: collapse; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE};`;
const COMPACT_MAIL_TABLE_COLGROUP = `
            <colgroup>
              <col style="width: ${COMPACT_MAIL_LABEL_COL_PX}px;">
              <col>
            </colgroup>`;
/*
 * A mail's accent, which is only ever a few lines.
 *
 * Vidhi Parsons asked for the return mails to be told apart at a glance without becoming loud, so
 * this changes rules and one header fill and nothing else: the green approved / red rejected titles
 * stay exactly as they are, because they mean something.
 *
 * Chosen to survive Outlook. The classic Windows client renders through Word - no media queries, no
 * prefers-color-scheme - while new Outlook and OWA may invert a light palette for dark mode. So the
 * accent is a mid-tone purple that reads on white and on near-black, and the fill is a light tint
 * with dark text rather than a pale border that would vanish once inverted.
 */
type MailAccent = {
  /** The hairline between sections. */
  rule: string;
  /** Grid lines inside a data table. */
  grid: string;
  /** A table head's fill. */
  headFill: string;
};

const MAIL_ACCENT_NEUTRAL: MailAccent = { rule: '#ccc', grid: '#ccc', headFill: '#f3f4f6' };
const MAIL_ACCENT_RETURN: MailAccent = { rule: '#8b6fc9', grid: '#c9bce6', headFill: '#f2eefb' };

function mailAccentFor(formType?: string): MailAccent {
  return isReturnMail(formType) ? MAIL_ACCENT_RETURN : MAIL_ACCENT_NEUTRAL;
}

function mailSectionDividerRow(accent: MailAccent): string {
  return `
              <tr>
                <td colspan="2" style="padding: 0; border-top: 1px solid ${accent.rule}; line-height: 1px; font-size: 1px; height: 1px;">&nbsp;</td>
              </tr>`;
}

const COMPACT_MAIL_PRODUCT_DIVIDER_ROW = `
              <tr>
                <td colspan="2" style="padding: 0; border-top: 1px solid #ddd; line-height: 1px; font-size: 1px; height: 1px;">&nbsp;</td>
              </tr>`;
const COMPACT_MAIL_PRODUCT_DETAIL_VALUE_TD = `padding: 0 0 3px 0; ${EMAIL_FONT_WEIGHT} vertical-align: top; color: #111; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE}; word-break: break-all;`;
/*
 * A product line spans both columns, with its "Product N:" label inline.
 *
 * Vidhi Parsons asked twice for this: on 8 Sep the product detail line was moved off the 220px label
 * gutter, and on 9 Sep he pointed out that only that one line had moved - "I expect this line moving
 * to the left and take a field of this part ... we need everything looks left". The name and codes
 * row was still sitting in the narrow value column, so a product name wrapped at roughly half the
 * available width while the gutter beside it held one short label.
 */
const COMPACT_MAIL_PRODUCT_NAME_TD = `padding: 2px 0 0 0; ${EMAIL_FONT_WEIGHT} vertical-align: top; color: #111; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE};`;
const COMPACT_MAIL_PRODUCT_LABEL_SPAN = `${EMAIL_FONT_WEIGHT} color: #555; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE};`;
const COMPACT_MAIL_TITLE_STYLE = `margin: 0 0 6px 0; ${EMAIL_FONT_WEIGHT} font-size: 14px; color: #111; font-family: ${EMAIL_FONT_FAMILY};`;
const COMPACT_MAIL_INTRO_STYLE = `margin: 0 0 6px 0; ${EMAIL_FONT_WEIGHT} color: #333; font-size: ${COMPACT_MAIL_FONT_SIZE}; font-family: ${EMAIL_FONT_FAMILY}; ${COMPACT_MAIL_LINE_HEIGHT}`;
const COMPACT_MAIL_MUTED_STYLE = `color: #666; font-size: ${COMPACT_MAIL_FONT_SIZE}; margin: 8px 0 0 0; font-family: ${EMAIL_FONT_FAMILY}; ${COMPACT_MAIL_LINE_HEIGHT}`;
const COMPACT_MAIL_FOOTER_STYLE = `text-align: center; color: #999; font-size: 10px; margin: 4px 0 0 0; font-family: ${EMAIL_FONT_FAMILY};`;

type CompactMailAmountMode = 'zero' | 'actual';

function formatOrderTakingMailCurrency(): string {
  return '¥0';
}

/*
 * How a section's rows are drawn.
 *
 * `compact` is the layout the sample flows have had for months: a 180px label gutter and a value
 * beside it, all sections sharing one borderless table.
 *
 * `boxed` is the order-taking handoff's layout, which Vidhi Parsons asked the return mails to
 * match - *"all sections to have tables like the order taking SERVICE email"*. Each section is its
 * own bordered table under its own heading, so a label and its value are visibly one cell pair.
 * The borders have to be inline: Outlook's Word engine ignores stylesheets, so there is no
 * `table td { border: ... }` to lean on.
 */
type MailRowVariant = 'compact' | 'boxed';

/** Renders one label/value row. Threaded rather than global so one mail cannot restyle another. */
type MailKv = (label: string, valueHtml: string) => string;

const BOXED_LABEL_COL_PX = 170;
const boxedCellBase = (accent: MailAccent) =>
  `padding: 3px 5px; border: 1px solid ${accent.grid}; vertical-align: top; ${EMAIL_FONT_WEIGHT} color: #111; font-family: ${EMAIL_FONT_FAMILY}; font-size: ${COMPACT_MAIL_FONT_SIZE}; ${COMPACT_MAIL_LINE_HEIGHT}`;
const boxedLabelTd = (accent: MailAccent) =>
  `${boxedCellBase(accent)} width: ${BOXED_LABEL_COL_PX}px; font-weight: 700;`;
const boxedValueTd = (accent: MailAccent) => boxedCellBase(accent);

function mailKv(variant: MailRowVariant, accent: MailAccent): MailKv {
  if (variant === 'compact') {
    return (label, valueHtml) => `
              <tr>
                <td style="${COMPACT_MAIL_LABEL_TD}">${label}</td>
                <td style="${COMPACT_MAIL_VALUE_TD}">${valueHtml}</td>
              </tr>`;
  }
  const labelTd = boxedLabelTd(accent);
  const valueTd = boxedValueTd(accent);
  return (label, valueHtml) => `
              <tr>
                <td style="${labelTd}">${label}</td>
                <td style="${valueTd}">${valueHtml}</td>
              </tr>`;
}

/** The row renderer a template's own data implies: boxed for a return, compact for everything else. */
function mailKvFor(data: { formType?: string }): MailKv {
  return mailKv(isReturnMail(data.formType) ? 'boxed' : 'compact', mailAccentFor(data.formType));
}

/** A section heading, drawn like the order-taking handoff's: text over a coloured rule. */
function renderMailSectionTitle(title: string, accent: MailAccent, first: boolean): string {
  return `
            <div style="margin: ${first ? '0' : '10px'} 0 4px 0; padding-bottom: 4px; border-bottom: 1px solid ${accent.rule}; ${EMAIL_FONT_WEIGHT} font-weight: 700; font-size: ${COMPACT_MAIL_FONT_SIZE}; color: #111; font-family: ${EMAIL_FONT_FAMILY};">${title}</div>`;
}

/** One boxed section: heading, then its own table. Nothing when the section has no rows. */
function renderMailBoxedSection(
  title: string,
  rows: string,
  accent: MailAccent,
  first: boolean
): string {
  if (!rows.trim()) return '';
  return `${renderMailSectionTitle(title, accent, first)}
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse; font-family: ${EMAIL_FONT_FAMILY}; margin: 0 0 2px 0;">
              <tbody>${rows}</tbody>
            </table>`;
}

function renderCompactMailSectionHeader(title: string): string {
  return `
              <tr>
                <td colspan="2" style="${COMPACT_MAIL_SUBHEADING_TD}">${title}</td>
              </tr>`;
}

/**
 * A label cell for the rows that are Japanese-only whatever the mail's language.
 *
 * Built from a rendered row rather than a style constant so it picks up whichever variant the mail
 * is using - a bordered cell in a boxed return mail, a bare one in a compact sample mail.
 */
function emailJpOnlyLabelTd(kv: MailKv, jp: string): string {
  const row = kv(jp, '');
  const match = /<td style="([^"]*)">/.exec(row);
  return `<td style="${match ? match[1] : COMPACT_MAIL_LABEL_TD}">${jp}</td>`;
}

function renderCompactMailDeliveryRows(
  kv: MailKv,
  data: EmailDeliveryFields,
  labels: EmailDeliveryLabels = DELIVERY_LABELS_EN
): string {
  const display = applyZintDeliveryDisplayFields(data);
  const has =
    display.soldToName ||
    display.shipToName ||
    display.endUserName ||
    display.attentionTo ||
    display.deliveryMode ||
    display.expectedDeliveryDate;
  if (!has) return '';

  const deliveryDateCell =
    display.expectedDeliveryDate === 'ASAP'
      ? 'ASAP'
      : display.expectedDeliveryDate
        ? formatDate(new Date(display.expectedDeliveryDate))
        : '';

  return `
              ${display.soldToName ? kv(
                labels.soldTo,
                `${escapeHtml(display.soldToName)}${display.soldToCode ? ` (${escapeHtml(display.soldToCode)})` : ''}`
              ) : ''}
              ${display.shipToName ? kv(
                labels.shipTo,
                formatShipToForEmail(display.shipToName, display.shipToCode)
              ) : ''}
              ${display.attentionTo ? `
              <tr>
                ${emailJpOnlyLabelTd(kv, EMAIL_FIELD_BILINGUAL.attention.jp)}
                <td style="${COMPACT_MAIL_VALUE_TD}">${escapeHtml(display.attentionTo)}</td>
              </tr>` : ''}
              ${display.endUserName ? kv(
                labels.endUser,
                `${escapeHtml(display.endUserName)}${display.endUserCode ? ` (${escapeHtml(display.endUserCode)})` : ''}`
              ) : ''}
              ${display.deliveryMode ? kv(
                labels.deliveryMode,
                formatDeliveryModeForEmail(display.deliveryMode, {
                  shipToCode: display.shipToCode,
                  formType: display.formType,
                })
              ) : ''}
              ${display.expectedDeliveryDate ? kv(labels.deliveryDate, deliveryDateCell) : ''}`;
}

function renderCompactMailProductLineContent(
  p: Record<string, unknown>,
  labels: ProductTableLabels,
  /** CDG or LSG, so the codes obey the rule. Absent on a mail that does not carry it. */
  productCodeUnit?: string | null
): string {
  const name = displayCell(p.productName);

  // Both codes, each behind its own label. Vidhi Parsons, 8 Sep: "One part use Product code, the
  // other use SAP code are very mess." CDG shows both; LSG has no SAP number - see
  // emailProductCodeParts, which now gets the unit from the payload.
  const { code, sap, sapMissing } = emailProductCodeParts(p, productCodeUnit);
  const parts: string[] = [];
  if (code) parts.push(`${escapeHtml(labels.productCode)}: ${escapeHtml(code)}`);
  if (sap) parts.push(`${escapeHtml(labels.sapCode)}: ${escapeHtml(sap)}`);
  else if (sapMissing) parts.push(`${escapeHtml(labels.sapCode)}: —`);

  // Under the name, the two codes side by side on a line of their own that does not wrap - so a long
  // product name can no longer push the SAP number onto a line apart from the local code (30 Sep).
  const codeHtml = parts.length
    ? `<br><span style="${EMAIL_FONT_WEIGHT} color: #444; font-size: ${COMPACT_MAIL_FONT_SIZE}; white-space: nowrap;">${parts.join(' · ')}</span>`
    : '';
  return `<span style="${EMAIL_FONT_WEIGHT} color: #111;">${name}</span>${codeHtml}`;
}

function renderCompactMailProductDetailsLine(
  p: Record<string, unknown>,
  labels: ProductTableLabels,
  amountMode: CompactMailAmountMode
): string {
  const priced = p as { quantity?: number; subtotal?: number; unitPrice?: number; wholesalePrice?: number };
  const unitStr =
    amountMode === 'zero' ? formatOrderTakingMailCurrency() : formatCurrency(productUnitPrice(priced));
  const subStr =
    amountMode === 'zero' ? formatOrderTakingMailCurrency() : formatCurrency(productSubtotal(priced));
  const lot = displayCell(p.lotNumber);
  const qty = escapeHtml(formatQuantity(p.quantity));
  const sep = `<span style="color: #888;"> · </span>`;
  const parts = [
    `${labels.lot} ${lot}`,
    `${labels.qty} ${qty}`,
    `${labels.unitPrice} ${unitStr}`,
    `${labels.subtotal} ${subStr}`,
  ];
  // Return lines carry a credit that may differ from the catalogue subtotal — that difference is
  // the whole point of the request, so show both. Sample lines have neither field and are unchanged.
  const ret = p as { returnAmount?: number | null; rebillAmount?: number | null };
  if (amountMode !== 'zero' && ret.returnAmount != null) {
    parts.push(`${labels.returnAmount} ${formatCurrency(Number(ret.returnAmount))}`);
  }
  if (amountMode !== 'zero' && ret.rebillAmount != null) {
    parts.push(`${labels.rebillAmount} ${formatCurrency(Number(ret.rebillAmount))}`);
  }
  return parts.join(sep);
}

function compactMailProductLabel(index: number, productCount: number, lang: 'en' | 'jp'): string {
  if (productCount <= 1) return lang === 'jp' ? '製品:' : 'Product:';
  return lang === 'jp' ? `製品 ${index + 1}:` : `Product ${index + 1}:`;
}

function renderCompactMailProductTwoRowBlock(
  p: Record<string, unknown>,
  index: number,
  productCount: number,
  labels: ProductTableLabels,
  amountMode: CompactMailAmountMode,
  lang: 'en' | 'jp',
  productCodeUnit?: string | null
): string {
  const productLabel = compactMailProductLabel(index, productCount, lang);
  const divider = index > 0 ? COMPACT_MAIL_PRODUCT_DIVIDER_ROW : '';
  return `
              ${divider}
              <tr>
                <td colspan="2" style="${COMPACT_MAIL_PRODUCT_NAME_TD}"><span style="${COMPACT_MAIL_PRODUCT_LABEL_SPAN}">${productLabel}</span> ${renderCompactMailProductLineContent(p, labels, productCodeUnit)}</td>
              </tr>
              <tr>
                <td colspan="2" style="${COMPACT_MAIL_PRODUCT_DETAIL_VALUE_TD}">${renderCompactMailProductDetailsLine(p, labels, amountMode)}</td>
              </tr>`;
}

/** Cells for the return product table, sized to the compact card rather than a print page. */
const MAIL_PRODUCT_TABLE_FONT = '10px';
const mailProductTableText = (accent: MailAccent) =>
  `font-family: ${EMAIL_FONT_FAMILY}; font-size: ${MAIL_PRODUCT_TABLE_FONT}; color: #111; line-height: 1.25; font-weight: 400; border: 1px solid ${accent.grid};`;
const mailProductTh = (accent: MailAccent) =>
  `padding: 3px 4px; background-color: ${accent.headFill}; border-bottom: 2px solid ${accent.rule}; text-align: left; vertical-align: bottom; ${EMAIL_FONT_WEIGHT} font-weight: 700; ${mailProductTableText(accent)}`;
const mailProductTd = (accent: MailAccent) => `padding: 3px 4px; vertical-align: top; ${mailProductTableText(accent)}`;

/**
 * Products as a table, one row per line.
 *
 * Vidhi Parsons, 9 Sep, on the requester and rejection mails: the product block was *"more clutter
 * than before"*, and the order-taking mail's table *"looks cleaner and more structured and easier to
 * read as rows capture better attention mapping of key value pairing"*. It was six values per line
 * strung together with middots inside a two-column key/value table, so nothing lined up between one
 * product and the next and there were no column headings to read them against.
 *
 * The name cell carries the codes beneath it, which keeps the table at seven columns - the same
 * count the order-taking mail uses at full width - inside the narrower compact card.
 *
 * Returns only. The four sample flows have been in production for months and keep the block they
 * have; this is reached only when the form type is RETURN.
 */
function renderMailProductTable(
  products: unknown[],
  labels: ProductTableLabels,
  lang: 'en' | 'jp',
  accent: MailAccent,
  /** True when the table is a section of its own, false when it is a row of an enclosing table. */
  standalone: boolean,
  productCodeUnit?: string | null
): string {
  const th = mailProductTh(accent);
  const td = mailProductTd(accent);
  const tdRight = `${td} text-align: right;`;
  /*
   * What is credited and re-billed, never the catalogue - the same table the Customer Service
   * handoff prints (Damian Diggin, 30 Sep). Subtotal and the standard unit price read as a second
   * credit beside an overwritten amount. Unit prices only where a line's quantity is a whole number
   * of 2 or more (lineShowsUnitPrices); with none, the two columns go.
   */
  const unitCols = products.some((raw) => lineShowsUnitPrices((raw as { quantity?: unknown }).quantity));
  const H = RETURN_AMOUNT_HEADINGS[lang];
  const heads = [
    lang === 'jp' ? '製品' : 'Product',
    lang === 'jp' ? 'ロット' : 'Batch / lot',
    lang === 'jp' ? '数量' : 'Qty',
    ...(unitCols ? [H.returnUnit, H.rebillUnit] : []),
    H.returnTotal,
    H.rebillTotal,
  ];
  const widths = unitCols
    ? ['34%', '13%', '7%', '12%', '12%', '11%', '11%']
    : ['44%', '16%', '10%', '15%', '15%'];

  let returnTotal = 0;
  let rebillTotal = 0;
  const rows = products
    .map((raw) => {
      const p = raw as Record<string, unknown>;
      const { code, sap, sapMissing } = emailProductCodeParts(p, productCodeUnit);
      const codeParts: string[] = [];
      if (code) codeParts.push(`${escapeHtml(labels.productCode)}: ${escapeHtml(code)}`);
      if (sap) codeParts.push(`${escapeHtml(labels.sapCode)}: ${escapeHtml(sap)}`);
      else if (sapMissing) codeParts.push(`${escapeHtml(labels.sapCode)}: —`);
      const codeLine = codeParts.length
        ? `<div style="color: #555; ${EMAIL_FONT_WEIGHT} white-space: nowrap;">${codeParts.join(' · ')}</div>`
        : '';
      const priced = p as { quantity?: number; unitPrice?: number; wholesalePrice?: number };
      const ret = p as { returnAmount?: number | null; rebillAmount?: number | null };
      const retAmount = ret.returnAmount == null ? null : Number(ret.returnAmount);
      const rebAmount = ret.rebillAmount == null ? null : Number(ret.rebillAmount);
      if (retAmount != null) returnTotal += retAmount;
      if (rebAmount != null) rebillTotal += rebAmount;
      const withUnits = lineShowsUnitPrices(priced.quantity);
      const unitCell = (total: number | null) =>
        withUnits && total != null
          ? formatUnitYen(returnLineUnitPrice(total, priced.quantity, priced.wholesalePrice ?? priced.unitPrice))
          : '—';
      return `
                    <tr>
                      <td style="${td}"><div style="${EMAIL_FONT_WEIGHT} color: #111;">${displayCell(p.productName)}</div>${codeLine}</td>
                      <td style="${td}">${displayCell(p.lotNumber)}</td>
                      <td style="${tdRight}">${escapeHtml(formatQuantity(p.quantity))}</td>${unitCols ? `
                      <td style="${tdRight}">${unitCell(retAmount)}</td>
                      <td style="${tdRight}">${unitCell(rebAmount)}</td>` : ''}
                      <td style="${tdRight}">${retAmount == null ? '—' : formatCurrency(retAmount)}</td>
                      <td style="${tdRight}">${rebAmount == null ? '—' : formatCurrency(rebAmount)}</td>
                    </tr>`;
    })
    .join('');

  const totalLabel = lang === 'jp' ? '合計' : 'Total';
  const totalsRow = `
                    <tr>
                      <td colspan="${unitCols ? 5 : 3}" style="${tdRight} ${EMAIL_FONT_WEIGHT} font-weight: 700;">${totalLabel}</td>
                      <td style="${tdRight} ${EMAIL_FONT_WEIGHT} font-weight: 700;">${formatCurrency(returnTotal)}</td>
                      <td style="${tdRight} ${EMAIL_FONT_WEIGHT} font-weight: 700;">${formatCurrency(rebillTotal)}</td>
                    </tr>`;

  const table = `
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse; font-family: ${EMAIL_FONT_FAMILY}; margin: 0 0 2px 0;">
              <colgroup>${widths.map((w) => `<col style="width: ${w};">`).join('')}</colgroup>
              <thead>
                <tr>${heads.map((h) => `<th style="${th}">${escapeHtml(h)}</th>`).join('')}</tr>
              </thead>
              <tbody>${rows}${totalsRow}</tbody>
            </table>`;
  if (standalone) return table;
  return `
              <tr>
                <td colspan="2" style="padding: 2px 0 4px 0;">${table}
                </td>
              </tr>`;
}

function renderCompactMailProductsRows(
  products: unknown[] | undefined,
  lang: 'en' | 'jp',
  amountMode: CompactMailAmountMode,
  opts?: {
    asTable?: boolean;
    standalone?: boolean;
    accent?: MailAccent;
    /** CDG or LSG - the unit whose catalogue these lines came from. */
    productCodeUnit?: string | null;
  }
): string {
  if (!Array.isArray(products) || products.length === 0) return '';
  const count = products.length;
  const tableLabels = lang === 'jp' ? PRODUCT_TABLE_LABELS_JP : PRODUCT_TABLE_LABELS_EN;
  // Priced returns get the table. `zero` is the order-taking mail, which has a table of its own.
  if (opts?.asTable && amountMode !== 'zero') {
    return renderMailProductTable(
      products,
      tableLabels,
      lang,
      opts.accent ?? MAIL_ACCENT_RETURN,
      opts.standalone === true,
      opts.productCodeUnit
    );
  }
  return products
    .map((raw, index) =>
      renderCompactMailProductTwoRowBlock(
        raw as Record<string, unknown>,
        index,
        count,
        tableLabels,
        amountMode,
        lang,
        opts?.productCodeUnit
      )
    )
    .join('');
}

/**
 * The return-specific block, between the summary and the products.
 *
 * Returns are approved on facts a sample request does not have — which SAP document type is being
 * raised, what went wrong, and which original order it reverses. Without these an approver only
 * sees an amount and a product list, which is not enough to decide.
 *
 * Renders nothing unless the form is a RETURN, so all four sample types are byte-identical to
 * before. Every row is individually conditional: the wizard makes most of them mandatory, but an
 * older row or a hand-built payload must not print an empty cell.
 */
function renderCompactMailReturnRows(
  kv: MailKv,
  data: EmailReturnFields,
  labels: EmailReturnLabels
): string {
  if (!isReturnMail(data.formType)) return '';

  const typeLabel = returnTypeLabel(data.returnType);
  const reasonLabel = returnOrderReasonLabel(data.orderReason);
  const contact = [data.dairitenContactName, data.dairitenContactEmail]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' · ');

  return `
              ${typeLabel ? kv(labels.returnType, escapeHtml(typeLabel)) : ''}
              ${reasonLabel ? kv(labels.orderReason, escapeHtml(reasonLabel)) : ''}
              ${data.originalOrderNumber ? kv(
                labels.originalOrderNumber,
                escapeHtml(data.originalOrderNumber)
              ) : ''}
              ${(() => {
                // A standing order carries one date per billing period; all of them, or the single
                // one exactly as before.
                const row = emailInvoiceDateRow(data, labels);
                return row ? kv(row.label, escapeHtml(row.value)) : '';
              })()}
              ${data.quoteRefNo ? kv(labels.quoteRefNo, escapeHtml(data.quoteRefNo)) : ''}
              ${kv(
                labels.serviceRelated,
                data.isService ? labels.serviceYes : labels.serviceNo
              )}
              ${contact ? kv(labels.dairitenContact, escapeHtml(contact)) : ''}
              ${data.justification?.trim() ? kv(
                labels.justification,
                escapeHtml(data.justification)
              ) : ''}`;
}

function renderCompactMailCommentsRows(kv: MailKv, data: {
  commentsForApproval?: string;
  freeDescription?: string;
}): string {
  if (!data.commentsForApproval?.trim() && !data.freeDescription?.trim()) return '';
  return `
              ${data.commentsForApproval?.trim() ? kv(
                'Comments for Approval:',
                escapeHtml(data.commentsForApproval)
              ) : ''}
              ${data.freeDescription?.trim() ? kv(
                EMAIL_FIELD_BILINGUAL.freeSample.jp,
                escapeHtml(data.freeDescription)
              ) : ''}`;
}

/**
 * Corrections the Service Admin team made while the request sat at the review step.
 *
 * Shown before the approver's own decision because it changes what they are signing off: the review
 * window exists so a wrong service return can be fixed rather than rejected and raised again, which
 * means the figures below may not be the ones the requester typed.
 */
function renderCompactMailReviewEditRows(kv: MailKv, edits?: MailReviewEdit[]): string {
  if (!Array.isArray(edits) || edits.length === 0) return '';
  return edits
    .map((edit) => {
      const lines = edit.fieldChanges
        .map(
          (c) =>
            `${escapeHtml(c.field)}: <span style="text-decoration: line-through; color: #777;">${escapeHtml(
              c.oldValue ?? '—'
            )}</span> &rarr; <strong>${escapeHtml(c.newValue ?? '—')}</strong>`
        )
        .join('<br />');
      return kv(
        `${escapeHtml(edit.changedByName)}, ${formatDate(new Date(edit.changedAt))}:`,
        lines
      );
    })
    .join('');
}

function renderCompactMailAttachmentsRow(
  kv: MailKv,
  count?: number,
  viewUrl?: string | null
): string {
  if (!count || count <= 0 || !viewUrl) return '';
  return kv(
    'Supporting documents / 添付資料:',
    `<a href="${viewUrl}" style="color: #00A651; font-weight: 600;">${count} file(s) — view</a>`
  );
}

type FormDetailMailBodyOpts = {
  primarySectionTitle: string;
  primarySectionRows: string;
  /** Present on every call; renders only for formType RETURN. */
  returnFields?: EmailReturnFields;
  /** Present on every call; renders only when a service reviewer actually changed something. */
  reviewEdits?: MailReviewEdit[];
  /** Where the approval chain has got to. Only the mails that report a decision carry it. */
  chainSteps?: MailChainStep[];
  delivery?: EmailDeliveryFields;
  deliveryLabels?: EmailDeliveryLabels;
  products?: unknown[];
  productLang?: 'en' | 'jp';
  amountMode: CompactMailAmountMode;
  comments?: { commentsForApproval?: string; freeDescription?: string };
  attachmentCount?: number;
  attachmentsViewUrl?: string | null;
};

/** One grey panel, one table — aligned label/value columns throughout. */
function renderFormDetailMailBody(opts: FormDetailMailBodyOpts): string {
  const deliveryLabels = opts.deliveryLabels ?? DELIVERY_LABELS_EN;
  const productLang = opts.productLang ?? 'en';
  const returnLabels = productLang === 'jp' ? RETURN_LABELS_JP : RETURN_LABELS_EN;
  const isReturn = isReturnMail(opts.returnFields?.formType);
  const accent = mailAccentFor(opts.returnFields?.formType);
  const divider = mailSectionDividerRow(accent);
  const kv = mailKv(isReturn ? 'boxed' : 'compact', accent);
  const returnRows = opts.returnFields
    ? renderCompactMailReturnRows(kv, opts.returnFields, returnLabels)
    : '';
  const deliveryRows = opts.delivery
    ? renderCompactMailDeliveryRows(kv, opts.delivery, deliveryLabels)
    : '';
  const productRows = renderCompactMailProductsRows(opts.products, productLang, opts.amountMode, {
    asTable: isReturn,
    productCodeUnit: opts.returnFields?.productCodeUnit,
    // Boxed sections each own a table, so the product table stands on its own rather than being
    // wrapped in a row of an enclosing one.
    standalone: isReturn,
    accent,
  });
  const chainRows = renderMailApprovalChainRows(kv, opts.chainSteps, productLang);
  const commentRows = opts.comments ? renderCompactMailCommentsRows(kv, opts.comments) : '';
  const reviewEditRows = renderCompactMailReviewEditRows(kv, opts.reviewEdits);
  const attachmentRows = renderCompactMailAttachmentsRow(
    kv,
    opts.attachmentCount,
    opts.attachmentsViewUrl
  );
  const productCount = Array.isArray(opts.products) ? opts.products.length : 0;
  const productsHeadingBase = productLang === 'jp' ? '製品' : 'Products';
  const productsTitle =
    productCount > 0 ? `${productsHeadingBase} (${productCount})` : productsHeadingBase;
  const commentsTitle = productLang === 'jp' ? 'コメント' : 'Comments';
  const chainTitle = MAIL_CHAIN_COPY[productLang].heading;
  const reviewEditTitle = 'Corrected during service review / サービス確認時の修正';

  /*
   * A return is drawn the way the order-taking handoff is: a heading, then that section's own
   * bordered table. Vidhi Parsons, 9 Sep - *"all sections to have tables like the order taking
   * SERVICE email"* - because a label and its value read as a pair when they are two cells of one
   * row, and not when they are two runs of text in a shared gutter.
   *
   * The sample flows keep the single borderless table they have had in production for months.
   */
  if (isReturn) {
    const sections: Array<[string, string]> = [
      [opts.primarySectionTitle, opts.primarySectionRows],
      [chainTitle, chainRows],
      [returnLabels.sectionHeading, returnRows],
      [deliveryLabels.sectionHeading, deliveryRows],
      [productsTitle, productRows],
      [reviewEditTitle, reviewEditRows],
      [commentsTitle, `${commentRows}${attachmentRows}`],
    ];
    let first = true;
    const html = sections
      .map(([title, rows]) => {
        if (!rows.trim()) return '';
        // The product table is already a table; everything else is rows needing one.
        const block = rows.trimStart().startsWith('<table')
          ? `${renderMailSectionTitle(title, accent, first)}${rows}`
          : renderMailBoxedSection(title, rows, accent, first);
        first = false;
        return block;
      })
      .join('');
    return `
          <div style="margin: 0; font-size: ${COMPACT_MAIL_FONT_SIZE}; font-family: ${EMAIL_FONT_FAMILY}; ${COMPACT_MAIL_LINE_HEIGHT}">${html}
          </div>`;
  }

  const returnBlock = returnRows
    ? `${divider}${renderCompactMailSectionHeader(returnLabels.sectionHeading)}${returnRows}`
    : '';
  const deliveryBlock = deliveryRows
    ? `${divider}${renderCompactMailSectionHeader(deliveryLabels.sectionHeading)}${deliveryRows}`
    : '';
  const reviewEditBlock = reviewEditRows
    ? `${divider}${renderCompactMailSectionHeader(reviewEditTitle)}${reviewEditRows}`
    : '';
  const productsBlock = productRows
    ? `${divider}${renderCompactMailSectionHeader(productsTitle)}${productRows}`
    : '';
  const chainBlock = chainRows
    ? `${divider}${renderCompactMailSectionHeader(chainTitle)}${chainRows}`
    : '';
  const commentsBlock = commentRows || attachmentRows
    ? `${divider}${commentRows}${attachmentRows}`
    : '';

  return `
          <div style="${COMPACT_MAIL_PANEL_STYLE}">
            <table style="${COMPACT_MAIL_TABLE_STYLE} margin: 0;" cellpadding="0" cellspacing="0" role="presentation">
              ${COMPACT_MAIL_TABLE_COLGROUP}
              ${renderCompactMailSectionHeader(opts.primarySectionTitle)}
              ${opts.primarySectionRows}
              ${chainBlock}${returnBlock}${deliveryBlock}
              ${productsBlock}${reviewEditBlock}
              ${commentsBlock}
            </table>
          </div>`;
}

/**
 * The frame every notification sits in.
 *
 * A return runs the full width of the reading pane, like the order-taking handoff it is now drawn
 * to match: its sections are wide bordered tables and the 720px cap squeezed them. The sample
 * flows keep the narrower column, which suits their shorter rows and is what they have shipped
 * with.
 */
function renderCompactMailShell(
  cardHtml: string,
  footerText: string,
  data?: { formType?: string }
): string {
  const wide = isReturnMail(data?.formType);
  return `
    <div style="${COMPACT_MAIL_WRAPPER_STYLE}">
      <div style="${wide ? ORDER_TAKING_MAIL_CONTAINER_STYLE : COMPACT_MAIL_CONTAINER_STYLE}">
        ${cardHtml}
        <p style="${COMPACT_MAIL_FOOTER_STYLE}">${footerText}</p>
      </div>
    </div>`;
}

/** Order-taking mailbox mail: full viewport width (no 600px compact cap). */
const ORDER_TAKING_MAIL_PADDING_X = '16px';
const ORDER_TAKING_MAIL_CONTAINER_STYLE = `width: 100%; max-width: 100%; margin: 0; padding: 8px ${ORDER_TAKING_MAIL_PADDING_X}; background-color: #f9f9f9; font-family: ${ORDER_TAKING_EMAIL_FONT_FAMILY};`;
const ORDER_TAKING_MAIL_CARD_STYLE = `background-color: #ffffff; padding: 10px ${ORDER_TAKING_MAIL_PADDING_X}; font-family: ${ORDER_TAKING_EMAIL_FONT_FAMILY};`;

function renderOrderTakingMailShell(cardHtml: string, footerText: string): string {
  return `
    <div style="${COMPACT_MAIL_WRAPPER_STYLE}">
      <div style="${ORDER_TAKING_MAIL_CONTAINER_STYLE}">
        ${cardHtml}
        <p style="${COMPACT_MAIL_FOOTER_STYLE}">${footerText}</p>
      </div>
    </div>`;
}

/** What a resubmitted return was rejected for last time - the shape form-reopen.service produces. */
type MailResubmittedAfter = { by: string; role: string; at: string | null; reason: string | null };

/**
 * One line saying a request is a resubmission, and what it was rejected for.
 *
 * A reopened return comes back to the same approvers and reviewers under the same reference number;
 * without this they would see a request they already turned down and not know it had been corrected.
 * Renders nothing when absent, so every other mail is unchanged to the byte.
 */
function renderResubmittedNote(after?: MailResubmittedAfter): string {
  if (!after) return '';
  const when = after.at ? ` on ${formatDate(new Date(after.at))}` : '';
  const why = after.reason?.trim() ? `: ${escapeHtml(after.reason.trim())}` : '';
  return `<p style="${COMPACT_MAIL_MUTED_STYLE}">Resubmitted after correction. Previously rejected by ${escapeHtml(after.by)} (${escapeHtml(after.role)})${when}${why}</p>`;
}

/**
 * A return that is still being decided lives on the Pending list, and `?expand=` opens it there.
 *
 * Two mails linked somewhere else: the rejection pointed at /forms/<id>, which is not a page, and the
 * submission confirmation pointed at the Approved list, where a request that has only just been
 * submitted is not. Both now land on the request itself.
 */
function returnPendingLink(formId: string): string {
  const base = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/return/pending?expand=${encodeURIComponent(formId)}`;
}

const COMPACT_MAIL_FOOTER_EN = EMAIL_COPY.en.footer;
const COMPACT_MAIL_FOOTER_JP = EMAIL_COPY.jp.footer;

/** Omit request-type row when reference already includes the display label e.g. サンプル用(ZSAM)-CDG-... */
function shouldOmitFormType(referenceNumber?: string | null, formType?: string | null): boolean {
  const ref = String(referenceNumber ?? '').trim();
  const type = String(formType ?? '').trim();
  if (!ref || !type) return false;
  const label = mailFormTypeLabel(type);
  if (label && label !== '—' && ref.includes(label)) return true;
  const t = type.toUpperCase();
  const r = ref.toUpperCase();
  return r.includes(`(${t})`) || r.includes(`-${t}-`);
}

function renderMailTotalAmountRow(kv: MailKv, amount: number, label = 'Total amount'): string {
  return kv(label, formatCurrency(amount));
}

type EmailDeliveryFields = {
  soldToName?: string;
  soldToCode?: string;
  shipToName?: string;
  shipToCode?: string;
  attentionTo?: string;
  endUserName?: string;
  endUserCode?: string;
  deliveryMode?: string;
  expectedDeliveryDate?: string;
  formType?: string;
};

type EmailDeliveryLabels = {
  sectionHeading: string;
  soldTo: string;
  shipTo: string;
  endUser: string;
  deliveryMode: string;
  deliveryDate: string;
};

const DELIVERY_LABELS_EN: EmailDeliveryLabels = {
  sectionHeading: 'Delivery information',
  soldTo: 'Sold-To:',
  shipTo: 'Ship-To:',
  endUser: 'End user:',
  deliveryMode: 'Delivery mode:',
  deliveryDate: 'Delivery Date:',
};

const DELIVERY_LABELS_JP: EmailDeliveryLabels = {
  sectionHeading: '配送情報',
  soldTo: '販売先:',
  shipTo: '配送先:',
  endUser: 'エンドユーザー:',
  deliveryMode: '配送モード:',
  deliveryDate: '配送予定日:',
};

function renderEmailApprovalRequestSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  requesterName: string;
  requesterDisplay?: string;
  totalAmount: number;
  requestDate: Date;
  level: number;
  /** Review step: the service review is not an approval level, so it is named rather than numbered. */
  reviewStep?: boolean;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('Requester:', displayRequester(data))}
              ${kv('Request date:', formatDate(data.requestDate))}
              ${renderMailTotalAmountRow(kv, data.totalAmount)}
              ${data.reviewStep ? kv('Step:', 'Service review (before approval)') : kv('Approval level:', `Level ${data.level}`)}`;
  return rows;
}

function renderEmailApprovalRequestSummaryJp(data: {
  referenceNumber?: string;
  formType: string;
  requesterName: string;
  requesterDisplay?: string;
  totalAmount: number;
  requestDate: Date;
  level: number;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('参照番号:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.jp.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('申請者:', displayRequester(data))}
              ${kv('申請日:', formatDate(data.requestDate))}
              ${renderMailTotalAmountRow(kv, data.totalAmount, '合計金額')}
              ${kv('承認レベル:', `レベル ${data.level}`)}`;
  return rows;
}

/**
 * One step of an approval chain, as a requester's mail shows it.
 *
 * `state` is what the requester needs to read at a glance, which is not quite the stored status: the
 * step that is about to be notified is `current` even though its row is still PENDING until the
 * notification is sent.
 */
export type MailChainStep = {
  role: string;
  name: string;
  state: 'approved' | 'current' | 'pending' | 'rejected';
  decidedAt?: string | Date | null;
};

const MAIL_CHAIN_COPY = {
  en: {
    heading: 'Approval progress',
    approved: 'approved',
    current: 'with them now',
    pending: 'not yet reached',
    rejected: 'rejected',
  },
  jp: {
    heading: '承認状況',
    approved: '承認済み',
    current: '対応中',
    pending: '未着手',
    rejected: '却下',
  },
} as const;

/**
 * Every step of the chain and where the request has got to.
 *
 * Vidhi Parsons asked for this on 9 Sep: the requester was told only who had just decided, so
 * *"who approved and who rejected"* was not answerable from the mail. The chain is already loaded
 * where these mails are sent, so this costs no extra query.
 */
function renderMailApprovalChainRows(
  kv: MailKv,
  steps: MailChainStep[] | undefined,
  lang: 'en' | 'jp'
): string {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  const copy = MAIL_CHAIN_COPY[lang];
  const rows = steps
    .map((step) => {
      const when = step.decidedAt ? ` ${formatDate(new Date(step.decidedAt))}` : '';
      const state =
        step.state === 'approved'
          ? `${copy.approved}${when}`
          : step.state === 'rejected'
            ? `${copy.rejected}${when}`
            : step.state === 'current'
              ? copy.current
              : copy.pending;
      // The name carries the state so a step reads as one line however narrow the client is.
      const emphasis = step.state === 'current' ? ' font-weight: 600;' : '';
      return kv(
        `${escapeHtml(step.role)}:`,
        `<span style="${emphasis}">${escapeHtml(step.name)}</span> <span style="color: #666;">— ${escapeHtml(state)}</span>`
      );
    })
    .join('');
  return rows;
}

function renderEmailRequestSubmittedSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  totalAmount: number;
  submittedAt: Date;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  return `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${renderMailTotalAmountRow(kv, data.totalAmount)}
              ${kv('Submitted on:', formatDate(data.submittedAt))}`;
}

function renderEmailApprovalNotificationSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  approverName: string;
  approverRole: string;
  level: number;
  /** Return only: the step's role, shown in place of the raw level number. */
  stepRole?: string;
  totalAmount: number;
  decidedAt: Date;
  comments?: string;
  chainSteps?: MailChainStep[];
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('Approved by:', approverNameWithRoleCell(data.approverName, data.approverRole))}
              ${data.stepRole ? kv('Step:', escapeHtml(data.stepRole)) : kv('Approval level:', `Level ${data.level}`)}
              ${renderMailTotalAmountRow(kv, data.totalAmount)}
              ${kv('Approved on:', formatDate(data.decidedAt))}
              ${data.comments?.trim() ? kv('Comments:', escapeHtml(data.comments)) : ''}`;
  return rows;
}

function renderEmailApprovalNotificationSummaryJp(data: {
  referenceNumber?: string;
  formType: string;
  approverName: string;
  approverRole: string;
  level: number;
  totalAmount: number;
  decidedAt: Date;
  comments?: string;
  chainSteps?: MailChainStep[];
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('参照番号:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.jp.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('承認者:', approverNameWithRoleCell(data.approverName, data.approverRole))}
              ${kv('承認レベル:', `レベル ${data.level}`)}
              ${renderMailTotalAmountRow(kv, data.totalAmount, '合計金額')}
              ${kv('承認日時:', formatDate(data.decidedAt))}
              ${data.comments?.trim() ? kv('コメント:', escapeHtml(data.comments)) : ''}`;
  return rows;
}

function renderEmailFormApprovedSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  totalAmount: number;
  approvedAt: Date;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${renderMailTotalAmountRow(kv, data.totalAmount)}
              ${kv('Approved on:', formatDate(data.approvedAt))}`;
  return rows;
}

function renderEmailFormApprovedSummaryJp(data: {
  referenceNumber?: string;
  formType: string;
  totalAmount: number;
  approvedAt: Date;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('参照番号:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.jp.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${renderMailTotalAmountRow(kv, data.totalAmount, '合計金額')}
              ${kv('承認日時:', formatDate(data.approvedAt))}`;
  return rows;
}

function renderEmailCancellationSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  requesterName: string;
  requesterDisplay?: string;
  rejectedBy: string;
  rejectedByRole: string;
  rejectedAtLevel: number;
  level: number;
  totalAmount: number;
  rejectionComments: string;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('Requester:', displayRequester(data))}
              ${kv('Rejected by:', approverNameWithRoleCell(data.rejectedBy, data.rejectedByRole))}
              ${kv('Rejected at level:', `Level ${data.rejectedAtLevel}`)}
              ${kv('Your approval level:', `Level ${data.level} (Cancelled)`)}
              ${renderMailTotalAmountRow(kv, data.totalAmount)}
              ${kv('Rejection reason:', escapeHtml(data.rejectionComments))}`;
  return rows;
}

function renderEmailRejectionSummaryEn(data: {
  referenceNumber?: string;
  formType: string;
  approverName: string;
  approverRole: string;
  rejectedAt: Date;
  comments?: string;
  chainSteps?: MailChainStep[];
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('Reference:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.en.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('Rejected by:', approverNameWithRoleCell(data.approverName, data.approverRole))}
              ${kv('Rejected on:', formatDate(data.rejectedAt))}
              ${data.comments?.trim() ? kv('Rejection reason:', escapeHtml(data.comments)) : ''}`;
  return rows;
}

function renderEmailRejectionSummaryJp(data: {
  referenceNumber?: string;
  formType: string;
  approverName: string;
  approverRole: string;
  rejectedAt: Date;
  comments: string;
  chainSteps?: MailChainStep[];
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('参照番号:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.jp.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('却下者:', approverNameWithRoleCell(data.approverName, data.approverRole))}
              ${kv('却下日時:', formatDate(data.rejectedAt))}
              ${kv('却下理由:', escapeHtml(data.comments))}`;
  return rows;
}

function renderEmailCancellationSummaryJp(data: {
  referenceNumber?: string;
  formType: string;
  requesterName: string;
  requesterDisplay?: string;
  rejectedBy: string;
  rejectedByRole: string;
  rejectedAtLevel: number;
  level: number;
  totalAmount: number;
  rejectionComments: string;
}): string {
  const kv = mailKvFor(data);
  const omitType = shouldOmitFormType(data.referenceNumber, data.formType);
  const rows = `
              ${data.referenceNumber ? kv('参照番号:', escapeHtml(data.referenceNumber)) : ''}
              ${omitType ? '' : kv(EMAIL_COPY.jp.requestType, escapeHtml(mailFormTypeLabel(data.formType)))}
              ${kv('申請者:', displayRequester(data))}
              ${kv('却下者:', approverNameWithRoleCell(data.rejectedBy, data.rejectedByRole))}
              ${kv('却下レベル:', `レベル ${data.rejectedAtLevel}`)}
              ${kv('あなたの承認レベル:', `レベル ${data.level}（キャンセル）`)}
              ${renderMailTotalAmountRow(kv, data.totalAmount, '合計金額')}
              ${kv('却下理由:', escapeHtml(data.rejectionComments))}`;
  return rows;
}

type MailReviewEdit = {
  changedAt: string | Date;
  changedByName: string;
  fieldChanges: Array<{ field: string; oldValue: string | null; newValue: string | null }>;
};

type FormDetailMailData = EmailDeliveryFields &
  EmailReturnFields & {
    chainSteps?: MailChainStep[];
    reviewEdits?: MailReviewEdit[];
    products?: unknown[];
    commentsForApproval?: string;
    freeDescription?: string;
    attachmentCount?: number;
    attachmentsViewUrl?: string | null;
  };

function renderActualAmountFormDetailBody(opts: {
  primarySectionTitle: string;
  primarySectionRows: string;
  data: FormDetailMailData;
  deliveryLabels: EmailDeliveryLabels;
  productLang: 'en' | 'jp';
}): string {
  return renderFormDetailMailBody({
    primarySectionTitle: opts.primarySectionTitle,
    primarySectionRows: opts.primarySectionRows,
    chainSteps: opts.data.chainSteps,
    // Same object; renderCompactMailReturnRows returns '' unless formType is RETURN, so passing it
    // unconditionally here is what keeps all ten templates in step without ten edits.
    returnFields: opts.data,
    reviewEdits: opts.data.reviewEdits,
    delivery: opts.data,
    deliveryLabels: opts.deliveryLabels,
    products: opts.data.products,
    productLang: opts.productLang,
    amountMode: 'actual',
    comments: {
      commentsForApproval: opts.data.commentsForApproval,
      freeDescription: opts.data.freeDescription,
    },
    attachmentCount: opts.data.attachmentCount,
    attachmentsViewUrl: opts.data.attachmentsViewUrl,
  });
}

/**
 * The banner on a message that reached somebody other than the person the step names.
 *
 * Amber rather than red: nothing has gone wrong with the request, only with our knowledge of who
 * the approver is. Inline, like every other style here, because Outlook drops a stylesheet.
 */
const MAIL_UNROUTED_NOTICE_STYLE =
  'margin: 0 0 10px 0; padding: 8px 10px; border-left: 3px solid #B45309; background-color: #FEF3C7; color: #7C2D12; font-size: 13px; line-height: 1.5;';

export const emailTemplates = {
  'approval-request-en': (data: {
    approverName: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    requesterName: string;
    requesterDisplay?: string;
    totalAmount: number;
    requestDate: Date;
    level: number;
    role: string;
    previousApprover?: string;
    /** The previous step's comment on approving, shown so a reviewer's note travels with the request. */
    previousComments?: string;
    approveUrl?: string | null;
    rejectUrl?: string | null;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
    /**
     * The person this step is assigned to, when the mail could not be sent to them.
     *
     * Set only when the approver named by the matrix has no account in this system, so the address
     * would have been a guess. The message goes to the operator instead and this names the person
     * who should have received it. Absent on every ordinary mail, which is why the sample templates
     * render byte-identically.
     */
    unroutedFor?: string;
    /**
     * This is the P&OP service review, not an approval.
     *
     * The review is a distinct event in the recipient matrix and the one step that can still correct
     * a request, so it says so: a separate title, its own wording, and no talk of approval levels.
     * Absent on every ordinary approval request, which renders exactly as before.
     */
    reviewStep?: boolean;
    /** Set when a reopened return comes back: what it was rejected for last time. */
    resubmittedAfter?: MailResubmittedAfter;
    /**
     * The route this request will take, shown on the service review only.
     *
     * The reviewer is the one step that can still change it - correcting the requester, the unit or
     * the service flag rebuilds every step after them - so who comes next is the thing they most
     * need to see. Deliberately NOT sent on an ordinary approval request: those go to the four
     * sample flows as well, which must keep rendering byte for byte.
     */
    chainSteps?: MailChainStep[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${data.reviewStep ? EMAIL_COPY.en.approvalRequest.reviewTitle : EMAIL_COPY.en.approvalRequest.title}</div>${data.unroutedFor ? `<p style="${MAIL_UNROUTED_NOTICE_STYLE}">This request is assigned to <strong>${escapeHtml(data.unroutedFor)}</strong>, who has no account in this system, so it could not be emailed to them. You are receiving it in their place.</p>` : ''}${renderResubmittedNote(data.resubmittedAfter)}
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${escapeHtml(data.approverName)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${data.reviewStep ? EMAIL_COPY.en.approvalRequest.reviewIntro(displayRequester(data), escapeHtml(mailFormTypeLabel(data.formType))) : `A new ${escapeHtml(mailFormTypeLabel(data.formType))} request from ${displayRequester(data)} requires your approval.`}</p>
          ${data.previousApprover ? `<p style="${COMPACT_MAIL_MUTED_STYLE}">This request has been approved by ${escapeHtml(data.previousApprover)}.</p>` : ''}
          ${data.previousApprover && data.previousComments ? `<p style="${COMPACT_MAIL_MUTED_STYLE}">Comments from ${escapeHtml(data.previousApprover)}: ${escapeHtml(data.previousComments)}</p>` : ''}
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: 'Summary',
            primarySectionRows: renderEmailApprovalRequestSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <div style="text-align: center; margin: 12px 0;">
            ${data.approveUrl ? `
            <a href="${data.approveUrl}" style="${buttonStyle} background-color: #00A651; margin-right: 10px;">
              ✓ Approve
            </a>
            ` : ''}
            ${data.rejectUrl ? `
            <a href="${data.rejectUrl}" style="${buttonStyle} background-color: #dc3545; margin-left: 10px;">
              ✗ Reject
            </a>
            ` : ''}
          </div>
          ${!data.approveUrl && !data.rejectUrl ? `
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/approvals/${data.formId}" style="${buttonStyle}">
            Review and Approve
          </a>
          ` : ''}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${data.approveUrl || data.rejectUrl
              ? 'Click the buttons above to approve or reject this request directly. No login required.'
              : 'Please review this request at your earliest convenience. If you have any questions, please contact the requester directly.'}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  'approval-request-jp': (data: {
    approverName: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    requesterName: string;
    requesterDisplay?: string;
    totalAmount: number;
    requestDate: Date;
    level: number;
    role: string;
    previousApprover?: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
    /**
     * The person this step is assigned to, when the mail could not be sent to them.
     *
     * Set only when the approver named by the matrix has no account in this system, so the address
     * would have been a guess. The message goes to the operator instead and this names the person
     * who should have received it. Absent on every ordinary mail, which is why the sample templates
     * render byte-identically.
     */
    unroutedFor?: string;
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${EMAIL_COPY.jp.approvalRequest.title}</div>${data.unroutedFor ? `<p style="${MAIL_UNROUTED_NOTICE_STYLE}">この申請の担当者は <strong>${escapeHtml(data.unroutedFor)}</strong> ですが、システムにアカウントがないため送信できませんでした。代わりにご連絡しています。</p>` : ''}
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${escapeHtml(data.approverName)} 様</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.jp.approvalRequest.intro(displayRequester(data), escapeHtml(mailFormTypeLabel(data.formType)))}</p>
          ${data.previousApprover ? `<p style="${COMPACT_MAIL_MUTED_STYLE}">${escapeHtml(data.previousApprover)}により承認されました。</p>` : ''}
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: '概要',
            primarySectionRows: renderEmailApprovalRequestSummaryJp(data),
            data,
            deliveryLabels: DELIVERY_LABELS_JP,
            productLang: 'jp',
          })}
          <a href="${process.env.FRONTEND_URL}/approvals/${data.formId}" style="${buttonStyle}">
            確認して承認する
          </a>
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            お早めにご確認ください。ご不明な点がございましたら、申請者に直接お問い合わせください。
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_JP, data),

  'approval-notification-jp': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    approverName: string;
    approverRole: string;
    level: number;
    totalAmount: number;
    requestDate: Date;
    decidedAt: Date;
    comments?: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${EMAIL_COPY.jp.approvalNotification.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${displayRequester(data)} 様</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.jp.approvalNotification.approvedAtLevel(data.level)}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: '承認詳細',
            primarySectionRows: renderEmailApprovalNotificationSummaryJp(data),
            data,
            deliveryLabels: DELIVERY_LABELS_JP,
            productLang: 'jp',
          })}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.jp.approvalNotification.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_JP, data),

  'approval-notification-en': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    approverName: string;
    approverRole: string;
    level: number;
    /**
     * Return only: the step that just cleared, named rather than numbered.
     *
     * A service return's review step is level 1, so the level number describes neither the step nor
     * its position among the approvers. Absent on every sample mail, which renders as before.
     */
    stepRole?: string;
    /** Return only: this step was the P&OP service review, not an approval. */
    reviewStep?: boolean;
    totalAmount: number;
    requestDate: Date;
    decidedAt: Date;
    comments?: string;
    chainSteps?: MailChainStep[];
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${data.reviewStep ? EMAIL_COPY.en.approvalNotification.reviewCompletedTitle : EMAIL_COPY.en.approvalNotification.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${displayRequester(data)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${data.reviewStep ? EMAIL_COPY.en.approvalNotification.reviewCompleted : data.stepRole ? EMAIL_COPY.en.approvalNotification.approvedByStep(data.stepRole) : EMAIL_COPY.en.approvalNotification.approvedAtLevel(data.level)}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: 'Approval details',
            primarySectionRows: renderEmailApprovalNotificationSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.en.approvalNotification.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  'approval-cancelled-en': (data: {
    approverName: string;
    approverRole: string;
    level: number;
    formId: string;
    referenceNumber?: string;
    formType: string;
    requesterName: string;
    requesterDisplay?: string;
    rejectedBy: string;
    rejectedByRole: string;
    rejectedAtLevel: number;
    totalAmount: number;
    requestDate: Date;
    rejectionComments: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE} color: #dc3545;">${EMAIL_COPY.en.approvalCancelled.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${escapeHtml(data.approverName)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.en.approvalCancelled.intro(data.rejectedAtLevel)}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: 'Rejection details',
            primarySectionRows: renderEmailCancellationSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.en.approvalCancelled.footnote(data.rejectedAtLevel)}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  'form-approved-en': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    totalAmount: number;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    approvedAt: Date;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
    /**
     * The whole chain, and everyone copied on this message.
     *
     * The outcome mail used to go to the submitter alone and say nothing about who had approved it
     * or who else received it - which is what "we don't see anyone in To and CC" was really about.
     * Returns only; a sample final approval carries neither and renders exactly as before.
     */
    chainSteps?: MailChainStep[];
    recipientsTo?: string[];
    recipientsCc?: string[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${EMAIL_COPY.en.requestApproved.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${displayRequester(data)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.en.requestApproved.intro}</p>${
            data.recipientsCc && data.recipientsCc.length > 0
              ? `
          <p style="${COMPACT_MAIL_MUTED_STYLE}">Copied: ${escapeHtml(data.recipientsCc.join(', '))}</p>`
              : ''
          }
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: EMAIL_COPY.en.summary,
            primarySectionRows: renderEmailFormApprovedSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <a href="${process.env.FRONTEND_URL}" style="${buttonStyle}">
            ${EMAIL_COPY.en.viewRequestDetails}
          </a>
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.en.requestApproved.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  /**
   * "Request Submitted" — the confirmation a return's requester gets the moment it is raised.
   *
   * First row of the recipient matrix agreed with Damian Diggin on 20 Sep, and a mail that did not
   * exist: TO the requester, CC the submitter. It carries the route, because the question a
   * requester has at this moment is who has it next — and for a service return that is the P&OP
   * review, not an approver.
   */
  'request-submitted-en': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    totalAmount: number;
    requestDate: Date;
    submittedAt: Date;
    chainSteps?: MailChainStep[];
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
    recipientsTo?: string[];
    recipientsCc?: string[];
    /** A reopened return being resubmitted: what it was rejected for last time. */
    resubmittedAfter?: MailResubmittedAfter;
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${data.resubmittedAfter ? EMAIL_COPY.en.requestSubmitted.resubmittedTitle : EMAIL_COPY.en.requestSubmitted.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${displayRequester(data)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${data.resubmittedAfter ? EMAIL_COPY.en.requestSubmitted.resubmittedIntro : EMAIL_COPY.en.requestSubmitted.intro}</p>${renderResubmittedNote(data.resubmittedAfter)}${
            data.recipientsCc && data.recipientsCc.length > 0
              ? `
          <p style="${COMPACT_MAIL_MUTED_STYLE}">Copied: ${escapeHtml(data.recipientsCc.join(', '))}</p>`
              : ''
          }
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: EMAIL_COPY.en.summary,
            primarySectionRows: renderEmailRequestSubmittedSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <a href="${returnPendingLink(data.formId)}" style="${buttonStyle}">
            ${EMAIL_COPY.en.viewRequestDetails}
          </a>
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.en.requestSubmitted.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  /** Order-taking notification after final approval (CDG / LSG mailboxes) — print layout */
  'order-taking-approved-en': (data: OrderTakingPrintEmailData) => renderOrderTakingMailShell(`
        <div style="${ORDER_TAKING_MAIL_CARD_STYLE}">
          <p style="${COMPACT_MAIL_MUTED_STYLE}; margin: 0 0 10px 0; font-family: ${ORDER_TAKING_EMAIL_FONT_FAMILY};">
            This request has completed all approval levels and is ready for order processing.${
              isReturnMail(data.formType)
                ? ' The requester is copied on this message: it is both the order-taking handoff and their confirmation that the request is fully approved.'
                : ''
            }
          </p>
          ${renderOrderTakingPrintStyleMailBody(data)}
        </div>
  `, COMPACT_MAIL_FOOTER_EN),

  'form-approved-jp': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    totalAmount: number;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    approvedAt: Date;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE}">${EMAIL_COPY.jp.requestApproved.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${displayRequester(data)} 様</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.jp.requestApproved.intro}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: EMAIL_COPY.jp.summary,
            primarySectionRows: renderEmailFormApprovedSummaryJp(data),
            data,
            deliveryLabels: DELIVERY_LABELS_JP,
            productLang: 'jp',
          })}
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/forms/${data.formId}" style="${buttonStyle}">
            ${EMAIL_COPY.jp.viewRequestDetails}
          </a>
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.jp.requestApproved.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_JP, data),

  'approval-cancelled-jp': (data: {
    approverName: string;
    approverRole: string;
    level: number;
    formId: string;
    referenceNumber?: string;
    formType: string;
    requesterName: string;
    requesterDisplay?: string;
    rejectedBy: string;
    rejectedByRole: string;
    rejectedAtLevel: number;
    totalAmount: number;
    requestDate: Date;
    rejectionComments: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE} color: #dc3545;">${EMAIL_COPY.jp.approvalCancelled.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${escapeHtml(data.approverName)} 様</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.jp.approvalCancelled.intro(data.rejectedAtLevel)}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: '却下詳細',
            primarySectionRows: renderEmailCancellationSummaryJp(data),
            data,
            deliveryLabels: DELIVERY_LABELS_JP,
            productLang: 'jp',
          })}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.jp.approvalCancelled.footnote(data.rejectedAtLevel)}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_JP, data),

   'form-rejected-en': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    approverName: string;
    approverRole: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    comments: string;
    chainSteps?: MailChainStep[];
    /** Return only: sent back at the service review, so the requester may reopen it in place. */
    reopenable?: boolean;
    rejectedAt: Date;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE} color: #dc3545;">${EMAIL_COPY.en.requestRejected.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">Dear ${displayRequester(data)},</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.en.requestRejected.intro(approverNameWithRoleInline(data.approverName, data.approverRole))}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: 'Rejection details',
            primarySectionRows: renderEmailRejectionSummaryEn(data),
            data,
            deliveryLabels: DELIVERY_LABELS_EN,
            productLang: 'en',
          })}
          <a href="${isReturnMail(data.formType) ? returnPendingLink(data.formId) : `${process.env.FRONTEND_URL}/forms/${data.formId}`}" style="${buttonStyle}">
            ${isReturnMail(data.formType) ? EMAIL_COPY.en.requestRejected.returnButton : EMAIL_COPY.en.viewRequestDetails}
          </a>
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${isReturnMail(data.formType) ? (data.reopenable ? EMAIL_COPY.en.requestRejected.returnFootnote : EMAIL_COPY.en.requestRejected.returnCopyFootnote) : EMAIL_COPY.en.requestRejected.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_EN, data),

  'form-rejected-jp': (data: {
    requesterName: string;
    requesterDisplay?: string;
    formId: string;
    referenceNumber?: string;
    formType: string;
    approverName: string;
    approverRole: string;
    soldToName?: string;
    soldToCode?: string;
    shipToName?: string;
    shipToCode?: string;
    attentionTo?: string;
    endUserName?: string;
    endUserCode?: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    comments: string;
    rejectedAt: Date;
    commentsForApproval?: string;
    freeDescription?: string;
    products?: any[];
  }) => renderCompactMailShell(`
        <div style="${COMPACT_MAIL_CARD_STYLE}">
          <div style="${COMPACT_MAIL_TITLE_STYLE} color: #dc3545;">${EMAIL_COPY.jp.requestRejected.title}</div>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${displayRequester(data)} 様</p>
          <p style="${COMPACT_MAIL_INTRO_STYLE}">${EMAIL_COPY.jp.requestRejected.intro(approverNameWithRoleInline(data.approverName, data.approverRole))}</p>
          ${renderActualAmountFormDetailBody({
            primarySectionTitle: '却下詳細',
            primarySectionRows: renderEmailRejectionSummaryJp(data),
            data,
            deliveryLabels: DELIVERY_LABELS_JP,
            productLang: 'jp',
          })}
          <p style="${COMPACT_MAIL_MUTED_STYLE}">
            ${EMAIL_COPY.jp.requestRejected.footnote}
          </p>
        </div>
  `, COMPACT_MAIL_FOOTER_JP, data)
};
