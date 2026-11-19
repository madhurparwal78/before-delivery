/** Image parsing, validation and metadata stripping (DP-18). */

export interface ParsedImage { kind: 'png' | 'jpeg' | 'webp'; width: number; height: number; }

export function sniffImageType(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function contentTypeOf(kind: 'png' | 'jpeg' | 'webp'): string {
  return kind === 'png' ? 'image/png' : kind === 'jpeg' ? 'image/jpeg' : 'image/webp';
}

/** Read dimensions from the image header. Returns null when unreadable. */
export function readDimensions(buf: Buffer, kind: 'png' | 'jpeg' | 'webp'): { width: number; height: number } | null {
  try {
    if (kind === 'png') {
      if (buf.length < 24) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (kind === 'jpeg') {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off += 1; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buf.readUInt16BE(off + 5);
          const width = buf.readUInt16BE(off + 7);
          return { width, height };
        }
        const len = buf.readUInt16BE(off + 2);
        if (len < 2) return null;
        off += 2 + len;
      }
      return null;
    }
    // webp
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ') {
      if (buf.length < 30) return null;
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (fourcc === 'VP8L') {
      if (buf.length < 25) return null;
      const b = buf.readUInt32LE(21);
      const width = (b & 0x3fff) + 1;
      const height = ((b >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    if (fourcc === 'VP8X') {
      if (buf.length < 30) return null;
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

/** Strip PNG eXIf/tEXt/zTXt/iTXt chunks. */
export function stripPng(buf: Buffer): Buffer {
  if (buf.length < 8) return buf;
  const sig = buf.subarray(0, 8);
  const chunks: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const total = 12 + len;
    if (off + total > buf.length) break;
    if (!PNG_METADATA_CHUNKS.has(type)) {
      chunks.push(buf.subarray(off, off + total));
    }
    off += total;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 && off >= buf.length) return buf;
  return Buffer.concat([sig, ...chunks]);
}

/** Strip JPEG Exif (APP1), XMP (APP1) and Photoshop (APP13/Photoshop 3.0) segments. */
export function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) break;
    const marker = buf[off + 1];
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(off)); return Buffer.concat(out); }
    const len = buf.readUInt16BE(off + 2);
    const seg = buf.subarray(off, off + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isExif = marker === 0xe1 && seg.length > 10 && seg.toString('ascii', 4, 10) === 'Exif\0\0';
    const isXmp = marker === 0xe1 && seg.length > 18 && seg.toString('ascii', 4, 29).startsWith('http://ns.adobe.com/xap/1.0/');
    const isPs = marker === 0xed && seg.length > 14 && seg.toString('ascii', 4, 18) === 'Photoshop 3.0\0';
    if (!(isApp && (isExif || isXmp || isPs))) out.push(seg);
    off += 2 + len;
  }
  out.push(buf.subarray(off));
  return Buffer.concat(out);
}


/** Strip WebP EXIF and XMP chunks. */
export function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12) return buf;
  const riff = buf.subarray(0, 4);
  const webp = buf.subarray(8, 12);
  const chunks: Buffer[] = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const padded = size + (size % 2);
    if (off + 8 + size > buf.length) break;
    const keep = id !== 'EXIF' && id !== 'XMP ';
    if (keep) chunks.push(buf.subarray(off, off + 8 + padded));
    off += 8 + padded;
  }
  chunks.push(buf.subarray(off));
  const body = Buffer.concat(chunks);
  return Buffer.concat([riff, writeLE32(body.length), webp, body]);
}

function writeLE32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
