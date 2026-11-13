// Upload validation: kind by bytes only, self-containment, name rules, units, extent.
// These rules are shared by the server (entry point for uploads) and the browser
// (which only needs the copy and unit tables).

export type UploadKind = 'glb' | 'gltf' | 'png' | 'jpeg';

export type UploadCheckResult =
  | { ok: true; kind: UploadKind; json?: GlbJson }
  | { ok: false; error: 'type' | 'damaged' | 'external' | 'name' | 'unit' | 'extent'; kind?: UploadKind };

export type GlbJson = {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<GltfNode>;
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number }; extensions?: unknown }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
  asset?: { version?: string };
};

export type GltfNode = {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  mesh?: number;
  children?: number[];
};

export const MAX_UPLOAD_BYTES = 10000000;
export const UNITS_SCALE: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

export function validUploadName(name: string): boolean {
  if (name.length < 1 || name.length > 120) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function validUnit(unit: string): boolean {
  return unit in UNITS_SCALE;
}

export function detectKind(bytes: Uint8Array): UploadKind | null {
  if (bytes.length >= 12) {
    const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    if (magic === 'glTF') {
      const version = readUint32(bytes, 4);
      const declared = readUint32(bytes, 8);
      if (version !== 2 || declared !== bytes.length) return null;
      return 'glb';
    }
  }
  if (bytes.length >= 8) {
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
    let isPng = true;
    for (let i = 0; i < 8; i++) {
      if (bytes[i]! !== pngSig[i]) { isPng = false; break; }
    }
    if (isPng) return 'png';
  }
  if (bytes.length >= 3) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  }
  // glTF JSON check
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as GlbJson;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.asset?.version === '2.0') return 'gltf';
    return null;
  } catch {
    return null;
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

export function parseGlb(bytes: Uint8Array): GlbJson | null {
  // Extract the JSON chunk from a GLB body.
  if (bytes.length < 20) return null;
  if (String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) !== 'glTF') return null;
  let offset = 12;
  let json: GlbJson | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32(bytes, offset);
    const chunkType = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0);
    const data = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      const parsed = JSON.parse(text) as GlbJson;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      json = parsed;
    }
    offset += 8 + chunkLength;
  }
  return json;
}

export function isSelfContained(json: GlbJson): boolean {
  const uris = [...(json.buffers ?? []).map((b) => b.uri), ...(json.images ?? []).map((i) => i.uri)];
  for (const uri of uris) {
    if (uri === undefined) continue;
    if (!uri.startsWith('data:')) return false;
  }
  return true;
}

// Matrix helpers (column-major, as glTF)
type Mat4 = number[];

function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function matMultiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j]! * b[i * 4 + k]!;
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function matFromTrs(t: number[] | undefined, r: number[] | undefined, s: number[] | undefined): Mat4 {
  const tx = t?.[0] ?? 0, ty = t?.[1] ?? 0, tz = t?.[2] ?? 0;
  const rx = r?.[0] ?? 0, ry = r?.[1] ?? 0, rz = r?.[2] ?? 0, rw = r?.[3] ?? 1;
  const sx = s?.[0] ?? 1, sy = s?.[1] ?? 1, sz = s?.[2] ?? 1;
  const x2 = rx + rx, y2 = ry + ry, z2 = rz + rz;
  const xx = rx * x2, xy = rx * y2, xz = rx * z2;
  const yy = ry * y2, yz = ry * z2, zz = rz * z2;
  const wx = rw * x2, wy = rw * y2, wz = rw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

export function measureExtentMetres(json: GlbJson, unit: string): number | null {
  // Returns the largest axis span of the transformed bounding box of all mesh
  // primitives in the default scene, converted to metres. Null when the model
  // has no measurable mesh.
  const scenes = json.scenes ?? [];
  const sceneIndex = typeof json.scene === 'number' ? json.scene : 0;
  const scene = scenes[sceneIndex];
  if (!scene || !scene.nodes || scene.nodes.length === 0) return null;
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let found = false;

  const visit = (nodeIndex: number, parent: Mat4): void => {
    const node = nodes[nodeIndex];
    if (!node) return;
    let local: Mat4;
    if (node.matrix && node.matrix.length === 16) {
      local = [...node.matrix];
    } else {
      local = matFromTrs(node.translation, node.rotation, node.scale);
    }
    const world = matMultiply(local, parent);
    if (typeof node.mesh === 'number') {
      const mesh = meshes[node.mesh];
      for (const prim of mesh?.primitives ?? []) {
        const posIndex = prim.attributes?.POSITION;
        if (typeof posIndex !== 'number') continue;
        const accessor = accessors[posIndex];
        if (!accessor || !accessor.min || !accessor.max) return;
        const [cx0, cy0, cz0] = [accessor.min[0] ?? 0, accessor.min[1] ?? 0, accessor.min[2] ?? 0];
        const [cx1, cy1, cz1] = [accessor.max[0] ?? 0, accessor.max[1] ?? 0, accessor.max[2] ?? 0];
        const corners: Array<[number, number, number]> = [
          [cx0, cy0, cz0], [cx1, cy0, cz0], [cx0, cy1, cz0], [cx1, cy1, cz0],
          [cx0, cy0, cz1], [cx1, cy0, cz1], [cx0, cy1, cz1], [cx1, cy1, cz1],
        ];
        for (const corner of corners) {
          const [x, y, z] = transformPoint(world, corner);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
        found = true;
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of scene.nodes) visit(root, matIdentity());
  if (!found) return null;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const extent = Math.max(spanX, spanY, spanZ);
  const scale = UNITS_SCALE[unit] ?? 1;
  return extent * scale;
}

export const EXTENT_MIN = 0.01;
export const EXTENT_MAX = 100;
