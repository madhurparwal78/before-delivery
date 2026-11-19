import { jsonNestsDeeperThan } from './text';

/** The one place that decides what a binary glTF 2.0 file is: container and chunk checks, outside files, part limit,
 * node paths and extents. The browser runs it before it previews a drop and the server runs it again on upload. */

interface GltfNode {
  name?: unknown;
  mesh?: unknown;
  children?: unknown;
  matrix?: unknown;
  translation?: unknown;
  rotation?: unknown;
  scale?: unknown;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  normalized?: boolean;
}

export interface GltfPrimitive { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }

export interface GltfDocument {
  asset: { version: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { byteLength: number; uri?: string }[];
  images?: { uri?: string }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
}

export interface GlbNode {
  index: number;
  name: string;
  nodePath: string;
  mesh: number | null;
  /** model-space matrix (column-major), the product of every ancestor's matrix and its own */
  world: number[];
}

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export interface GlbPart { name: string; nodePath: string }

export interface GlbModel {
  document: GltfDocument;
  bin: Uint8Array | null;
  nodes: GlbNode[];
  parts: GlbPart[];
  /** axis-aligned bounds of every mesh in model space, in glTF units (metres) */
  bounds: Bounds;
}

type GlbRefusal =
  | { error: 'model_too_large'; limit: number }
  | { error: 'not_glb' }
  | { error: 'external_uri' }
  | { error: 'too_many_parts'; count: number; limit: number };

type GlbResult = { ok: true; model: GlbModel } | { ok: false; refusal: GlbRefusal };

interface GlbLimits { modelMaxBytes: number; modelMaxParts: number }

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_JSON_DEPTH = 64;
const UNNAMED = 'node';

const notGlb: GlbResult = { ok: false, refusal: { error: 'not_glb' } };

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  return out;
}

function numbers(value: unknown, length: number): number[] | null {
  return Array.isArray(value) && value.length === length && value.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? (value as number[])
    : null;
}

function localMatrix(node: GltfNode): number[] {
  const matrix = numbers(node.matrix, 16);
  if (matrix) return matrix;
  const [tx, ty, tz] = numbers(node.translation, 3) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = numbers(node.rotation, 4) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = numbers(node.scale, 3) ?? [1, 1, 1];
  const xx = qx! * qx!, yy = qy! * qy!, zz = qz! * qz!;
  const xy = qx! * qy!, xz = qx! * qz!, yz = qy! * qz!, wx = qw! * qx!, wy = qw! * qy!, wz = qw! * qz!;
  return [
    (1 - 2 * (yy + zz)) * sx!, 2 * (xy + wz) * sx!, 2 * (xz - wy) * sx!, 0,
    2 * (xy - wz) * sy!, (1 - 2 * (xx + zz)) * sy!, 2 * (yz + wx) * sy!, 0,
    2 * (xz + wy) * sz!, 2 * (yz - wx) * sz!, (1 - 2 * (xx + yy)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

function childIndices(node: GltfNode, count: number): number[] {
  return Array.isArray(node.children)
    ? node.children.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < count)
    : [];
}

/** Every node reachable from the default scene, in depth-first order, with its node path and matrices. */
function walkNodes(document: GltfDocument): GlbNode[] {
  const nodes = document.nodes ?? [];
  const scene = document.scenes?.[document.scene ?? 0];
  let roots = scene?.nodes?.filter((n) => Number.isInteger(n) && n >= 0 && n < nodes.length) ?? [];
  if (!scene) {
    const referenced = new Set(nodes.flatMap((n) => childIndices(n, nodes.length)));
    roots = nodes.map((_, i) => i).filter((i) => !referenced.has(i));
  }
  const result: GlbNode[] = [];
  const seen = new Set<number>();
  const visit = (siblings: number[], prefix: string, parentWorld: number[]): void => {
    const counts = new Map<string, number>();
    for (const index of siblings) {
      const node = nodes[index];
      if (!node || seen.has(index)) continue;
      seen.add(index);
      const name = typeof node.name === 'string' && node.name !== '' ? node.name : UNNAMED;
      const k = counts.get(name) ?? 0;
      counts.set(name, k + 1);
      const nodePath = `${prefix}${name}[${k}]`;
      const world = multiplyMatrices(parentWorld, localMatrix(node));
      result.push({ index, name, nodePath, mesh: Number.isInteger(node.mesh) ? (node.mesh as number) : null, world });
      visit(childIndices(node, nodes.length), `${nodePath}/`, world);
    }
  };
  visit(roots, '', identityMatrix());
  return result;
}

function boundsOf(document: GltfDocument, nodes: readonly GlbNode[]): Bounds {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    if (node.mesh === null) continue;
    for (const primitive of document.meshes?.[node.mesh]?.primitives ?? []) {
      const accessor = document.accessors?.[primitive.attributes?.POSITION ?? -1];
      const min = numbers(accessor?.min, 3);
      const max = numbers(accessor?.max, 3);
      if (!min || !max) continue;
      for (let corner = 0; corner < 8; corner++) {
        const point = [corner & 1 ? max[0]! : min[0]!, corner & 2 ? max[1]! : min[1]!, corner & 4 ? max[2]! : min[2]!];
        for (let axis = 0; axis < 3; axis++) {
          const v = node.world[axis]! * point[0]! + node.world[4 + axis]! * point[1]! + node.world[8 + axis]! * point[2]! + node.world[12 + axis]!;
          low[axis] = Math.min(low[axis]!, v);
          high[axis] = Math.max(high[axis]!, v);
        }
      }
    }
  }
  return low.every(Number.isFinite)
    ? { min: [low[0]!, low[1]!, low[2]!], max: [high[0]!, high[1]!, high[2]!] }
    : { min: [0, 0, 0], max: [0, 0, 0] };
}

function hasOutsideFile(document: GltfDocument): boolean {
  const lists = [document.buffers, document.images];
  return lists.some((list) => Array.isArray(list) && list.some((entry) => entry !== null && typeof entry === 'object' && 'uri' in entry));
}

export function checkGlb(bytes: Uint8Array, limits: GlbLimits): GlbResult {
  if (bytes.byteLength > limits.modelMaxBytes) return { ok: false, refusal: { error: 'model_too_large', limit: limits.modelMaxBytes } };
  if (bytes.byteLength < 20) return notGlb;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) return notGlb;
  const jsonLength = view.getUint32(12, true);
  const jsonEnd = 20 + jsonLength;
  if (view.getUint32(16, true) !== JSON_CHUNK || jsonEnd > bytes.byteLength) return notGlb;
  let bin: Uint8Array | null = null;
  if (jsonEnd < bytes.byteLength) {
    if (jsonEnd + 8 > bytes.byteLength) return notGlb;
    const binLength = view.getUint32(jsonEnd, true);
    if (view.getUint32(jsonEnd + 4, true) !== BIN_CHUNK || jsonEnd + 8 + binLength !== bytes.byteLength) return notGlb;
    bin = bytes.subarray(jsonEnd + 8, jsonEnd + 8 + binLength);
  }
  let document: GltfDocument;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, jsonEnd)).replace(/[\u0000\s]+$/, '');
    if (jsonNestsDeeperThan(text, MAX_JSON_DEPTH)) return notGlb;
    document = JSON.parse(text) as GltfDocument;
  } catch {
    return notGlb;
  }
  if (document === null || typeof document !== 'object' || document.asset?.version !== '2.0') return notGlb;
  if (hasOutsideFile(document)) return { ok: false, refusal: { error: 'external_uri' } };
  const nodes = walkNodes(document);
  const parts = nodes.filter((n) => n.mesh !== null).map((n) => ({ name: n.name, nodePath: n.nodePath }));
  if (parts.length > limits.modelMaxParts) return { ok: false, refusal: { error: 'too_many_parts', count: parts.length, limit: limits.modelMaxParts } };
  return { ok: true, model: { document, bin, nodes, parts, bounds: boundsOf(document, nodes) } };
}
