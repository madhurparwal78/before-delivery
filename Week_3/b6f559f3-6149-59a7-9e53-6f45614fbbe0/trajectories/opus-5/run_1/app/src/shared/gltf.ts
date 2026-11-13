import { MSG, copy } from './messages';
import { fixed } from './format';

export type NodePath = 'translation' | 'rotation' | 'scale';
export type Interpolation = 'LINEAR' | 'STEP';

export interface GltfNode {
  name: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  mesh: number | null;
  children: number[];
}

export interface GltfChannel {
  nodeIndex: number;
  path: NodePath;
  interpolation: Interpolation;
  times: number[];
  values: number[][];
}

export interface GltfClip {
  name: string;
  durationS: number;
  channels: GltfChannel[];
}

export interface GltfMesh {
  positions: number[];
  indices: number[];
}

export interface GltfModel {
  nodes: GltfNode[];
  meshes: GltfMesh[];
  clips: GltfClip[];
  vertexCount: number;
}

export interface GltfParseResult {
  model: GltfModel | null;
  refusal: string | null;
}

const COMPRESSION_EXTENSIONS = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu',
];

interface RawAccessor {
  bufferView?: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
}

interface RawBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface RawGltf {
  asset?: { version?: string };
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: RawBufferView[];
  accessors?: RawAccessor[];
  meshes?: {
    primitives?: {
      attributes?: Record<string, number>;
      indices?: number;
      mode?: number;
    }[];
  }[];
  nodes?: {
    name?: string;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    mesh?: number;
    children?: number[];
    matrix?: number[];
  }[];
  animations?: {
    name?: string;
    channels?: { sampler: number; target?: { node?: number; path?: string } }[];
    samplers?: { input: number; output: number; interpolation?: string }[];
  }[];
}

function decodeBase64(data: string): Uint8Array {
  const binary =
    typeof atob === 'function'
      ? atob(data)
      : Buffer.from(data, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readAccessor(
  gltf: RawGltf,
  buffers: Uint8Array[],
  accessorIndex: number,
): number[][] | null {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) return null;
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const buffer = buffers[view.buffer];
  if (!buffer) return null;
  const componentCount =
    { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type] ?? 1;
  const componentSize =
    { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType] ?? 4;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? componentCount * componentSize;
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row: number[] = [];
    for (let c = 0; c < componentCount; c += 1) {
      const offset = base + i * stride + c * componentSize;
      if (offset + componentSize > buffer.byteLength) return null;
      switch (accessor.componentType) {
        case 5126:
          row.push(data.getFloat32(offset, true));
          break;
        case 5125:
          row.push(data.getUint32(offset, true));
          break;
        case 5123:
          row.push(data.getUint16(offset, true));
          break;
        case 5122:
          row.push(data.getInt16(offset, true));
          break;
        case 5121:
          row.push(data.getUint8(offset));
          break;
        default:
          row.push(data.getInt8(offset));
      }
    }
    out.push(row);
  }
  return out;
}

export function parseGltf(
  bytes: Uint8Array,
  fileName: string,
  limits: { maxBytes: number; maxVertices: number },
): GltfParseResult {
  if (bytes.byteLength > limits.maxBytes) {
    return { model: null, refusal: copy.modelTooLarge(bytes.byteLength, limits.maxBytes) };
  }
  let gltf: RawGltf | null = null;
  let binaryChunk: Uint8Array | null = null;
  const isGlb =
    bytes.byteLength >= 12 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46;
  try {
    if (isGlb) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = 12;
      let json = '';
      while (offset + 8 <= bytes.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkStart = offset + 8;
        if (chunkType === 0x4e4f534a) {
          json = new TextDecoder().decode(bytes.subarray(chunkStart, chunkStart + chunkLength));
        } else if (chunkType === 0x004e4942) {
          binaryChunk = bytes.subarray(chunkStart, chunkStart + chunkLength);
        }
        offset = chunkStart + chunkLength;
      }
      gltf = JSON.parse(json) as RawGltf;
    } else {
      gltf = JSON.parse(new TextDecoder().decode(bytes)) as RawGltf;
    }
  } catch {
    return { model: null, refusal: MSG.modelNotValid };
  }
  if (!gltf || typeof gltf !== 'object' || !gltf.asset) {
    return { model: null, refusal: MSG.modelNotValid };
  }
  if (gltf.asset.version !== '2.0') {
    return { model: null, refusal: MSG.modelVersion };
  }
  const required = gltf.extensionsRequired ?? [];
  const compression = required.find(
    (name) => COMPRESSION_EXTENSIONS.includes(name) || /compression/i.test(name),
  );
  if (compression) {
    return { model: null, refusal: copy.modelCompressed(compression) };
  }
  const buffers: Uint8Array[] = [];
  for (const buffer of gltf.buffers ?? []) {
    if (buffer.uri === undefined) {
      buffers.push(binaryChunk ?? new Uint8Array(0));
      continue;
    }
    if (!buffer.uri.startsWith('data:')) {
      return { model: null, refusal: MSG.modelExternalUri };
    }
    const comma = buffer.uri.indexOf(',');
    buffers.push(decodeBase64(buffer.uri.slice(comma + 1)));
  }
  const nodes: GltfNode[] = [];
  for (const node of gltf.nodes ?? []) {
    if (node.matrix) return { model: null, refusal: MSG.modelMatrix };
    nodes.push({
      name: node.name ?? `Node ${nodes.length + 1}`,
      translation: [node.translation?.[0] ?? 0, node.translation?.[1] ?? 0, node.translation?.[2] ?? 0],
      rotation: [
        node.rotation?.[0] ?? 0,
        node.rotation?.[1] ?? 0,
        node.rotation?.[2] ?? 0,
        node.rotation?.[3] ?? 1,
      ],
      scale: [node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1],
      mesh: node.mesh ?? null,
      children: node.children ?? [],
    });
  }
  for (const animation of gltf.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      if (sampler.interpolation === 'CUBICSPLINE') {
        return { model: null, refusal: MSG.modelCubicSpline };
      }
    }
  }
  const meshes: GltfMesh[] = [];
  let vertexCount = 0;
  for (const mesh of gltf.meshes ?? []) {
    const out: GltfMesh = { positions: [], indices: [] };
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) continue;
      const positions = readAccessor(gltf, buffers, positionIndex);
      if (!positions) return { model: null, refusal: MSG.modelNotValid };
      const base = out.positions.length / 3;
      for (const row of positions) out.positions.push(row[0], row[1], row[2]);
      vertexCount += positions.length;
      if (primitive.indices !== undefined) {
        const indices = readAccessor(gltf, buffers, primitive.indices);
        if (!indices) return { model: null, refusal: MSG.modelNotValid };
        for (const row of indices) out.indices.push(base + row[0]);
      } else {
        for (let i = 0; i < positions.length; i += 1) out.indices.push(base + i);
      }
    }
    meshes.push(out);
  }
  if (vertexCount > limits.maxVertices) {
    return { model: null, refusal: copy.modelTooManyVertices(vertexCount, limits.maxVertices) };
  }
  const clips: GltfClip[] = [];
  (gltf.animations ?? []).forEach((animation, index) => {
    const channels: GltfChannel[] = [];
    let duration = 0;
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      const path = channel.target?.path;
      const nodeIndex = channel.target?.node;
      if (!sampler || nodeIndex === undefined) continue;
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
      const times = readAccessor(gltf as RawGltf, buffers, sampler.input);
      const values = readAccessor(gltf as RawGltf, buffers, sampler.output);
      if (!times || !values) continue;
      const flatTimes = times.map((row) => row[0]);
      duration = Math.max(duration, flatTimes[flatTimes.length - 1] ?? 0);
      channels.push({
        nodeIndex,
        path,
        interpolation: sampler.interpolation === 'STEP' ? 'STEP' : 'LINEAR',
        times: flatTimes,
        values,
      });
    }
    clips.push({
      name: animation.name ?? `Clip ${index + 1}`,
      durationS: duration,
      channels,
    });
  });
  void fileName;
  return { model: { nodes, meshes, clips, vertexCount }, refusal: null };
}

export interface ClipPlayback {
  name: string;
  play: boolean;
  loop: boolean;
  speed: number;
  offsetMs: number;
}

/** Clip time in seconds at timeline time T seconds. */
export function clipTime(playback: ClipPlayback, durationS: number, timelineSeconds: number): number {
  if (!playback.play) return 0;
  const c = Math.max(0, timelineSeconds - playback.offsetMs / 1000) * playback.speed;
  if (playback.loop) {
    if (durationS <= 0) return 0;
    return c % durationS;
  }
  return Math.min(c, durationS);
}

export interface NodeTransform {
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

function slerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let target = b;
  if (dot < 0) {
    target = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    const lerped: [number, number, number, number] = [
      a[0] + (target[0] - a[0]) * t,
      a[1] + (target[1] - a[1]) * t,
      a[2] + (target[2] - a[2]) * t,
      a[3] + (target[3] - a[3]) * t,
    ];
    return normaliseQuaternion(lerped);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return normaliseQuaternion([
    a[0] * s0 + target[0] * s1,
    a[1] * s0 + target[1] * s1,
    a[2] * s0 + target[2] * s1,
    a[3] * s0 + target[3] * s1,
  ]);
}

export function normaliseQuaternion(
  q: [number, number, number, number],
): [number, number, number, number] {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length === 0) return [0, 0, 0, 1];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function sampleChannel(channel: GltfChannel, time: number): number[] {
  const { times, values } = channel;
  if (times.length === 0) return values[0] ?? [];
  if (time <= times[0]) return values[0];
  if (time >= times[times.length - 1]) return values[values.length - 1];
  let index = 0;
  for (let i = 0; i < times.length - 1; i += 1) {
    if (time >= times[i] && time <= times[i + 1]) {
      index = i;
      break;
    }
  }
  if (channel.interpolation === 'STEP') return values[index];
  const span = times[index + 1] - times[index];
  const t = span === 0 ? 0 : (time - times[index]) / span;
  const a = values[index];
  const b = values[index + 1];
  if (channel.path === 'rotation') {
    return slerp(
      [a[0], a[1], a[2], a[3]],
      [b[0], b[1], b[2], b[3]],
      t,
    );
  }
  return a.map((value, i) => value + (b[i] - value) * t);
}

/** The node transform after every playing clip, later clips winning. */
export function nodeTransformAt(
  model: GltfModel,
  nodeIndex: number,
  clips: { clip: GltfClip; playback: ClipPlayback }[],
  timelineSeconds: number,
): NodeTransform {
  const node = model.nodes[nodeIndex];
  const transform: NodeTransform = {
    translation: [...node.translation],
    rotation: [...node.rotation],
    scale: [...node.scale],
  };
  for (const entry of clips) {
    if (!entry.playback.play) continue;
    const time = clipTime(entry.playback, entry.clip.durationS, timelineSeconds);
    for (const channel of entry.clip.channels) {
      if (channel.nodeIndex !== nodeIndex) continue;
      const sampled = sampleChannel(channel, time);
      if (channel.path === 'translation') {
        transform.translation = [sampled[0], sampled[1], sampled[2]];
      } else if (channel.path === 'scale') {
        transform.scale = [sampled[0], sampled[1], sampled[2]];
      } else {
        transform.rotation = normaliseQuaternion([sampled[0], sampled[1], sampled[2], sampled[3]]);
      }
    }
  }
  return transform;
}

/** Euler degrees (X, Y, Z) matching the Rz·Ry·Rx transform order. */
export function quaternionToEuler(
  q: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = normaliseQuaternion(q);
  const m00 = 1 - 2 * (y * y + z * z);
  const m10 = 2 * (x * y + z * w);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - x * w);
  const m20 = 2 * (x * z - y * w);
  const m21 = 2 * (y * z + x * w);
  const m22 = 1 - 2 * (x * x + y * y);
  const toDeg = (radians: number): number => (radians * 180) / Math.PI;
  const sy = Math.hypot(m00, m10);
  if (sy > 1e-7) {
    return [toDeg(Math.atan2(m21, m22)), toDeg(Math.atan2(-m20, sy)), toDeg(Math.atan2(m10, m00))];
  }
  return [toDeg(Math.atan2(-m12, m11)), toDeg(Math.atan2(-m20, sy)), 0];
}

export function clipLabel(clip: GltfClip): string {
  return `${clip.name} · ${fixed(clip.durationS, 3)} s`;
}

export function modelBoundingBox(model: GltfModel): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const visit = (nodeIndex: number, parent: NodeTransform | null): void => {
    const node = model.nodes[nodeIndex];
    const local: NodeTransform = {
      translation: node.translation,
      rotation: node.rotation,
      scale: node.scale,
    };
    const world = parent ? composeTransforms(parent, local) : local;
    if (node.mesh !== null && model.meshes[node.mesh]) {
      const mesh = model.meshes[node.mesh];
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const point = applyNodeTransform(world, [
          mesh.positions[i],
          mesh.positions[i + 1],
          mesh.positions[i + 2],
        ]);
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
    for (const child of node.children) visit(child, world);
  };
  const childIndices = new Set<number>();
  model.nodes.forEach((node) => node.children.forEach((child) => childIndices.add(child)));
  model.nodes.forEach((_, index) => {
    if (!childIndices.has(index)) visit(index, null);
  });
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function applyNodeTransform(
  transform: NodeTransform,
  point: [number, number, number],
): [number, number, number] {
  const scaled: [number, number, number] = [
    point[0] * transform.scale[0],
    point[1] * transform.scale[1],
    point[2] * transform.scale[2],
  ];
  const rotated = rotateByQuaternion(transform.rotation, scaled);
  return [
    rotated[0] + transform.translation[0],
    rotated[1] + transform.translation[1],
    rotated[2] + transform.translation[2],
  ];
}

export function rotateByQuaternion(
  q: [number, number, number, number],
  v: [number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

function composeTransforms(parent: NodeTransform, child: NodeTransform): NodeTransform {
  const translation = applyNodeTransform(parent, child.translation);
  return {
    translation,
    rotation: multiplyQuaternions(parent.rotation, child.rotation),
    scale: [
      parent.scale[0] * child.scale[0],
      parent.scale[1] * child.scale[1],
      parent.scale[2] * child.scale[2],
    ],
  };
}

export function multiplyQuaternions(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
