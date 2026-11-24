import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ImportEntity } from '../constants/importEntities';
import { acquireMicrosoftApiBearerToken } from '../utils/msalApiToken';
import type { OffboardingResult, OffboardingScope } from '../utils/offboarding';

// API Configuration
// Production: use /api (same-origin, NGINX proxies to backend) or full URL via VITE_API_URL
// Development: fallback to localhost
const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000/api';

const AUTH_MODE_KEY = 'auth_mode';
const SSO_EMAIL_KEY = 'sso_email';
const SSO_NAME_KEY = 'sso_name';

/** Survives full-page redirect so Login can show API message (401 body is lost otherwise). */
const LAST_AUTH_ERROR_KEY = 'last_auth_error';

/** Clears JWT + SSO marker keys (call on 401 and logout). */
export function clearClientAuthSession() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem(AUTH_MODE_KEY);
    localStorage.removeItem(SSO_EMAIL_KEY);
    localStorage.removeItem(SSO_NAME_KEY);
}

// Create axios instance
const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000, // 30 seconds (form submit can take longer with approval workflow)
});

// Request interceptor — password: app JWT; Microsoft SSO: Entra ID/API token (validated on server)
apiClient.interceptors.request.use(
    async (config) => {
        const mode = localStorage.getItem(AUTH_MODE_KEY);
        if (mode === 'sso') {
            const bearer = await acquireMicrosoftApiBearerToken();
            if (bearer) {
                config.headers.Authorization = `Bearer ${bearer}`;
            } else if ((import.meta as { env?: { VITE_SSO_HEADER_FALLBACK?: string } }).env?.VITE_SSO_HEADER_FALLBACK === 'true') {
                const email = localStorage.getItem(SSO_EMAIL_KEY);
                if (email) {
                    config.headers['X-User-Email'] = email;
                    config.headers['X-User-Name'] = localStorage.getItem(SSO_NAME_KEY) || email;
                }
            }
        } else {
            const token = localStorage.getItem('auth_token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        if (config.data instanceof FormData) {
            delete config.headers['Content-Type'];
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

function extractApiErrorMessage(data: unknown): string {
    if (data && typeof data === 'object') {
        const o = data as { error?: unknown; message?: unknown };
        if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
        if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    }
    return 'Session expired or not authorized.';
}

// Response interceptor — 401: persist message, then clear session; avoid full reload if already on /login (stops error flash)
apiClient.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            const msg = extractApiErrorMessage(error.response.data);
            try {
                sessionStorage.setItem(LAST_AUTH_ERROR_KEY, msg);
            } catch {
                /* ignore quota / private mode */
            }
            clearClientAuthSession();
            const path = window.location.pathname || '';
            const onLoginPage = path === '/login' || path.endsWith('/login');
            if (!onLoginPage) {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

/** One-shot message for Login page after 401 redirect (read once). */
export function consumeLastAuthErrorFromSession(): string | null {
    try {
        const v = sessionStorage.getItem(LAST_AUTH_ERROR_KEY);
        if (v) sessionStorage.removeItem(LAST_AUTH_ERROR_KEY);
        return v;
    } catch {
        return null;
    }
}

// Type definitions
export interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    /** False when Microsoft SSO succeeded but no DB user row exists yet */
    provisioned?: boolean;
    /** Super-approver powers in addition to primary `role` */
    isSuperApprover?: boolean;
    /** Service Admin team: may review a service return, edit it at review, and set its SAP SO number. */
    isServiceAdmin?: boolean;
    /** Customer Service view: the read-only all-requests pages on top of the role. */
    isCustomerSupport?: boolean;
    businessUnit?: string;
    /** SAP sales rep code; may be null in DB — name fallback in UI */
    salesRepCode?: string | null;
    /** Requester group UUID — used to lock Step 1 for REQUESTER users */
    requesterGroupId?: string | null;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface LoginResponse {
    token: string;
    user: User;
}

export interface Approval {
    id: string;
    formId: string;
    approverId: string;
    approverName: string;
    approverEmail: string;
    /** Present when a super approver submitted the decision for this step */
    actualActorUserId?: string | null;
    actualActorName?: string | null;
    level: number;
    role: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
    decision?: string;
    comments?: string;
    /** Comments the earlier steps left when approving, oldest first. Attached by the inbox endpoint. */
    priorComments?: PriorApprovalComment[];
    notifiedAt?: string;
    decidedAt?: string;
    createdAt: string;
    updatedAt: string;
    form?: any; // Form details attached by backend
}

export interface ApprovalDecision {
    decision: 'APPROVED' | 'REJECTED';
    comments?: string;
}

export type ApprovedFormRelation = 'requester' | 'approver' | 'both';

/** One correction a service reviewer made while the request was awaiting review. */
export interface ReviewEditRecord {
    changedAt: string;
    changedByName: string;
    fieldChanges: Array<{ field: string; oldValue: string | null; newValue: string | null }>;
}

/** One earlier submission of a return that was rejected and reopened. See form-reopen.service. */
export interface SubmissionRound {
    round: number;
    submittedAt: string | null;
    submittedById: string;
    submittedByName: string | null;
    rejectedAt: string | null;
    approvals: Array<{
        level: number;
        role: string;
        approverName: string;
        status: string;
        comments: string | null;
        decidedAt: string | null;
        actualActorName: string | null;
    }>;
    reviewEdits: ReviewEditRecord[];
    reopenedAt: string;
    reopenedById: string;
    reopenedByName: string | null;
}

/** A comment an earlier step left when approving, carried forward to the steps after it. */
export interface PriorApprovalComment {
    level: number;
    role: string;
    approverName: string;
    comments: string;
    decidedAt?: string | null;
}

export interface RequestSnapshot {
    id: string;
    formType: string;
    requesterId: string;
    requesterName: string;
    /** Shown in end-user UI only when 5–10 digit numeric; otherwise omitted. */
    salesRepCodeSap?: string;
    businessUnit?: string;
    requesterGroup?: string;
    requestDate: string;
    purpose: string;
    deliveryMode?: string;
    expectedDeliveryDate?: string;
    soldToCode?: string;
    soldToName?: string;
    shipToCode?: string;
    shipToName?: string;
    attentionTo?: string;
    endUserCode?: string;
    endUserName?: string;
    address?: string;
    totalAmount: number;
    currency?: string;
    status: string;
    referenceNumber?: string;
    submittedAt?: string;
    approvalMaxLevel?: number;
    approvalFinalRole?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    /* Return-only. Undefined on the four sample form types. */
    returnType?: string;
    isService?: boolean;
    originalOrderNumber?: string;
    invoiceDate?: string;
    /** 定期予約 / Standing order — the request may then carry several invoice dates. */
    isStandingOrder?: boolean;
    /** Every invoice date, in entry order. `invoiceDate` is the first of them. */
    invoiceDates?: string[];
    quoteRefNo?: string;
    orderReason?: string;
    justification?: string;
    dairitenContactName?: string;
    dairitenContactEmail?: string;
    /** SAP sales order number, entered by the Service Admin team after full approval. */
    salesOrderNumber?: string | null;
    /** Edits a service reviewer made before the approval chain started. */
    reviewEdits?: ReviewEditRecord[];
    products?: any[];
    /** Present on GET /requests?status=APPROVED for non-admin users. */
    approvedRelation?: ApprovedFormRelation;
    /**
     * Present on the pending list. 'reviewer' marks a request the caller sees because the service
     * review team corrected and sent it on, rather than because they raised it.
     */
    pendingRelation?: 'requester' | 'reviewer';
    /** Earlier submissions, when this return was rejected and reopened. */
    approvalHistory?: SubmissionRound[];
    /**
     * The account that submitted the request, which is not always the named requester: a manager
     * may raise one on a rep's behalf. Shown as "entered by" when the two differ.
     */
    requester?: { id: string; name: string; email: string } | null;
}

// Authentication API
export const authApi = {
    login: async (credentials: LoginRequest): Promise<LoginResponse> => {
        const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
        return response.data;
    },

    logout: async (): Promise<void> => {
        await apiClient.post('/auth/logout');
        clearClientAuthSession();
    },

    getMe: async (): Promise<{ user: User }> => {
        const response = await apiClient.get<{ user: User }>('/auth/me');
        return response.data;
    },
};

/** Wizard / app UI copy (requires login) */
export const appSettingsApi = {
    getWizardStep2DataBanner: async (): Promise<{ message: string }> => {
        const response = await apiClient.get<{ message: string }>('/app-settings/wizard-step2-data-banner');
        return response.data;
    },
};

/** Hargadon-san only: approved ZNC Claim team report */
export const reportsApi = {
    getZncClaimApprovedSummary: async (params?: {
        businessUnit?: 'CDG' | 'LSG';
    }): Promise<{ success: boolean; total: number }> => {
        const q: Record<string, string> = {};
        if (params?.businessUnit) q.businessUnit = params.businessUnit;
        const response = await apiClient.get('/reports/znc-claim-approved/summary', { params: q });
        return response.data;
    },
    listZncClaimApprovedForms: async (params?: {
        businessUnit?: 'CDG' | 'LSG';
        search?: string;
        submittedFrom?: string;
        submittedTo?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        success: boolean;
        forms: RequestSnapshot[];
        total: number;
        limit: number;
        offset: number;
    }> => {
        const q: Record<string, string | number> = {};
        if (params?.businessUnit) q.businessUnit = params.businessUnit;
        if (params?.search) q.search = params.search;
        if (params?.submittedFrom) q.submittedFrom = params.submittedFrom;
        if (params?.submittedTo) q.submittedTo = params.submittedTo;
        if (params?.limit != null) q.limit = params.limit;
        if (params?.offset != null) q.offset = params.offset;
        const response = await apiClient.get('/reports/znc-claim-approved/forms', { params: q });
        return response.data;
    },
};

// Approvals API
export const approvalsApi = {
    getPendingApprovals: async (): Promise<{ approvals: Approval[] }> => {
        const response = await apiClient.get<{ approvals: Approval[] }>('/approvals');
        return response.data;
    },

    getApprovalHistory: async (formId: string): Promise<{ approvals: Approval[] }> => {
        const response = await apiClient.get<{ approvals: Approval[] }>(`/approvals/history/${formId}`);
        return response.data;
    },

    approveForm: async (approvalId: string, comments?: string): Promise<any> => {
        const response = await apiClient.post(`/approvals/${approvalId}/approve`, { comments }, { timeout: 60000 });
        return response.data;
    },

    rejectForm: async (approvalId: string, comments: string): Promise<any> => {
        const response = await apiClient.post(`/approvals/${approvalId}/reject`, { comments }, { timeout: 60000 });
        return response.data;
    },

    /** Same form: undo terminal rejection at this step so the approver can approve later. */
    reopenRejectedApproval: async (approvalId: string): Promise<{ message: string; approval: Approval }> => {
        const response = await apiClient.post<{ message: string; approval: Approval }>(
            `/approvals/${approvalId}/reopen-rejection`,
            {},
            { timeout: 60000 }
        );
        return response.data;
    },

    /**
     * "Delete" on a rejected request in the inbox: removes it from the caller's inbox only. The
     * request itself is kept, and a super approver still sees it.
     */
    dismissRejectedApproval: async (approvalId: string): Promise<{ message: string; approvalId: string; dismissedAt: string }> => {
        const response = await apiClient.post<{ message: string; approvalId: string; dismissedAt: string }>(
            `/approvals/${approvalId}/dismiss`,
            {}
        );
        return response.data;
    },

    /** ADMIN only: resend approval-request email to the current IN_PROGRESS approver. */
    notifyApprover: async (
        approvalId: string
    ): Promise<{ message: string; approverName: string; notifiedAt: string; approval: Approval }> => {
        const response = await apiClient.post<{
            message: string;
            approverName: string;
            notifiedAt: string;
            approval: Approval;
        }>(`/approvals/${approvalId}/notify-approver`, {}, { timeout: 60000 });
        return response.data;
    },
};

// Requests API (reads backend/data/requests.json)
export const requestsApi = {
    getPendingRequests: async (status: string = 'PENDING_APPROVAL'): Promise<{ requests: RequestSnapshot[] }> => {
        const response = await apiClient.get<{ requests: RequestSnapshot[] }>('/requests', {
            params: { status },
        });
        return response.data;
    },
};

// Forms API (for pending approvals - forms submitted by user)
export const formsApi = {
    /**
     * Record the SAP sales order number on a fully approved service return.
     * Service Admin team only; the backend enforces that as well as the request's state.
     */
    setSalesOrderNumber: async (
        formId: string,
        salesOrderNumber: string
    ): Promise<{ form: RequestSnapshot; message: string }> => {
        const response = await apiClient.put(`/forms/${formId}/sales-order-number`, {
            salesOrderNumber,
        });
        return response.data;
    },
    getMyForms: async (): Promise<any> => {
        const response = await apiClient.get('/forms/my-forms');
        return response.data;
    },
    /** One request in full, for the service review edit screen. */
    getForm: async (formId: string): Promise<any> => {
        const response = await apiClient.get(`/forms/${formId}`);
        return response.data;
    },
    /**
     * Correct a request. Two quite different cases share this endpoint:
     *   - the requester's own DRAFT, and
     *   - a SUBMITTED return sitting at the service review step, which the Service Admin team may
     *     correct. There ownership is not the test — the review window is — and every change is
     *     recorded in the form's review-edit trail.
     *
     * The endpoint existed and was fully guarded for some time with no caller at all, which is why
     * the reviewer could approve or reject but never actually fix anything.
     */
    updateForm: async (formId: string, data: Record<string, unknown>): Promise<any> => {
        const response = await apiClient.put(`/forms/${formId}`, data);
        return response.data;
    },
    /**
     * Discard every correction made during service review and return the request to what the
     * requester submitted. Service Admin only, and only while the request sits at its review step;
     * the server enforces both. Recorded on the trail as a further entry.
     */
    revertReviewEdits: async (formId: string): Promise<{ form: any; reverted: number }> => {
        const response = await apiClient.post(`/forms/${formId}/revert-review-edits`, {});
        return response.data;
    },
};

// Static Data API
export interface RequesterGroup {
    id: string;
    name: string;
}

export interface RequesterGroupsResponse {
    success: boolean;
    groups: RequesterGroup[];
    count: number;
}

export interface SalesRep {
    id: string;
    code: string;
    name: string;
    salesManager: string;
    districtSalesManager: string;
    nationalSalesManager: string;
    localFinanceController: string;
    directorCommercialManager: string;
    requesterGroupId: string;
}

export interface SalesRepsResponse {
    success: boolean;
    salesReps: SalesRep[];
    count: number;
}

export interface ZsamApprovers {
    salesManager?: string;
    districtSalesManager?: string;
    nationalSalesManager?: string;
    localFinanceController?: string;
    directorCommercialManager?: string;
}

export interface ZsamApproversResponse {
  success: boolean;
  approvers: ZsamApprovers | null;
  found: boolean;
}

export interface ReturnApprovers {
  /**
   * Service review step, taken before any approval. Present only for a service-related return, and
   * only while the review step is switched on server-side (RETURN_REVIEW_STEP_ENABLED) - the same
   * source the built chain reads, so the wizard's preview cannot claim a step the chain won't have.
   */
  reviewer?: string | null;
  firstApprover?: string | null;
  secondApprover?: string | null;
  finalApprover?: string | null;
  /** Service managers from the two extra matrix columns; service-related returns only. */
  fourthApprover?: string | null;
  fifthApprover?: string | null;
  teamName?: string | null;
}

export interface ReturnMatrixRoles {
  isRequester: boolean;
  isApprover: boolean;
  isReviewer: boolean;
}

export interface ReturnApproversResponse {
  success: boolean;
  approvers: ReturnApprovers | null;
  found: boolean;
}

export interface UserHierarchy {
  salesManager?: string | null;
  districtSalesManager?: string | null;
  nationalSalesManager?: string | null;
  localFinanceController?: string | null;
  directorCommercialManager?: string | null;
  technicalManager?: string | null;
  nationalTSManager?: string | null;
}

export interface UserHierarchyResponse {
  success: boolean;
  hierarchy: UserHierarchy | null;
  found: boolean;
}

export interface ChannelPartner {
    code: string;
    name: string;
    nameEnglish?: string;
    postalCode: string;
    prefecture?: string;
    address: string;
    phone: string;
    sapCode?: string;
}

export interface EndUser {
    code: string;
    name: string;
    nameEnglish?: string;
    postalCode: string;
    prefecture?: string;
    address: string;
    phone: string;
    sapCode?: string;
}

export interface ChannelPartnersResponse {
    success: boolean;
    partners: ChannelPartner[];
    count: number;
    total: number;
    hasMore: boolean;
}

export interface EndUsersResponse {
    success: boolean;
    endUsers: EndUser[];
    count: number;
    total: number;
    hasMore: boolean;
}

export interface RequesterPersonalAccount {
    code: string;
    name: string;
}

export interface RequesterPersonalAccountsResponse {
    success: boolean;
    accounts: RequesterPersonalAccount[];
    count: number;
    total: number;
    hasMore: boolean;
}

export interface DirectDeliveryLocationsResponse {
    success: boolean;
    locations: ChannelPartner[];
    count: number;
    total: number;
    hasMore: boolean;
}

export interface Product {
    businessGroup: string;
    code: string;
    sapCode: string;
    name: string;
    price: number;
    listPrice: number;
    productNameLocal: string;
    division?: string;
    statisticsGroup?: string;
    priceGroup?: string;
}

export interface ProductCatalogResponse {
    success: boolean;
    products: Product[];
    count: number;
    total: number;
    hasMore: boolean;
}

export const staticDataApi = {
    getRequesterGroups: async (businessUnit?: string, formType?: string): Promise<RequesterGroupsResponse> => {
        const params: Record<string, string> = {};
        if (businessUnit) params.businessUnit = businessUnit;
        if (formType) params.formType = formType;
        const response = await apiClient.get<RequesterGroupsResponse>('/requester-groups', { params });
        return response.data;
    },
    /**
     * The signed-in user's own teams and requester rows.
     *
     * Replaces `user.requesterGroupId` + `user.salesRepCode` as the basis for what a requester may
     * pick: neither column can describe someone who belongs to several teams, and almost no
     * requester has a sales rep code. `unrestricted` means no requester row could be tied to the
     * account, so the wizard should not restrict anything.
     */
    getMyRequesterScope: async (): Promise<{
        unrestricted: boolean
        matchedBy: 'userId' | 'salesRepCode' | 'name' | 'none'
        groupIds: string[]
        requesterIds: string[]
    }> => {
        const response = await apiClient.get('/my-requester-scope')
        return response.data
    },
    getSalesReps: async (requesterGroupId?: string, formType?: string): Promise<SalesRepsResponse> => {
        const params: Record<string, string> = {};
        if (requesterGroupId) params.requesterGroupId = requesterGroupId;
        if (formType) params.formType = formType;
        const response = await apiClient.get<SalesRepsResponse>('/sales-reps', { params });
        return response.data;
    },
    getZsamApprovers: async (requesterName?: string, businessUnit?: string): Promise<ZsamApproversResponse> => {
        const params: Record<string, string> = {};
        if (requesterName) params.requesterName = requesterName;
        if (businessUnit) params.businessUnit = businessUnit;
        const response = await apiClient.get<ZsamApproversResponse>('/zsam-approvers', { params });
        return response.data;
    },
    /** The caller's parts in the return approval matrix (by name). */
    getMyReturnMatrixRoles: async (): Promise<ReturnMatrixRoles> => {
        const response = await apiClient.get<ReturnMatrixRoles>('/my-return-matrix-roles');
        return response.data;
    },
    getReturnApprovers: async (
        requesterName?: string,
        businessUnit?: string,
        // The team decides which of a person's matrix rows applies, now that the matrix keeps one
        // row per sheet row. Without it the preview can name a different chain from the submit.
        requesterGroup?: string
    ): Promise<ReturnApproversResponse> => {
        const params: Record<string, string> = {};
        if (requesterName) params.requesterName = requesterName;
        if (businessUnit) params.businessUnit = businessUnit;
        if (requesterGroup) params.requesterGroup = requesterGroup;
        const response = await apiClient.get<ReturnApproversResponse>('/return-approvers', { params });
        return response.data;
    },
    getUserHierarchy: async (
        requesterName: string,
        businessUnit?: string,
        formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT'
    ): Promise<UserHierarchyResponse> => {
        const params: any = { requesterName };
        if (businessUnit) params.businessUnit = businessUnit;
        if (formType) params.formType = formType;
        const response = await apiClient.get<UserHierarchyResponse>('/user-hierarchy', { params });
        return response.data;
    },
    getChannelPartners: async (
        codePrefix?: string,
        businessUnit?: string,
        options?: {
            limit?: number;
            offset?: number;
            search?: string;
        }
    ): Promise<ChannelPartnersResponse> => {
        const params: any = {};
        if (codePrefix) params.codePrefix = codePrefix;
        if (businessUnit) params.businessUnit = businessUnit;
        if (options?.limit !== undefined) params.limit = options.limit;
        if (options?.offset !== undefined) params.offset = options.offset;
        if (options?.search) params.search = options.search;
        const response = await apiClient.get<ChannelPartnersResponse>('/channel-partners', { params });
        return response.data;
    },
    getEndUsers: async (
        codePrefix?: string,
        businessUnit?: string,
        options?: {
            limit?: number;
            offset?: number;
            search?: string;
        }
    ): Promise<EndUsersResponse> => {
        const params: any = {};
        if (codePrefix) params.codePrefix = codePrefix;
        if (businessUnit) params.businessUnit = businessUnit;
        if (options?.limit !== undefined) params.limit = options.limit;
        if (options?.offset !== undefined) params.offset = options.offset;
        if (options?.search) params.search = options.search;
        const response = await apiClient.get<EndUsersResponse>('/end-users', { params });
        return response.data;
    },
    getRequesterPersonalAccounts: async (
        options: {
            formType?: string;
            limit?: number;
            offset?: number;
            search: string;
        }
    ): Promise<RequesterPersonalAccountsResponse> => {
        const params: Record<string, string | number> = { search: options.search };
        if (options.formType) params.formType = options.formType;
        if (options.limit !== undefined) params.limit = options.limit;
        if (options.offset !== undefined) params.offset = options.offset;
        const response = await apiClient.get<RequesterPersonalAccountsResponse>(
            '/requester-personal-accounts',
            { params }
        );
        return response.data;
    },
    getDirectDeliveryLocations: async (
        codePrefix?: string,
        businessUnit?: string,
        options?: {
            limit?: number;
            offset?: number;
            search?: string;
        }
    ): Promise<DirectDeliveryLocationsResponse> => {
        const params: any = {};
        if (codePrefix) params.codePrefix = codePrefix;
        if (businessUnit) params.businessUnit = businessUnit;
        if (options?.limit !== undefined) params.limit = options.limit;
        if (options?.offset !== undefined) params.offset = options.offset;
        if (options?.search) params.search = options.search;
        const response = await apiClient.get<DirectDeliveryLocationsResponse>('/direct-delivery-locations', { params });
        return response.data;
    },
    getProductCatalog: async (
        businessUnit: string,
        options?: { limit?: number; offset?: number; search?: string }
    ): Promise<ProductCatalogResponse> => {
        const params: any = { businessUnit };
        if (options?.limit !== undefined) params.limit = options.limit;
        if (options?.offset !== undefined) params.offset = options.offset;
        if (options?.search !== undefined) params.search = options.search;
        const response = await apiClient.get<ProductCatalogResponse>('/product-catalog', { params });
        return response.data;
    },
    /**
     * One product by exact code. The pickers used to re-search the code with limit 100 and match in
     * the browser; a short code with more than 100 substring hits (CDG 12000 has 326) fell off that
     * page and the line was priced at 0. Null when the code is not an active product.
     */
    getProductExact: async (businessUnit: string, code: string): Promise<Product | null> => {
        try {
            const response = await apiClient.get<{ success: boolean; product: Product }>('/product-catalog/exact', {
                params: { businessUnit, code },
            });
            return response.data.product ?? null;
        } catch (err: any) {
            if (err?.response?.status === 404) return null;
            throw err;
        }
    },
};

// Admin API - Master Data Management
export interface AdminCustomer {
    id: string;
    businessGroup: string;
    firstDigit: string;
    code: string;
    sapCode: string;
    nameJp: string;
    nameEn: string;
    postalCode?: string;
    prefecture?: string;
    address?: string;
    phone?: string;
    isActive: boolean;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    submittedBy?: string;
    approvedBy?: string;
    rejectedBy?: string;
    rejectionReason?: string;
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    createdBy?: string;
    updatedBy?: string;
    createdAt: string;
    updatedAt: string;
    submitter?: { id: string; name: string; email: string };
    approver?: { id: string; name: string; email: string };
    rejector?: { id: string; name: string; email: string };
    creator?: { id: string; name: string; email: string };
    updater?: { id: string; name: string; email: string };
}

export interface AdminProduct {
    id: string;
    businessGroup: string;
    code: string;
    sapCode: string;
    name: string;
    productNameLocal: string;
    price: number;
    listPrice: number;
    division?: string;
    statisticsGroup?: string;
    priceGroup?: string;
    isActive: boolean;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    submittedBy?: string;
    approvedBy?: string;
    rejectedBy?: string;
    rejectionReason?: string;
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    createdBy?: string;
    updatedBy?: string;
    createdAt: string;
    updatedAt: string;
    submitter?: { id: string; name: string; email: string };
    approver?: { id: string; name: string; email: string };
    rejector?: { id: string; name: string; email: string };
    creator?: { id: string; name: string; email: string };
    updater?: { id: string; name: string; email: string };
}

export interface AdminListResponse<T> {
    success: boolean;
    customers?: T[];
    products?: T[];
    count: number;
    total: number;
    hasMore: boolean;
}

export interface AdminSingleResponse<T> {
    success: boolean;
    customer?: T;
    product?: T;
}

export interface CreateCustomerData {
    businessGroup: 'CDG' | 'LSG';
    firstDigit: '1' | '2' | '8';
    code: string;
    sapCode: string;
    nameJp: string;
    nameEn: string;
    postalCode?: string;
    prefecture?: string;
    address?: string;
    phone?: string;
}

export interface CreateProductData {
    businessGroup: 'CDG' | 'LSG';
    code: string;
    sapCode?: string;
    name: string;
    productNameLocal: string;
    price: number;
    listPrice: number;
    division?: string;
    statisticsGroup?: string;
    priceGroup?: string;
}

export const adminApi = {
    // Customer Management
    getCustomers: async (params?: {
        businessGroup?: string;
        firstDigit?: string;
        limit?: number;
        offset?: number;
        search?: string;
        status?: string;
        includePending?: boolean;
        includeInactive?: boolean;
    }): Promise<AdminListResponse<AdminCustomer>> => {
        const response = await apiClient.get<AdminListResponse<AdminCustomer>>('/admin/customers', { params });
        return response.data;
    },
    exportCustomerMaster: async (
        customerType: 'all' | 'sold-to' | 'direct-delivery' | 'ship-to',
        format: 'xlsx' | 'csv' = 'xlsx'
    ): Promise<Blob> => {
        const response = await apiClient.get('/admin/customers/export', {
            params: { customerType, format },
            responseType: 'blob',
        });
        return response.data;
    },
    getCustomer: async (id: string): Promise<AdminSingleResponse<AdminCustomer>> => {
        const response = await apiClient.get<AdminSingleResponse<AdminCustomer>>(`/admin/customers/${id}`);
        return response.data;
    },
    getPendingCustomers: async (params?: {
        businessGroup?: string;
        firstDigit?: string;
        limit?: number;
        offset?: number;
        search?: string;
    }): Promise<AdminListResponse<AdminCustomer>> => {
        const response = await apiClient.get<AdminListResponse<AdminCustomer>>('/admin/customers/pending', { params });
        return response.data;
    },
    getRejectedCustomers: async (params?: {
        businessGroup?: string;
        firstDigit?: string;
        limit?: number;
        offset?: number;
        search?: string;
    }): Promise<AdminListResponse<AdminCustomer>> => {
        const response = await apiClient.get<AdminListResponse<AdminCustomer>>('/admin/customers/rejected', { params });
        return response.data;
    },
    createCustomer: async (data: CreateCustomerData): Promise<AdminSingleResponse<AdminCustomer>> => {
        const response = await apiClient.post<AdminSingleResponse<AdminCustomer>>('/admin/customers', data);
        return response.data;
    },
    updateCustomer: async (id: string, data: Partial<CreateCustomerData>): Promise<AdminSingleResponse<AdminCustomer>> => {
        const response = await apiClient.put<AdminSingleResponse<AdminCustomer>>(`/admin/customers/${id}`, data);
        return response.data;
    },
    deleteCustomer: async (id: string, reason?: string): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete(`/admin/customers/${id}`, {
            data: reason ? { reason } : undefined,
        });
        return response.data;
    },
    approveCustomer: async (id: string): Promise<AdminSingleResponse<AdminCustomer> & { message: string }> => {
        const response = await apiClient.post(`/admin/customers/${id}/approve`);
        return response.data;
    },
    rejectCustomer: async (id: string, reason: string): Promise<AdminSingleResponse<AdminCustomer> & { message: string }> => {
        const response = await apiClient.post(`/admin/customers/${id}/reject`, { reason });
        return response.data;
    },
    bulkApproveCustomers: async (ids: string[]): Promise<{ success: boolean; approved: number; message: string }> => {
        const response = await apiClient.post('/admin/customers/bulk-approve', { ids });
        return response.data;
    },
    bulkRejectCustomers: async (ids: string[], reason: string): Promise<{ success: boolean; rejected: number; message: string }> => {
        const response = await apiClient.post('/admin/customers/bulk-reject', { ids, reason });
        return response.data;
    },
    restoreCustomer: async (id: string, reason?: string): Promise<AdminSingleResponse<AdminCustomer> & { message: string }> => {
        const response = await apiClient.post(`/admin/customers/${id}/restore`, reason ? { reason } : undefined);
        return response.data;
    },
    getCustomerHistory: async (id: string): Promise<{ success: boolean; history: any[] }> => {
        const response = await apiClient.get(`/admin/customers/${id}/history`);
        return response.data;
    },
    getCustomerVersion: async (id: string, version: number): Promise<{ success: boolean; version: any }> => {
        const response = await apiClient.get(`/admin/customers/${id}/history/${version}`);
        return response.data;
    },
    rollbackCustomer: async (id: string, version: number, reason?: string): Promise<AdminSingleResponse<AdminCustomer> & { message: string }> => {
        const response = await apiClient.post(`/admin/customers/${id}/rollback`, { version, reason });
        return response.data;
    },

    // Product Management
    getProducts: async (params?: {
        businessGroup?: string;
        limit?: number;
        offset?: number;
        search?: string;
        status?: string;
        includePending?: boolean;
        includeInactive?: boolean;
    }): Promise<AdminListResponse<AdminProduct>> => {
        const response = await apiClient.get<AdminListResponse<AdminProduct>>('/admin/products', { params });
        return response.data;
    },
    /**
     * Approve and/or reactivate products in bulk.
     *
     * `filter` is the same shape the grid sends to getProducts, so the action covers every matching
     * row rather than the page the browser happens to have loaded. `expectedCount` is the total the
     * grid displayed; the server refuses if the real count has moved since.
     */
    bulkUpdateProducts: async (
        body:
            | {
                  mode: 'filter';
                  action: 'approve' | 'activate' | 'approveAndActivate';
                  expectedCount: number;
                  filter?: {
                      businessGroup?: 'CDG' | 'LSG';
                      search?: string;
                      includeInactive?: boolean;
                      status?: 'ALL' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
                      includePending?: boolean;
                  };
              }
            | {
                  mode: 'codes';
                  action: 'approve' | 'activate' | 'approveAndActivate';
                  expectedCount: number;
                  codes: Array<{ businessGroup: 'CDG' | 'LSG'; code: string }>;
              }
    ): Promise<{ success: boolean; action: string; matched: number; updated: number; message?: string }> => {
        const response = await apiClient.post('/admin/products/bulk-update', body, { timeout: 300000 });
        return response.data;
    },
    getProduct: async (id: string): Promise<AdminSingleResponse<AdminProduct>> => {
        const response = await apiClient.get<AdminSingleResponse<AdminProduct>>(`/admin/products/${id}`);
        return response.data;
    },
    getPendingProducts: async (params?: {
        businessGroup?: string;
        limit?: number;
        offset?: number;
        search?: string;
    }): Promise<AdminListResponse<AdminProduct>> => {
        const response = await apiClient.get<AdminListResponse<AdminProduct>>('/admin/products/pending', { params });
        return response.data;
    },
    getRejectedProducts: async (params?: {
        businessGroup?: string;
        limit?: number;
        offset?: number;
        search?: string;
    }): Promise<AdminListResponse<AdminProduct>> => {
        const response = await apiClient.get<AdminListResponse<AdminProduct>>('/admin/products/rejected', { params });
        return response.data;
    },
    createProduct: async (data: CreateProductData): Promise<AdminSingleResponse<AdminProduct>> => {
        const response = await apiClient.post<AdminSingleResponse<AdminProduct>>('/admin/products', data);
        return response.data;
    },
    updateProduct: async (id: string, data: Partial<CreateProductData>): Promise<AdminSingleResponse<AdminProduct>> => {
        const response = await apiClient.put<AdminSingleResponse<AdminProduct>>(`/admin/products/${id}`, data);
        return response.data;
    },
    deleteProduct: async (id: string, reason?: string): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete(`/admin/products/${id}`, {
            data: reason ? { reason } : undefined,
        });
        return response.data;
    },
    approveProduct: async (id: string): Promise<AdminSingleResponse<AdminProduct> & { message: string }> => {
        const response = await apiClient.post(`/admin/products/${id}/approve`);
        return response.data;
    },
    rejectProduct: async (id: string, reason: string): Promise<AdminSingleResponse<AdminProduct> & { message: string }> => {
        const response = await apiClient.post(`/admin/products/${id}/reject`, { reason });
        return response.data;
    },
    bulkApproveProducts: async (ids: string[]): Promise<{ success: boolean; approved: number; message: string }> => {
        const response = await apiClient.post('/admin/products/bulk-approve', { ids });
        return response.data;
    },
    bulkRejectProducts: async (ids: string[], reason: string): Promise<{ success: boolean; rejected: number; message: string }> => {
        const response = await apiClient.post('/admin/products/bulk-reject', { ids, reason });
        return response.data;
    },
    restoreProduct: async (id: string, reason?: string): Promise<AdminSingleResponse<AdminProduct> & { message: string }> => {
        const response = await apiClient.post(`/admin/products/${id}/restore`, reason ? { reason } : undefined);
        return response.data;
    },
    getProductHistory: async (id: string): Promise<{ success: boolean; history: any[] }> => {
        const response = await apiClient.get(`/admin/products/${id}/history`);
        return response.data;
    },
    getProductVersion: async (id: string, version: number): Promise<{ success: boolean; version: any }> => {
        const response = await apiClient.get(`/admin/products/${id}/history/${version}`);
        return response.data;
    },
    rollbackProduct: async (id: string, version: number, reason?: string): Promise<AdminSingleResponse<AdminProduct> & { message: string }> => {
        const response = await apiClient.post(`/admin/products/${id}/rollback`, { version, reason });
        return response.data;
    },

    // Change History / Audit Log
    getChangeHistory: async (params?: {
        recordType?: 'all' | 'customer' | 'product';
        changeType?: 'all' | 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
        changedBy?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        success: boolean;
        changes: Array<{
            id: string;
            recordType: 'customer' | 'product';
            recordId: string;
            recordCode: string;
            recordName: string;
            version: number;
            changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
            changedBy: {
                id: string;
                name: string;
                email: string;
            } | null;
            changedAt: string;
            changeReason: string | null;
            fieldChanges: Array<{
                field: string;
                oldValue: any;
                newValue: any;
            }> | null;
        }>;
        count: number;
        total: number;
        hasMore: boolean;
    }> => {
        const response = await apiClient.get('/admin/change-history', { params });
        return response.data;
    },

    /** Sample requests — customer support (read-only, all statuses) */
    listSupportForms: async (params?: {
        status?: string;
        statusGroup?: 'awaiting' | 'closed';
        formType?: string;
        businessUnit?: string;
        includeDraft?: boolean;
        search?: string;
        submittedFrom?: string;
        submittedTo?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        success: boolean;
        forms: RequestSnapshot[];
        total: number;
        limit: number;
        offset: number;
    }> => {
        const q: Record<string, string | number> = {};
        if (params?.status) q.status = params.status;
        if (params?.statusGroup) q.statusGroup = params.statusGroup;
        if (params?.formType) q.formType = params.formType;
        if (params?.businessUnit) q.businessUnit = params.businessUnit;
        if (params?.includeDraft) q.includeDraft = 'true';
        if (params?.search) q.search = params.search;
        if (params?.submittedFrom) q.submittedFrom = params.submittedFrom;
        if (params?.submittedTo) q.submittedTo = params.submittedTo;
        if (params?.limit != null) q.limit = params.limit;
        if (params?.offset != null) q.offset = params.offset;
        const response = await apiClient.get('/support/forms', { params: q });
        return response.data;
    },

    getSupportFormsSummary: async (): Promise<{
        success: boolean;
        all: number;
        awaiting: number;
        approved: number;
        closed: number;
    }> => {
        const response = await apiClient.get('/support/forms/summary');
        return response.data;
    },

    /** @deprecated Use listSupportForms */
    listApprovedForms: async (params?: {
        formType?: string;
        businessUnit?: string;
        search?: string;
        submittedFrom?: string;
        submittedTo?: string;
        limit?: number;
        offset?: number;
    }) => {
        return adminApi.listSupportForms({
            ...params,
            status: 'APPROVED',
        });
    },

    /** All submitted sample requests (admin): filters + pagination */
    listForms: async (params?: {
        status?: string;
        formType?: string;
        businessUnit?: string;
        includeDraft?: boolean;
        search?: string;
        submittedFrom?: string;
        submittedTo?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        success: boolean;
        forms: RequestSnapshot[];
        total: number;
        limit: number;
        offset: number;
    }> => {
        const q: Record<string, string | number> = {};
        if (params?.status) q.status = params.status;
        if (params?.formType) q.formType = params.formType;
        if (params?.businessUnit) q.businessUnit = params.businessUnit;
        if (params?.search) q.search = params.search;
        if (params?.submittedFrom) q.submittedFrom = params.submittedFrom;
        if (params?.submittedTo) q.submittedTo = params.submittedTo;
        if (params?.limit != null) q.limit = params.limit;
        if (params?.offset != null) q.offset = params.offset;
        if (params?.includeDraft === true) q.includeDraft = 'true';
        const response = await apiClient.get('/admin/forms', { params: q });
        return response.data;
    },

    // Hierarchy Management
    getHierarchyList: async (params?: {
        businessUnit?: 'CDG' | 'LSG';
        role?: string;
        formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';
        page?: number;
        limit?: number;
        search?: string;
        includeInactive?: boolean;
    }): Promise<{
        success: boolean;
        users: Array<{
            id: string;
            name: string;
            email: string;
            role: string;
            businessUnit: string | null;
            hierarchy: {
                salesManager?: { id: string; name: string; email: string } | null;
                districtSalesManager?: { id: string; name: string; email: string } | null;
                nationalSalesManager?: { id: string; name: string; email: string } | null;
                localFinanceController?: { id: string; name: string; email: string } | null;
                directorCommercialManager?: { id: string; name: string; email: string } | null;
                technicalManager?: { id: string; name: string; email: string } | null;
                nationalTSManager?: { id: string; name: string; email: string } | null;
            };
            subordinatesCount: number;
        }>;
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }> => {
        const response = await apiClient.get('/admin/hierarchy', { params });
        return response.data;
    },
    getHierarchyTree: async (params?: {
        rootUserId?: string;
        businessUnit?: 'CDG' | 'LSG';
    }): Promise<{
        success: boolean;
        tree: {
            root: {
                id: string;
                name: string;
                email: string;
                role: string;
                businessUnit: string | null;
                subordinates: Array<any>;
            };
        } | null;
        message?: string;
    }> => {
        const response = await apiClient.get('/admin/hierarchy/tree', { params });
        return response.data;
    },
    getUserHierarchyDetails: async (id: string): Promise<{
        success: boolean;
        user: {
            id: string;
            name: string;
            email: string;
            role: string;
            businessUnit: string | null;
            department: string | null;
            salesRepCode: string | null;
            hierarchy: {
                salesManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                districtSalesManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                nationalSalesManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                localFinanceController?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                directorCommercialManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                technicalManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
                nationalTSManager?: { id: string; name: string; email: string; role: string; businessUnit: string | null } | null;
            };
        };
        subordinates: Array<{
            id: string;
            name: string;
            email: string;
            role: string;
            businessUnit: string | null;
            hierarchy: any;
            subordinatesCount: number;
        }>;
        validationIssues: Array<{
            type: 'MISSING_APPROVER' | 'CIRCULAR_REFERENCE' | 'INVALID_ROLE' | 'BUSINESS_UNIT_MISMATCH';
            userId: string;
            userName: string;
            field?: string;
            approverName?: string;
            approverId?: string;
            approverRole?: string;
            expectedRole?: string;
            severity: 'ERROR' | 'WARNING';
            userId2?: string;
            userName2?: string;
        }>;
    }> => {
        const response = await apiClient.get(`/admin/hierarchy/user/${id}`);
        return response.data;
    },
    updateUserHierarchy: async (
        id: string,
        data: {
            name?: string;
            email?: string;
            reportsToId?: string | null;
            formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';
            salesManagerId?: string | null;
            districtSalesManagerId?: string | null;
            nationalSalesManagerId?: string | null;
            localFinanceControllerId?: string | null;
            directorCommercialManagerId?: string | null;
            technicalManagerId?: string | null;
            nationalTSManagerId?: string | null;
        }
    ): Promise<{
        success: boolean;
        user: {
            id: string;
            name: string;
            hierarchy: any;
        };
        changes: Array<{
            field: string;
            oldValue: string | null;
            newValue: string | null;
        }>;
    }> => {
        const response = await apiClient.put(`/admin/hierarchy/user/${id}`, data);
        return response.data;
    },
    getUserSubordinates: async (id: string): Promise<{
        success: boolean;
        subordinates: Array<{
            id: string;
            name: string;
            email: string;
            role: string;
            businessUnit: string | null;
            hierarchy: any;
            subordinatesCount: number;
        }>;
        count: number;
    }> => {
        const response = await apiClient.get(`/admin/hierarchy/user/${id}/subordinates`);
        return response.data;
    },
    validateHierarchy: async (
        userId: string,
        data: {
            formType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT';
            salesManagerId?: string | null;
            districtSalesManagerId?: string | null;
            nationalSalesManagerId?: string | null;
            localFinanceControllerId?: string | null;
            directorCommercialManagerId?: string | null;
            technicalManagerId?: string | null;
            nationalTSManagerId?: string | null;
        }
    ): Promise<{
        success: boolean;
        validation: {
            valid: boolean;
            errors: Array<{
                field: string;
                type: string;
                message: string;
                severity: 'ERROR' | 'WARNING';
            }>;
            warnings: Array<{
                field: string;
                type: string;
                message: string;
            }>;
        };
    }> => {
        const response = await apiClient.post('/admin/hierarchy/validate', { userId, ...data });
        return response.data;
    },
    validateHierarchies: async (): Promise<{
        success: boolean;
        validation: {
            totalUsers: number;
            validUsers: number;
            issues: Array<{
                type: 'MISSING_APPROVER' | 'CIRCULAR_REFERENCE' | 'INVALID_ROLE' | 'BUSINESS_UNIT_MISMATCH';
                userId: string;
                userName: string;
                field?: string;
                approverName?: string;
                approverId?: string;
                approverRole?: string;
                expectedRole?: string;
                severity: 'ERROR' | 'WARNING';
                userId2?: string;
                userName2?: string;
            }>;
        };
    }> => {
        const response = await apiClient.get('/admin/hierarchy/validate');
        return response.data;
    },
    getCircularReferences: async (): Promise<{
        success: boolean;
        issues: Array<{
            type: 'CIRCULAR_REFERENCE';
            userId: string;
            userName: string;
            userId2: string;
            userName2: string;
            severity: 'ERROR';
        }>;
        count: number;
    }> => {
        const response = await apiClient.get('/admin/hierarchy/circular');
        return response.data;
    },
    getMissingApprovers: async (): Promise<{
        success: boolean;
        issues: Array<{
            type: 'MISSING_APPROVER';
            userId: string;
            userName: string;
            field: string;
            approverId?: string;
            approverName?: string;
            severity: 'ERROR' | 'WARNING';
        }>;
        count: number;
    }> => {
        const response = await apiClient.get('/admin/hierarchy/missing-approvers');
        return response.data;
    },

    // Bulk Import (Phase 1: validate only)
    /**
     * Bytes per chunk when staging a file through /admin/import/chunk.
     *
     * The UAT/production load balancer rejects request bodies over ~8KB (AWS WAF
     * SizeRestrictions_BODY), so a whole workbook never reaches the app — it 403s at `awselb`
     * before nginx. 6KB of file plus multipart framing and the uploadId/index fields lands around
     * 6.7KB, comfortably inside that. Raise this once the WAF rule is lifted: nothing else has to
     * change, the upload just needs fewer round trips.
     */
    IMPORT_CHUNK_BYTES: 7 * 1024,
    /**
     * Chunk requests in flight at once.
     *
     * Was 4. Dropped to 2 after a 10,099-row upload from the corporate network was cut off at
     * chunk 38 with a 403 from `awselb` — twice, at the same point. The body-size rule is not the
     * cause (a 7,620-byte body passes; 8,644 is blocked, so 7KB chunks sit inside it) and the burst
     * could not be reproduced from outside that network at 4x concurrency and 160 requests. A
     * lower rate plus the retry below turns that block into a slower upload instead of a failure.
     */
    IMPORT_CHUNK_CONCURRENCY: 2,
    /** Attempts per chunk before giving up, including the first. */
    IMPORT_CHUNK_ATTEMPTS: 6,

    /**
     * Slice a file across many small requests and return the server-side uploadId.
     *
     * Validate and execute both accept that id, so a file is staged once and read twice — the
     * alternative would double an already chatty upload.
     *
     * Chunks retry with exponential backoff on the statuses an edge device uses to shed load, and
     * the server is asked what it is still missing before finalizing, so a partially blocked burst
     * resumes rather than restarting.
     */
    stageImportUpload: async (
        file: File,
        onProgress?: (p: { sent: number; total: number; retrying?: boolean }) => void
    ): Promise<string> => {
        const chunkBytes = adminApi.IMPORT_CHUNK_BYTES;
        const totalChunks = Math.max(1, Math.ceil(file.size / chunkBytes));

        const begin = await apiClient.post('/admin/import/chunk/begin', {
            filename: file.name,
            totalChunks,
            totalBytes: file.size,
        });
        const uploadId: string = begin.data?.uploadId;
        if (!uploadId) throw new Error('Server did not return an upload id.');

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        /** 403 is what the load balancer returns when it sheds a request; the rest are transient. */
        const isTransient = (status?: number) =>
            status === undefined || status === 403 || status === 408 || status === 429 || status >= 500;

        let sent = 0;
        const putChunk = async (index: number): Promise<void> => {
            const start = index * chunkBytes;
            const blob = file.slice(start, Math.min(start + chunkBytes, file.size));
            for (let attempt = 1; ; attempt++) {
                try {
                    const form = new FormData();
                    form.append('uploadId', uploadId);
                    form.append('index', String(index));
                    form.append('chunk', blob, `${index}.part`);
                    await apiClient.post('/admin/import/chunk', form, { timeout: 60000 });
                    sent += 1;
                    onProgress?.({ sent, total: totalChunks });
                    return;
                } catch (err: any) {
                    const status = err?.response?.status as number | undefined;
                    if (!isTransient(status) || attempt >= adminApi.IMPORT_CHUNK_ATTEMPTS) throw err;
                    // Full jitter, so retries from parallel workers do not re-collide.
                    const backoff = Math.min(8000, 400 * 2 ** (attempt - 1));
                    onProgress?.({ sent, total: totalChunks, retrying: true });
                    await sleep(Math.random() * backoff);
                }
            }
        };

        // Fixed pool of workers pulling from a shared cursor: keeps N requests in flight without
        // building an array of thousands of pending promises.
        const runPool = async (indexes: number[]) => {
            let next = 0;
            await Promise.all(
                Array.from({ length: Math.min(adminApi.IMPORT_CHUNK_CONCURRENCY, indexes.length) }, async () => {
                    for (;;) {
                        const at = next++;
                        if (at >= indexes.length) return;
                        await putChunk(indexes[at]);
                    }
                })
            );
        };

        await runPool(Array.from({ length: totalChunks }, (_, i) => i));

        // Ask what actually landed. A worker that exhausted its retries leaves a gap, and one more
        // slow pass over just the gaps is far cheaper than re-sending the whole file.
        for (let sweep = 0; sweep < 3; sweep++) {
            const { data } = await apiClient.post('/admin/import/chunk/status', { uploadId });
            const missing: number[] = data?.missing ?? [];
            if (missing.length === 0) break;
            if (sweep === 2) {
                throw new Error(
                    `Upload could not finish: ${missing.length} of ${totalChunks} parts were rejected by the ` +
                        `network even after retrying. The load balancer in front of this environment limits ` +
                        `request bodies to 8KB, so a large file has to be sent in ${totalChunks} parts and a ` +
                        `burst that size can be throttled. Raising that limit is the real fix; until then, ` +
                        `retry, or split the file into smaller ones.`
                );
            }
            await sleep(2000 * (sweep + 1));
            await runPool(missing);
        }

        await apiClient.post('/admin/import/chunk/finalize', { uploadId });
        return uploadId;
    },

    /** Give back the staged bytes when the user cancels or the page moves on. */
    abortImportUpload: async (uploadId: string): Promise<void> => {
        try {
            await apiClient.post('/admin/import/chunk/abort', { uploadId });
        } catch {
            /* the server sweeps abandoned sessions on a TTL anyway */
        }
    },

    getImportSheetInfo: async (file: File, uploadId?: string): Promise<{
        success: boolean;
        sheetNames: string[];
        rowCountPerSheet: Record<string, number>;
        message?: string;
    }> => {
        if (uploadId) {
            const staged = await apiClient.post('/admin/import/sheet-info', { uploadId }, { timeout: 120000 });
            return staged.data;
        }
        const formData = new FormData();
        formData.append('file', file);
        const response = await apiClient.post('/admin/import/sheet-info', formData, { timeout: 120000 });
        return response.data;
    },
    /**
     * The whole Return matrix, in the columns the bulk importer reads back.
     *
     * A blob rather than a URL the browser navigates to: this endpoint is behind the same auth
     * header as every other admin call, and a plain link would arrive without it.
     */
    exportReturnApprovalMatrix: async (): Promise<{ blob: Blob; filename: string }> => {
        const response = await apiClient.get('/admin/approval-mappings/return/export', {
            responseType: 'blob',
        });
        const disposition = String(response.headers['content-disposition'] ?? '');
        const match = /filename="([^"]+)"/.exec(disposition);
        return {
            blob: response.data as Blob,
            filename: match ? match[1] : 'return-approval-matrix.csv',
        };
    },

    validateImport: async (
        entity: ImportEntity,
        file: File,
        onProgress?: (progress: { uploadPercent: number; phase: 'uploading' | 'validating' }) => void,
        selectedSheets?: string[],
        options?: { uploadId?: string }
    ): Promise<{
        success: boolean;
        entity: string;
        totalRows: number;
        validRows: number;
        invalidRows: number;
        errors: Array<{ row: number; column: string; message: string; value: string }>;
        preview?: Array<{ row: number; action: string; data: any }>;
        message?: string;
        requesterGroupSyncHint?: string;
        userImportHint?: string;
        zncInstallHint?: string;
        zncClaimHint?: string;
        zintQcHint?: string;
    }> => {
        if (options?.uploadId) {
            // Already staged in chunks: send the id, not the bytes.
            const staged = await apiClient.post(
                '/admin/import/validate',
                {
                    entity,
                    uploadId: options.uploadId,
                    ...(selectedSheets?.length ? { sheets: selectedSheets.join('|') } : {}),
                },
                { timeout: 300000 }
            );
            onProgress?.({ uploadPercent: 100, phase: 'validating' });
            return staged.data;
        }
        const formData = new FormData();
        formData.append('entity', entity);
        formData.append('file', file);
        const params: Record<string, string> = {};
        if (selectedSheets && selectedSheets.length > 0) {
            const sheetsParam = selectedSheets.join('|');
            params.sheets = sheetsParam;
            formData.append('sheets', sheetsParam);
        }
        const response = await apiClient.post('/admin/import/validate', formData, {
            params,
            timeout: 300000, // 5 minutes for large files (up to 100 MB, all sheets)
            onUploadProgress: (e) => {
                if (!onProgress) return;
                const uploadPercent = e.total ? Math.min(100, Math.round((e.loaded / e.total) * 100)) : 0;
                const phase = uploadPercent >= 100 ? 'validating' : 'uploading';
                onProgress({ uploadPercent, phase });
            },
        });
        return response.data;
    },

    /** Phase 2: upsert validated rows into the database (re-parses and validates server-side). */
    executeImport: async (
        entity: ImportEntity,
        file: File,
        selectedSheets?: string[],
        options?: { skipInvalidRows?: boolean; uploadId?: string }
    ): Promise<{
        success: boolean;
        entity: string;
        totalRows: number;
        importedRows: number;
        created: number;
        updated: number;
        message?: string;
        requesterSync?: { created: number; updated: number; moved: number };
        /** ZINT QC: stale mapping rows deleted so DB matches file */
        removedFromDb?: number;
        /** Rows that had validation errors and were not imported */
        skippedInvalidRows?: number;
    }> => {
        if (options?.uploadId) {
            const staged = await apiClient.post(
                '/admin/import/execute',
                {
                    entity,
                    uploadId: options.uploadId,
                    ...(selectedSheets?.length ? { sheets: selectedSheets.join('|') } : {}),
                    ...(options.skipInvalidRows ? { skipInvalidRows: true } : {}),
                },
                { timeout: 900000 }
            );
            return staged.data;
        }
        const formData = new FormData();
        formData.append('entity', entity);
        formData.append('file', file);
        if (options?.skipInvalidRows) {
            formData.append('skipInvalidRows', 'true');
        }
        const params: Record<string, string> = {};
        if (selectedSheets && selectedSheets.length > 0) {
            const sheetsParam = selectedSheets.join('|');
            params.sheets = sheetsParam;
            formData.append('sheets', sheetsParam);
        }
        const response = await apiClient.post('/admin/import/execute', formData, {
            params,
            timeout: 600000,
        });
        return response.data;
    },

    compareCustomerList: async (
        file: File,
        customerType: '1' | '2' | '8',
        onProgress?: (progress: { uploadPercent: number; phase: 'uploading' | 'comparing' }) => void
    ): Promise<{
        success: boolean;
        customerType: '1' | '2' | '8';
        customerTypeLabel: string;
        summary: {
            added: number;
            updated: number;
            removed: number;
            alreadyInactive: number;
            unchanged: number;
            invalidRows: number;
            fileRowsForType: number;
        };
        added: Array<{
            id?: string;
            businessGroup: string;
            code: string;
            sapCode: string;
            nameJp: string;
            nameEn: string;
        }>;
        updated: Array<{
            id?: string;
            businessGroup: string;
            code: string;
            sapCode: string;
            nameJp: string;
            nameEn: string;
            fieldChanges?: Array<{ field: string; fileValue: string | number | null; dbValue: string | number | null }>;
        }>;
        removed: Array<{
            id?: string;
            businessGroup: string;
            code: string;
            sapCode: string;
            nameJp: string;
            nameEn: string;
            updatedAt?: string;
        }>;
        alreadyInactive: Array<{
            id?: string;
            businessGroup: string;
            code: string;
            sapCode: string;
            nameJp: string;
            nameEn: string;
            updatedAt?: string;
        }>;
        errors: Array<{ row: number; column: string; message: string; value: string }>;
        totalErrorCount?: number;
        errorsTruncated?: boolean;
        excludedOtherTypeRows?: number;
        emptySelectedType?: boolean;
        warning?: string;
        hint?: string;
    }> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('customerType', customerType);
        const response = await apiClient.post('/admin/customers/reconcile/compare', formData, {
            params: { customerType },
            timeout: 300000,
            onUploadProgress: (e) => {
                if (!onProgress) return;
                const uploadPercent = e.total ? Math.min(100, Math.round((e.loaded / e.total) * 100)) : 0;
                const phase = uploadPercent >= 100 ? 'comparing' : 'uploading';
                onProgress({ uploadPercent, phase });
            },
        });
        return response.data;
    },

    disableRemovedCustomers: async (data: {
        customerType: '1' | '2' | '8';
        customerIds: string[];
        reason?: string;
    }): Promise<{
        success: boolean;
        customerType: '1' | '2' | '8';
        disabled: number;
        skipped: Array<{ id: string; reason: string }>;
        message?: string;
    }> => {
        const response = await apiClient.post('/admin/customers/reconcile/disable', data);
        return response.data;
    },

    // Requester groups & requesters (admin directory)
    /** Typeahead: requester groups (teams) for approval mapping, filtered by CDG / LSG / SERVICE. */
    searchAdminRequesterGroupsForPicker: async (params: {
        businessUnit: 'CDG' | 'LSG' | 'SERVICE';
        q?: string;
        limit?: number;
    }): Promise<{
        success: boolean;
        groups: Array<{ id: string; name: string; businessUnit: string; code: string }>;
    }> => {
        const response = await apiClient.get('/admin/requester-groups/picker', { params });
        return response.data;
    },

    getAdminRequesterGroups: async (params?: {
        businessUnit?: string;
        includeInactive?: boolean;
        /** 'RETURN' or 'SAMPLE'; omit for both. Shared groups appear under either. */
        formScope?: 'RETURN' | 'SAMPLE';
    }): Promise<{
        success: boolean;
        groups: Array<{
            id: string;
            code: string;
            name: string;
            businessUnit: string;
            isActive: boolean;
            formScope: string | null;
            requesterCount: number;
        }>;
    }> => {
        const response = await apiClient.get('/admin/requester-groups', { params });
        return response.data;
    },
    createAdminRequesterGroup: async (data: {
        name: string;
        businessUnit: 'CDG' | 'LSG' | 'CDG/LSG' | 'SERVICE';
        code?: string;
    }): Promise<{ success: boolean; group: unknown }> => {
        const response = await apiClient.post('/admin/requester-groups', data);
        return response.data;
    },
    updateAdminRequesterGroup: async (
        id: string,
        data: Partial<{ name: string; businessUnit: 'CDG' | 'LSG' | 'CDG/LSG' | 'SERVICE'; isActive: boolean }>
    ): Promise<{ success: boolean; group: unknown }> => {
        const response = await apiClient.put(`/admin/requester-groups/${id}`, data);
        return response.data;
    },
    deleteAdminRequesterGroup: async (id: string): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete(`/admin/requester-groups/${id}`);
        return response.data;
    },
    getAdminRequesters: async (requesterGroupId: string): Promise<{
        success: boolean;
        requesters: Array<{
            id: string;
            name: string;
            code: string;
            requesterGroupId: string;
            isActive: boolean;
            userId: string | null;
            sampleRequestType: string | null;
        }>;
        group: { id: string; code: string; name: string; businessUnit: string };
    }> => {
        const response = await apiClient.get('/admin/requesters', { params: { requesterGroupId } });
        return response.data;
    },
    createAdminRequester: async (data: {
        requesterGroupId: string;
        name: string;
        code: string;
        sampleRequestType?: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | null;
    }): Promise<{ success: boolean; requester: unknown }> => {
        const response = await apiClient.post('/admin/requesters', data);
        return response.data;
    },
    updateAdminRequester: async (
        id: string,
        data: Partial<{
            requesterGroupId: string;
            name: string;
            code: string;
            isActive: boolean;
            sampleRequestType: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | null;
        }>
    ): Promise<{ success: boolean; requester: unknown }> => {
        const response = await apiClient.put(`/admin/requesters/${id}`, data);
        return response.data;
    },
    deleteAdminRequester: async (id: string): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete(`/admin/requesters/${id}`);
        return response.data;
    },

    /** Typeahead: active requesters across all groups (approval mapping requester field). */
    searchAdminRequestersForPicker: async (
        q: string,
        limit?: number
    ): Promise<{
        success: boolean;
        requesters: Array<{
            id: string;
            name: string;
            code: string;
            /** Which team holds them, so a link naming a person can select it. */
            requesterGroupId: string;
            groupName: string;
            businessUnit: string;
            formScope: string | null;
        }>;
    }> => {
        const response = await apiClient.get('/admin/requesters/search', { params: { q, limit } });
        return response.data;
    },

    /** Typeahead: active users by name (approver slots — any role, not only ADMIN). */
    getAdminUsersForApprovalPicker: async (
        q?: string,
        limit?: number
    ): Promise<{
        success: boolean;
        users: Array<{
            id: string;
            name: string;
            email: string;
            businessUnit: string | null;
            role: string;
        }>;
    }> => {
        const response = await apiClient.get('/admin/users/approval-picker', { params: { q: q ?? '', limit } });
        return response.data;
    },

    /** All four mapping tables for one requester (admin “full picture”). */
    getAdminApprovalMappingSummary: async (
        name: string
    ): Promise<{
        success: boolean;
        query: string;
        normalizedName: string;
        tables: Record<
            string,
            {
                formType: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return';
                label: string;
                count: number;
                rows: Record<string, unknown>[];
                duplicateLegacyBuWarning: boolean;
            }
        >;
    }> => {
        const response = await apiClient.get('/admin/approval-mappings/summary', { params: { name } });
        return response.data;
    },

    /** A person who left: everywhere their name steers an approval (read-only). */
    previewPersonOffboarding: async (name: string): Promise<{ success: boolean; scope: OffboardingScope }> => {
        const response = await apiClient.get('/admin/people/offboarding', { params: { name } });
        return response.data;
    },
    /** The removal itself: the name typed back, an optional successor for the approver cells and manager links. */
    executePersonOffboarding: async (data: {
        name: string;
        confirmName: string;
        successorName?: string;
    }): Promise<OffboardingResult> => {
        const response = await apiClient.post('/admin/people/offboarding', data);
        return response.data;
    },

    /** Approval mapping CRUD (same tables as bulk hierarchy import) — formType: zsam | znc-installation | znc-claim | zint | return */
    getAdminApprovalMappings: async (
        formType: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return',
        params?: {
            page?: number;
            limit?: number;
            businessUnit?: 'CDG' | 'LSG' | 'SERVICE' | '';
            search?: string;
            sortBy?: string;
            sortDir?: 'asc' | 'desc';
        }
    ): Promise<{
        success: boolean;
        formType: string;
        rows: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
        sortBy?: string;
        sortDir?: string;
    }> => {
        const response = await apiClient.get(`/admin/approval-mappings/${formType}`, { params });
        return response.data;
    },
    createAdminApprovalMapping: async (
        formType: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return',
        data: Record<string, unknown>
    ): Promise<{ success: boolean; formType: string; row: Record<string, unknown> }> => {
        const response = await apiClient.post(`/admin/approval-mappings/${formType}`, data);
        return response.data;
    },
    updateAdminApprovalMapping: async (
        formType: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return',
        id: string,
        data: Record<string, unknown>
    ): Promise<{ success: boolean; formType: string; row: Record<string, unknown> }> => {
        const response = await apiClient.put(`/admin/approval-mappings/${formType}/${id}`, data);
        return response.data;
    },
    deleteAdminApprovalMapping: async (
        formType: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return',
        id: string
    ): Promise<{ success: boolean; message: string }> => {
        const response = await apiClient.delete(`/admin/approval-mappings/${formType}/${id}`);
        return response.data;
    },

    updateWizardStep2DataBanner: async (message: string): Promise<{ message: string }> => {
        const response = await apiClient.put<{ message: string }>('/admin/app-settings/wizard-step2-data-banner', {
            message,
        });
        return response.data;
    },

    listAdminUsers: async (params?: { scope?: 'all' }): Promise<{
        success: boolean;
        users: AdminUserSummary[];
    }> => {
        const response = await apiClient.get('/admin/users', { params });
        return response.data;
    },
    exportAdminUsersCsv: async (): Promise<Blob> => {
        const response = await apiClient.get('/admin/users/export', { responseType: 'blob' });
        return response.data;
    },
    createAdminUser: async (data: {
        email: string;
        name: string;
        password: string;
        businessUnit?: 'CDG' | 'LSG' | null;
        role?: AdminUserRole;
        isSuperApprover?: boolean;
        isServiceAdmin?: boolean;
        isCustomerSupport?: boolean;
        requesterGroupId?: string;
        salesRepCode?: string;
    }): Promise<{ success: boolean; user: AdminUserSummary }> => {
        const response = await apiClient.post('/admin/users', data);
        return response.data;
    },
    patchAdminUser: async (
        id: string,
        data: {
            name?: string;
            businessUnit?: 'CDG' | 'LSG' | null;
            isActive?: boolean;
            password?: string;
            role?: AdminUserRole;
            isSuperApprover?: boolean;
            isServiceAdmin?: boolean;
            isCustomerSupport?: boolean;
            /** null clears the pinned team; undefined leaves it unchanged. */
            requesterGroupId?: string | null;
            /** null clears the code; undefined leaves it unchanged. */
            salesRepCode?: string | null;
        }
    ): Promise<{ success: boolean; user: AdminUserSummary }> => {
        const response = await apiClient.patch(`/admin/users/${id}`, data);
        return response.data;
    },
};

export type AdminUserRole =
    | 'REQUESTER'
    | 'SALES_MANAGER'
    | 'DISTRICT_SALES_MANAGER'
    | 'NATIONAL_SALES_MANAGER'
    | 'FINANCE_CONTROLLER'
    | 'DIRECTOR_COMMERCIAL'
    | 'ADMIN'
    | 'SUPER_APPROVER'
    | 'CUSTOMER_SUPPORT';

export interface AdminUserSummary {
    id: string;
    email: string;
    name: string;
    businessUnit: string | null;
    role?: AdminUserRole;
    isSuperApprover?: boolean;
    isServiceAdmin?: boolean;
    isCustomerSupport?: boolean;
    requesterGroupId?: string | null;
    salesRepCode?: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

// Product master sync: preview a Power BI export as a run, inspect it, apply it.
export type ProductSyncRunStatus = 'PREVIEWING' | 'PREVIEWED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'SUPERSEDED';
export type ProductSyncRowAction = 'CREATE' | 'UPDATE' | 'REACTIVATE' | 'RETIRE' | 'KEEP_INACTIVE' | 'HELD' | 'SKIPPED' | 'INVALID' | 'UNCHANGED';

export interface ProductSyncGuard {
    name: string;
    ok: boolean;
    severity: 'fail' | 'warn';
    detail: string;
}

export interface ProductSyncBusinessGroupCounts {
    kept: number;
    activeBefore: number;
    create: number;
    update: number;
    retire: number;
    reactivate: number;
}

export interface ProductSyncCounts {
    read: number;
    kept: number;
    skippedByRule: number;
    invalid: number;
    held: number;
    create: number;
    update: number;
    reactivate: number;
    unchanged: number;
    retire: number;
    keepInactive: number;
    /** Of the removals, products created (or restored) by hand in the app. */
    manualRetire?: number;
    /** Products left alone because the file's row for them failed validation. */
    protectedInvalid?: number;
    perBusinessGroup: Record<string, ProductSyncBusinessGroupCounts>;
    written?: {
        created: number;
        updated: number;
        reactivated: number;
        retired: number;
        keptInactiveUpdated: number;
        historyRows: number;
        baselineRows: number;
    };
}

export interface ProductSyncRun {
    id: string;
    source: string;
    trigger: string;
    mode: string;
    status: ProductSyncRunStatus;
    /** Set when the run was applied: the master's version number. */
    version: number | null;
    /** A restore: the run whose file it re-applies. */
    restoredFromRunId: string | null;
    note: string | null;
    fileName: string | null;
    appliedFilter: string | null;
    counts: ProductSyncCounts | null;
    guards: ProductSyncGuard[] | null;
    samples: { errors?: Array<{ row: number; column: string; message: string; value: string }>; totalErrorCount?: number } | null;
    error: string | null;
    guardOverrideReason: string | null;
    triggeredByName: string | null;
    startedAt: string;
    previewedAt: string | null;
    applyStartedAt: string | null;
    finishedAt: string | null;
}

export interface ProductSyncFieldChange {
    field: string;
    oldValue: string | number | boolean | null;
    newValue: string | number | boolean | null;
}

export interface ProductSyncRow {
    id: string;
    action: ProductSyncRowAction;
    holdKind: 'COLLISION' | 'AMBIGUOUS' | 'RENAME_BLOCKED' | null;
    productId: string | null;
    businessGroup: string;
    code: string;
    sapCode: string;
    name: string;
    productNameLocal: string;
    price: number | null;
    listPrice: number | null;
    priceGroup: string | null;
    serviceFlag: string | null;
    dchain: string | null;
    rowIndex: number | null;
    reason: string | null;
    fieldChanges: ProductSyncFieldChange[] | null;
}

export interface ProductSyncHistoryRow {
    id: string;
    productId: string;
    businessGroup: string;
    code: string;
    name: string;
    version: number;
    changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
    changeReason: string | null;
    changedAt: string;
    fieldChanges: ProductSyncFieldChange[] | null;
    price: number;
    listPrice: number;
    isActive: boolean;
}

/** One applied master: a version that can be downloaded and restored. */
export interface ProductMasterVersion {
    runId: string;
    version: number;
    fileName: string | null;
    appliedAt: string | null;
    appliedBy: string | null;
    counts: ProductSyncCounts | null;
    guardOverrideReason: string | null;
    note: string | null;
    restoredFromVersion: number | null;
    /** False for versions applied before files were kept: they cannot be restored. */
    fileKept: boolean;
    fileSize: number | null;
}

export const productSyncApi = {
    /** Stage the file (chunked when it is bigger than one chunk) and start a preview run. */
    startPreview: async (
        file: File,
        onProgress?: (p: { sent: number; total: number; retrying?: boolean }) => void
    ): Promise<string> => {
        if (file.size > adminApi.IMPORT_CHUNK_BYTES) {
            const uploadId = await adminApi.stageImportUpload(file, onProgress);
            const { data } = await apiClient.post('/admin/product-sync/runs', { uploadId, fileName: file.name });
            return data.runId as string;
        }
        const form = new FormData();
        form.append('file', file);
        form.append('fileName', file.name);
        const { data } = await apiClient.post('/admin/product-sync/runs', form, { timeout: 120000 });
        return data.runId as string;
    },
    getRun: async (runId: string): Promise<ProductSyncRun> => {
        const { data } = await apiClient.get(`/admin/product-sync/runs/${runId}`);
        return data.run as ProductSyncRun;
    },
    listRuns: async (limit = 20): Promise<ProductSyncRun[]> => {
        const { data } = await apiClient.get('/admin/product-sync/runs', { params: { limit } });
        return data.runs as ProductSyncRun[];
    },
    getRows: async (
        runId: string,
        action: ProductSyncRowAction,
        offset: number,
        limit: number
    ): Promise<{ rows: ProductSyncRow[]; total: number; hasMore: boolean }> => {
        const { data } = await apiClient.get(`/admin/product-sync/runs/${runId}/rows`, { params: { action, offset, limit } });
        return data;
    },
    exportRows: async (runId: string, action: ProductSyncRowAction): Promise<Blob> => {
        const response = await apiClient.get(`/admin/product-sync/runs/${runId}/export`, {
            params: { action },
            responseType: 'blob',
            timeout: 300000,
        });
        return response.data as Blob;
    },
    /**
     * Every product a requester can select, in the Power BI export's layout: the one product export,
     * used by both the sync page and the Products page.
     */
    exportCurrentProducts: async (): Promise<Blob> => {
        const response = await apiClient.get('/admin/product-sync/export', { responseType: 'blob', timeout: 300000 });
        return response.data as Blob;
    },
    listVersions: async (limit = 50): Promise<ProductMasterVersion[]> => {
        const { data } = await apiClient.get('/admin/product-sync/versions', { params: { limit } });
        return data.versions as ProductMasterVersion[];
    },
    /** The file a run was made from, as it was uploaded. */
    downloadRunFile: async (runId: string): Promise<Blob> => {
        const response = await apiClient.get(`/admin/product-sync/runs/${runId}/file`, { responseType: 'blob', timeout: 300000 });
        return response.data as Blob;
    },
    /** Starts a preview of that version's file against the catalogue as it is now; returns the new run. */
    restoreVersion: async (runId: string, reason: string): Promise<string> => {
        const { data } = await apiClient.post(`/admin/product-sync/runs/${runId}/restore`, { reason });
        return data.runId as string;
    },
    /** Starts the apply; poll getRun until it is APPLIED, PREVIEWED (refused) or FAILED. */
    apply: async (runId: string, overrideReason?: string): Promise<void> => {
        await apiClient.post(`/admin/product-sync/runs/${runId}/apply`, { overrideReason });
    },
    getHistory: async (
        runId: string,
        offset: number,
        limit: number
    ): Promise<{ rows: ProductSyncHistoryRow[]; total: number; hasMore: boolean }> => {
        const { data } = await apiClient.get(`/admin/product-sync/runs/${runId}/history`, { params: { offset, limit } });
        return data;
    },
};

// Export axios instance for custom requests
export default apiClient;
