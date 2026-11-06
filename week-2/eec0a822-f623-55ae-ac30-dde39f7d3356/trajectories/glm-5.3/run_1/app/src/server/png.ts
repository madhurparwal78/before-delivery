import { inflateSync, deflateSync } from 'node:zlib';
import type { JpegInfo } from './jpeg.js';

export function pngInfo(buf: Buffer): JpegInfo | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, exifOrientation: null };
}

export function pngRender(buf: Buffer): Buffer | null {
  try {
    let i = 8;
    let w = 0;
    let h = 0;
    let bitDepth = 8;
    let colorType = 6;
    let idat = Buffer.alloc(0);
    const chunks: Array<{ type: string; data: Buffer }> = [];
    while (i + 8 <= buf.length) {
      const length = buf.readUInt32BE(i);
      const type = buf.slice(i + 4, i + 8).toString('ascii');
      const data = buf.slice(i + 8, i + 8 + length);
      if (type === 'IHDR') {
        w = data.readUInt32BE(0);
        h = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === 'IDAT') {
        idat = Buffer.concat([idat, data]);
      } else if (type === 'IEND') break;
      i += 12 + length;
    }
    if (!w || !h || (colorType !== 6 && colorType !== 2) || bitDepth !== 8) return null;
    const channels = colorType === 6 ? 4 : 3;
    const raw = inflateSync(idat);
    const stride = w * channels;
    const pixels = Buffer.alloc(h * stride);
    let pos = 0;
    for (let y = 0; y < h; y++) {
      const filter = raw[pos++];
      const row = raw.slice(pos, pos + stride);
      if (row.length < stride) return null;
      pos += stride;
      const cur = pixels.slice(y * stride, y * stride + stride);
      row.copy(cur);
      const prev = y > 0 ? pixels.slice((y - 1) * stride, (y - 1) * stride + stride) : null;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? cur[x - channels] : 0;
        const b = prev ? prev[x] : 0;
        const c = x >= channels && prev ? prev[x - channels] : 0;
        let v = cur[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        cur[x] = v & 0xff;
      }
    }
    // Encode as RGBA PNG (colorType 6, bitDepth 8), no ancillary chunks.
    const out: Buffer[] = [];
    out.push(pngChunk('IHDR', ihdr(w, h)));
    const unfiltered = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
      unfiltered[y * (stride + 1)] = 0;
      pixels.copy(unfiltered, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    out.push(pngChunk('IDAT', deflateSync(unfiltered, { level: 9 })));
    out.push(pngChunk('IEND', Buffer.alloc(0)));
    const total = out.reduce((n, c) => n + c.length, 0);
    const result = Buffer.concat(out, total);
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([header, result]);
  } catch {
    return null;
  }
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c >>> 1 ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}

function ihdr(w: number, h: number): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8; // bit depth
  d[9] = 6; // RGBA
  d[10] = 0;
  d[11] = 0;
  d[12] = 0;
  return d;
}
