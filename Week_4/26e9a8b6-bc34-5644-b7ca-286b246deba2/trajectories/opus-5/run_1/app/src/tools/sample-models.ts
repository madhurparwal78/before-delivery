/** Generates the sample binary glTF 2.0 files from simple solids. */

export interface SolidNode {
  name: string;
  /** Metres, as glTF lengths are metres. */
  size: [number, number, number];
  position: [number, number, number];
  colour: [number, number, number];
  children?: SolidNode[];
}

export const SAMPLE_SOLIDS: Record<string, SolidNode[]> = {
  'coffee-grinder': [
    {
      name: 'Housing',
      size: [0.12, 0.14, 0.12],
      position: [0, 0.07, 0],
      colour: [0.24, 0.22, 0.2],
      children: [
        { name: 'Hopper', size: [0.11, 0.09, 0.11], position: [0, 0.115, 0], colour: [0.8, 0.82, 0.85] },
        { name: 'Bean chute', size: [0.04, 0.05, 0.04], position: [0.045, 0.02, 0], colour: [0.9, 0.72, 0.2] },
        { name: 'Upper burr', size: [0.07, 0.012, 0.07], position: [0, 0.05, 0], colour: [0.68, 0.7, 0.74] },
        { name: 'Motor', size: [0.08, 0.06, 0.08], position: [0, -0.04, 0], colour: [0.18, 0.2, 0.26] },
        {
          name: 'Drive shaft',
          size: [0.014, 0.08, 0.014],
          position: [0, 0.01, 0],
          colour: [0.55, 0.57, 0.6],
          children: [
            { name: 'Lower burr', size: [0.065, 0.012, 0.065], position: [0, 0.03, 0], colour: [0.72, 0.6, 0.35] },
          ],
        },
      ],
    },
    { name: 'Base plate', size: [0.13, 0.01, 0.13], position: [0, -0.005, 0], colour: [0.3, 0.3, 0.32] },
    { name: 'Grounds tray', size: [0.1, 0.035, 0.1], position: [0, -0.03, 0.02], colour: [0.52, 0.3, 0.22] },
  ],
  'bike-hub': [
    { name: 'Hub shell', size: [0.07, 0.05, 0.05], position: [0, 0, 0], colour: [0.3, 0.32, 0.36] },
    { name: 'Axle', size: [0.17, 0.01, 0.01], position: [0, 0, 0], colour: [0.72, 0.74, 0.78] },
    { name: 'Left cone', size: [0.012, 0.022, 0.022], position: [-0.042, 0, 0], colour: [0.62, 0.6, 0.55] },
    { name: 'Right cone', size: [0.012, 0.022, 0.022], position: [0.042, 0, 0], colour: [0.62, 0.6, 0.55] },
    { name: 'Left bearing', size: [0.008, 0.03, 0.03], position: [-0.03, 0, 0], colour: [0.85, 0.86, 0.88] },
    { name: 'Right bearing', size: [0.008, 0.03, 0.03], position: [0.03, 0, 0], colour: [0.85, 0.86, 0.88] },
    { name: 'Freehub body', size: [0.028, 0.042, 0.042], position: [0.05, 0, 0], colour: [0.25, 0.22, 0.2] },
    { name: 'Locknut', size: [0.008, 0.018, 0.018], position: [-0.06, 0, 0], colour: [0.5, 0.5, 0.52] },
    { name: 'Locknut', size: [0.008, 0.018, 0.018], position: [0.06, 0, 0], colour: [0.5, 0.5, 0.52] },
  ],
  'game-controller': [
    { name: 'Front shell', size: [0.15, 0.05, 0.1], position: [0, 0, 0.012], colour: [0.22, 0.23, 0.27] },
    { name: 'Back shell', size: [0.15, 0.05, 0.1], position: [0, 0, -0.012], colour: [0.16, 0.17, 0.2] },
    { name: 'Main board', size: [0.12, 0.004, 0.07], position: [0, 0, 0], colour: [0.1, 0.4, 0.22] },
    { name: 'Left stick', size: [0.018, 0.018, 0.012], position: [-0.04, 0.012, 0.016], colour: [0.12, 0.12, 0.14] },
    { name: 'Right stick', size: [0.018, 0.018, 0.012], position: [0.04, -0.012, 0.016], colour: [0.12, 0.12, 0.14] },
    { name: 'Left stick module', size: [0.024, 0.024, 0.014], position: [-0.04, 0.012, 0.004], colour: [0.7, 0.68, 0.2] },
    { name: 'Right stick module', size: [0.024, 0.024, 0.014], position: [0.04, -0.012, 0.004], colour: [0.7, 0.68, 0.2] },
    { name: 'Button pad', size: [0.028, 0.028, 0.006], position: [0.045, 0.014, 0.014], colour: [0.75, 0.25, 0.2] },
    { name: 'Battery', size: [0.05, 0.02, 0.012], position: [0, -0.014, -0.008], colour: [0.35, 0.35, 0.38] },
    { name: 'Trigger spring', size: [0.008, 0.008, 0.02], position: [-0.058, 0.02, -0.014], colour: [0.8, 0.8, 0.82] },
  ],
};

export const SAMPLE_NAMES = Object.keys(SAMPLE_SOLIDS);

const FACES: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

function align4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}

interface GltfJson {
  asset: { version: string; generator: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name: string;
    mesh?: number;
    children?: number[];
    translation?: [number, number, number];
  }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: {
    name: string;
    pbrMetallicRoughness: {
      baseColorFactor: [number, number, number, number];
      metallicFactor: number;
      roughnessFactor: number;
    };
  }[];
  accessors: {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[];
  buffers: { byteLength: number }[];
}

function boxGeometry(size: [number, number, number]): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
  min: [number, number, number];
  max: [number, number, number];
} {
  const half: [number, number, number] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);
  let v = 0;
  let i = 0;
  for (const face of FACES) {
    const base = v;
    for (const corner of face.corners) {
      positions[v * 3] = corner[0] * half[0];
      positions[v * 3 + 1] = corner[1] * half[1];
      positions[v * 3 + 2] = corner[2] * half[2];
      normals[v * 3] = face.normal[0];
      normals[v * 3 + 1] = face.normal[1];
      normals[v * 3 + 2] = face.normal[2];
      v += 1;
    }
    indices[i] = base;
    indices[i + 1] = base + 1;
    indices[i + 2] = base + 2;
    indices[i + 3] = base;
    indices[i + 4] = base + 2;
    indices[i + 5] = base + 3;
    i += 6;
  }
  return {
    positions,
    normals,
    indices,
    min: [-half[0], -half[1], -half[2]],
    max: [half[0], half[1], half[2]],
  };
}

export function buildSampleGlb(roots: readonly SolidNode[], generator: string): Uint8Array {
  const json: GltfJson = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const chunks: Uint8Array[] = [];
  let binaryLength = 0;

  const pushView = (data: Uint8Array, target: number): number => {
    const padding = align4(binaryLength) - binaryLength;
    if (padding > 0) {
      chunks.push(new Uint8Array(padding));
      binaryLength += padding;
    }
    const byteOffset = binaryLength;
    chunks.push(data);
    binaryLength += data.byteLength;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target });
    return json.bufferViews.length - 1;
  };

  const addNode = (solid: SolidNode): number => {
    const geometry = boxGeometry(solid.size);
    const positionView = pushView(new Uint8Array(geometry.positions.buffer.slice(0)), 34962);
    const normalView = pushView(new Uint8Array(geometry.normals.buffer.slice(0)), 34962);
    const indexView = pushView(new Uint8Array(geometry.indices.buffer.slice(0)), 34963);

    json.accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: 24,
      type: 'VEC3',
      min: geometry.min,
      max: geometry.max,
    });
    const positionAccessor = json.accessors.length - 1;
    json.accessors.push({ bufferView: normalView, componentType: 5126, count: 24, type: 'VEC3' });
    const normalAccessor = json.accessors.length - 1;
    json.accessors.push({ bufferView: indexView, componentType: 5123, count: 36, type: 'SCALAR' });
    const indexAccessor = json.accessors.length - 1;

    json.materials.push({
      name: `${solid.name} material`,
      pbrMetallicRoughness: {
        baseColorFactor: [solid.colour[0], solid.colour[1], solid.colour[2], 1],
        metallicFactor: 0.25,
        roughnessFactor: 0.55,
      },
    });
    const material = json.materials.length - 1;

    json.meshes.push({
      name: `${solid.name} mesh`,
      primitives: [
        {
          attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
          indices: indexAccessor,
          material,
        },
      ],
    });
    const mesh = json.meshes.length - 1;

    json.nodes.push({ name: solid.name, mesh, translation: solid.position });
    const nodeIndex = json.nodes.length - 1;
    const children = (solid.children ?? []).map(addNode);
    if (children.length > 0) {
      const node = json.nodes[nodeIndex];
      if (node) node.children = children;
    }
    return nodeIndex;
  };

  for (const root of roots) json.scenes[0]?.nodes.push(addNode(root));

  const paddedBinary = align4(binaryLength);
  json.buffers[0] = { byteLength: paddedBinary };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJson = align4(jsonBytes.byteLength);

  const total = 12 + 8 + paddedJson + 8 + paddedBinary;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, paddedJson, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJson);
  const binStart = 20 + paddedJson;
  view.setUint32(binStart, paddedBinary, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  let cursor = binStart + 8;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}
