/**
 * Product Code and SAP Code, formatted for display.
 *
 * Vidhi Parsons, 8 Sep: "Could you add always Product name is with Product Code and SAP Code in
 * case of CDG. … When we check the submit it is SAP code. Please use always both product code and
 * SAP code in CDG. One part use Product code, the other use SAP code are very mess."
 *
 * The rule, stated plainly (17 Sep): **CDG always shows both codes; LSG shows only the local product
 * code, because LSG materials have no SAP number.**
 *
 * This used to be guessed from `sapCode !== productCode` rather than asked of the request. The guess
 * is wrong for CDG far more often than anyone realised: the product importer copies the local code
 * into `sapCode` for any sheet without a SAP column (validate-products.ts), and on UAT that is true
 * of **4,192 of 5,776 CDG catalogue rows** — so for 73% of CDG products every screen and every mail
 * decided "no SAP code" and hid it. That is exactly what Japan reported.
 *
 * So the unit now comes from the request (`form.businessUnit`, always CDG or LSG on a real form) and
 * a CDG line whose SAP code merely repeats the local one shows a dash. A dash says "we do not have
 * this number", which is true and fixable; repeating the local code under a SAP label would present
 * a number that is not a SAP number at all.
 */

export type ProductCodeSource = {
  productCode?: string | null;
  sapCode?: string | null;
  /**
   * Some call sites reached for `code`, which is not a field on a stored product row — the print
   * view did, and silently rendered a dash whenever `sapCode` was empty. Accepted here so that
   * mistake cannot blank a code again.
   */
  code?: string | null;
};

/** CDG, LSG, or anything else we cannot classify (a legacy draft). */
export type ProductCodeUnit = string | null | undefined;

/** True when this request's products carry a SAP number at all. LSG materials do not. */
export function unitHasSapCode(unit: ProductCodeUnit): boolean {
  return String(unit ?? '').trim().toUpperCase() !== 'LSG';
}

/**
 * The two codes as they should be displayed for this business unit.
 *
 * `sap` is empty when the unit has none (LSG) or when the stored value merely repeats the local
 * code, which means the real SAP number was never imported. Callers that want to show CDG's missing
 * SAP number as a dash use `sapMissing`.
 */
export function productCodeParts(
  p: ProductCodeSource | null | undefined,
  unit?: ProductCodeUnit
): { code: string; sap: string; sapMissing: boolean } {
  const code = String(p?.productCode ?? p?.code ?? '').trim();
  const raw = String(p?.sapCode ?? '').trim();
  const real = raw && raw !== code ? raw : '';

  // No unit given: fall back to the old behaviour rather than inventing an answer. A surface that
  // genuinely cannot know the unit still renders what it always did.
  if (unit === undefined) return { code, sap: real, sapMissing: false };

  if (!unitHasSapCode(unit)) return { code, sap: '', sapMissing: false };
  return { code, sap: real, sapMissing: !real };
}

/** `Code: 45678 · SAP: 1234567`, a single labelled code, or the dash when there is neither. */
export function formatProductCodes(
  p: ProductCodeSource | null | undefined,
  dash = '—',
  unit?: ProductCodeUnit
): string {
  const { code, sap, sapMissing } = productCodeParts(p, unit);
  const parts: string[] = [];
  if (code) parts.push(`Code: ${code}`);
  if (sap) parts.push(`SAP: ${sap}`);
  else if (sapMissing) parts.push(`SAP: ${dash}`);
  return parts.length > 0 ? parts.join(' · ') : dash;
}
