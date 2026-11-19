import { deflateSync } from 'node:zlib';

const digits: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = -1;
  for (const byte of data) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number);
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A slide image the app draws itself, showing the slide's number. */
export function makeSlidePng(slideNumber: number): Buffer {
  const width = 320;
  const height = 180;
  const paper = [247, 243, 233];
  const ink = [26, 46, 38];
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = paper[0] as number;
    pixels[index * 3 + 1] = paper[1] as number;
    pixels[index * 3 + 2] = paper[2] as number;
  }
  const text = String(slideNumber);
  const scale = 8;
  const glyphWidth = 5 * scale + scale;
  const startX = Math.floor((width - text.length * glyphWidth) / 2);
  const startY = Math.floor((height - 7 * scale) / 2);
  text.split('').forEach((character, position) => {
    const glyph = digits[character];
    if (glyph === undefined) return;
    glyph.forEach((row, rowIndex) => {
      row.split('').forEach((cell, columnIndex) => {
        if (cell !== '1') return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = startX + position * glyphWidth + columnIndex * scale + dx;
            const y = startY + rowIndex * scale + dy;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const offset = (y * width + x) * 3;
            pixels[offset] = ink[0] as number;
            pixels[offset + 1] = ink[1] as number;
            pixels[offset + 2] = ink[2] as number;
          }
        }
      });
    });
  });
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 3 + 1)] = 0;
    pixels.copy(raw, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** A small glTF binary the app builds itself: one triangle on a plinth. */
export function makeModelGlb(modelNumber: number): Buffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = Buffer.from(positions.buffer);
  const gltf = {
    asset: { version: '2.0', generator: `slatehall model ${modelNumber}` },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: `model-${modelNumber}` }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0]
      }
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    buffers: [{ byteLength: binary.byteLength }]
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  while (json.byteLength % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ')]);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.byteLength, 0);
  jsonHeader.write('JSON', 4, 'latin1');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.byteLength, 0);
  binHeader.write('BIN\0', 4, 'latin1');
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.byteLength + 8 + binary.byteLength, 8);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}
