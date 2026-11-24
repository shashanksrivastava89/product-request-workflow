/**
 * Planner rules, each pinned with hand-made rows. No database.
 *
 *   npx ts-node src/services/product-sync/diff.test.ts
 */
import assert from 'node:assert/strict';

import { planFingerprint, planSync, type CatalogueRow, type SnapshotRow } from './diff';

function cat(over: Partial<CatalogueRow> & { code: string }): CatalogueRow {
  return {
    id: `id-${over.businessGroup ?? 'LSG'}-${over.code}`,
    businessGroup: 'LSG',
    sapCode: over.code,
    name: `Name ${over.code}`,
    productNameLocal: `Name ${over.code}`,
    price: 800,
    listPrice: 1000,
    priceGroup: '101_LIFE reagent',
    serviceFlag: 'Non-Service',
    dchain: 'Y5',
    isActive: true,
    status: 'APPROVED',
    sourceSystem: 'import',
    retiredBySync: false,
    ...over,
  };
}

function snap(over: Partial<SnapshotRow> & { code: string }): SnapshotRow {
  return {
    businessGroup: 'LSG',
    sapCode: over.code,
    name: `Name ${over.code}`,
    productNameLocal: `Name ${over.code}`,
    price: 800,
    listPrice: 1000,
    priceGroup: '101_LIFE reagent',
    serviceFlag: 'Non-Service',
    dchain: 'Y5',
    rowIndex: 2,
    ...over,
  };
}

const run = (
  snapshot: SnapshotRow[],
  catalogue: CatalogueRow[],
  extra: Partial<Parameters<typeof planSync>[0]> = {}
) =>
  planSync({
    snapshot,
    skipped: [],
    held: [],
    catalogue,
    read: snapshot.length,
    invalidRows: 0,
    ...extra,
  });

const actions = (rows: ReturnType<typeof planSync>['rows']) =>
  Object.fromEntries(rows.map((r) => [`${r.businessGroup}|${r.code}`, r.action]));

// Create / update / unchanged / retire
{
  const plan = run(
    [snap({ code: 'A' }), snap({ code: 'B', price: 850 }), snap({ code: 'NEW' })],
    [cat({ code: 'A' }), cat({ code: 'B' }), cat({ code: 'GONE' })]
  );
  assert.deepEqual(actions(plan.rows), { 'LSG|A': 'UNCHANGED', 'LSG|B': 'UPDATE', 'LSG|NEW': 'CREATE', 'LSG|GONE': 'RETIRE' });
  const b = plan.rows.find((r) => r.code === 'B')!;
  assert.deepEqual(b.fieldChanges, [{ field: 'price', oldValue: 800, newValue: 850 }]);
  assert.equal(plan.rows.find((r) => r.code === 'GONE')!.reason, 'Not in the master');
  assert.equal(plan.counts.create, 1);
  assert.equal(plan.counts.update, 1);
  assert.equal(plan.counts.unchanged, 1);
  assert.equal(plan.counts.retire, 1);
  assert.equal(plan.counts.perBusinessGroup.LSG.activeBefore, 3);
}

// A code the master priced out is retired with that reason
{
  const plan = run([snap({ code: 'A' })], [cat({ code: 'A' }), cat({ code: 'CHEAP' })], {
    skipped: [{ businessGroup: 'LSG', code: 'CHEAP', reason: 'List price 1' }],
  });
  // The file's row is reported under SKIPPED and the catalogue's row under RETIRE: two views of one code.
  assert.ok(plan.rows.some((r) => r.code === 'CHEAP' && r.action === 'SKIPPED'));
  const r = plan.rows.find((r) => r.code === 'CHEAP' && r.action === 'RETIRE')!;
  assert.ok(r, 'the priced-out catalogue row is retired');
  assert.match(r.reason!, /priced out/i);
  assert.equal(plan.counts.skippedByRule, 1);
  assert.equal(plan.counts.retire, 1);
}

// The master is the only source: a hand-created product it does not carry is removed too, said so;
// a held code is neither written nor removed
{
  const plan = run([snap({ code: 'A' })], [cat({ code: 'A' }), cat({ code: 'MANUAL', sourceSystem: 'manual' }), cat({ code: 'CLASH' })], {
    held: [{ businessGroup: 'LSG', code: 'CLASH', reason: 'two rows', rowIndex: 7 }],
  });
  const acts = actions(plan.rows);
  assert.equal(acts['LSG|MANUAL'], 'RETIRE');
  assert.equal(plan.rows.find((r) => r.code === 'MANUAL')!.reason, 'Created in the app; not in the master');
  assert.equal(plan.counts.manualRetire, 1);
  const clash = plan.rows.find((r) => r.code === 'CLASH')!;
  assert.equal(clash.action, 'HELD');
  assert.equal(clash.holdKind, 'COLLISION');
  assert.equal(clash.rowIndex, 7, 'a collision keeps its file row');
  assert.equal(plan.counts.retire, 1);
}

// Two rows on one SAP code: the one with the file's code IS the product; the stale duplicate goes.
// UAT, 8 Oct 2026: SAP 001129VJ48 is the Power BI row 01129 (19,200 yen) and an early load's 1129 (list 0).
{
  const catalogue = [
    cat({ businessGroup: 'CDG', code: '01129', sapCode: '001129VJ48', listPrice: 19200, price: 13440 }),
    cat({ businessGroup: 'CDG', code: '1129', sapCode: '001129VJ48', listPrice: 0, price: 13440 }),
  ];
  const file = [snap({ businessGroup: 'CDG', code: '01129', sapCode: '001129VJ48', listPrice: 19200, price: 13440 })];
  const plan = run(file, catalogue);
  assert.equal(actions(plan.rows)['CDG|01129'], 'UNCHANGED', 'the Power BI row is matched, not held');
  const stale = plan.rows.find((r) => r.code === '1129')!;
  assert.equal(stale.action, 'RETIRE');
  assert.equal(stale.reason, 'Not in the master');
  assert.equal(plan.counts.held, 0);
  // Once removed (inactive, retiredBySync), the stale row is simply left alone.
  const after = run(file, [catalogue[0], { ...catalogue[1], isActive: false, retiredBySync: true }]);
  assert.equal(after.counts.retire, 0);
  assert.equal(after.counts.held, 0);
  assert.equal(after.rows.filter((r) => r.code === '1129').length, 0);
}

// A removed product whose SAP code comes back under a new code is renamed and comes back, history kept
{
  const plan = run(
    [snap({ businessGroup: 'CDG', code: '01129', sapCode: '001129VJ48' })],
    [cat({ businessGroup: 'CDG', code: '1129', sapCode: '001129VJ48', isActive: false, retiredBySync: true })]
  );
  const r = plan.rows[0];
  assert.equal(r.action, 'REACTIVATE');
  assert.equal(r.product!.code, '1129');
  assert.equal(r.next!.code, '01129');
}

// A file row that failed validation protects the product it points at, by code and by SAP code
{
  const plan = run([snap({ code: 'A' })], [cat({ code: 'A' }), cat({ code: 'BROKEN' }), cat({ code: 'OLD', sapCode: 'S9' })], {
    invalid: [
      { businessGroup: 'LSG', code: 'BROKEN', sapCode: 'BROKEN', reason: 'ListPrice: Must be a non-negative number (#ERROR)', rowIndex: 4 },
      { businessGroup: 'LSG', code: 'NEWCODE', sapCode: 'S9', reason: 'ListPrice: Must be a non-negative number (n/a)', rowIndex: 5 },
    ],
    invalidRows: 2,
  });
  assert.equal(plan.counts.retire, 0, 'nothing is removed because its row was unreadable');
  assert.equal(plan.counts.protectedInvalid, 2);
  assert.equal(plan.counts.invalid, 2);
  assert.deepEqual(
    plan.rows.filter((r) => r.action === 'INVALID').map((r) => [r.code, r.sapCode, r.rowIndex]),
    [['BROKEN', 'BROKEN', 4], ['NEWCODE', 'S9', 5]]
  );
}

// Only a sync-retired product comes back; an admin's deactivation stands (but data is refreshed)
{
  const plan = run(
    [snap({ code: 'R', price: 900 }), snap({ code: 'ADM', price: 900 })],
    [cat({ code: 'R', isActive: false, retiredBySync: true }), cat({ code: 'ADM', isActive: false, retiredBySync: false })]
  );
  const r = plan.rows.find((r) => r.code === 'R')!;
  assert.equal(r.action, 'REACTIVATE');
  assert.equal(r.next!.isActive, true);
  assert.equal(r.next!.retiredBySync, false);
  const a = plan.rows.find((r) => r.code === 'ADM')!;
  assert.equal(a.action, 'KEEP_INACTIVE');
  assert.equal(a.next!.isActive, false);
  assert.deepEqual(a.fieldChanges, [{ field: 'price', oldValue: 800, newValue: 900 }]);
}

// A GS1 filled in later: the SAP code finds the row, the code is renamed, nothing is retired
{
  const plan = run(
    [snap({ businessGroup: 'CDG', code: '90135', sapCode: '009010' })],
    [cat({ businessGroup: 'CDG', code: '009010', sapCode: '009010' })]
  );
  const r = plan.rows[0];
  assert.equal(r.action, 'UPDATE');
  assert.equal(r.product!.code, '009010');
  assert.equal(r.next!.code, '90135');
  assert.ok(r.fieldChanges!.some((c) => c.field === 'code' && c.oldValue === '009010' && c.newValue === '90135'));
  assert.equal(plan.counts.retire, 0);
}

// A GS1 hand-over: material 91503 gains GS1 30030 while another material's GS1 is 91503.
// The row keeps its identity (renamed), the other is new - in either file order.
{
  const catalogue = [cat({ businessGroup: 'CDG', code: '91503', sapCode: '91503' })];
  const a = snap({ businessGroup: 'CDG', code: '30030', sapCode: '91503' });
  const b = snap({ businessGroup: 'CDG', code: '91503', sapCode: '12009704' });
  for (const order of [[a, b], [b, a]]) {
    const plan = run(order, catalogue);
    const acts = actions(plan.rows);
    assert.equal(acts['CDG|30030'], 'UPDATE', 'material 91503 is renamed to its GS1');
    assert.equal(acts['CDG|91503'], 'CREATE', 'the other material is new');
    assert.equal(plan.counts.retire, 0);
    assert.equal(planFingerprint(plan.rows), planFingerprint(run([a, b], catalogue).rows), 'same plan whatever the order');
  }
}

// A rename onto a code another product keeps cannot be written, so it is held and both rows are protected
{
  const plan = run(
    [snap({ businessGroup: 'CDG', code: 'X', sapCode: 'S2' })],
    [cat({ businessGroup: 'CDG', code: 'X', sapCode: 'S1' }), cat({ businessGroup: 'CDG', code: 'Y', sapCode: 'S2' })]
  );
  assert.equal(plan.rows.find((r) => r.code === 'X')!.action, 'HELD');
  assert.equal(plan.counts.retire, 0, 'neither catalogue row is retired');
  assert.equal(plan.counts.create, 0);
}

// Two catalogue rows with the same SAP code and neither carries the file's code: ambiguous, so held
{
  const plan = run(
    [snap({ businessGroup: 'CDG', code: '90135', sapCode: 'S1' })],
    [cat({ businessGroup: 'CDG', code: 'X1', sapCode: 'S1' }), cat({ businessGroup: 'CDG', code: 'X2', sapCode: 'S1' })]
  );
  const held = plan.rows.find((r) => r.code === '90135')!;
  assert.equal(held.action, 'HELD');
  assert.equal(held.holdKind, 'AMBIGUOUS');
  assert.equal(plan.counts.retire, 0, 'the ambiguous rows are not removed either');
}

// A business unit absent from the file is left alone
{
  const cdgOnly = run([snap({ businessGroup: 'CDG', code: '12000' })], [cat({ code: 'LSG-ONLY' })]);
  assert.equal(cdgOnly.counts.retire, 0, 'no LSG rows in the file says nothing about LSG');
}

// Money compares after rounding; a column the file does not have keeps the stored value; a blank
// one clears it (the master is the source)
{
  const plan = run([snap({ code: 'A', price: 1179.425, priceGroup: undefined, serviceFlag: undefined, dchain: undefined })], [cat({ code: 'A', price: 1179.43 })]);
  assert.equal(plan.rows[0].action, 'UNCHANGED');
  const plan2 = run([snap({ code: 'A', price: 1179.43, priceGroup: undefined })], [cat({ code: 'A', price: 1179.43, priceGroup: '303_LIFE 15% fixed p' })]);
  assert.equal(plan2.rows[0].action, 'UNCHANGED', 'priceGroup absent from the file is left alone');
  const plan3 = run([snap({ code: 'A', price: 1179.43, priceGroup: '' })], [cat({ code: 'A', price: 1179.43, priceGroup: '303_LIFE 15% fixed p' })]);
  assert.equal(plan3.rows[0].action, 'UPDATE');
  assert.deepEqual(plan3.rows[0].fieldChanges, [{ field: 'priceGroup', oldValue: '303_LIFE 15% fixed p', newValue: null }]);
}

// A non-approved matched row is brought to APPROVED (the rule the bulk import always applied)
{
  const plan = run([snap({ code: 'P' })], [cat({ code: 'P', status: 'PENDING_APPROVAL' })]);
  assert.equal(plan.rows[0].action, 'UPDATE');
  assert.deepEqual(plan.rows[0].fieldChanges, [{ field: 'status', oldValue: 'PENDING_APPROVAL', newValue: 'APPROVED' }]);
}

// Fingerprint: same plan, same digest; an unrelated unchanged row does not move it
{
  const a = run([snap({ code: 'A', price: 850 }), snap({ code: 'B' })], [cat({ code: 'A' }), cat({ code: 'B' })]);
  const b = run([snap({ code: 'B' }), snap({ code: 'A', price: 850 })], [cat({ code: 'B' }), cat({ code: 'A' })]);
  assert.equal(planFingerprint(a.rows), planFingerprint(b.rows));
  const c = run([snap({ code: 'A', price: 851 }), snap({ code: 'B' })], [cat({ code: 'A' }), cat({ code: 'B' })]);
  assert.notEqual(planFingerprint(a.rows), planFingerprint(c.rows));
}

console.log('diff.test.ts: all tests passed');
