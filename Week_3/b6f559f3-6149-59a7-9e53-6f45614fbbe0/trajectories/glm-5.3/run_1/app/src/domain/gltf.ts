// glTF parsing for the published subset, plus clip sampling.
import type { ClipSetting } from './types';

export interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

export interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

export interface GltfAnimationSampler {
  input: number;
  output: number;
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export interface GltfAnimationChannel {
  sampler: number;
  target: { node?: number; path: string };
}

export interface GltfAnimation {
  name?: string;
  channels: GltfAnimationChannel[];
  samplers: GltfAnimationSampler[];
}

export interface GltfNode {
  name?: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  mesh?: number;
}

export interface GltfMesh {
  primitives: {
    attributes: Record<string, number>;
    indices?: number;
    mode?: number;
  }[];
}

export interface GltfJson {
  asset: { version: string };
  scenes?: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { uri?: string }[];
  animations?: GltfAnimation[];
  extensionsRequired?: string[];
}

export interface ParsedModel {
  json: GltfJson;
  binary: Uint8Array | null; // GLB chunk
  binaryOffset: number;
  vertices: number;
  clips: { name: string; durationS: number }[];
  nodeNames: string[];
}

export type ModelRefusal =
  | 'size'
  | 'invalid'
  | 'version'
  | 'compression'
  | 'external'
  | 'matrix'
  | 'cubicspline'
  | 'vertices';

// Builds the ModelInfo the evaluator and the stage need: node base
// transforms, clip channels with keyframe values, and the bounding box that
// encloses every mesh vertex as placed by its nodes.
const SUPPORTED_COMPRESSION = new Set(['KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'EXT_meshopt_compression']);

export function buildModelInfo(
  bytes: Uint8Array,
  maxBytes: number,
  maxVertices: number,
): { ok: true; model: import('./evaluate').ModelInfo; vertices: number } | { ok: false; refusal: ModelRefusal; extension?: string } {
  const parsed = parseGltf(bytes, maxBytes, maxVertices);
  if (!parsed.ok) return parsed;
  const { json, binary, binaryOffset } = parsed.model;
  const buffers: Buffer[] = [];
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri?.startsWith('data:')) {
      const decoded = decodeDataUri(buffer.uri);
      buffers.push(decoded ? Buffer.from(decoded) : Buffer.alloc(0));
    } else if (binary) {
      buffers.push(Buffer.from(binary));
    } else {
      buffers.push(Buffer.alloc(0));
    }
  }
  const readAccessor = (idx: number): number[][] => {
    const acc = json.accessors?.[idx];
    if (!acc) return [];
    const view = json.bufferViews?.[acc.bufferView];
    if (!view) return [];
    const buf = buffers[view.buffer];
    if (!buf) return [];
    const base = (binaryOffset ?? 0) + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const compSize = acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : 1;
    const n = acc.type === 'VEC3' ? 3 : acc.type === 'VEC4' ? 4 : acc.type === 'VEC2' ? 2 : 1;
    const out: number[][] = [];
    for (let i = 0; i < acc.count; i++) {
      const row: number[] = [];
      for (let c = 0; c < n; c++) {
        const off = base + (i * n + c) * compSize;
        if (acc.componentType === 5126) row.push(buf.readFloatLE(off));
        else if (acc.componentType === 5123) row.push(buf.readUInt16LE(off));
        else row.push(buf.readUInt8(off));
      }
      out.push(row);
    }
    return out;
  };

  // Nodes with their base transforms.
  const nodes: import('./evaluate').ModelNodeLite[] = (json.nodes ?? []).map((n) => ({
    name: n.name ?? 'Node',
    translation: {
      x: n.translation?.[0] ?? 0,
      y: n.translation?.[1] ?? 0,
      z: n.translation?.[2] ?? 0,
    },
    rotation: [
      n.rotation?.[0] ?? 0,
      n.rotation?.[1] ?? 0,
      n.rotation?.[2] ?? 0,
      n.rotation?.[3] ?? 1,
    ],
    scale: {
      x: n.scale?.[0] ?? 1,
      y: n.scale?.[1] ?? 1,
      z: n.scale?.[2] ?? 1,
    },
  }));

  // Clips, with their channels resolved to keyframe arrays.
  const clips: import('./evaluate').ClipDataLite[] = [];
  for (const anim of json.animations ?? []) {
    const channels: import('./evaluate').ClipChannel[] = [];
    for (const ch of anim.channels ?? []) {
      const sampler = anim.samplers?.[ch.sampler];
      if (!sampler) continue;
      if (ch.target.path !== 'translation' && ch.target.path !== 'rotation' && ch.target.path !== 'scale') continue;
      channels.push({
        path: ch.target.path,
        node: ch.target.node ?? 0,
        times: readAccessor(sampler.input).map((r) => r[0] ?? 0),
        values: readAccessor(sampler.output),
        interpolation: sampler.interpolation === 'STEP' ? 'STEP' : 'LINEAR',
      });
    }
    let duration = 0;
    for (const c of channels) {
      const last = c.times[c.times.length - 1];
      if (last !== undefined && last > duration) duration = last;
    }
    clips.push({ name: anim.name ?? `Clip ${clips.length + 1}`, duration, channels });
  }

  // The bounding box enclosing every mesh vertex, as placed by its nodes,
  // with no clip applied.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const meshes = json.meshes ?? [];
  (json.nodes ?? []).forEach((node, nodeIdx) => {
    if (node.mesh === undefined) return;
    const mesh = meshes[node.mesh];
    if (!mesh) return;
    const accIdx = mesh.primitives[0]?.attributes?.POSITION;
    if (accIdx === undefined) return;
    const positions = readAccessor(accIdx);
    const transform = {
      position: nodes[nodeIdx]?.translation ?? { x: 0, y: 0, z: 0 },
      rotation: nodes[nodeIdx]?.rotation ?? [0, 0, 0, 1],
      scale: nodes[nodeIdx]?.scale ?? { x: 1, y: 1, z: 1 },
    };
    for (const pos of positions) {
      const p = applyNodeTransform(transform, { x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0 });
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  });
  const min = Number.isFinite(minX) ? { x: minX, y: minY, z: minZ } : { x: -0.5, y: -0.5, z: -0.5 };
  const max = Number.isFinite(maxX) ? { x: maxX, y: maxY, z: maxZ } : { x: 0.5, y: 0.5, z: 0.5 };

  return {
    ok: true,
    model: { min, max, clips, nodes },
    vertices: parsed.model.vertices,
  };
}

// Places a point by a node's translation, rotation (quaternion) and scale.
function applyNodeTransform(
  node: { position: { x: number; y: number; z: number }; rotation: [number, number, number, number]; scale: { x: number; y: number; z: number } },
  p: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  let x = p.x * node.scale.x;
  let y = p.y * node.scale.y;
  let z = p.z * node.scale.z;
  const [qx, qy, qz, qw] = node.rotation;
  // Quaternion rotation: v' = q v q*
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return { x: x + node.position.x, y: y + node.position.y, z: z + node.position.z };
}

// Parse a GLB or .gltf JSON, enforcing the published subset. `bytes` is the
// whole file. Returns the first applicable refusal.
export function parseGltf(
  bytes: Uint8Array,
  maxBytes: number,
  maxVertices: number,
): { ok: true; model: ParsedModel } | { ok: false; refusal: ModelRefusal; extension?: string } {
  if (bytes.length > maxBytes) return { ok: false, refusal: 'size' };
  let json: GltfJson;
  let binary: Uint8Array | null = null;
  let binaryOffset = 0;
  const head = new TextDecoder().decode(bytes.subarray(0, 4));
  if (head === 'glTF') {
    // GLB
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint32(4, true);
    const totalLength = dv.getUint32(8, true);
    if (version !== 2 || totalLength > bytes.byteLength) return { ok: false, refusal: 'invalid' };
    let offset = 12;
    let jsonText = '';
    while (offset < bytes.byteLength) {
      const chunkLength = dv.getUint32(offset, true);
      const chunkType = dv.getUint32(offset + 4, true);
      const data = bytes.subarray(offset + 8, offset + 8 + chunkLength);
      if (chunkType === 0x4e4f534a) {
        jsonText = new TextDecoder().decode(data);
      } else if (chunkType === 0x004e4942) {
        binary = data;
        binaryOffset = offset + 8;
      } else {
        return { ok: false, refusal: 'invalid' };
      }
      offset += 8 + chunkLength;
    }
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { ok: false, refusal: 'invalid' };
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, refusal: 'invalid' };
    }
  }

  if (!json || typeof json !== 'object' || !json.asset || !json.asset.version) {
    return { ok: false, refusal: 'invalid' };
  }
  if (!json.asset.version.startsWith('2.')) return { ok: false, refusal: 'version' };

  for (const ext of json.extensionsRequired ?? []) {
    if (SUPPORTED_COMPRESSION.has(ext)) return { ok: false, refusal: 'compression', extension: ext };
  }

  // External buffer URIs
  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:')) return { ok: false, refusal: 'external' };
  }

  for (const node of json.nodes ?? []) {
    if (node.matrix) return { ok: false, refusal: 'matrix' };
  }

  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers ?? []) {
      if (s.interpolation === 'CUBICSPLINE') return { ok: false, refusal: 'cubicspline' };
    }
  }

  // Vertex count: sum of POSITION accessor counts over used meshes
  let vertices = 0;
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const used = new Set<number>();
  for (const node of json.nodes ?? []) {
    if (node.mesh !== undefined) used.add(node.mesh);
  }
  for (const m of meshes) {
    void m;
  }
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = meshes[node.mesh];
    if (!mesh) continue;
    for (const prim of mesh.primitives) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx !== undefined) {
        const acc = accessors[posIdx];
        if (acc) vertices += acc.count;
      }
    }
  }
  if (vertices > maxVertices) return { ok: false, refusal: 'vertices' };

  const clips: { name: string; durationS: number }[] = [];
  for (const anim of json.animations ?? []) {
    let maxTime = 0;
    for (const s of anim.samplers ?? []) {
      const acc = accessors[s.input];
      if (acc && acc.count > 0) {
        // Last time value: read from the accessor data when available.
        const v = readAccessorFloatAt(json, binary, binaryOffset, acc, acc.count - 1);
        if (v !== null && v > maxTime) maxTime = v;
      }
    }
    clips.push({ name: anim.name ?? `Clip ${clips.length + 1}`, durationS: maxTime });
  }

  return { ok: true, model: { json, binary, binaryOffset, vertices, clips, nodeNames: (json.nodes ?? []).map((n) => n.name ?? '') } };
}

function readAccessorFloatAt(
  json: GltfJson,
  binary: Uint8Array | null,
  binaryOffset: number,
  acc: GltfAccessor,
  index: number,
): number | null {
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) return null;
  const buffer = json.buffers?.[view.buffer];
  if (!buffer) return null;
  let data: Uint8Array;
  let baseOffset = 0;
  if (buffer.uri?.startsWith('data:')) {
    const decoded = decodeDataUri(buffer.uri);
    if (!decoded) return null;
    data = decoded;
  } else if (binary) {
    data = binary;
    baseOffset = binaryOffset;
  } else {
    return null;
  }
  const offset = baseOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    return dv.getFloat32(offset + index * 4, true);
  } catch {
    return null;
  }
}

export function decodeDataUri(uri: string): Uint8Array | null {
  const m = uri.match(/^data:[^,]*,([\s\S]*)$/);
  if (!m) return null;
  const meta = uri.slice(5, uri.indexOf(','));
  if (meta.includes('base64')) {
    const b64 = m[1];
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf);
  }
  return new Uint8Array(Buffer.from(decodeURIComponent(m[1]), 'utf8'));
}

// --- Clip sampling ------------------------------------------------------

export interface ClipKeyframe {
  times: number[];
  values: number[][]; // VEC3 or VEC4 per keyframe
  interpolation: 'LINEAR' | 'STEP';
  path: 'translation' | 'rotation' | 'scale';
  node: number;
}

export interface ClipData {
  name: string;
  duration: number;
  channels: ClipKeyframe[];
}

export function clipTimeAt(setting: ClipSetting, clipDuration: number, T: number): number {
  const raw = Math.max(0, T - setting.offsetMs / 1000) * setting.speed;
  if (!setting.play) return 0;
  if (setting.loop) {
    if (clipDuration <= 0) return 0;
    return raw % clipDuration;
  }
  return Math.min(raw, clipDuration);
}
