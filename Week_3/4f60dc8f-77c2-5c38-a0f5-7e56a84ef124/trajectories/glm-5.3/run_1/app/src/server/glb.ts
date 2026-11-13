/**
 * GLB acceptance and measurement.
 * Decided here alone: GLB structure checks, extension support, dequantization
 * and the bounding-box computation through node world transforms.
 */

export const SUPPORTED_EXTENSIONS = ['KHR_mesh_quantization', 'KHR_draco_mesh_compression', 'EXT_meshopt_compression'];

export interface GlbJson {
  asset?: { version?: unknown };
  scene?: unknown;
  scenes?: { nodes?: number[] }[];
  nodes?: NodeDef[];
  meshes?: { primitives: PrimitiveDef[] }[];
  accessors?: AccessorDef[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

interface NodeDef {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface PrimitiveDef {
  attributes?: { POSITION?: number };
  extensions?: { [name: string]: unknown };
}

interface AccessorDef {
  componentType?: number;
  normalized?: boolean;
  min?: number[];
  max?: number[];
}

export class GlbError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Validate a GLB buffer's structure. Throws GlbError when malformed. */
export function validateGlb(buffer: Buffer): GlbJson {
  if (buffer.length < 20) {
    throw new GlbError('short');
  }
  const magic = buffer.subarray(0, 4).toString('latin1');
  if (magic !== 'glTF') {
    throw new GlbError('magic');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new GlbError('version');
  }
  const totalLength = buffer.readUInt32LE(8);
  if (totalLength !== buffer.length) {
    throw new GlbError('length');
  }
  const firstChunkLength = buffer.readUInt32LE(12);
  const firstChunkType = buffer.subarray(16, 20).toString('latin1');
  if (firstChunkType !== 'JSON') {
    throw new GlbError('chunk type');
  }
  if (firstChunkLength % 4 !== 0) {
    throw new GlbError('chunk length');
  }
  const jsonEnd = 20 + firstChunkLength;
  if (jsonEnd > buffer.length) {
    throw new GlbError('chunk bounds');
  }
  let jsonText = buffer.subarray(20, jsonEnd).toString('utf8');
  jsonText = jsonText.replace(/\0+$/, '');
  let json: GlbJson;
  try {
    json = JSON.parse(jsonText) as GlbJson;
  } catch {
    throw new GlbError('json');
  }
  if (typeof json.asset !== 'object' || json.asset === null || json.asset.version !== '2.0') {
    throw new GlbError('asset version');
  }
  if (jsonEnd + 8 <= buffer.length) {
    const secondChunkLength = buffer.readUInt32LE(jsonEnd);
    const secondChunkType = buffer.subarray(jsonEnd + 4, jsonEnd + 8).toString('latin1');
    if (secondChunkType !== 'BIN\u0000') {
      throw new GlbError('second chunk type');
    }
    if (secondChunkLength % 4 !== 0 || jsonEnd + 8 + secondChunkLength > buffer.length) {
      throw new GlbError('second chunk bounds');
    }
  }
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  for (const extension of required) {
    if (!used.has(extension) || !SUPPORTED_EXTENSIONS.includes(extension)) {
      throw new GlbError('extension');
    }
  }
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  for (const node of nodes) {
    if (node.matrix && (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)) {
      throw new GlbError('matrix mix');
    }
  }
  const quantized = required.includes('KHR_mesh_quantization');
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  for (const mesh of meshes) {
    const accessors = Array.isArray(json.accessors) ? json.accessors : [];
    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) {
        continue;
      }
      const accessor = accessors[positionIndex];
      if (!accessor || typeof accessor.componentType !== 'number') {
        continue;
      }
      const allowed = quantized ? [5126, 5120, 5121, 5122, 5123] : [5126];
      if (!allowed.includes(accessor.componentType)) {
        throw new GlbError('component type');
      }
    }
  }
  return json;
}

/** Whether a quantized (non-float) POSITION accessor is present. */
export function requiresDequantization(json: GlbJson): boolean {
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  if (!used.has('KHR_mesh_quantization')) {
    return false;
  }
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) {
        continue;
      }
      const accessor = accessors[positionIndex];
      if (accessor && typeof accessor.componentType === 'number' && accessor.componentType !== 5126) {
        return true;
      }
    }
  }
  return false;
}

type Matrix4 = Float64Array;

function identity(): Matrix4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function fromTrs(translation: number[] | undefined, rotation: number[] | undefined, scale: number[] | undefined): Matrix4 {
  const t = translation ?? [0, 0, 0];
  const q = rotation ?? [0, 0, 0, 1];
  const s = scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0];
  m[1] = (xy + wz) * s[0];
  m[2] = (xz - wy) * s[0];
  m[3] = 0;
  m[4] = (xy - wz) * s[1];
  m[5] = (1 - (xx + zz)) * s[1];
  m[6] = (yz + wx) * s[1];
  m[7] = 0;
  m[8] = (xz + wy) * s[2];
  m[9] = (yz - wx) * s[2];
  m[10] = (1 - (xx + yy)) * s[2];
  m[11] = 0;
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

function fromMatrix(values: number[]): Matrix4 {
  const m = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    m[i] = values[i];
  }
  return m;
}

function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  // result = a * b (column-major, applying b then a)
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function transformPoint(m: Matrix4, p: number[]): number[] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Dequantize a component per the glTF normalized-integer mapping. */
function dequantize(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export class MeasurementError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Measure a validated GLB JSON's default-scene bounds in metres as exported.
 */
export function measureGlb(json: GlbJson): Dimensions {
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];

  let roots: number[];
  if (typeof json.scene === 'number' && scenes[json.scene]) {
    roots = [...(scenes[json.scene].nodes ?? [])];
  } else if (scenes.length > 0) {
    roots = [...(scenes[0].nodes ?? [])];
  } else {
    const childSet = new Set<number>();
    for (const node of nodes) {
      for (const child of node.children ?? []) {
        childSet.add(child);
      }
    }
    roots = nodes.map((_, index) => index).filter(index => !childSet.has(index));
  }

  const inBounds = (index: number) => index >= 0 && index < nodes.length;
  for (const root of roots) {
    if (!inBounds(root)) {
      throw new MeasurementError('node index');
    }
  }

  // Detect cycles across all reachable nodes.
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const checkCycle = (index: number): void => {
    if (visited.has(index)) {
      return;
    }
    if (visiting.has(index)) {
      throw new MeasurementError('cycle');
    }
    visiting.add(index);
    const node = nodes[index];
    for (const child of node.children ?? []) {
      if (!inBounds(child)) {
        throw new MeasurementError('node index');
      }
      checkCycle(child);
    }
    visiting.delete(index);
    visited.add(index);
  };
  for (const root of roots) {
    checkCycle(root);
  }

  const counted = new Set<string>();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let countedPrimitive = false;

  const walk = (index: number, world: Matrix4): void => {
    const node = nodes[index];
    const local = node.matrix
      ? fromMatrix(node.matrix)
      : fromTrs(node.translation, node.rotation, node.scale);
    const nodeWorld = multiply(world, local);
    if (typeof node.mesh === 'number') {
      if (node.mesh >= meshes.length) {
        throw new MeasurementError('mesh index');
      }
      const mesh = meshes[node.mesh];
      for (const primitive of mesh.primitives ?? []) {
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex === undefined || positionIndex >= accessors.length) {
          if (positionIndex !== undefined && positionIndex >= accessors.length) {
            throw new MeasurementError('accessor index');
          }
          continue;
        }
        const accessor = accessors[positionIndex];
        const min = Array.isArray(accessor.min) ? accessor.min : null;
        const max = Array.isArray(accessor.max) ? accessor.max : null;
        if (!min || !max || min.length !== 3 || max.length !== 3) {
          continue;
        }
        const componentType = typeof accessor.componentType === 'number' ? accessor.componentType : 5126;
        const normalized = accessor.normalized === true;
        const quantized = componentType !== 5126;
        const key = `${index}:${node.mesh}:${positionIndex}`;
        counted.add(key);
        const cornersMin = quantized && normalized
          ? [min[0], min[1], min[2]].map(value => dequantize(value, componentType))
          : [min[0], min[1], min[2]];
        const cornersMax = quantized && normalized
          ? [max[0], max[1], max[2]].map(value => dequantize(value, componentType))
          : [max[0], max[1], max[2]];
        for (let dx = 0; dx <= 1; dx++) {
          for (let dy = 0; dy <= 1; dy++) {
            for (let dz = 0; dz <= 1; dz++) {
              const corner = [
                dx === 0 ? cornersMin[0] : cornersMax[0],
                dy === 0 ? cornersMin[1] : cornersMax[1],
                dz === 0 ? cornersMin[2] : cornersMax[2],
              ];
              const p = transformPoint(nodeWorld, corner);
              minX = Math.min(minX, p[0]);
              minY = Math.min(minY, p[1]);
              minZ = Math.min(minZ, p[2]);
              maxX = Math.max(maxX, p[0]);
              maxY = Math.max(maxY, p[1]);
              maxZ = Math.max(maxZ, p[2]);
              countedPrimitive = true;
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) {
      walk(child, nodeWorld);
    }
  };
  for (const root of roots) {
    walk(root, identity());
  }

  if (!countedPrimitive || counted.size === 0) {
    throw new MeasurementError('no primitive counted');
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    throw new MeasurementError('no primitive counted');
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}
