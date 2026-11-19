// Upload hygiene: detect the media kind from leading bytes and strip embedded
// metadata without re-encoding the image data.

export type SniffKind = 'jpeg' | 'png' | 'webp' | 'mp4' | 'webm' | 'unknown';

export const CONTENT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const EXTENSIONS: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  mp4: 'mp4',
  webm: 'webm',
};

export function sniffKind(buf: Buffer): SniffKind {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return 'unknown';
}

/** Strip JPEG APP1/APP13/COM segments before the first start-of-scan marker. */
export function stripJpeg(buf: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  // SOI
  out.push(buf[0]!, buf[1]!);
  i = 2;
  while (i + 4 <= buf.length) {
    const marker = buf[i]!;
    if (marker !== 0xff) return buf;
    const code = buf[i + 1]!;
    if (code === 0xd8 || (code >= 0xd0 && code <= 0xd7) || code === 0x01) {
      out.push(marker, code);
      i += 2;
      continue;
    }
    if (code === 0xda) {
      // Start of scan: copy the remainder byte for byte.
      const rest = buf.subarray(i);
      out.push(...rest);
      return Buffer.from(out);
    }
    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    const isMetadata =
      code === 0xe1 || code === 0xed || code === 0xfe || // APP1, APP13, COM
      false;
    if (!isMetadata) out.push(...segment);
    i += 2 + len;
  }
  return buf;
}

const PNG_STRIPPED_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

/** Remove metadata chunks from a PNG, correcting the CRCs of nothing else. */
export function stripPng(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 8;
  parts.push(buf.subarray(0, 8));
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('ascii');
    const total = 12 + len;
    const chunk = buf.subarray(i, i + total);
    if (!PNG_STRIPPED_CHUNKS.has(type)) {
      parts.push(chunk);
    }
    if (type === 'IEND') break;
    i += total;
  }
  if (i < buf.length) parts.push(buf.subarray(i));
  return Buffer.concat(parts);
}

/** Remove EXIF and XMP chunks from a WebP (VP8X extended format), fixing flags and size. */
export function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12) return buf;
  const riff = buf.subarray(0, 4).toString('ascii');
  if (riff !== 'RIFF') return buf;
  const webpTag = buf.subarray(8, 12).toString('ascii');
  if (webpTag !== 'WEBP') return buf;
  let i = 12;
  const chunks: { type: string; data: Buffer }[] = [];
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('ascii');
    const len = buf.readUInt32LE(i + 4);
    let padded = len;
    if (len % 2 === 1) padded = len + 1;
    const data = buf.subarray(i + 8, i + 8 + len);
    chunks.push({ type, data: Buffer.from(data) });
    i += 8 + padded;
    if (i > buf.length) break;
  }
  const kept = chunks.filter((c) => c.type !== 'EXIF' && c.type !== 'XMP ');
  let hasVp8x = kept.some((c) => c.type === 'VP8X');
  // Recompute VP8X flags (byte 1 of payload is the flags byte; bits: ICC, ALPHA, EXIF, XMP, ANIM)
  if (hasVp8x) {
    for (const c of kept) {
      if (c.type !== 'VP8X') continue;
      const flags = c.data[1] ?? 0;
      const cleared = flags & ~0x18; // clear EXIF (0x08) and XMP (0x10)
      c.data[1] = cleared;
      break;
    }
  } else {
    // If the only chunks were metadata, nothing sensible remains.
    return buf;
  }
  // If the format has become plain (no animation/alpha), VP8X may stay; browsers accept it.
  const body: Buffer[] = [];
  let size = 0;
  for (const c of kept) {
    const head = Buffer.alloc(8);
    head.write(c.type, 0, 'ascii');
    head.writeUInt32LE(c.data.length, 4);
    body.push(head, c.data);
    size += 8 + c.data.length;
    if (c.data.length % 2 === 1) {
      body.push(Buffer.from([0]));
      size += 1;
    }
  }
  const out = Buffer.alloc(12 + size);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(4 + size, 4);
  out.write('WEBP', 8, 'ascii');
  Buffer.concat(body).copy(out, 12);
  return out;
}

/** Remove embedded metadata from an image per the brief; clips stay byte-identical. */
export function scrub(kind: SniffKind, buf: Buffer): Buffer {
  switch (kind) {
    case 'jpeg':
      return stripJpeg(buf);
    case 'png':
      return stripPng(buf);
    case 'webp':
      return stripWebp(buf);
    default:
      return buf;
  }
}
