import { deflateSync } from 'node:zlib';

const SAMPLE_RATE = 22_050;
const CLIP_SECONDS = 3;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;

export type GeneratedObject = { readonly bytes: Buffer; readonly contentType: string };

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function seedOf(value: string): number {
  let seed = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function waveform(sampleId: string, time: number): number {
  const progress = time / CLIP_SECONDS;
  if (sampleId.includes('rhythm')) {
    const beat = (time * 4) % 1;
    const envelope = Math.exp(-beat * 9);
    const pitch = 180 + 40 * Math.floor((time * 4) % 4);
    return envelope * Math.sin(2 * Math.PI * pitch * time) * 0.6;
  }
  const pitch = 220 + 180 * Math.sin(2 * Math.PI * 0.5 * time) * progress;
  const envelope = Math.min(1, progress * 6) * Math.min(1, (1 - progress) * 6);
  return (
    envelope *
    0.55 *
    (Math.sin(2 * Math.PI * pitch * time) + 0.3 * Math.sin(4 * Math.PI * pitch * time))
  );
}

function wavClip(sampleId: string): Buffer {
  const frames = SAMPLE_RATE * CLIP_SECONDS;
  const data = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE;
    const value = Math.max(-1, Math.min(1, waveform(sampleId, time)));
    data.writeInt16LE(Math.round(value * 32_000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = ((CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels: Buffer, width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function frameImage(sampleId: string, frame: number, frames: number): Buffer {
  const random = seededRandom(seedOf(`${sampleId}:${frame}`));
  const noise = 1 - (frame - 1) / Math.max(1, frames - 1);
  const pixels = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 3);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const u = x / FRAME_WIDTH;
      const v = y / FRAME_HEIGHT;
      const ridge = Math.sin(6.5 * u + 1.6 * Math.sin(5.0 * v)) * Math.cos(4.0 * v);
      const base = 150 + 70 * ridge;
      const grain = (random() - 0.5) * 190 * noise;
      const level = Math.max(0, Math.min(255, base + grain));
      const offset = (y * FRAME_WIDTH + x) * 3;
      pixels[offset] = Math.round(level * 0.98);
      pixels[offset + 1] = Math.round(level * 0.94);
      pixels[offset + 2] = Math.round(level * 0.88);
    }
  }
  return encodePng(pixels, FRAME_WIDTH, FRAME_HEIGHT);
}

/** Builds a sample object's bytes from its key parts, with no media copied in. */
export function generateSampleObject(
  sampleId: string,
  file: string,
  frames: number,
): GeneratedObject {
  if (file === 'clip.wav') {
    return { bytes: wavClip(sampleId), contentType: 'audio/wav' };
  }
  const match = /^frame-(\d{2})\.png$/.exec(file);
  if (match === null) {
    throw new Error(`Unknown sample file ${file}`);
  }
  const frame = Number.parseInt(match[1] as string, 10);
  return { bytes: frameImage(sampleId, frame, frames), contentType: 'image/png' };
}

export function sampleFiles(kind: 'audio' | 'image_sequence', frames: number): readonly string[] {
  if (kind === 'audio') return ['clip.wav'];
  return Array.from({ length: frames }, (_value, index) =>
    `frame-${String(index + 1).padStart(2, '0')}.png`,
  );
}

export function sampleKey(modelSlug: string, sampleId: string, file: string): string {
  return `samples/${modelSlug}/${sampleId}/${file}`;
}
