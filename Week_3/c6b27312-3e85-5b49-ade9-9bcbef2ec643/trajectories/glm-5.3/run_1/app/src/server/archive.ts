import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AppCtx } from "./ctx.js";
import { formatFixed, formatBBoxTriple } from "../shared/numbers.js";
import { revisionJsonOf } from "./archive.util.js";

interface Entry { name: string; data: Buffer }

/** Build a stored archive for a revision: source, record, solids, manifest. */
async function archiveEntries(ctx: AppCtx, rev: Record<string, unknown>, part: Record<string, unknown>): Promise<Entry[]> {
  const slug = part.slug as string;
  const label = `r${rev.label}`;
  const folder = `${slug}-${label}`;
  const sourceBytes = await ctx.s3.getObject(rev.source_key as string);
  const entries: Entry[] = [
    { name: `${folder}/part.tine`, data: sourceBytes },
    { name: `${folder}/revision.json`, data: Buffer.from(JSON.stringify(revisionJsonOf(rev), null, 2), "utf8") },
  ];
  // One solids entry per distinct digest on the tape.
  const rows = await ctx.db.query(`select operations from tapes where revision_id = $1`, [rev.id]);
  const digests = new Set<string>([rev.geometry_digest as string]);
  if (rows.rows[0]) {
    for (const op of rows.rows[0].operations as Array<{ digest: string }>) digests.add(op.digest);
  }
  for (const d of digests) {
    const bytes = await ctx.s3.getObject(`solids/${d}.json`);
    entries.push({ name: `${folder}/solids/${d}.json`, data: bytes });
  }
  return entries;
}

/** The manifest: volume, bounding box, then one line per other entry. */
async function manifestFor(ctx: AppCtx, entries: Entry[], rev: Record<string, unknown>, folder: string): Promise<Buffer> {
  const lines: string[] = [];
  const evalRow = rev.evaluation_id
    ? await ctx.db.query(`select volume, bbox from evaluations where id = $1`, [rev.evaluation_id])
    : null;
  const volume = evalRow?.rows[0] ? Number(evalRow.rows[0].volume) : 0;
  const bbox = evalRow?.rows[0]?.bbox as number[] | undefined;
  lines.push(`Volume: ${formatFixed(volume, 2)}\u202Fmm\u00b3`);
  lines.push(`Bounding box: ${formatBBoxTriple(bbox ?? [0, 0, 0])}`);
  for (const e of entries) {
    if (e.name === `${folder}/manifest.txt`) continue;
    const sha = createHash("sha256").update(e.data).digest("hex");
    lines.push(`${e.name} ${sha} ${e.data.length}`);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

export async function archiveZip(ctx: AppCtx, rev: Record<string, unknown>, part: Record<string, unknown>): Promise<Buffer> {
  const folder = `${part.slug}-r${rev.label}`;
  const entries = await archiveEntries(ctx, rev, part);
  entries.push({ name: `${folder}/manifest.txt`, data: await manifestFor(ctx, entries, rev, folder) });
  return buildZip(entries);
}

export async function archiveTar(ctx: AppCtx, rev: Record<string, unknown>, part: Record<string, unknown>): Promise<Buffer> {
  const folder = `${part.slug}-r${rev.label}`;
  const entries = await archiveEntries(ctx, rev, part);
  entries.push({ name: `${folder}/manifest.txt`, data: await manifestFor(ctx, entries, rev, folder) });
  return buildTar(entries);
}

/** Minimal ZIP writer: local headers + central directory, stored (no compression). */
function buildZip(entries: Entry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const crc32Table = makeCrc32Table();
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data, crc32Table);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, e.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + e.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(buf: Buffer, table: Uint32Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]!)!]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal TAR writer (ustar). */
function buildTar(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  const encode = (s: string, len: number): Buffer => {
    const b = Buffer.alloc(len);
    b.write(s.slice(0, len), 0, "utf8");
    return b;
  };
  for (const e of entries) {
    const header = Buffer.alloc(512);
    encode(e.name, 100).copy(header, 0);
    encode("0000644\0", 8).copy(header, 100);
    encode("0000000\0", 8).copy(header, 108);
    encode("0000000\0", 8).copy(header, 116);
    encode(e.data.length.toString(8).padStart(11, "0") + "\0", 12).copy(header, 124);
    encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 12).copy(header, 136);
    encode("0".repeat(8), 8).copy(header, 148);
    encode("ustar\0", 6).copy(header, 257);
    encode("00", 2).copy(header, 263);
    // Checksum: spaces then the sum of bytes.
    encode("        ", 8).copy(header, 148);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i]!;
    encode(sum.toString(8).padStart(6, "0") + "\0 ", 8).copy(header, 148);
    blocks.push(header, e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
