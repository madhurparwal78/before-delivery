import { fieldCopy } from './copy.js';
import { roundTo } from './dmath.js';

export const MAX_UPLOAD_BYTES = 10_000_000;
export const MAX_JSON_BYTES = 1_000_000;
export const MIN_EXTENT_METRES = 0.01;
export const MAX_EXTENT_METRES = 100;

export type AssetKind = 'glb' | 'gltf' | 'png' | 'jpeg';
export type ModelUnit = 'm' | 'cm' | 'mm' | 'in' | 'ft';

export const MODEL_UNITS: readonly ModelUnit[] = ['m', 'cm', 'mm', 'in', 'ft'];

const UNIT_SCALES: Record<ModelUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
};

export function scaleToMetres(unit: ModelUnit): number {
  return UNIT_SCALES[unit];
}

export function isModelUnit(value: string): value is ModelUnit {
  return (MODEL_UNITS as readonly string[]).includes(value);
}

export const CONTENT_TYPES: Record<AssetKind, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  png: 'image/png',
  jpeg: 'image/jpeg',
};

export function assetFolder(kind: AssetKind): 'Models' | 'Images' {
  return kind === 'glb' || kind === 'gltf' ? 'Models' : 'Images';
}

export type UploadFailure = { readonly field: 'file' | 'name' | 'unit'; readonly message: string };

export function checkUploadName(name: string): UploadFailure | null {
  const points = [...name];
  if (points.length < 1 || points.length > 120)
    return { field: 'name', message: fieldCopy.uploadName };
  if (name.includes('/') || name.includes('\\') || name.includes('..'))
    return { field: 'name', message: fieldCopy.uploadName };
  for (const character of points) {
    const code = character.codePointAt(0) as number;
    if (code <= 0x1f || code === 0x7f) return { field: 'name', message: fieldCopy.uploadName };
  }
  return null;
}

/* ------------------------------------------------------- content sniffing -- */

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GLTF_MAGIC = [0x67, 0x6c, 0x54, 0x46];

export type SniffResult =
  | { readonly kind: 'png' | 'jpeg' }
  | { readonly kind: 'glb' | 'gltf'; readonly json: GltfJson }
  | { readonly failure: UploadFailure };

export interface GltfJson {
  asset?: { version?: unknown };
  scene?: unknown;
  scenes?: { nodes?: unknown; name?: unknown }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: Record<string, unknown> }[] }[];
  accessors?: { min?: unknown; max?: unknown }[];
  buffers?: { uri?: unknown }[];
  images?: { uri?: unknown }[];
}

export interface GltfNode {
  children?: unknown;
  matrix?: unknown;
  mesh?: unknown;
  rotation?: unknown;
  scale?: unknown;
  translation?: unknown;
}

/** The kind is decided only by content, never by the name's extension. */
export function sniffUpload(bytes: Uint8Array): SniffResult {
  if (startsWith(bytes, PNG_SIGNATURE)) return { kind: 'png' };
  if (startsWith(bytes, JPEG_SIGNATURE)) return { kind: 'jpeg' };
  if (startsWith(bytes, GLTF_MAGIC)) {
    if (bytes.length < 20) return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
    const version = readUint32LE(bytes, 4);
    const declaredLength = readUint32LE(bytes, 8);
    if (version !== 2 || declaredLength !== bytes.length)
      return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
    const json = readGlbJsonChunk(bytes);
    if (!json) return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
    return { kind: 'glb', json };
  }
  const text = tryDecodeUtf8(bytes);
  if (text !== null) {
    const parsed = tryParseJsonObject(text);
    if (parsed && typeof parsed.asset === 'object' && parsed.asset !== null) {
      if ((parsed.asset as { version?: unknown }).version === '2.0')
        return { kind: 'gltf', json: parsed };
      return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
    }
    if (parsed) return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
  }
  return { failure: { field: 'file', message: fieldCopy.uploadType } };
}

function readGlbJsonChunk(bytes: Uint8Array): GltfJson | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32LE(bytes, offset);
    const chunkType = readUint32LE(bytes, offset + 4);
    const start = offset + 8;
    if (start + chunkLength > bytes.length) return null;
    if (chunkType === 0x4e4f534a) {
      const text = tryDecodeUtf8(bytes.subarray(start, start + chunkLength));
      if (text === null) return null;
      const parsed = tryParseJsonObject(text);
      if (!parsed) return null;
      const asset = parsed.asset;
      if (typeof asset !== 'object' || asset === null) return null;
      if ((asset as { version?: unknown }).version !== '2.0') return null;
      return parsed;
    }
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  return null;
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function tryParseJsonObject(text: string): GltfJson | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as GltfJson;
  } catch {
    return null;
  }
}

/** Self-contained means every buffer and image uri is a data uri. */
export function checkSelfContained(json: GltfJson): UploadFailure | null {
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((entry) => entry.uri)
    .filter((uri): uri is string => typeof uri === 'string');
  if (uris.some((uri) => !uri.startsWith('data:')))
    return { field: 'file', message: fieldCopy.uploadExternal };
  return null;
}

/* ------------------------------------------------------------ extent rule -- */

type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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

function numberTriple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return value.every((part) => typeof part === 'number' && Number.isFinite(part))
    ? (value as [number, number, number])
    : fallback;
}

function nodeLocalMatrix(node: GltfNode): Matrix {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    const matrix = node.matrix as number[];
    if (matrix.every((part) => typeof part === 'number' && Number.isFinite(part))) return matrix;
  }
  const [tx, ty, tz] = numberTriple(node.translation, [0, 0, 0]);
  const [sx, sy, sz] = numberTriple(node.scale, [1, 1, 1]);
  const rotation =
    Array.isArray(node.rotation) &&
    node.rotation.length === 4 &&
    node.rotation.every((part) => typeof part === 'number' && Number.isFinite(part))
      ? (node.rotation as [number, number, number, number])
      : ([0, 0, 0, 1] as [number, number, number, number]);
  const [x, y, z, w] = rotation;
  const rotationMatrix: Matrix = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
  const scaleMatrix: Matrix = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  const translation: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
  return multiply(translation, multiply(rotationMatrix, scaleMatrix));
}

function transformPoint(matrix: Matrix, point: [number, number, number]): [number, number, number] {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

export type ExtentResult =
  | { readonly ok: true; readonly extentMetres: number }
  | { readonly failure: UploadFailure };

/** Measures the model through its default scene's node transforms. */
export function measureExtent(json: GltfJson, unit: ModelUnit): ExtentResult {
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const index = typeof json.scene === 'number' ? json.scene : 0;
  const scene = scenes[index];
  if (!scene) return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };
  const roots = Array.isArray(scene.nodes) ? (scene.nodes as unknown[]) : [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let measured = false;
  let damaged = false;

  const walk = (nodeIndex: unknown, parent: Matrix, seen: Set<number>): void => {
    if (typeof nodeIndex !== 'number' || seen.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    seen.add(nodeIndex);
    const world = multiply(parent, nodeLocalMatrix(node));
    if (typeof node.mesh === 'number') {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const positionAccessor = primitive.attributes?.POSITION;
        if (typeof positionAccessor !== 'number') continue;
        const accessor = accessors[positionAccessor];
        const accessorMin = accessor?.min;
        const accessorMax = accessor?.max;
        if (
          !Array.isArray(accessorMin) ||
          !Array.isArray(accessorMax) ||
          accessorMin.length < 3 ||
          accessorMax.length < 3
        ) {
          damaged = true;
          continue;
        }
        const lo = accessorMin as number[];
        const hi = accessorMax as number[];
        for (let corner = 0; corner < 8; corner += 1) {
          const point: [number, number, number] = [
            corner & 1 ? hi[0] : lo[0],
            corner & 2 ? hi[1] : lo[1],
            corner & 4 ? hi[2] : lo[2],
          ];
          const world3 = transformPoint(world, point);
          for (let axis = 0; axis < 3; axis += 1) {
            if (world3[axis] < min[axis]) min[axis] = world3[axis];
            if (world3[axis] > max[axis]) max[axis] = world3[axis];
          }
        }
        measured = true;
      }
    }
    const children = Array.isArray(node.children) ? (node.children as unknown[]) : [];
    for (const child of children) walk(child, world, seen);
    seen.delete(nodeIndex);
  };

  for (const root of roots) walk(root, IDENTITY, new Set<number>());
  if (damaged || !measured) return { failure: { field: 'file', message: fieldCopy.uploadDamaged } };

  const spans = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const extent = Math.max(...spans) * scaleToMetres(unit);
  if (!Number.isFinite(extent) || extent < MIN_EXTENT_METRES || extent > MAX_EXTENT_METRES)
    return { failure: { field: 'file', message: fieldCopy.uploadExtent } };
  return { ok: true, extentMetres: extent };
}

export function formatExtent(extentMetres: number): string {
  return `${roundTo(extentMetres, 2).toFixed(2)} m`;
}
