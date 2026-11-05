/** Minimal glTF binary reader and writer: positions, indices and bounding box are all we need. */

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshBounds(mesh: Mesh): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const v = mesh.positions[i + axis] ?? 0;
      if (v < (min[axis] ?? 0)) min[axis] = v;
      if (v > (max[axis] ?? 0)) max[axis] = v;
    }
  }
  if (!Number.isFinite(min[0])) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  return { min, max };
}

export function isGlb(data: Buffer): boolean {
  if (data.length < 20) return false;
  const magic = data.subarray(0, 4).toString('ascii');
  if (magic !== 'glTF') return false;
  const version = data.readUInt32LE(4);
  if (version !== 2) return false;
  const total = data.readUInt32LE(8);
  return total === data.length;
}

export interface ParsedGltf {
  json: Record<string, unknown>;
  binary: Buffer | null;
}

export function parseGlb(data: Buffer): ParsedGltf {
  if (!isGlb(data)) throw new Error('not a glb');
  let offset = 12;
  let json: Record<string, unknown> = {};
  let binary: Buffer | null = null;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkStart = offset + 8;
    const chunk = data.subarray(chunkStart, chunkStart + chunkLength);
    if (chunkType === 'JSON') {
      json = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, unknown>;
    } else if (chunkType === 'BIN\u0000') {
      binary = chunk;
    }
    offset = chunkStart + chunkLength;
  }
  if (Object.keys(json).length === 0) throw new Error('no json chunk');
  return { json, binary };
}

export function buildGlb(mesh: Mesh, extra?: { title?: string }): Buffer {
  const positions = Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  const indices = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'Turnstone Studio' },
    scene: 0,
    scenes: [{ nodes: [0], name: extra?.title ?? 'Model' }],
    nodes: [{ mesh: 0, name: extra?.title ?? 'Model' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [
      { byteLength: positions.length + indices.length },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.positions.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
  };
  const jsonText = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - (jsonText.length % 4)) % 4;
  const binPadding = (4 - (indices.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);
  const binChunk = Buffer.concat([positions, indices, Buffer.alloc(binPadding)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.write('JSON', 16, 'ascii');
  jsonChunk.copy(out, 20);
  const binHeader = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binHeader);
  out.write('BIN\u0000', binHeader + 4, 'ascii');
  binChunk.copy(out, binHeader + 8);
  return out;
}

export function scaleMesh(mesh: Mesh, factor: number): Mesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    positions[i] = (mesh.positions[i] ?? 0) * factor;
  }
  return { positions, indices: mesh.indices };
}

/** Extracts the first triangle mesh with positions from a glTF document. */
export function extractMesh(gltf: ParsedGltf): Mesh {
  const json = gltf.json;
  const buffers = (json.buffers as { byteLength: number; uri?: string }[] | undefined) ?? [];
  const views = (json.bufferViews as { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[] | undefined) ?? [];
  const accessors = (json.accessors as { bufferView?: number; componentType: number; count: number; type: string; byteOffset?: number; min?: number[]; max?: number[] }[] | undefined) ?? [];
  const meshes = (json.meshes as { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[] | undefined) ?? [];
  const resolveBuffer = (bufferIndex: number): Buffer | null => {
    const buffer = buffers[bufferIndex];
    if (buffer === undefined) return null;
    if (buffer.uri === undefined) return gltf.binary;
    if (buffer.uri.startsWith('data:application/octet-stream;base64,')) {
      return Buffer.from(buffer.uri.slice(37), 'base64');
    }
    return null;
  };
  const readAccessor = (index: number): Float32Array | Uint32Array | null => {
    const accessor = accessors[index];
    if (accessor === undefined || accessor.bufferView === undefined) return null;
    const view = views[accessor.bufferView];
    if (view === undefined) return null;
    const buffer = resolveBuffer(view.buffer);
    if (buffer === null) return null;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const componentCount = accessor.type === 'VEC3' ? 3 : accessor.type === 'SCALAR' ? 1 : accessor.type === 'VEC2' ? 2 : 4;
    if (accessor.componentType === 5126) {
      const out = new Float32Array(accessor.count * componentCount);
      for (let i = 0; i < out.length; i++) {
        out[i] = buffer.readFloatLE(start + i * 4);
      }
      return out;
    }
    if (accessor.componentType === 5125 || accessor.componentType === 5123 || accessor.componentType === 5121) {
      const out = new Uint32Array(accessor.count * componentCount);
      const width = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
      for (let i = 0; i < out.length; i++) {
        out[i] = accessor.componentType === 5125 ? buffer.readUInt32LE(start + i * 4) : accessor.componentType === 5123 ? buffer.readUInt16LE(start + i * width) : buffer.readUInt8(start + i * width);
      }
      return out;
    }
    return null;
  };
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives) {
      const positionIndex = primitive.attributes.POSITION;
      if (positionIndex === undefined) continue;
      if ((primitive.mode ?? 4) !== 4) continue;
      const positionsRaw = readAccessor(positionIndex);
      if (!(positionsRaw instanceof Float32Array)) continue;
      let indices: Uint32Array;
      if (primitive.indices !== undefined) {
        const indicesRaw = readAccessor(primitive.indices);
        if (indicesRaw === null) continue;
        indices = indicesRaw instanceof Uint32Array ? indicesRaw : new Uint32Array();
      } else {
        indices = new Uint32Array(positionsRaw.length / 3);
        for (let i = 0; i < indices.length; i++) indices[i] = i;
      }
      if (indices.length % 3 !== 0) continue;
      // Verify accessors stay within their buffer.
      const bufferLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
      const binaryLength = gltf.binary?.length ?? 0;
      if (gltf.binary !== null && bufferLength > binaryLength) throw new Error('accessor past buffer');
      const positions = new Float32Array(positionsRaw);
      return { positions, indices };
    }
  }
  throw new Error('no triangle mesh with positions');
}

/** Validates the package's glTF JSON structurally per the validate stage rules. */
export function validateGltf(gltf: ParsedGltf): { ok: boolean; mesh: Mesh | null; box: Box | null } {
  try {
    const mesh = extractMesh(gltf);
    const box = meshBounds(mesh);
    const size: [number, number, number] = [
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    ];
    if (size[0] === 0 || size[1] === 0 || size[2] === 0) {
      return { ok: false, mesh: null, box: null };
    }
    return { ok: true, mesh, box };
  } catch {
    return { ok: false, mesh: null, box: null };
  }
}

export function buildBoxMesh(width: number, height: number, depth: number, at?: { x: number; y: number; z: number }): Mesh {
  const cx = at?.x ?? 0;
  const cy = at?.y ?? 0;
  const cz = at?.z ?? 0;
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const positions = new Float32Array([
    cx - x, cy - y, cz - z, cx + x, cy - y, cz - z, cx + x, cy + y, cz - z, cx - x, cy + y, cz - z,
    cx - x, cy - y, cz + z, cx + x, cy - y, cz + z, cx + x, cy + y, cz + z, cx - x, cy + y, cz + z,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    1, 5, 6, 1, 6, 2,
    0, 3, 7, 0, 7, 4,
  ]);
  return { positions, indices };
}

export function buildCylinderMesh(radius: number, height: number, at?: { x: number; y: number; z: number }, segments = 16): Mesh {
  const cx = at?.x ?? 0;
  const cy = at?.y ?? 0;
  const cz = at?.z ?? 0;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    positions.push(cx + Math.cos(a) * radius, cy - height / 2, cz + Math.sin(a) * radius);
    positions.push(cx + Math.cos(b) * radius, cy - height / 2, cz + Math.sin(b) * radius);
    positions.push(cx + Math.cos(b) * radius, cy + height / 2, cz + Math.sin(b) * radius);
    positions.push(cx + Math.cos(a) * radius, cy + height / 2, cz + Math.sin(a) * radius);
    const base = i * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function mergeMeshes(meshes: Mesh[]): Mesh {
  const vertexCount = meshes.reduce((acc, m) => acc + m.positions.length / 3, 0);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(meshes.reduce((acc, m) => acc + m.indices.length, 0));
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertexOffset * 3);
    for (let i = 0; i < mesh.indices.length; i++) {
      indices[indexOffset + i] = (mesh.indices[i] ?? 0) + vertexOffset;
    }
    vertexOffset += mesh.positions.length / 3;
    indexOffset += mesh.indices.length;
  }
  return { positions, indices };
}
