import type { MeshData } from './geometry.js';

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
}

interface BufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
}

interface Primitive {
  attributes: Record<string, number>;
  indices?: number;
}

interface Gltf {
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  meshes?: { primitives: Primitive[] }[];
}

const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Reads the meshes out of a binary glTF 2.0 file. */
export function parseGlb(bytes: ArrayBuffer): MeshData[] {
  const view = new DataView(bytes);
  if (view.byteLength < 20) return [];
  let offset = 12;
  let json: Gltf | null = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, start, length))) as Gltf;
    } else if (type === 0x004e4942) {
      binary = new Uint8Array(bytes, start, length);
    }
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (json === null || binary === null) return [];

  const readAccessor = (index: number | undefined): Float32Array | Uint32Array | null => {
    if (index === undefined) return null;
    const accessor = json.accessors?.[index];
    const bufferView = accessor === undefined ? undefined : json.bufferViews?.[accessor.bufferView];
    if (accessor === undefined || bufferView === undefined || binary === null) return null;
    const components = TYPE_COUNT[accessor.type] ?? 1;
    const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const total = accessor.count * components;
    const source = binary.buffer as ArrayBuffer;
    const start = binary.byteOffset + base;
    if (accessor.componentType === 5126) return new Float32Array(source, start, total);
    if (accessor.componentType === 5125) return new Uint32Array(source, start, total);
    if (accessor.componentType === 5123) return Uint32Array.from(new Uint16Array(source, start, total));
    if (accessor.componentType === 5121) return Uint32Array.from(new Uint8Array(source, start, total));
    return null;
  };

  const meshes: MeshData[] = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const positions = readAccessor(primitive.attributes['POSITION']);
      if (!(positions instanceof Float32Array)) continue;
      const normalsRaw = readAccessor(primitive.attributes['NORMAL']);
      const uvsRaw = readAccessor(primitive.attributes['TEXCOORD_0']);
      const indicesRaw = readAccessor(primitive.indices);
      const vertexCount = positions.length / 3;
      const normals =
        normalsRaw instanceof Float32Array ? normalsRaw : new Float32Array(vertexCount * 3).fill(0.577);
      const uvs = uvsRaw instanceof Float32Array ? uvsRaw : new Float32Array(vertexCount * 2);
      const indices =
        indicesRaw === null
          ? Uint16Array.from({ length: vertexCount }, (_value, index) => index)
          : Uint16Array.from(indicesRaw);
      meshes.push({ positions, normals, uvs, indices });
    }
  }
  return meshes;
}
