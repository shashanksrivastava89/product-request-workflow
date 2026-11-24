/**
 * Re-pack a zip (an .xlsx) with Node's zlib.
 *
 * SheetJS compresses with its own deflate, which only takes the 39k-row product master from 16 MB to
 * 5.5 MB; zlib takes it to under 2 MB. That matters beyond the download: the file is meant to be
 * edited and uploaded back, and uploads to UAT go up in 8 KB parts. SheetJS can be told to use zlib,
 * but not on current Node (it reads a zlib field Node no longer exposes), so the workbook is written
 * uncompressed and re-packed here.
 *
 * Only what SheetJS writes is handled: a single-disk zip, no zip64, no encryption. The CRC of each
 * entry is taken from the input's central directory - it is computed over the uncompressed bytes,
 * so it holds for the deflated entry too.
 */

import zlib from 'zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

interface Entry {
  name: Buffer;
  crc: number;
  method: number;
  data: Buffer;
  size: number;
  time: number;
  date: number;
}

function readEntries(zip: Buffer): Entry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END_SIG) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip: no end-of-central-directory record');
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('Corrupt zip: bad central directory entry');
    const method = zip.readUInt16LE(p + 10);
    const time = zip.readUInt16LE(p + 12);
    const date = zip.readUInt16LE(p + 14);
    const crc = zip.readUInt32LE(p + 16);
    const compSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen);
    if (zip.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('Corrupt zip: bad local header');
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`Unsupported zip method ${method}`);
    entries.push({ name: Buffer.from(name), crc, method, data, size, time, date });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The same archive, every entry deflated with zlib. */
export function deflateZip(zip: Buffer, level = 6): Buffer {
  const entries = readEntries(zip);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = zlib.deflateRawSync(e.data, { level });
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, deflate
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(e.name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, e.name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(e.time, 12);
    central.writeUInt16LE(e.date, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, e.name);
    offset += 30 + e.name.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
