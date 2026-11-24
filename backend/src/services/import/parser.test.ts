/**
 * Code cells keep their leading zeros: a GS1 typed into Excel as a number and shown through a 00000
 * format is read as Excel shows it, not as the bare number.
 *
 *   npx ts-node src/services/import/parser.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

import { parseImportFile, zeroPaddedCellText } from './parser';

// The rule on its own
{
  assert.equal(zeroPaddedCellText({ t: 'n', v: 1129, w: '01129' }), '01129');
  assert.equal(zeroPaddedCellText({ t: 'n', v: 1129, w: '1129' }), undefined, 'General format: nothing to recover');
  assert.equal(zeroPaddedCellText({ t: 'n', v: 19200, w: '19,200' }), undefined, 'a price is never rewritten');
  assert.equal(zeroPaddedCellText({ t: 'n', v: 12345678901234, w: '1.23457E+13' }), undefined);
  assert.equal(zeroPaddedCellText({ t: 's', v: '01129', w: '01129' }), undefined, 'text cells are already right');
}

// Through a real workbook: a number cell under GS1 with a 00000 format; the price beside it untouched
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['BU', 'MaterialNumber', 'GS1', 'MaterialName', 'ListPrice'],
    ['CDG', '001129VJ48', 1129, 'ABD card', 19200],
    ['CDG', 9819, '', 'Wash Solution B', 1129],
  ]);
  ws['C2'].z = '00000';
  ws['B3'].z = '000000';
  ws['E3'].z = '00000';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const file = path.join(os.tmpdir(), `parser-test-${process.pid}.xlsx`);
  fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  try {
    const plain = parseImportFile(file, 'xlsx');
    assert.equal(plain.rows[0]['GS1'], '1129', 'without textColumns the raw value is read, as before');
    const { rows } = parseImportFile(file, 'xlsx', { textColumns: ['GS1', 'MaterialNumber'] });
    assert.equal(rows[0]['GS1'], '01129');
    assert.equal(rows[0]['MaterialNumber'], '001129VJ48');
    assert.equal(rows[1]['MaterialNumber'], '009819');
    assert.equal(rows[1]['ListPrice'], '1129', 'a column that is not a code column reads the raw value');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

console.log('parser.test.ts: all tests passed');
