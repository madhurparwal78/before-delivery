import type { GltfJson } from './gltf.js';
import { writeGlb } from './gltf.js';

interface MeshData {
  readonly positions: number[];
  readonly indices: number[];
}

function box(
  width: number,
  height: number,
  depth: number,
  centre: readonly [number, number, number],
): MeshData {
  const [cx, cy, cz] = centre;
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const corners: [number, number, number][] = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ];
  const positions: number[] = [];
  for (const c of corners) positions.push(...c);
  const indices: number[] = [];
  for (const f of faces) indices.push(...f);
  return { positions, indices };
}

function cylinder(
  radius: number,
  height: number,
  centre: readonly [number, number, number],
  segments: number,
): MeshData {
  const [cx, cy, cz] = centre;
  const positions: number[] = [];
  const indices: number[] = [];
  const bottom = cy - height / 2;
  const top = cy + height / 2;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + radius * Math.cos(angle);
    const z = cz + radius * Math.sin(angle);
    positions.push(x, bottom, z, x, top, z);
  }
  const centreBottom = segments * 2;
  const centreTop = centreBottom + 1;
  positions.push(cx, bottom, cz, cx, top, cz);
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % segments) * 2;
    const d = c + 1;
    indices.push(a, c, d, a, d, b);
    indices.push(centreBottom, c, a);
    indices.push(centreTop, b, d);
  }
  return { positions, indices };
}

function merge(parts: readonly MeshData[]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const part of parts) {
    positions.push(...part.positions);
    for (const i of part.indices) indices.push(i + base);
    base += part.positions.length / 3;
  }
  return { positions, indices };
}

/** Packs a mesh into a GLB with one binary buffer. */
function meshToGlb(mesh: MeshData): Buffer {
  const positions = Float32Array.from(mesh.positions);
  const indices = Uint32Array.from(mesh.indices);
  const positionBytes = Buffer.from(positions.buffer, 0, positions.byteLength);
  const indexBytes = Buffer.from(indices.buffer, 0, indices.byteLength);
  const bin = Buffer.concat([positionBytes, indexBytes]);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const json: GltfJson = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  return writeGlb(json, bin);
}

/**
 * A box and cylinder composite whose bounding box is exactly the given size, in
 * the model's source unit, centred on the origin.
 */
export function compositeGlb(width: number, height: number, depth: number): Buffer {
  // The wide shell sets the box's width and depth; the mast sets its height.
  const parts: MeshData[] = [
    box(width, height * 0.72, depth, [0, 0, 0]),
    box(width * 0.4, height, depth * 0.4, [0, 0, 0]),
    cylinder(Math.min(width, depth) * 0.18, height * 0.9, [0, 0, 0], 20),
    cylinder(Math.min(width, depth) * 0.4, height * 0.12, [0, -height * 0.44, 0], 24),
  ];
  return meshToGlb(merge(parts));
}
