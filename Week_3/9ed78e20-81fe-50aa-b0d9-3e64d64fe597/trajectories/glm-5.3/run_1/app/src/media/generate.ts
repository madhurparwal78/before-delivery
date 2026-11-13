import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { seededSamples } from '../db/migrate.js';

/** WAV: 44.1 kHz, 16-bit mono. */
export function generateSampleAudio(spec: { sampleId: string }): { bytes: Buffer; contentType: string; file: string } {
  const sampleRate = 44100;
  const seconds = 12;
  const total = sampleRate * seconds;
  const data = Buffer.alloc(total * 2);
  const seed = [...randomBytes(8)].reduce((a, b) => a + b, 0) || 7;
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    let value = 0;
    if (spec.sampleId === 'pitch-contour') {
      const freq = 220 * Math.pow(2, (Math.sin(t * 0.5 * seed * 0.1) * 2 + 1) * 0.25);
      value = Math.sin(2 * Math.PI * freq * t) * 0.4 * Math.exp(-((t % 3) / 3) * 1.2);
    } else {
      // Rhythm continuation: short pulses with rests.
      const beat = (t * 2.2) % 1;
      const envelope = beat < 0.25 ? Math.exp(-beat * 18) : 0;
      const freq = 180 + 90 * Math.sin(t * 0.9);
      value = Math.sin(2 * Math.PI * freq * t) * 0.5 * envelope;
    }
    const clamped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clamped * 32000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return { bytes: Buffer.concat([header, data]), contentType: 'audio/wav', file: 'clip.wav' };
}

/** PNG: 8-bit greyscale, hand-built chunks. */
export function generateSampleFrame(spec: { sampleId: string; index: number; total: number }): { bytes: Buffer; contentType: string } {
  const width = 256;
  const height = 160;
  const raw = Buffer.alloc((width + 1) * height);
  const progress = (spec.index + 1) / (spec.total + 1);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      // A denoising sequence: noise fades as the frames progress.
      const noise = Math.sin((x * 13.7 + y * 7.1 + spec.index * 31.3)) * (1 - progress) * 70;
      const signal =
        40 +
        30 * Math.sin((x / width) * Math.PI * 2 + spec.index * 0.6) *
          Math.exp(-((y - height / 2) ** 2) / (2 * (height / 6) ** 2));
      const value = Math.max(0, Math.min(255, Math.round(signal + noise)));
      raw[rowStart + 1 + x] = value;
    }
  }
  const bytes = pngFromGreyscale(width, height, raw);
  return { bytes, contentType: 'image/png' };
}

function pngFromGreyscale(width: number, height: number, raw: Buffer): Buffer {
  const compressed = deflateSync(raw, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))];
  return Buffer.concat(parts);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sampleKeysToEnsure(): Array<{ key: string; generate: () => { bytes: Buffer; contentType: string } }> {
  const out: Array<{ key: string; generate: () => { bytes: Buffer; contentType: string } }> = [];
  for (const spec of seededSamples()) {
    for (const file of spec.files) {
      const key = `samples/${spec.modelSlug}/${spec.sampleId}/${file}`;
      if (spec.kind === 'audio') {
        out.push({
          key,
          generate: () => generateSampleAudio({ sampleId: spec.sampleId }),
        });
      } else {
        const index = Number(/frame-(\d+)/.exec(file)?.[1] ?? 1) - 1;
        out.push({
          key,
          generate: () => generateSampleFrame({ sampleId: spec.sampleId, index, total: spec.files.length }),
        });
      }
    }
  }
  return out;
}

/** A minimal but valid single-page PDF for fixture résumés. */
export function generatePdf(text: string): Buffer {
  const lines = text.split('\n');
  const content = lines
    .map((line, i) => {
      const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      return `BT /F1 12 Tf 72 ${740 - i * 18} Td (${escaped}) Tj ET`;
    })
    .join('\n');
  const objects: string[] = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`;
  objects[4] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
