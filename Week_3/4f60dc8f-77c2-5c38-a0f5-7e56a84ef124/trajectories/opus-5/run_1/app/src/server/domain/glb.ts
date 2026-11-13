const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export const SUPPORTED_GLTF_EXTENSIONS = [
  'KHR_mesh_quantization',
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
] as const;

const COMPONENT_FLOAT = 5126;
const QUANTIZED_COMPONENTS = new Set([5120, 5121, 5122, 5123]);

export type GltfAccessor = {
  componentType?: number;
  normalized?: boolean;
  min?: unknown;
  max?: unknown;
};

export type GltfNode = {
  children?: unknown;
  mesh?: unknown;
  matrix?: unknown;
  translation?: unknown;
  rotation?: unknown;
  scale?: unknown;
};

export type GltfDocument = {
  asset?: { version?: unknown };
  extensionsUsed?: unknown;
  extensionsRequired?: unknown;
  scene?: unknown;
  scenes?: { nodes?: unknown }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: Record<string, unknown> }[] }[];
  accessors?: GltfAccessor[];
};

export type GlbHead = { json: GltfDocument; headerLength: number };

export class GlbMalformedError extends Error {}

const isNumberArray3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringList = (value: unknown): string[] =>
  asArray(value).filter((entry): entry is string => typeof entry === 'string');

export type HeadProgress = { kind: 'need'; bytes: number } | { kind: 'ok'; head: GlbHead };

/**
 * Judges the published GLB acceptance rules over a growing prefix of the file.
 * `need` says how many bytes must be buffered before the next decision can be made.
 */
export const inspectGlbHead = (buffer: Buffer): HeadProgress => {
  if (buffer.length < 12) return { kind: 'need', bytes: 12 };
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new GlbMalformedError('bad magic');
  if (buffer.readUInt32LE(4) !== 2) throw new GlbMalformedError('bad version');
  const headerLength = buffer.readUInt32LE(8);
  if (headerLength < 20) throw new GlbMalformedError('header length too small');

  if (buffer.length < 20) return { kind: 'need', bytes: 20 };
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== CHUNK_JSON) throw new GlbMalformedError('first chunk not JSON');
  if (jsonLength % 4 !== 0) throw new GlbMalformedError('JSON chunk not padded');
  const jsonChunkEnd = 20 + jsonLength;
  if (jsonChunkEnd > headerLength) throw new GlbMalformedError('JSON chunk overruns file');

  if (buffer.length < jsonChunkEnd) return { kind: 'need', bytes: jsonChunkEnd };
  const json = parseGltfJson(buffer.subarray(20, jsonChunkEnd));

  if (jsonChunkEnd === headerLength) return { kind: 'ok', head: { json, headerLength } };
  if (buffer.length < jsonChunkEnd + 8) return { kind: 'need', bytes: jsonChunkEnd + 8 };
  const binLength = buffer.readUInt32LE(jsonChunkEnd);
  if (buffer.readUInt32LE(jsonChunkEnd + 4) !== CHUNK_BIN)
    throw new GlbMalformedError('second chunk not BIN');
  if (binLength % 4 !== 0) throw new GlbMalformedError('BIN chunk not padded');
  if (jsonChunkEnd + 8 + binLength > headerLength)
    throw new GlbMalformedError('BIN chunk overruns file');
  return { kind: 'ok', head: { json, headerLength } };
};

/** Reads the JSON chunk's length from the first 20 bytes of a stored GLB. */
export const glbJsonChunkLength = (first20: Buffer): number => {
  if (first20.length < 20) throw new GlbMalformedError('header truncated');
  if (first20.readUInt32LE(0) !== GLB_MAGIC) throw new GlbMalformedError('bad magic');
  if (first20.readUInt32LE(4) !== 2) throw new GlbMalformedError('bad version');
  if (first20.readUInt32LE(16) !== CHUNK_JSON) throw new GlbMalformedError('first chunk not JSON');
  return first20.readUInt32LE(12);
};

export const parseGltfJson = (bytes: Buffer): GltfDocument => {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new GlbMalformedError('JSON chunk unparseable');
  }
  if (typeof document !== 'object' || document === null)
    throw new GlbMalformedError('JSON not an object');
  const gltf = document as GltfDocument;
  if (gltf.asset?.version !== '2.0') throw new GlbMalformedError('asset.version not 2.0');

  const used = new Set(stringList(gltf.extensionsUsed));
  const required = stringList(gltf.extensionsRequired);
  for (const name of required) {
    if (!used.has(name)) throw new GlbMalformedError(`${name} required but not used`);
    if (!(SUPPORTED_GLTF_EXTENSIONS as readonly string[]).includes(name))
      throw new GlbMalformedError(`${name} unsupported`);
  }

  for (const node of asArray(gltf.nodes) as GltfNode[]) {
    if (node === null || typeof node !== 'object') continue;
    const hasMatrix = node.matrix !== undefined;
    const hasTrs =
      node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined;
    if (hasMatrix && hasTrs) throw new GlbMalformedError('node mixes matrix with TRS');
  }

  const quantized = required.includes('KHR_mesh_quantization');
  const accessors = asArray(gltf.accessors) as GltfAccessor[];
  for (const mesh of asArray(gltf.meshes)) {
    for (const primitive of asArray((mesh as { primitives?: unknown })?.primitives)) {
      const index = (primitive as { attributes?: Record<string, unknown> })?.attributes?.POSITION;
      if (typeof index !== 'number') continue;
      const accessor = accessors[index];
      if (accessor === undefined) continue;
      const componentType = accessor.componentType;
      if (componentType === COMPONENT_FLOAT) continue;
      if (quantized && typeof componentType === 'number' && QUANTIZED_COMPONENTS.has(componentType))
        continue;
      throw new GlbMalformedError('POSITION accessor component type not allowed');
    }
  }

  return gltf;
};

export class MeasurementFailure extends Error {}

type Matrix = readonly number[]; // column-major, 16 entries

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const multiply = (a: Matrix, b: Matrix): number[] => {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
};

const fromTrs = (node: GltfNode): number[] => {
  const t = isNumberArray3(node.translation) ? node.translation : [0, 0, 0];
  const s = isNumberArray3(node.scale) ? node.scale : [1, 1, 1];
  const q =
    Array.isArray(node.rotation) &&
    node.rotation.length === 4 &&
    node.rotation.every((value) => typeof value === 'number')
      ? (node.rotation as number[])
      : [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
};

const localMatrix = (node: GltfNode): number[] => {
  if (Array.isArray(node.matrix)) {
    if (node.matrix.length !== 16 || !node.matrix.every((value) => typeof value === 'number'))
      throw new MeasurementFailure('node matrix malformed');
    return node.matrix as number[];
  }
  return fromTrs(node);
};

const transformPoint = (m: Matrix, x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const dequantize = (value: number, componentType: number, normalized: boolean): number => {
  if (!normalized) return value;
  switch (componentType) {
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
};

export type MeasuredDimensions = { x: number; y: number; z: number };

/**
 * The published bounding-box rule: every counted primitive's dequantized box corners
 * carried through each node's full world transform, then the axis-aligned box around them.
 */
export const measureGltf = (gltf: GltfDocument): MeasuredDimensions => {
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : [];
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes : [];

  let roots: number[];
  if (scenes.length === 0) {
    const isChild = new Set<number>();
    for (const node of nodes) {
      for (const child of asArray(node?.children)) {
        if (typeof child !== 'number') throw new MeasurementFailure('child index not a number');
        if (child < 0 || child >= nodes.length)
          throw new MeasurementFailure('child index out of range');
        isChild.add(child);
      }
    }
    roots = nodes.map((_, index) => index).filter((index) => !isChild.has(index));
  } else {
    const sceneIndex = typeof gltf.scene === 'number' ? gltf.scene : 0;
    if (sceneIndex < 0 || sceneIndex >= scenes.length)
      throw new MeasurementFailure('scene index out of range');
    roots = asArray(scenes[sceneIndex]?.nodes).map((entry) => {
      if (typeof entry !== 'number') throw new MeasurementFailure('scene node index not a number');
      return entry;
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let counted = 0;

  const visit = (index: number, parent: Matrix, path: Set<number>): void => {
    if (index < 0 || index >= nodes.length) throw new MeasurementFailure('node index out of range');
    if (path.has(index)) throw new MeasurementFailure('node hierarchy has a cycle');
    const node = nodes[index] ?? {};
    const world = multiply(parent, localMatrix(node));

    if (node.mesh !== undefined) {
      if (typeof node.mesh !== 'number' || node.mesh < 0 || node.mesh >= meshes.length)
        throw new MeasurementFailure('mesh index out of range');
      for (const primitive of asArray(meshes[node.mesh]?.primitives)) {
        const positionIndex = (primitive as { attributes?: Record<string, unknown> })?.attributes
          ?.POSITION;
        if (positionIndex === undefined) continue;
        if (
          typeof positionIndex !== 'number' ||
          positionIndex < 0 ||
          positionIndex >= accessors.length
        )
          throw new MeasurementFailure('accessor index out of range');
        const accessor = accessors[positionIndex] ?? {};
        if (!isNumberArray3(accessor.min) || !isNumberArray3(accessor.max)) continue;
        const componentType =
          typeof accessor.componentType === 'number' ? accessor.componentType : COMPONENT_FLOAT;
        const normalized = accessor.normalized === true;
        const low = accessor.min.map((value) => dequantize(value, componentType, normalized));
        const high = accessor.max.map((value) => dequantize(value, componentType, normalized));
        counted += 1;
        for (let corner = 0; corner < 8; corner += 1) {
          const [cx, cy, cz] = transformPoint(
            world,
            corner & 1 ? high[0] : low[0],
            corner & 2 ? high[1] : low[1],
            corner & 4 ? high[2] : low[2],
          );
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cz < minZ) minZ = cz;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
          if (cz > maxZ) maxZ = cz;
        }
      }
    }

    const next = new Set(path);
    next.add(index);
    for (const child of asArray(node.children)) {
      if (typeof child !== 'number') throw new MeasurementFailure('child index not a number');
      visit(child, world, next);
    }
  };

  for (const root of roots) visit(root, IDENTITY, new Set());

  if (counted === 0) throw new MeasurementFailure('no primitive counted');
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
};
