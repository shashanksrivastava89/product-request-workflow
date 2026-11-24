/**
 * Reference number format: PREFIX-BU-YYYY-TIMESTAMP{D}
 * PREFIX is a Japanese label + form code in parentheses.
 * {D} is the first decimal digit in salesRepCodeSap, or 0 if none.
 * Examples:
 *   ZSAM, rep "X12":   サンプル用(ZSAM)-CDG-2026-1430251
 *   ZNC, rep "AB":     機器設置用(ZNC)-CDG-2026-1430250
 *   ZNCCLAIM, rep "9": クレーム対応(ZNC)-CDG-2026-1430259
 *   ZINT, no digits:   QC用(ZINT)-CDG-2026-1430250
 */
/** Japanese label + code in parentheses — used in reference numbers and order-taking / print Type field. */
export const FORM_TYPE_DISPLAY_LABELS: Record<string, string> = {
    ZSAM: 'サンプル用(ZSAM)',
    ZNC: '機器設置用(ZNC)', // Installation
    ZNCCLAIM: 'クレーム対応(ZNC)', // Claim replacement
    ZINT: 'QC用(ZINT)', // QC test
    RETURN: '返品(RETURN)', // Product return
};

const REFERENCE_PREFIX = FORM_TYPE_DISPLAY_LABELS;

export function formTypeDisplayLabel(formType?: string | null): string {
    const code = String(formType ?? '').trim();
    return FORM_TYPE_DISPLAY_LABELS[code] ?? (code || '—');
}

/** First digit (0-9) in sales rep SAP code, left to right; if none, "0". */
export function firstDigitFromSalesRepCode(salesRepCodeSap?: string | null): string {
    const s = String(salesRepCodeSap ?? '').trim();
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c >= '0' && c <= '9') return c;
    }
    return '0';
}

export const generateReferenceNumber = (
    formType: string,
    businessUnit: string,
    salesRepCodeSap?: string | null
): string => {
    const now = new Date();
    const currentYear = now.getFullYear();

    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const timestamp = `${hours}${minutes}${seconds}`;

    const prefix = REFERENCE_PREFIX[formType] ?? formType;
    const repDigit = firstDigitFromSalesRepCode(salesRepCodeSap);
    const referenceNumber = `${prefix}-${businessUnit}-${currentYear}-${timestamp}${repDigit}`;

    console.log(`✅ Generated reference number: ${referenceNumber}`);

    return referenceNumber;
};
