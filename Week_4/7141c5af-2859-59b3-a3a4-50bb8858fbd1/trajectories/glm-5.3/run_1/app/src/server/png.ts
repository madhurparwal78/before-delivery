/** Minimal PNG writer for generated imagery (photographs, grounds, grains). */

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]!) & 0xff]!;
  }
  return (c ^ 0xffffffff) >>> 0;
}
const crcTable: number[] = (() => {
  const t = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, Buffer.from(data)])));
  return Buffer.concat([len, typeB, Buffer.from(data), crc]);
}
/** Non-filtered RGB PNG. */
export function writePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const iend = Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateStore(raw)),
    chunk("IEND", iend),
  ]);
}
function deflateStore(data: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  const CHUNK = 65535;
  for (let off = 0; off < data.length; off += CHUNK) {
    const slice = data.subarray(off, Math.min(off + CHUNK, data.length));
    const isLast = off + CHUNK >= data.length;
    parts.push(Buffer.from([isLast ? 1 : 0, slice.length & 0xff, (slice.length >> 8) & 0xff, (~slice.length) & 0xff, ((~slice.length) >> 8) & 0xff]));
    parts.push(slice);
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(data));
  parts.push(adler);
  return Buffer.concat(parts);
}
/** Generate a before/after photograph PNG for a seeded piece. */
export function generatePhotograph(w: number, h: number, variant: number): Buffer {
  const px = new Uint8Array(w * h * 3);
  const ground = variant % 2 === 0 ? 235 : 244;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      let v = ground;
      const cx = w / 2, cy = h * 0.55;
      const dx = (x - cx) / (w * 0.36), dy = (y - cy) / (h * 0.34);
      if (dx * dx + dy * dy < 1) v = ground === 235 ? 208 : 190;
      const grain = ((x * 7 + y * 13 + variant * 31) % 17) * 2;
      px[i] = v - grain; px[i + 1] = v - grain; px[i + 2] = v - grain;
    }
  }
  return writePng(w, h, px);
}

export const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
export const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPngOrJpeg = (b: Buffer) => isPng(b) || isJpeg(b);
