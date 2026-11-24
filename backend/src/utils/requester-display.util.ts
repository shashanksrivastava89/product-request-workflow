/**
 * Format requester for emails: "NAME (SAP_CODE)" when code is present.
 */
export function formatRequesterWithSapCode(
  requesterName: string,
  sapCode?: string | null
): string {
  const name = String(requesterName ?? '').trim();
  const code = String(sapCode ?? '').trim();
  if (!name) return code;
  if (!code) return name;
  return `${name} (${code})`;
}
