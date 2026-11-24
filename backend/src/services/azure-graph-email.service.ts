/**
 * Send email via Microsoft Graph API (OAuth2 client credentials).
 * Requires an app registration with Mail.Send application permission and admin consent.
 *
 * Env: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_MAIL_FROM
 * (AZURE_MAIL_FROM must be a mailbox the app may send as — Graph uses /users/{id}/sendMail)
 */

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID ?? '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';
const AZURE_MAIL_FROM = process.env.AZURE_MAIL_FROM ?? '';

const TOKEN_URL = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
const SENDER_ENCODED = () => encodeURIComponent(AZURE_MAIL_FROM);
const sendMailUrl = () =>
  `https://graph.microsoft.com/v1.0/users/${SENDER_ENCODED()}/sendMail`;

export function isAzureGraphEmailConfigured(): boolean {
  return Boolean(
    AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET && AZURE_MAIL_FROM
  );
}

export async function getAzureGraphAccessToken(): Promise<string> {
  if (!isAzureGraphEmailConfigured()) {
    throw new Error(
      'Azure email not configured: set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_MAIL_FROM'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok) {
    throw new Error(`Azure token request failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  const token = data.access_token;
  if (!token) {
    throw new Error('Could not parse access_token from Azure token response.');
  }
  return token;
}

export type GraphSendMailOptions = {
  toRecipients: string[];
  /**
   * Optional CC. Unlike BCC these addresses are visible to every recipient, which is the point:
   * Vidhi Parsons asked to see who a final approval went to, and an invisible audit BCC could not
   * show him.
   */
  ccRecipients?: string[];
  /** Optional BCC (e.g. audit mailbox from AZURE_MAIL_TO); omitted when empty */
  bccRecipients?: string[];
  subject: string;
  body: string;
  /** @default 'HTML' for transactional templates */
  contentType?: 'Text' | 'HTML';
  /** If true, message is saved to sender's Sent Items (Graph default behavior in sample) */
  saveToSentItems?: boolean;
};

/**
 * Send one email via Graph sendMail.
 */
function graphRecipientObjects(addresses: string[]) {
  return addresses.map((address) => ({
    emailAddress: {
      address,
      name: (address && address.split('@')[0]) || 'Recipient',
    },
  }));
}

export async function sendMailViaGraph(opts: GraphSendMailOptions): Promise<void> {
  const {
    toRecipients,
    ccRecipients = [],
    bccRecipients = [],
    subject,
    body,
    contentType = 'HTML',
    saveToSentItems = true,
  } = opts;
  if (!toRecipients || toRecipients.length === 0) {
    throw new Error('sendMailViaGraph: toRecipients is required and must not be empty');
  }
  if (!isAzureGraphEmailConfigured()) {
    throw new Error('Azure email not configured; cannot send via Graph.');
  }

  const token = await getAzureGraphAccessToken();
  const toRecipientsPayload = graphRecipientObjects(toRecipients);
  const ccPayload =
    ccRecipients.length > 0 ? graphRecipientObjects(ccRecipients) : undefined;
  const bccPayload =
    bccRecipients.length > 0 ? graphRecipientObjects(bccRecipients) : undefined;

  const message: Record<string, unknown> = {
    subject: subject || '(No subject)',
    body: {
      contentType: contentType === 'HTML' ? 'HTML' : 'Text',
      content: body ?? '',
    },
    toRecipients: toRecipientsPayload,
  };
  if (ccPayload) {
    message.ccRecipients = ccPayload;
  }
  if (bccPayload) {
    message.bccRecipients = bccPayload;
  }

  const payload = {
    message,
    saveToSentItems,
  };

  const res = await fetch(sendMailUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (res.status !== 202) {
    throw new Error(`Graph sendMail failed (HTTP ${res.status}): ${text || res.statusText}`);
  }
}
