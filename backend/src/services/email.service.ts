/**
 * Email Service - Handles all email sending functionality
 *
 * Sending strategy:
 * 1. If Azure AD app + Graph are configured (AZURE_TENANT_ID, AZURE_CLIENT_ID,
 *    AZURE_CLIENT_SECRET, AZURE_MAIL_FROM), mail is sent via Microsoft Graph API.
 * 2. Otherwise Nodemailer SMTP is used (SMTP_* / EMAIL_FROM).
 *
 * Optional AZURE_MAIL_TO: comma-separated addresses BCC’d on every message (audit / archive).
 * Skips any address already in the primary To list (case-insensitive).
 *
 * MAIL_TEST: when MAIL_TEST=true or 1, BCC is disabled and the subject is prefixed [MAIL_TEST].
 * Recipients on MAIL_TEST_ALLOWLIST receive their real mail, so UAT routes exactly as production
 * will; everyone else is redirected to AZURE_MAIL_TO with a note naming the intended recipient.
 * An empty allowlist redirects everything, which is the original behaviour.
 * Order-taking (AZURE_CGD_MAIL_TO / AZURE_LSG_MAIL_TO): comma/semicolon-separated To list per BU when a form is fully approved.
 *
 * Emails are sent when:
 * - A form is submitted (approval request to first approver)
 * - An approval is completed (notification to next approver)
 * - A form is fully approved (notification to requester; optional order-taking mail to AZURE_CGD_MAIL_TO / AZURE_LSG_MAIL_TO by BU)
 * - A form is rejected (notification to requester)
 */

import nodemailer from 'nodemailer';
import { emailTemplates } from '../utils/email.templates';
import { isAzureGraphEmailConfigured, sendMailViaGraph } from './azure-graph-email.service';

/**
 * Email Options Interface
 * Defines the structure for sending emails
 */
interface EmailOptions {
    to: string;                                    // Recipient email address
    /**
     * Optional CC, comma/semicolon separated. Visible to every recipient, unlike the audit BCC.
     *
     * Added for the final-approval notification: Vidhi Parsons asked who receives it, and the only
     * mechanism available was `AZURE_MAIL_TO`, a blind BCC on *every* message the app sends — which
     * cannot answer that question and cannot be varied per mail.
     *
     * CC is partitioned by MAIL_TEST exactly as `to` is, so a CC'd address that is not on the
     * allowlist is held back rather than quietly receiving test mail.
     */
    cc?: string;
    subject: string;                               // Email subject line
    template: keyof typeof emailTemplates;         // Template name (e.g., 'approval-request')
    data: any;                                     // Data to populate the template
}

/**
 * SMTP Transporter Configuration
 * 
 * Environment Variables Required:
 * - SMTP_HOST: SMTP server hostname (e.g., smtp.gmail.com)
 * - SMTP_PORT: SMTP port (587 for TLS, 465 for SSL)
 * - SMTP_SECURE: 'true' for SSL (port 465), 'false' for TLS (port 587)
 * - SMTP_USER: SMTP username/email
 * - SMTP_PASSWORD: SMTP password or app-specific password
 * - EMAIL_FROM: Sender email address and name
 * 
 * Example .env configuration:
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=587
 * SMTP_SECURE=false
 * SMTP_USER=your-email@example.com
 * SMTP_PASSWORD=your-app-password
 * EMAIL_FROM="Japan Automation <noreply-japauto@example.com>"
 */
function isSmtpConfigured(): boolean {
    return Boolean(
        process.env.SMTP_HOST?.trim() &&
            process.env.SMTP_USER?.trim() &&
            process.env.SMTP_PASSWORD !== undefined &&
            process.env.SMTP_PASSWORD !== ''
    );
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,                   // SMTP server address
    port: parseInt(process.env.SMTP_PORT || '587'), // SMTP port (default: 587 for TLS)
    secure: process.env.SMTP_SECURE === 'true',    // true for SSL (465), false for TLS (587)
    auth: {
        user: process.env.SMTP_USER,               // SMTP username
        pass: process.env.SMTP_PASSWORD            // SMTP password
    },
    connectionTimeout: 10000,  // 10s - fail fast if EC2 can't reach SMTP
    greetingTimeout: 10000
});

function parseRecipientList(to: string): string[] {
    return to
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Exported for order-taking mailbox parsing (same comma/semicolon rules). */
export { parseRecipientList };

/** Extra BCC from AZURE_MAIL_TO; not duplicated if already in `primaryTo`. */
function getAdditionalBcc(primaryTo: string[]): string[] {
    const raw = process.env.AZURE_MAIL_TO ?? '';
    const extra = raw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (extra.length === 0) return [];
    const primaryLower = new Set(primaryTo.map((e) => e.toLowerCase()));
    return extra.filter((e) => !primaryLower.has(e.toLowerCase()));
}

function isMailTestMode(): boolean {
    const v = (process.env.MAIL_TEST ?? '').trim().toLowerCase();
    return v === 'true' || v === '1';
}

/** When MAIL_TEST is on: where anything not on the allowlist is redirected. Must be non-empty. */
function getMailTestToRecipients(): string[] {
    return parseRecipientList(process.env.AZURE_MAIL_TO ?? '');
}

/**
 * Addresses that receive their real mail even while MAIL_TEST is on.
 *
 * Vidhi asked UAT to behave as production will — *"we like to test including e-mail"* — but the
 * old all-or-nothing redirect sent every message to one inbox, so a tester could not see that the
 * approver, the requester and the order-taking desk each get a *different* message. An allowlist
 * gives the people testing production's real routing while leaving everyone else unreachable from
 * a test system.
 *
 * Empty (the default) means MAIL_TEST behaves exactly as before: everything is redirected.
 */
export function getMailTestAllowlist(): string[] {
    return parseRecipientList(process.env.MAIL_TEST_ALLOWLIST ?? '').map((e) => e.toLowerCase());
}

/** Split recipients into those that keep their real mail and those that get redirected. */
export function partitionByAllowlist(
    recipients: string[],
    allowlist: string[]
): { allowed: string[]; redirected: string[] } {
    if (allowlist.length === 0) return { allowed: [], redirected: recipients };
    const allowed: string[] = [];
    const redirected: string[] = [];
    for (const r of recipients) {
        (allowlist.includes(r.trim().toLowerCase()) ? allowed : redirected).push(r);
    }
    return { allowed, redirected };
}

/**
 * A label for the environment a message came from, e.g. "[UAT TEST]". Blank in production.
 *
 * Deliberately NOT tied to MAIL_TEST. Vidhi asked for the call-out because a real-looking approval
 * request confuses the recipient - *"if we do not say like that, they may confuse this is true or
 * not"* - and the only marker we had was the `[MAIL_TEST]` subject prefix, which disappears the
 * moment the redirect is switched off. UAT keeps sending real mail to real people after that, so
 * the marker has to outlive the flag.
 */
function getMailEnvLabel(): string {
    return (process.env.MAIL_ENV_LABEL ?? '').trim();
}

/**
 * Banner saying the request is not real while the recipient list is - and naming that list.
 *
 * Three things, each asked for. The request is not real: *"if we do not say like that, they may
 * confuse this is true or not"*. The recipients are: a tester who assumes nobody else was mailed
 * re-sends by hand. And who exactly: Vidhi asked repeatedly *"we didn't understand who received
 * this one, looks like only me"* - under the old redirect the real To was replaced by one sink
 * address and the Cc was dropped entirely, so the headers told him nothing. Printing the resolved
 * list in the body answers it even on the blind audit copy, where the headers cannot.
 */
export function environmentNotice(label: string, to: string[], cc: string[]): string {
    const line = (k: string, v: string[]) =>
        v.length
            ? `<div style="margin-top:4px;"><strong>${k}:</strong> ${escapeHtmlForNotice(v.join(', '))}</div>`
            : '';
    return (
        `<div style="margin-top:16px;padding:8px 12px;border-left:3px solid #B45309;` +
        `background:#FDF3E3;font-family:sans-serif;font-size:12px;color:#7C4A11;">` +
        `<strong>${escapeHtmlForNotice(label)} - this is a test message.</strong> The request it ` +
        `describes is not real and needs no action. The recipient list below is real - everyone ` +
        `named received this copy.` +
        line('To', to) +
        line('Cc', cc) +
        `</div>`
    );
}

/** Appended to a redirected message so a tester can still read the production routing off it. */
export function intendedRecipientNotice(intendedTo: string): string {
    return (
        `<div style="margin-top:16px;padding:8px 12px;border-left:3px solid #B45309;` +
        `background:#FDF3E3;font-family:sans-serif;font-size:12px;color:#7C4A11;">` +
        `<strong>Test environment.</strong> In production this message would have been sent to: ` +
        `${escapeHtmlForNotice(intendedTo)}.</div>`
    );
}

function escapeHtmlForNotice(v: string): string {
    return v
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Send Email Function
 * 
 * Sends an email using a predefined template with dynamic data
 * 
 * @param options - Email configuration options
 * @param options.to - Recipient email address
 * @param options.subject - Email subject line
 * @param options.template - Template name from emailTemplates
 * @param options.data - Data object to populate template (includes form details, approver info, etc.)
 * 
 * @example
 * await sendEmail({
 *   to: 'approver@example.com',
 *   subject: '新規承認依頼: ZSAM - GEORGINA HESSION',
 *   template: 'approval-request',
 *   data: {
 *     approverName: 'GEORGINA CALLINAN',
 *     referenceNumber: 'ZSAM-CDG-2024-0042',
 *     formType: 'ZSAM',
 *     requesterName: 'GEORGINA HESSION',
 *     totalAmount: 96000,
 *     products: [...]
 *   }
 * });
 * 
 * Available Templates:
 * - 'approval-request': Sent to approver when form needs approval
 * - 'approval-request-ja': Japanese version of approval request
 * - 'form-approved': Sent to requester when form is fully approved
 * - 'form-rejected': Sent to requester when form is rejected
 */
/**
 * What a send actually did, as opposed to what it was asked to do.
 *
 * MAIL_TEST removes a non-allowlisted recipient from the message and substitutes the sink, and the
 * send still resolves — so a caller logging the address it passed IN reports a delivery that never
 * happened. That is how "who receive final approvals it looks not work well" went unnoticed: the
 * server logs claimed success for mail nobody received. Callers should log `delivered`.
 */
export type SendEmailResult = {
    /** Addresses the message was genuinely handed to the transport for. */
    delivered: string[];
    /** CC addresses the message actually carried, after MAIL_TEST partitioning. */
    deliveredCc: string[];
    /** Intended addresses that MAIL_TEST replaced with the sink. Empty in normal operation. */
    redirected: string[];
    /** True when nothing was sent at all (no recipients, or mail disabled). */
    skipped: boolean;
};

export const sendEmail = async (options: EmailOptions): Promise<SendEmailResult> => {
    try {
        const templateFn = emailTemplates[options.template];
        if (!templateFn) {
            throw new Error(`Email template '${options.template}' not found`);
        }

        let html = templateFn(options.data);
        let recipients = parseRecipientList(options.to);
        if (recipients.length === 0) {
            throw new Error('sendEmail: no recipient addresses in `to`');
        }

        const intendedTo = recipients.join(', ');
        // Hoisted so both transports can report it: which intended addresses MAIL_TEST replaced.
        let redirectedIntended: string[] = [];
        // CC is partitioned like `to`: a CC'd address that is not on the allowlist is dropped from
        // the message rather than quietly receiving test mail. It is NOT redirected to the sink —
        // the sink is already on `to`, and adding it again would duplicate the copy.
        let ccRecipients = parseRecipientList(options.cc ?? '');
        let bccExtra = getAdditionalBcc([...recipients, ...ccRecipients]);
        let subject = options.subject;

        // Applies whether or not MAIL_TEST is on: on UAT the mail is real, the request is not. The
        // subject is stamped here; the banner waits until MAIL_TEST has settled who actually gets
        // the message, so the list it prints is the one that was really used.
        const envLabel = getMailEnvLabel();
        if (envLabel) {
            subject = `${envLabel} ${subject}`;
        }

        if (isMailTestMode()) {
            const allowlist = getMailTestAllowlist();
            const { allowed, redirected } = partitionByAllowlist(recipients, allowlist);

            if (ccRecipients.length > 0) {
                const cc = partitionByAllowlist(ccRecipients, allowlist);
                if (cc.redirected.length > 0) {
                    console.log(
                        `[MAIL_TEST] withheld CC: ${cc.redirected.join(', ')} (not on the allowlist)`
                    );
                }
                ccRecipients = cc.allowed;
            }

            if (redirected.length > 0) {
                const testRecipients = getMailTestToRecipients();
                if (testRecipients.length === 0) {
                    throw new Error(
                        'MAIL_TEST is enabled but AZURE_MAIL_TO is empty. Set AZURE_MAIL_TO to the address that should receive redirected test mail.'
                    );
                }
                // Anything not on the allowlist goes to the sink, carrying a note naming who it
                // would really have reached — so routing stays checkable without mailing them.
                html = `${html}${intendedRecipientNotice(redirected.join(', '))}`;
                recipients = [...allowed, ...testRecipients];
                redirectedIntended = redirected;
                console.log(
                    `[MAIL_TEST] ${allowed.length ? `delivered to ${allowed.join(', ')}; ` : ''}` +
                        `redirected ${redirected.join(', ')} → ${testRecipients.join(', ')}` +
                        (bccExtra.length ? ` (skipped BCC: ${bccExtra.join(', ')})` : '')
                );
            } else {
                // Every recipient is on the allowlist, so this message routes exactly as production
                // would. That is the point of the allowlist.
                console.log(`[MAIL_TEST] delivered as production would, to ${intendedTo}`);
            }

            /**
             * Keep the audit address copied on anything that reached a real recipient.
             *
             * Under MAIL_TEST the BCC used to be dropped outright. That is right for a message that
             * was redirected — it is already going to the sink — but wrong once an allowlist is in
             * play: those messages go to real people, and whoever is running the test needs a copy
             * of what was actually sent. So the BCC survives exactly when something was delivered
             * for real and the audit address is not already on it.
             *
             * With no allowlist set (every recipient redirected) this is a no-op.
             */
            bccExtra = allowed.length > 0 ? getAdditionalBcc(recipients) : [];
            subject = `[MAIL_TEST] ${subject}`;
        }

        /*
         * No body banner. Every recipient is really copied now that MAIL_TEST is off, so the block
         * that explained the redirect and re-listed the intended recipients was describing a
         * situation that no longer happens - and on a message that otherwise looks exactly like a
         * production one, a caveat about "how this would work in production" is just noise.
         *
         * The subject keeps its MAIL_ENV_LABEL prefix. That is deliberately the ONLY marker: it says
         * which environment sent the message without changing anything a recipient would act on.
         * environmentNotice is kept for the MAIL_TEST path, where recipients really are substituted.
         */

        if (isAzureGraphEmailConfigured()) {
            await sendMailViaGraph({
                toRecipients: recipients,
                ccRecipients,
                bccRecipients: bccExtra,
                subject,
                body: html,
                contentType: 'HTML',
            });
            const ccNote = ccRecipients.length ? `; CC ${ccRecipients.join(', ')}` : '';
            const bccNote = bccExtra.length ? `; BCC ${bccExtra.join(', ')}` : '';
            console.log(`Email sent (Microsoft Graph) to ${recipients.join(', ')}${ccNote}${bccNote}`);
            return {
                delivered: [...recipients],
                deliveredCc: [...ccRecipients],
                redirected: redirectedIntended,
                skipped: false,
            };
        }

        if (!isSmtpConfigured()) {
            throw new Error(
                'Email not configured: set Azure Graph (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_MAIL_FROM) or SMTP (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM).'
            );
        }

        const toField = recipients.join(', ');
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'Japan Automation <noreply-japauto@example.com>',
            to: toField,
            ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
            ...(bccExtra.length > 0 ? { bcc: bccExtra } : {}),
            subject,
            html,
        });

        const ccNote = ccRecipients.length ? `; CC ${ccRecipients.join(', ')}` : '';
        const bccNote = bccExtra.length ? `; BCC ${bccExtra.join(', ')}` : '';
        console.log(`Email sent (SMTP): ${info.messageId} to ${toField}${ccNote}${bccNote}`);
        return {
            delivered: [...recipients],
            deliveredCc: [...ccRecipients],
            redirected: redirectedIntended,
            skipped: false,
        };
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

/** True when Graph env vars are set (Graph takes precedence over SMTP in sendEmail). */
export { isAzureGraphEmailConfigured };


