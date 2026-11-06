// CSV (RFC 4180), ZIP (store method), ICS, file signatures, EXIF stripping.

import { createHash } from 'node:crypto';

// ---------- CSV ----------

export function csvEscape(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

/** Neutralise a text cell that starts with a formula character. */
export function csvNeutral(text: string | null | undefined): string {
  const value = text ?? '';
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function csvRow(cells: (string | number | null)[]): string {
  return cells.map((cell) => {
    if (typeof cell === 'number') return cell.toFixed(2);
    return csvEscape(csvNeutral(String(cell ?? '')));
  }).join(',');
}

// ---------- ZIP (store method) ----------

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function crc32(buffer: Buffer): number {
  let table = CRC32_TABLE;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    CRC32_TABLE = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
let CRC32_TABLE: Uint32Array | null = null;

export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2100, 12); // date (2016+) — deterministic enough
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);
    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(0, 12);
    centralEntry.writeUInt16LE(0x2100, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(data.length, 24);
    centralEntry.writeUInt16LE(nameBytes.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

// ---------- ICS ----------

export function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildIcs(uid: string, sequence: number, startUtcCompact: string, summary: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Plumbline//Marrow Hall Interiors//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${startUtcCompact}`,
    `DTSTART:${startUtcCompact}`,
    `DTEND:${startUtcCompact}`,
    `SUMMARY:${escapeIcs(summary)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

// ---------- File signature detection ----------

export type SheetKind = { kind: 'pdf' | 'png' | 'jpeg' | 'svg'; ext: 'pdf' | 'png' | 'jpg' | 'svg'; contentType: string };

export function detectSheetFile(buffer: Buffer): SheetKind | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { kind: 'pdf', ext: 'pdf', contentType: 'application/pdf' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'png', ext: 'png', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'jpeg', ext: 'jpg', contentType: 'image/jpeg' };
  }
  const asSvg = looksLikeSvg(buffer);
  if (asSvg) return { kind: 'svg', ext: 'svg', contentType: 'image/svg+xml' };
  return null;
}

export function looksLikeSvg(buffer: Buffer): boolean {
  let text: string;
  try {
    text = buffer.toString('utf8');
  } catch {
    return false;
  }
  const trimmed = text.replace(/^\uFEFF/, '').replace(/^[\s\uFEFF\u0000-\u001f]*/, '');
  const declaration = new RegExp("^<\\?xml[^>]*\\?>", 'i');
  let rest = trimmed;
  while (true) {
    rest = rest.replace(declaration, '').replace(/^\s+/, '');
    const commentMatch = rest.match(/^<!--[\s\S]*?-->\s*/);
    if (commentMatch) {
      rest = rest.slice(commentMatch[0].length);
      continue;
    }
    const doctypeMatch = rest.match(/^<!DOCTYPE[^>]*>\s*/i);
    if (doctypeMatch) {
      rest = rest.slice(doctypeMatch[0].length);
      continue;
    }
    break;
  }
  const elementMatch = rest.match(/^<([a-zA-Z][a-zA-Z0-9:-]*)/);
  if (elementMatch && elementMatch[1].toLowerCase() === 'svg') return true;
  return false;
}

export function svgContainsScript(buffer: Buffer): boolean {
  const text = buffer.toString('utf8');
  if (/<\s*script\b/i.test(text)) return true;
  if (/\bon[a-z]+\s*=/i.test(text)) return true;
  if (/javascript:/i.test(text)) return true;
  return false;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------- Image handling (renders, photos) ----------

export type ImageKind = { kind: 'png' | 'jpeg'; ext: 'png' | 'jpg' };

export function detectImage(buffer: Buffer): ImageKind | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'png', ext: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'jpeg', ext: 'jpg' };
  }
  return null;
}
