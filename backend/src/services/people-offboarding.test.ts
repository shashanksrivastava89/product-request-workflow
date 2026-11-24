/**
 * The matching rules behind "remove a person who left", pinned with hand-made rows. No database.
 *
 *   npx ts-node src/services/people-offboarding.test.ts
 */
import assert from 'node:assert/strict';

import { normalizeNameForMatch } from './named-requester.service';
import { MAPPING_TABLES, managerLinksTo, sameName, splitMappingRows } from './people-offboarding.service';

const key = normalizeNameForMatch('MAIRTIN YODER');

// Spelling differences the tables really carry: case, an ideographic space, doubled spaces.
assert.equal(sameName('MAIRTIN YODER', key), true);
assert.equal(sameName('Mairtin Yoder', key), true);
assert.equal(sameName('MAIRTIN　YODER', key), true);
assert.equal(sameName('  MAIRTIN   YODER ', key), true);
assert.equal(sameName('MAIRTIN YOSHIDAX', key), false);
assert.equal(sameName(null, key), false);
assert.equal(sameName(undefined, key), false);

const returnSpec = MAPPING_TABLES.find((t) => t.key === 'return')!;
const rows = [
  { id: 'own', requesterName: 'MAIRTIN YODER', businessUnit: 'CDG', teamName: 'SHUTO1D', secondApprover: null },
  { id: 'dsm', requesterName: 'KARYN EARLE', businessUnit: 'CDG', teamName: 'SHUTO1D', secondApprover: 'MAIRTIN YODER' },
  {
    id: 'twice',
    requesterName: 'GEORGINA HESSION',
    businessUnit: 'CDG',
    teamName: 'HOKKAIDO/TOHOKU',
    firstApprover: 'Mairtin　Yoder',
    secondApprover: 'MAIRTIN YODER',
  },
  { id: 'other', requesterName: 'DUSTIN KILLORAN', businessUnit: 'CDG', teamName: 'HOKKAIDO/TOHOKU', secondApprover: 'CAILUM CORTEZ' },
];
const split = splitMappingRows(rows, returnSpec.approverColumns, key);
assert.deepEqual(
  split.asRequester.map((r) => r.id),
  ['own'],
  "the person's own row is listed as theirs, not as an approver row"
);
assert.deepEqual(
  split.asApprover.map(({ row, columns }) => [row.id, columns]),
  [
    ['dsm', ['secondApprover']],
    ['twice', ['firstApprover', 'secondApprover']],
  ],
  'every column holding the name is reported, in column order'
);

// Manager links: the foreign key to one of the person's accounts, or the legacy name column.
const accountIds = new Set(['u-yoder']);
assert.deepEqual(
  managerLinksTo({ districtSalesManagerId: 'u-yoder', districtSalesManager: 'MAIRTIN YODER' }, accountIds, key),
  ['districtSalesManagerId', 'districtSalesManager']
);
assert.deepEqual(managerLinksTo({ salesManagerId: 'u-other', salesManager: 'SOMEONE ELSE' }, accountIds, key), []);
assert.deepEqual(managerLinksTo({ nationalSalesManager: 'mairtin yoder' }, accountIds, key), ['nationalSalesManager']);

// Every mapping table writes a successor the way its importer does.
const sample = MAPPING_TABLES.find((t) => t.key === 'zsam')!;
assert.equal(sample.writeName('Cailum　Cortez'), 'CAILUM CORTEZ');
assert.equal(returnSpec.writeName('Cailum Cortez'), 'CAILUM CORTEZ');
assert.equal(returnSpec.writeName('japan_cus_care_pro_op@example.com'), 'japan_cus_care_pro_op@example.com');

console.log('people-offboarding: ok');
