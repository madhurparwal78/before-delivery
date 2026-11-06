/**
 * Reads the self-hosted OFL fonts so the generated PDFs use the same faces as the
 * site. The shipped files are WOFF, which is a zlib-compressed sfnt wrapper, so
 * each table is inflated and the sfnt reassembled before it is embedded.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface TrueTypeFont {
  /** The reassembled sfnt, embedded as the PDF `FontFile2` stream. */
  sfnt: Buffer;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  /** Unicode code point to glyph index. */
  cmap: Map<number, number>;
  /** Glyph index to advance width in font units. */
  advances: Map<number, number>;
  defaultAdvance: number;
}

interface SfntTable {
  tag: string;
  data: Buffer;
}

function decodeWoff(woff: Buffer): SfntTable[] {
  if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("expected a WOFF font file");
  const numTables = woff.readUInt16BE(12);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const entry = 44 + i * 20;
    const tag = woff.toString("latin1", entry, entry + 4);
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength === origLength ? Buffer.from(raw) : inflateSync(raw);
    if (data.length !== origLength) throw new Error(`WOFF table ${tag} has the wrong length`);
    tables.push({ tag, data });
  }
  return tables;
}

/** Rebuilds a plain sfnt (TrueType) file from the decoded tables. */
function buildSfnt(tables: SfntTable[]): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const numTables = sorted.length;
  let searchRange = 16;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables * 16) {
    searchRange *= 2;
    entrySelector += 1;
  }

  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);

  const padded: Buffer[] = [];
  let offset = header.length;
  sorted.forEach((entryTable, index) => {
    const entry = 12 + index * 16;
    header.write(entryTable.tag.padEnd(4, " "), entry, 4, "latin1");
    header.writeUInt32BE(checksum(entryTable.data), entry + 4);
    header.writeUInt32BE(offset, entry + 8);
    header.writeUInt32BE(entryTable.data.length, entry + 12);
    const padding = (4 - (entryTable.data.length % 4)) % 4;
    const block = padding === 0 ? entryTable.data : Buffer.concat([entryTable.data, Buffer.alloc(padding)]);
    padded.push(block);
    offset += block.length;
  });

  return Buffer.concat([header, ...padded]);
}

function checksum(data: Buffer): number {
  let sum = 0;
  const whole = data.length - (data.length % 4);
  for (let i = 0; i < whole; i += 4) sum = (sum + data.readUInt32BE(i)) >>> 0;
  if (whole < data.length) {
    const tail = Buffer.alloc(4);
    data.subarray(whole).copy(tail);
    sum = (sum + tail.readUInt32BE(0)) >>> 0;
  }
  return sum;
}

/** Format 4 and format 12 Unicode sub-tables cover every face the app ships. */
function parseCmap(cmap: Buffer): Map<number, number> {
  const map = new Map<number, number>();
  const numSubtables = cmap.readUInt16BE(2);
  let chosen: number | null = null;
  for (let i = 0; i < numSubtables; i += 1) {
    const record = 4 + i * 8;
    const platform = cmap.readUInt16BE(record);
    const encoding = cmap.readUInt16BE(record + 2);
    const offset = cmap.readUInt32BE(record + 4);
    const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
    if (unicode) chosen = offset;
  }
  if (chosen === null) return map;

  const format = cmap.readUInt16BE(chosen);
  if (format === 4) {
    const segCountX2 = cmap.readUInt16BE(chosen + 6);
    const segCount = segCountX2 / 2;
    const endsAt = chosen + 14;
    const startsAt = endsAt + segCountX2 + 2;
    const deltasAt = startsAt + segCountX2;
    const rangesAt = deltasAt + segCountX2;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = cmap.readUInt16BE(endsAt + segment * 2);
      const start = cmap.readUInt16BE(startsAt + segment * 2);
      const delta = cmap.readInt16BE(deltasAt + segment * 2);
      const rangeOffset = cmap.readUInt16BE(rangesAt + segment * 2);
      for (let code = start; code <= end && code !== 0xffff; code += 1) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (code + delta) & 0xffff;
        } else {
          const glyphAt = rangesAt + segment * 2 + rangeOffset + (code - start) * 2;
          if (glyphAt + 1 >= cmap.length) continue;
          glyph = cmap.readUInt16BE(glyphAt);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) map.set(code, glyph);
      }
    }
  } else if (format === 12) {
    const groups = cmap.readUInt32BE(chosen + 12);
    for (let i = 0; i < groups; i += 1) {
      const group = chosen + 16 + i * 12;
      const start = cmap.readUInt32BE(group);
      const end = cmap.readUInt32BE(group + 4);
      const startGlyph = cmap.readUInt32BE(group + 8);
      for (let code = start; code <= end; code += 1) map.set(code, startGlyph + (code - start));
    }
  }
  return map;
}

function parseAdvances(hmtx: Buffer, numberOfHMetrics: number, numGlyphs: number): Map<number, number> {
  const advances = new Map<number, number>();
  let last = 0;
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    if (glyph < numberOfHMetrics) {
      const at = glyph * 4;
      if (at + 1 < hmtx.length) last = hmtx.readUInt16BE(at);
    }
    advances.set(glyph, last);
  }
  return advances;
}

function table(tables: SfntTable[], tag: string): Buffer {
  const found = tables.find((t) => t.tag === tag);
  if (!found) throw new Error(`font is missing the ${tag} table`);
  return found.data;
}

export function loadFont(woffPath: string): TrueTypeFont {
  const tables = decodeWoff(readFileSync(woffPath));
  const head = table(tables, "head");
  const hhea = table(tables, "hhea");
  const maxp = table(tables, "maxp");
  const os2 = tables.find((t) => t.tag === "OS/2")?.data ?? null;

  const unitsPerEm = head.readUInt16BE(18);
  const numGlyphs = maxp.readUInt16BE(4);
  const numberOfHMetrics = hhea.readUInt16BE(34);
  const cmap = parseCmap(table(tables, "cmap"));
  const advances = parseAdvances(table(tables, "hmtx"), numberOfHMetrics, numGlyphs);

  return {
    sfnt: buildSfnt(tables),
    unitsPerEm,
    ascent: hhea.readInt16BE(4),
    descent: hhea.readInt16BE(6),
    capHeight: os2 && os2.length >= 90 ? os2.readInt16BE(88) : Math.round(unitsPerEm * 0.7),
    bbox: [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)],
    cmap,
    advances,
    defaultAdvance: advances.get(0) ?? Math.round(unitsPerEm / 2),
  };
}
