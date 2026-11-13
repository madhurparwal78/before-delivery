import type { GltfMesh, GltfModel, GltfNode } from './gltf';
import { mulberry32 } from './particles';

function node(name: string, mesh: number): GltfNode {
  return {
    name,
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    mesh,
    children: [],
  };
}

function pebbleMesh(): GltfMesh {
  const random = mulberry32(21);
  const radial = 16;
  const rings = 10;
  const mesh: GltfMesh = { positions: [], indices: [] };
  const radii: number[][] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    radii.push([]);
    for (let seg = 0; seg <= radial; seg += 1) {
      radii[ring].push(0.42 + random() * 0.12);
    }
  }
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    for (let seg = 0; seg <= radial; seg += 1) {
      const theta = (seg / radial) * Math.PI * 2;
      const radius = radii[ring][seg % radial];
      mesh.positions.push(
        radius * Math.sin(phi) * Math.cos(theta) * 1.2,
        radius * Math.cos(phi) * 0.8,
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const stride = radial + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let seg = 0; seg < radial; seg += 1) {
      const a = ring * stride + seg;
      const b = a + stride;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh;
}

function boxInto(mesh: GltfMesh, min: [number, number, number], max: [number, number, number]): void {
  const base = mesh.positions.length / 3;
  const corners: [number, number, number][] = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], max[2]],
    [min[0], max[1], max[2]],
  ];
  for (const corner of corners) mesh.positions.push(corner[0], corner[1], corner[2]);
  const faces = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 4, 7, 3],
    [5, 1, 2, 6],
    [3, 7, 6, 2],
    [0, 1, 5, 4],
  ];
  for (const face of faces) {
    mesh.indices.push(base + face[0], base + face[1], base + face[2]);
    mesh.indices.push(base + face[0], base + face[2], base + face[3]);
  }
}

function archMesh(): GltfMesh {
  const mesh: GltfMesh = { positions: [], indices: [] };
  boxInto(mesh, [-0.5, -0.6, -0.12], [-0.3, 0.2, 0.12]);
  boxInto(mesh, [0.3, -0.6, -0.12], [0.5, 0.2, 0.12]);
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI;
    const a1 = ((i + 1) / segments) * Math.PI;
    const inner = 0.3;
    const outer = 0.5;
    const x0 = Math.cos(a0);
    const x1 = Math.cos(a1);
    const y0 = Math.sin(a0);
    const y1 = Math.sin(a1);
    const base = mesh.positions.length / 3;
    const ring: [number, number, number][] = [
      [x0 * inner, 0.2 + y0 * inner, -0.12],
      [x0 * outer, 0.2 + y0 * outer, -0.12],
      [x1 * outer, 0.2 + y1 * outer, -0.12],
      [x1 * inner, 0.2 + y1 * inner, -0.12],
      [x0 * inner, 0.2 + y0 * inner, 0.12],
      [x0 * outer, 0.2 + y0 * outer, 0.12],
      [x1 * outer, 0.2 + y1 * outer, 0.12],
      [x1 * inner, 0.2 + y1 * inner, 0.12],
    ];
    for (const point of ring) mesh.positions.push(point[0], point[1], point[2]);
    const faces = [
      [4, 5, 6, 7],
      [1, 0, 3, 2],
      [0, 4, 7, 3],
      [5, 1, 2, 6],
      [3, 7, 6, 2],
      [0, 1, 5, 4],
    ];
    for (const face of faces) {
      mesh.indices.push(base + face[0], base + face[1], base + face[2]);
      mesh.indices.push(base + face[0], base + face[2], base + face[3]);
    }
  }
  return mesh;
}

function latticeMesh(): GltfMesh {
  const mesh: GltfMesh = { positions: [], indices: [] };
  const count = 4;
  const bar = 0.04;
  for (let i = 0; i <= count; i += 1) {
    const offset = -0.5 + i / count;
    boxInto(mesh, [offset - bar, -0.5, -bar], [offset + bar, 0.5, bar]);
    boxInto(mesh, [-0.5, offset - bar, -bar], [0.5, offset + bar, bar]);
  }
  return mesh;
}

const CACHE = new Map<string, GltfModel>();

/** Preset models are generated in code, never shipped as files. */
export function presetModel(name: string): GltfModel | null {
  const cached = CACHE.get(name);
  if (cached) return cached;
  let mesh: GltfMesh | null = null;
  if (name === 'Pebble') mesh = pebbleMesh();
  else if (name === 'Arch') mesh = archMesh();
  else if (name === 'Lattice') mesh = latticeMesh();
  if (!mesh) return null;
  const model: GltfModel = {
    nodes: [node(name, 0)],
    meshes: [mesh],
    clips: [],
    vertexCount: mesh.positions.length / 3,
  };
  CACHE.set(name, model);
  return model;
}
