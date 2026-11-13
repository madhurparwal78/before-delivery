// GLB acceptance (header, chunks, JSON rules) and measurement (dequantized bounds through world transforms).
import { ApiError } from "../errors.js";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const SUPPORTED_REQUIRED = ["KHR_mesh_quantization", "KHR_draco_mesh_compression", "EXT_meshopt_compression"];
const QUANTIZED_TYPES = [5120, 5121, 5122, 5123];
const MAX_JSON_BYTES = 64 * 1024 * 1024;

type Accessor = { componentType?: number; normalized?: boolean; min?: unknown; max?: unknown };
type Primitive = { attributes?: { POSITION?: number } };
type Node = { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
export type Gltf = {
  asset?: { version?: unknown };
  extensionsUsed?: unknown;
  extensionsRequired?: unknown;
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: Node[];
  meshes?: { primitives?: Primitive[] }[];
  accessors?: Accessor[];
};

const malformed = (): ApiError => new ApiError("gltf_malformed");

/** Where reading the stream must reach before the GLB can be judged, and what has been learnt so far. */
type GlbProgress = { totalLength: number; doc: Gltf | null; needed: number };

function checkJson(doc: Gltf): void {
  if (doc.asset?.version !== "2.0") throw malformed();
  const used = Array.isArray(doc.extensionsUsed) ? doc.extensionsUsed : [];
  const required = Array.isArray(doc.extensionsRequired) ? doc.extensionsRequired : [];
  for (const name of required) if (!used.includes(name) || !SUPPORTED_REQUIRED.includes(String(name))) throw malformed();
  for (const node of doc.nodes ?? []) {
    if (node.matrix !== undefined && (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)) throw malformed();
  }
  const quantized = required.includes("KHR_mesh_quantization");
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const index = primitive.attributes?.POSITION;
      const accessor = typeof index === "number" ? doc.accessors?.[index] : undefined;
      if (!accessor) continue;
      const type = accessor.componentType;
      if (type !== 5126 && !(quantized && type !== undefined && QUANTIZED_TYPES.includes(type))) throw malformed();
    }
  }
}

/**
 * Judges the GLB from its first bytes. Returns how many bytes are needed before it can go on; once the header, the
 * JSON chunk and the second chunk's header have passed, `needed` is 0 and the rest only has to match the header length.
 */
export function inspectGlb(prefix: Buffer): GlbProgress {
  if (prefix.length < 12) return { totalLength: 0, doc: null, needed: 12 };
  if (prefix.readUInt32LE(4) !== 2) throw malformed();
  const totalLength = prefix.readUInt32LE(8);
  if (prefix.length < 20) return { totalLength, doc: null, needed: 20 };
  const jsonLength = prefix.readUInt32LE(12);
  if (prefix.readUInt32LE(16) !== JSON_CHUNK || jsonLength % 4 !== 0 || 20 + jsonLength > totalLength || jsonLength > MAX_JSON_BYTES) throw malformed();
  if (prefix.length < 20 + jsonLength) return { totalLength, doc: null, needed: 20 + jsonLength };
  let doc: Gltf;
  try {
    doc = JSON.parse(prefix.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  } catch {
    throw malformed();
  }
  if (!doc || typeof doc !== "object") throw malformed();
  checkJson(doc);
  const binStart = 20 + jsonLength;
  if (totalLength > binStart) {
    if (totalLength < binStart + 8) throw malformed();
    if (prefix.length < binStart + 8) return { totalLength, doc, needed: binStart + 8 };
    const binLength = prefix.readUInt32LE(binStart);
    if (prefix.readUInt32LE(binStart + 4) !== BIN_CHUNK || binLength % 4 !== 0 || binStart + 8 + binLength > totalLength) throw malformed();
  }
  return { totalLength, doc, needed: 0 };
}

// ---------- measurement ----------

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  return out;
}

function localMatrix(node: Node): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = node.rotation ?? [0, 0, 0, 1];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ] as const;
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx ?? 0, ty ?? 0, tz ?? 0, 1];
}

/** A stored component value as the number it stands for: normalized integers map into [-1, 1] or [0, 1]. */
function dequantize(value: number, accessor: Accessor): number {
  if (!accessor.normalized) return value;
  switch (accessor.componentType) {
    case 5120:
      return Math.max(value / 127, -1);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(value / 32767, -1);
    case 5123:
      return value / 65535;
    default:
      return value;
  }
}

const isVec3 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

export type Dimensions = { x: number; y: number; z: number };

/** The axis-aligned box around every counted primitive's corners in world space, in metres as exported; null when it cannot be measured. */
export function measureGltf(doc: Gltf): Dimensions | null {
  const nodes = doc.nodes ?? [];
  let roots: number[];
  if (doc.scenes && doc.scenes.length > 0) {
    const scene = doc.scenes[doc.scene ?? 0];
    if (!scene) return null;
    roots = scene.nodes ?? [];
  } else {
    const children = new Set(nodes.flatMap((n) => n.children ?? []));
    roots = nodes.map((_, i) => i).filter((i) => !children.has(i));
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let counted = 0;
  const visit = (index: number, parent: Mat4, path: Set<number>): boolean => {
    const node = nodes[index];
    if (!node || path.has(index)) return false;
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = doc.meshes?.[node.mesh];
      if (!mesh) return false;
      for (const primitive of mesh.primitives ?? []) {
        const position = primitive.attributes?.POSITION;
        if (position === undefined) continue;
        const accessor = doc.accessors?.[position];
        if (!accessor) return false;
        if (!isVec3(accessor.min) || !isVec3(accessor.max)) continue;
        const lo = accessor.min.map((v) => dequantize(v, accessor));
        const hi = accessor.max.map((v) => dequantize(v, accessor));
        for (const cx of [lo[0] ?? 0, hi[0] ?? 0])
          for (const cy of [lo[1] ?? 0, hi[1] ?? 0])
            for (const cz of [lo[2] ?? 0, hi[2] ?? 0]) {
              const p = [0, 1, 2].map((r) => (world[r] ?? 0) * cx + (world[4 + r] ?? 0) * cy + (world[8 + r] ?? 0) * cz + (world[12 + r] ?? 0));
              p.forEach((v, axis) => {
                min[axis] = Math.min(min[axis] ?? v, v);
                max[axis] = Math.max(max[axis] ?? v, v);
              });
            }
        counted++;
      }
    }
    const inner = new Set(path).add(index);
    return (node.children ?? []).every((child) => visit(child, world, inner));
  };
  if (!roots.every((root) => visit(root, IDENTITY, new Set()))) return null;
  if (counted === 0) return null;
  return { x: (max[0] ?? 0) - (min[0] ?? 0), y: (max[1] ?? 0) - (min[1] ?? 0), z: (max[2] ?? 0) - (min[2] ?? 0) };
}
