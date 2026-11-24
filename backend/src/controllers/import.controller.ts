/**
 * Admin import: validate (Phase 1) and execute upsert (Phase 2) for bulk Excel/CSV uploads.
 */

import { Response } from 'express';
import { prismaService } from '../services/prisma.service';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth.middleware';
import { parseImportFile, getSheetInfo, type Row } from '../services/import/parser';
import { sanitizeClientFilename, type ImportFileKind } from '../utils/import-file-validation.util';
import {
  ChunkedUploadError,
  appendChunk,
  beginUpload,
  discardUpload,
  finalizeUpload,
  resolveUpload,
  uploadStatus,
} from '../services/import/chunked-upload.service';
import { validateCustomerRows } from '../services/import/validate-customers';
import { validateUserRows } from '../services/import/validate-users';
import { validateZsammHierarchyRows } from '../services/import/validate-zsam-hierarchy';
import { validateZncInstallationHierarchyRows } from '../services/import/validate-znc-installation-hierarchy';
import { validateZncClaimReplacementHierarchyRows } from '../services/import/validate-znc-claim-replacement-hierarchy';
import { validateZintQcHierarchyRows } from '../services/import/validate-zint-qc-hierarchy';
import { validateReturnApprovalMatrixRows } from '../services/import/validate-return-approval-matrix';
import { executeReturnApprovalMatrixImport } from '../services/import/execute-return-approval-matrix';
import {
  executeCustomerImport,
  executeUserImport,
  executeZsammHierarchyImport,
  executeZncInstallationHierarchyImport,
  executeZncClaimReplacementHierarchyImport,
  executeZintQcHierarchyImport,
} from '../services/import/execute-import.service';
import type { ValidatedCustomerRow } from '../services/import/validate-customers';
import type { ValidatedUserRow } from '../services/import/validate-users';
import type { ValidatedZsammHierarchyRow } from '../services/import/validate-zsam-hierarchy';
import type { ValidatedZncInstallationHierarchyRow } from '../services/import/validate-znc-installation-hierarchy';
import type { ValidatedZncClaimReplacementHierarchyRow } from '../services/import/validate-znc-claim-replacement-hierarchy';
import type { ValidatedZintQcHierarchyRow } from '../services/import/validate-zint-qc-hierarchy';
import type { ValidatedReturnApprovalMatrixRow } from '../services/import/validate-return-approval-matrix';

/** Max errors in response to avoid "Invalid string length" / huge JSON (V8 string limit). */
const MAX_ERRORS_IN_RESPONSE = 2000;
/** Max rows to process in one file to avoid memory/string limits. */
const MAX_ROWS_PER_FILE = 500_000;

// Products are not here: since 8 Oct 2026 they come only from the Power BI master, through Admin ->
// Product master sync (product-sync.controller.ts), which compares the whole master and keeps versions.
const ENTITIES = [
  'customers',
  'users',
  'zsam-hierarchy',
  'znc-installation',
  'znc-claim-replacement',
  'zint-qc',
  'return-approval-matrix',
] as const;
type Entity = (typeof ENTITIES)[number];

function isEntity(s: string): s is Entity {
  return ENTITIES.includes(s as Entity);
}

/** Parse optional "sheets" from body or query: comma or pipe separated string, or array. */
export function parseSheetsParam(body: any, query?: any): string[] | undefined {
  const raw = body?.sheets ?? body?.sheetNames ?? query?.sheets ?? query?.sheetNames;
  if (raw == null) return undefined;
  if (Array.isArray(raw)) return raw.map((s: string) => String(s).trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return undefined;
  const split = s.includes('|') ? s.split('|') : s.split(',');
  return split.map((x: string) => x.trim()).filter(Boolean);
}

/**
 * The row count the client believed the table held, for the return matrix interlock.
 *
 * Optional: absent means no check, which is what a first upload or a script wants. Present and
 * wrong is a 409 - the file was exported against a different matrix, and since a row it omits is a
 * deletion, going ahead would undo whatever changed in between.
 */
function parseExpectedCount(body: any, query?: any): number | undefined {
  const raw = body?.expectedCount ?? query?.expectedCount;
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** How many rows the return matrix holds right now. */
async function countReturnApprovalMatrixRows(): Promise<number> {
  return prismaService.countReturnApprovalMappings();
}

/** Import only rows that passed validation; multipart fields are strings */
function parseSkipInvalidRows(body: any, query?: any): boolean {
  const v = body?.skipInvalidRows ?? query?.skipInvalidRows;
  if (v === true || v === 1) return true;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function runEntityValidation(
  rows: Row[],
  entity: Entity
): {
  errors: { row: number; column: string; message: string; value: string }[];
  validRows: unknown[];
  /**
   * Return matrix only: whether the file has a Reviewer column.
   *
   * Carried through to execute because absent and blank mean different things - a sheet without the
   * column must leave the stored reviewer alone rather than clearing the review step off every row.
   */
  reviewerColumnPresent?: boolean;
} {
  if (entity === 'customers') {
    const r = validateCustomerRows(rows);
    return { errors: r.errors, validRows: r.validRows };
  }
  if (entity === 'zsam-hierarchy') {
    const r = validateZsammHierarchyRows(rows);
    return { errors: r.errors, validRows: r.validRows };
  }
  if (entity === 'znc-installation') {
    const r = validateZncInstallationHierarchyRows(rows);
    return { errors: r.errors, validRows: r.validRows };
  }
  if (entity === 'znc-claim-replacement') {
    const r = validateZncClaimReplacementHierarchyRows(rows);
    return { errors: r.errors, validRows: r.validRows };
  }
  if (entity === 'zint-qc') {
    const r = validateZintQcHierarchyRows(rows);
    return { errors: r.errors, validRows: r.validRows };
  }
  if (entity === 'return-approval-matrix') {
    const r = validateReturnApprovalMatrixRows(rows);
    return {
      errors: r.errors,
      validRows: r.validRows,
      reviewerColumnPresent: r.reviewerColumnPresent,
    };
  }
  const r = validateUserRows(rows);
  return { errors: r.errors, validRows: r.validRows };
}

function requireImportFileKind(req: AuthRequest): ImportFileKind {
  const kind = req.importFileKind;
  if (!kind) {
    throw new Error('Upload validation did not run');
  }
  return kind;
}

/** Sessions are per-user; admin routes guarantee a provisioned user by the time we get here. */
function requireOwnerId(req: AuthRequest): string {
  const id = req.user?.id;
  if (!id) throw new ChunkedUploadError('Unauthorized', 401);
  return id;
}

export interface ImportSource {
  filePath: string;
  kind: ImportFileKind;
  /** A one-shot multipart temp file is ours to delete; a staged chunked upload is not. */
  deleteAfter: boolean;
}

/**
 * Where the spreadsheet for this request lives.
 *
 * Two transports reach the same place: a single multipart `file`, or `uploadId` naming an upload
 * already reassembled from chunks. Everything downstream — parse, validate, dedup, upsert — sees
 * one file on disk either way, so the chunked path inherits the single-shot path's semantics
 * rather than reimplementing them.
 *
 * Returns null when neither transport supplied anything.
 */
export function resolveImportSource(req: AuthRequest): ImportSource | null {
  const uploadId = String(req.body?.uploadId ?? req.query?.uploadId ?? '').trim();
  if (uploadId) {
    const { filePath, kind } = resolveUpload({ uploadId, ownerId: requireOwnerId(req) });
    // Kept alive on purpose: validate runs first and execute reuses the same staged bytes.
    return { filePath, kind, deleteAfter: false };
  }
  const file = req.file as Express.Multer.File | undefined;
  if (!file?.path) return null;
  return { filePath: file.path, kind: requireImportFileKind(req), deleteAfter: true };
}

/** Delete a one-shot multipart temp file. Staged chunked uploads survive for the next call. */
export function discardImportSource(source: ImportSource | null): void {
  if (!source?.deleteAfter) return;
  if (!fs.existsSync(source.filePath)) return;
  try {
    fs.unlinkSync(source.filePath);
  } catch {
    /* temp file; the import already succeeded or failed on its own merits */
  }
}

/** Turn a resolver/session failure into its HTTP status; anything else is a 500. */
export function sendSourceError(res: Response, err: unknown): void {
  if (err instanceof ChunkedUploadError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  res.status(500).json({
    success: false,
    message: err instanceof Error ? err.message : 'Could not read the uploaded file',
  });
}

export async function sheetInfo(req: AuthRequest, res: Response): Promise<void> {
  let source: ImportSource | null;
  try {
    source = resolveImportSource(req);
  } catch (err) {
    sendSourceError(res, err);
    return;
  }
  if (!source) {
    res.status(400).json({
      success: false,
      message: 'No file uploaded. Use multipart field "file", or "uploadId".',
    });
    return;
  }
  try {
    const info = getSheetInfo(source.filePath, source.kind);
    res.json({ success: true, ...info });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message ?? 'Failed to read sheet info' });
  } finally {
    discardImportSource(source);
  }
}

export async function validateImport(req: AuthRequest, res: Response): Promise<void> {
  const entity = (req.body?.entity ?? req.query?.entity ?? '').toString().toLowerCase();
  const sheetNames = parseSheetsParam(req.body, req.query);
  if (sheetNames?.length) {
    console.log('[import/validate] requested sheets:', sheetNames);
  }

  let source: ImportSource | null;
  try {
    source = resolveImportSource(req);
  } catch (err) {
    sendSourceError(res, err);
    return;
  }

  if (!source) {
    res.status(400).json({
      success: false,
      message: 'No file uploaded. Use multipart field "file" and "entity", or "uploadId".',
    });
    return;
  }

  if (!isEntity(entity)) {
    res.status(400).json({
      success: false,
      message: `Invalid entity. Must be one of: ${ENTITIES.join(', ')}`,
    });
    return;
  }

  try {
    const parseResult = parseImportFile(source.filePath, source.kind, { sheetNames });
    const { rows, parsedSheetNames } = parseResult;

    if (rows.length > MAX_ROWS_PER_FILE) {
      res.status(400).json({
        success: false,
        message: `File has too many rows (${rows.length.toLocaleString()}). Maximum is ${MAX_ROWS_PER_FILE.toLocaleString()} rows per file. Select specific worksheets below to validate one at a time, or split the file.`,
      });
      return;
    }

    if (rows.length === 0) {
      const payload: Record<string, unknown> = {
        success: true,
        entity,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [],
        preview: [],
      };
      if (sheetNames && sheetNames.length > 0) {
        payload.requestedSheets = sheetNames;
        payload.matchedSheets = parsedSheetNames ?? [];
        const matched = (parsedSheetNames ?? []).length;
        payload.message = matched === 0
          ? `Backend received sheet filter but no workbook sheet names matched. Requested: [${sheetNames.join(', ')}]. Try "Load worksheets" again and select sheets from the list.`
          : `No data rows in matched sheet(s): ${(parsedSheetNames ?? []).join(', ')}.`;
      }
      res.json(payload);
      return;
    }

    const { errors, validRows } = runEntityValidation(rows, entity);

    const invalidRowCount = new Set(errors.map((e) => e.row)).size;
    const errorsToSend = errors.length > MAX_ERRORS_IN_RESPONSE
      ? errors.slice(0, MAX_ERRORS_IN_RESPONSE)
      : errors;
    const errorsTruncated = errors.length > MAX_ERRORS_IN_RESPONSE;

    const preview = validRows.slice(0, 20).map((r: any) => ({
      row: r.rowIndex,
      action: 'upsert',
      data: r,
    }));

    res.json({
      success: true,
      entity,
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: invalidRowCount,
      errors: errorsToSend,
      totalErrorCount: errors.length,
      errorsTruncated: errorsTruncated || undefined,
      preview,
      ...(entity === 'zsam-hierarchy'
        ? {
            requesterGroupSyncHint:
              'Each valid row updates ZSAM approval mapping and assigns the requester to the requester group for Team Name + Group (CDG/LSG). Merged Excel cells: fill Group/Team on the first row of each block or rely on carry-forward from rows above.',
          }
        : {}),
      ...(entity === 'users'
        ? {
            userImportHint:
              'UPDATE overrides Requester Group when set. Column headers like "1 LSG/CDG" or "2 Requester Group" are detected automatically. LSG/CDG + UPDATE are resolved to internal groups (e.g. KINKI, TOKAI/HOKURIKU → CDG regional teams). Status text in UPDATE (e.g. DID NOT COME) is rejected—use a real group name or clear the cell. AD Account Name is stored as sales rep code.',
          }
        : {}),
      ...(entity === 'znc-installation'
        ? {
            zncInstallHint:
              'Recognizes “National FS manager” and “National TS manager” for the same step, Local Financial Controller, and merged Group/Team cells (carry-forward). Data is upserted into znc_approval_mapping by requester + CDG/LSG. After import, requesters removed from your file are deleted from znc_approval_mapping for that CDG or LSG. For each requester still in the file, extra rows with a different CDG/LSG key are deleted so bulk upload stays authoritative. Duplicate requester + group rows keep the last row.',
          }
        : {}),
      ...(entity === 'znc-claim-replacement'
        ? {
            zncClaimHint:
              'CS/PS manager, RAQA manager (all claims), and Global RAQA manager (when claim total > ¥1.5M) are detected from column headers even with long ZNC Total text. Global RAQA is matched before RAQA. Merged Team/Group cells use carry-forward. After import, requesters removed from your file are removed from zncclaim_approval_mapping for that CDG or LSG so the database matches the spreadsheet. For each requester still in the file, any extra rows with a different CDG/LSG key (for example legacy "" vs LSG) are deleted so bulk upload is the only source of truth. Duplicate requester + group rows keep the last row.',
          }
        : {}),
      ...(entity === 'return-approval-matrix'
        ? {
            returnMatrixHint:
              'Rows are keyed on Group + Team Name + Sales Reps or Requester, so the same person may appear under more than one team. The file is authoritative for the Groups it covers: a row you remove is deleted, and the response lists every create, change and delete with its before and after, plus SQL to undo the whole import. Omit the Reviewer column to leave stored reviewers untouched; include it blank to clear them. Export the matrix first and edit that file — it is exactly what this importer reads back.',
          }
        : {}),
      ...(entity === 'zint-qc'
        ? {
            zintQcHint:
              'After a successful import, requesters removed from your file are removed from zint_approval_mapping for that CDG or LSG block so the database matches the spreadsheet (not upsert-only). For each requester still in the file, extra rows with a different CDG/LSG key are deleted. Duplicate names in the file keep the last row.',
          }
        : {}),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message ?? 'Validation failed',
    });
  } finally {
    discardImportSource(source);
  }
}

/**
 * Phase 2: re-parse and validate the same file, then upsert into the database.
 * Default: all rows must pass validation. With skipInvalidRows=true, only valid rows are imported.
 */
export async function executeImport(req: AuthRequest, res: Response): Promise<void> {
  const entity = (req.body?.entity ?? req.query?.entity ?? '').toString().toLowerCase();
  const sheetNames = parseSheetsParam(req.body, req.query);
  const skipInvalidRows = parseSkipInvalidRows(req.body, req.query);

  let source: ImportSource | null;
  try {
    source = resolveImportSource(req);
  } catch (err) {
    sendSourceError(res, err);
    return;
  }

  if (!source) {
    res.status(400).json({
      success: false,
      message: 'No file uploaded. Use multipart field "file" and "entity", or "uploadId".',
    });
    return;
  }

  if (!isEntity(entity)) {
    res.status(400).json({
      success: false,
      message: `Invalid entity. Must be one of: ${ENTITIES.join(', ')}`,
    });
    return;
  }

  try {
    const parseResult = parseImportFile(source.filePath, source.kind, { sheetNames });
    const { rows } = parseResult;

    if (rows.length > MAX_ROWS_PER_FILE) {
      res.status(400).json({
        success: false,
        message: `File has too many rows (${rows.length.toLocaleString()}). Maximum is ${MAX_ROWS_PER_FILE.toLocaleString()} rows per file.`,
      });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, message: 'No data rows to import.' });
      return;
    }

    const { errors, validRows, reviewerColumnPresent } = runEntityValidation(rows, entity);
    const invalidRowCount = new Set(errors.map((e) => e.row)).size;

    if (errors.length > 0 && !skipInvalidRows) {
      res.status(400).json({
        success: false,
        message: `Validation failed with ${errors.length} issue(s) on ${invalidRowCount} row(s). Fix the file, or run import again with "import only valid rows" to skip failing rows.`,
        errors: errors.slice(0, MAX_ERRORS_IN_RESPONSE),
        totalErrorCount: errors.length,
      });
      return;
    }

    if (validRows.length === 0) {
      res.status(400).json({
        success: false,
        message:
          errors.length > 0
            ? 'No valid rows to import. Fix errors in the file or remove bad rows.'
            : 'No data rows to import.',
        errors: errors.slice(0, MAX_ERRORS_IN_RESPONSE),
        totalErrorCount: errors.length,
      });
      return;
    }

    let created = 0;
    let updated = 0;
    let removedFromDb = 0;
    let returnMatrix: Awaited<ReturnType<typeof executeReturnApprovalMatrixImport>> | undefined;
    let zsamRequesterSync:
      | { created: number; updated: number; moved: number }
      | undefined;

    if (entity === 'customers') {
      const stats = await executeCustomerImport(validRows as ValidatedCustomerRow[]);
      created = stats.created;
      updated = stats.updated;
    } else if (entity === 'zsam-hierarchy') {
      const stats = await executeZsammHierarchyImport(validRows as ValidatedZsammHierarchyRow[]);
      created = stats.created;
      updated = stats.updated;
      removedFromDb = stats.removed ?? 0;
      zsamRequesterSync = stats.requesterSync;
    } else if (entity === 'znc-installation') {
      const stats = await executeZncInstallationHierarchyImport(validRows as ValidatedZncInstallationHierarchyRow[]);
      created = stats.created;
      updated = stats.updated;
      removedFromDb = stats.removed ?? 0;
    } else if (entity === 'znc-claim-replacement') {
      const stats = await executeZncClaimReplacementHierarchyImport(
        validRows as ValidatedZncClaimReplacementHierarchyRow[]
      );
      created = stats.created;
      updated = stats.updated;
      removedFromDb = stats.removed ?? 0;
    } else if (entity === 'zint-qc') {
      const stats = await executeZintQcHierarchyImport(validRows as ValidatedZintQcHierarchyRow[]);
      created = stats.created;
      updated = stats.updated;
      removedFromDb = stats.removed ?? 0;
    } else if (entity === 'return-approval-matrix') {
      /*
       * The interlock: the client sends the row count it believed the table held. A mismatch means
       * the matrix moved between the export that produced this file and this upload, and since a
       * missing row is a deletion, going ahead would silently undo somebody else's edit.
       */
      const expected = parseExpectedCount(req.body, req.query);
      if (expected !== undefined) {
        const actual = await countReturnApprovalMatrixRows();
        if (actual !== expected) {
          res.status(409).json({
            success: false,
            message:
              `The matrix holds ${actual} row(s), but this upload expected ${expected}. ` +
              `It changed since the file was exported. Export it again, re-apply your edits and retry.`,
            matched: actual,
            expectedCount: expected,
          });
          return;
        }
      }
      returnMatrix = await executeReturnApprovalMatrixImport(
        validRows as ValidatedReturnApprovalMatrixRow[],
        { reviewerColumnPresent: reviewerColumnPresent === true }
      );
      created = returnMatrix.created;
      updated = returnMatrix.updated;
      removedFromDb = returnMatrix.deleted;
    } else {
      const stats = await executeUserImport(validRows as ValidatedUserRow[]);
      created = stats.created;
      updated = stats.updated;
    }

    const msgBase = `Import complete: ${created} created, ${updated} updated.`;
    const matrixMsg = returnMatrix
      ? ` ${returnMatrix.unchanged} row(s) unchanged.` +
        (returnMatrix.deleted > 0
          ? ` Deleted ${returnMatrix.deleted} row(s) absent from this file.`
          : '') +
        (returnMatrix.requestersMissingFromDirectory.length > 0
          ? ` ${returnMatrix.requestersMissingFromDirectory.length} name(s) are not in the requester directory and cannot raise a request until they are added.`
          : '')
      : '';
    const pruneMsg =
      (entity === 'zint-qc' ||
        entity === 'znc-claim-replacement' ||
        entity === 'znc-installation' ||
        entity === 'zsam-hierarchy') &&
      removedFromDb > 0
        ? ` Removed ${removedFromDb} stale or duplicate-key row(s) so the database matches this file (per requester + CDG/LSG).`
        : '';
    const skippedRows =
      skipInvalidRows && errors.length > 0 ? invalidRowCount : 0;
    const skipMsg =
      skippedRows > 0
        ? ` Skipped ${skippedRows} row(s) with validation errors (not imported).`
        : '';

    const msg =
      zsamRequesterSync !== undefined
        ? `${msgBase} Requester list: ${zsamRequesterSync.created} created, ${zsamRequesterSync.updated} updated, ${zsamRequesterSync.moved} moved between groups.${skipMsg}`
        : `${msgBase}${matrixMsg}${pruneMsg}${skipMsg}`;

    res.json({
      success: true,
      entity,
      totalRows: rows.length,
      importedRows: validRows.length,
      skippedInvalidRows: skippedRows > 0 ? skippedRows : undefined,
      created,
      updated,
      ...(entity === 'zint-qc' ||
      entity === 'znc-claim-replacement' ||
      entity === 'znc-installation' ||
      entity === 'zsam-hierarchy'
        ? { removedFromDb }
        : {}),
      ...(zsamRequesterSync !== undefined ? { requesterSync: zsamRequesterSync } : {}),
      message: msg,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message ?? 'Import failed',
    });
  } finally {
    discardImportSource(source);
    // A chunked upload has served its purpose once the import ran; free the staged bytes.
    const uploadId = String(req.body?.uploadId ?? req.query?.uploadId ?? '').trim();
    if (uploadId && req.user?.id) {
      discardUpload({ uploadId, ownerId: req.user.id });
    }
  }
}

/**
 * Chunked upload, step 1: open a session. The id is generated here — never taken from the client,
 * because it becomes a directory name.
 */
export async function beginChunkedUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { uploadId } = beginUpload({
      ownerId: requireOwnerId(req),
      clientFilename: sanitizeClientFilename(String(req.body?.filename ?? 'upload')),
      totalChunks: Number(req.body?.totalChunks),
      totalBytes: Number(req.body?.totalBytes),
    });
    res.json({ success: true, uploadId });
  } catch (err) {
    sendSourceError(res, err);
  }
}

/** Chunked upload, step 2: store one slice. Safe to retry an index. */
export async function appendChunkedUpload(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file as Express.Multer.File | undefined;
  if (!file?.buffer?.length) {
    res.status(400).json({ success: false, message: 'No chunk uploaded. Use multipart field "chunk".' });
    return;
  }
  try {
    const progress = appendChunk({
      uploadId: String(req.body?.uploadId ?? '').trim(),
      ownerId: requireOwnerId(req),
      index: Number(req.body?.index),
      buffer: file.buffer,
    });
    res.json({ success: true, ...progress });
  } catch (err) {
    sendSourceError(res, err);
  }
}

/** Chunked upload, step 3: stitch and magic-byte check. Validate/execute can then use uploadId. */
export async function finalizeChunkedUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { kind, bytes } = finalizeUpload({
      uploadId: String(req.body?.uploadId ?? '').trim(),
      ownerId: requireOwnerId(req),
    });
    res.json({ success: true, kind, bytes });
  } catch (err) {
    sendSourceError(res, err);
  }
}

/** Which chunks a session still needs, so a partly-blocked upload can resume instead of restart. */
export async function statusChunkedUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const status = uploadStatus({
      uploadId: String(req.body?.uploadId ?? '').trim(),
      ownerId: requireOwnerId(req),
    });
    res.json({ success: true, ...status });
  } catch (err) {
    sendSourceError(res, err);
  }
}

/** Abandon a session and delete its bytes (page navigated away, user cancelled). */
export async function abortChunkedUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    discardUpload({
      uploadId: String(req.body?.uploadId ?? '').trim(),
      ownerId: requireOwnerId(req),
    });
    res.json({ success: true });
  } catch (err) {
    sendSourceError(res, err);
  }
}
