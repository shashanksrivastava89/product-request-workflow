/**
 * Product master sync - the run engine.
 *
 * A run is the unit of work: one snapshot of the master (today the Power BI export, uploaded by
 * hand) is previewed against the catalogue and, once someone has looked at the preview, applied.
 * The two steps are separate records of state because sign-off can take days while the staged
 * upload lives for an hour, so the preview persists everything the apply needs - every normalised
 * row and the decision taken on it - in product_sync_run_rows.
 *
 * The apply is one transaction under an advisory lock. It re-reads the catalogue, re-plans, and
 * refuses to proceed if the plan no longer matches what was previewed (an admin edited a product in
 * between, or another run landed). Writes are batched raw SQL - 25,000 updates as individual Prisma
 * calls would not fit the transaction window - and every changed product gets a product_history row
 * signed by the system user, with a baseline row first if the product had no history yet. That is
 * what "keep the full price history" means in practice: the catalogue row is the current price and
 * every earlier price is a versioned history row.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

import { parseImportFile } from '../import/parser';
import type { ImportFileKind } from '../../utils/import-file-validation.util';
import {
  NOT_POWER_BI_MESSAGE,
  POWER_BI_CODE_COLUMNS,
  POWER_BI_LAYOUT,
  validateProductRows,
  type ValidatedProductRow,
  type ValidationError,
} from '../import/validate-products';
import { selectableProductWhere } from '../product-catalog/selectable';
import {
  planFingerprint,
  planSync,
  snapshotFingerprint,
  snapshotFromValidatedRows,
  type CatalogueRow,
  type HeldKey,
  type InvalidKey,
  type PlannedRow,
  type RowAction,
  type SkippedKey,
  type SnapshotRow,
  type SyncCounts,
} from './diff';
import { deflateZip } from '../../utils/zip-deflate';
import { evaluateGuards, guardsBlockApply, type GuardResult } from './guards';
import { storedRowsFrom, toRunRow, type StoredRows } from './run-rows';

const prisma = new PrismaClient();

/** One key for every writer that must not overlap another: the sync's apply. */
export const PRODUCT_SYNC_LOCK_KEY = 72400017;

/** Every run is a full snapshot now; the column stays so older runs keep their meaning. */
const FULL_SNAPSHOT = 'full-snapshot';

/** The account that signs sync-written history rows; created by migration 20261004090000. */
export const PRODUCT_SYNC_SYSTEM_USER_EMAIL = 'product-sync@system.local';

export type RunStatus = 'PREVIEWING' | 'PREVIEWED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'SUPERSEDED';

/** How many finished runs keep their rows. Older runs keep their counts and guards only. */
const RUNS_WITH_ROWS_TO_KEEP = 5;

/** A run that never applied keeps its uploaded file this long; an applied version keeps it for good. */
const UNAPPLIED_FILE_DAYS = 30;

/** Rows per INSERT/UPDATE statement; each unnest array is one bind parameter, so this is about memory, not limits. */
const WRITE_BATCH = 2000;

const APPLY_TIMEOUT_MS = 180_000;

export class ProductSyncError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ProductSyncError';
    this.status = status;
  }
}

export interface RunActor {
  userId?: string;
  userName?: string;
}

export interface CreateRunInput extends RunActor {
  source: 'upload' | 'cli' | 'restore';
  trigger: 'manual' | 'cli' | 'restore';
  fileName?: string;
  /** A restore: the run whose stored file this run re-applies. */
  restoredFromRunId?: string;
  /** Why the run was made, when someone said (a restore's reason). */
  note?: string;
}

export interface PreviewSource {
  filePath: string;
  kind: ImportFileKind;
  sheetNames?: string[];
}

let systemUserIdCache: string | null = null;

export async function getSystemUserId(): Promise<string> {
  if (systemUserIdCache) return systemUserIdCache;
  const user = await prisma.user.findUnique({
    where: { email: PRODUCT_SYNC_SYSTEM_USER_EMAIL },
    select: { id: true },
  });
  if (!user) {
    throw new ProductSyncError(
      `System user ${PRODUCT_SYNC_SYSTEM_USER_EMAIL} is missing; run the database migrations.`,
      500
    );
  }
  systemUserIdCache = user.id;
  return user.id;
}

// ---------------------------------------------------------------------------------------------
// Run records
// ---------------------------------------------------------------------------------------------

export async function createRun(input: CreateRunInput) {
  // A new preview makes any earlier, unapplied one stale: it was computed against a catalogue and a
  // file that are both about to be different.
  await prisma.productSyncRun.updateMany({
    where: { status: 'PREVIEWED' },
    data: { status: 'SUPERSEDED', finishedAt: new Date() },
  });
  return prisma.productSyncRun.create({
    data: {
      source: input.source,
      trigger: input.trigger,
      mode: FULL_SNAPSHOT,
      status: 'PREVIEWING',
      fileName: input.fileName ?? null,
      restoredFromRunId: input.restoredFromRunId ?? null,
      note: input.note ?? null,
      triggeredBy: input.userId ?? null,
      triggeredByName: input.userName ?? null,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// The file a run was made from
// ---------------------------------------------------------------------------------------------

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function contentTypeFor(kind: ImportFileKind): string {
  return kind === 'csv' ? 'text/csv' : XLSX_MIME;
}

function kindFor(contentType: string): ImportFileKind {
  return contentType === 'text/csv' ? 'csv' : 'xlsx';
}

/**
 * Keep the uploaded file with its run, byte for byte, before the staged copy is discarded. It is
 * what a version is downloaded and restored from.
 */
export async function storeRunFile(runId: string, filePath: string, kind: ImportFileKind, fileName?: string): Promise<void> {
  const content = fs.readFileSync(filePath);
  await storeRunFileBytes(runId, content, contentTypeFor(kind), fileName);
}

async function storeRunFileBytes(runId: string, content: Buffer, contentType: string, fileName?: string | null): Promise<void> {
  await prisma.productSyncFile.create({
    data: {
      runId,
      fileName: fileName ?? null,
      contentType,
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      // Prisma 6 types Bytes as a Uint8Array over a plain ArrayBuffer; a Buffer may be a view on a pool.
      content: Uint8Array.from(content),
    },
  });
}

export async function getRunFile(runId: string) {
  const file = await prisma.productSyncFile.findUnique({ where: { runId } });
  if (!file) throw new ProductSyncError('The file of this run was not kept (runs applied before versions were stored).', 404);
  return file;
}

export async function getRun(runId: string) {
  const run = await prisma.productSyncRun.findUnique({ where: { id: runId } });
  if (!run) throw new ProductSyncError('Sync run not found', 404);
  return run;
}

export async function listRuns(limit = 30) {
  return prisma.productSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Called once at boot. A run that was mid-flight when the container was replaced (deploys use
 * `docker rm -f`) can never finish; leaving it "APPLYING" would hide the fact that nothing was written.
 */
export async function markStaleRunsFailed(): Promise<number> {
  const res = await prisma.productSyncRun.updateMany({
    where: { status: { in: ['PREVIEWING', 'APPLYING'] } },
    data: {
      status: 'FAILED',
      error: 'The backend restarted while this run was in progress. Nothing from it was written; start it again.',
      finishedAt: new Date(),
    },
  });
  return res.count;
}

export async function failRun(runId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.productSyncRun.update({
    where: { id: runId },
    data: { status: 'FAILED', error: message, finishedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------------------------
// Catalogue + snapshot loading
// ---------------------------------------------------------------------------------------------

type Db = Prisma.TransactionClient | PrismaClient;

async function loadCatalogue(db: Db): Promise<CatalogueRow[]> {
  const rows = await db.productCatalog.findMany({
    select: {
      id: true,
      businessGroup: true,
      code: true,
      sapCode: true,
      name: true,
      productNameLocal: true,
      price: true,
      listPrice: true,
      priceGroup: true,
      serviceFlag: true,
      dchain: true,
      isActive: true,
      status: true,
      sourceSystem: true,
      retiredBySync: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    price: Number(r.price),
    listPrice: Number(r.listPrice),
  }));
}

interface NormalisedFile {
  snapshot: SnapshotRow[];
  skipped: SkippedKey[];
  held: HeldKey[];
  invalid: InvalidKey[];
  errors: ValidationError[];
  read: number;
  invalidRows: number;
  appliedFilter?: string;
}

function normaliseValidated(
  rows: ValidatedProductRow[],
  v: ReturnType<typeof validateProductRows>,
  read: number
): NormalisedFile {
  const held: HeldKey[] = v.duplicates.map((d) => ({
    businessGroup: d.businessGroup,
    code: d.code,
    reason: `Rows ${d.rows.join(', ')} all resolve to this code (${[...new Set(d.names)].join(' / ')})`,
    rowIndex: d.rows[0],
  }));
  const heldKeys = new Set(held.map((h) => `${h.businessGroup}|${h.code}`));
  return {
    snapshot: snapshotFromValidatedRows(rows).filter((r) => !heldKeys.has(`${r.businessGroup}|${r.code}`)),
    skipped: v.skipped.map((s) => ({
      businessGroup: rows.find((r) => r.code === s.code)?.businessGroup ?? '',
      code: s.code,
      reason: s.reason,
      rowIndex: s.row,
    })),
    held,
    invalid: v.invalid.map((i) => ({ businessGroup: i.businessGroup, code: i.code, sapCode: i.sapCode, reason: i.reason, rowIndex: i.row })),
    errors: v.errors,
    read,
    invalidRows: new Set(v.errors.map((e) => e.row)).size,
    ...(v.appliedFilter !== undefined ? { appliedFilter: v.appliedFilter } : {}),
  };
}

/**
 * The normaliser reports a skipped row by code only; its business group has to come from the row
 * itself. Re-derive it here from the raw rows so a CDG and an LSG code that happen to be equal are
 * not confused.
 */
function skippedWithBusinessGroup(
  rawRows: ReturnType<typeof parseImportFile>['rows'],
  v: ReturnType<typeof validateProductRows>
): SkippedKey[] {
  return v.skipped.map((s) => {
    const raw = rawRows[s.row - 2];
    const bgRaw = raw
      ? String(raw['BU'] ?? raw['Business Group'] ?? raw['Business Unit'] ?? '').trim().toUpperCase()
      : '';
    return {
      businessGroup: bgRaw,
      code: s.code,
      reason: s.reason,
      rowIndex: s.row,
    };
  });
}

function normaliseFile(source: PreviewSource): NormalisedFile {
  const { rows } = parseImportFile(source.filePath, source.kind, {
    sheetNames: source.sheetNames,
    textColumns: POWER_BI_CODE_COLUMNS,
  });
  const v = validateProductRows(rows);
  if (!v.powerBi) throw new ProductSyncError(NOT_POWER_BI_MESSAGE, 400);
  const read = rows.length - (v.appliedFilter !== undefined ? 1 : 0);
  const out = normaliseValidated(v.validRows, v, read);
  out.skipped = skippedWithBusinessGroup(rows, v);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

async function previousAppliedKept(beforeRunId: string): Promise<number | undefined> {
  const last = await prisma.productSyncRun.findFirst({
    where: { status: 'APPLIED', mode: FULL_SNAPSHOT, id: { not: beforeRunId } },
    orderBy: { finishedAt: 'desc' },
    select: { counts: true },
  });
  const kept = (last?.counts as { kept?: number } | null)?.kept;
  return typeof kept === 'number' ? kept : undefined;
}

async function persistPlan(runId: string, rows: PlannedRow[]): Promise<void> {
  await prisma.productSyncRunRow.deleteMany({ where: { runId } });
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    await prisma.productSyncRunRow.createMany({
      data: rows.slice(i, i + WRITE_BATCH).map((r) => toRunRow(runId, r)),
    });
  }
}

/** Rows of old finished runs are the bulk of the table; their counts and guards stay forever. */
async function pruneOldRunRows(): Promise<void> {
  const keep = await prisma.productSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: RUNS_WITH_ROWS_TO_KEEP,
    select: { id: true },
  });
  await prisma.productSyncRunRow.deleteMany({
    where: {
      runId: { notIn: keep.map((k) => k.id) },
      run: { status: { in: ['APPLIED', 'FAILED', 'SUPERSEDED'] } },
    },
  });
  // A version keeps its file for good (it is what a restore re-applies); a run that never applied
  // keeps it a month, for anyone asking what was uploaded.
  await prisma.productSyncFile.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - UNAPPLIED_FILE_DAYS * 24 * 60 * 60 * 1000) },
      run: { status: { in: ['FAILED', 'SUPERSEDED'] } },
    },
  });
}

export interface PreviewOutcome {
  runId: string;
  counts: SyncCounts;
  guards: GuardResult[];
  blocked: boolean;
}

/**
 * Parse, normalise, plan and persist. Runs outside any HTTP request: the controller returns the run
 * id at once and the page polls, because 44,000 rows take seconds and the edge in front of UAT cuts
 * a request off well before an apply would finish.
 */
export async function previewRun(runId: string, source: PreviewSource): Promise<PreviewOutcome> {
  const t0 = Date.now();
  const lap = (label: string, since: number) => `${label} ${((Date.now() - since) / 1000).toFixed(1)}s`;
  try {
    let t = Date.now();
    const file = normaliseFile(source);
    const tParse = lap('parse', t);
    t = Date.now();
    const catalogue = await loadCatalogue(prisma);
    const tLoad = lap('catalogue', t);
    t = Date.now();
    const plan = planSync({
      snapshot: file.snapshot,
      skipped: file.skipped,
      held: file.held,
      invalid: file.invalid,
      catalogue,
      read: file.read,
      invalidRows: file.invalidRows,
    });
    const guards = evaluateGuards({
      counts: plan.counts,
      appliedFilter: file.appliedFilter,
      previousKept: await previousAppliedKept(runId),
    });

    const tPlan = lap('plan', t);
    t = Date.now();
    await persistPlan(runId, plan.rows);
    const tPersist = lap('persist', t);

    const samples = {
      errors: file.errors.slice(0, 50),
      totalErrorCount: file.errors.length,
    };

    await prisma.productSyncRun.update({
      where: { id: runId },
      data: {
        status: 'PREVIEWED',
        appliedFilter: file.appliedFilter ?? null,
        fingerprint: snapshotFingerprint(file.snapshot, file.skipped, file.held),
        diffFingerprint: planFingerprint(plan.rows),
        counts: plan.counts as unknown as Prisma.InputJsonValue,
        guards: guards as unknown as Prisma.InputJsonValue,
        samples: samples as unknown as Prisma.InputJsonValue,
        previewedAt: new Date(),
        error: null,
      },
    });

    t = Date.now();
    await pruneOldRunRows();
    console.log(`[product-sync] preview ${runId.slice(0, 8)}: ${tParse}, ${tLoad}, ${tPlan}, ${tPersist}, ${lap('prune', t)}, total ${lap('', t0).trim()}`);

    return { runId, counts: plan.counts, guards, blocked: guardsBlockApply(guards) };
  } catch (err) {
    await failRun(runId, err);
    throw err;
  }
}

/** Fire-and-forget wrapper for the controller; the run record carries the outcome either way. */
export function startPreviewInBackground(runId: string, source: PreviewSource, onDone?: () => void): void {
  void previewRun(runId, source)
    .catch((err) => {
      console.error(`[product-sync] preview ${runId} failed:`, err instanceof Error ? err.message : err);
    })
    .finally(() => onDone?.());
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

/** What the preview planned from, read back for the apply (see run-rows.ts). */
async function loadStoredRows(runId: string): Promise<StoredRows> {
  return storedRowsFrom(await prisma.productSyncRunRow.findMany({ where: { runId } }));
}

const nullable = (v: string | null | undefined) => v ?? '';

interface WriteStats {
  created: number;
  updated: number;
  reactivated: number;
  retired: number;
  keptInactiveUpdated: number;
  historyRows: number;
  baselineRows: number;
}

async function insertCreates(tx: Prisma.TransactionClient, rows: PlannedRow[], systemUserId: string): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    const ids = batch.map(() => randomUUID());
    batch.forEach((r, j) => idByKey.set(`${r.businessGroup}|${r.code}`, ids[j]));
    const n = (r: PlannedRow) => r.next!;
    await tx.$executeRaw`
      INSERT INTO "product_catalog" (
        "id", "businessGroup", "code", "sapCode", "name", "productNameLocal", "price", "listPrice",
        "division", "statisticsGroup", "priceGroup", "serviceFlag", "dchain",
        "isActive", "status", "approvedAt", "sourceSystem", "retiredBySync",
        "createdAt", "updatedAt", "updatedBy"
      )
      SELECT v.id, v.bg, v.code, v.sap, v.name, v.local, v.price::numeric, v.list::numeric,
             NULL, NULL, NULLIF(v.pg, ''), NULLIF(v.sf, ''), NULLIF(v.dc, ''),
             true, 'APPROVED'::"MasterDataStatus", now(), 'import', false,
             now(), now(), ${systemUserId}
      FROM unnest(
        ${ids}::text[], ${batch.map((r) => r.businessGroup)}::text[], ${batch.map((r) => n(r).code)}::text[],
        ${batch.map((r) => n(r).sapCode)}::text[], ${batch.map((r) => n(r).name)}::text[],
        ${batch.map((r) => n(r).productNameLocal)}::text[],
        ${batch.map((r) => n(r).price.toFixed(2))}::text[], ${batch.map((r) => n(r).listPrice.toFixed(2))}::text[],
        ${batch.map((r) => nullable(n(r).priceGroup))}::text[], ${batch.map((r) => nullable(n(r).serviceFlag))}::text[],
        ${batch.map((r) => nullable(n(r).dchain))}::text[]
      ) AS v(id, bg, code, sap, name, local, price, list, pg, sf, dc)
    `;
  }
  return idByKey;
}

/** Move rows whose code is changing onto a code nothing else can hold, so swaps and hand-overs never collide. */
async function parkRenamedRows(tx: Prisma.TransactionClient, rows: PlannedRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const ids = rows.slice(i, i + WRITE_BATCH).map((r) => r.product!.id);
    await tx.$executeRaw`
      UPDATE "product_catalog" SET "code" = '#sync#' || "id" WHERE "id" = ANY(${ids}::text[])
    `;
  }
}

async function updateExisting(tx: Prisma.TransactionClient, rows: PlannedRow[], systemUserId: string): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    const n = (r: PlannedRow) => r.next!;
    await tx.$executeRaw`
      UPDATE "product_catalog" p SET
        "code" = v.code,
        "sapCode" = v.sap,
        "name" = v.name,
        "productNameLocal" = v.local,
        "price" = v.price::numeric,
        "listPrice" = v.list::numeric,
        "priceGroup" = NULLIF(v.pg, ''),
        "serviceFlag" = NULLIF(v.sf, ''),
        "dchain" = NULLIF(v.dc, ''),
        "isActive" = v.active::boolean,
        "retiredBySync" = v.rbs::boolean,
        "status" = v.status::"MasterDataStatus",
        "sourceSystem" = COALESCE(p."sourceSystem", 'import'),
        "updatedBy" = ${systemUserId},
        "updatedAt" = now()
      FROM unnest(
        ${batch.map((r) => r.product!.id)}::text[], ${batch.map((r) => n(r).code)}::text[],
        ${batch.map((r) => n(r).sapCode)}::text[], ${batch.map((r) => n(r).name)}::text[],
        ${batch.map((r) => n(r).productNameLocal)}::text[],
        ${batch.map((r) => n(r).price.toFixed(2))}::text[], ${batch.map((r) => n(r).listPrice.toFixed(2))}::text[],
        ${batch.map((r) => nullable(n(r).priceGroup))}::text[], ${batch.map((r) => nullable(n(r).serviceFlag))}::text[],
        ${batch.map((r) => nullable(n(r).dchain))}::text[],
        ${batch.map((r) => String(n(r).isActive))}::text[], ${batch.map((r) => String(n(r).retiredBySync))}::text[],
        ${batch.map((r) => n(r).status)}::text[]
      ) AS v(id, code, sap, name, local, price, list, pg, sf, dc, active, rbs, status)
      WHERE p."id" = v.id
    `;
  }
}

interface HistoryLine {
  productId: string;
  version: number;
  businessGroup: string;
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price: number;
  listPrice: number;
  priceGroup: string | null;
  isActive: boolean;
  changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
  changeReason: string;
  fieldChanges: string | null;
}

const CHANGE_TYPE: Partial<Record<RowAction, HistoryLine['changeType']>> = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  KEEP_INACTIVE: 'UPDATE',
  REACTIVATE: 'RESTORE',
  RETIRE: 'DELETE',
};

async function insertHistory(tx: Prisma.TransactionClient, lines: HistoryLine[], systemUserId: string, runId: string): Promise<void> {
  for (let i = 0; i < lines.length; i += WRITE_BATCH) {
    const b = lines.slice(i, i + WRITE_BATCH);
    await tx.$executeRaw`
      INSERT INTO "product_history" (
        "id", "productId", "version", "businessGroup", "code", "sapCode", "name", "productNameLocal",
        "price", "listPrice", "division", "statisticsGroup", "priceGroup", "isActive",
        "changedBy", "changedAt", "changeType", "changeReason", "fieldChanges", "syncRunId"
      )
      SELECT gen_random_uuid()::text, v.pid, v.version::int, v.bg, v.code, v.sap, v.name, v.local,
             v.price::numeric, v.list::numeric, NULL, NULL, NULLIF(v.pg, ''), v.active::boolean,
             ${systemUserId}, now(), v.ctype::"ChangeType", v.reason, NULLIF(v.fc, '')::jsonb, ${runId}
      FROM unnest(
        ${b.map((l) => l.productId)}::text[], ${b.map((l) => String(l.version))}::text[],
        ${b.map((l) => l.businessGroup)}::text[], ${b.map((l) => l.code)}::text[], ${b.map((l) => l.sapCode)}::text[],
        ${b.map((l) => l.name)}::text[], ${b.map((l) => l.productNameLocal)}::text[],
        ${b.map((l) => l.price.toFixed(2))}::text[], ${b.map((l) => l.listPrice.toFixed(2))}::text[],
        ${b.map((l) => nullable(l.priceGroup))}::text[], ${b.map((l) => String(l.isActive))}::text[],
        ${b.map((l) => l.changeType)}::text[], ${b.map((l) => l.changeReason)}::text[],
        ${b.map((l) => l.fieldChanges ?? '')}::text[]
      ) AS v(pid, version, bg, code, sap, name, local, price, list, pg, active, ctype, reason, fc)
    `;
  }
}

async function linkCreatedRows(tx: Prisma.TransactionClient, rowIdByKey: Map<string, string>, idByKey: Map<string, string>): Promise<void> {
  const pairs: Array<[string, string]> = [];
  for (const [k, productId] of idByKey) {
    const rowId = rowIdByKey.get(k);
    if (rowId) pairs.push([rowId, productId]);
  }
  for (let i = 0; i < pairs.length; i += WRITE_BATCH) {
    const b = pairs.slice(i, i + WRITE_BATCH);
    await tx.$executeRaw`
      UPDATE "product_sync_run_rows" r SET "productId" = v.pid
      FROM unnest(${b.map((p) => p[0])}::text[], ${b.map((p) => p[1])}::text[]) AS v(id, pid)
      WHERE r."id" = v.id
    `;
  }
}

async function writePlan(
  tx: Prisma.TransactionClient,
  rows: PlannedRow[],
  stored: StoredRows,
  runId: string,
  reasonLabel: string,
  systemUserId: string
): Promise<WriteStats> {
  const creates = rows.filter((r) => r.action === 'CREATE');
  const updates = rows.filter((r) => r.next && r.action !== 'CREATE');

  // Order matters because (businessGroup, code) is unique and codes move: when a CDG product gains
  // its GS1, its row is renamed away from the SAP material number, and the master may now carry a
  // different product under that very code. So renamed rows are parked on a temporary code first,
  // every update lands, and only then are new rows inserted into the codes that were vacated.
  const renames = updates.filter((r) => r.product!.code !== r.next!.code);
  if (renames.length > 0) await parkRenamedRows(tx, renames);
  await updateExisting(tx, updates, systemUserId);
  const idByKey = await insertCreates(tx, creates, systemUserId);
  await linkCreatedRows(tx, stored.rowIdByKey, idByKey);

  // History. One row per product written, after a baseline row for any existing product that has
  // none yet - so the price before the very first sync change is a real snapshot, not just a
  // value buried in a fieldChanges array.
  const existingIds = updates.map((r) => r.product!.id);
  const maxVersion = new Map<string, number>();
  for (let i = 0; i < existingIds.length; i += WRITE_BATCH) {
    const ids = existingIds.slice(i, i + WRITE_BATCH);
    const found = await tx.$queryRaw<Array<{ pid: string; v: number }>>`
      SELECT "productId" AS pid, MAX("version")::int AS v FROM "product_history"
      WHERE "productId" = ANY(${ids}::text[]) GROUP BY "productId"
    `;
    for (const f of found) maxVersion.set(f.pid, Number(f.v));
  }

  const lines: HistoryLine[] = [];
  let baselineRows = 0;
  for (const r of creates) {
    const n = r.next!;
    lines.push({
      productId: idByKey.get(`${r.businessGroup}|${r.code}`)!,
      version: 1,
      businessGroup: r.businessGroup,
      code: n.code,
      sapCode: n.sapCode,
      name: n.name,
      productNameLocal: n.productNameLocal,
      price: n.price,
      listPrice: n.listPrice,
      priceGroup: n.priceGroup,
      isActive: n.isActive,
      changeType: 'CREATE',
      changeReason: reasonLabel,
      fieldChanges: null,
    });
  }
  for (const r of updates) {
    const p = r.product!;
    const n = r.next!;
    let version = maxVersion.get(p.id) ?? 0;
    if (version === 0) {
      version = 1;
      baselineRows += 1;
      lines.push({
        productId: p.id,
        version,
        businessGroup: p.businessGroup,
        code: p.code,
        sapCode: p.sapCode,
        name: p.name,
        productNameLocal: p.productNameLocal,
        price: p.price,
        listPrice: p.listPrice,
        priceGroup: p.priceGroup,
        isActive: p.isActive,
        changeType: 'UPDATE',
        changeReason: 'Baseline: the product as it stood before its first product sync change',
        fieldChanges: null,
      });
    }
    lines.push({
      productId: p.id,
      version: version + 1,
      businessGroup: p.businessGroup,
      code: n.code,
      sapCode: n.sapCode,
      name: n.name,
      productNameLocal: n.productNameLocal,
      price: n.price,
      listPrice: n.listPrice,
      priceGroup: n.priceGroup,
      isActive: n.isActive,
      changeType: CHANGE_TYPE[r.action] ?? 'UPDATE',
      changeReason: r.reason ? `${reasonLabel} - ${r.reason}` : reasonLabel,
      fieldChanges: r.fieldChanges && r.fieldChanges.length > 0 ? JSON.stringify(r.fieldChanges) : null,
    });
  }
  await insertHistory(tx, lines, systemUserId, runId);

  return {
    created: creates.length,
    updated: updates.filter((r) => r.action === 'UPDATE').length,
    reactivated: updates.filter((r) => r.action === 'REACTIVATE').length,
    retired: updates.filter((r) => r.action === 'RETIRE').length,
    keptInactiveUpdated: updates.filter((r) => r.action === 'KEEP_INACTIVE').length,
    historyRows: lines.length,
    baselineRows,
  };
}

export interface ApplyOptions extends RunActor {
  /** Apply even though a guard failed. Recorded on the run; the UI requires a reason. */
  overrideReason?: string;
}

export interface ApplyOutcome {
  runId: string;
  version: number;
  counts: SyncCounts;
  written: WriteStats;
}

export async function applyRun(runId: string, opts: ApplyOptions = {}): Promise<ApplyOutcome> {
  const run = await getRun(runId);
  if (run.status !== 'PREVIEWED') {
    throw new ProductSyncError(
      run.status === 'SUPERSEDED'
        ? 'This preview was superseded by a newer one; preview the file again.'
        : `Run is ${run.status}; only a previewed run can be applied.`,
      409
    );
  }
  const override = opts.overrideReason?.trim() || undefined;
  if (guardsBlockApply((run.guards as unknown as GuardResult[]) ?? []) && !override) {
    throw new ProductSyncError('A guard failed at preview. Give a reason to apply anyway.', 409);
  }

  await prisma.productSyncRun.update({
    where: { id: runId },
    data: {
      status: 'APPLYING',
      applyStartedAt: new Date(),
      guardOverrideReason: override ?? null,
      ...(opts.userId ? { triggeredBy: opts.userId } : {}),
      ...(opts.userName ? { triggeredByName: opts.userName } : {}),
    },
  });

  try {
    const systemUserId = await getSystemUserId();
    const stored = await loadStoredRows(runId);
    const previousKept = await previousAppliedKept(runId);
    const previewCounts = run.counts as unknown as SyncCounts;
    const restoredFrom = run.restoredFromRunId
      ? await prisma.productSyncRun.findUnique({ where: { id: run.restoredFromRunId }, select: { version: true } })
      : null;

    const outcome = await prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_try_advisory_xact_lock(${PRODUCT_SYNC_LOCK_KEY}::bigint) AS ok`;
        if (!lock[0]?.ok) {
          throw new ProductSyncError('Another product sync is writing right now; try again in a minute.', 409);
        }

        // Plan again against the catalogue as it is now, inside the lock. The preview is only a
        // promise; this is what gets written.
        const catalogue = await loadCatalogue(tx);
        const plan = planSync({
          snapshot: stored.snapshot,
          skipped: stored.skipped,
          held: stored.held,
          invalid: stored.invalid,
          catalogue,
          read: previewCounts?.read ?? stored.snapshot.length,
          invalidRows: previewCounts?.invalid ?? 0,
        });
        if (planFingerprint(plan.rows) !== run.diffFingerprint) {
          throw new ProductSyncError(
            'The catalogue changed after this preview was made, so the preview no longer describes what would be written. Preview the file again.',
            409
          );
        }
        const guards = evaluateGuards({ counts: plan.counts, appliedFilter: run.appliedFilter ?? undefined, previousKept });
        if (guardsBlockApply(guards) && !override) {
          throw new ProductSyncError('A guard failed. Give a reason to apply anyway.', 409);
        }

        // The version number is taken under the lock, so two applies can never share one.
        const [{ v: version }] = await tx.$queryRaw<Array<{ v: number }>>`
          SELECT (COALESCE(MAX("version"), 0) + 1)::int AS v FROM "product_sync_runs"
        `;
        const reasonLabel =
          `Product master v${version}` +
          (restoredFrom?.version ? ` (restore of v${restoredFrom.version})` : '') +
          (run.fileName ? ` - ${run.fileName}` : '');

        const written = await writePlan(tx, plan.rows, stored, runId, reasonLabel, systemUserId);
        // Marked applied in the same transaction as the writes: committed means applied, and a
        // restart can never leave written products under a run that says otherwise.
        await tx.productSyncRun.update({
          where: { id: runId },
          data: {
            status: 'APPLIED',
            version,
            counts: { ...plan.counts, written } as unknown as Prisma.InputJsonValue,
            guards: guards as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
            error: null,
          },
        });
        return { counts: plan.counts, guards, written, version };
      },
      { timeout: APPLY_TIMEOUT_MS, maxWait: 10_000 }
    );

    console.log(`[product-sync] apply ${runId.slice(0, 8)} = v${outcome.version}: ${JSON.stringify(outcome.written)}`);
    return { runId, version: outcome.version, counts: outcome.counts, written: outcome.written };
  } catch (err) {
    // A refusal (drift, lock, guard) leaves the preview usable; anything else is a failure.
    if (err instanceof ProductSyncError && err.status === 409) {
      await prisma.productSyncRun.update({
        where: { id: runId },
        data: { status: 'PREVIEWED', error: err.message, applyStartedAt: null },
      });
    } else {
      await failRun(runId, err);
    }
    throw err;
  }
}

export function startApplyInBackground(runId: string, opts: ApplyOptions = {}): void {
  void applyRun(runId, opts).catch((err) => {
    console.error(`[product-sync] apply ${runId} failed:`, err instanceof Error ? err.message : err);
  });
}

// ---------------------------------------------------------------------------------------------
// Reading a run back
// ---------------------------------------------------------------------------------------------

export const ROW_ACTIONS: RowAction[] = ['CREATE', 'UPDATE', 'REACTIVATE', 'RETIRE', 'KEEP_INACTIVE', 'HELD', 'SKIPPED', 'INVALID', 'UNCHANGED'];

export function isRowAction(s: string): s is RowAction {
  return (ROW_ACTIONS as string[]).includes(s);
}

export async function getRunRows(runId: string, action: RowAction, offset: number, limit: number) {
  const where = { runId, action };
  const [rows, total] = await Promise.all([
    prisma.productSyncRunRow.findMany({
      where,
      orderBy: [{ businessGroup: 'asc' }, { code: 'asc' }],
      skip: offset,
      take: limit,
    }),
    prisma.productSyncRunRow.count({ where }),
  ]);
  return { rows: rows.map(serialiseRow), total };
}

function serialiseRow(r: Prisma.ProductSyncRunRowGetPayload<Record<string, never>>) {
  return {
    id: r.id,
    action: r.action,
    holdKind: r.holdKind,
    productId: r.productId,
    businessGroup: r.businessGroup,
    code: r.code,
    sapCode: r.sapCode,
    name: r.name,
    productNameLocal: r.productNameLocal,
    price: r.price === null ? null : Number(r.price),
    listPrice: r.listPrice === null ? null : Number(r.listPrice),
    priceGroup: r.priceGroup,
    serviceFlag: r.serviceFlag,
    dchain: r.dchain,
    rowIndex: r.rowIndex,
    reason: r.reason,
    fieldChanges: r.fieldChanges,
  };
}

// ---------------------------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------------------------

/**
 * A one-sheet workbook. The given columns are written as text cells in Excel's text format (@), so a
 * code keeps its leading zeros when the file is opened and still keeps them after someone edits it.
 * Compressed with zlib (see zip-deflate.ts): stored, the 39k-row master was 16.7 MB; zlib makes it
 * under 2 MB, which also keeps an unedited file quick to upload back through the 8 KB parts.
 */
function workbook(aoa: unknown[][], sheetName: string, textColumns: number[]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws['!ref'] as string);
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (const c of textColumns) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell) continue;
      cell.t = 's';
      cell.v = String(cell.v ?? '');
      cell.z = '@';
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return deflateZip(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: false }) as Buffer);
}

const BUCKET_HEADER = ['Action', 'BU', 'Code', 'SAP Code', 'Name', 'Contract Price', 'List Price', 'Pricing Group', 'Service Flag', 'DCHAIN', 'File Row', 'Reason', 'Changes'];

async function bucketRows(runId: string, action: RowAction): Promise<Array<Array<string | number>>> {
  const rows = await prisma.productSyncRunRow.findMany({
    where: { runId, action },
    orderBy: [{ businessGroup: 'asc' }, { code: 'asc' }],
  });
  return rows.map((r) => {
    const changes = Array.isArray(r.fieldChanges)
      ? (r.fieldChanges as Array<{ field: string; oldValue: unknown; newValue: unknown }>)
          .map((c) => `${c.field}: ${c.oldValue ?? ''} -> ${c.newValue ?? ''}`)
          .join('; ')
      : '';
    return [
      r.action, r.businessGroup, r.code, r.sapCode, r.productNameLocal || r.name,
      r.price === null ? '' : Number(r.price), r.listPrice === null ? '' : Number(r.listPrice),
      r.priceGroup ?? '', r.serviceFlag ?? '', r.dchain ?? '', r.rowIndex ?? '', r.reason ?? '', changes,
    ];
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Whole bucket as CSV, for the command line; UTF-8 with BOM so Excel opens the Japanese names. */
export async function exportRunRowsCsv(runId: string, action: RowAction): Promise<string> {
  const rows = await bucketRows(runId, action);
  const lines = rows.map((r) => r.map(csvCell).join(','));
  return '\uFEFF' + [BUCKET_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}

/** Whole bucket as .xlsx, for the page: Code and SAP Code are text, so Excel shows 01129, not 1129. */
export async function exportRunRowsXlsx(runId: string, action: RowAction): Promise<Buffer> {
  const rows = await bucketRows(runId, action);
  return workbook([BUCKET_HEADER, ...rows], action, [2, 3]);
}

/**
 * Every product a requester can select, in the Power BI export's own columns: exactly what the
 * Sample Ordering picker offers (8 Oct 2026: "1 to 1"), so the file can be compared with a new export
 * or edited and uploaded back - unedited, it uploads as a master with no changes.
 *
 * The layout carries a product code of its own only as a CDG GS1; every other product is keyed on its
 * MaterialNumber, which the master sync makes the code of every LSG product.
 */
export async function buildProductMasterXlsx(): Promise<{ buffer: Buffer; rows: number }> {
  const products = await prisma.productCatalog.findMany({
    where: selectableProductWhere(),
    orderBy: [{ businessGroup: 'asc' }, { code: 'asc' }],
    select: {
      businessGroup: true,
      code: true,
      sapCode: true,
      name: true,
      productNameLocal: true,
      price: true,
      listPrice: true,
      priceGroup: true,
      serviceFlag: true,
      dchain: true,
    },
  });

  const rows = products.map((p) => {
    const sap = p.sapCode.trim() || p.code;
    const gs1 = p.businessGroup === 'CDG' && p.code !== sap ? p.code : '';
    const list = Number(p.listPrice);
    const contract = Number(p.price);
    const rate = list > 0 ? Math.round((contract / list) * 100) / 100 : '';
    return [p.businessGroup, sap, gs1, p.productNameLocal || p.name, list, contract, p.priceGroup ?? '', rate, p.dchain ?? '', p.serviceFlag ?? ''];
  });

  return { buffer: workbook([[...POWER_BI_LAYOUT], ...rows], 'Export', [1, 2]), rows: rows.length };
}

export async function getRunHistory(runId: string, offset: number, limit: number) {
  const where = { syncRunId: runId };
  const [rows, total] = await Promise.all([
    prisma.productHistory.findMany({
      where,
      orderBy: [{ changedAt: 'desc' }, { code: 'asc' }],
      skip: offset,
      take: limit,
      include: { product: { select: { id: true, code: true, businessGroup: true, productNameLocal: true } } },
    }),
    prisma.productHistory.count({ where }),
  ]);
  return {
    total,
    rows: rows.map((h) => ({
      id: h.id,
      productId: h.productId,
      businessGroup: h.businessGroup,
      code: h.code,
      name: h.productNameLocal || h.name,
      version: h.version,
      changeType: h.changeType,
      changeReason: h.changeReason,
      changedAt: h.changedAt,
      fieldChanges: h.fieldChanges,
      price: Number(h.price),
      listPrice: Number(h.listPrice),
      isActive: h.isActive,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Versions: every applied master, the file it was made from, and restoring one
// ---------------------------------------------------------------------------------------------

export async function listVersions(limit = 50) {
  const runs = await prisma.productSyncRun.findMany({
    where: { status: 'APPLIED', version: { not: null } },
    orderBy: { version: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    // The relation, without its bytes: only whether the file was kept, and how big it is.
    include: { file: { select: { fileName: true, sizeBytes: true } } },
  });
  const sourceIds = [...new Set(runs.map((r) => r.restoredFromRunId).filter((id): id is string => !!id))];
  const sources = sourceIds.length
    ? await prisma.productSyncRun.findMany({ where: { id: { in: sourceIds } }, select: { id: true, version: true } })
    : [];
  const versionOf = new Map(sources.map((s) => [s.id, s.version]));
  return runs.map((r) => ({
    runId: r.id,
    version: r.version as number,
    fileName: r.file?.fileName ?? r.fileName,
    appliedAt: r.finishedAt,
    appliedBy: r.triggeredByName,
    counts: r.counts,
    guardOverrideReason: r.guardOverrideReason,
    note: r.note,
    restoredFromVersion: r.restoredFromRunId ? versionOf.get(r.restoredFromRunId) ?? null : null,
    fileKept: !!r.file,
    fileSize: r.file?.sizeBytes ?? null,
  }));
}

/**
 * Restore a version: a new run made from that version's stored file, previewed against the catalogue
 * as it is now and applied the normal way (lock, drift check, guards, an override reason if one
 * trips). Nothing is rewritten. The restore becomes the next version, products the old file carries
 * come back on their own records with their history, products added since are removed, and a product
 * an admin deactivated stays deactivated.
 */
export async function startRestore(versionRunId: string, actor: RunActor & { reason?: string }): Promise<{ runId: string }> {
  const source = await prisma.productSyncRun.findUnique({ where: { id: versionRunId }, include: { file: true } });
  if (!source || source.status !== 'APPLIED' || source.version === null) {
    throw new ProductSyncError('Only an applied version can be restored.', 400);
  }
  if (!source.file) {
    throw new ProductSyncError(`The file of v${source.version} was not kept (it was applied before versions were stored), so it cannot be restored.`, 409);
  }
  const content = Buffer.from(source.file.content);
  const fileName = source.file.fileName ?? source.fileName ?? `product-master-v${source.version}`;
  const run = await createRun({
    source: 'restore',
    trigger: 'restore',
    fileName,
    restoredFromRunId: source.id,
    note: actor.reason?.trim() || undefined,
    userId: actor.userId,
    userName: actor.userName,
  });
  await storeRunFileBytes(run.id, content, source.file.contentType, fileName);

  const kind = kindFor(source.file.contentType);
  const dir = path.join(process.cwd(), 'tmp', 'import');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `restore-${run.id}.${kind}`);
  fs.writeFileSync(filePath, content);
  startPreviewInBackground(run.id, { filePath, kind }, () => fs.rm(filePath, { force: true }, () => undefined));
  return { runId: run.id };
}
