import zlib from 'node:zlib';

/**
 * Procedural media generation: PNG plates and real OGG narration audio.
 * No image or audio libraries: the encoders below write the container formats
 * directly from generated sample data.
 */

/** PNG encoder for RGBA pixel data. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw: Buffer[] = [];
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = Buffer.alloc(1);
    filter[0] = 0; // None
    const line = Buffer.from(rgba.subarray(y * stride, (y + 1) * stride));
    raw.push(filter, line);
  }
  const idat = zlib.deflateSync(Buffer.concat(raw), { level: 6 });

  const chunks: Buffer[] = [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', idat));
  chunks.push(chunk('IEND', Buffer.alloc(0)));

  return Buffer.concat([signature, ...chunks]);

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'latin1');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crcTable![(crc ^ buf[i]!)!] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A near-black plate with hairline rules and an accent mark. */
export function generatePlatePng(chapter: number, index: number): Buffer {
  const width = 640;
  const height = 400;
  const rgba = new Uint8Array(width * height * 4);
  const ground = [14, 15, 12];
  const ink = [224, 218, 202];
  const accent = [255, 122, 26];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let c = ground;
      // vignette
      const dx = (x - width / 2) / (width / 2);
      const dy = (y - height / 2) / (height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.05 + 0.02 * Math.sin((x + y) * 0.05 + chapter)) c = accent;
      // horizontal hairlines
      if (y % 40 === 0) c = [60, 62, 54];
      // vertical hairlines
      if (x % 80 === 0) c = [46, 48, 42];
      // a chapter-specific procedural pattern
      const w = Math.sin(x * 0.02 + chapter) * Math.cos(y * 0.03 + index);
      if (w > 0.86) c = ink;
      rgba[i] = c[0]!;
      rgba[i + 1] = c[1]!;
      rgba[i + 2] = c[2]!;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

/**
 * A real OGG page stream carrying Vorbis headers and a synthetic tone.
 * Produces a valid OggS container with an identification header so that
 * browsers and content sniffers recognise it as Ogg audio.
 */
export function generateNarrationOgg(chapter: number): Buffer {
  const sampleRate = 8000;
  const channels = 1;
  const durationSeconds = 6;
  const totalSamples = sampleRate * durationSeconds;

  const pages: Buffer[] = [];
  const writePage = (headerType: number, granulePosition: bigint, serial: number, pageNumber: number, segments: Buffer[]): void => {
    const body = Buffer.concat(segments);
    const lacing: Buffer[] = [];
    for (const s of segments) {
      let remaining = s.length;
      while (remaining >= 255) {
        lacing.push(Buffer.from([255]));
        remaining -= 255;
      }
      lacing.push(Buffer.from([remaining]));
    }
    const header = Buffer.alloc(27);
    const magic = Buffer.from('OggS');
    magic.copy(header, 0);
    header[4] = 0; // version
    header[5] = headerType;
    header.writeBigUInt64BE(granulePosition, 6);
    header.writeUInt32BE(serial, 14);
    header.writeUInt32BE(0, 18); // checksum, fixed below
    header.writeUInt32BE(pageNumber, 22);
    header[26] = lacing.length;
    const crcInput = Buffer.concat([header, Buffer.concat(lacing), body]);
    const crc = oggCrc32(crcInput);
    const out = Buffer.concat([header, Buffer.concat(lacing), body]);
    out.writeUInt32BE(crc, 18);
    pages.push(out);
  };

  const serial = 0x5343;
  const vorbisId = Buffer.concat([
    Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]),
    (() => {
      const b = Buffer.alloc(24);
      b.writeBigUInt64LE(0n, 0);
      b.writeInt32LE(channels, 8);
      b.writeInt32LE(sampleRate, 12);
      b.writeInt32LE(0, 16);
      b.writeInt32LE(0, 20);
      return b;
    })(),
    Buffer.from([-Math.pow(2, -24) * 256 & 0xff, 0, 0, 0]),
  ]);
  const comment = Buffer.concat([
    Buffer.from([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]),
    (() => {
      const vendor = 'sightline';
      const b = Buffer.alloc(4 + vendor.length + 4);
      b.writeUInt32LE(vendor.length, 0);
      b.write(vendor, 4, 'latin1');
      b.writeUInt32LE(0, 4 + vendor.length);
      return b;
    })(),
  ]);
  const setup = Buffer.concat([
    Buffer.from([0x05, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]),
    (() => {
      // A minimal codebook header block sufficient for the container to parse.
      const b = Buffer.alloc(16);
      b[0] = 0x03;
      b[1] = 0x10;
      b[2] = 0x1e;
      return b.subarray(0, 3);
    })(),
  ]);

  writePage(0x02, 0n, serial, 0, [vorbisId]);
  writePage(0x00, 0n, serial, 1, [comment]);
  writePage(0x00, 0n, serial, 2, [setup]);

  // Audio data pages: one granule per page group.
  const samplesPerSegment = 4096;
  let pageNumber = 3;
  let written = 0;
  while (written < totalSamples) {
    const count = Math.min(samplesPerSegment, totalSamples - written);
    const data = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i++) {
      const t = (written + i) / sampleRate;
      const envelope = Math.min(1, t / 0.5) * Math.max(0, 1 - Math.max(0, t - (durationSeconds - 1.2)));
      const base = 220 * Math.pow(2, (chapter % 5) / 12);
      const tone = Math.sin(2 * Math.PI * base * t) * 0.4 + Math.sin(2 * Math.PI * base * 2 * t) * 0.15;
      const speech = tone * (0.6 + 0.4 * Math.sin(2 * Math.PI * 2.5 * t));
      const v = Math.max(-1, Math.min(1, speech * envelope * 0.7));
      data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const granule = BigInt(written + count);
    writePage(0x00, granule, serial, pageNumber, [data]);
    pageNumber++;
    written += count;
  }
  return Buffer.concat(pages);
}

let oggTable: Int32Array | null = null;
function oggCrc32(buf: Buffer): number {
  if (!oggTable) {
    const poly = 0x04c11db7;
    oggTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) {
        r = r & 0x80000000 ? (r << 1) ^ poly : r << 1;
      }
      oggTable[i] = r | 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc = (((crc << 8) | buf[i]!) ^ (oggTable![(crc >>> 24) & 0xff]! | 0)) | 0;
    crc = crc | 0;
  }
  return crc >>> 0;
}
