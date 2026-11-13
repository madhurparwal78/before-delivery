import { boundsOf, type Mesh } from './geometry';
import { gltfCompressed, gltfVertices, MESSAGES } from './messages';
import type { Mat4 } from './projection';
import { composeMatrix, multiplyMatrices, transformByMatrix, type Triple } from './quaternion';
import type { ModelChannel, ModelClip, ModelNode, ModelSummary, Vec3 } from './types';

export interface ParsedModel {
  summary: ModelSummary;
  meshes: Mesh[];
}

type ModelResult = { model: ParsedModel } | { error: string };

type Record_ = Record<string, unknown>;

const asRecord = (value: unknown): Record_ | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record_) : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asNumber = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

interface Container {
  json: Record_;
  binary: Uint8Array | null;
}

function openContainer(bytes: Uint8Array): Container | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (bytes.length >= 12 && view.getUint32(0, true) === GLB_MAGIC) {
      let offset = 12;
      let json: Record_ | null = null;
      let binary: Uint8Array | null = null;
      while (offset + 8 <= bytes.length) {
        const size = view.getUint32(offset, true);
        const kind = view.getUint32(offset + 4, true);
        const chunk = bytes.subarray(offset + 8, offset + 8 + size);
        if (kind === CHUNK_JSON) json = asRecord(JSON.parse(new TextDecoder().decode(chunk)));
        else if (kind === CHUNK_BIN && !binary) binary = chunk;
        offset += 8 + size;
      }
      return json ? { json, binary } : null;
    }
    const json = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
    return json ? { json, binary: null } : null;
  } catch {
    return null;
  }
}

function decodeBuffers(container: Container): Uint8Array[] | null {
  const buffers: Uint8Array[] = [];
  for (const entry of asArray(container.json['buffers'])) {
    const uri = asString(asRecord(entry)?.['uri']);
    if (uri === null) {
      if (!container.binary) return null;
      buffers.push(container.binary);
    } else {
      const comma = uri.indexOf(',');
      if (!uri.startsWith('data:') || comma < 0) return null;
      buffers.push(Uint8Array.from(atob(uri.slice(comma + 1)), (c) => c.charCodeAt(0)));
    }
  }
  return buffers;
}

interface Accessor {
  count: number;
  components: number;
  read: (index: number, component: number) => number;
}

function accessorOf(json: Record_, buffers: Uint8Array[], index: number): Accessor | null {
  const accessor = asRecord(asArray(json['accessors'])[index]);
  const view = asRecord(asArray(json['bufferViews'])[asNumber(accessor?.['bufferView'], -1)]);
  if (!accessor || !view) return null;
  const buffer = buffers[asNumber(view['buffer'], 0)];
  const components = COMPONENTS[asString(accessor['type']) ?? ''];
  const type = asNumber(accessor['componentType'], 0);
  if (!buffer || !components || (type !== FLOAT && type !== UNSIGNED_SHORT && type !== UNSIGNED_INT)) return null;
  const size = type === UNSIGNED_SHORT ? 2 : 4;
  const stride = asNumber(view['byteStride'], components * size);
  const start = asNumber(view['byteOffset'], 0) + asNumber(accessor['byteOffset'], 0);
  const count = asNumber(accessor['count'], 0);
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (start + stride * Math.max(count - 1, 0) + components * size > buffer.byteLength) return null;
  return {
    count,
    components,
    read: (i, c) => {
      const at = start + i * stride + c * size;
      if (type === FLOAT) return data.getFloat32(at, true);
      return type === UNSIGNED_SHORT ? data.getUint16(at, true) : data.getUint32(at, true);
    },
  };
}

function primitivesOf(json: Record_): Record_[] {
  return asArray(json['meshes']).flatMap((mesh) => asArray(asRecord(mesh)?.['primitives']).map((p) => asRecord(p) ?? {}));
}

function vertexTotal(json: Record_): number {
  return primitivesOf(json).reduce((sum, primitive) => {
    const position = asNumber(asRecord(primitive['attributes'])?.['POSITION'], -1);
    return sum + asNumber(asRecord(asArray(json['accessors'])[position])?.['count'], 0);
  }, 0);
}

function readMeshes(json: Record_, buffers: Uint8Array[]): Mesh[] | null {
  const meshes: Mesh[] = [];
  for (const entry of asArray(json['meshes'])) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const raw of asArray(asRecord(entry)?.['primitives'])) {
      const primitive = asRecord(raw) ?? {};
      const attributes = asRecord(primitive['attributes']) ?? {};
      const position = accessorOf(json, buffers, asNumber(attributes['POSITION'], -1));
      const normal = accessorOf(json, buffers, asNumber(attributes['NORMAL'], -1));
      if (!position || !normal || position.components !== 3 || normal.components !== 3 || asNumber(primitive['mode'], 4) !== 4) return null;
      const base = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        for (let c = 0; c < 3; c++) {
          positions.push(position.read(i, c));
          normals.push(normal.read(i, c));
        }
      }
      if (primitive['indices'] === undefined) {
        for (let i = 0; i < position.count; i++) indices.push(base + i);
      } else {
        const index = accessorOf(json, buffers, asNumber(primitive['indices'], -1));
        if (!index) return null;
        for (let i = 0; i < index.count; i++) indices.push(base + index.read(i, 0));
      }
    }
    meshes.push({ positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) });
  }
  return meshes;
}

function readNodes(json: Record_): ModelNode[] {
  const raw = asArray(json['nodes']).map((n) => asRecord(n) ?? {});
  const nodes: ModelNode[] = raw.map((n, i) => {
    const t = asArray(n['translation']);
    const r = asArray(n['rotation']);
    const s = asArray(n['scale']);
    return {
      name: asString(n['name']) ?? `Node ${i}`,
      parent: null,
      translation: [asNumber(t[0], 0), asNumber(t[1], 0), asNumber(t[2], 0)],
      rotation: [asNumber(r[0], 0), asNumber(r[1], 0), asNumber(r[2], 0), asNumber(r[3], 1)],
      scale: [asNumber(s[0], 1), asNumber(s[1], 1), asNumber(s[2], 1)],
      mesh: typeof n['mesh'] === 'number' ? n['mesh'] : null,
    };
  });
  raw.forEach((n, i) => {
    for (const child of asArray(n['children'])) {
      const target = nodes[asNumber(child, -1)];
      if (target) target.parent = i;
    }
  });
  return nodes;
}

function readClips(json: Record_, buffers: Uint8Array[], nodes: ModelNode[]): ModelClip[] | null {
  const clips: ModelClip[] = [];
  for (const [index, entry] of asArray(json['animations']).entries()) {
    const animation = asRecord(entry) ?? {};
    const samplers = asArray(animation['samplers']).map((s) => asRecord(s) ?? {});
    const channels: ModelChannel[] = [];
    let duration = 0;
    for (const raw of asArray(animation['channels'])) {
      const channel = asRecord(raw) ?? {};
      const target = asRecord(channel['target']) ?? {};
      const path = asString(target['path']);
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
      const sampler = samplers[asNumber(channel['sampler'], -1)];
      const input = sampler && accessorOf(json, buffers, asNumber(sampler['input'], -1));
      const output = sampler && accessorOf(json, buffers, asNumber(sampler['output'], -1));
      const node = nodes[asNumber(target['node'], -1)];
      if (!sampler || !input || !output || !node) return null;
      const times = Array.from({ length: input.count }, (_, i) => input.read(i, 0));
      const values = Array.from({ length: output.count * output.components }, (_, i) =>
        output.read(Math.floor(i / output.components), i % output.components),
      );
      duration = Math.max(duration, ...times);
      channels.push({ node: node.name, path, interpolation: sampler['interpolation'] === 'STEP' ? 'STEP' : 'LINEAR', times, values });
    }
    clips.push({ name: asString(animation['name']) ?? `Clip ${index + 1}`, durationS: duration, channels });
  }
  return clips;
}

function worldMatrices(nodes: ModelNode[]): Mat4[] {
  const local = nodes.map((n) => composeMatrix(n.translation, n.rotation, n.scale));
  const world: (Mat4 | undefined)[] = [];
  const resolve = (i: number): Mat4 => {
    const cached = world[i];
    if (cached) return cached;
    const node = nodes[i] as ModelNode;
    const matrix = node.parent === null ? (local[i] as Mat4) : multiplyMatrices(resolve(node.parent), local[i] as Mat4);
    world[i] = matrix;
    return matrix;
  };
  return nodes.map((_, i) => resolve(i));
}

/** Bounding box of every mesh vertex as placed by its node's stored transform, with no clip applied. */
function modelBounds(nodes: ModelNode[], meshes: Mesh[]): { min: Vec3; max: Vec3 } {
  const matrices = worldMatrices(nodes);
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  nodes.forEach((node, i) => {
    const mesh = node.mesh === null ? undefined : meshes[node.mesh];
    if (!mesh) return;
    const local = boundsOf(mesh);
    for (const x of [local.min.x, local.max.x])
      for (const y of [local.min.y, local.max.y])
        for (const z of [local.min.z, local.max.z]) {
          const [wx, wy, wz] = transformByMatrix(matrices[i] as Mat4, [x, y, z] as Triple);
          min.x = Math.min(min.x, wx);
          min.y = Math.min(min.y, wy);
          min.z = Math.min(min.z, wz);
          max.x = Math.max(max.x, wx);
          max.y = Math.max(max.y, wy);
          max.z = Math.max(max.z, wz);
        }
  });
  return Number.isFinite(min.x) ? { min, max } : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
}

export function summariseModel(nodes: ModelNode[], meshes: Mesh[], clips: ModelClip[]): ModelSummary {
  const triangles = nodes.reduce((sum, node) => {
    const mesh = node.mesh === null ? undefined : meshes[node.mesh];
    return sum + (mesh ? (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3 : 0);
  }, 0);
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  return { nodes, clips, bounds: modelBounds(nodes, meshes), vertices, triangles };
}

/** Parses a .gltf or .glb file inside the supported subset, refusing with the first applicable text. */
export function parseModel(bytes: Uint8Array, maxVertices: number): ModelResult {
  const container = openContainer(bytes);
  if (!container) return { error: MESSAGES.gltfInvalid };
  const { json } = container;
  if (asString(asRecord(json['asset'])?.['version']) !== '2.0') return { error: MESSAGES.gltfVersion };
  const compressed = asArray(json['extensionsRequired'])
    .map(asString)
    .find((name) => name !== null && /draco|meshopt|compress/i.test(name));
  if (compressed) return { error: gltfCompressed(compressed) };
  const external = asArray(json['buffers']).some((entry) => {
    const uri = asString(asRecord(entry)?.['uri']);
    return uri !== null && !uri.startsWith('data:');
  });
  if (external) return { error: MESSAGES.gltfExternal };
  if (asArray(json['nodes']).some((n) => asRecord(n)?.['matrix'] !== undefined)) return { error: MESSAGES.gltfMatrix };
  const spline = asArray(json['animations']).some((a) =>
    asArray(asRecord(a)?.['samplers']).some((s) => asRecord(s)?.['interpolation'] === 'CUBICSPLINE'),
  );
  if (spline) return { error: MESSAGES.gltfCubicSpline };
  const vertices = vertexTotal(json);
  if (vertices > maxVertices) return { error: gltfVertices(vertices, maxVertices) };
  const buffers = decodeBuffers(container);
  const meshes = buffers && readMeshes(json, buffers);
  const nodes = readNodes(json);
  const clips = buffers && meshes && readClips(json, buffers, nodes);
  if (!buffers || !meshes || !clips) return { error: MESSAGES.gltfInvalid };
  return { model: { summary: summariseModel(nodes, meshes, clips), meshes } };
}

