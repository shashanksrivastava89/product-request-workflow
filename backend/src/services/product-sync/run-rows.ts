/**
 * A run's rows: what a preview persists of its plan, and how the apply reads them back to plan again.
 *
 * Pure (no database), so the round trip the apply depends on - plan, store, reload, plan again, same
 * fingerprint - is tested on its own (run-rows.test.ts). The round trip once broke on held rows:
 * an ambiguous-match hold came back as a file collision, the re-plan dropped the protection on the
 * products it pointed at, and every apply was refused as "the catalogue changed".
 */

import { Prisma } from '@prisma/client';

import type { HeldKey, InvalidKey, PlannedRow, RowAction, SkippedKey, SnapshotRow } from './diff';

export function toRunRow(runId: string, r: PlannedRow): Prisma.ProductSyncRunRowCreateManyInput {
  const s = r.snapshot;
  const p = r.product;
  return {
    runId,
    action: r.action,
    holdKind: r.holdKind ?? null,
    productId: p?.id ?? null,
    businessGroup: r.businessGroup,
    code: r.code,
    sapCode: s?.sapCode ?? p?.sapCode ?? r.sapCode ?? '',
    name: s?.name ?? p?.name ?? '',
    productNameLocal: s?.productNameLocal ?? p?.productNameLocal ?? '',
    price: s ? s.price : p ? p.price : null,
    listPrice: s ? s.listPrice : p ? p.listPrice : null,
    priceGroup: s?.priceGroup ?? null,
    serviceFlag: s?.serviceFlag ?? null,
    dchain: s?.dchain ?? null,
    rowIndex: s?.rowIndex ?? r.rowIndex ?? null,
    reason: r.reason ?? null,
    fieldChanges: r.fieldChanges && r.fieldChanges.length > 0 ? (r.fieldChanges as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
  };
}

/** The fields the apply reads back: a stored row, or what toRunRow produced. */
export interface RunRowLike {
  id: string;
  action: string;
  holdKind?: string | null;
  businessGroup: string;
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price?: unknown;
  listPrice?: unknown;
  priceGroup?: string | null;
  serviceFlag?: string | null;
  dchain?: string | null;
  rowIndex?: number | null;
  reason?: string | null;
}

export interface StoredRows {
  snapshot: SnapshotRow[];
  skipped: SkippedKey[];
  held: HeldKey[];
  invalid: InvalidKey[];
  /** Run-row id by business group + code, so created products can be linked back to their row. */
  rowIdByKey: Map<string, string>;
}

const SNAPSHOT_ACTIONS: RowAction[] = ['CREATE', 'UPDATE', 'REACTIVATE', 'UNCHANGED', 'KEEP_INACTIVE'];

function snapshotOf(r: RunRowLike): SnapshotRow {
  return {
    businessGroup: r.businessGroup,
    code: r.code,
    sapCode: r.sapCode,
    name: r.name,
    productNameLocal: r.productNameLocal,
    price: Number(r.price ?? 0),
    listPrice: Number(r.listPrice ?? 0),
    ...(r.priceGroup !== null && r.priceGroup !== undefined ? { priceGroup: r.priceGroup } : {}),
    ...(r.serviceFlag !== null && r.serviceFlag !== undefined ? { serviceFlag: r.serviceFlag } : {}),
    ...(r.dchain !== null && r.dchain !== undefined ? { dchain: r.dchain } : {}),
    rowIndex: r.rowIndex ?? undefined,
  };
}

/**
 * What the preview planned from. A held row goes back where it came from: a collision is a fact
 * about the file and stays held; an ambiguous match or a blocked rename is a fact about the catalogue,
 * so its snapshot goes back in and the planner decides again against the catalogue as it is now.
 * (Rows stored before holdKind existed: a collision was the hold that carried no name.)
 */
export function storedRowsFrom(rows: RunRowLike[]): StoredRows {
  const out: StoredRows = { snapshot: [], skipped: [], held: [], invalid: [], rowIdByKey: new Map() };
  for (const r of rows) {
    if (SNAPSHOT_ACTIONS.includes(r.action as RowAction)) {
      out.snapshot.push(snapshotOf(r));
      out.rowIdByKey.set(`${r.businessGroup}|${r.code}`, r.id);
    } else if (r.action === 'SKIPPED') {
      out.skipped.push({ businessGroup: r.businessGroup, code: r.code, reason: r.reason ?? '', rowIndex: r.rowIndex ?? undefined });
    } else if (r.action === 'INVALID') {
      out.invalid.push({ businessGroup: r.businessGroup, code: r.code, sapCode: r.sapCode, reason: r.reason ?? '', rowIndex: r.rowIndex ?? undefined });
    } else if (r.action === 'HELD') {
      const collision = r.holdKind ? r.holdKind === 'COLLISION' : r.name === '';
      if (collision) {
        out.held.push({ businessGroup: r.businessGroup, code: r.code, reason: r.reason ?? '', rowIndex: r.rowIndex ?? undefined });
      } else {
        out.snapshot.push(snapshotOf(r));
        out.rowIdByKey.set(`${r.businessGroup}|${r.code}`, r.id);
      }
    }
  }
  return out;
}
