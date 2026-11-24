/**
 * Chunked import uploads: reassemble a spreadsheet from many small request bodies.
 *
 * Why this exists: the UAT/production load balancer rejects request bodies over ~8KB
 * (AWS WAF `SizeRestrictions_BODY`), so a whole workbook never reaches the app — a 51KB file
 * returns 403 from `awselb` before nginx sees it. The browser therefore slices the file with
 * `File.slice()` and posts the pieces; this service stitches them back into one file on disk and
 * hands the existing parser the same thing a single-shot multipart upload would have produced.
 * Parsing, validation, cross-file dedup and "last row wins" all keep working unchanged.
 *
 * The chunk size lives on the client (IMPORT_CHUNK_BYTES). Raising the WAF limit only means
 * fewer, larger chunks — nothing here has to change.
 *
 * Session ids are generated here, never accepted from the client, and are bound to the user who
 * started them: an id is a filesystem path component, so a client-supplied one would be a
 * traversal hole, and an unbound one would let any admin read another's staged upload.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { IMPORT_UPLOAD_DIR, MAX_IMPORT_FILE_SIZE, ensureImportUploadDir } from '../../middleware/upload.middleware';
import {
  ImportFileValidationError,
  validateImportFileBuffer,
  type ImportFileKind,
} from '../../utils/import-file-validation.util';

/** Abandoned sessions are swept after this long. */
const SESSION_TTL_MS = 60 * 60 * 1000;
/** Bounds the bookkeeping a single upload can cost us; 20MB at 8KB/chunk needs ~2,600. */
const MAX_CHUNKS = 20_000;

export class ChunkedUploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ChunkedUploadError';
    this.status = status;
  }
}

interface Session {
  uploadId: string;
  ownerId: string;
  clientFilename: string;
  totalChunks: number;
  /** Indexes received so far — a retried chunk must not be counted twice. */
  received: Set<number>;
  bytes: number;
  createdAt: number;
  /** Set once finalize() has stitched and magic-byte checked the file. */
  assembled?: { filePath: string; kind: ImportFileKind };
}

const sessions = new Map<string, Session>();

function sessionDir(uploadId: string): string {
  return path.join(IMPORT_UPLOAD_DIR, `chunked-${uploadId}`);
}

function rmDirQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp dir is not worth failing an import over */
  }
}

/** Drop sessions past their TTL, and their staged bytes with them. */
function sweep(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) {
      rmDirQuietly(sessionDir(id));
      sessions.delete(id);
    }
  }
}

function getOwned(uploadId: string, ownerId: string): Session {
  sweep();
  const s = sessions.get(uploadId);
  if (!s) {
    throw new ChunkedUploadError(
      'Upload session not found or expired. Start the upload again.',
      404
    );
  }
  if (s.ownerId !== ownerId) {
    // Same message as "not found": whether someone else's id exists is not this caller's business.
    throw new ChunkedUploadError(
      'Upload session not found or expired. Start the upload again.',
      404
    );
  }
  return s;
}

export function beginUpload(params: {
  ownerId: string;
  clientFilename: string;
  totalChunks: number;
  totalBytes: number;
}): { uploadId: string } {
  sweep();
  const { ownerId, clientFilename, totalChunks, totalBytes } = params;

  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
    throw new ChunkedUploadError(`totalChunks must be between 1 and ${MAX_CHUNKS}.`);
  }
  if (!Number.isFinite(totalBytes) || totalBytes < 1 || totalBytes > MAX_IMPORT_FILE_SIZE) {
    throw new ChunkedUploadError(
      `File is ${totalBytes} bytes; the limit is ${MAX_IMPORT_FILE_SIZE} bytes.`
    );
  }

  ensureImportUploadDir();
  const uploadId = crypto.randomUUID();
  fs.mkdirSync(sessionDir(uploadId), { recursive: true });

  sessions.set(uploadId, {
    uploadId,
    ownerId,
    clientFilename,
    totalChunks,
    received: new Set(),
    bytes: 0,
    createdAt: Date.now(),
  });
  return { uploadId };
}

export function appendChunk(params: {
  uploadId: string;
  ownerId: string;
  index: number;
  buffer: Buffer;
}): { received: number; totalChunks: number; complete: boolean } {
  const { uploadId, ownerId, index, buffer } = params;
  const s = getOwned(uploadId, ownerId);

  if (s.assembled) {
    throw new ChunkedUploadError('Upload is already complete; start a new one to re-send.');
  }
  if (!Number.isInteger(index) || index < 0 || index >= s.totalChunks) {
    throw new ChunkedUploadError(`Chunk index ${index} is outside 0..${s.totalChunks - 1}.`);
  }
  if (!buffer?.length) {
    throw new ChunkedUploadError('Chunk is empty.');
  }

  const isRetry = s.received.has(index);
  const partPath = path.join(sessionDir(uploadId), `${index}.part`);
  const previous = isRetry && fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  if (s.bytes - previous + buffer.length > MAX_IMPORT_FILE_SIZE) {
    throw new ChunkedUploadError(
      `Upload exceeds the ${MAX_IMPORT_FILE_SIZE}-byte limit.`
    );
  }

  fs.writeFileSync(partPath, buffer, { mode: 0o600 });
  s.bytes = s.bytes - previous + buffer.length;
  s.received.add(index);

  return {
    received: s.received.size,
    totalChunks: s.totalChunks,
    complete: s.received.size === s.totalChunks,
  };
}

/**
 * Stitch the parts in index order, then run the same magic-byte check a single-shot upload gets.
 * Idempotent: finalizing an already-assembled session returns the existing file.
 */
export function finalizeUpload(params: {
  uploadId: string;
  ownerId: string;
}): { filePath: string; kind: ImportFileKind; bytes: number } {
  const { uploadId, ownerId } = params;
  const s = getOwned(uploadId, ownerId);
  if (s.assembled) {
    return { ...s.assembled, bytes: s.bytes };
  }

  if (s.received.size !== s.totalChunks) {
    const missing: number[] = [];
    for (let i = 0; i < s.totalChunks && missing.length < 20; i++) {
      if (!s.received.has(i)) missing.push(i);
    }
    throw new ChunkedUploadError(
      `Upload incomplete: ${s.received.size} of ${s.totalChunks} chunks received. Missing index(es): ${missing.join(', ')}.`
    );
  }

  const dir = sessionDir(uploadId);
  const parts: Buffer[] = [];
  for (let i = 0; i < s.totalChunks; i++) {
    parts.push(fs.readFileSync(path.join(dir, `${i}.part`)));
  }
  const whole = Buffer.concat(parts);

  let kind: ImportFileKind;
  try {
    ({ kind } = validateImportFileBuffer(whole));
  } catch (err) {
    // A byte-level reassembly bug and a genuinely bad file look identical here, so say both.
    const detail = err instanceof ImportFileValidationError ? err.message : 'Invalid upload file';
    rmDirQuietly(dir);
    sessions.delete(uploadId);
    throw new ChunkedUploadError(
      `${detail} (reassembled ${whole.length} bytes from ${s.totalChunks} chunks). Re-send the file; if it fails again the source file is not a valid .xlsx or .csv.`
    );
  }

  const filePath = path.join(dir, `assembled${kind === 'xlsx' ? '.xlsx' : '.csv'}`);
  fs.writeFileSync(filePath, whole, { mode: 0o600 });
  for (let i = 0; i < s.totalChunks; i++) {
    try {
      fs.unlinkSync(path.join(dir, `${i}.part`));
    } catch {
      /* the whole dir goes on discard anyway */
    }
  }

  s.assembled = { filePath, kind };
  return { filePath, kind, bytes: whole.length };
}

/** The staged file for validate/execute. Throws unless finalizeUpload has run. */
export function resolveUpload(params: {
  uploadId: string;
  ownerId: string;
}): { filePath: string; kind: ImportFileKind; clientFilename: string } {
  const s = getOwned(params.uploadId, params.ownerId);
  if (!s.assembled || !fs.existsSync(s.assembled.filePath)) {
    throw new ChunkedUploadError(
      'Upload is not complete. Send every chunk and finalize before validating.'
    );
  }
  return { ...s.assembled, clientFilename: s.clientFilename };
}

/**
 * Forget a session and delete its bytes.
 *
 * Deliberately NOT called after validate: the browser validates and then executes against the
 * same staged file, and re-uploading between the two would double the request count.
 */
export function discardUpload(params: { uploadId: string; ownerId: string }): void {
  const { uploadId, ownerId } = params;
  const s = sessions.get(uploadId);
  if (!s || s.ownerId !== ownerId) return;
  rmDirQuietly(sessionDir(uploadId));
  sessions.delete(uploadId);
}

/**
 * Which chunk indexes a session still needs.
 *
 * The client uses this to resume: when the edge blocks part of a burst, re-sending only the gaps
 * beats restarting an upload that is already 90% staged.
 */
export function uploadStatus(params: {
  uploadId: string;
  ownerId: string;
}): { received: number; totalChunks: number; missing: number[]; complete: boolean } {
  const s = getOwned(params.uploadId, params.ownerId);
  const missing: number[] = [];
  for (let i = 0; i < s.totalChunks; i++) {
    if (!s.received.has(i)) missing.push(i);
  }
  return {
    received: s.received.size,
    totalChunks: s.totalChunks,
    missing,
    complete: missing.length === 0,
  };
}

/** Test seam: how many sessions are live right now. */
export function activeUploadCount(): number {
  sweep();
  return sessions.size;
}
