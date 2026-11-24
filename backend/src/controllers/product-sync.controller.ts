/**
 * Product master sync - HTTP surface.
 *
 * A preview is created from a staged upload (chunked, so the 8KB edge limit never sees the file) and
 * runs in the background; the page polls the run. An apply is the same shape: start it, poll it.
 * Nothing here waits on a long operation inside a request.
 */

import { Response } from 'express';

import { AuthRequest } from '../middleware/auth.middleware';
import { discardUpload } from '../services/import/chunked-upload.service';
import {
  ProductSyncError,
  applyRun,
  buildProductMasterXlsx,
  createRun,
  exportRunRowsXlsx,
  failRun,
  getRun,
  getRunFile,
  getRunHistory,
  getRunRows,
  isRowAction,
  listRuns,
  listVersions,
  startApplyInBackground,
  startPreviewInBackground,
  startRestore,
  storeRunFile,
} from '../services/product-sync/product-sync.service';
import { discardImportSource, parseSheetsParam, resolveImportSource, sendSourceError } from './import.controller';

function sendError(res: Response, err: unknown): void {
  if (err instanceof ProductSyncError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Product sync failed' });
}

function actor(req: AuthRequest) {
  return { userId: req.user?.id, userName: req.user?.name };
}

function pageParams(query: Record<string, unknown>): { offset: number; limit: number } {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? '50'), 10) || 50, 1), 500);
  const offset = Math.max(parseInt(String(query.offset ?? '0'), 10) || 0, 0);
  return { offset, limit };
}

/** POST /api/admin/product-sync/runs - start a preview of a staged (or single-shot) upload. */
export async function createPreview(req: AuthRequest, res: Response): Promise<void> {
  let source;
  try {
    source = resolveImportSource(req);
  } catch (err) {
    sendSourceError(res, err);
    return;
  }
  if (!source) {
    res.status(400).json({ success: false, message: 'No file uploaded. Use multipart field "file", or "uploadId".' });
    return;
  }

  const fileName = String(req.body?.fileName ?? req.file?.originalname ?? '').trim() || undefined;
  const sheetNames = parseSheetsParam(req.body, req.query);
  const uploadId = String(req.body?.uploadId ?? '').trim();
  const ownerId = req.user?.id;

  try {
    const run = await createRun({ source: 'upload', trigger: 'manual', fileName, ...actor(req) });
    const staged = source;
    // Kept with the run before the staged copy goes: it is what this version is downloaded and
    // restored from once applied.
    try {
      await storeRunFile(run.id, staged.filePath, staged.kind, fileName);
    } catch (err) {
      await failRun(run.id, err);
      throw err;
    }
    startPreviewInBackground(run.id, { filePath: staged.filePath, kind: staged.kind, sheetNames }, () => {
      discardImportSource(staged);
      if (uploadId && ownerId) discardUpload({ uploadId, ownerId });
    });
    res.status(202).json({ success: true, runId: run.id });
  } catch (err) {
    discardImportSource(source);
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/runs */
export async function listRunsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const runs = await listRuns(parseInt(String(req.query.limit ?? '30'), 10) || 30);
    res.json({ success: true, runs });
  } catch (err) {
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/runs/:id */
export async function getRunHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await getRun(req.params.id);
    res.json({ success: true, run });
  } catch (err) {
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/runs/:id/rows?action=RETIRE&offset=0&limit=50 */
export async function getRunRowsHandler(req: AuthRequest, res: Response): Promise<void> {
  const action = String(req.query.action ?? '').toUpperCase();
  if (!isRowAction(action)) {
    res.status(400).json({ success: false, message: 'action must be one of CREATE, UPDATE, REACTIVATE, RETIRE, KEEP_INACTIVE, HELD, SKIPPED, INVALID, UNCHANGED' });
    return;
  }
  try {
    await getRun(req.params.id);
    const { offset, limit } = pageParams(req.query as Record<string, unknown>);
    const { rows, total } = await getRunRows(req.params.id, action, offset, limit);
    res.json({ success: true, action, rows, total, offset, limit, hasMore: offset + rows.length < total });
  } catch (err) {
    sendError(res, err);
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** GET /api/admin/product-sync/runs/:id/export?action=RETIRE - the whole bucket as .xlsx. */
export async function exportRunRowsHandler(req: AuthRequest, res: Response): Promise<void> {
  const action = String(req.query.action ?? '').toUpperCase();
  if (!isRowAction(action)) {
    res.status(400).json({ success: false, message: 'action is required' });
    return;
  }
  try {
    const run = await getRun(req.params.id);
    const buffer = await exportRunRowsXlsx(run.id, action);
    const label = run.version ? `v${run.version}` : run.id.slice(0, 8);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="product-master-${label}-${action.toLowerCase()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
}

/** POST /api/admin/product-sync/runs/:id/apply  { overrideReason?: string, wait?: boolean } */
export async function applyRunHandler(req: AuthRequest, res: Response): Promise<void> {
  const overrideReason = String(req.body?.overrideReason ?? '').trim() || undefined;
  const wait = req.body?.wait === true || String(req.body?.wait ?? '') === 'true';
  try {
    const run = await getRun(req.params.id);
    if (wait) {
      const outcome = await applyRun(run.id, { ...actor(req), overrideReason });
      res.json({ success: true, ...outcome });
      return;
    }
    // Validate the preconditions now so the caller gets a 409 instead of a silent background failure.
    if (run.status !== 'PREVIEWED') {
      res.status(409).json({ success: false, message: `Run is ${run.status}; only a previewed run can be applied.` });
      return;
    }
    startApplyInBackground(run.id, { ...actor(req), overrideReason });
    res.status(202).json({ success: true, runId: run.id });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * GET /api/admin/product-sync/export - every product a requester can select, in the Power BI
 * export's layout. Both the sync page and the Products page download this one file.
 */
export async function exportCurrentProductsHandler(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { buffer } = await buildProductMasterXlsx();
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="product-master-${day}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/versions - every applied master, newest first. */
export async function listVersionsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const versions = await listVersions(parseInt(String(req.query.limit ?? '50'), 10) || 50);
    res.json({ success: true, versions });
  } catch (err) {
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/runs/:id/file - the file the run was made from, byte for byte. */
export async function downloadRunFileHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const run = await getRun(req.params.id);
    const file = await getRunFile(run.id);
    const ext = file.contentType === 'text/csv' ? 'csv' : 'xlsx';
    const original = (file.fileName ?? '').replace(/[^\w.\-]+/g, '_').replace(/\.(xlsx|csv)$/i, '');
    const name = `${run.version ? `v${run.version}-` : ''}${original || 'product-master'}.${ext}`;
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(file.content));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * POST /api/admin/product-sync/runs/:id/restore { reason } - preview that version's file against the
 * catalogue as it is now. Returns the new run id; it is applied like any other preview.
 */
export async function restoreRunHandler(req: AuthRequest, res: Response): Promise<void> {
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) {
    res.status(400).json({ success: false, message: 'Say why this version is being restored.' });
    return;
  }
  try {
    const { runId } = await startRestore(req.params.id, { ...actor(req), reason });
    res.status(202).json({ success: true, runId });
  } catch (err) {
    sendError(res, err);
  }
}

/** GET /api/admin/product-sync/runs/:id/history?offset&limit - what an applied run wrote. */
export async function getRunHistoryHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    await getRun(req.params.id);
    const { offset, limit } = pageParams(req.query as Record<string, unknown>);
    const { rows, total } = await getRunHistory(req.params.id, offset, limit);
    res.json({ success: true, rows, total, offset, limit, hasMore: offset + rows.length < total });
  } catch (err) {
    sendError(res, err);
  }
}
