/**
 * Display labels for the two coded return fields, so emails and printed views can show what the
 * requester actually picked instead of the stored code.
 *
 * These mirror src/constants/returnTypes.ts and src/constants/returnOrderReasons.ts. The wizard
 * stores the code, not the label, so the two lists have to agree — keep them in sync when the
 * options change. The labels are already bilingual (or Japanese-only, for return types), which is
 * what the Japanese reviewers asked for, so the same string serves the English and Japanese mail
 * templates alike.
 *
 * An unknown code falls back to the code itself rather than an empty cell: better a raw ZRE in the
 * email than a blank row that reads as "not filled in".
 */

export const RETURN_TYPE_LABELS: Record<string, string> = {
    ZCMR_ZDMR: '伝票処理のみ (赤黒伝票)：ZCMR/ZDMR',
    ZCMR: '伝票処理のみ (赤伝票)：ZCMR',
    ZRE: '商品返品：ZRE',
    ZRE_ZOR: '商品返品/代品出荷：ZRE/ZOR',
};

export const RETURN_ORDER_REASON_LABELS: Record<string, string> = {
    PRODUCT_COMPLAINT: '製品不良 / Product Complaint',
    DC_ERROR: '倉庫の出荷ミス / DC Error',
    CARRIER_ERROR: '配送業者の配送取扱ミス / Carrier Error',
    CSR_ERROR: '受注入力ミス / CSR Error Data Entry',
    SALES_ERROR: '営業案内ミス / Sales Error',
    CUSTOMER_ERROR: '代理店またはユーザーの発注ミス / Customer Error',
    IT_SYSTEM: 'SAP/システム障害 / IT/System issue',
    OTHER: 'その他 / Other',
};

export function returnTypeLabel(code?: string | null): string {
    const key = String(code ?? '').trim();
    if (!key) return '';
    return RETURN_TYPE_LABELS[key] ?? key;
}

export function returnOrderReasonLabel(code?: string | null): string {
    const key = String(code ?? '').trim();
    if (!key) return '';
    return RETURN_ORDER_REASON_LABELS[key] ?? key;
}

/**
 * What each step of a return chain is called, by its position in the final chain.
 *
 * approval_chain_config labels rows by mapping field — its level 2 row is "2nd Approver" because it
 * reads secondApprover. But blanks, the requester themselves and repeats are dropped before the
 * chain is built, so a requester whose first_approver cell is empty has the *second* approver
 * standing at position one. renumberSequentialLevels already fixes the level; without this the
 * label was left behind, and the approval record read "Level 1 — 2nd Approver".
 *
 * The wizard's step-3 preview has always numbered by position (RETURN_APPROVER_STEP_LABELS in
 * ReturnWizard.tsx). Now that a return actually submits, the email an approver receives has to
 * agree with the preview the requester signed off — so both number by position, and these two
 * lists have to stay in step.
 *
 * Emi is still settling the final wording; when it changes, change it in both places.
 */
export const RETURN_APPROVER_STEP_LABELS = [
    '1st Approver',
    '2nd Approver',
    '3rd Approver',
    '4th Approver',
    '5th Approver',
];

/**
 * The review step's label. Named, not numbered: it is not an approval, and numbering it would push
 * a service request's real first approver to "2nd Approver".
 */
export const RETURN_REVIEWER_ROLE_LABEL = 'Reviewer';

/**
 * Whether the service review step is live.
 *
 * Off by default. The step itself works end to end — it is created, notified, actionable and
 * audited — but the reviewer has no screen to *edit* a request during the window yet, which is the
 * reason it exists. Shipping it enabled would put a step in front of every service return that a
 * reviewer can only pass through, so it stays dark until the edit screen lands.
 *
 * Set `RETURN_REVIEW_STEP_ENABLED=true` to turn it on. Nothing else needs changing: the chain-config
 * row, the mapping column, the audit table and the approver-side display all remain in place.
 */
export function isReturnReviewStepEnabled(): boolean {
    return (process.env.RETURN_REVIEW_STEP_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function isReturnReviewerRole(role: string | undefined | null): boolean {
    return String(role ?? '').trim().toLowerCase() === RETURN_REVIEWER_ROLE_LABEL.toLowerCase();
}

/**
 * Relabel a return chain by position, leaving any review step named.
 *
 * `approverOrdinal` counts approvals only, so a service request reads
 * Reviewer -> 1st Approver -> 2nd Approver, not Reviewer -> 2nd -> 3rd.
 */
export function relabelReturnChain<T extends { role: string }>(steps: T[]): T[] {
    let approverOrdinal = 0;
    return steps.map((step) => {
        if (isReturnReviewerRole(step.role)) {
            return { ...step, role: RETURN_REVIEWER_ROLE_LABEL };
        }
        const role = RETURN_APPROVER_STEP_LABELS[approverOrdinal] ?? step.role;
        approverOrdinal += 1;
        return { ...step, role };
    });
}
