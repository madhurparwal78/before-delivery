import type { AssetKind, Rank } from './ranks.js';

const MATERIAL_COUNT: Record<AssetKind, Record<Rank, number>> = {
  avatar: { Feather: 2, Linen: 3, Cedar: 5, Granite: 9 },
  room: { Feather: 2, Linen: 9, Cedar: 17, Granite: 33 }
};

const PAPER_COLOURS: Array<[number, number, number]> = [
  [0.98, 0.95, 0.86],
  [0.95, 0.78, 0.29],
  [0.29, 0.44, 0.44],
  [0.72, 0.28, 0.22],
  [0.21, 0.24, 0.28]
];

function cutPaperSlab(width: number, height: number, depth: number): { positions: number[]; indices: number[] } {
  const hx = width / 2;
  const hz = depth / 2;
  const positions = [
    -hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz,
    -hx, height, -hz, hx, height, -hz, hx, height, hz, -hx, height, hz
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0
  ];
  return { positions, indices };
}

function align(length: number): number {
  return (4 - (length % 4)) % 4;
}

export function generateGlb(kind: AssetKind, rank: Rank, name: string): Uint8Array {
  const shape = kind === 'avatar' ? cutPaperSlab(0.6, 1.7, 0.3) : cutPaperSlab(4, 0.1, 4);
  const positions = new Float32Array(shape.positions);
  const indices = new Uint16Array(shape.indices);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const indexPadding = align(indexBytes.length);
  const binLength = indexBytes.length + indexPadding + positionBytes.length;
  const bin = new Uint8Array(binLength);
  bin.set(indexBytes, 0);
  bin.set(positionBytes, indexBytes.length + indexPadding);

  let minimum = [Infinity, Infinity, Infinity];
  let maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis] ?? 0;
      minimum[axis] = Math.min(minimum[axis] ?? 0, value);
      maximum[axis] = Math.max(maximum[axis] ?? 0, value);
    }
  }

  const materials = Array.from({ length: MATERIAL_COUNT[kind][rank] }, (_unused, index) => {
    const colour = PAPER_COLOURS[index % PAPER_COLOURS.length] ?? [1, 1, 1];
    return {
      name: `${name} paper ${index + 1}`,
      pbrMetallicRoughness: {
        baseColorFactor: [colour[0], colour[1], colour[2], 1],
        metallicFactor: 0,
        roughnessFactor: 0.9
      }
    };
  });

  const json = {
    asset: { version: '2.0', generator: 'Hearthtile paper-cut generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: minimum,
        max: maximum
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes.length, target: 34963 },
      { buffer: 0, byteOffset: indexBytes.length + indexPadding, byteLength: positionBytes.length, target: 34962 }
    ],
    buffers: [{ byteLength: binLength }],
    materials
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadding = align(jsonBytes.length);
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const total = 12 + 8 + jsonChunkLength + 8 + binLength;
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  file.set(new TextEncoder().encode('glTF'), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  file.set(jsonBytes, 20);
  file.fill(0x20, 20 + jsonBytes.length, 20 + jsonChunkLength);
  const binChunkStart = 20 + jsonChunkLength;
  view.setUint32(binChunkStart, binLength, true);
  view.setUint32(binChunkStart + 4, 0x004e4942, true);
  file.set(bin, binChunkStart + 8);
  return file;
}
