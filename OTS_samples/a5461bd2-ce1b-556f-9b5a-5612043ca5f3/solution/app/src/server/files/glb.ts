import { vertexCount, type Mesh, type Vec3 } from "./mesh";

/** Writes a binary glTF 2.0 file: a tree of named nodes, each optionally drawing one mesh in one material. */

export interface Material {
  color: Vec3;
  alpha?: number;
  emissive?: Vec3;
  roughness: number;
  metallic: number;
}

export interface SceneNode {
  name: string;
  mesh?: Mesh;
  material?: Material;
  translation?: Vec3;
  children?: SceneNode[];
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: "VEC3" | "SCALAR";
  min?: number[];
  max?: number[];
}

function bounds(values: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = values[i + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  return { min, max };
}

export function writeGlb(root: SceneNode): Uint8Array {
  const chunks: Uint8Array[] = [];
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Accessor[] = [];
  const meshes: { name: string; primitives: [{ attributes: Record<string, number>; indices: number; material: number; mode: 4 }] }[] = [];
  const materials: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  let offset = 0;

  const store = (data: ArrayBufferView, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += padded.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (accessor: Accessor): number => accessors.push(accessor) - 1;

  const addMaterial = (material: Material): number => {
    materials.push({
      doubleSided: true,
      alphaMode: material.alpha !== undefined && material.alpha < 1 ? "BLEND" : "OPAQUE",
      pbrMetallicRoughness: { baseColorFactor: [...material.color, material.alpha ?? 1], metallicFactor: material.metallic, roughnessFactor: material.roughness },
      ...(material.emissive ? { emissiveFactor: material.emissive } : {}),
    });
    return materials.length - 1;
  };

  const addNode = (spec: SceneNode): number => {
    const node: Record<string, unknown> = { name: spec.name };
    if (spec.translation) node.translation = spec.translation;
    if (spec.mesh && spec.material) {
      const { mesh } = spec;
      const attributes: Record<string, number> = {};
      const { min, max } = bounds(mesh.positions);
      attributes.POSITION = addAccessor({ bufferView: store(new Float32Array(mesh.positions), ARRAY_BUFFER), componentType: FLOAT, count: vertexCount(mesh), type: "VEC3", min, max });
      attributes.NORMAL = addAccessor({ bufferView: store(new Float32Array(mesh.normals), ARRAY_BUFFER), componentType: FLOAT, count: vertexCount(mesh), type: "VEC3" });
      if (mesh.colors) attributes.COLOR_0 = addAccessor({ bufferView: store(new Float32Array(mesh.colors), ARRAY_BUFFER), componentType: FLOAT, count: vertexCount(mesh), type: "VEC3" });
      const wide = vertexCount(mesh) > 65535;
      const indices = addAccessor({
        bufferView: store(wide ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices), ELEMENT_ARRAY_BUFFER),
        componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT, count: mesh.indices.length, type: "SCALAR",
      });
      meshes.push({ name: spec.name, primitives: [{ attributes, indices, material: addMaterial(spec.material), mode: 4 }] });
      node.mesh = meshes.length - 1;
    }
    const at = nodes.push(node) - 1;
    if (spec.children?.length) node.children = spec.children.map(addNode);
    return at;
  };

  const rootIndex = addNode(root);
  const document = {
    asset: { version: "2.0", generator: "vellum-orbit-eight-worlds" },
    scene: 0,
    scenes: [{ nodes: [rootIndex] }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + jsonPadded.length + 8 + offset;
  const header = Buffer.alloc(12 + 8);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  header.writeUInt32LE(jsonPadded.length, 12);
  header.write("JSON", 16, "ascii");
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(offset, 0);
  binaryHeader.write("BIN\0", 4, "ascii");
  return Buffer.concat([header, jsonPadded, binaryHeader, ...chunks]);
}
