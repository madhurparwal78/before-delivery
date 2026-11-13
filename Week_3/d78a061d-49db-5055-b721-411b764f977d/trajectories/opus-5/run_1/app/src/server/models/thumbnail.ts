import { deflateSync } from 'node:zlib';
import { defaultSceneNodes, readGlb, type GltfJson } from './glb.js';

const SIZE = 256;
const MARGIN = 16;
const PAPER: [number, number, number] = [0xfa, 0xf6, 0xee];
const GRAPHITE: [number, number, number] = [0x1d, 0x1d, 0x1f];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Matrix = number[];

function identity(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node: {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}): Matrix {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return [...node.matrix];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function apply(matrix: Matrix, x: number, y: number, z: number): [number, number] {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
  ];
}

const COMPONENT_SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readIndices(json: GltfJson, bin: Buffer, accessorIndex: number): number[] {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) return [];
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return [];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const size = COMPONENT_SIZES[accessor.componentType ?? 5123] ?? 2;
  const count = accessor.count ?? 0;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = base + i * size;
    if (offset + size > bin.length) break;
    out.push(size === 1 ? bin.readUInt8(offset) : size === 2 ? bin.readUInt16LE(offset) : bin.readUInt32LE(offset));
  }
  return out;
}

function readPositions(json: GltfJson, bin: Buffer, accessorIndex: number): [number, number, number][] {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined || accessor.componentType !== 5126) return [];
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return [];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count ?? 0;
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = base + i * stride;
    if (offset + 12 > bin.length) break;
    out.push([bin.readFloatLE(offset), bin.readFloatLE(offset + 4), bin.readFloatLE(offset + 8)]);
  }
  return out;
}

interface Triangle {
  a: [number, number];
  b: [number, number];
  c: [number, number];
}

function collectTriangles(json: GltfJson, bin: Buffer): Triangle[] {
  const nodes = json.nodes ?? [];
  const triangles: Triangle[] = [];
  const walk = (index: number, parent: Matrix, seen: Set<number>): void => {
    if (seen.has(index) || triangles.length > 60000) return;
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, localMatrix(node));
    const visited = new Set(seen).add(index);
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex === undefined) continue;
        const positions = readPositions(json, bin, positionIndex);
        const projected = positions.map(([x, y, z]) => apply(world, x, y, z));
        const indices =
          primitive.indices === undefined
            ? projected.map((_value, i) => i)
            : readIndices(json, bin, primitive.indices);
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const a = projected[indices[i]];
          const b = projected[indices[i + 1]];
          const c = projected[indices[i + 2]];
          if (a && b && c) triangles.push({ a, b, c });
          if (triangles.length > 60000) return;
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world, visited);
  };
  for (const root of defaultSceneNodes(json)) walk(root, identity(), new Set());
  return triangles;
}

/** A 256 by 256 front silhouette of the accepted model, graphite on paper. */
export function renderThumbnail(bytes: Buffer): Buffer {
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    pixels[i * 3] = PAPER[0];
    pixels[i * 3 + 1] = PAPER[1];
    pixels[i * 3 + 2] = PAPER[2];
  }

  const glb = readGlb(bytes);
  const triangles = glb.json && glb.bin ? collectTriangles(glb.json, glb.bin) : [];
  if (triangles.length === 0) return encodePng(pixels, SIZE, SIZE);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const triangle of triangles) {
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = (SIZE - MARGIN * 2) / span;
  const offsetX = (SIZE - (maxX - minX) * scale) / 2;
  const offsetY = (SIZE - (maxY - minY) * scale) / 2;
  const toScreen = (point: [number, number]): [number, number] => [
    offsetX + (point[0] - minX) * scale,
    SIZE - (offsetY + (point[1] - minY) * scale),
  ];

  for (const triangle of triangles) {
    const [ax, ay] = toScreen(triangle.a);
    const [bx, by] = toScreen(triangle.b);
    const [cx, cy] = toScreen(triangle.c);
    const left = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const right = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
    const top = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const bottom = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / area;
        const w1 = ((cx - bx) * (py - by) - (px - bx) * (cy - by)) / area;
        const w2 = ((ax - cx) * (py - cy) - (px - cx) * (ay - cy)) / area;
        if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
          const index = (y * SIZE + x) * 3;
          pixels[index] = GRAPHITE[0];
          pixels[index + 1] = GRAPHITE[1];
          pixels[index + 2] = GRAPHITE[2];
        }
      }
    }
  }

  return encodePng(pixels, SIZE, SIZE);
}
