/**
 * Generates a 3D Tiles reality mesh for a corridor: `tileset.json`, one glb per
 * stretch with Draco-compressed geometry, and a KTX2 canopy texture.
 */

import draco3d from "draco3d";
import { createDefaultContainer, write as writeKtx2 } from "ktx-parse";
import {
  KHR_DF_MODEL_RGBSDA,
  KHR_DF_PRIMARIES_BT709,
  KHR_DF_TRANSFER_SRGB,
  VK_FORMAT_R8G8B8A8_UNORM,
} from "ktx-parse";
import {
  interpolatedBaseHeight,
  positionFromChainage,
  type CorridorGeometry,
} from "../../shared/corridor.js";
import { toEcef } from "../../shared/geodesy.js";
import { sampleGroundHeight } from "./terrain.js";

const DEG = Math.PI / 180;
const TILE_LENGTH_M = 800;
const HALF_WIDTH_M = 70;
const TEXTURE_SIZE = 64;

export interface TilesetFile {
  path: string;
  bytes: Uint8Array;
}

/** A canopy to place in the mesh, so every seeded finding has a tree. */
export interface CanopySeed {
  chainageM: number;
  offsetM: number;
  radiusM: number;
  heightM: number;
}

interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function emptyMesh(): MeshData {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** glTF is Y-up; a tile's frame is east-north-up, so north maps to -Z. */
function pushVertex(
  mesh: MeshData,
  east: number,
  north: number,
  up: number,
  normal: [number, number, number],
  u: number,
  v: number,
): number {
  const index = mesh.positions.length / 3;
  mesh.positions.push(east, up, -north);
  mesh.normals.push(normal[0], normal[2], -normal[1]);
  mesh.uvs.push(u, v);
  return index;
}

/** The soil half of the texture sits left of centre, the canopy half right. */
const SOIL_U = [0.02, 0.46] as const;
const CANOPY_U = [0.54, 0.98] as const;

function addGroundPatch(
  mesh: MeshData,
  corridor: CorridorGeometry,
  fromM: number,
  toM: number,
  origin: { chainageM: number; groundHeightM: number },
): void {
  const alongSteps = Math.max(4, Math.round((toM - fromM) / 20));
  const acrossSteps = 7;
  const grid: number[][] = [];
  for (let i = 0; i <= alongSteps; i += 1) {
    const chainageM = fromM + ((toM - fromM) * i) / alongSteps;
    const row: number[] = [];
    for (let j = 0; j <= acrossSteps; j += 1) {
      const offsetM = -HALF_WIDTH_M + (2 * HALF_WIDTH_M * j) / acrossSteps;
      const point = positionFromChainage(corridor, chainageM, offsetM);
      const groundHeightM = sampleGroundHeight(corridor, point.lonDeg, point.latDeg);
      row.push(
        pushVertex(
          mesh,
          offsetM,
          chainageM - origin.chainageM,
          groundHeightM - origin.groundHeightM,
          [0, 0, 1],
          SOIL_U[0] + (SOIL_U[1] - SOIL_U[0]) * (j / acrossSteps),
          (i / alongSteps) * 4,
        ),
      );
    }
    grid.push(row);
  }
  for (let i = 0; i < alongSteps; i += 1) {
    for (let j = 0; j < acrossSteps; j += 1) {
      const a = grid[i][j];
      const b = grid[i][j + 1];
      const c = grid[i + 1][j];
      const d = grid[i + 1][j + 1];
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
}

function addTree(
  mesh: MeshData,
  canopy: CanopySeed,
  origin: { chainageM: number; groundHeightM: number },
  groundHeightM: number,
): void {
  const baseEast = canopy.offsetM;
  const baseNorth = canopy.chainageM - origin.chainageM;
  const baseUp = groundHeightM - origin.groundHeightM;
  const trunkHeight = Math.max(1, canopy.heightM - canopy.radiusM * 1.6);
  const trunkRadius = Math.max(0.15, canopy.radiusM * 0.12);

  const trunkSides = 6;
  const lower: number[] = [];
  const upper: number[] = [];
  for (let i = 0; i < trunkSides; i += 1) {
    const theta = (2 * Math.PI * i) / trunkSides;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const u = SOIL_U[0] + (SOIL_U[1] - SOIL_U[0]) * (i / trunkSides);
    lower.push(
      pushVertex(
        mesh,
        baseEast + dx * trunkRadius,
        baseNorth + dy * trunkRadius,
        baseUp,
        [dx, dy, 0],
        u,
        0,
      ),
    );
    upper.push(
      pushVertex(
        mesh,
        baseEast + dx * trunkRadius,
        baseNorth + dy * trunkRadius,
        baseUp + trunkHeight,
        [dx, dy, 0],
        u,
        1,
      ),
    );
  }
  for (let i = 0; i < trunkSides; i += 1) {
    const next = (i + 1) % trunkSides;
    mesh.indices.push(lower[i], lower[next], upper[i], lower[next], upper[next], upper[i]);
  }

  const rings = 5;
  const segments = 8;
  const centreUp = baseUp + canopy.heightM - canopy.radiusM;
  const ringIndices: number[][] = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = (Math.PI * r) / rings;
    const ring: number[] = [];
    for (let s = 0; s <= segments; s += 1) {
      const theta = (2 * Math.PI * s) / segments;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      ring.push(
        pushVertex(
          mesh,
          baseEast + nx * canopy.radiusM,
          baseNorth + ny * canopy.radiusM,
          centreUp + nz * canopy.radiusM * 1.15,
          [nx, ny, nz],
          CANOPY_U[0] + (CANOPY_U[1] - CANOPY_U[0]) * (s / segments),
          r / rings,
        ),
      );
    }
    ringIndices.push(ring);
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = ringIndices[r][s];
      const b = ringIndices[r][s + 1];
      const c = ringIndices[r + 1][s];
      const d = ringIndices[r + 1][s + 1];
      mesh.indices.push(a, c, b, b, c, d);
    }
  }
}

function canopyTexture(): Uint8Array {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const random = mulberry32(0x5a11_0f17);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const index = (y * TEXTURE_SIZE + x) * 4;
      const noise = random();
      if (x < TEXTURE_SIZE / 2) {
        pixels[index] = 96 + Math.round(noise * 26);
        pixels[index + 1] = 78 + Math.round(noise * 22);
        pixels[index + 2] = 58 + Math.round(noise * 18);
      } else {
        pixels[index] = 44 + Math.round(noise * 30);
        pixels[index + 1] = 86 + Math.round(noise * 44);
        pixels[index + 2] = 48 + Math.round(noise * 24);
      }
      pixels[index + 3] = 255;
    }
  }
  const container = createDefaultContainer();
  container.vkFormat = VK_FORMAT_R8G8B8A8_UNORM;
  container.typeSize = 1;
  container.pixelWidth = TEXTURE_SIZE;
  container.pixelHeight = TEXTURE_SIZE;
  container.pixelDepth = 0;
  container.layerCount = 0;
  container.faceCount = 1;
  container.levels = [{ levelData: pixels, uncompressedByteLength: pixels.byteLength }];
  const descriptor = container.dataFormatDescriptor[0];
  descriptor.colorModel = KHR_DF_MODEL_RGBSDA;
  descriptor.colorPrimaries = KHR_DF_PRIMARIES_BT709;
  descriptor.transferFunction = KHR_DF_TRANSFER_SRGB;
  descriptor.texelBlockDimension = [0, 0, 0, 0];
  descriptor.bytesPlane = [4, 0, 0, 0, 0, 0, 0, 0];
  descriptor.samples = [0, 8, 16, 24].map((bitOffset, i) => ({
    bitOffset,
    bitLength: 7,
    channelType: [0, 1, 2, 15][i],
    samplePosition: [0, 0, 0, 0],
    sampleLower: 0,
    sampleUpper: 255,
  }));
  return writeKtx2(container);
}

interface DracoEncoded {
  bytes: Uint8Array;
  attributeIds: { POSITION: number; NORMAL: number; TEXCOORD_0: number };
}

type EncoderModule = Awaited<ReturnType<typeof draco3d.createEncoderModule>>;

let encoderModule: Promise<EncoderModule> | null = null;

function dracoEncoder(): Promise<EncoderModule> {
  encoderModule ??= draco3d.createEncoderModule({});
  return encoderModule;
}

async function encodeDraco(mesh: MeshData): Promise<DracoEncoded> {
  const module = await dracoEncoder();
  const pointCount = mesh.positions.length / 3;
  const builder = new module.MeshBuilder();
  const dracoMesh = new module.Mesh();
  builder.AddFacesToMesh(dracoMesh, mesh.indices.length / 3, new Uint32Array(mesh.indices));
  const attributeIds = {
    POSITION: builder.AddFloatAttributeToMesh(
      dracoMesh,
      module.POSITION,
      pointCount,
      3,
      new Float32Array(mesh.positions),
    ),
    NORMAL: builder.AddFloatAttributeToMesh(
      dracoMesh,
      module.NORMAL,
      pointCount,
      3,
      new Float32Array(mesh.normals),
    ),
    TEXCOORD_0: builder.AddFloatAttributeToMesh(
      dracoMesh,
      module.TEX_COORD,
      pointCount,
      2,
      new Float32Array(mesh.uvs),
    ),
  };
  const encoder = new module.Encoder();
  encoder.SetAttributeQuantization(module.POSITION, 16);
  encoder.SetAttributeQuantization(module.NORMAL, 10);
  encoder.SetAttributeQuantization(module.TEX_COORD, 12);
  encoder.SetSpeedOptions(5, 5);
  encoder.SetEncodingMethod(module.MESH_EDGEBREAKER_ENCODING);
  const buffer = new module.DracoInt8Array();
  const length = encoder.EncodeMeshToDracoBuffer(dracoMesh, buffer);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = buffer.GetValue(i) & 0xff;
  module.destroy(buffer);
  module.destroy(encoder);
  module.destroy(dracoMesh);
  module.destroy(builder);
  return { bytes, attributeIds };
}

function extremes(values: number[], stride: number): { min: number[]; max: number[] } {
  const min = new Array<number>(stride).fill(Infinity);
  const max = new Array<number>(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i += stride) {
    for (let c = 0; c < stride; c += 1) {
      min[c] = Math.min(min[c], values[i + c]);
      max[c] = Math.max(max[c], values[i + c]);
    }
  }
  return { min, max };
}

function buildGlb(mesh: MeshData, encoded: DracoEncoded, textureUri: string): Uint8Array {
  const pointCount = mesh.positions.length / 3;
  const position = extremes(mesh.positions, 3);
  const gltf = {
    asset: { version: "2.0", generator: "Spanwise corridor mesh" },
    extensionsUsed: ["KHR_draco_mesh_compression", "KHR_texture_basisu"],
    extensionsRequired: ["KHR_draco_mesh_compression", "KHR_texture_basisu"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: 4,
            extensions: {
              KHR_draco_mesh_compression: {
                bufferView: 0,
                attributes: encoded.attributeIds,
              },
            },
          },
        ],
      },
    ],
    materials: [
      {
        name: "canopy",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
        doubleSided: true,
      },
    ],
    textures: [{ sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }],
    images: [{ uri: textureUri, mimeType: "image/ktx2" }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 }],
    accessors: [
      {
        componentType: 5126,
        count: pointCount,
        type: "VEC3",
        min: position.min,
        max: position.max,
      },
      { componentType: 5126, count: pointCount, type: "VEC3" },
      { componentType: 5126, count: pointCount, type: "VEC2" },
      { componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: encoded.bytes.byteLength },
    ],
    buffers: [{ byteLength: encoded.bytes.byteLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPadding = (4 - (encoded.bytes.byteLength % 4)) % 4;
  const jsonLength = jsonBytes.byteLength + jsonPadding;
  const binLength = encoded.bytes.byteLength + binPadding;
  const total = 12 + 8 + jsonLength + 8 + binLength;

  const glb = Buffer.alloc(total);
  let offset = 0;
  glb.writeUInt32LE(0x46546c67, offset); offset += 4;
  glb.writeUInt32LE(2, offset); offset += 4;
  glb.writeUInt32LE(total, offset); offset += 4;
  glb.writeUInt32LE(jsonLength, offset); offset += 4;
  glb.writeUInt32LE(0x4e4f534a, offset); offset += 4;
  Buffer.from(jsonBytes).copy(glb, offset); offset += jsonBytes.byteLength;
  glb.fill(0x20, offset, offset + jsonPadding); offset += jsonPadding;
  glb.writeUInt32LE(binLength, offset); offset += 4;
  glb.writeUInt32LE(0x004e4942, offset); offset += 4;
  Buffer.from(encoded.bytes).copy(glb, offset); offset += encoded.bytes.byteLength;
  glb.fill(0, offset, offset + binPadding);
  return new Uint8Array(glb);
}

/** East-north-up to ECEF as a column-major 4x4, for the tile transform. */
function enuToEcefMatrix(lonDeg: number, latDeg: number, heightM: number): number[] {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const origin = toEcef(lonDeg, latDeg, heightM);
  return [
    -sinLon, cosLon, 0, 0,
    -sinLat * cosLon, -sinLat * sinLon, cosLat, 0,
    cosLat * cosLon, cosLat * sinLon, sinLat, 0,
    origin.x, origin.y, origin.z, 1,
  ];
}

function regionBoundingVolume(
  corridor: CorridorGeometry,
  fromM: number,
  toM: number,
  minHeightM: number,
  maxHeightM: number,
): { region: number[] } {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const chainageM of [fromM, (fromM + toM) / 2, toM]) {
    for (const offsetM of [-HALF_WIDTH_M, 0, HALF_WIDTH_M]) {
      const point = positionFromChainage(corridor, chainageM, offsetM);
      west = Math.min(west, point.lonDeg);
      east = Math.max(east, point.lonDeg);
      south = Math.min(south, point.latDeg);
      north = Math.max(north, point.latDeg);
    }
  }
  return {
    region: [west * DEG, south * DEG, east * DEG, north * DEG, minHeightM, maxHeightM],
  };
}

export async function buildTileset(
  corridorId: string,
  corridor: CorridorGeometry,
  canopies: CanopySeed[],
): Promise<TilesetFile[]> {
  const files: TilesetFile[] = [];
  const tileCount = Math.max(1, Math.round(corridor.lengthM / TILE_LENGTH_M));
  const random = mulberry32(hashSeed(corridorId));
  const children: unknown[] = [];

  for (let tile = 0; tile < tileCount; tile += 1) {
    const fromM = (corridor.lengthM * tile) / tileCount;
    const toM = (corridor.lengthM * (tile + 1)) / tileCount;
    const centreM = (fromM + toM) / 2;
    const centre = positionFromChainage(corridor, centreM, 0);
    const originGround = interpolatedBaseHeight(corridor, centreM);
    const origin = { chainageM: centreM, groundHeightM: originGround };

    const mesh = emptyMesh();
    addGroundPatch(mesh, corridor, fromM, toM, origin);

    const trees: CanopySeed[] = canopies.filter(
      (canopy) => canopy.chainageM >= fromM && canopy.chainageM < toM,
    );
    for (let chainageM = fromM + 25; chainageM < toM; chainageM += 45) {
      const side = random() < 0.5 ? -1 : 1;
      trees.push({
        chainageM,
        offsetM: side * (18 + random() * 38),
        radiusM: 3 + random() * 3,
        heightM: 8 + random() * 11,
      });
    }
    let maxTop = originGround;
    for (const tree of trees) {
      const point = positionFromChainage(corridor, tree.chainageM, tree.offsetM);
      const groundHeightM = sampleGroundHeight(corridor, point.lonDeg, point.latDeg);
      addTree(mesh, tree, origin, groundHeightM);
      maxTop = Math.max(maxTop, groundHeightM + tree.heightM);
    }

    const encoded = await encodeDraco(mesh);
    files.push({ path: `tiles/${tile}.glb`, bytes: buildGlb(mesh, encoded, "canopy.ktx2") });

    children.push({
      boundingVolume: regionBoundingVolume(
        corridor,
        fromM,
        toM,
        interpolatedBaseHeight(corridor, fromM) - 30,
        maxTop + 10,
      ),
      geometricError: 0,
      refine: "ADD",
      transform: enuToEcefMatrix(centre.lonDeg, centre.latDeg, originGround),
      content: { uri: `tiles/${tile}.glb` },
    });
  }

  files.push({ path: "tiles/canopy.ktx2", bytes: canopyTexture() });

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (const tower of corridor.towers) {
    minHeight = Math.min(minHeight, tower.baseHeightM - 30);
    maxHeight = Math.max(maxHeight, tower.baseHeightM + tower.attachmentHeightM + 30);
  }
  const tileset = {
    asset: { version: "1.0", tilesetVersion: "1.0.0" },
    geometricError: 512,
    root: {
      boundingVolume: regionBoundingVolume(corridor, 0, corridor.lengthM, minHeight, maxHeight),
      geometricError: 512,
      refine: "ADD",
      children,
    },
  };
  files.unshift({
    path: "tileset.json",
    bytes: new TextEncoder().encode(`${JSON.stringify(tileset, null, 2)}\n`),
  });
  return files;
}
