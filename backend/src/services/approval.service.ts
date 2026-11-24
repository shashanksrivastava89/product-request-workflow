import { PrismaClient } from '@prisma/client';
import { SalesForm, User } from './db.service';
import { prismaService } from './prisma.service';
import { sendEmail, parseRecipientList, SendEmailResult } from './email.service';
import { getUserHierarchy } from './hierarchy.service';
import { getZncApprovers, getZncclaimApprovers, getZintApprovers, getZsamApproversForMerge, getReturnApproversForMerge, resolveRequesterTeamName } from './static-data.service';
import { generateApprovalToken, calculateTokenExpiration, generateApprovalUrl, generateApprovalViewUrl } from '../utils/token.util';
import { formatRequesterWithSapCode } from '../utils/requester-display.util';
import {
    nationalSalesManagerSlotRoleLabel,
    zsamOrZncClaimSalesManagerRoleLabel,
} from '../utils/zncclaim-role-label.util';
import { formatApprovalAssigneeLine } from '../utils/approval-display.util';
import { hasServiceAdminPrivileges, hasSuperApproverPrivileges } from '../utils/auth-roles.util';
import { FORM_TYPE_DISPLAY_LABELS, formTypeDisplayLabel } from './reference.service';
import { isReturnReviewerRole, relabelReturnChain, returnTypeLabel } from '../constants/return-form.constants';
import { listReviewEdits } from './form-review-edit.service';
import { findUserByName, resolveNamedRequester } from './named-requester.service';
import { lastRejection } from './form-reopen.service';
import { applyZintDeliveryDisplayFields } from '../utils/zint-form-display.util';
import type { MailChainStep } from '../utils/email.templates';
import { countFormAttachments } from './form-attachment.service';
import {
    clearSelfFromReturnApprovers,
    dropRepeatApprovers,
    looksLikeApproverEmail,
    skipSelfApprovers,
} from '../utils/return-approval.util';

const prisma = new PrismaClient();

async function attachmentEmailFields(
    form: SalesForm,
    approvalToken?: string | null
): Promise<{ attachmentCount: number; attachmentsViewUrl: string | null }> {
    if (form.formType !== 'ZNCCLAIM') {
        return { attachmentCount: 0, attachmentsViewUrl: null };
    }
    const attachmentCount = await countFormAttachments(form.id);
    if (attachmentCount <= 0) {
        return { attachmentCount: 0, attachmentsViewUrl: null };
    }
    const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(
        /\/$/,
        ''
    );
    const attachmentsViewUrl = approvalToken
        ? `${generateApprovalViewUrl(baseUrl, approvalToken)}#attachments`
        : `${baseUrl}/approvals/${form.id}#attachments`;
    return { attachmentCount, attachmentsViewUrl };
}

/**
 * Form-detail fields every email template renders: delivery partners plus, for a RETURN, what the
 * return itself is about. ZINT QC uses fixed sold-to and display-only end-user text.
 *
 * One helper spread at every send site, so a new field reaches the request, notification, approved,
 * rejected and cancelled mails together instead of one template at a time. The return fields render
 * only when formType is RETURN, so the four sample types are unaffected.
 */
async function emailFormDetailFieldsFromForm(form: SalesForm) {
    const normalized = applyZintDeliveryDisplayFields({
        formType: form.formType,
        soldToName: form.soldToName,
        soldToCode: form.soldToCode,
        shipToName: form.shipToName,
        shipToCode: form.shipToCode,
        attentionTo: form.attentionTo,
        endUserName: form.endUserName,
        endUserCode: form.endUserCode,
        deliveryMode: form.deliveryMode,
        expectedDeliveryDate: form.expectedDeliveryDate,
    });
    return {
        soldToName: normalized.soldToName,
        soldToCode: normalized.soldToCode,
        shipToName: normalized.shipToName,
        shipToCode: normalized.shipToCode,
        attentionTo: normalized.attentionTo,
        endUserName: normalized.endUserName,
        endUserCode: normalized.endUserCode,
        deliveryMode: normalized.deliveryMode,
        expectedDeliveryDate: normalized.expectedDeliveryDate,
        returnType: form.returnType,
        isService: form.isService === true,
        originalOrderNumber: form.originalOrderNumber,
        invoiceDate: form.invoiceDate,
        // The whole list, not just the first. A standing order carries one date per billing period
        // and every mail was showing only invoiceDates[0].
        invoiceDates: await prismaService.findFormInvoiceDates(form.id),
        isStandingOrder: (form as any).isStandingOrder === true,
        // CDG shows both product codes, LSG only the local one - the mails had no way to tell.
        // Its own name because the order-taking mail's `businessUnit` is the DESK (SERVICE for a
        // service return), which is not the catalogue the products came from.
        productCodeUnit: form.businessUnit,
        quoteRefNo: form.quoteRefNo,
        orderReason: form.orderReason,
        justification: form.justification,
        dairitenContactName: form.dairitenContactName,
        dairitenContactEmail: form.dairitenContactEmail,
        // What the Service Admin team corrected at review, so an approver is not signing off
        // figures the requester never submitted. Empty for everything but a return.
        reviewEdits: form.formType === 'RETURN' ? await listReviewEdits(form.id) : [],
    };
}

/** Email/UI line: NAME (SAP code) from form snapshot, else User.salesRepCode. */
function requesterDisplayForForm(form: SalesForm, requesterUser?: User | null): string {
    const fromForm = form.salesRepCodeSap?.trim();
    const fromUser = requesterUser?.salesRepCode?.trim();
    const code = fromForm || fromUser || '';
    return formatRequesterWithSapCode(form.requesterName, code || undefined);
}

/**
 * The subject of the [Order-taking] Approved mail.
 *
 * A return's used to name the form type twice - its reference number starts with 返品(RETURN) and
 * the subject repeated it - while the type Customer Service keys by is the return type. Damian Diggin
 * (30 Sep 2026) asked for "Approved 伝票処理のみ (赤黒伝票)：ZCMR/ZDMR -CDG-2026-0112589 — MEKHALA
 * MONKS (9002311)", which is what this gives, to the character. With no return type recorded,
 * and for every sample, the subject is exactly what it was.
 */
export function orderTakingApprovedSubject(
    form: Pick<SalesForm, 'id' | 'formType' | 'referenceNumber' | 'returnType'>,
    requesterDisplay: string
): string {
    const ref = form.referenceNumber || form.id.slice(0, 8);
    const typeLabel = form.formType === 'RETURN' ? returnTypeLabel(form.returnType) : '';
    if (typeLabel) {
        const prefix = FORM_TYPE_DISPLAY_LABELS.RETURN;
        const rest = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
        return `[Order-taking] Approved ${typeLabel} ${rest} — ${requesterDisplay}`;
    }
    return `[Order-taking] Approved ${ref} — ${formTypeDisplayLabel(form.formType)} — ${requesterDisplay}`;
}

/** Env var holding the order-taking inbox for a routing key. */
const ORDER_TAKING_ENV_VAR: Record<string, string> = {
    CDG: 'AZURE_CGD_MAIL_TO',
    LSG: 'AZURE_LSG_MAIL_TO',
    SERVICE: 'AZURE_SERVICE_MAIL_TO',
};

/**
 * Where a fully approved request's order-taking copy goes.
 *
 * Emi's requirement (3), "Add Service in Business Unit": a service request goes to the service team
 * rather than to its unit's order-taking desk —
 *   CDG → japan_cdgordertaking@, LSG → japan_lsgordertaking@, Service → japan_cus_care_pro_op@
 * so SERVICE is a routing key alongside the two units, fed by AZURE_SERVICE_MAIL_TO.
 *
 * Empty when the variable is missing or blank, which skips the mail rather than failing the approval.
 */
function getOrderTakingMailbox(bu: string): string[] {
    const envVar = ORDER_TAKING_ENV_VAR[bu];
    if (!envVar) return [];
    const raw = process.env[envVar];
    if (raw !== undefined && String(raw).trim() !== '') {
        return parseRecipientList(String(raw));
    }
    // MAIL_TEST: still run order-taking template; sendEmail() redirects To → AZURE_MAIL_TO only
    const mailTest = (process.env.MAIL_TEST ?? '').trim().toLowerCase();
    const testSink = process.env.AZURE_MAIL_TO?.trim();
    if ((mailTest === 'true' || mailTest === '1') && testSink) {
        return parseRecipientList(testSink);
    }
    return [];
}

/*
 * AZURE_RETURN_ALWAYS_MAIL_TO and getReturnAlwaysMailbox were removed on 17 Sep 2026.
 *
 * They added P&OP to EVERY return's order-taking handoff, which Corlett Siobhan had asked for on 8 Sep
 * ("POP has not been receiving the content-confirmation email"). The roll-out deck tells the wider
 * user base something different - 「サービス以外はカスタマーサービス宛、サービス案件はPOPチーム宛」 -
 * and that is the promise being made, so the handoff now routes on the service flag alone. The
 * variable was never set on UAT, so nothing changed there; if P&OP want sight of non-service returns
 * again, add them to AZURE_RETURN_FINAL_CC rather than reinstating a second routing rule.
 */

/**
 * People CC'd on a return's final approval, visibly.
 *
 * Vidhi Parsons, 8 Sep, listing who should receive final approvals: "(2) Damian Diggin (3) Vidhi
 * Ueashi". Until now they appeared only via AZURE_MAIL_TO, a blind BCC on every message the app
 * sends — which cannot be varied per mail and cannot show them who else got it.
 *
 * An env var rather than a constant so the list changes without a deploy.
 */
function getReturnFinalCc(): string[] {
    return parseRecipientList(process.env.AZURE_RETURN_FINAL_CC ?? '');
}

interface ApprovalLevel {
    level: number;
    role: string;
    approverName: string;
    approverEmail: string;
}

/**
 * approval_chain_config uses fixed semantic levels (SM=1, DSM=2, NSM=3…). Empty slots are skipped,
 * which can leave the first real step at level 2+ while only level 1 is set IN_PROGRESS — blocking the workflow.
 * Renumber by sort order so the first approver is always level 1.
 */
function renumberSequentialLevels(path: ApprovalLevel[]): ApprovalLevel[] {
    if (path.length === 0) return path;
    const sorted = [...path].sort((a, b) => a.level - b.level);
    return sorted.map((step, idx) => ({ ...step, level: idx + 1 }));
}

/** Row shape from approval_chain_config (raw query) */
interface ApprovalChainConfigRow {
    level: number;
    role_label: string;
    mapping_field: string;
    condition_type: string;
    amount_value: unknown;
    sort_order: number;
}

/** Load approval chain config for a form type from DB (rules in database) */
async function getApprovalChainConfig(formType: string): Promise<ApprovalChainConfigRow[]> {
    const rows = await prisma.$queryRawUnsafe<ApprovalChainConfigRow[]>(
        `SELECT level, role_label, mapping_field, condition_type, amount_value, sort_order
         FROM approval_chain_config
         WHERE form_type::text = $1
         ORDER BY level ASC, sort_order ASC`,
        formType
    );
    return rows ?? [];
}

/** Build approval path from config + hierarchy; returns empty if config missing (caller falls back to hardcoded). */

/**
 * The chain as the requester's mail shows it.
 *
 * Vidhi Parsons, 9 Sep: the per-step notification named only the approver who had just decided, so
 * the requester could not tell *"who approved and who rejected"*, nor who holds it now. The rows are
 * already loaded at both send sites, so this adds no query.
 *
 * `currentApprovalId` is the step about to be notified. Its row is still PENDING at that moment —
 * it is set to IN_PROGRESS after the mail goes out — so the stored status alone would show the next
 * approver as "not yet reached" in the very mail announcing it has reached them.
 */
function chainStepsForMail(
    approvals: Array<{ id: string; level: number; role: string; approverName: string; status: string }>,
    currentApprovalId?: string | null
): MailChainStep[] {
    return [...approvals]
        .sort((a, b) => a.level - b.level)
        .map((a) => ({
            role: a.role,
            name: a.approverName,
            state:
                a.status === 'APPROVED'
                    ? 'approved'
                    : a.status === 'REJECTED'
                      ? 'rejected'
                      : a.id === currentApprovalId || a.status === 'IN_PROGRESS'
                        ? 'current'
                        : 'pending',
            decidedAt: (a as { decidedAt?: Date | string | null }).decidedAt ?? null,
        }));
}

async function buildPathFromConfig(
    form: SalesForm,
    hierarchy: Record<string, string | undefined>,
    resolveApprover: (value: string) => Promise<{ name: string; email: string }>
): Promise<ApprovalLevel[]> {
    const configRows = await getApprovalChainConfig(form.formType);
    if (configRows.length === 0) return [];

    const totalAmount = Number(form.totalAmount);
    const path: ApprovalLevel[] = [];

    for (const row of configRows) {
        const amountVal = row.amount_value != null ? Number(row.amount_value) : null;
        let include = false;
        if (row.condition_type === 'ALWAYS') {
            include = true;
        } else if (row.condition_type === 'AMOUNT_LTE' && amountVal != null) {
            include = totalAmount <= amountVal;
        } else if (row.condition_type === 'AMOUNT_GT' && amountVal != null) {
            include = totalAmount > amountVal;
        } else if (row.condition_type === 'SERVICE_ONLY') {
            // RETURN levels 4-5: the two service managers, appended for service-related returns
            // only. This is the condition the return chain config was waiting on — see
            // seed_return_approval_chain_config.sql.
            include = form.isService === true;
        }
        if (!include) continue;

        const mappingValue = hierarchy[row.mapping_field]?.trim();
        if (!mappingValue) continue;
        // A cell holding a mailbox resolves to that team's display name, so the chain, the preview
        // and every email read "SERVICE ADMIN TEAM" rather than a raw address.
        const { name: approverName, email: approverEmail } = await resolveApprover(mappingValue);

        let roleLabel = row.role_label;
        if (
            (form.formType === 'ZNCCLAIM' || form.formType === 'ZSAM') &&
            row.mapping_field === 'salesManager'
        ) {
            roleLabel = zsamOrZncClaimSalesManagerRoleLabel(approverName);
        } else if (
            (form.formType === 'ZSAM' || form.formType === 'ZNC' || form.formType === 'ZNCCLAIM') &&
            row.mapping_field === 'nationalSalesManager'
        ) {
            roleLabel = nationalSalesManagerSlotRoleLabel(form.formType, approverName);
        }

        path.push({
            level: row.level,
            role: roleLabel,
            approverName,
            approverEmail,
        });
    }
    return path;
}

/**
 * Calculate approval path based on form type and total amount.
 * Uses approval_chain_config when present; otherwise falls back to hardcoded rules.
 */
export const calculateApprovalPath = async (form: SalesForm): Promise<ApprovalLevel[]> => {
    // Build hierarchy (form + getUserHierarchy if needed)
    let salesManager = form.salesManager;
    let districtSalesManager = form.districtSalesManager;
    let nationalSalesManager = form.nationalSalesManager;
    let localFinanceController = form.localFinanceController;
    let directorCommercialManager = form.directorCommercialManager;
    let technicalManager = (form as any).technicalManager;
    let nationalTSManager = (form as any).nationalTSManager;
    let csPsManager = (form as any).csPsManager;
    let raqaManager = (form as any).raqaManager;
    let globalRaqaManager = (form as any).globalRaqaManager;

    const needHierarchy =
        form.formType !== 'RETURN' &&
        form.requesterName &&
        (!salesManager ||
            !districtSalesManager ||
            (form.formType === 'ZNC' && (!nationalSalesManager || !technicalManager || !nationalTSManager)) ||
            (form.formType === 'ZNCCLAIM' &&
                (!nationalSalesManager || !csPsManager || (!raqaManager && !globalRaqaManager))) ||
            (form.formType === 'ZINT' && !csPsManager && !raqaManager && !globalRaqaManager));
    if (needHierarchy) {
        // Visible, not silent. When a sample requester has no row in their mapping table the chain
        // quietly falls back to the reporting hierarchy, so a form can be built with approvers
        // nobody chose and no error is raised. That is what a Return-only person selected on a
        // sample order used to do. The behaviour is unchanged here — only now it says so.
        console.warn(
            `[approval chain] no ${form.formType} mapping row for requester "${form.requesterName}" ` +
                `(BU ${form.businessUnit ?? '-'}); falling back to the reporting hierarchy`
        );
        const hierarchy = await getUserHierarchy(
            form.requesterName,
            form.businessUnit || undefined,
            form.formType === 'RETURN' ? undefined : form.formType
        );
        if (hierarchy) {
            salesManager = salesManager || hierarchy.salesManager || undefined;
            districtSalesManager = districtSalesManager || hierarchy.districtSalesManager || undefined;
            nationalSalesManager = nationalSalesManager || hierarchy.nationalSalesManager || undefined;
            localFinanceController = localFinanceController || hierarchy.localFinanceController || undefined;
            directorCommercialManager = directorCommercialManager || hierarchy.directorCommercialManager || undefined;
            technicalManager = technicalManager || hierarchy.technicalManager || undefined;
            nationalTSManager = nationalTSManager || hierarchy.nationalTSManager || undefined;
            csPsManager = csPsManager || (hierarchy as any).csPsManager || undefined;
            raqaManager = raqaManager || (hierarchy as any).raqaManager || undefined;
            globalRaqaManager = globalRaqaManager || (hierarchy as any).globalRaqaManager || undefined;
        }
    }

    // ZSAM: zsamm_approval_mapping (bulk import) is the source of truth when a row exists.
    // Cleared/null approver cells must not fall back to User hierarchy (would resurrect e.g. self-DSM).
    if (form.formType === 'ZSAM' && form.requesterName) {
        const zsam = await getZsamApproversForMerge(form.requesterName, form.businessUnit || undefined);
        if (zsam.hasMappingRow) {
            salesManager = zsam.approvers.salesManager;
            districtSalesManager = zsam.approvers.districtSalesManager;
            nationalSalesManager = zsam.approvers.nationalSalesManager;
            localFinanceController = zsam.approvers.localFinanceController;
            directorCommercialManager = zsam.approvers.directorCommercialManager;
        }
    }

    // ZNC / ZNCCLAIM: Data Management mapping tables override User + form snapshot (same as wizard).
    if (form.formType === 'ZNC' && form.requesterName) {
        const znc = await getZncApprovers(form.requesterName, form.businessUnit || undefined);
        if (znc) {
            salesManager = znc.salesManager;
            districtSalesManager = znc.districtSalesManager;
            nationalSalesManager = znc.nationalSalesManager;
            technicalManager = znc.technicalManager;
            nationalTSManager = znc.nationalTSManager;
            localFinanceController = znc.localFinanceController;
            directorCommercialManager = znc.directorCommercialManager;
        }
    }
    if (form.formType === 'ZNCCLAIM' && form.requesterName) {
        const zc = await getZncclaimApprovers(form.requesterName, form.businessUnit || undefined);
        if (zc !== undefined) {
            salesManager = zc.salesManager;
            districtSalesManager = zc.districtSalesManager;
            nationalSalesManager = zc.nationalSalesManager;
            csPsManager = zc.csPsManager;
            raqaManager = zc.raqaManager;
            globalRaqaManager = zc.globalRaqaManager;
        } else {
            salesManager = undefined;
            districtSalesManager = undefined;
            nationalSalesManager = undefined;
            csPsManager = undefined;
            raqaManager = undefined;
            globalRaqaManager = undefined;
        }
    }
    if (form.formType === 'ZINT' && form.requesterName) {
        const zint = await getZintApprovers(form.requesterName, form.businessUnit || undefined);
        if (zint) {
            salesManager = zint.salesManager;
            districtSalesManager = zint.districtSalesManager;
            nationalSalesManager = zint.nationalSalesManager;
            csPsManager = zint.csPsManager;
            raqaManager = zint.raqaManager;
            globalRaqaManager = zint.globalRaqaManager;
        } else {
            salesManager = undefined;
            districtSalesManager = undefined;
            nationalSalesManager = undefined;
            csPsManager = undefined;
            raqaManager = undefined;
            globalRaqaManager = undefined;
        }
    }

    let firstApprover: string | undefined;
    let secondApprover: string | undefined;
    let finalApprover: string | undefined;
    // Levels 4-5 are the two service managers, and apply to service-related returns only. They
    // reach a path when approval_chain_config carries SERVICE_ONLY rows for them, which is
    // evaluated against sales_forms.isService — the flag the return wizard now persists. The
    // wizard preview applies the same rule client-side; see buildReturnApproverChain.
    let fourthApprover: string | undefined;
    let fifthApprover: string | undefined;
    // The service review step, taken before any approval. Reaches a path only through the
    // SERVICE_ONLY row in approval_chain_config, so an ordinary return never gains one.
    let reviewer: string | undefined;
    if (form.formType === 'RETURN' && form.requesterName) {
        // The team as well as the unit: the matrix holds one row per sheet row, so a person listed
        // under two teams has two rows, and the request's own team decides which one routes it.
        const ret = await getReturnApproversForMerge(
            form.requesterName,
            form.businessUnit || undefined,
            await resolveRequesterTeamName(form.requesterGroup)
        );
        if (ret.hasMappingRow) {
            const cleared = clearSelfFromReturnApprovers(ret.approvers, form.requesterName);
            reviewer = cleared.reviewer;
            firstApprover = cleared.firstApprover;
            secondApprover = cleared.secondApprover;
            finalApprover = cleared.finalApprover;
            fourthApprover = cleared.fourthApprover;
            fifthApprover = cleared.fifthApprover;
        }
    }

    const hierarchyMap: Record<string, string | undefined> = {
        salesManager: salesManager ?? undefined,
        districtSalesManager: districtSalesManager ?? undefined,
        nationalSalesManager: nationalSalesManager ?? undefined,
        localFinanceController: localFinanceController ?? undefined,
        directorCommercialManager: directorCommercialManager ?? undefined,
        technicalManager: technicalManager ?? undefined,
        nationalTSManager: nationalTSManager ?? undefined,
        csPsManager: csPsManager ?? undefined,
        raqaManager: raqaManager ?? undefined,
        globalRaqaManager: globalRaqaManager ?? undefined,
        reviewer: reviewer ?? undefined,
        firstApprover: firstApprover ?? undefined,
        secondApprover: secondApprover ?? undefined,
        finalApprover: finalApprover ?? undefined,
        fourthApprover: fourthApprover ?? undefined,
        fifthApprover: fifthApprover ?? undefined,
    };

    const getApproverEmail = async (name: string): Promise<string> => {
        const user = await findUserByName(name);
        if (user?.email) return user.email;
        // Role-based email for Global RAQA (ZINT / ZNCCLAIM)
        if (name && name.trim().replace(/\s+/g, ' ').toUpperCase() === 'GLOBAL RAQA') return 'Global_RAQA@example.com';
        return `${name.trim().toLowerCase().replace(/\s+/g, '_')}@example.com`;
    };

    /** The name to show and the address to write to, for either kind of matrix cell. */
    const resolveApprover = async (value: string): Promise<{ name: string; email: string }> => {
        const raw = value.trim();
        if (looksLikeApproverEmail(raw)) {
            const byEmail = await prismaService.findUserByEmail(raw);
            return { name: byEmail?.name?.trim() || raw, email: byEmail?.email || raw };
        }
        return { name: raw, email: await getApproverEmail(raw) };
    };

    // Prefer path from config (rules in database)
    const pathFromConfig = await buildPathFromConfig(form, hierarchyMap, resolveApprover);
    if (pathFromConfig.length > 0) {
        const path =
            form.formType === 'RETURN'
                ? dropRepeatApprovers(skipSelfApprovers(pathFromConfig, form.requesterName))
                : pathFromConfig;
        const renumbered = renumberSequentialLevels(path);
        // Relabel a return chain by position, so what a step is called in the email matches what
        // the wizard's step-3 preview called it. The review step keeps its name rather than taking
        // a number. See relabelReturnChain.
        return form.formType === 'RETURN' ? relabelReturnChain(renumbered) : renumbered;
    }

    // Fallback: hardcoded rules (when approval_chain_config is empty)
    const approvalPath: ApprovalLevel[] = [];
    if (form.formType !== 'ZINT') {
        if (salesManager) {
            const smRole =
                form.formType === 'ZNCCLAIM' || form.formType === 'ZSAM'
                    ? zsamOrZncClaimSalesManagerRoleLabel(salesManager)
                    : 'Sales Manager';
            approvalPath.push({ level: 1, role: smRole, approverName: salesManager, approverEmail: await getApproverEmail(salesManager) });
        }
        if (districtSalesManager) {
            approvalPath.push({ level: 2, role: 'District Sales Manager', approverName: districtSalesManager, approverEmail: await getApproverEmail(districtSalesManager) });
        }
    }
    if (form.formType === 'ZSAM') {
        if (nationalSalesManager) {
            approvalPath.push({
                level: 3,
                role: nationalSalesManagerSlotRoleLabel('ZSAM', nationalSalesManager),
                approverName: nationalSalesManager,
                approverEmail: await getApproverEmail(nationalSalesManager),
            });
        }
        if (form.totalAmount > 3000000) {
            if (localFinanceController) approvalPath.push({ level: 4, role: 'Local Finance Controller', approverName: localFinanceController, approverEmail: await getApproverEmail(localFinanceController) });
            if (directorCommercialManager) approvalPath.push({ level: 5, role: 'Director, Commercial Manager', approverName: directorCommercialManager, approverEmail: await getApproverEmail(directorCommercialManager) });
        }
    } else if (form.formType === 'ZNC') {
        if (nationalSalesManager) {
            approvalPath.push({
                level: 3,
                role: nationalSalesManagerSlotRoleLabel('ZNC', nationalSalesManager),
                approverName: nationalSalesManager,
                approverEmail: await getApproverEmail(nationalSalesManager),
            });
        }
        if (technicalManager) approvalPath.push({ level: 4, role: 'Technical Manager', approverName: technicalManager, approverEmail: await getApproverEmail(technicalManager) });
        if (nationalTSManager) approvalPath.push({ level: 5, role: 'National TS Manager', approverName: nationalTSManager, approverEmail: await getApproverEmail(nationalTSManager) });
        if (form.totalAmount > 3000000) {
            if (localFinanceController) approvalPath.push({ level: 6, role: 'Local Finance Controller', approverName: localFinanceController, approverEmail: await getApproverEmail(localFinanceController) });
            if (directorCommercialManager) approvalPath.push({ level: 7, role: 'Director, Commercial Manager', approverName: directorCommercialManager, approverEmail: await getApproverEmail(directorCommercialManager) });
        }
    } else if (form.formType === 'ZNCCLAIM') {
        if (nationalSalesManager) {
            approvalPath.push({
                level: 3,
                role: nationalSalesManagerSlotRoleLabel('ZNCCLAIM', nationalSalesManager),
                approverName: nationalSalesManager,
                approverEmail: await getApproverEmail(nationalSalesManager),
            });
        }
        if (csPsManager) approvalPath.push({ level: 4, role: 'CS/PS Manager', approverName: csPsManager, approverEmail: await getApproverEmail(csPsManager) });
        const zncClaimRaqaSplitYen = 1_500_000;
        if (raqaManager) approvalPath.push({ level: 5, role: 'RAQA Manager', approverName: raqaManager, approverEmail: await getApproverEmail(raqaManager) });
        if (form.totalAmount > zncClaimRaqaSplitYen && globalRaqaManager) approvalPath.push({ level: 6, role: 'Global RAQA Manager', approverName: globalRaqaManager, approverEmail: await getApproverEmail(globalRaqaManager) });
    } else if (form.formType === 'ZINT') {
        const zintRaqaSplitYen = 1_500_000;
        if (csPsManager) approvalPath.push({ level: 1, role: 'CS/PS Manager', approverName: csPsManager, approverEmail: await getApproverEmail(csPsManager) });
        if (raqaManager) approvalPath.push({ level: 2, role: 'RAQA Manager', approverName: raqaManager, approverEmail: await getApproverEmail(raqaManager) });
        if (form.totalAmount > zintRaqaSplitYen && globalRaqaManager) {
            approvalPath.push({ level: 3, role: 'Global RAQA Manager', approverName: globalRaqaManager, approverEmail: await getApproverEmail(globalRaqaManager) });
        }
    }
    return renumberSequentialLevels(approvalPath);
};

/**
 * Create approval workflow for a submitted form
 */
export const createApprovalWorkflow = async (form: SalesForm) => {
    const approvalPath = await calculateApprovalPath(form);

    if (approvalPath.length === 0) {
        console.warn('No approvers found in form data, using admin fallback');
        approvalPath.push({
            level: 1,
            role: 'Sales Manager',
            approverName: 'Admin',
            approverEmail: 'admin@example.com'
        });
    }

    // Track the final approval level and role for this form
    const maxLevel = Math.max(...approvalPath.map(a => a.level));
    const finalStep = approvalPath.find(a => a.level === maxLevel);
    await prismaService.updateForm(form.id, {
        approvalMaxLevel: maxLevel,
        approvalFinalRole: finalStep?.role
    });

    // Fallback user when approver not in users table (Approval FK requires valid User id)
    const fallbackUser = await prismaService.findUserByEmail('admin@example.com');

    // Create approval records (do not drop levels when user is missing)
    for (const approval of approvalPath) {
        const approver =
            (await findUserByName(approval.approverName)) ??
            (looksLikeApproverEmail(approval.approverEmail)
                ? await prismaService.findUserByEmail(approval.approverEmail)
                : null);
        const approverId = approver?.id || fallbackUser?.id;
        if (!approverId) {
            throw new Error('Cannot create approval: approver not found and admin fallback user missing. Ensure admin@example.com exists.');
        }

        // Generate secure token for email-based approval
        const approvalToken = generateApprovalToken();
        const tokenExpiresAt = calculateTokenExpiration(30); // 30 days expiration

        await prismaService.createApproval({
            formId: form.id,
            approverId,
            approverName: approval.approverName,
            approverEmail: approver?.email || approval.approverEmail,
            level: approval.level,
            role: approval.role,
            status: approval.level === 1 ? 'IN_PROGRESS' : 'PENDING',
            decision: undefined,
            comments: undefined,
            approvalToken,
            tokenExpiresAt,
            notifiedAt: approval.level === 1 ? new Date().toISOString() : undefined,
            decidedAt: undefined
        });
    }

    // Send email to first approver
    const firstApproval = approvalPath[0];
    if (firstApproval) {
        // Get products for the form
        const products = await prismaService.findFormProducts(form.id);
        
        // Get the first approval record to retrieve the token (must match first step in chain, not always level 1)
        const approvals = await prismaService.findApprovalsByFormId(form.id);
        const firstApprovalRecord =
            approvals.find((a) => a.level === firstApproval.level) ??
            approvals.find((a) => a.status === 'IN_PROGRESS') ??
            [...approvals].sort((a, b) => a.level - b.level)[0];

        // Generate approval URLs (if token exists)
        const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
        const approveUrl = firstApprovalRecord?.approvalToken
            ? generateApprovalUrl(baseUrl, firstApprovalRecord.approvalToken, 'approve')
            : null;
        const rejectUrl = firstApprovalRecord?.approvalToken
            ? generateApprovalUrl(baseUrl, firstApprovalRecord.approvalToken, 'reject')
            : null;

        const requesterUserForEmail = await prismaService.findUserById(form.requesterId);
        const requesterDisplay = requesterDisplayForForm(form, requesterUserForEmail);

        const attachmentFields = await attachmentEmailFields(form, firstApprovalRecord?.approvalToken);

        // Prepare email data
        const emailData = {
            approverName: firstApproval.approverName,
            formId: form.id,
            referenceNumber: form.referenceNumber,
            formType: form.formType,
            requesterName: form.requesterName,
            requesterDisplay,
            totalAmount: form.totalAmount,
            requestDate: new Date(form.requestDate),
            level: firstApproval.level,
            role: firstApproval.role,
            // Approval links
            approveUrl,
            rejectUrl,
            ...attachmentFields,
            // Additional details
            ...(await emailFormDetailFieldsFromForm(form)),
            commentsForApproval: form.commentsForApproval,
            freeDescription: form.freeDescription,
            products: products,
            // A reopened return is back: say so, and what it was rejected for, to whoever sees it first.
            resubmittedAfter: form.formType === 'RETURN' ? lastRejection(form) ?? undefined : undefined,
        };

        // For a service return the first step IS the P&OP review, so this one mail is the matrix's
        // "Service Review Email".
        const firstIsReview = isReturnReviewerRole(firstApproval.role);
        const recipientEmail = firstApprovalRecord?.approverEmail || firstApproval.approverEmail;
        const firstTarget = await approverMailTarget({
            approverName: firstApprovalRecord?.approverName || firstApproval.approverName,
            approverEmail: recipientEmail,
        });
        console.log('📧 Preparing to send email to:', recipientEmail);
        console.log('📋 Email data summary:', {
            approver: emailData.approverName,
            requester: emailData.requesterDisplay,
            formType: emailData.formType,
            totalAmount: `¥${emailData.totalAmount.toLocaleString()}`,
            deliveryInfo: {
                soldTo: emailData.soldToName || '❌ Not provided',
                shipTo: emailData.shipToName || '❌ Not provided',
                endUser: emailData.endUserName || '❌ Not provided',
                deliveryMode: emailData.deliveryMode || '❌ Not provided'
            },
            comments: {
                commentsForApproval: emailData.commentsForApproval || '❌ Not provided',
                freeDescription: emailData.freeDescription || '❌ Not provided'
            },
            products: emailData.products.length,
            productDetails: emailData.products.map((p: any) => ({
                name: p.productName,
                code: p.productCode,
                qty: p.quantity,
                price: p.unitPrice
            }))
        });

        // Send email in background - don't block form submission (SMTP timeout can cause client timeout)
        sendEmail({
            to: firstTarget.to,
            subject: approvalRequestSubject({
                unroutedFor: firstTarget.unroutedFor,
                reviewStep: firstIsReview,
                formType: emailData.formType,
                requesterDisplay: emailData.requesterDisplay,
            }),
            template: 'approval-request-en',
            data: {
                ...emailData,
                reviewStep: firstIsReview,
                // The route, for the reviewer only - see the field's note on the template.
                chainSteps: firstIsReview ? chainStepsForMail(approvals, firstApprovalRecord?.id ?? null) : undefined,
                unroutedFor: firstTarget.unroutedFor ?? undefined,
            }
        })
            .then((r) => logSendResult(`Approval request to ${firstTarget.to}`, r))
            .catch((emailError) => console.error('⚠️ Failed to send initial approval request email:', emailError));
    }

    // Update form status
    await prismaService.updateForm(form.id, { status: 'IN_PROGRESS' });
};

/**
 * "Request Submitted" - the first row of Damian Diggin's matrix, and a mail that did not exist.
 *
 * TO the requester, CC the submitter when they are different people, so a rep knows a request was
 * raised in their name and the manager who raised it holds the receipt. It carries the route the
 * request will take, which is the question a requester actually has at this moment: for a service
 * return that begins with the P&OP review, not with an approver.
 *
 * Called by the submit controller rather than from createApprovalWorkflow, because rebuildApprovals
 * runs that same function as an admin repair on a request that was submitted long ago - which must
 * not mail anyone a fresh confirmation. Returns only; nothing in the sample flow sends this.
 */
export const sendReturnSubmissionConfirmation = async (formId: string): Promise<void> => {
    const form = await prismaService.findFormById(formId);
    if (!form || form.formType !== 'RETURN') return;

    const target = await returnMailRequester(form);
    if (!target.to) {
        console.warn(`⚠️ No requester address for ${form.referenceNumber ?? form.id}; submission confirmation skipped`);
        return;
    }

    const [products, approvals, requesterUser] = await Promise.all([
        prismaService.findFormProducts(form.id),
        prismaService.findApprovalsByFormId(form.id),
        prismaService.findUserById(form.requesterId),
    ]);
    const requesterDisplay = requesterDisplayForForm(form, requesterUser);
    const firstStep = [...approvals].sort((a, b) => a.level - b.level)[0];
    const cc = submitterCc(target);
    // A reopened return being resubmitted keeps its history; the confirmation says so.
    const resubmittedAfter = lastRejection(form) ?? undefined;

    await sendEmail({
        to: target.to,
        ...(cc.length > 0 ? { cc: cc.join(', ') } : {}),
        subject: `${resubmittedAfter ? 'Request Resubmitted' : 'Request Submitted'}: ${formTypeDisplayLabel(form.formType)} — ${requesterDisplay}`,
        template: 'request-submitted-en',
        data: {
            requesterName: form.requesterName,
            requesterDisplay,
            formId: form.id,
            referenceNumber: form.referenceNumber,
            formType: form.formType,
            totalAmount: form.totalAmount,
            requestDate: new Date(form.requestDate),
            submittedAt: form.submittedAt ? new Date(form.submittedAt) : new Date(),
            // Where it goes next. The first step is IN_PROGRESS by now, so it reads as "current".
            chainSteps: chainStepsForMail(approvals, firstStep?.id ?? null),
            ...(await emailFormDetailFieldsFromForm(form)),
            commentsForApproval: form.commentsForApproval,
            freeDescription: form.freeDescription,
            products,
            recipientsTo: [target.to],
            recipientsCc: cc,
            resubmittedAfter,
        },
    })
        .then((r) => logSendResult(`Submission confirmation to ${target.to}`, r))
        .catch((emailError) => console.error('⚠️ Failed to send submission confirmation:', emailError));
};

/**
 * If the form is IN_PROGRESS but no approval row is IN_PROGRESS (stuck workflow),
 * activate the lowest-level PENDING step so the current approver (and super approver) can act.
 * Safe to call on every GET form detail — no-op when state is already consistent.
 */
export async function reconcileMissingInProgressStep(formId: string, formStatus: string): Promise<void> {
    if (formStatus !== 'IN_PROGRESS') return;
    const all = await prismaService.findApprovalsByFormId(formId);
    if (all.length === 0) return;
    if (all.some((a) => a.status === 'IN_PROGRESS')) return;
    const sorted = [...all].sort((a, b) => a.level - b.level);
    const firstPending = sorted.find((a) => a.status === 'PENDING');
    if (!firstPending) return;
    await prismaService.updateApproval(firstPending.id, {
        status: 'IN_PROGRESS',
        notifiedAt: new Date().toISOString(),
    });
}

/**
 * Admin resend: email the current IN_PROGRESS approver (same template as initial / next-level notifications).
 */
export const sendApprovalRequestNotification = async (approvalId: string) => {
    const approval = await prismaService.findApprovalById(approvalId);
    if (!approval) {
        throw new Error('Approval not found');
    }
    if (approval.status !== 'IN_PROGRESS') {
        throw new Error('Only the active approval step can be notified');
    }

    const form = await prismaService.findFormById(approval.formId);
    if (!form) {
        throw new Error('Form not found');
    }
    if (form.status !== 'IN_PROGRESS') {
        throw new Error('Form is not in progress');
    }

    const recipientEmail = approval.approverEmail?.trim();
    if (!recipientEmail) {
        throw new Error('Approver has no email on file');
    }

    let approvalToken = approval.approvalToken;
    const tokenExpired =
        approval.tokenExpiresAt != null && new Date(approval.tokenExpiresAt).getTime() < Date.now();
    if (!approvalToken || tokenExpired) {
        approvalToken = generateApprovalToken();
        const tokenExpiresAt = calculateTokenExpiration(30);
        await prismaService.updateApproval(approvalId, { approvalToken, tokenExpiresAt });
    }

    const products = await prismaService.findFormProducts(form.id);
    const requester = await prismaService.findUserById(form.requesterId);
    const requesterDisplay = requesterDisplayForForm(form, requester);

    const allApprovals = await prismaService.findApprovalsByFormId(form.id);
    const priorApproval = allApprovals
        .sort((a, b) => a.level - b.level)
        .find((a) => a.level === approval.level - 1 && a.status === 'APPROVED');
    const previousApprover = priorApproval
        ? formatApprovalAssigneeLine({
              approverName: priorApproval.approverName,
              role: priorApproval.role,
              actualActorUserId: priorApproval.actualActorUserId,
              actualActorName: priorApproval.actualActorName,
          })
        : undefined;

    const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
    const approveUrl = generateApprovalUrl(baseUrl, approvalToken, 'approve');
    const rejectUrl = generateApprovalUrl(baseUrl, approvalToken, 'reject');

    const attachmentFields = await attachmentEmailFields(form, approvalToken);

    const emailData = {
        approverName: approval.approverName,
        formId: form.id,
        referenceNumber: form.referenceNumber,
        formType: form.formType,
        requesterName: form.requesterName,
        requesterDisplay,
        totalAmount: form.totalAmount,
        requestDate: new Date(form.requestDate),
        level: approval.level,
        role: approval.role,
        previousApprover,
        approveUrl,
        rejectUrl,
        ...attachmentFields,
        ...(await emailFormDetailFieldsFromForm(form)),
        commentsForApproval: form.commentsForApproval,
        freeDescription: form.freeDescription,
        products,
    };

    const target = await approverMailTarget(approval);
    await sendEmail({
        to: target.to,
        subject: approvalRequestSubject({
            unroutedFor: target.unroutedFor,
            reviewStep: isReturnReviewerRole(approval.role),
            formType: emailData.formType,
            requesterDisplay: emailData.requesterDisplay,
        }),
        template: 'approval-request-en',
        data: {
            ...emailData,
            reviewStep: isReturnReviewerRole(approval.role),
            chainSteps: isReturnReviewerRole(approval.role)
                ? chainStepsForMail(allApprovals, approval.id)
                : undefined,
            unroutedFor: target.unroutedFor ?? undefined,
        },
    });

    const notifiedAt = new Date().toISOString();
    const updated = await prismaService.updateApproval(approvalId, { notifiedAt });
    if (!updated) {
        throw new Error('Failed to update approval notification timestamp');
    }

    return {
        approverName: approval.approverName,
        approverEmail: recipientEmail,
        notifiedAt,
        approval: updated,
    };
};

export type ApprovalActorContext = {
    userId: string;
    role: string;
    isSuperApprover?: boolean;
    isServiceAdmin?: boolean;
};

/**
 * Log what a send actually did.
 *
 * Every notification here is fire-and-forget, and MAIL_TEST silently substitutes the sink for a
 * non-allowlisted recipient — so `.then(() => console.log('sent to ' + address))` reported
 * deliveries that never happened. This reads the result instead. Vidhi Parsons's "who receive final
 * approvals it looks not work well" was invisible in the logs for exactly this reason.
 */
function logSendResult(what: string, result: SendEmailResult): void {
    if (result.skipped) {
        console.log(`(skipped) ${what}: nothing sent`);
        return;
    }
    const cc = result.deliveredCc?.length ? ` — CC: ${result.deliveredCc.join(', ')}` : '';
    const held = result.redirected.length > 0 ? ` — REDIRECTED by MAIL_TEST, not received by: ${result.redirected.join(', ')}` : '';
    console.log(`✅ ${what} — delivered to: ${result.delivered.join(', ')}${cc}${held}`);
}


/**
 * Where a step's approval-request mail goes, and who it was meant for when that is not the same.
 *
 * The matrix names approvers by NAME, and `getApproverEmail` turns a name it cannot find into
 * `first_last@example.com` - a plausible address that has never existed. The request then sits at a
 * step whose notification bounced into nothing, and nobody is told. The blank-address case was
 * worse: `console.warn('No email for next approver, skipping notification')` and silence.
 *
 * Audited on UAT (10 Sep 2026): all 213 steps of all 90 matrix rows resolve to real mailboxes
 * today, so this changes nothing there. It is production that will name people the system does not
 * have yet - and Shashank Srivastava asked for exactly this: send it to him, and say whose mail it
 * was.
 *
 * The test for "not a real person" is that no `users` row carries the address. A synthesised
 * address never does; a shared mailbox does (the service review team's row is how that step is
 * delivered), so group addresses are unaffected. With MAIL_UNROUTED_APPROVER_TO unset the
 * behaviour is exactly as before.
 */
export async function approverMailTarget(approval: {
    approverName: string;
    approverEmail?: string | null;
}): Promise<{ to: string; unroutedFor: string | null }> {
    const address = (approval.approverEmail ?? '').trim();
    const known = address ? await prismaService.findUserByEmail(address) : null;
    if (known) return { to: address, unroutedFor: null };

    const fallback = parseRecipientList(process.env.MAIL_UNROUTED_APPROVER_TO ?? '');
    if (fallback.length === 0) {
        if (!known && address) {
            console.error(
                `[approval chain] "${approval.approverName}" <${address}> matches no user; the mail will ` +
                    `almost certainly bounce. Set MAIL_UNROUTED_APPROVER_TO to catch these.`
            );
        }
        return { to: address, unroutedFor: null };
    }

    console.error(
        `[approval chain] "${approval.approverName}"${address ? ` <${address}>` : ' (no address)'} is not a ` +
            `user in this system; sending to ${fallback.join(', ')} instead`
    );
    return { to: fallback.join(','), unroutedFor: approval.approverName };
}

/**
 * What to call the mail that asks somebody to act on a step.
 *
 * The service review is a distinct event in Damian Diggin's matrix - a pre-approval validation step -
 * but it went out under the same subject as every approver's request, so the P&OP team could not
 * find it in their mailbox by searching for what it is, and neither could we. Naming it costs
 * nothing and is the difference between a findable mail and an invisible one.
 */
function approvalRequestSubject(opts: {
    unroutedFor: string | null;
    reviewStep: boolean;
    formType: string;
    requesterDisplay: string;
}): string {
    const what = opts.reviewStep ? 'Service Review Required' : 'New Approval Request';
    return `${unroutedSubjectPrefix(opts.unroutedFor)}${what}: ${formTypeDisplayLabel(opts.formType)} - ${opts.requesterDisplay}`;
}

/** Subject marker so an unrouted notification is obvious in the operator's inbox. */
function unroutedSubjectPrefix(unroutedFor: string | null): string {
    return unroutedFor ? `[NO ACCOUNT: ${unroutedFor}] ` : '';
}

export type ReturnMailRequester = {
    /** Where a "requester" mail goes. Never empty unless the form has no submitter either. */
    to: string;
    /** The person who pressed Submit. */
    submitter: string | null;
    /** True when the submitter is somebody other than the requester, so they are worth a CC. */
    submitterDiffers: boolean;
    resolvedBy: 'requesterRow' | 'userName' | 'submitter';
};

/**
 * Who the mail matrix means by "Requester", and who actually pressed Submit.
 *
 * They are two different people, which is the correction behind this whole round: the **Requester**
 * is the name picked in the wizard's Requester field - the sales rep the request belongs to - and
 * the **Submitter** is whoever was signed in. A manager raising a request for a rep is the ordinary
 * case in Japan, and every "requester" mail used to go to `form.requesterId`, the submitter, so the
 * rep heard nothing about their own request. Damian Diggin's matrix (20 Sep) says to
 * *"resolve Approvers and Requesters emails by Name"*.
 *
 * Most specific source first: the `requesters` directory row, which carries an explicit link to a
 * user account and whose sales rep code separates two people who share a name; then a plain name
 * match over `users`; then the submitter. An unresolved name falls back and is logged rather than
 * guessed at - `getApproverEmail` synthesising `first_last@example.com` is exactly the behaviour
 * that once sent an approval request into nothing.
 *
 * Resolved at every send rather than at submission, so a reviewer correcting the requester name
 * redirects the rest of the request's mail.
 */
export async function returnMailRequester(form: SalesForm): Promise<ReturnMailRequester> {
    const submitterUser = await prismaService.findUserById(form.requesterId);
    const submitter = (submitterUser?.email ?? '').trim() || null;

    const named = String(form.requesterName ?? '').trim();
    // The same resolver the read check uses, so the person mailed is the person who can open it.
    const resolved = await resolveNamedRequester(form);
    let to = resolved?.email ?? '';
    let resolvedBy: ReturnMailRequester['resolvedBy'] = resolved?.resolvedBy ?? 'submitter';

    if (!to) {
        if (named) {
            console.error(
                `[return mail] requester "${named}" matches no account; ` +
                    `${submitter ? `sending to the submitter ${submitter} instead` : 'and there is no submitter to fall back to'}`
            );
        }
        to = submitter ?? '';
        resolvedBy = 'submitter';
    }

    return {
        to,
        submitter,
        submitterDiffers: Boolean(submitter) && submitter!.toLowerCase() !== to.toLowerCase(),
        resolvedBy,
    };
}

/** The CC list for a mail addressed to the requester: the submitter, when that is somebody else. */
function submitterCc(target: ReturnMailRequester): string[] {
    return target.submitterDiffers && target.submitter ? [target.submitter] : [];
}

/**
 * Process approval decision
 */
export const processApproval = async (
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    comments?: string,
    actor?: ApprovalActorContext
) => {
    const approval = await prismaService.findApprovalById(approvalId);

    if (!approval) {
        throw new Error('Approval not found');
    }

    if (approval.status !== 'IN_PROGRESS') {
        throw new Error('This approval is not pending your action');
    }

    const form = await prismaService.findFormById(approval.formId);
    if (!form) {
        throw new Error('Form not found');
    }

    const requester = await prismaService.findUserById(form.requesterId);
    const requesterDisplay = requesterDisplayForForm(form, requester);

    // Recorded in actualActorUserId so the trail reads "X on behalf of Y" rather than crediting a
    // decision to someone who did not make it. Two ways to act on a step you are not assigned:
    // a super approver on any step, and a Service Admin on the service review step — which is
    // addressed to a shared mailbox that nobody can sign in as.
    const actingOnBehalf =
        ((actor?.role === 'SUPER_APPROVER' || actor?.isSuperApprover === true) ||
            (isReturnReviewerRole(approval.role) &&
                hasServiceAdminPrivileges(actor?.role, actor?.isServiceAdmin))) &&
        actor != null &&
        actor.userId !== approval.approverId;

    let actualActorNameForDisplay: string | null = null;
    if (actingOnBehalf && actor.userId) {
        const actingUser = await prismaService.findUserById(actor.userId);
        actualActorNameForDisplay = actingUser?.name ?? null;
    }

    const approvalDecisionDisplayLine = formatApprovalAssigneeLine({
        approverName: approval.approverName,
        role: approval.role,
        actualActorUserId: actingOnBehalf ? actor.userId : null,
        actualActorName: actingOnBehalf ? actualActorNameForDisplay : null,
    });

    // Update approval record
    await prismaService.updateApproval(approvalId, {
        status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        decision,
        comments,
        decidedAt: new Date().toISOString(),
        actualActorUserId: actingOnBehalf ? actor.userId : null,
    });

    if (decision === 'REJECTED') {
        // Reject the entire form
        await prismaService.updateForm(approval.formId, {
            status: 'REJECTED',
            completedAt: new Date().toISOString()
        });

        // Update form status (already done above, but ensure completedAt is set)
        await prismaService.updateForm(approval.formId, { completedAt: new Date().toISOString() });

        // Get all approvals at levels below (lower level numbers) that were already approved
        const allApprovals = await prismaService.findApprovalsByFormId(approval.formId);
        const sortedApprovals = allApprovals.sort((a, b) => a.level - b.level);
        
        const previouslyApproved = sortedApprovals.filter(
            a => a.level < approval.level && a.status === 'APPROVED'
        );

        // Get products for email
        const products = await prismaService.findFormProducts(form.id);

        // Notify previously approved approvers about the rejection (non-blocking - SMTP timeout can cause API timeout)
        for (const prevApproval of previouslyApproved) {
            const prevApprover = await prismaService.findUserById(prevApproval.approverId);
            if (prevApprover && prevApprover.email) {
                sendEmail({
                    to: prevApprover.email,
                    subject: `Approval Request Cancelled: ${formTypeDisplayLabel(form.formType)} - ${requesterDisplay}`,
                    template: 'approval-cancelled-en',
                    data: {
                        approverName: prevApproval.approverName,
                        approverRole: prevApproval.role,
                        level: prevApproval.level,
                        formId: form.id,
                        referenceNumber: form.referenceNumber,
                        formType: form.formType,
                        requesterName: form.requesterName,
                        requesterDisplay,
                        rejectedBy: approvalDecisionDisplayLine,
                        rejectedByRole: approval.role,
                        rejectedAtLevel: approval.level,
                        totalAmount: form.totalAmount,
                        requestDate: new Date(form.requestDate),
                        rejectionComments: comments || 'No comments provided',
                        ...(await emailFormDetailFieldsFromForm(form)),
                        commentsForApproval: form.commentsForApproval,
                        freeDescription: form.freeDescription,
                        products: products
                    }
                })
                    .then((r) => logSendResult(`Cancellation to ${prevApprover.email} (Level ${prevApproval.level} - ${prevApproval.approverName})`, r))
                    .catch((emailError) => console.error(`⚠️ Failed to send cancellation email to Level ${prevApproval.level} (${prevApproval.approverName}):`, emailError));
            }
        }

        /*
         * The rejection goes to the Requester, with the Submitter copied when that is somebody else:
         * the rep owns the request, but it is the submitter who corrects and raises it again.
         * Rejection is not in Emi's matrix; this mirrors the submission confirmation it undoes.
         */
        const rejectionTarget =
            form.formType === 'RETURN' ? await returnMailRequester(form) : null;
        const rejectionTo = rejectionTarget ? rejectionTarget.to : requester?.email ?? '';
        const rejectionCc = rejectionTarget ? submitterCc(rejectionTarget) : [];
        if (rejectionTo) {
            sendEmail({
                to: rejectionTo,
                ...(rejectionCc.length > 0 ? { cc: rejectionCc.join(', ') } : {}),
                subject: `Request Rejected: ${formTypeDisplayLabel(form.formType)} — ${requesterDisplay}`,
                template: 'form-rejected-en',
                data: {
                    requesterName: form.requesterName,
                    requesterDisplay,
                    formId: form.id,
                    formType: form.formType,
                    approverName: approvalDecisionDisplayLine,
                    approverRole: approval.role,
                    // Who had already approved before this rejection, and who never got to see it.
                    chainSteps: chainStepsForMail(sortedApprovals),
                    ...(await emailFormDetailFieldsFromForm(form)),
                    commentsForApproval: form.commentsForApproval,
                    freeDescription: form.freeDescription,
                    products,
                    comments: comments || 'No comments provided',
                    // Sent back at the service review: the requester can reopen it. Rejected by an
                    // approver: they copy it into a new request. The footnote says which.
                    reopenable: form.formType === 'RETURN' && isReturnReviewerRole(approval.role),
                    rejectedAt: new Date()
                }
            })
                .then((r) => logSendResult(`Rejection to requester ${rejectionTo}`, r))
                .catch((emailError) => console.error(`⚠️ Failed to send rejection email to requester:`, emailError));
        }
    } else {
        // Check if there are more approvals needed (before emailing requester — avoids duplicate on final step)
        const allApprovals = await prismaService.findApprovalsByFormId(approval.formId);
        const sortedApprovals = allApprovals.sort((a, b) => a.level - b.level);

        const nextApproval = sortedApprovals.find(a => a.level === approval.level + 1 && a.status === 'PENDING');

        /*
         * The next step is found by level + 1, so a gap in the numbering ends the chain silently:
         * neither the next approver nor the requester is told anything, and the form sits in
         * IN_PROGRESS for ever. Renumbering (renumberSequentialLevels) should make that impossible,
         * so say so loudly if it ever happens rather than leaving a request stuck with no trace.
         */
        if (!nextApproval) {
            const strandedPending = sortedApprovals.filter(
                (a) => a.level > approval.level && a.status === 'PENDING'
            );
            if (strandedPending.length > 0) {
                console.error(
                    `⚠️ Approval chain gap on form ${form.referenceNumber ?? form.id}: level ${approval.level} approved, ` +
                        `no PENDING row at level ${approval.level + 1}, but ${strandedPending.length} pending row(s) remain at ` +
                        `level(s) ${strandedPending.map((a) => a.level).join(', ')}. The request will not advance on its own.`
                );
            }
        }

        /*
         * The submitter hears about every decision, not only the ones with a PENDING row waiting at
         * level + 1.
         *
         * A return chain collapses to two or three steps (skipSelfApprovers + dropRepeatApprovers),
         * and the guard used to require the very next level to be PENDING - so on a short chain the
         * requester was told nothing until the final approval, and a step approved out of order told
         * them nothing at all. Any remaining step is enough; the last step still uses
         * form-approved-en, so a decision produces exactly one mail, never two.
         */
        const laterStepRemains = sortedApprovals.some(
            (a) => a.level > approval.level && a.status !== 'APPROVED' && a.status !== 'REJECTED'
        );
        /*
         * A return's status updates go to the Requester - the rep named on the form - not to whoever
         * submitted it. Everything else about this mail is unchanged, and a sample still notifies
         * the submitter exactly as before.
         */
        const isReturnForm = form.formType === 'RETURN';
        const progressTarget = isReturnForm ? await returnMailRequester(form) : null;
        const progressTo = progressTarget ? progressTarget.to : requester?.email ?? '';
        /*
         * The service review is a step, but calling it "approved at Level 1" tells the requester
         * nothing - and on a service chain the review IS level 1, so the first real approver would
         * report as Level 2. Name the step instead of its number.
         */
        const progressIsReview = isReturnForm && isReturnReviewerRole(approval.role);
        const progressSubject = isReturnForm
            ? `${progressIsReview ? 'Service review completed' : `Approved by ${approval.role}`}: ${formTypeDisplayLabel(form.formType)} — ${requesterDisplay}`
            : `Approval Notification: ${formTypeDisplayLabel(form.formType)} - Level ${approval.level} — ${requesterDisplay}`;
        if (progressTo && laterStepRemains) {
            const products = await prismaService.findFormProducts(form.id);
            sendEmail({
                to: progressTo,
                subject: progressSubject,
                template: 'approval-notification-en',
                data: {
                    requesterName: form.requesterName,
                    requesterDisplay,
                    formId: form.id,
                    referenceNumber: form.referenceNumber,
                    formType: form.formType,
                    approverName: approvalDecisionDisplayLine,
                    approverRole: approval.role,
                    level: approval.level,
                    // Return only: say which step cleared it rather than which level number.
                    stepRole: isReturnForm ? approval.role : undefined,
                    reviewStep: progressIsReview,
                    // Every step and where the request has got to, not only the one that just moved.
                    chainSteps: chainStepsForMail(sortedApprovals, nextApproval?.id ?? null),
                    totalAmount: form.totalAmount,
                    requestDate: new Date(form.requestDate),
                    decidedAt: new Date(),
                    comments: comments || 'No comments provided',
                    ...(await emailFormDetailFieldsFromForm(form)),
                    commentsForApproval: form.commentsForApproval,
                    freeDescription: form.freeDescription,
                    products: products
                }
            })
                .then((r) => logSendResult(`Approval progress to requester ${progressTo}`, r))
                .catch((emailError) => console.error(`⚠️ Failed to send approval notification email to requester:`, emailError));
        }

        if (nextApproval) {
            // Move to next approval level
            await prismaService.updateApproval(nextApproval.id, {
                status: 'IN_PROGRESS',
                notifiedAt: new Date().toISOString()
            });

            // Notify next approver
            // Get products for the form
            const products = await prismaService.findFormProducts(form.id);

            // Prepare email data with same format as first level
            // Get the next approval record to retrieve the token
            const nextApprovalRecord = allApprovals.find((a: any) => a.level === nextApproval.level);
            
            // Generate approval URLs (if token exists)
            const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
            const approveUrl = nextApprovalRecord?.approvalToken 
                ? generateApprovalUrl(baseUrl, nextApprovalRecord.approvalToken, 'approve')
                : null;
            const rejectUrl = nextApprovalRecord?.approvalToken 
                ? generateApprovalUrl(baseUrl, nextApprovalRecord.approvalToken, 'reject')
                : null;

            const attachmentFields = await attachmentEmailFields(form, nextApprovalRecord?.approvalToken);

            const nextEmailData = {
                approverName: nextApproval.approverName,
                formId: form.id,
                referenceNumber: form.referenceNumber,
                formType: form.formType,
                requesterName: form.requesterName,
                requesterDisplay,
                totalAmount: form.totalAmount,
                requestDate: new Date(form.requestDate),
                level: nextApproval.level,
                role: nextApproval.role,
                previousApprover: approvalDecisionDisplayLine,
                // What the previous step wrote when approving. A reviewer's note about what they
                // corrected, or an approver's caveat, used to be recorded and then shown to nobody.
                previousComments: comments?.trim() || undefined,
                approveUrl,
                rejectUrl,
                ...attachmentFields,
                // Additional details (same as first level)
                ...(await emailFormDetailFieldsFromForm(form)),
                commentsForApproval: form.commentsForApproval,
                freeDescription: form.freeDescription,
                products: products
            };

            const nextRecipientEmail = nextApprovalRecord?.approverEmail;
            const nextTarget = await approverMailTarget({
                approverName: nextApprovalRecord?.approverName || nextApproval.approverName,
                approverEmail: nextRecipientEmail,
            });
            console.log('📧 Preparing to send email to:', nextRecipientEmail);
            console.log('📋 Email data summary:', {
                approver: nextEmailData.approverName,
                requester: nextEmailData.requesterDisplay,
                formType: nextEmailData.formType,
                totalAmount: `¥${nextEmailData.totalAmount.toLocaleString()}`,
                level: nextEmailData.level,
                role: nextEmailData.role,
                previousApprover: nextEmailData.previousApprover,
                deliveryInfo: {
                    soldTo: nextEmailData.soldToName || '❌ Not provided',
                    shipTo: nextEmailData.shipToName || '❌ Not provided',
                    endUser: nextEmailData.endUserName || '❌ Not provided',
                    deliveryMode: nextEmailData.deliveryMode || '❌ Not provided'
                },
                comments: {
                    commentsForApproval: nextEmailData.commentsForApproval || '❌ Not provided',
                    freeDescription: nextEmailData.freeDescription || '❌ Not provided'
                },
                products: nextEmailData.products.length,
                productDetails: nextEmailData.products.map((p: any) => ({
                    name: p.productName,
                    code: p.productCode,
                    qty: p.quantity,
                    price: p.unitPrice
                }))
            });

            // Send next-level email in background (non-blocking - SMTP timeout can cause API timeout)
            if (nextTarget.to) {
                sendEmail({
                    to: nextTarget.to,
                    subject: approvalRequestSubject({
                        unroutedFor: nextTarget.unroutedFor,
                        // The review is always the first step, so this is only ever false - said
                        // once here rather than assumed, so a reordered chain cannot mislabel it.
                        reviewStep: isReturnReviewerRole(nextApproval.role),
                        formType: nextEmailData.formType,
                        requesterDisplay: nextEmailData.requesterDisplay,
                    }),
                    template: 'approval-request-en', // Use English template (same as first level)
                    data: {
                        ...nextEmailData,
                        reviewStep: isReturnReviewerRole(nextApproval.role),
                        unroutedFor: nextTarget.unroutedFor ?? undefined,
                    }
                })
                    .then((r) => logSendResult(`Next-level approval request to ${nextTarget.to}`, r))
                    .catch((emailError) => console.error(`⚠️ Failed to send next-level approval email:`, emailError));
            } else {
                console.warn('⚠️ No email for next approver, skipping notification');
            }
        } else {
            // All approvals complete - mark form as approved
            await prismaService.updateForm(approval.formId, {
                status: 'APPROVED',
                completedAt: new Date().toISOString()
            });

            // Update form status (already done above, but ensure completedAt is set)
            await prismaService.updateForm(approval.formId, { completedAt: new Date().toISOString() });

            // Order-taking mailboxes (CDG / LSG / Service) — non-blocking.
            //
            // A service return is raised under CDG or LSG (the wizard needs a unit to pick the
            // product catalogue), and its Service flag is what says the service team owns it. So
            // route on the flag first and fall back to the unit. isService is false for all four
            // sample form types, which therefore route exactly as before.
            const bu = form.isService === true
                ? 'SERVICE'
                : String(form.businessUnit || '').trim().toUpperCase();
            const orderTakingTo = getOrderTakingMailbox(bu);

            const finalIsReturn = form.formType === 'RETURN';
            const finalRequester = finalIsReturn ? await returnMailRequester(form) : null;

            /*
             * A return's completion is ONE mail, not two.
             *
             * Damian Diggin's matrix (20 Sep) has a single "Final Approval Completed" row: TO the
             * order-taking desk (P&OP for a service request), CC the requester, optionally Vidhi
             * Parsons during hypercare. So the requester now receives the very mail the desk acts on
             * rather than a separate summary, and the "Request Approved" notification is not sent
             * for a return at all. Samples keep both mails exactly as they were.
             *
             * If the desk mailbox is not configured there is nothing to be TO, so fall back to the
             * old notification rather than leaving the completion silent.
             */
            const returnFinalIsHandoff = finalIsReturn && orderTakingTo.length > 0;
            const finalNotificationTo = finalIsReturn ? finalRequester!.to : requester?.email ?? '';
            if (finalNotificationTo && !returnFinalIsHandoff) {
                if (finalIsReturn) {
                    console.warn(
                        `⚠️ ${ORDER_TAKING_ENV_VAR[bu] ?? `no mailbox for ${bu}`} is unset, so the final approval ` +
                            `for ${form.referenceNumber ?? form.id} went to the requester instead of the order-taking desk`
                    );
                }
                const approvedProducts = await prismaService.findFormProducts(form.id);
                const finalCc = finalIsReturn ? getReturnFinalCc() : [];
                const finalChainSteps = finalIsReturn
                    ? chainStepsForMail(await prismaService.findApprovalsByFormId(form.id))
                    : undefined;
                sendEmail({
                    to: finalNotificationTo,
                    ...(finalCc.length > 0 ? { cc: finalCc.join(', ') } : {}),
                    subject: `Request Approved: ${formTypeDisplayLabel(form.formType)} — ${requesterDisplay}`,
                    template: 'form-approved-en',
                    data: {
                        requesterName: form.requesterName,
                        requesterDisplay,
                        formId: form.id,
                        formType: form.formType,
                        totalAmount: form.totalAmount,
                        ...(await emailFormDetailFieldsFromForm(form)),
                        commentsForApproval: form.commentsForApproval,
                        freeDescription: form.freeDescription,
                        products: approvedProducts,
                        // So the outcome mail shows where it went and who cleared it, which is what
                        // "we don't see anyone in To and CC" was really asking for.
                        chainSteps: finalChainSteps,
                        recipientsTo: [finalNotificationTo],
                        recipientsCc: finalCc,
                        approvedAt: new Date()
                    }
                })
                    .then((r) => logSendResult(`FINAL approval to requester ${finalNotificationTo}`, r))
                    .catch((emailError) => console.error(`⚠️ Failed to send final approval email to requester:`, emailError));
            }

            /*
             * The handoff routes on the service flag ALONE: a service return goes to P&OP, anything
             * else to its unit's Customer Service desk. P&OP used to be added to every return
             * whatever its unit, which is not what the roll-out deck tells users happens
             * (「サービス以外はカスタマーサービス宛、サービス案件はPOPチーム宛」), and the deck is the promise being made
             * to the wider user base. getReturnAlwaysMailbox is left in place, now unused by this
             * path, so AZURE_RETURN_ALWAYS_MAIL_TO can still be set deliberately if that changes.
             */

            /*
             * Visible CC, RETURN only: the requester (this is their completion notice, per the
             * matrix) and whoever is on the hypercare list. Deduplicated in case the requester is
             * also listed there.
             */
            const orderTakingCc = finalIsReturn
                ? [...new Set([...(finalRequester!.to ? [finalRequester!.to] : []), ...getReturnFinalCc()])]
                : [];

            if (orderTakingTo.length > 0) {
                const orderTakingToField = orderTakingTo.join(', ');
                Promise.all([
                    prismaService.findFormProducts(form.id),
                    prismaService.findApprovalsByFormId(form.id),
                ])
                    .then(async ([products, approvals]) => {
                        const orderTakingData = {
                            businessUnit: bu,
                            referenceNumber: form.referenceNumber,
                            formId: form.id,
                            formType: form.formType,
                            requesterName: form.requesterName,
                            requesterDisplay,
                            requestDate: new Date(form.requestDate),
                            approvedAt: new Date(),
                            purpose: form.purpose,
                            requesterGroup: form.requesterGroup,
                            salesRepCodeSap: form.salesRepCodeSap,
                            ...(await emailFormDetailFieldsFromForm(form)),
                            postalCode: form.postalCode,
                            prefecture: form.prefecture,
                            address: form.address,
                            phone: form.phone,
                            commentsForApproval: form.commentsForApproval,
                            freeDescription: form.freeDescription,
                            products,
                            approvals,
                            // Named in the body as well: this mail lands in shared mailboxes, where
                            // "did anyone else get this?" cannot be read off the client's To field.
                            recipientsTo: orderTakingTo,
                            recipientsCc: orderTakingCc,
                        };
                        return sendEmail({
                            to: orderTakingToField,
                            ...(orderTakingCc.length > 0 ? { cc: orderTakingCc.join(', ') } : {}),
                            subject: orderTakingApprovedSubject(form, requesterDisplay),
                            template: 'order-taking-approved-en',
                            data: orderTakingData,
                        });
                    })
                    .then((r) =>
                        logSendResult(`Order-taking handoff to ${orderTakingToField} (${bu})`, r)
                    )
                    .catch((emailError) =>
                        console.error(`⚠️ Failed to send order-taking email (${bu}):`, emailError)
                    );
            } else if (ORDER_TAKING_ENV_VAR[bu]) {
                console.warn(
                    `⚠️ Order-taking email skipped for ${bu}: set ${ORDER_TAKING_ENV_VAR[bu]} in environment`
                );
            }
        }
    }
};

/*
 * normalizeNameForMatch, rankUserForNameLookup and findUserByName moved to named-requester.service,
 * unchanged, so the mail and the access check resolve a Requester through one definition.
 */

/**
 * Put a rejected form back in the approval flow at the same step: clears the rejection on this
 * approval row and sets form to IN_PROGRESS so the assignee (or super/admin) can APPROVE later.
 * Does not create a new form id — same form as before rejection.
 */
export const reopenRejectedApproval = async (approvalId: string, actor: ApprovalActorContext) => {
    const approval = await prismaService.findApprovalById(approvalId);
    if (!approval) {
        throw new Error('Approval not found');
    }
    if (approval.status !== 'REJECTED') {
        throw new Error('Only a rejected approval step can be reopened');
    }

    const form = await prismaService.findFormById(approval.formId);
    if (!form) {
        throw new Error('Form not found');
    }
    if (form.status !== 'REJECTED') {
        throw new Error('Form is not in rejected state');
    }

    const isAssignee = approval.approverId === actor.userId;
    const wasRejectingActor =
        approval.actualActorUserId != null && approval.actualActorUserId === actor.userId;
    const isAdmin = actor.role === 'ADMIN';
    const isSuper = hasSuperApproverPrivileges(actor.role, actor.isSuperApprover);
    // The review step is the service team's, not one person's: any Service Admin approves or rejects
    // it, so any of them may take back the team's send-back - not only whoever pressed the button.
    const isServiceTeamReview =
        isReturnReviewerRole(approval.role) && hasServiceAdminPrivileges(actor.role, actor.isServiceAdmin);
    if (!isAssignee && !wasRejectingActor && !isAdmin && !isSuper && !isServiceTeamReview) {
        throw new Error(
            'Only the assigned approver, the user who submitted the rejection, the service admin team (for a review step), an admin, or a super approver can reopen this step'
        );
    }

    await prismaService.updateApproval(approvalId, {
        status: 'IN_PROGRESS',
        decision: null as any,
        comments: null as any,
        decidedAt: '',
        actualActorUserId: null,
    });

    await prismaService.updateForm(approval.formId, {
        status: 'IN_PROGRESS',
        completedAt: '',
    });

    return prismaService.findApprovalById(approvalId);
};

/**
 * Rebuild approvals for an existing form (useful when approver accounts were missing).
 */
/**
 * The steps a request would have AFTER its review step, for the requester, business unit and
 * service flag it carries now. Empty when that requester has no row in the return matrix - the
 * same state that blocks Next in the wizard.
 */
export const routeAfterReview = async (form: SalesForm): Promise<ApprovalLevel[]> => {
    const path = await calculateApprovalPath(form);
    return path.filter((step) => !isReturnReviewerRole(step.role));
};

/**
 * Rebuild the steps that follow the review step, after a reviewer corrected who raised the request,
 * its business unit or the service flag - the three inputs the route is built from. Until now those
 * were fixed at submission, so correcting the requester left the wrong people approving.
 *
 * The review step itself is kept: the reviewer is in the middle of acting on it, and it is the one
 * step whose link has actually been sent. Everything after it is still PENDING and has notified
 * nobody, so it is replaced outright, with fresh tokens. Returns the steps now following the review.
 */
export const rebuildRouteAfterReviewEdit = async (form: SalesForm): Promise<ApprovalLevel[]> => {
    const existing = await prismaService.findApprovalsByFormId(form.id);
    const current = existing.find((a) => a.status === 'IN_PROGRESS');
    if (!current || !isReturnReviewerRole(current.role)) {
        throw new Error('The route can only be rebuilt while the request sits at its review step');
    }

    const followers = await routeAfterReview(form);
    await prismaService.deletePendingApprovalsByFormId(form.id);

    // Fallback user when an approver is not in the users table (the FK needs a valid user id).
    const fallbackUser = await prismaService.findUserByEmail('admin@example.com');
    let level = current.level;
    for (const step of followers) {
        level += 1;
        const approver =
            (await findUserByName(step.approverName)) ??
            (looksLikeApproverEmail(step.approverEmail)
                ? await prismaService.findUserByEmail(step.approverEmail)
                : null);
        const approverId = approver?.id || fallbackUser?.id;
        if (!approverId) {
            throw new Error('Cannot create approval: approver not found and admin fallback user missing. Ensure admin@example.com exists.');
        }
        await prismaService.createApproval({
            formId: form.id,
            approverId,
            approverName: step.approverName,
            approverEmail: approver?.email || step.approverEmail,
            level,
            role: step.role,
            status: 'PENDING',
            decision: undefined,
            comments: undefined,
            approvalToken: generateApprovalToken(),
            tokenExpiresAt: calculateTokenExpiration(30),
            notifiedAt: undefined,
            decidedAt: undefined
        });
    }

    const last = followers[followers.length - 1];
    await prismaService.updateForm(form.id, {
        approvalMaxLevel: level,
        approvalFinalRole: last ? last.role : current.role
    });
    return followers;
};

export const rebuildApprovals = async (formId: string) => {
    const form = await prismaService.findFormById(formId);
    if (!form) throw new Error(`Form not found: ${formId}`);

    // Delete existing approvals for the form
    await prismaService.deleteApprovalsByFormId(formId);

    // Recreate workflow with current logic (including fallback approvers)
    await createApprovalWorkflow(form);
};
