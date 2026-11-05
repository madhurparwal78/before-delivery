/** The browser-side reader: triangle positions and normals from a glTF binary. */

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
}

export interface Mesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function multiply(a: number[], b: number[]): number[] {
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

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix !== undefined && node.matrix.length === 16) return node.matrix;
  const t = node.translation ?? [0, 0, 0];
  const q = node.rotation ?? [0, 0, 0, 1];
  const sc = node.scale ?? [1, 1, 1];
  const [qx, qy, qz, qw] = [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1];
  const r = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy + qz * qw),
    2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw),
    2 * (qy * qz - qx * qw),
    1 - 2 * (qx * qx + qy * qy),
  ];
  const [sx, sy, sz] = [sc[0] ?? 1, sc[1] ?? 1, sc[2] ?? 1];
  return [
    (r[0] ?? 0) * sx, (r[1] ?? 0) * sx, (r[2] ?? 0) * sx, 0,
    (r[3] ?? 0) * sy, (r[4] ?? 0) * sy, (r[5] ?? 0) * sy, 0,
    (r[6] ?? 0) * sz, (r[7] ?? 0) * sz, (r[8] ?? 0) * sz, 0,
    t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, 1,
  ];
}

export function readGlbMesh(data: ArrayBuffer): Mesh {
  const view = new DataView(data);
  const total = view.getUint32(8, true);
  let json: GltfJson | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  let offset = 12;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, start, length))) as GltfJson;
    } else if (type === 0x004e4942) {
      bin = new Uint8Array(data, start, length);
    }
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new Error('The glTF binary has no JSON chunk');
  const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const layout = (index: number): { offset: number; stride: number; count: number; componentType: number } => {
    const accessor = json.accessors?.[index];
    if (accessor === undefined) throw new Error('Missing accessor');
    const bufferView = json.bufferViews?.[accessor.bufferView ?? 0];
    if (bufferView === undefined) throw new Error('Missing buffer view');
    const components = TYPE_COMPONENTS[accessor.type] ?? 1;
    const componentBytes = COMPONENT_BYTES[accessor.componentType] ?? 4;
    return {
      offset: (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
      stride: bufferView.byteStride ?? components * componentBytes,
      count: accessor.count,
      componentType: accessor.componentType,
    };
  };

  const readIndex = (base: number, componentType: number): number => {
    if (componentType === 5121) return binView.getUint8(base);
    if (componentType === 5123) return binView.getUint16(base, true);
    return binView.getUint32(base, true);
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const nodes = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  const emitMesh = (meshIndex: number, world: number[]): void => {
    const mesh = json.meshes?.[meshIndex];
    if (mesh === undefined) return;
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const positionIndex = primitive.attributes.POSITION;
      if (positionIndex === undefined) continue;
      const pos = layout(positionIndex);
      const vertex = (i: number): [number, number, number] => {
        const base = pos.offset + i * pos.stride;
        const x = binView.getFloat32(base, true);
        const y = binView.getFloat32(base + 4, true);
        const z = binView.getFloat32(base + 8, true);
        return [
          (world[0] ?? 0) * x + (world[4] ?? 0) * y + (world[8] ?? 0) * z + (world[12] ?? 0),
          (world[1] ?? 0) * x + (world[5] ?? 0) * y + (world[9] ?? 0) * z + (world[13] ?? 0),
          (world[2] ?? 0) * x + (world[6] ?? 0) * y + (world[10] ?? 0) * z + (world[14] ?? 0),
        ];
      };
      const indices =
        primitive.indices === undefined
          ? { count: pos.count, at: (i: number): number => i }
          : (() => {
              const l = layout(primitive.indices);
              return {
                count: l.count,
                at: (i: number): number => readIndex(l.offset + i * l.stride, l.componentType),
              };
            })();

      for (let i = 0; i + 2 < indices.count; i += 3) {
        const a = vertex(indices.at(i));
        const b = vertex(indices.at(i + 1));
        const c = vertex(indices.at(i + 2));
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        for (const point of [a, b, c]) {
          positions.push(point[0], point[1], point[2]);
          normals.push(nx, ny, nz);
          for (let axis = 0; axis < 3; axis += 1) {
            const value = point[axis] ?? 0;
            if (value < (min[axis] ?? Infinity)) min[axis] = value;
            if (value > (max[axis] ?? -Infinity)) max[axis] = value;
          }
        }
      }
    }
  };

  const walk = (index: number, parent: number[], depth: number): void => {
    if (depth > 64) return;
    const node = nodes[index];
    if (node === undefined) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) emitMesh(node.mesh, world);
    for (const child of node.children ?? []) walk(child, world, depth + 1);
  };
  for (const root of roots) walk(root, identity, 0);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    min,
    max,
  };
}
