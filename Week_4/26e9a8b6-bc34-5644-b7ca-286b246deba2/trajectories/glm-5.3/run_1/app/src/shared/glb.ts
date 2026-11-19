// Binary glTF 2.0 container and part checks, shared by browser and server.
// The rule is decided here and only here; both runtimes call these functions.

export interface GlbCheckLimits {
  model_max_bytes: number;
  model_max_parts: number;
}

export type GlbRefusal =
  | { code: 'model_too_large'; limit: number }
  | { code: 'not_glb' }
  | { code: 'external_uri' }
  | { code: 'too_many_parts'; count: number; limit: number };

export interface GlbModel {
  /** Node paths of nodes that carry a mesh, in document order. */
  parts: string[];
  /** Bounding box size in glTF metres, [x, y, z]. */
  bboxM: [number, number, number];
}

const MAGIC = 0x46546c67; // 'glTF'
const JSON_TYPE = 0x4e4f534a; // 'JSON'
const BIN_TYPE = 0x004e4942; // 'BIN'
const MAX_JSON_DEPTH = 64;

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** Runs every check in the published order; the first failure decides. */
export function checkGlb(data: Uint8Array, limits: GlbCheckLimits): { ok: true; model: GlbModel } | { ok: false; refusal: GlbRefusal } {
  // 1. Byte limit first.
  if (data.length > limits.model_max_bytes) {
    return { ok: false, refusal: { code: 'model_too_large', limit: limits.model_max_bytes } };
  }
  if (data.length < 20) return { ok: false, refusal: { code: 'not_glb' } };
  if (readU32(data, 0) !== MAGIC) return { ok: false, refusal: { code: 'not_glb' } };
  if (readU32(data, 4) !== 2) return { ok: false, refusal: { code: 'not_glb' } };
  const declared = readU32(data, 8);
  if (declared !== data.length) return { ok: false, refusal: { code: 'not_glb' } };

  // 2. Chunk checks: JSON first, at most one BIN after it.
  let offset = 12;
  let json: unknown;
  let sawJson = false;
  let sawBin = false;
  while (offset + 8 <= data.length) {
    const length = readU32(data, offset);
    const type = readU32(data, offset + 4);
    if (length > data.length - offset - 8) return { ok: false, refusal: { code: 'not_glb' } };
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (!sawJson) {
      if (type !== JSON_TYPE) return { ok: false, refusal: { code: 'not_glb' } };
      let text: string;
      try {
        text = new TextDecoder().decode(body);
      } catch {
        return { ok: false, refusal: { code: 'not_glb' } };
      }
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, refusal: { code: 'not_glb' } };
      }
      if (depth(json) > MAX_JSON_DEPTH) return { ok: false, refusal: { code: 'not_glb' } };
      sawJson = true;
    } else {
      // After the JSON chunk, at most one BIN chunk may follow.
      if (sawBin) return { ok: false, refusal: { code: 'not_glb' } };
      if (type === BIN_TYPE) {
        sawBin = true;
      } else {
        return { ok: false, refusal: { code: 'not_glb' } };
      }
    }
    offset += 8 + length + ((length % 4) ? (4 - (length % 4)) : 0);
  }
  if (!sawJson || offset !== data.length) return { ok: false, refusal: { code: 'not_glb' } };

  const doc = json as { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[]; meshes?: unknown[]; nodes?: unknown[]; scenes?: unknown[]; scene?: unknown };
  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) return { ok: false, refusal: { code: 'not_glb' } };

  // 3. Outside files: any buffer or image with a uri.
  for (const buffer of doc.buffers ?? []) {
    if (typeof (buffer as { uri?: unknown }).uri === 'string' && (buffer as { uri: string }).uri.length > 0) {
      return { ok: false, refusal: { code: 'external_uri' } };
    }
  }
  for (const image of doc.images ?? []) {
    if (typeof (image as { uri?: unknown }).uri === 'string' && (image as { uri: string }).uri.length > 0) {
      return { ok: false, refusal: { code: 'external_uri' } };
    }
  }

  // 4. Part limit: nodes with a mesh.
  const parts = partPaths(doc as NodeDoc);
  if (parts.meshCount > limits.model_max_parts) {
    return { ok: false, refusal: { code: 'too_many_parts', count: parts.meshCount, limit: limits.model_max_parts } };
  }

  return { ok: true, model: { parts: parts.paths, bboxM: computeBbox(doc as NodeDoc) } };
}

interface NodeDoc {
  nodes: NodeRecord[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; material?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[]; componentType: number; type: string; bufferView?: number }[];
  scenes?: { nodes: number[] }[];
  scene?: number;
}

interface NodeRecord {
  name?: string;
  mesh?: number;
  children?: number[];
  scale?: number[];
  translation?: number[];
  rotation?: number[];
  matrix?: number[];
}

function depth(value: unknown, current: number = 1): number {
  if (current > MAX_JSON_DEPTH) return current;
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      let max = current;
      for (const item of value) max = Math.max(max, depth(item, current + 1));
      return max;
    }
    let max = current;
    for (const key of Object.keys(value)) max = Math.max(max, depth((value as Record<string, unknown>)[key], current + 1));
    return max;
  }
  return current;
}

/** Walks the strict node tree, numbering each segment among same-named siblings. */
function walkTree(doc: NodeDoc, visit: (path: string, index: number, node: NodeRecord) => void): void {
  const sceneIndex = typeof doc.scene === 'number' ? doc.scene : 0;
  const scene = doc.scenes?.[sceneIndex];
  const seen = new Set<number>();
  const walk = (indices: number[], prefix: string): void => {
    // k counts from 0 among siblings with the same name.
    const counts = new Map<string, number>();
    const segments = new Map<number, string>();
    for (const index of indices) {
      const node = doc.nodes[index];
      if (!node) continue;
      const base = typeof node.name === 'string' && node.name.length > 0 ? node.name : 'node';
      const k = counts.get(base) ?? 0;
      counts.set(base, k + 1);
      segments.set(index, `${base}[${k}]`);
    }
    for (const index of indices) {
      if (seen.has(index)) continue;
      seen.add(index);
      const node = doc.nodes[index];
      if (!node) continue;
      const segment = segments.get(index);
      if (segment === undefined) continue;
      const path = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      visit(path, index, node);
      if (node.children) walk(node.children, path);
    }
  };
  walk(scene?.nodes ?? [], '');
}

/** Part paths list every node with a mesh; a part is a node with a mesh. */
function partPaths(doc: NodeDoc): { paths: string[]; meshCount: number } {
  const paths: string[] = [];
  walkTree(doc, (path, _index, node) => {
    if (typeof node.mesh === 'number') paths.push(path);
  });
  let meshCount = 0;
  for (const node of doc.nodes) if (typeof node.mesh === 'number') meshCount++;
  return { paths, meshCount };
}

/** Bounding box from accessors; three.js also checks, this sizes the author's scale field. */
function computeBbox(doc: NodeDoc): [number, number, number] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const pos = primitive.attributes?.POSITION;
      if (pos === undefined) continue;
      const accessor = doc.accessors?.[pos];
      if (!accessor) continue;
      const min = accessor.min;
      const max = accessor.max;
      if (Array.isArray(min) && Array.isArray(max) && min.length >= 3 && max.length >= 3) {
        if (min[0] < minX) minX = min[0];
        if (min[1] < minY) minY = min[1];
        if (min[2] < minZ) minZ = min[2];
        if (max[0] > maxX) maxX = max[0];
        if (max[1] > maxY) maxY = max[1];
        if (max[2] > maxZ) maxZ = max[2];
      }
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [maxX - minX, maxY - minY, maxZ - minZ];
}

/** Node paths for the whole tree, used by Bind to node. */
export function allNodePaths(doc: NodeDoc): string[] {
  const out: string[] = [];
  walkTree(doc, (path) => {
    out.push(path);
  });
  return out;
}
