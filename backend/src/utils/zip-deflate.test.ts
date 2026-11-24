/**
 * The zlib re-pack of an .xlsx reads back cell for cell, and is much smaller.
 *
 *   npx ts-node src/utils/zip-deflate.test.ts [an.xlsx]
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import zlib from 'zlib';
import * as XLSX from 'xlsx';

import { deflateZip } from './zip-deflate';

const rows: unknown[][] = [['BU', 'MaterialNumber', 'GS1', 'MaterialName', 'ListPrice']];
for (let i = 0; i < 5000; i++) rows.push([i % 2 ? 'CDG' : 'LSG', `00${1000 + i}VJ48`, `0${1000 + i}`, `ﾏｲｸﾛﾀｲﾋﾟﾝｸﾞｼｽﾃﾑ ABDｶｰﾄﾞ ${i}`, 19200 + i]);
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['C2'].z = '@';
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Export');

const stored = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: false }) as Buffer;
const sheetjs = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
const packed = deflateZip(stored);
console.log(`stored ${stored.length} B, SheetJS deflate ${sheetjs.length} B, zlib ${packed.length} B`);
assert.ok(packed.length < sheetjs.length / 2, 'zlib beats SheetJS by a wide margin');

const back = XLSX.read(packed, { type: 'buffer', cellNF: true });
const backWs = back.Sheets[back.SheetNames[0]];
assert.deepEqual(XLSX.utils.sheet_to_json(backWs, { header: 1 }), XLSX.utils.sheet_to_json(ws, { header: 1 }), 'every cell reads back');
assert.equal(backWs['C2'].z, '@', 'the text format survives');

// Every entry's CRC still matches its content (a reader that checks CRCs would refuse otherwise).
{
  let p = packed.length - 22;
  while (packed.readUInt32LE(p) !== 0x06054b50) p--;
  const count = packed.readUInt16LE(p + 10);
  let c = packed.readUInt32LE(p + 16);
  const table = new Int32Array(256).map((_, n) => {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v;
  });
  const crc32 = (buf: Buffer) => {
    let v = -1;
    for (const b of buf) v = table[(v ^ b) & 0xff] ^ (v >>> 8);
    return (v ^ -1) >>> 0;
  };
  for (let n = 0; n < count; n++) {
    const crc = packed.readUInt32LE(c + 16);
    const comp = packed.readUInt32LE(c + 20);
    const nameLen = packed.readUInt16LE(c + 28);
    const local = packed.readUInt32LE(c + 42);
    const start = local + 30 + packed.readUInt16LE(local + 26) + packed.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(packed.subarray(start, start + comp));
    assert.equal(crc32(data), crc, `CRC of ${packed.subarray(c + 46, c + 46 + nameLen).toString()}`);
    c += 46 + nameLen + packed.readUInt16LE(c + 30) + packed.readUInt16LE(c + 32);
  }
}

// Optionally, a real file: re-packed, it must read back the same.
const real = process.argv[2];
if (real && fs.existsSync(real)) {
  const original = XLSX.read(fs.readFileSync(real), { type: 'buffer' });
  const repacked = deflateZip(XLSX.write(original, { type: 'buffer', bookType: 'xlsx', compression: false }) as Buffer);
  const a = XLSX.utils.sheet_to_json(original.Sheets[original.SheetNames[0]], { header: 1 });
  const b = XLSX.utils.sheet_to_json(XLSX.read(repacked, { type: 'buffer' }).Sheets[original.SheetNames[0]], { header: 1 });
  assert.deepEqual(b, a);
  console.log(`${real}: ${fs.statSync(real).size} B -> ${repacked.length} B, ${a.length} rows identical`);
}

console.log('zip-deflate.test.ts: all tests passed');
