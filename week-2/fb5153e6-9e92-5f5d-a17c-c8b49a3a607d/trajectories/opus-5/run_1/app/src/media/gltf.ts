/**
 * glTF binary reading, validation and scaling. A package's type is judged by
 * its bytes here, never by its file name.
 */

const MAGIC = 0x46546c67; // 'glTF' little-endian
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_FLOAT = 5126;

/** A package the validate stage cannot read as a 3D model. */
export class GltfInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GltfInvalidError';
  }
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export interface GltfBuffer {
  byteLength: number;
  uri?: string;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}

export interface GltfMesh {
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfScene {
  nodes?: number[];
}

export interface GltfImage {
  uri?: string;
  bufferView?: number;
}

export interface GltfJson {
  asset?: { version?: string };
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
  images?: GltfImage[];
  [key: string]: unknown;
}

export interface Glb {
  readonly json: GltfJson;
  readonly bin: Buffer;
}

/**
 * The published byte rules: `glTF`, version 2, the file's own length, and a
 * first chunk that is the JSON chunk.
 */
export function isGltfBinary(bytes: Buffer): boolean {
  if (bytes.length < 20) return false;
  if (bytes.readUInt32LE(0) !== MAGIC) return false;
  if (bytes.readUInt32LE(4) !== 2) return false;
  if (bytes.readUInt32LE(8) !== bytes.length) return false;
  const firstChunkLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== JSON_CHUNK) return false;
  return 20 + firstChunkLength <= bytes.length;
}

/** A ZIP archive starts with `PK` 3 4. */
export function isZipArchive(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function parseGlb(bytes: Buffer): Glb {
  if (!isGltfBinary(bytes)) throw new GltfInvalidError('Not a glTF binary');
  let json: GltfJson | null = null;
  let bin = Buffer.alloc(0);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new GltfInvalidError('A chunk reaches past the file');
    if (type === JSON_CHUNK && json === null) {
      try {
        const parsed: unknown = JSON.parse(bytes.subarray(start, end).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new GltfInvalidError('The JSON chunk is not a glTF object');
        }
        json = parsed as GltfJson;
      } catch (error) {
        if (error instanceof GltfInvalidError) throw error;
        throw new GltfInvalidError('The JSON chunk is not valid JSON');
      }
    } else if (type === BIN_CHUNK && bin.length === 0) {
      bin = Buffer.from(bytes.subarray(start, end));
    }
    offset = end + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new GltfInvalidError('The glTF binary has no JSON chunk');
  return { json, bin };
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/** Writes a GLB from its JSON and single binary buffer. */
export function writeGlb(json: GltfJson, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBytes.length);
  const binPad = pad4(bin.length);
  const jsonLength = jsonBytes.length + jsonPad;
  const binLength = bin.length + binPad;
  const total = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0);

  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  if (binLength > 0) {
    const binHeader = 20 + jsonLength;
    out.writeUInt32LE(binLength, binHeader);
    out.writeUInt32LE(BIN_CHUNK, binHeader + 4);
    bin.copy(out, binHeader + 8);
    out.fill(0, binHeader + 8 + bin.length, binHeader + 8 + binLength);
  }
  return out;
}

const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

interface AccessorLayout {
  readonly byteOffset: number;
  readonly stride: number;
  readonly componentBytes: number;
  readonly components: number;
  readonly count: number;
  readonly componentType: number;
}

/**
 * Resolves an accessor onto the binary buffer, refusing one that reaches past
 * its buffer or buffer view.
 */
function layoutOf(json: GltfJson, accessorIndex: number, binLength: number): AccessorLayout {
  const accessor = json.accessors?.[accessorIndex];
  if (accessor === undefined) throw new GltfInvalidError('An accessor is missing');
  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (components === undefined || componentBytes === undefined) {
    throw new GltfInvalidError('An accessor has an unknown type');
  }
  if (accessor.bufferView === undefined) {
    throw new GltfInvalidError('An accessor has no buffer view');
  }
  const view = json.bufferViews?.[accessor.bufferView];
  if (view === undefined) throw new GltfInvalidError('A buffer view is missing');
  const buffer = json.buffers?.[view.buffer];
  if (buffer === undefined) throw new GltfInvalidError('A buffer is missing');

  const viewOffset = view.byteOffset ?? 0;
  if (viewOffset + view.byteLength > buffer.byteLength || viewOffset + view.byteLength > binLength) {
    throw new GltfInvalidError('A buffer view reaches past its buffer');
  }
  const elementBytes = components * componentBytes;
  const stride = view.byteStride ?? elementBytes;
  const accessorOffset = accessor.byteOffset ?? 0;
  const span = accessor.count === 0 ? 0 : (accessor.count - 1) * stride + elementBytes;
  if (accessorOffset + span > view.byteLength) {
    throw new GltfInvalidError('An accessor reaches past its buffer view');
  }
  return {
    byteOffset: viewOffset + accessorOffset,
    stride,
    componentBytes,
    components,
    count: accessor.count,
    componentType: accessor.componentType,
  };
}

function readComponent(bin: Buffer, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120:
      return bin.readInt8(offset);
    case 5121:
      return bin.readUInt8(offset);
    case 5122:
      return bin.readInt16LE(offset);
    case 5123:
      return bin.readUInt16LE(offset);
    case 5125:
      return bin.readUInt32LE(offset);
    case 5126:
      return bin.readFloatLE(offset);
    default:
      throw new GltfInvalidError('An accessor has an unknown component type');
  }
}

type Matrix = readonly number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4x4 multiply, matching glTF's `matrix` layout. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function trsMatrix(node: GltfNode): Matrix {
  if (node.matrix !== undefined && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = [node.translation?.[0] ?? 0, node.translation?.[1] ?? 0, node.translation?.[2] ?? 0];
  const [qx, qy, qz, qw] = [
    node.rotation?.[0] ?? 0,
    node.rotation?.[1] ?? 0,
    node.rotation?.[2] ?? 0,
    node.rotation?.[3] ?? 1,
  ];
  const [sx, sy, sz] = [node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1];
  const r = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy + qz * qw),
    2 * (qx * qz - qy * qw),
    0,
    2 * (qx * qy - qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz + qx * qw),
    0,
    2 * (qx * qz + qy * qw),
    2 * (qy * qz - qx * qw),
    1 - 2 * (qx * qx + qy * qy),
    0,
    0,
    0,
    0,
    1,
  ];
  const scaled = [
    (r[0] ?? 0) * sx,
    (r[1] ?? 0) * sx,
    (r[2] ?? 0) * sx,
    0,
    (r[4] ?? 0) * sy,
    (r[5] ?? 0) * sy,
    (r[6] ?? 0) * sy,
    0,
    (r[8] ?? 0) * sz,
    (r[9] ?? 0) * sz,
    (r[10] ?? 0) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
  return scaled;
}

function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

interface MeshInstance {
  readonly mesh: number;
  readonly world: Matrix;
}

/** Every mesh the scene draws, with its world transform. */
function meshInstances(json: GltfJson): readonly MeshInstance[] {
  const nodes = json.nodes ?? [];
  const out: MeshInstance[] = [];
  const roots =
    json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const walk = (index: number, parent: Matrix, depth: number): void => {
    if (depth > 64) return;
    const node = nodes[index];
    if (node === undefined) return;
    const world = multiply(parent, trsMatrix(node));
    if (node.mesh !== undefined) out.push({ mesh: node.mesh, world });
    for (const child of node.children ?? []) walk(child, world, depth + 1);
  };
  for (const root of roots) walk(root, IDENTITY, 0);
  return out;
}

export interface BoundingBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface Geometry {
  /** Nine numbers per triangle, in the GLB's own units. */
  readonly triangles: Float32Array;
  readonly box: BoundingBox;
}

function positionReader(
  json: GltfJson,
  bin: Buffer,
  accessorIndex: number,
): ((i: number) => [number, number, number]) | null {
  const layout = layoutOf(json, accessorIndex, bin.length);
  if (layout.componentType !== COMPONENT_FLOAT || layout.components !== 3) return null;
  return (i: number): [number, number, number] => {
    const base = layout.byteOffset + i * layout.stride;
    return [bin.readFloatLE(base), bin.readFloatLE(base + 4), bin.readFloatLE(base + 8)];
  };
}

function indexReader(
  json: GltfJson,
  bin: Buffer,
  accessorIndex: number | undefined,
  vertexCount: number,
): { count: number; at: (i: number) => number } {
  if (accessorIndex === undefined) {
    return { count: vertexCount, at: (i) => i };
  }
  const layout = layoutOf(json, accessorIndex, bin.length);
  return {
    count: layout.count,
    at: (i) =>
      readComponent(bin, layout.byteOffset + i * layout.stride, layout.componentType),
  };
}

const TRIANGLES_MODE = 4;

/**
 * Reads every triangle the model draws and its bounding box. Fails when the
 * model has no triangle mesh with positions or the box has zero size.
 */
export function readGeometry(glb: Glb): Geometry {
  const { json, bin } = glb;
  const triangles: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const instance of meshInstances(json)) {
    const mesh = json.meshes?.[instance.mesh];
    if (mesh === undefined) continue;
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? TRIANGLES_MODE) !== TRIANGLES_MODE) continue;
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) continue;
      const read = positionReader(json, bin, positionAccessor);
      if (read === null) continue;
      const vertexCount = json.accessors?.[positionAccessor]?.count ?? 0;
      const indices = indexReader(json, bin, primitive.indices, vertexCount);
      for (let i = 0; i + 2 < indices.count; i += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = indices.at(i + corner);
          if (vertex >= vertexCount) throw new GltfInvalidError('An index reaches past its vertices');
          const [lx, ly, lz] = read(vertex);
          const [x, y, z] = transformPoint(instance.world, lx, ly, lz);
          triangles.push(x, y, z);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }
  }

  if (triangles.length === 0) {
    throw new GltfInvalidError('The model has no triangle mesh with positions');
  }
  const box: BoundingBox = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  if (
    box.max[0] - box.min[0] <= 0 ||
    box.max[1] - box.min[1] <= 0 ||
    box.max[2] - box.min[2] <= 0
  ) {
    throw new GltfInvalidError('The bounding box has zero size on an axis');
  }
  return { triangles: new Float32Array(triangles), box };
}

/** Multiplies every position by the source unit's factor to metres. */
export function scaleGlbPositions(glb: Glb, factor: number): Buffer {
  const json: GltfJson = JSON.parse(JSON.stringify(glb.json)) as GltfJson;
  const bin = Buffer.from(glb.bin);
  const scaled = new Set<number>();

  const positionAccessors = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const index = primitive.attributes?.POSITION;
      if (index !== undefined) positionAccessors.add(index);
    }
  }

  for (const accessorIndex of positionAccessors) {
    const layout = layoutOf(json, accessorIndex, bin.length);
    if (layout.componentType !== COMPONENT_FLOAT || layout.components !== 3) continue;
    for (let i = 0; i < layout.count; i += 1) {
      const base = layout.byteOffset + i * layout.stride;
      // Two accessors may alias the same bytes; each float triple scales once.
      if (scaled.has(base)) continue;
      scaled.add(base);
      for (let c = 0; c < 3; c += 1) {
        bin.writeFloatLE(bin.readFloatLE(base + c * 4) * factor, base + c * 4);
      }
    }
    const accessor = json.accessors?.[accessorIndex];
    if (accessor !== undefined) {
      if (accessor.min !== undefined) accessor.min = accessor.min.map((v) => v * factor);
      if (accessor.max !== undefined) accessor.max = accessor.max.map((v) => v * factor);
    }
  }
  return writeGlb(json, bin);
}
