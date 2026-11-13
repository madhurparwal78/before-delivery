import { COPY } from "./copy";

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
}

type ModelKind = "glb" | "gltf";
type ModelError = "type" | "damaged" | "external";
type ParsedModel = { ok: true; kind: ModelKind; json: GltfDocument } | { ok: false; error: ModelError };

export const MODEL_ERROR_COPY: Record<ModelError, string> = {
  type: COPY.uploadType,
  damaged: COPY.uploadDamaged,
  external: COPY.uploadExternal,
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function glbJson(bytes: Uint8Array): GltfDocument | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) return null;
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + length > bytes.length) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + length)));
    return isRecord(parsed) ? (parsed as GltfDocument) : null;
  } catch {
    return null;
  }
}

function startsWithMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

/** Decides GLB or glTF by content only. A body that starts with `glTF` but is not a sound GLB is damaged. */
export function parseModel(bytes: Uint8Array): ParsedModel {
  if (startsWithMagic(bytes)) {
    const json = glbJson(bytes);
    return json && json.asset?.version === "2.0" ? checkSelfContained("glb", json) : { ok: false, error: "damaged" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: "type" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.asset) || parsed.asset.version !== "2.0") return { ok: false, error: "type" };
  return checkSelfContained("gltf", parsed as GltfDocument);
}

function checkSelfContained(kind: ModelKind, json: GltfDocument): ParsedModel {
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((entry) => entry?.uri);
  if (uris.some((uri) => uri !== undefined && !(typeof uri === "string" && uri.startsWith("data:")))) return { ok: false, error: "external" };
  return { ok: true, kind, json };
}

type Matrix = number[];

function identity(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node: GltfNode): Matrix {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const rotation: Matrix = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  const translation: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
  const scale: Matrix = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  return multiply(multiply(translation, rotation), scale);
}

function isTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * The extent rule: the default scene's nodes, each primitive's POSITION min/max box through the node's world
 * transform, bounded together. Returns null when the model is damaged.
 */
export function modelBounds(json: GltfDocument): Bounds | null {
  const sceneIndex = json.scene ?? 0;
  const scene = json.scenes?.[sceneIndex];
  if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(json.nodes)) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let meshes = 0;
  let damaged = false;
  const nodes = json.nodes;
  const visit = (index: number, parent: Matrix, depth: number): void => {
    const node = nodes[index];
    if (!node || depth > 64) {
      damaged = true;
      return;
    }
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
        const accessor = json.accessors?.[primitive.attributes?.POSITION ?? -1];
        if (!accessor || !isTriple(accessor.min) || !isTriple(accessor.max)) {
          damaged = true;
          return;
        }
        meshes++;
        for (let corner = 0; corner < 8; corner++) {
          const point = [corner & 1 ? accessor.max[0] : accessor.min[0], corner & 2 ? accessor.max[1] : accessor.min[1], corner & 4 ? accessor.max[2] : accessor.min[2]];
          for (let axis = 0; axis < 3; axis++) {
            const value = world[axis] * point[0] + world[4 + axis] * point[1] + world[8 + axis] * point[2] + world[12 + axis];
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  for (const root of scene.nodes) visit(root, identity(), 0);
  if (damaged || meshes === 0 || ![...min, ...max].every(Number.isFinite)) return null;
  return { min, max };
}

export function extentOf(bounds: Bounds): number {
  return Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
}

export const UNIT_SCALE: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
export const UPLOAD_UNITS = ["m", "cm", "mm", "in", "ft"] as const;
export const MIN_EXTENT = 0.01;
export const MAX_EXTENT = 100;

/** Bounds of a stored model's bytes, for colliders; null for anything that is not a sound model. */
export function boundsOfBytes(bytes: Uint8Array): Bounds | null {
  const parsed = parseModel(bytes);
  return parsed.ok ? modelBounds(parsed.json) : null;
}
