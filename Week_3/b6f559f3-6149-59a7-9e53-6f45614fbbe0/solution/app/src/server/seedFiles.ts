/** The two files the seed uploads, generated in code: `swing.gltf` and `grain-plate.png`. */
import { crc32, deflateSync } from 'node:zlib';
import { grainHash } from '../shared/evaluator/compositing';

type Triple = [number, number, number];

const FACES: { normal: Triple; u: Triple; v: Triple }[] = [
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

/** A box of 24 vertices (four per face) with outward normals and 36 indices. */
function box(half: Triple): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  FACES.forEach(({ normal, u, v }, face) => {
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      for (let axis = 0; axis < 3; axis++) {
        positions.push(((normal[axis] as number) + su * (u[axis] as number) + sv * (v[axis] as number)) * (half[axis] as number));
        normals.push(normal[axis] as number);
      }
    }
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

const FLOAT = 5126;
const USHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** A text glTF with embedded buffers: nodes Arm and Foot (24-vertex boxes) and clips Turn (LINEAR) and Hop (STEP). */
export function swingGltf(): Buffer {
  const chunks: Buffer[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const add = (data: ArrayBufferView, target: number | null, accessor: object): number => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    accessors.push({ bufferView: views.length - 1, ...accessor });
    chunks.push(bytes);
    offset += bytes.length;
    return accessors.length - 1;
  };
  const bounds = (positions: Float32Array): { min: number[]; max: number[] } => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3] as number, positions[i] as number);
      max[i % 3] = Math.max(max[i % 3] as number, positions[i] as number);
    }
    return { min, max };
  };
  const mesh = (half: Triple): object => {
    const geometry = box(half);
    const position = add(geometry.positions, ARRAY_BUFFER, { componentType: FLOAT, count: 24, type: 'VEC3', ...bounds(geometry.positions) });
    const normal = add(geometry.normals, ARRAY_BUFFER, { componentType: FLOAT, count: 24, type: 'VEC3' });
    const indices = add(geometry.indices, ELEMENT_ARRAY_BUFFER, { componentType: USHORT, count: 36, type: 'SCALAR' });
    return { primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, mode: 4 }] };
  };
  const meshes = [mesh([0.15, 0.5, 0.15]), mesh([0.3, 0.1, 0.3])];

  const scalar = (values: number[], times = true): number => {
    const data = new Float32Array(values);
    return add(data, null, { componentType: FLOAT, count: values.length, type: 'SCALAR', ...(times ? { min: [values[0]], max: [values[values.length - 1]] } : {}) });
  };
  const vector = (values: number[], type: 'VEC3' | 'VEC4'): number =>
    add(new Float32Array(values), null, { componentType: FLOAT, count: values.length / (type === 'VEC3' ? 3 : 4), type });

  const turnTimes = scalar([0, 2]);
  const quarter = Math.SQRT1_2;
  const turnRotation = vector([0, 0, 0, 1, 0, quarter, 0, quarter], 'VEC4');
  const turnTranslation = vector([0, 0, 0, 2, 1, 0], 'VEC3');
  const hopTimes = scalar([0, 0.5, 1]);
  const hopTranslation = vector([0, 0, 0, 0, 1, 0, 0, 0, 0], 'VEC3');

  const document = {
    asset: { version: '2.0', generator: 'Halation Studio seed' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Arm', mesh: 0 },
      { name: 'Foot', mesh: 1, translation: [0, -0.8, 0] },
    ],
    meshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset, uri: `data:application/octet-stream;base64,${Buffer.concat(chunks).toString('base64')}` }],
    animations: [
      {
        name: 'Turn',
        samplers: [
          { input: turnTimes, output: turnRotation, interpolation: 'LINEAR' },
          { input: turnTimes, output: turnTranslation, interpolation: 'LINEAR' },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: 'rotation' } },
          { sampler: 1, target: { node: 0, path: 'translation' } },
        ],
      },
      {
        name: 'Hop',
        samplers: [{ input: hopTimes, output: hopTranslation, interpolation: 'STEP' }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
      },
    ],
  };
  return Buffer.from(JSON.stringify(document));
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A 64 × 64 RGB PNG of seeded film grain. */
export function grainPlatePng(seed: number): Buffer {
  const size = 64;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const level = 96 + Math.floor(grainHash(x, y, seed) * 80);
      raw[row + 1 + x * 3] = level;
      raw[row + 2 + x * 3] = level - 6;
      raw[row + 3 + x * 3] = Math.min(255, level + 14);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
