/** The three sample models, built from simple solids (boxes, cylinders, cones). Each node with a mesh is one part. */

type Vec = [number, number, number];

interface Solid { positions: number[]; normals: number[]; indices: number[] }

function box(w: number, h: number, d: number): Solid {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [Vec, Vec, Vec][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const half: Vec = [w / 2, h / 2, d / 2];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      for (let k = 0; k < 3; k++) positions.push((n[k]! + u[k]! * a + v[k]! * b) * half[k]!);
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

/** A cylinder or truncated cone along Y, `radiusBottom` at -h/2 and `radiusTop` at +h/2. */
function cylinder(radiusBottom: number, radiusTop: number, h: number, segments = 28): Solid {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const slope = (radiusBottom - radiusTop) / h;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const length = Math.hypot(1, slope);
    positions.push(c * radiusBottom, -h / 2, s * radiusBottom, c * radiusTop, h / 2, s * radiusTop);
    normals.push(c / length, slope / length, s / length, c / length, slope / length, s / length);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  for (const [y, radius, up] of [[-h / 2, radiusBottom, -1], [h / 2, radiusTop, 1]] as const) {
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, up, 0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      normals.push(0, up, 0);
    }
    for (let i = 0; i < segments; i++) indices.push(center, center + 1 + i + (up > 0 ? 1 : 0), center + 1 + i + (up > 0 ? 0 : 1));
  }
  return { positions, normals, indices };
}

interface Part { name: string; solid: Solid; color: [number, number, number]; at?: Vec; turn?: 'x' | 'z'; children?: Part[] }

const STEEL: [number, number, number] = [0.8, 0.84, 0.88];
const BRASS: [number, number, number] = [1, 0.8, 0.35];
const CREAM: [number, number, number] = [0.97, 0.93, 0.82];
const RUBBER: [number, number, number] = [0.17, 0.15, 0.14];
const COPPER: [number, number, number] = [0.98, 0.6, 0.4];

const models: Record<string, Part[]> = {
  'coffee-grinder': [
    {
      name: 'Housing', solid: box(0.15, 0.13, 0.13), color: CREAM, at: [0, 0.085, 0],
      children: [
        { name: 'Hopper', solid: cylinder(0.035, 0.075, 0.13), color: COPPER, at: [0, 0.205, 0] },
        { name: 'Bean chute', solid: box(0.04, 0.05, 0.05), color: BRASS, at: [0, 0.12, 0.05] },
        { name: 'Upper burr', solid: cylinder(0.042, 0.042, 0.016), color: BRASS, at: [0, 0.09, 0] },
        { name: 'Motor', solid: cylinder(0.04, 0.04, 0.1), color: STEEL, at: [0, -0.02, 0] },
        {
          name: 'Drive shaft', solid: cylinder(0.007, 0.007, 0.1), color: STEEL, at: [0, 0.03, 0],
          children: [{ name: 'Lower burr', solid: cylinder(0.045, 0.045, 0.016), color: BRASS, at: [0, 0.04, 0] }],
        },
      ],
    },
    { name: 'Base plate', solid: box(0.22, 0.02, 0.18), color: RUBBER, at: [0, 0.01, 0] },
    { name: 'Grounds tray', solid: box(0.1, 0.03, 0.08), color: STEEL, at: [0, 0.025, 0.1] },
  ],
  'bike-hub': [
    { name: 'Hub shell', solid: cylinder(0.03, 0.03, 0.1), color: STEEL, turn: 'z' },
    { name: 'Axle', solid: cylinder(0.005, 0.005, 0.2), color: STEEL, turn: 'z' },
    { name: 'Left cone', solid: cylinder(0.011, 0.018, 0.02), color: BRASS, at: [-0.056, 0, 0], turn: 'z' },
    { name: 'Right cone', solid: cylinder(0.018, 0.011, 0.02), color: BRASS, at: [0.056, 0, 0], turn: 'z' },
    { name: 'Left bearing', solid: cylinder(0.02, 0.02, 0.012), color: COPPER, at: [-0.04, 0, 0], turn: 'z' },
    { name: 'Right bearing', solid: cylinder(0.02, 0.02, 0.012), color: COPPER, at: [0.04, 0, 0], turn: 'z' },
    { name: 'Freehub body', solid: cylinder(0.024, 0.024, 0.04), color: RUBBER, at: [0.08, 0, 0], turn: 'z' },
    { name: 'Locknut', solid: cylinder(0.014, 0.014, 0.014), color: CREAM, at: [-0.075, 0, 0], turn: 'z' },
    { name: 'Locknut', solid: cylinder(0.014, 0.014, 0.014), color: CREAM, at: [0.1, 0, 0], turn: 'z' },
  ],
  'game-controller': [
    { name: 'Front shell', solid: box(0.17, 0.075, 0.014), color: CREAM, at: [0, 0, 0.014] },
    { name: 'Back shell', solid: box(0.17, 0.075, 0.014), color: RUBBER, at: [0, 0, -0.014] },
    { name: 'Main board', solid: box(0.15, 0.062, 0.003), color: COPPER, at: [0, 0, 0] },
    { name: 'Left stick', solid: cylinder(0.011, 0.011, 0.014), color: STEEL, at: [-0.045, 0.004, 0.03], turn: 'x' },
    { name: 'Right stick', solid: cylinder(0.011, 0.011, 0.014), color: STEEL, at: [0.02, -0.014, 0.03], turn: 'x' },
    { name: 'Left stick module', solid: box(0.026, 0.026, 0.01), color: BRASS, at: [-0.045, 0.004, 0.008] },
    { name: 'Right stick module', solid: box(0.026, 0.026, 0.01), color: BRASS, at: [0.02, -0.014, 0.008] },
    { name: 'Button pad', solid: box(0.032, 0.032, 0.008), color: CREAM, at: [0.05, 0.012, 0.025] },
    { name: 'Battery', solid: box(0.05, 0.03, 0.008), color: STEEL, at: [0, 0, -0.006] },
    { name: 'Trigger spring', solid: cylinder(0.004, 0.004, 0.03), color: STEEL, at: [-0.065, 0.03, -0.004], turn: 'z' },
  ],
};

export const sampleNames = Object.keys(models);

function pad(bytes: Uint8Array, filler: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(filler);
  out.set(bytes);
  return out;
}

/** Builds a binary glTF 2.0 file for one sample: one buffer, one mesh per part, nested nodes as listed. */
export function sampleGlb(name: string): Buffer {
  const tree = models[name];
  if (!tree) throw new Error(`No sample model named ${name}`);
  const chunks: Buffer[] = [];
  let length = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const materials: object[] = [];
  const nodes: object[] = [];
  const add = (data: Buffer, target: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target });
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    chunks.push(padded);
    length += padded.length;
    return bufferViews.length - 1;
  };
  const place = (part: Part): number => {
    const positions = Buffer.from(new Float32Array(part.solid.positions).buffer);
    const normals = Buffer.from(new Float32Array(part.solid.normals).buffer);
    const indices = Buffer.from(new Uint16Array(part.solid.indices).buffer);
    const min = [0, 1, 2].map((k) => Math.min(...part.solid.positions.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...part.solid.positions.filter((_, i) => i % 3 === k)));
    accessors.push({ bufferView: add(positions, 34962), componentType: 5126, count: part.solid.positions.length / 3, type: 'VEC3', min, max });
    const positionAccessor = accessors.length - 1;
    accessors.push({ bufferView: add(normals, 34962), componentType: 5126, count: part.solid.normals.length / 3, type: 'VEC3' });
    const normalAccessor = accessors.length - 1;
    accessors.push({ bufferView: add(indices, 34963), componentType: 5123, count: part.solid.indices.length, type: 'SCALAR' });
    const indexAccessor = accessors.length - 1;
    materials.push({ name: part.name, pbrMetallicRoughness: { baseColorFactor: [...part.color, 1], metallicFactor: 0.15, roughnessFactor: 0.55 } });
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material: materials.length - 1 }] });
    const node: Record<string, unknown> = { name: part.name, mesh: meshes.length - 1 };
    if (part.at) node.translation = part.at;
    if (part.turn === 'z') node.rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    if (part.turn === 'x') node.rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const index = nodes.push(node) - 1;
    if (part.children) node.children = part.children.map(place);
    return index;
  };
  const roots = tree.map(place);
  const json = pad(
    Buffer.from(JSON.stringify({
      asset: { version: '2.0', generator: 'Pennywasher sample builder' }, scene: 0, scenes: [{ nodes: roots }], nodes, meshes, materials, accessors, bufferViews,
      buffers: [{ byteLength: length }],
    })),
    0x20,
  );
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, json, binHead, bin]);
}
