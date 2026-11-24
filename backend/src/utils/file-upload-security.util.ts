/**
 * Shared upload security helpers (client filename sanitization, content safety scan).
 */

const SCAN_BYTES = 8192;

const DANGEROUS_CONTENT = [
  /<\?php/i,
  /<\?=/,
  /<script\b/i,
  /<%[\s=@]/i,
  /\beval\s*\(/i,
  /\bbase64_decode\s*\(/i,
];

export function sanitizeClientFilename(name: string): string {
  const stripped = name.replace(/\0/g, '').replace(/[/\\]/g, '_').trim();
  return stripped.slice(0, 200) || 'upload';
}

function scanLength(buf: Buffer): number {
  return Math.min(buf.length, SCAN_BYTES);
}

export function containsDangerousContent(buf: Buffer): boolean {
  const slice = buf.subarray(0, scanLength(buf));
  const asUtf8 = slice.toString('utf8');
  const asLatin1 = slice.toString('latin1');
  return DANGEROUS_CONTENT.some((re) => re.test(asUtf8) || re.test(asLatin1));
}
