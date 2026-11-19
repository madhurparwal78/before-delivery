/**
 * Binary glTF 2.0 container checks, part discovery and node paths.
 * This is the one place the rules live; the browser runs it on drop and the
 * server runs it on upload, where the server decides.
 */

export const GLB_MAGIC = 0x46546c67;
export const CHUNK_JSON = 0x4e4f534a;
export const CHUNK_BIN = 0x004e4942;
export const GLB_JSON_MAX_DEPTH = 64;

export type GlbRefusal =
  | { error: 'model_too_large'; limit: number }
  | { error: 'not_glb' }
  | { error: 'external_uri' }
  | { error: 'too_many_parts'; count: number; limit: number };

export interface GlbPart {
  name: string;
  nodePath: string;
  /** The part's own material colour, so only focus parts can keep it. */
  colour: [number, number, number];
  /** Model-space bounds in metres, used for the server-drawn stills. */
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

export interface GlbInspection {
  parts: GlbPart[];
  bboxMm: [number, number, number];
  json: GltfDocument;
  binOffset: number | null;
  binLength: number;
}

export type GlbCheck =
  | { ok: true; value: GlbInspection }
  | { ok: false; refusal: GlbRefusal };

export interface GlbLimits {
  model_max_bytes: number;
  model_max_parts: number;
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfPrimitive {
  attributes?: Record<string, number>;
  material?: number;
}

interface GltfMesh {
  primitives?: GltfPrimitive[];
}

interface GltfMaterial {
  pbrMetallicRoughness?: { baseColorFactor?: number[] };
}

interface GltfAccessor {
  min?: number[];
  max?: number[];
}

interface GltfScene {
  nodes?: number[];
}

export interface GltfDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  buffers?: { uri?: string; byteLength?: number }[];
  images?: { uri?: string }[];
}

/** Maximum bracket nesting depth of a JSON text, ignoring brackets in strings. */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 0x5c) escaped = true;
      else if (ch === 0x22) inString = false;
      continue;
    }
    if (ch === 0x22) inString = true;
    else if (ch === 0x7b || ch === 0x5b) {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === 0x7d || ch === 0x5d) depth -= 1;
  }
  return max;
}

type Matrix4 = number[];

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out: Matrix4 = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node: GltfNode): Matrix4 {
  if (node.matrix && node.matrix.length === 16) return node.matrix.slice();
  const [tx, ty, tz] = [node.translation?.[0] ?? 0, node.translation?.[1] ?? 0, node.translation?.[2] ?? 0];
  const [qx, qy, qz, qw] = [
    node.rotation?.[0] ?? 0,
    node.rotation?.[1] ?? 0,
    node.rotation?.[2] ?? 0,
    node.rotation?.[3] ?? 1,
  ];
  const [sx, sy, sz] = [node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1];
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
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function applyMatrix(m: Matrix4, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/**
 * A node path joins the segments from the root node down with `/`, each
 * segment being `<node name>[<k>]` where k counts from 0 among siblings with
 * the same name. An unnamed node uses the name `node`.
 */
export function nodeSegment(name: string, index: number): string {
  return `${name}[${index}]`;
}

function siblingSegments(indices: readonly number[], nodes: readonly GltfNode[]): string[] {
  const seen = new Map<string, number>();
  return indices.map((nodeIndex) => {
    const name = nodes[nodeIndex]?.name || 'node';
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    return nodeSegment(name, k);
  });
}

function rootNodeIndices(json: GltfDocument): number[] {
  const scenes = json.scenes ?? [];
  const sceneIndex = json.scene ?? 0;
  const scene = scenes[sceneIndex] ?? scenes[0];
  if (scene?.nodes) return scene.nodes.slice();
  const nodes = json.nodes ?? [];
  const child = new Set<number>();
  for (const node of nodes) for (const c of node.children ?? []) child.add(c);
  return nodes.map((_, i) => i).filter((i) => !child.has(i));
}

interface WalkedNode {
  index: number;
  path: string;
  world: Matrix4;
}

/** Depth-first preorder, so parts read in the order the nodes are written. */
function walkNodes(json: GltfDocument): WalkedNode[] {
  const nodes = json.nodes ?? [];
  const out: WalkedNode[] = [];
  const visited = new Set<number>();
  const roots = rootNodeIndices(json);
  const rootSegments = siblingSegments(roots, nodes);
  const stack: WalkedNode[] = roots
    .map((index, i) => ({
      index,
      path: rootSegments[i] ?? 'node[0]',
      world: multiply(IDENTITY, localMatrix(nodes[index] ?? {})),
    }))
    .reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current.index)) continue;
    visited.add(current.index);
    out.push(current);
    const children = nodes[current.index]?.children ?? [];
    const segments = siblingSegments(children, nodes);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const childIndex = children[i];
      if (childIndex === undefined) continue;
      stack.push({
        index: childIndex,
        path: `${current.path}/${segments[i] ?? 'node[0]'}`,
        world: multiply(current.world, localMatrix(nodes[childIndex] ?? {})),
      });
    }
  }
  return out;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

const EMPTY_BOUNDS = (): Bounds => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});

function widen(bounds: Bounds, x: number, y: number, z: number): void {
  if (x < bounds.min[0]) bounds.min[0] = x;
  if (y < bounds.min[1]) bounds.min[1] = y;
  if (z < bounds.min[2]) bounds.min[2] = z;
  if (x > bounds.max[0]) bounds.max[0] = x;
  if (y > bounds.max[1]) bounds.max[1] = y;
  if (z > bounds.max[2]) bounds.max[2] = z;
}

function settled(bounds: Bounds): Bounds {
  if (!Number.isFinite(bounds.min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return bounds;
}

/**
 * The node path of every node, by its glTF node index. The browser uses this
 * to bind parts to loaded objects without depending on how a loader may
 * rewrite node names.
 */
export function nodePathsByIndex(json: GltfDocument): Map<number, string> {
  return new Map(walkNodes(json).map((walked) => [walked.index, walked.path]));
}

/** Parts are nodes with a mesh, in document walk order. */
export function partsOf(json: GltfDocument): { parts: GlbPart[]; bboxMm: [number, number, number] } {
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const materials = json.materials ?? [];
  const accessors = json.accessors ?? [];
  const whole = EMPTY_BOUNDS();
  const parts: GlbPart[] = [];

  for (const walked of walkNodes(json)) {
    const meshIndex = nodes[walked.index]?.mesh;
    if (meshIndex === undefined) continue;
    const own = EMPTY_BOUNDS();
    let colour: [number, number, number] = [0.6, 0.6, 0.6];
    for (const primitive of meshes[meshIndex]?.primitives ?? []) {
      const factor = materials[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor;
      if (factor && factor.length >= 3) {
        colour = [factor[0] ?? 0.6, factor[1] ?? 0.6, factor[2] ?? 0.6];
      }
      const positionAccessor = primitive.attributes?.['POSITION'];
      if (positionAccessor === undefined) continue;
      const accessor = accessors[positionAccessor];
      const lo = accessor?.min;
      const hi = accessor?.max;
      if (!lo || !hi || lo.length < 3 || hi.length < 3) continue;
      for (let corner = 0; corner < 8; corner += 1) {
        const [x, y, z] = applyMatrix(
          walked.world,
          (corner & 1) === 0 ? lo[0] ?? 0 : hi[0] ?? 0,
          (corner & 2) === 0 ? lo[1] ?? 0 : hi[1] ?? 0,
          (corner & 4) === 0 ? lo[2] ?? 0 : hi[2] ?? 0,
        );
        widen(own, x, y, z);
        widen(whole, x, y, z);
      }
    }
    const bounds = settled(own);
    parts.push({
      name: nodes[walked.index]?.name || 'node',
      nodePath: walked.path,
      colour,
      bboxMin: bounds.min,
      bboxMax: bounds.max,
    });
  }

  const outer = settled(whole);
  const round = (value: number): number => Math.round(value * 1_000_000) / 1000;
  return {
    parts,
    bboxMm: [
      round(outer.max[0] - outer.min[0]),
      round(outer.max[1] - outer.min[1]),
      round(outer.max[2] - outer.min[2]),
    ],
  };
}

/**
 * Checks run in this order and the first failure decides: byte limit,
 * container and chunk checks, outside files, part limit.
 */
export function checkGlb(bytes: Uint8Array, limits: GlbLimits): GlbCheck {
  if (bytes.byteLength > limits.model_max_bytes) {
    return { ok: false, refusal: { error: 'model_too_large', limit: limits.model_max_bytes } };
  }
  const notGlb: GlbCheck = { ok: false, refusal: { error: 'not_glb' } };
  if (bytes.byteLength < 20) return notGlb;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return notGlb;
  if (view.getUint32(4, true) !== 2) return notGlb;
  if (view.getUint32(8, true) !== bytes.byteLength) return notGlb;

  let offset = 12;
  let jsonText: string | null = null;
  let binOffset: number | null = null;
  let binLength = 0;
  let chunkIndex = 0;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const padded = chunkLength + ((4 - (chunkLength % 4)) % 4);
    if (dataStart + chunkLength > bytes.byteLength) return notGlb;
    if (chunkIndex === 0 && chunkType !== CHUNK_JSON) return notGlb;
    if (chunkType === CHUNK_JSON) {
      if (jsonText !== null) return notGlb;
      jsonText = new TextDecoder().decode(bytes.subarray(dataStart, dataStart + chunkLength));
    } else if (chunkType === CHUNK_BIN) {
      if (binOffset !== null) return notGlb;
      binOffset = dataStart;
      binLength = chunkLength;
    }
    offset = dataStart + padded;
    chunkIndex += 1;
  }
  if (jsonText === null || offset !== bytes.byteLength) return notGlb;
  if (jsonDepth(jsonText) > GLB_JSON_MAX_DEPTH) return notGlb;

  let json: GltfDocument;
  try {
    json = JSON.parse(jsonText) as GltfDocument;
  } catch {
    return notGlb;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return notGlb;
  if (json.asset?.version !== '2.0') return notGlb;

  for (const buffer of json.buffers ?? []) {
    if (typeof buffer.uri === 'string') return { ok: false, refusal: { error: 'external_uri' } };
  }
  for (const image of json.images ?? []) {
    if (typeof image.uri === 'string') return { ok: false, refusal: { error: 'external_uri' } };
  }

  const { parts, bboxMm } = partsOf(json);
  if (parts.length > limits.model_max_parts) {
    return {
      ok: false,
      refusal: { error: 'too_many_parts', count: parts.length, limit: limits.model_max_parts },
    };
  }
  return { ok: true, value: { parts, bboxMm, json, binOffset, binLength } };
}

/**
 * The part label: the part name alone when unique in the guide, otherwise the
 * name, one space, then the full node path in round brackets.
 */
export function partLabel(
  name: string,
  nodePath: string | null,
  nameCounts: ReadonlyMap<string, number>,
): string {
  if ((nameCounts.get(name) ?? 0) <= 1) return name;
  return `${name} (${nodePath ?? ''})`;
}

export function partNameCounts(parts: readonly { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  return counts;
}
