// Files the grading setup makes: slides drawn as PNGs and a small glTF binary model.
import { deflateSync } from 'node:zlib';

const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const frame = Buffer.alloc(4);
  frame.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([frame, body, check]);
}

const WIDTH = 640;
const HEIGHT = 360;
const SCALE = 24;
const BOARD: [number, number, number] = [0x2f, 0x4b, 0x41];
const CHALK: [number, number, number] = [0xf6, 0xf0, 0xe4];

/** A valid PNG slide showing its number in chalk on the board's slate-green. */
export function slidePng(number: number): Buffer {
  const digits = String(number).split('');
  const glyphWidth = 5 * SCALE;
  const gap = SCALE;
  const textWidth = digits.length * glyphWidth + (digits.length - 1) * gap;
  const left = Math.floor((WIDTH - textWidth) / 2);
  const top = Math.floor((HEIGHT - 7 * SCALE) / 2);
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * (WIDTH * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const frame = x < 8 || y < 8 || x >= WIDTH - 8 || y >= HEIGHT - 8;
      let inked = frame;
      const gx = x - left;
      const gy = y - top;
      if (!inked && gx >= 0 && gy >= 0 && gy < 7 * SCALE) {
        const index = Math.floor(gx / (glyphWidth + gap));
        const within = gx - index * (glyphWidth + gap);
        const glyph = FONT[digits[index] ?? ''];
        if (glyph && within < glyphWidth) inked = glyph[Math.floor(gy / SCALE)]?.[Math.floor(within / SCALE)] === '1';
      }
      const [r, g, b] = inked ? CHALK : BOARD;
      raw[rowStart + 1 + x * 3] = r;
      raw[rowStart + 2 + x * 3] = g;
      raw[rowStart + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PHI = (1 + Math.sqrt(5)) / 2;
const CORNERS: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

type Vec = [number, number, number];

/** A small valid glTF binary: a faceted gem (twenty flat triangles with normals and a brass material). */
export function gemGlb(): Buffer {
  const radius = 0.4;
  const scaled: Vec[] = CORNERS.map(([x, y, z]) => {
    const length = Math.hypot(x, y, z);
    return [(x / length) * radius, (y / length) * radius, (z / length) * radius];
  });
  const positions: number[] = [];
  const normals: number[] = [];
  for (const face of FACES) {
    const [a, b, c] = face.map((index) => scaled[index] ?? [0, 0, 0]) as [Vec, Vec, Vec];
    let normal: Vec = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const length = Math.hypot(...normal);
    normal = [normal[0] / length, normal[1] / length, normal[2] / length];
    const outward = normal[0] * (a[0] + b[0] + c[0]) + normal[1] * (a[1] + b[1] + c[1]) + normal[2] * (a[2] + b[2] + c[2]);
    const ordered = outward >= 0 ? [a, b, c] : [a, c, b];
    const facing: Vec = outward >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
    for (const corner of ordered) {
      positions.push(...corner);
      normals.push(...facing);
    }
  }
  const bin = Buffer.from(new Float32Array([...positions, ...normals]).buffer);
  const half = bin.length / 2;
  const count = positions.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'Slatehall' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Gem' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.78, 0.62, 0.32, 1], metallicFactor: 0.2, roughnessFactor: 0.55 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-radius, -radius, -radius], max: [radius, radius, radius] },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: half, target: 34962 },
      { buffer: 0, byteOffset: half, byteLength: half, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonText = JSON.stringify(json);
  const jsonChunk = Buffer.from(jsonText + ' '.repeat((4 - (jsonText.length % 4)) % 4), 'utf8');
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.write('JSON', 4, 'ascii');
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.write('BIN\0', 4, 'ascii');
  return Buffer.concat([head, jsonHead, jsonChunk, binHead, bin]);
}
