import type { MeshData } from "./meshes.ts";
import { compose, identity, multiply, normalMatrix, transformPoint } from "./math.ts";
import type { Mat4 } from "./math.ts";
import type { Vec3 } from "../../shared/types.ts";

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors?: Accessor[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function read(gltf: Gltf, bin: DataView, index: number): number[] | null {
  const accessor = gltf.accessors?.[index];
  const view = accessor?.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
  if (!accessor || !view) return null;
  const width = COMPONENTS[accessor.type] ?? 1;
  const size = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 || accessor.componentType === 5122 ? 2 : 1;
  const stride = view.byteStride ?? width * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < width; c += 1) {
      const at = start + i * stride + c * size;
      switch (accessor.componentType) {
        case 5126: out.push(bin.getFloat32(at, true)); break;
        case 5125: out.push(bin.getUint32(at, true)); break;
        case 5123: out.push(bin.getUint16(at, true)); break;
        case 5122: out.push(bin.getInt16(at, true)); break;
        case 5121: out.push(bin.getUint8(at)); break;
        default: out.push(bin.getInt8(at));
      }
    }
  }
  return out;
}

function nodeMatrix(node: GltfNode): Mat4 {
  if (node.matrix && node.matrix.length === 16) return new Float32Array(node.matrix);
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [0, 0, 0, 1];
  const m = compose([t[0] ?? 0, t[1] ?? 0, t[2] ?? 0], [0, 0, 0], [1, 1, 1]);
  const r = new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ]);
  const scaled = compose([0, 0, 0], [0, 0, 0], [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1]);
  return multiply(m, multiply(r, scaled));
}

/** Reads a binary glTF 2.0 file into one merged mesh; returns null when the file cannot be read. */
export function parseGlb(buffer: ArrayBuffer): MeshData | null {
  const header = new DataView(buffer);
  if (buffer.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67) return null;
  let gltf: Gltf | null = null;
  let bin: DataView | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = header.getUint32(offset, true);
    const kind = header.getUint32(offset + 4, true);
    const body = offset + 8;
    if (kind === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, body, length))) as Gltf;
    if (kind === 0x004e4942) bin = new DataView(buffer, body, length);
    offset = body + length + ((4 - (length % 4)) % 4);
  }
  if (!gltf || !bin) return null;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const visit = (nodeIndex: number, parent: Mat4): void => {
    const node = gltf?.nodes?.[nodeIndex];
    if (!node || !gltf || !bin) return;
    const world = multiply(parent, nodeMatrix(node));
    const normalXform = normalMatrix(world);
    for (const primitive of node.mesh === undefined ? [] : (gltf.meshes?.[node.mesh]?.primitives ?? [])) {
      const position = read(gltf, bin, primitive.attributes["POSITION"] ?? -1);
      if (!position) continue;
      const count = position.length / 3;
      const given = primitive.attributes["NORMAL"] === undefined ? null : read(gltf, bin, primitive.attributes["NORMAL"]);
      const uv = primitive.attributes["TEXCOORD_0"] === undefined ? null : read(gltf, bin, primitive.attributes["TEXCOORD_0"]);
      const order = primitive.indices === undefined ? null : read(gltf, bin, primitive.indices);
      const base = positions.length / 3;
      const triangles = order ?? Array.from({ length: count }, (_value, i) => i);
      const world3 = (i: number): Vec3 => transformPoint(world, [position[i * 3] ?? 0, position[i * 3 + 1] ?? 0, position[i * 3 + 2] ?? 0]);
      for (let i = 0; i < count; i += 1) {
        positions.push(...world3(i));
        uvs.push(uv?.[i * 2] ?? 0, uv?.[i * 2 + 1] ?? 0);
        if (given) {
          const nx = given[i * 3] ?? 0;
          const ny = given[i * 3 + 1] ?? 0;
          const nz = given[i * 3 + 2] ?? 0;
          normals.push(
            (normalXform[0] ?? 0) * nx + (normalXform[3] ?? 0) * ny + (normalXform[6] ?? 0) * nz,
            (normalXform[1] ?? 0) * nx + (normalXform[4] ?? 0) * ny + (normalXform[7] ?? 0) * nz,
            (normalXform[2] ?? 0) * nx + (normalXform[5] ?? 0) * ny + (normalXform[8] ?? 0) * nz,
          );
        } else {
          normals.push(0, 0, 0);
        }
      }
      if (!given) {
        for (let t = 0; t + 2 < triangles.length; t += 3) {
          const [a, b, c] = [triangles[t] ?? 0, triangles[t + 1] ?? 0, triangles[t + 2] ?? 0];
          const pa = world3(a);
          const pb = world3(b);
          const pc = world3(c);
          const u: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
          const v: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
          const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          for (const vertex of [a, b, c]) {
            normals[(base + vertex) * 3] = n[0];
            normals[(base + vertex) * 3 + 1] = n[1];
            normals[(base + vertex) * 3 + 2] = n[2];
          }
        }
      }
      for (const index of triangles) indices.push(base + index);
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(root, identity());
  if (positions.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}
