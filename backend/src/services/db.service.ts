/**
 * DEPRECATED: This file is kept only for TypeScript interface definitions.
 * 
 * All data operations now use Prisma Client via prisma.service.ts
 * The DatabaseService class below is no longer used in production code.
 * 
 * Migration Status: COMPLETE
 * - All data now stored in PostgreSQL
 * - All operations use Prisma Client
 * - This file kept for type definitions only
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface User {
    id: string;
    email: string;
    password: string;
    name: string;
    role: 'REQUESTER' | 'SALES_MANAGER' | 'DISTRICT_SALES_MANAGER' | 'NATIONAL_SALES_MANAGER' | 'FINANCE_CONTROLLER' | 'DIRECTOR_COMMERCIAL' | 'ADMIN' | 'SUPER_APPROVER';
    /** Super-approver powers in addition to primary `role` (also true for migrated legacy `role === SUPER_APPROVER` users). */
    isSuperApprover?: boolean;
    /** Service Admin team, in addition to `role`. See hasServiceAdminPrivileges. */
    isServiceAdmin?: boolean;
    /** Customer Service view, in addition to `role`. See hasCustomerSupportView. */
    isCustomerSupport?: boolean;
    businessUnit?: string;
    department?: string;
    salesRepCode?: string;
    requesterGroupId?: string;
    salesManager?: string;
    districtSalesManager?: string;
    nationalSalesManager?: string;
    localFinanceController?: string;
    directorCommercialManager?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface FormProduct {
    id: string;
    formId: string;
    productCode: string;
    productName: string;
    sapCode?: string;
    quantity: number;
    unitPrice: number;
    wholesalePrice?: number;
    subtotal: number;
    isConsumable: boolean;
    lotNumber?: string;
    expiryDate?: string;
    note?: string;
    /** Return flow only: credited amount for this line (defaults to the catalogue total, overridable). */
    returnAmount?: number;
    /** Return flow only: amount re-billed for this line; ZCMR and ZRE lock it to 0. */
    rebillAmount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface SalesForm {
    id: string;
    referenceNumber?: string;
    formType: 'ZSAM' | 'ZNC' | 'ZNCCLAIM' | 'ZINT' | 'RETURN';
    requesterId: string;
    requesterName: string;
    salesRepCodeSap?: string;
    businessUnit?: string;
    requesterGroup?: string;
    requestDate: string;
    expectedDeliveryDate?: string;
    purpose: string;
    deliveryMode?: string;
    soldToCode?: string;
    soldToName?: string;
    shipToCode?: string;
    shipToName?: string;
    attentionTo?: string;
    endUserCode?: string;
    endUserName?: string;
    address?: string;
    postalCode?: string;
    prefecture?: string;
    phone?: string;
    salesManager?: string;
    districtSalesManager?: string;
    nationalSalesManager?: string;
    localFinanceController?: string;
    directorCommercialManager?: string;
    commentsForApproval?: string;
    freeDescription?: string;
    /* Return-only fields; undefined on the four sample form types. */
    returnType?: string;
    isService?: boolean;
    originalOrderNumber?: string;
    invoiceDate?: string;
    /** 定期予約 / Standing order — the request may then carry several invoice dates. */
    isStandingOrder?: boolean;
    quoteRefNo?: string;
    orderReason?: string;
    justification?: string;
    dairitenContactName?: string;
    dairitenContactEmail?: string;
    /** SAP sales order number, entered after full approval. Service returns only. */
    salesOrderNumber?: string;
    totalAmount: number;
    currency: string;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    submittedAt?: string;
    completedAt?: string;
    approvalMaxLevel?: number;
    approvalFinalRole?: string;
    /** Earlier submissions of a reopened return, oldest first. Empty for everything else. */
    approvalHistory?: SubmissionRound[];
    createdAt: string;
    updatedAt: string;
}

/**
 * One earlier submission of a return that was rejected and then reopened.
 *
 * Reopening routes the corrected request afresh, and a form holds one approval row per level, so the
 * rejected round's rows cannot stay where they were. This is them, kept: the history Corlett asked a
 * reopen to preserve, instead of the clean slate a copy starts from.
 */
export interface SubmissionRound {
    /** 1 for the first submission, 2 for the first resubmission's predecessor, and so on. */
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
    /** What the service review corrected during that round. */
    reviewEdits: Array<{ changedAt: string; changedByName: string | null; fieldChanges: unknown }>;
    reopenedAt: string;
    reopenedById: string;
    reopenedByName: string | null;
}

export interface Approval {
    id: string;
    formId: string;
    approverId: string;
    approverName: string;
    approverEmail: string;
    /** Set when a SUPER_APPROVER submits the decision for someone else’s step */
    actualActorUserId?: string | null;
    /** Resolved name of `actualActorUserId` for display (optional) */
    actualActorName?: string | null;
    level: number;
    role: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
    decision?: string;
    comments?: string;
    approvalToken?: string | null; // Token for email-based approval (no login required)
    tokenExpiresAt?: string; // Token expiration date
    notifiedAt?: string;
    decidedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Product {
    id: string;
    code: string;
    name: string;
    sapCode?: string;
    category?: string;
    isConsumable: boolean;
    unitPrice?: number;
    wholesalePrice?: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ChannelPartner {
    id: string;
    code: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EndUser {
    id: string;
    code: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Database {
    users: User[];
    salesForms: SalesForm[];
    formProducts: FormProduct[];
    approvals: Approval[];
    products: Product[];
    channelPartners: ChannelPartner[];
    endUsers: EndUser[];
}

/**
 * @deprecated This class is no longer used.
 * All data operations now use Prisma Client via prisma.service.ts
 * Kept for backward compatibility only.
 */
class DatabaseService {
    private db: Database;

    constructor() {
        // Warning suppressed - DatabaseService is kept for backward compatibility
        // Only used in legacy scripts and catalog.controller.ts
        this.db = this.loadDatabase();
    }

    private loadDatabase(): Database {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf-8');
            return JSON.parse(data);
        }

        return {
            users: [],
            salesForms: [],
            formProducts: [],
            approvals: [],
            products: [],
            channelPartners: [],
            endUsers: []
        };
    }

    private saveDatabase(): void {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.db, null, 2), 'utf-8');
    }

    findMany<T>(collection: keyof Database, filter?: Partial<T>): T[] {
        const items = this.db[collection] as unknown as T[];
        if (!filter) return items;

        return items.filter(item => {
            return Object.entries(filter).every(([key, value]) => {
                return (item as any)[key] === value;
            });
        });
    }

    findOne<T>(collection: keyof Database, filter: Partial<T>): T | null {
        const items = this.findMany<T>(collection, filter);
        return items[0] || null;
    }

    findById<T extends { id: string }>(collection: keyof Database, id: string): T | null {
        return this.findOne<T>(collection, { id } as Partial<T>);
    }

    create<T extends { id: string; createdAt: string; updatedAt: string }>(
        collection: keyof Database,
        data: any
    ): T {
        const now = new Date().toISOString();
        const item = {
            ...data,
            id: this.generateId(),
            createdAt: now,
            updatedAt: now
        } as T;

        (this.db[collection] as unknown as T[]).push(item);
        this.saveDatabase();
        return item;
    }

    update<T extends { id: string; updatedAt: string }>(
        collection: keyof Database,
        id: string,
        data: Partial<T>
    ): T | null {
        const items = this.db[collection] as unknown as T[];
        const index = items.findIndex(item => item.id === id);

        if (index === -1) return null;

        items[index] = {
            ...items[index],
            ...data,
            updatedAt: new Date().toISOString()
        };

        this.saveDatabase();
        return items[index];
    }

    delete(collection: keyof Database, id: string): boolean {
        const items = this.db[collection] as any[];
        const index = items.findIndex(item => item.id === id);

        if (index === -1) return false;

        items.splice(index, 1);
        this.saveDatabase();
        return true;
    }

    deleteMany(collection: keyof Database, filter: any): number {
        const items = this.db[collection] as any[];
        const initialLength = items.length;

        this.db[collection] = items.filter(item => {
            return !Object.entries(filter).every(([key, value]) => {
                return item[key] === value;
            });
        }) as any;

        const deletedCount = initialLength - (this.db[collection] as any[]).length;
        if (deletedCount > 0) {
            this.saveDatabase();
        }
        return deletedCount;
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    getAll(): Database {
        return this.db;
    }
}

export const db = new DatabaseService();
