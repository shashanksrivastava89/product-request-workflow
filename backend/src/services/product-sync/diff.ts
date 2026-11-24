/**
 * Product master sync - the planner.
 *
 * Pure: takes the normalised snapshot (what the master says) and the catalogue (what the app holds)
 * and decides, row by row, what an apply would do. No database access, so it can be unit-tested with
 * hand-made rows and re-run inside the apply transaction to prove the preview is still true.
 *
 * The master is the whole truth (8 Oct 2026: "1 to 1 with what Sample Ordering can select"): after an
 * apply, the selectable products are exactly the file's rows, minus what an admin deactivated.
 *
 * Decisions encoded here, and why:
 *
 *  - A snapshot row's identity is its SAP material number. A catalogue row with the same SAP code and
 *    the same product code is that product, whatever else shares the SAP code; this is what tells
 *    the Power BI row `01129` apart from a stale `1129` an early load left behind (zero lost, list 0).
 *  - Otherwise one catalogue row with the SAP code is the product under a new code: the CDG team
 *    filled in a GS1, so the row is renamed and keeps its history rather than being re-created.
 *    Several such rows, with none carrying the file's code, is ambiguous: held back and reported.
 *  - A row whose SAP code finds nothing is matched by product code, the catalogue's unique key
 *    (legacy loads left 24,900 LSG rows with a blank SAP code).
 *  - Everything else the catalogue holds active is removed (isActive = false, retiredBySync = true),
 *    never deleted: requests hold products by value, and the row keeps its history and comes back on
 *    the same record if the master carries it again. That includes products created by hand in the
 *    app, a code the master prices at 0 / 1 / blank, and a stale duplicate of a master row.
 *  - Never removed: a product whose file row failed validation (a report defect is not a business
 *    decision), a code two file rows collided on, a product an ambiguous match points at, and
 *    anything in a business unit the file has no rows for.
 *  - A product the sync removed comes back when its code reappears. One an admin deactivated is
 *    updated but left inactive, so the admin's decision stands.
 */

import { createHash } from 'crypto';

import { roundMoney, type ValidatedProductRow } from '../import/validate-products';

export type RowAction =
  | 'CREATE'
  | 'UPDATE'
  | 'REACTIVATE'
  | 'UNCHANGED'
  | 'RETIRE'
  | 'KEEP_INACTIVE'
  | 'HELD'
  | 'SKIPPED'
  | 'INVALID';

/**
 * Why a code is held. A collision comes from the file itself and is stored as such; the other two
 * are derived from the catalogue, so the apply re-derives them from the stored snapshot.
 */
export type HoldKind = 'COLLISION' | 'AMBIGUOUS' | 'RENAME_BLOCKED';

/** What the master says about one product, after the normaliser. */
export interface SnapshotRow {
  businessGroup: string;
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price: number;
  listPrice: number;
  /** undefined = the file did not carry the column; the stored value is left alone. */
  priceGroup?: string;
  serviceFlag?: string;
  dchain?: string;
  rowIndex?: number;
}

/** What the catalogue holds for one product - the subset of product_catalog the planner reads. */
export interface CatalogueRow {
  id: string;
  businessGroup: string;
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price: number;
  listPrice: number;
  priceGroup: string | null;
  serviceFlag: string | null;
  dchain: string | null;
  isActive: boolean;
  status: string;
  sourceSystem: string | null;
  retiredBySync: boolean;
}

export interface FieldChange {
  field: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

/** A code the normaliser dropped on purpose (list price 0 / 1 / blank). */
export interface SkippedKey {
  businessGroup: string;
  code: string;
  reason: string;
  rowIndex?: number;
}

/** A code the normaliser could not trust: two rows resolved to it. */
export interface HeldKey {
  businessGroup: string;
  code: string;
  reason: string;
  rowIndex?: number;
}

/** A file row that failed validation, by the keys it would have matched a product on. */
export interface InvalidKey {
  businessGroup: string;
  code: string;
  sapCode: string;
  reason: string;
  rowIndex?: number;
}

export interface PlannedRow {
  action: RowAction;
  businessGroup: string;
  code: string;
  /** The catalogue row this touches, when there is one. */
  product?: CatalogueRow;
  /** The master row this came from, when there is one. */
  snapshot?: SnapshotRow;
  /** The row as it will be stored after the apply (every action that writes). */
  next?: CatalogueState;
  fieldChanges?: FieldChange[];
  reason?: string;
  /** HELD rows only. */
  holdKind?: HoldKind;
  /** File row, for rows that carry no snapshot (collisions, invalid rows). */
  rowIndex?: number;
  /** INVALID rows only: the SAP code the row carried. */
  sapCode?: string;
}

/** The writable columns of product_catalog, as they will stand after the apply. */
export interface CatalogueState {
  code: string;
  sapCode: string;
  name: string;
  productNameLocal: string;
  price: number;
  listPrice: number;
  priceGroup: string | null;
  serviceFlag: string | null;
  dchain: string | null;
  isActive: boolean;
  status: string;
  retiredBySync: boolean;
}

export interface BusinessGroupCounts {
  kept: number;
  activeBefore: number;
  create: number;
  update: number;
  retire: number;
  reactivate: number;
}

export interface SyncCounts {
  /** Data rows in the file (the footer excluded). */
  read: number;
  /** Rows the normaliser accepted. */
  kept: number;
  /** Rows dropped by the list-price rule. */
  skippedByRule: number;
  /** Rows that failed validation. They never remove anything. */
  invalid: number;
  /** Codes held back: a collision in the file or an ambiguous match in the catalogue. */
  held: number;
  create: number;
  update: number;
  reactivate: number;
  unchanged: number;
  retire: number;
  keepInactive: number;
  /** Of the removals, products that were created (or restored) by hand in the app. */
  manualRetire: number;
  /** Active products left alone because the file's row for them failed validation. */
  protectedInvalid: number;
  perBusinessGroup: Record<string, BusinessGroupCounts>;
}

export interface PlanInput {
  snapshot: SnapshotRow[];
  skipped: SkippedKey[];
  held: HeldKey[];
  /** File rows that failed validation; the products they point at are never removed. */
  invalid?: InvalidKey[];
  catalogue: CatalogueRow[];
  /** Carried into the counts so the run record tells the whole story of the file. */
  read: number;
  /** Rows that failed validation, for the counts. */
  invalidRows: number;
}

export interface PlanResult {
  rows: PlannedRow[];
  counts: SyncCounts;
}

const key = (businessGroup: string, code: string) => `${businessGroup}|${code}`;

const norm = (v: string | null | undefined) => String(v ?? '').trim();

/** The normaliser already rounds; the catalogue is Decimal(15,2). Compare on the same footing. */
const money = (v: number | string | null | undefined) => roundMoney(Number(v ?? 0));

export function snapshotFromValidatedRows(rows: ValidatedProductRow[]): SnapshotRow[] {
  return rows.map((r) => ({
    businessGroup: r.businessGroup,
    code: r.code,
    sapCode: r.sapCode,
    name: r.name,
    productNameLocal: r.productNameLocal,
    price: money(r.price),
    listPrice: money(r.listPrice),
    ...(r.priceGroup !== undefined ? { priceGroup: r.priceGroup } : {}),
    ...(r.serviceFlag !== undefined ? { serviceFlag: r.serviceFlag } : {}),
    ...(r.dchain !== undefined ? { dchain: r.dchain } : {}),
    rowIndex: r.rowIndex,
  }));
}

/** What a snapshot row would turn an existing catalogue row into. */
function nextStateFor(existing: CatalogueRow | undefined, snap: SnapshotRow, isActive: boolean, retiredBySync: boolean): CatalogueState {
  return {
    code: snap.code,
    sapCode: snap.sapCode,
    name: snap.name,
    productNameLocal: snap.productNameLocal,
    price: money(snap.price),
    listPrice: money(snap.listPrice),
    // The master is authoritative for the columns it carries - a blank clears - and silent on the
    // ones it omits: a legacy LSG price list once wiped priceGroup on 780 products that way.
    priceGroup: snap.priceGroup !== undefined ? snap.priceGroup || null : existing?.priceGroup ?? null,
    serviceFlag: snap.serviceFlag !== undefined ? snap.serviceFlag || null : existing?.serviceFlag ?? null,
    dchain: snap.dchain !== undefined ? snap.dchain || null : existing?.dchain ?? null,
    isActive,
    // Master data that the master carries is approved by definition - the same rule the bulk
    // import has always applied.
    status: 'APPROVED',
    retiredBySync,
  };
}

function changesBetween(existing: CatalogueRow, next: CatalogueState): FieldChange[] {
  const changes: FieldChange[] = [];
  const str = (field: keyof CatalogueState & keyof CatalogueRow) => {
    const a = norm(existing[field] as string | null);
    const b = norm(next[field] as string | null);
    if (a !== b) changes.push({ field, oldValue: a || null, newValue: b || null });
  };
  const num = (field: 'price' | 'listPrice') => {
    const a = money(existing[field]);
    const b = money(next[field]);
    if (a !== b) changes.push({ field, oldValue: a, newValue: b });
  };
  str('code');
  str('sapCode');
  str('name');
  str('productNameLocal');
  num('price');
  num('listPrice');
  str('priceGroup');
  str('serviceFlag');
  str('dchain');
  str('status');
  if (existing.isActive !== next.isActive) {
    changes.push({ field: 'isActive', oldValue: existing.isActive, newValue: next.isActive });
  }
  return changes;
}

function emptyBgCounts(): BusinessGroupCounts {
  return { kept: 0, activeBefore: 0, create: 0, update: 0, retire: 0, reactivate: 0 };
}

export function planSync(input: PlanInput): PlanResult {
  const { snapshot, skipped, held, catalogue } = input;
  const invalid = input.invalid ?? [];

  const byCode = new Map<string, CatalogueRow>();
  const bySap = new Map<string, CatalogueRow[]>();
  for (const row of catalogue) {
    byCode.set(key(row.businessGroup, row.code), row);
    const sap = norm(row.sapCode);
    if (sap) {
      const k = key(row.businessGroup, sap);
      const list = bySap.get(k);
      if (list) list.push(row);
      else bySap.set(k, [row]);
    }
  }

  const heldKeys = new Set(held.map((h) => key(h.businessGroup, h.code)));
  const skippedByKey = new Map(skipped.map((s) => [key(s.businessGroup, s.code), s]));
  const claimed = new Set<string>();
  /** Catalogue rows an ambiguous match points at: acting on them either way would be a guess. */
  const protectedIds = new Set<string>();
  const rows: PlannedRow[] = [];

  const perBusinessGroup: Record<string, BusinessGroupCounts> = {};
  const bg = (name: string) => (perBusinessGroup[name] ??= emptyBgCounts());
  for (const row of catalogue) {
    if (row.isActive) bg(row.businessGroup).activeBefore += 1;
  }

  for (const h of held) {
    rows.push({ action: 'HELD', businessGroup: h.businessGroup, code: h.code, reason: h.reason, holdKind: 'COLLISION', rowIndex: h.rowIndex });
  }
  for (const s of skipped) {
    rows.push({
      action: 'SKIPPED',
      businessGroup: s.businessGroup,
      code: s.code,
      reason: s.reason,
      snapshot: { businessGroup: s.businessGroup, code: s.code, sapCode: '', name: '', productNameLocal: '', price: 0, listPrice: 0, rowIndex: s.rowIndex },
    });
  }
  // A file row that failed validation says nothing about its product, so that product is protected.
  const invalidIds = new Set<string>();
  for (const inv of invalid) {
    rows.push({ action: 'INVALID', businessGroup: inv.businessGroup, code: inv.code, sapCode: inv.sapCode, reason: inv.reason, rowIndex: inv.rowIndex });
    const byItsCode = inv.code ? byCode.get(key(inv.businessGroup, inv.code)) : undefined;
    if (byItsCode) invalidIds.add(byItsCode.id);
    const sap = norm(inv.sapCode);
    if (sap) for (const c of bySap.get(key(inv.businessGroup, sap)) ?? []) invalidIds.add(c.id);
  }

  for (const snap of snapshot) bg(snap.businessGroup).kept += 1;

  // Matching runs in passes, each over every row, so the outcome never depends on the order rows
  // arrive in (the preview reads the file, the apply re-reads the stored rows, and both must plan
  // the same thing).
  //
  // Pass 1a - identity, exact: a catalogue row with the row's SAP code AND its product code. Two
  //   rows can share a SAP code - the Power BI `01129` and a stale `1129` an early load left behind
  //   for SAP 001129VJ48 - and the one carrying the file's code is the product; the other is left
  //   unmatched and removed like any code the master does not carry.
  // Pass 1b - identity, renamed: the one remaining catalogue row with the row's SAP code, under
  //   another code. This turns "the CDG team filled in a GS1" into a rename, not a create plus a
  //   removal. Several such rows and none with the file's code is ambiguous: held, never guessed.
  // Pass 2 - position: the product code, for rows whose SAP code found nothing (legacy loads left
  //   24,900 LSG rows with a blank SAP code).
  const matched = new Map<SnapshotRow, CatalogueRow>();
  const heldSnapshots = new Map<SnapshotRow, { kind: HoldKind; reason: string }>();
  const sapCandidates = (snap: SnapshotRow) => {
    const sap = norm(snap.sapCode);
    return sap ? (bySap.get(key(snap.businessGroup, sap)) ?? []).filter((c) => !claimed.has(c.id)) : [];
  };

  for (const snap of snapshot) {
    if (heldKeys.has(key(snap.businessGroup, snap.code))) continue;
    const exact = sapCandidates(snap).find((c) => c.code === snap.code);
    if (exact) {
      matched.set(snap, exact);
      claimed.add(exact.id);
    }
  }
  for (const snap of snapshot) {
    if (heldKeys.has(key(snap.businessGroup, snap.code)) || matched.has(snap)) continue;
    const candidates = sapCandidates(snap);
    if (candidates.length > 1) {
      for (const c of candidates) protectedIds.add(c.id);
      heldSnapshots.set(snap, {
        kind: 'AMBIGUOUS',
        reason: `SAP code ${norm(snap.sapCode)} matches ${candidates.length} catalogue products (${candidates.map((c) => c.code).join(', ')}) and none has the code ${snap.code}; cannot tell which this row is`,
      });
      continue;
    }
    if (candidates.length === 1) {
      matched.set(snap, candidates[0]);
      claimed.add(candidates[0].id);
    }
  }
  for (const snap of snapshot) {
    const k = key(snap.businessGroup, snap.code);
    if (heldKeys.has(k) || matched.has(snap) || heldSnapshots.has(snap)) continue;
    const existing = byCode.get(k);
    if (existing && !claimed.has(existing.id)) {
      matched.set(snap, existing);
      claimed.add(existing.id);
    }
  }
  // A rename may only land on a code that is being vacated. If another product keeps that code
  // (it is not itself renamed), writing would violate the unique key, so the row is held and shown.
  // Holding one rename can make another's target stay occupied, so repeat until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [snap, existing] of [...matched.entries()]) {
      if (existing.code === snap.code) continue;
      const occupant = byCode.get(key(snap.businessGroup, snap.code));
      if (!occupant || occupant.id === existing.id) continue;
      const occupantMoves = [...matched.entries()].some(([s2, e2]) => e2.id === occupant.id && s2.code !== occupant.code);
      if (!occupantMoves) {
        matched.delete(snap);
        claimed.delete(existing.id);
        protectedIds.add(existing.id);
        protectedIds.add(occupant.id);
        heldSnapshots.set(snap, {
          kind: 'RENAME_BLOCKED',
          reason: `Code ${snap.code} is held by another product (SAP ${occupant.sapCode || '-'}) while SAP ${snap.sapCode} is product ${existing.code}; cannot rename over it`,
        });
        changed = true;
      }
    }
  }

  for (const snap of snapshot) {
    const k = key(snap.businessGroup, snap.code);
    if (heldKeys.has(k)) continue; // reported once, above

    const hold = heldSnapshots.get(snap);
    if (hold) {
      heldKeys.add(k);
      rows.push({ action: 'HELD', businessGroup: snap.businessGroup, code: snap.code, snapshot: snap, reason: hold.reason, holdKind: hold.kind });
      continue;
    }

    const existing = matched.get(snap);
    if (!existing) {
      rows.push({
        action: 'CREATE',
        businessGroup: snap.businessGroup,
        code: snap.code,
        snapshot: snap,
        next: nextStateFor(undefined, snap, true, false),
      });
      bg(snap.businessGroup).create += 1;
      continue;
    }

    if (existing.isActive) {
      const next = nextStateFor(existing, snap, true, false);
      const fieldChanges = changesBetween(existing, next);
      const action: RowAction = fieldChanges.length > 0 ? 'UPDATE' : 'UNCHANGED';
      rows.push({
        action,
        businessGroup: snap.businessGroup,
        code: snap.code,
        product: existing,
        snapshot: snap,
        ...(action === 'UPDATE' ? { next, fieldChanges } : {}),
        ...(existing.code !== snap.code ? { reason: `Code changes from ${existing.code}` } : {}),
      });
      if (action === 'UPDATE') bg(snap.businessGroup).update += 1;
      continue;
    }

    if (existing.retiredBySync) {
      const next = nextStateFor(existing, snap, true, false);
      rows.push({
        action: 'REACTIVATE',
        businessGroup: snap.businessGroup,
        code: snap.code,
        product: existing,
        snapshot: snap,
        next,
        fieldChanges: changesBetween(existing, next),
        reason: 'Retired by an earlier sync; the master carries it again',
      });
      bg(snap.businessGroup).reactivate += 1;
      continue;
    }

    // Deactivated by an admin: keep that decision, but keep the data current for when it is restored.
    const next = nextStateFor(existing, snap, false, false);
    const fieldChanges = changesBetween(existing, next);
    rows.push({
      action: 'KEEP_INACTIVE',
      businessGroup: snap.businessGroup,
      code: snap.code,
      product: existing,
      snapshot: snap,
      ...(fieldChanges.length > 0 ? { next, fieldChanges } : {}),
      reason: 'Deactivated by an admin, so it stays inactive',
    });
  }

  let manualRetire = 0;
  let protectedInvalid = 0;
  const groupsInFile = new Set(snapshot.map((s) => s.businessGroup));
  for (const row of catalogue) {
    if (!row.isActive || claimed.has(row.id) || protectedIds.has(row.id)) continue;
    // A file with no rows for a business group says nothing about that group.
    if (!groupsInFile.has(row.businessGroup)) continue;
    const k = key(row.businessGroup, row.code);
    if (heldKeys.has(k)) continue;
    if (invalidIds.has(row.id)) {
      protectedInvalid += 1;
      continue;
    }
    const skippedRow = skippedByKey.get(k);
    const manual = row.sourceSystem === 'manual';
    if (manual) manualRetire += 1;
    rows.push({
      action: 'RETIRE',
      businessGroup: row.businessGroup,
      code: row.code,
      product: row,
      next: {
        code: row.code,
        sapCode: row.sapCode,
        name: row.name,
        productNameLocal: row.productNameLocal,
        price: money(row.price),
        listPrice: money(row.listPrice),
        priceGroup: row.priceGroup,
        serviceFlag: row.serviceFlag,
        dchain: row.dchain,
        isActive: false,
        status: row.status,
        retiredBySync: true,
      },
      fieldChanges: [{ field: 'isActive', oldValue: true, newValue: false }],
      reason: skippedRow
        ? `Priced out of the master (${skippedRow.reason.toLowerCase()})`
        : manual
          ? 'Created in the app; not in the master'
          : 'Not in the master',
    });
    bg(row.businessGroup).retire += 1;
  }

  const count = (action: RowAction) => rows.filter((r) => r.action === action).length;
  const counts: SyncCounts = {
    read: input.read,
    kept: snapshot.length,
    skippedByRule: skipped.length,
    invalid: input.invalidRows,
    held: count('HELD'),
    create: count('CREATE'),
    update: count('UPDATE'),
    reactivate: count('REACTIVATE'),
    unchanged: count('UNCHANGED'),
    retire: count('RETIRE'),
    keepInactive: count('KEEP_INACTIVE'),
    manualRetire,
    protectedInvalid,
    perBusinessGroup,
  };

  return { rows, counts };
}

/** Stable digest of the snapshot, so an apply can prove it ran on the rows that were previewed. */
export function snapshotFingerprint(snapshot: SnapshotRow[], skipped: SkippedKey[], held: HeldKey[]): string {
  const lines = [
    ...snapshot.map(
      (s) =>
        `K|${s.businessGroup}|${s.code}|${s.sapCode}|${s.name}|${s.productNameLocal}|${money(s.price)}|${money(s.listPrice)}|${s.priceGroup ?? '~'}|${s.serviceFlag ?? '~'}|${s.dchain ?? '~'}`
    ),
    ...skipped.map((s) => `S|${s.businessGroup}|${s.code}`),
    ...held.map((h) => `H|${h.businessGroup}|${h.code}`),
  ].sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Stable digest of what an apply would write. Recomputed at apply time and compared. */
export function planFingerprint(rows: PlannedRow[]): string {
  const lines = rows
    .filter((r) => r.action !== 'UNCHANGED' && r.action !== 'SKIPPED' && r.action !== 'HELD' && r.action !== 'INVALID')
    .map(
      (r) =>
        `${r.action}|${r.businessGroup}|${r.code}|${r.product?.id ?? '-'}|${JSON.stringify(r.next ?? null)}`
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
