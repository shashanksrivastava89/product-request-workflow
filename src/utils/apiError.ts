/**
 * Parse API error responses into user-facing messages and field-level errors.
 */

type ZodIssue = { path?: (string | number)[]; message?: string };

const FIELD_LABELS: Record<string, string> = {
  businessGroup: 'Business group',
  firstDigit: 'Customer type',
  code: 'Code',
  sapCode: 'SAP code',
  name: 'Name (English)',
  nameJp: 'Name (Japanese)',
  nameEn: 'Name (English)',
  productNameLocal: 'Product name (local)',
  price: 'Price',
  listPrice: 'List price',
  postalCode: 'Postal code',
  prefecture: 'Prefecture',
  address: 'Address',
  phone: 'Phone',
};

function fieldLabel(path: (string | number)[] | undefined): string {
  const key = path?.[0];
  if (typeof key === 'string' && FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (path?.length) return path.map(String).join(' → ');
  return 'Form';
}

function formatZodIssues(details: ZodIssue[]): string {
  return details
    .map((issue) => `${fieldLabel(issue.path)}: ${issue.message || 'Invalid value'}`)
    .join(' · ');
}

function getResponseData(e: unknown): Record<string, unknown> | undefined {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}

export function extractApiError(e: unknown, fallback = 'Request failed'): string {
  const data = getResponseData(e);
  if (!data) {
    const msg = (e as { message?: string })?.message;
    return msg?.trim() || fallback;
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }

  if (typeof data.error === 'string') {
    if (data.error === 'Validation error' && Array.isArray(data.details)) {
      const formatted = formatZodIssues(data.details as ZodIssue[]);
      return formatted || 'Please fix the highlighted fields and try again.';
    }
    if (data.error === 'Duplicate record') {
      const target = Array.isArray(data.details) ? data.details.join(' + ') : '';
      return target
        ? `A record with the same ${target} already exists.`
        : 'This record already exists in the database.';
    }
    return data.error;
  }

  return fallback;
}

export function mapApiFieldErrors(e: unknown): Record<string, string> {
  const data = getResponseData(e);
  if (data?.error !== 'Validation error' || !Array.isArray(data.details)) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const issue of data.details as ZodIssue[]) {
    const key = issue.path?.[0];
    if (typeof key === 'string' && issue.message) {
      fields[key] = issue.message;
    }
  }
  return fields;
}
