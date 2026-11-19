// Generates the three sample .glb models from simple solids, under 200,000 bytes each.
// Run by the build; outputs to the given directory.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Box {
  name: string;
  parent?: string;
  size: [number, number, number];
  position?: [number, number, number];
  colour?: [number, number, number];
}

interface SampleSpec {
  file: string;
  boxes: Box[];
}

const SAMPLES: SampleSpec[] = [
  {
    file: 'coffee-grinder.glb',
    boxes: [
      { name: 'Housing', size: [120, 200, 120], position: [0, 60, 0], colour: [0.42, 0.36, 0.32] },
      { name: 'Hopper', parent: 'Housing', size: [90, 90, 90], position: [0, 145, 0], colour: [0.78, 0.86, 0.88] },
      { name: 'Bean chute', parent: 'Housing', size: [70, 50, 70], position: [0, 80, 0], colour: [0.55, 0.44, 0.3] },
      { name: 'Upper burr', parent: 'Housing', size: [64, 36, 64], position: [0, 40, 0], colour: [0.24, 0.24, 0.28] },
      { name: 'Motor', parent: 'Housing', size: [80, 80, 80], position: [0, -20, 0], colour: [0.32, 0.34, 0.38] },
      { name: 'Drive shaft', parent: 'Housing', size: [16, 120, 16], position: [0, 10, 0], colour: [0.6, 0.6, 0.62] },
      { name: 'Lower burr', parent: 'Drive shaft', size: [58, 32, 58], position: [0, -40, 0], colour: [0.2, 0.2, 0.24] },
      { name: 'Base plate', size: [140, 12, 140], position: [0, -44, 0], colour: [0.3, 0.3, 0.34] },
      { name: 'Grounds tray', size: [110, 40, 90], position: [0, -26, 78], colour: [0.72, 0.66, 0.55] },
    ],
  },
  {
    file: 'bike-hub.glb',
    boxes: [
      { name: 'Hub shell', size: [120, 90, 90], position: [0, 0, 0], colour: [0.5, 0.5, 0.54] },
      { name: 'Axle', size: [170, 12, 12], position: [0, 0, 0], colour: [0.55, 0.55, 0.58] },
      { name: 'Left cone', size: [14, 26, 26], position: [-55, 0, 0], colour: [0.68, 0.66, 0.6] },
      { name: 'Right cone', size: [14, 26, 26], position: [55, 0, 0], colour: [0.68, 0.66, 0.6] },
      { name: 'Left bearing', size: [18, 22, 22], position: [-48, 0, 0], colour: [0.35, 0.35, 0.38] },
      { name: 'Right bearing', size: [18, 22, 22], position: [48, 0, 0], colour: [0.35, 0.35, 0.38] },
      { name: 'Freehub body', size: [40, 70, 70], position: [58, 0, 0], colour: [0.42, 0.4, 0.36] },
      { name: 'Locknut', size: [12, 24, 24], position: [-62, 0, 0], colour: [0.28, 0.28, 0.3] },
      { name: 'Locknut', size: [12, 24, 24], position: [62, 0, 0], colour: [0.28, 0.28, 0.3] },
    ],
  },
  {
    file: 'game-controller.glb',
    boxes: [
      { name: 'Front shell', size: [160, 20, 60], position: [0, 0, 0], colour: [0.2, 0.2, 0.24] },
      { name: 'Back shell', size: [160, 24, 64], position: [0, -18, 2], colour: [0.26, 0.26, 0.3] },
      { name: 'Main board', size: [140, 6, 46], position: [0, -8, 0], colour: [0.06, 0.35, 0.16] },
      { name: 'Left stick', size: [26, 26, 26], position: [-48, 14, 8], colour: [0.32, 0.32, 0.36] },
      { name: 'Right stick', size: [26, 26, 26], position: [48, 14, 8], colour: [0.32, 0.32, 0.36] },
      { name: 'Left stick module', size: [34, 18, 34], position: [-48, 2, 8], colour: [0.5, 0.12, 0.1] },
      { name: 'Right stick module', size: [34, 18, 34], position: [48, 2, 8], colour: [0.5, 0.12, 0.1] },
      { name: 'Button pad', size: [60, 8, 30], position: [10, -2, -4], colour: [0.85, 0.82, 0.76] },
      { name: 'Battery', size: [50, 14, 34], position: [0, -14, -6], colour: [0.75, 0.68, 0.2] },
      { name: 'Trigger spring', size: [70, 6, 6], position: [0, -24, 22], colour: [0.62, 0.62, 0.66] },
    ],
  },
];

const CUBE_INDICES = [
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
];

/** One cube centred on its position, in metres (samples are authored in millimetres). */
function cubeGeometry(size: [number, number, number], position: [number, number, number]) {
  const w = size[0] / 2000;
  const h = size[1] / 2000;
  const d = size[2] / 2000;
  const x = position[0] / 1000;
  const y = position[1] / 1000;
  const z = position[2] / 1000;
  const positions = [
    x - w, y - h, z + d, x + w, y - h, z + d, x + w, y + h, z + d, x - w, y + h, z + d,
    x - w, y - h, z - d, x + w, y - h, z - d, x + w, y + h, z - d, x - w, y + h, z - d,
    x - w, y + h, z - d, x + w, y + h, z - d, x + w, y + h, z + d, x - w, y + h, z + d,
    x - w, y - h, z - d, x + w, y - h, z - d, x + w, y - h, z + d, x - w, y - h, z + d,
    x + w, y - h, z - d, x + w, y + h, z - d, x + w, y + h, z + d, x + w, y - h, z + d,
    x - w, y - h, z - d, x - w, y + h, z - d, x - w, y + h, z + d, x - w, y - h, z + d,
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];
  return { positions, normals, indices: CUBE_INDICES };
}

function buildGlb(sample: SampleSpec): Uint8Array {
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const binChunks: Uint8Array[] = [];
  let byteOffset = 0;

  const append = (bytes: Uint8Array, target?: number): number => {
    const view: Record<string, unknown> = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target !== undefined) view.target = target;
    bufferViews.push(view);
    byteOffset += bytes.length;
    binChunks.push(bytes);
    return bufferViews.length - 1;
  };

  const f32 = (values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, true));
    return out;
  };
  const u32 = (values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);
    values.forEach((value, i) => view.setUint32(i * 4, value, true));
    return out;
  };

  const meshes: { primitives: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number }[] }[] = [];
  const nodes: { name?: string; mesh?: number; children?: number[] }[] = [];
  const materials: unknown[] = [];
  const nodeIndex = new Map<string, number[]>();
  const nodeIds: number[] = [];

  for (const box of sample.boxes) {
    const { positions, normals, indices } = cubeGeometry(box.size, box.position ?? [0, 0, 0]);
    const positionView = append(f32(positions), 34962);
    const normalView = append(f32(normals), 34962);
    const indexView = append(u32(indices), 34963);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      xs.push(positions[i]); ys.push(positions[i + 1]); zs.push(positions[i + 2]);
    }
    accessors.push({ componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)], bufferView: positionView });
    accessors.push({ componentType: 5126, count: normals.length / 3, type: 'VEC3', bufferView: normalView });
    accessors.push({ componentType: 5125, count: indices.length, type: 'SCALAR', bufferView: indexView });
    const colour = box.colour ?? [0.5, 0.5, 0.5];
    materials.push({ pbrMetallicRoughness: { baseColorFactor: [colour[0], colour[1], colour[2], 1], roughnessFactor: 0.85, metallicFactor: 0.05 } });
    const meshIndex = meshes.length;
    meshes.push({
      primitives: [{ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: materials.length - 1 }],
    });
    const node: { name?: string; mesh?: number; children?: number[] } = { name: box.name, mesh: meshIndex, children: [] };
    const index = nodes.length;
    nodes.push(node);
    nodeIds.push(index);
    const siblings = nodeIndex.get(box.name) ?? [];
    siblings.push(index);
    nodeIndex.set(box.name, siblings);
  }

  const roots: number[] = [];
  sample.boxes.forEach((box, i) => {
    if (box.parent) {
      const candidates = nodeIndex.get(box.parent) ?? [];
      const parentIndex = candidates.length > 0 ? candidates[0] : undefined;
      if (parentIndex !== undefined && parentIndex !== nodeIds[i]) nodes[parentIndex].children!.push(nodeIds[i]);
      else roots.push(nodeIds[i]);
    } else {
      roots.push(nodeIds[i]);
    }
  });

  let binLength = 0;
  for (const chunk of binChunks) binLength += chunk.length;
  const json = {
    asset: { version: '2.0', generator: 'pennywasher-samples' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  return packGlb(json, binChunks, binLength);
}

function pad4(n: number): number {
  return (4 - (n % 4)) % 4;
}

function packGlb(json: unknown, chunks: Uint8Array[], binLength: number): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = pad4(jsonBytes.length);
  // The chunk length in the header includes the padding.
  const paddedJsonLength = jsonBytes.length + jsonPad;
  const binPad = pad4(binLength);
  const paddedBinLength = binLength + binPad;
  const total = 12 + 8 + paddedJsonLength + (binLength > 0 ? 8 + paddedBinLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let offset = 20 + jsonBytes.length;
  for (let i = 0; i < jsonPad; i++) out[offset++] = 0x20;
  if (binLength > 0) {
    view.setUint32(offset, paddedBinLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    offset += 8;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    for (let i = 0; i < binPad; i++) out[offset++] = 0;
  }
  return out;
}

export function generateSamples(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const sample of SAMPLES) {
    const bytes = buildGlb(sample);
    writeFileSync(join(outDir, sample.file), bytes);
    console.log(`${sample.file}: ${bytes.length} bytes`);
  }
}

if (process.argv[2]) {
  generateSamples(process.argv[2]);
}
