/**
 * The Power BI master rules, pinned.
 *
 *   npx ts-node src/services/import/validate-products.test.ts
 */
import assert from 'node:assert/strict';

import type { Row } from './parser';
import { NOT_POWER_BI_MESSAGE, appliedFilterFromRow, roundMoney, validateProductRows } from './validate-products';

const H = ['BU', 'MaterialNumber', 'GS1', 'MaterialName', 'ListPrice', 'ContractPrice', 'PricingG', 'PriceRate', 'DCHAIN', 'ServiceFlag'] as const;

function pbi(...cells: Array<string | number>): Row {
  const row: Row = {};
  H.forEach((h, i) => (row[h] = cells[i] ?? ''));
  return row;
}

const FOOTER: Row = { BU: 'Applied filters:\nDCHAIN is Y5, Y6, Y7, or Y9', MaterialNumber: '', GS1: '', MaterialName: '', ListPrice: '', ContractPrice: '', PricingG: '', PriceRate: '', DCHAIN: '', ServiceFlag: '' };

// Footer row is metadata, not a product
{
  assert.equal(appliedFilterFromRow(FOOTER), 'DCHAIN is Y5, Y6, Y7, or Y9');
  assert.equal(appliedFilterFromRow(pbi('CDG', '001000', '01000', 'BB-1000', 38000000, '', '', '', 'Y5', 'Non-Service')), null);
  const v = validateProductRows([pbi('CDG', '001000', '01000', 'BB-1000', 38000000, '', '', '', 'Y5', 'Non-Service'), FOOTER]);
  assert.equal(v.powerBi, true);
  assert.equal(v.appliedFilter, 'DCHAIN is Y5, Y6, Y7, or Y9');
  assert.equal(v.validRows.length, 1);
  assert.equal(v.skipped.length, 0, 'the footer is not a skipped row');
  assert.equal(v.errors.length, 0);
}

// GS1 is the CDG code, with its leading zeros; blank falls back to the SAP code; LSG ignores GS1
{
  const v = validateProductRows([
    pbi('CDG', '001129VJ48', '01129', 'ﾏｲｸﾛﾀｲﾋﾟﾝｸﾞｼｽﾃﾑ ABDｶｰﾄﾞ', 19200, 13440, '503_DiaMed and other', 0.7, 'Y5', 'Non-Service'),
    pbi('CDG', '009010', '', 'IH-Com kit', 48000, '', '', '', 'Y5', 'Non-Service'),
    pbi('LSG', '12001045', '01045', 'DG-200 Droplet Reader IVD', 16000000, '', '', '', 'Y5', 'Non-Service'),
  ]);
  assert.equal(v.errors.length, 0);
  const [a, b, c] = v.validRows;
  assert.equal(a.code, '01129', 'the leading zero is kept');
  assert.equal(a.sapCode, '001129VJ48');
  assert.equal(a.name, a.productNameLocal, 'MaterialName fills both names');
  assert.equal(b.code, '009010', 'blank GS1 -> SAP code');
  assert.equal(b.sapCode, '009010');
  assert.equal(c.code, '12001045', 'LSG product code is the SAP code even when a GS1 is present');
}

// A GS1 that is not five digits is kept as it is (8 Oct 2026) - on CDG and on LSG alike
{
  const v = validateProductRows([
    pbi('CDG', '001000', '1000', 'BB-1000', 38000000, '', '', '', 'Y5', 'Non-Service'),
    pbi('CDG', '009201', '009899S', 'BB-500', 822000, '', '', '', 'Y5', 'Non-Service'),
    pbi('LSG', '12001045', 'X-1', 'DG-200 Droplet Reader IVD', 16000000, '', '', '', 'Y5', 'Non-Service'),
  ]);
  assert.equal(v.errors.length, 0);
  assert.deepEqual(v.validRows.map((r) => r.code), ['1000', '009899S', '12001045']);
}

// List price 0 / 1 / blank skips the row; a non-numeric list price is an ERROR, reported with its keys
{
  const v = validateProductRows([
    pbi('LSG', 'A', '', 'Zero', 0, '', '', '', 'Y5', 'Non-Service'),
    pbi('LSG', 'B', '', 'One', 1, '', '', '', 'Y5', 'Non-Service'),
    pbi('LSG', 'C', '', 'Blank', '', '', '', '', 'Y5', 'Non-Service'),
    pbi('CDG', 'D-SAP', '00777', 'Broken', '#ERROR', '', '', '', 'Y5', 'Non-Service'),
    pbi('LSG', 'E', '', 'Fine', 1000, '', '', '', 'Y5', 'Non-Service'),
  ]);
  assert.deepEqual(v.skipped.map((s) => [s.code, s.reason]), [['A', 'List price 0'], ['B', 'List price 1'], ['C', 'List price blank']]);
  assert.equal(v.errors.length, 1);
  assert.equal(v.errors[0].column, 'ListPrice');
  assert.deepEqual(v.validRows.map((r) => r.code), ['E']);
  assert.deepEqual(
    v.invalid.map((i) => [i.businessGroup, i.code, i.sapCode]),
    [['CDG', '00777', 'D-SAP']],
    'the invalid row is reported by the keys its product would match on'
  );
}

// Contract price blank copies the list price; PricingG/ServiceFlag/DCHAIN are carried
{
  const v = validateProductRows([
    pbi('LSG', 'A', '', 'Copy', 1000, '', '303_LIFE 15% fixed p', '', 'Y9', 'Service'),
    pbi('LSG', 'B', '', 'Keep', 1000, 850, '', 0.85, 'y5', 'Non-Service'),
  ]);
  const [a, b] = v.validRows;
  assert.equal(a.price, 1000);
  assert.equal(a.listPrice, 1000);
  assert.equal(a.priceGroup, '303_LIFE 15% fixed p');
  assert.equal(a.serviceFlag, 'Service');
  assert.equal(a.dchain, 'Y9');
  assert.equal(b.price, 850);
  assert.equal(b.priceGroup, '', 'a blank PricingG is carried as blank: the master clears the stored group');
  assert.equal(b.dchain, 'Y5', 'DCHAIN is upper-cased');
}

// A file without the PricingG column says nothing about price groups
{
  const row: Row = { BU: 'LSG', MaterialNumber: 'A', GS1: '', MaterialName: 'No group column', ListPrice: 1000, ContractPrice: 900 };
  const v = validateProductRows([row]);
  assert.equal(v.validRows[0].priceGroup, undefined);
  assert.equal(v.validRows[0].serviceFlag, undefined);
}

// Rounding: float noise and real fractions both land on two decimals, half-up
{
  assert.equal(roundMoney(15119.999999999998), 15120);
  assert.equal(roundMoney(1179.425), 1179.43);
  assert.equal(roundMoney(422.75), 422.75);
  const v = validateProductRows([pbi('LSG', 'A', '', 'Noise', 15119.999999999998, 23431.75, '', '', 'Y5', 'Non-Service')]);
  assert.equal(v.validRows[0].listPrice, 15120);
  assert.equal(v.validRows[0].price, 23431.75);
}

// Collision: a Non-Service GS1 equal to a Service row's SAP code is reported
{
  const v = validateProductRows([
    pbi('CDG', '12009704', '92466', 'ImmunoReader mini PC', 100000, '', '', '', 'Y5', 'Non-Service'),
    pbi('CDG', '92466', '', 'ImmunoReader Camera Support PC', 208200, '', '', '', 'Y5', 'Service'),
  ]);
  assert.equal(v.duplicates.length, 1);
  assert.deepEqual(v.duplicates[0].rows, [2, 3]);
}

// Any other layout is refused outright: the Power BI master is the only way products come in
{
  const v = validateProductRows([{ 'Product Code': '0016-0104', 'Product Name': 'SP a-ACETAMINOPHEN', 'List Price': '72,100', 'Contract Price': '57,680', 'Price Group': '101_LIFE reagent' }]);
  assert.equal(v.powerBi, false);
  assert.equal(v.validRows.length, 0);
  assert.equal(v.errors.length, 1);
  assert.equal(v.errors[0].message, NOT_POWER_BI_MESSAGE);
}

console.log('validate-products.test.ts: all tests passed');
