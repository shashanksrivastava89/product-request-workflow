/**
 * The round trip the apply depends on: plan, store the rows, read them back, plan again - against the
 * same catalogue that must give the same fingerprint, or every apply is refused as "the catalogue
 * changed". No database.
 *
 *   npx ts-node src/services/product-sync/run-rows.test.ts
 */
import assert from 'node:assert/strict';

import { planFingerprint, planSync, type CatalogueRow, type PlanInput, type SnapshotRow } from './diff';
import { storedRowsFrom, toRunRow } from './run-rows';

function cat(over: Partial<CatalogueRow> & { code: string }): CatalogueRow {
  return {
    id: `id-${over.businessGroup ?? 'CDG'}-${over.code}`,
    businessGroup: 'CDG',
    sapCode: over.code,
    name: `Name ${over.code}`,
    productNameLocal: `Name ${over.code}`,
    price: 800,
    listPrice: 1000,
    priceGroup: '503_DiaMed and other',
    serviceFlag: 'Non-Service',
    dchain: 'Y5',
    isActive: true,
    status: 'APPROVED',
    sourceSystem: 'import',
    retiredBySync: false,
    ...over,
  };
}

function snap(over: Partial<SnapshotRow> & { code: string }, rowIndex: number): SnapshotRow {
  return {
    businessGroup: 'CDG',
    sapCode: over.code,
    name: `Name ${over.code}`,
    productNameLocal: `Name ${over.code}`,
    price: 800,
    listPrice: 1000,
    priceGroup: '',
    serviceFlag: 'Non-Service',
    dchain: 'Y5',
    rowIndex,
    ...over,
  };
}

/** Preview -> stored rows -> apply's re-plan, against one catalogue. */
function roundTrip(input: Omit<PlanInput, 'read' | 'invalidRows'>) {
  const full = { ...input, read: input.snapshot.length, invalidRows: input.invalid?.length ?? 0 };
  const preview = planSync(full);
  const stored = storedRowsFrom(preview.rows.map((r, i) => ({ id: `row-${i}`, ...toRunRow('run', r) })));
  const apply = planSync({
    snapshot: stored.snapshot,
    skipped: stored.skipped,
    held: stored.held,
    invalid: stored.invalid,
    catalogue: input.catalogue,
    read: full.read,
    invalidRows: full.invalidRows,
  });
  return { preview, apply };
}

// Every kind of hold, an invalid row, a skipped row, a removal and a blank price group in one file
{
  const catalogue = [
    // ambiguous: two rows on SAP S1, neither with the file's code
    cat({ code: 'X1', sapCode: 'S1' }),
    cat({ code: 'X2', sapCode: 'S1' }),
    // blocked rename: SAP S3 is product Y, but code X3 belongs to another product that stays
    cat({ code: 'X3', sapCode: 'S2' }),
    cat({ code: 'Y', sapCode: 'S3' }),
    // collision in the file on code C
    cat({ code: 'C' }),
    // invalid row points at this one
    cat({ code: 'BAD' }),
    // removed: not in the file
    cat({ code: 'GONE' }),
    // priced out in the file
    cat({ code: 'CHEAP' }),
    // a price group the file blanks
    cat({ code: 'PG', priceGroup: '503_DiaMed and other' }),
  ];
  const snapshot = [snap({ code: '90135', sapCode: 'S1' }, 2), snap({ code: 'X3', sapCode: 'S3' }, 3), snap({ code: 'PG' }, 4)];
  const { preview, apply } = roundTrip({
    snapshot,
    skipped: [{ businessGroup: 'CDG', code: 'CHEAP', reason: 'List price 0', rowIndex: 5 }],
    held: [{ businessGroup: 'CDG', code: 'C', reason: 'Rows 6, 7 all resolve to this code', rowIndex: 6 }],
    invalid: [{ businessGroup: 'CDG', code: 'BAD', sapCode: 'BAD', reason: 'ListPrice: Must be a non-negative number (#N/A)', rowIndex: 8 }],
    catalogue,
  });

  const kinds = Object.fromEntries(preview.rows.filter((r) => r.action === 'HELD').map((r) => [r.code, r.holdKind]));
  assert.deepEqual(kinds, { C: 'COLLISION', '90135': 'AMBIGUOUS', X3: 'RENAME_BLOCKED' });
  assert.deepEqual(
    preview.rows.filter((r) => r.action === 'RETIRE').map((r) => r.code).sort(),
    ['CHEAP', 'GONE'],
    'held, ambiguous and invalid products are protected; the rest go'
  );
  assert.equal(planFingerprint(apply.rows), planFingerprint(preview.rows), 'the apply plans exactly what the preview showed');
  assert.deepEqual(apply.counts, preview.counts);
}

// A run stored before holdKind existed reads back the same way (collision = the hold with no name)
{
  const catalogue = [cat({ code: 'X1', sapCode: 'S1' }), cat({ code: 'X2', sapCode: 'S1' }), cat({ code: 'C' })];
  const preview = planSync({
    snapshot: [snap({ code: '90135', sapCode: 'S1' }, 2)],
    skipped: [],
    held: [{ businessGroup: 'CDG', code: 'C', reason: 'two rows', rowIndex: 3 }],
    catalogue,
    read: 3,
    invalidRows: 0,
  });
  const legacyRows = preview.rows.map((r, i) => ({ id: `row-${i}`, ...toRunRow('run', r), holdKind: null }));
  const stored = storedRowsFrom(legacyRows);
  assert.deepEqual(stored.held.map((h) => h.code), ['C']);
  assert.deepEqual(stored.snapshot.map((s) => s.code), ['90135']);
}

console.log('run-rows.test.ts: all tests passed');
