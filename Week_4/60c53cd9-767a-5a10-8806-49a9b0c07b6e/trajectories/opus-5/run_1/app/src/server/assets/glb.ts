/**
 * The stored tower models: a 38-storey octagonal shell and one floor plate per
 * band, each with a window node per stack. Meshes are Draco-compressed, and the
 * plate's window nodes are what every unit's bearing is derived from.
 */

import draco3d from 'draco3d';
import { FLOOR_BANDS, STACKS, type BandId, type StackLetter } from '../../shared/units';
import { bearingFromModelDirection } from '../../shared/derived';

const DRACO_EXTENSION = 'KHR_draco_mesh_compression';

interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

interface GltfNode {
  name: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
}

type EncoderModule = Awaited<ReturnType<typeof draco3d.createEncoderModule>>;

let encoderModulePromise: Promise<EncoderModule> | undefined;

function encoderModule(): Promise<EncoderModule> {
  encoderModulePromise ??= draco3d.createEncoderModule({});
  return encoderModulePromise;
}

async function dracoEncode(mesh: MeshData): Promise<{ bytes: Buffer; positionAttributeId: number }> {
  const module = await encoderModule();
  const encoder = new module.Encoder();
  const builder = new module.MeshBuilder();
  const dracoMesh = new module.Mesh();
  builder.AddFacesToMesh(dracoMesh, mesh.indices.length / 3, mesh.indices);
  const positionAttributeId = builder.AddFloatAttributeToMesh(
    dracoMesh,
    module.POSITION,
    mesh.positions.length / 3,
    3,
    mesh.positions,
  );
  encoder.SetSpeedOptions(5, 5);
  encoder.SetAttributeQuantization(module.POSITION, 14);
  encoder.SetEncodingMethod(module.MESH_EDGEBREAKER_ENCODING);
  const encoded = new module.DracoInt8Array();
  const length = encoder.EncodeMeshToDracoBuffer(dracoMesh, encoded);
  if (length <= 0) throw new Error('Draco compression failed');
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) bytes[index] = encoded.GetValue(index) & 0xff;
  module.destroy(encoded);
  module.destroy(dracoMesh);
  module.destroy(builder);
  module.destroy(encoder);
  return { bytes, positionAttributeId };
}

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

function buildGlb(
  meshName: string,
  mesh: MeshData,
  draco: { bytes: Buffer; positionAttributeId: number },
  nodes: GltfNode[],
  rootNodes: number[],
): Buffer {
  const box = bounds(mesh.positions);
  const padded = draco.bytes.length % 4 === 0 ? draco.bytes : Buffer.concat([draco.bytes, Buffer.alloc(4 - (draco.bytes.length % 4))]);
  const gltf = {
    asset: { version: '2.0', generator: 'Highwater tower builder' },
    extensionsUsed: [DRACO_EXTENSION],
    extensionsRequired: [DRACO_EXTENSION],
    scene: 0,
    scenes: [{ nodes: rootNodes }],
    nodes,
    meshes: [
      {
        name: meshName,
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
            extensions: {
              [DRACO_EXTENSION]: {
                bufferView: 0,
                attributes: { POSITION: draco.positionAttributeId },
              },
            },
          },
        ],
      },
    ],
    accessors: [
      {
        componentType: 5126,
        count: mesh.positions.length / 3,
        type: 'VEC3',
        min: box.min,
        max: box.max,
      },
      { componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: draco.bytes.length }],
    buffers: [{ byteLength: padded.length }],
  };

  const jsonText = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadding = (4 - (jsonText.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + padded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(padded.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, padded]);
}

const SIDES = 8;
const FACE_RADIUS = 10;
const PODIUM_RADIUS = 12.5;
const STOREY_HEIGHT = 1;
const PODIUM_STOREYS = 2;
const RESIDENTIAL_STOREYS = 36;

/** The corner angles of the octagonal plan, one face per stack. */
function cornerAngle(corner: number): number {
  return ((corner - 0.5) / SIDES) * Math.PI * 2;
}

function ring(radius: number, y: number): number[] {
  const out: number[] = [];
  for (let corner = 0; corner < SIDES; corner += 1) {
    const angle = cornerAngle(corner);
    out.push(Math.sin(angle) * radius, y, -Math.cos(angle) * radius);
  }
  return out;
}

function shellMesh(): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const levels = PODIUM_STOREYS + RESIDENTIAL_STOREYS + 1;
  for (let level = 0; level < levels; level += 1) {
    const radius = level <= PODIUM_STOREYS ? PODIUM_RADIUS : FACE_RADIUS;
    positions.push(...ring(radius, level * STOREY_HEIGHT));
  }
  for (let level = 0; level < levels - 1; level += 1) {
    for (let side = 0; side < SIDES; side += 1) {
      const next = (side + 1) % SIDES;
      const a = level * SIDES + side;
      const b = level * SIDES + next;
      const c = (level + 1) * SIDES + next;
      const d = (level + 1) * SIDES + side;
      indices.push(a, b, c, a, c, d);
    }
  }
  const roofCentre = positions.length / 3;
  positions.push(0, (levels - 1) * STOREY_HEIGHT, 0);
  const groundCentre = positions.length / 3;
  positions.push(0, 0, 0);
  for (let side = 0; side < SIDES; side += 1) {
    const next = (side + 1) % SIDES;
    indices.push(roofCentre, (levels - 1) * SIDES + side, (levels - 1) * SIDES + next);
    indices.push(groundCentre, next, side);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function plateMesh(): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  positions.push(...ring(FACE_RADIUS, 0));
  positions.push(...ring(FACE_RADIUS, STOREY_HEIGHT * 0.9));
  const lowerCentre = positions.length / 3;
  positions.push(0, 0, 0);
  const upperCentre = positions.length / 3;
  positions.push(0, STOREY_HEIGHT * 0.9, 0);
  for (let side = 0; side < SIDES; side += 1) {
    const next = (side + 1) % SIDES;
    indices.push(lowerCentre, next, side);
    indices.push(upperCentre, SIDES + side, SIDES + next);
    indices.push(side, next, SIDES + next, side, SIDES + next, SIDES + side);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** The window node's rotation takes its local +Z axis to the stack's outward direction. */
function windowRotation(bearingDegrees: number): [number, number, number, number] {
  const theta = ((180 - bearingDegrees) * Math.PI) / 180;
  return [0, Math.fround(Math.sin(theta / 2)), 0, Math.fround(Math.cos(theta / 2))];
}

function windowTranslation(bearingDegrees: number): [number, number, number] {
  const radians = (bearingDegrees * Math.PI) / 180;
  return [
    Math.fround(Math.sin(radians) * FACE_RADIUS),
    Math.fround(STOREY_HEIGHT * 0.45),
    Math.fround(-Math.cos(radians) * FACE_RADIUS),
  ];
}

export async function buildTowerShell(): Promise<Buffer> {
  const mesh = shellMesh();
  const draco = await dracoEncode(mesh);
  return buildGlb('tower-shell', mesh, draco, [{ name: 'tower-shell', mesh: 0 }], [0]);
}

export async function buildFloorPlate(band: BandId): Promise<Buffer> {
  const mesh = plateMesh();
  const draco = await dracoEncode(mesh);
  const nodes: GltfNode[] = [{ name: `plate-${band}`, mesh: 0, children: [] }];
  STACKS.forEach((stack, index) => {
    nodes.push({
      name: `window-${stack.letter}`,
      translation: windowTranslation(stack.windowBearing),
      rotation: windowRotation(stack.windowBearing),
    });
    nodes[0].children?.push(index + 1);
  });
  return buildGlb(`plate-${band}`, mesh, draco, nodes, [0]);
}

/** Reads the glTF JSON chunk back out of a GLB. */
function readGltfJson(glb: Buffer): { nodes?: GltfNode[] } {
  const jsonLength = glb.readUInt32LE(12);
  return JSON.parse(glb.toString('utf8', 20, 20 + jsonLength)) as { nodes?: GltfNode[] };
}

/** Rotates the model's +Z axis by the node's quaternion. */
function rotatedForward(rotation: [number, number, number, number]): { x: number; z: number } {
  const [x, y, z, w] = rotation;
  return {
    x: 2 * (x * z + w * y),
    z: 1 - 2 * (x * x + y * y),
  };
}

/** The bearing of each stack, read from the floor-plate model's window nodes. */
export function bearingsFromPlate(glb: Buffer): Map<StackLetter, number> {
  const gltf = readGltfJson(glb);
  const bearings = new Map<StackLetter, number>();
  for (const node of gltf.nodes ?? []) {
    const match = /^window-([A-H])$/.exec(node.name);
    if (!match || !node.rotation) continue;
    const forward = rotatedForward(node.rotation);
    bearings.set(match[1] as StackLetter, bearingFromModelDirection(forward.x, forward.z));
  }
  return bearings;
}

export const MODEL_KEYS = {
  shell: 'models/tower-shell.glb',
  plate: (band: BandId): string => `models/plates/${band}.glb`,
  allPlates: (): Record<BandId, string> =>
    Object.fromEntries(FLOOR_BANDS.map((band) => [band.id, `models/plates/${band.id}.glb`])) as Record<BandId, string>,
} as const;
