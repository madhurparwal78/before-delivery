// A 3D Tiles 1.1 reality mesh of corridor canopy: one glb tile per span, geometry compressed with
// KHR_draco_mesh_compression and a KTX2 foliage-and-bark texture (KHR_texture_basisu). Trees line
// both edges of the right-of-way, and one stands at each seeded finding.
import { createEncoderModule, type EncoderModule } from "draco3d";
import { createDefaultContainer, KHR_DF_CHANNEL_RGBSDA_ALPHA, KHR_DF_CHANNEL_RGBSDA_BLUE, KHR_DF_CHANNEL_RGBSDA_GREEN, KHR_DF_CHANNEL_RGBSDA_RED, KHR_DF_MODEL_RGBSDA, KHR_DF_PRIMARIES_BT709, KHR_DF_SAMPLE_DATATYPE_LINEAR, KHR_DF_TRANSFER_SRGB, VK_FORMAT_R8G8B8A8_SRGB, write } from "ktx-parse";
import { pointAt, toEcef, type Ecef } from "../../shared/geodesy.js";
import { groundHeight, type FixtureCorridor } from "./ground.js";

export interface TreeSpec {
  chainageM: number;
  offsetM: number;
  canopyHeightM: number;
  canopyRadiusM: number;
}

const TEXTURE_SIZE = 64;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const SEGMENTS = 8;
const RINGS = 6;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Foliage greens in the first rows, bark browns below (Cesium uploads KTX2 rows bottom-up, so foliage meets v near 1). */
function foliageTexture(): Buffer {
  const random = seeded(7);
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const k = (y * TEXTURE_SIZE + x) * 4;
      const n = random();
      if (y < TEXTURE_SIZE / 2) {
        pixels[k] = 52 + Math.round(n * 34);
        pixels[k + 1] = 92 + Math.round(n * 48);
        pixels[k + 2] = 48 + Math.round(n * 22);
      } else {
        const grain = Math.sin(x * 0.9) * 10;
        pixels[k] = 96 + Math.round(n * 26 + grain);
        pixels[k + 1] = 74 + Math.round(n * 18 + grain);
        pixels[k + 2] = 54 + Math.round(n * 12);
      }
      pixels[k + 3] = 255;
    }
  }
  const container = createDefaultContainer();
  container.vkFormat = VK_FORMAT_R8G8B8A8_SRGB;
  container.typeSize = 1;
  container.pixelWidth = TEXTURE_SIZE;
  container.pixelHeight = TEXTURE_SIZE;
  container.levels = [{ levelData: pixels, uncompressedByteLength: pixels.byteLength }];
  const dfd = container.dataFormatDescriptor[0];
  if (dfd !== undefined) {
    dfd.colorModel = KHR_DF_MODEL_RGBSDA;
    dfd.colorPrimaries = KHR_DF_PRIMARIES_BT709;
    dfd.transferFunction = KHR_DF_TRANSFER_SRGB;
    dfd.texelBlockDimension = [0, 0, 0, 0];
    dfd.bytesPlane = [4, 0, 0, 0, 0, 0, 0, 0];
    dfd.samples = [KHR_DF_CHANNEL_RGBSDA_RED, KHR_DF_CHANNEL_RGBSDA_GREEN, KHR_DF_CHANNEL_RGBSDA_BLUE, KHR_DF_CHANNEL_RGBSDA_ALPHA].map(
      (channel, i) => ({
        bitOffset: i * 8,
        bitLength: 7,
        channelType: channel === KHR_DF_CHANNEL_RGBSDA_ALPHA ? channel | KHR_DF_SAMPLE_DATATYPE_LINEAR : channel,
        samplePosition: [0, 0, 0, 0],
        sampleLower: 0,
        sampleUpper: 255,
      }),
    );
  }
  return Buffer.from(write(container));
}

interface Mesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** East-north-up axes at a point, as rows. */
function enuAxes(lonDeg: number, latDeg: number): [Ecef, Ecef, Ecef] {
  const l = (lonDeg * Math.PI) / 180;
  const p = (latDeg * Math.PI) / 180;
  return [
    [-Math.sin(l), Math.cos(l), 0],
    [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
  ];
}

/** One tree as a lathe: a trunk prism, then a rounded canopy no wider than 0.8 of its radius. */
function addTree(mesh: Mesh, base: [number, number, number], height: number, radius: number): void {
  const [bx, by, bz] = base;
  const trunkTop = height * 0.4;
  const profile: Array<{ r: number; y: number; v: number }> = [
    { r: Math.max(0.18, radius * 0.08), y: 0, v: 0.02 },
    { r: Math.max(0.14, radius * 0.06), y: trunkTop, v: 0.46 },
  ];
  for (let ring = 0; ring <= RINGS; ring += 1) {
    const t = ring / RINGS;
    profile.push({ r: radius * 0.8 * Math.sin(Math.PI * Math.min(0.97, 0.12 + t * 0.85)), y: trunkTop * 0.85 + (height - trunkTop * 0.85) * t, v: 0.54 + t * 0.44 });
  }
  const start = mesh.positions.length / 3;
  profile.forEach((point, ring) => {
    const next = profile[Math.min(ring + 1, profile.length - 1)] ?? point;
    const previous = profile[Math.max(ring - 1, 0)] ?? point;
    const dr = next.r - previous.r;
    const dy = next.y - previous.y;
    for (let s = 0; s <= SEGMENTS; s += 1) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      mesh.positions.push(bx + point.r * cx, by + point.y, bz + point.r * cz);
      const nx = dy * cx;
      const ny = -dr;
      const nz = dy * cz;
      const length = Math.hypot(nx, ny, nz) || 1;
      mesh.normals.push(nx / length, ny / length, nz / length);
      mesh.uvs.push(s / SEGMENTS, point.v);
    }
  });
  for (let ring = 0; ring < profile.length - 1; ring += 1) {
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = start + ring * (SEGMENTS + 1) + s;
      const b = a + SEGMENTS + 1;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

let encoder: Promise<EncoderModule> | null = null;

function dracoEncode(draco: EncoderModule, mesh: Mesh): { bytes: Buffer; ids: { POSITION: number; NORMAL: number; TEXCOORD_0: number } } {
  const builder = new draco.MeshBuilder();
  const target = new draco.Mesh();
  const vertexCount = mesh.positions.length / 3;
  builder.AddFacesToMesh(target, mesh.indices.length / 3, new Uint32Array(mesh.indices));
  const ids = {
    POSITION: builder.AddFloatAttributeToMesh(target, draco.POSITION, vertexCount, 3, new Float32Array(mesh.positions)),
    NORMAL: builder.AddFloatAttributeToMesh(target, draco.NORMAL, vertexCount, 3, new Float32Array(mesh.normals)),
    TEXCOORD_0: builder.AddFloatAttributeToMesh(target, draco.TEX_COORD, vertexCount, 2, new Float32Array(mesh.uvs)),
  };
  const out = new draco.DracoInt8Array();
  const coder = new draco.Encoder();
  coder.SetSpeedOptions(5, 5);
  coder.SetAttributeQuantization(draco.POSITION, 14);
  coder.SetAttributeQuantization(draco.NORMAL, 10);
  coder.SetAttributeQuantization(draco.TEX_COORD, 12);
  coder.SetEncodingMethod(draco.MESH_EDGEBREAKER_ENCODING);
  const length = coder.EncodeMeshToDracoBuffer(target, out);
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) bytes.writeInt8(out.GetValue(i), i);
  draco.destroy(out);
  draco.destroy(coder);
  draco.destroy(target);
  draco.destroy(builder);
  return { bytes, ids };
}

function glb(mesh: Mesh, draco: { bytes: Buffer; ids: Record<string, number> }): Buffer {
  const count = mesh.positions.length / 3;
  const axis = (a: number, f: (x: number, y: number) => number, start: number) =>
    mesh.positions.filter((_v, i) => i % 3 === a).reduce((acc, v) => f(acc, v), start);
  const gltf = {
    asset: { version: "2.0", generator: "Spanwise survey fixture" },
    extensionsUsed: ["KHR_draco_mesh_compression", "KHR_texture_basisu"],
    extensionsRequired: ["KHR_draco_mesh_compression", "KHR_texture_basisu"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "canopy" }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: 4,
            extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: draco.ids } },
          },
        ],
      },
    ],
    accessors: [
      {
        componentType: 5126,
        count,
        type: "VEC3",
        min: [0, 1, 2].map((a) => axis(a, Math.min, Infinity)),
        max: [0, 1, 2].map((a) => axis(a, Math.max, -Infinity)),
      },
      { componentType: 5126, count, type: "VEC3" },
      { componentType: 5126, count, type: "VEC2" },
      { componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: draco.bytes.length }],
    buffers: [{ byteLength: draco.bytes.length }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }],
    images: [{ uri: "../textures/foliage.ktx2" }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
  };
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const binChunk = pad(draco.bytes, 0);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (data: Buffer, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]);
}

/** tileset.json, one glb per span and the shared KTX2 texture, keyed by path. */
export async function realityMesh(corridor: FixtureCorridor, findingTrees: TreeSpec[]): Promise<Map<string, Buffer>> {
  encoder ??= createEncoderModule({});
  const draco = await encoder;
  const files = new Map<string, Buffer>();
  const children = [];
  let spanNumber = 0;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (let i = 1; i < corridor.towers.length; i += 1) {
    const from = corridor.towers[i - 1];
    const to = corridor.towers[i];
    if (from === undefined || to === undefined) continue;
    spanNumber += 1;
    const random = seeded(1000 + spanNumber);
    const trees: TreeSpec[] = findingTrees.filter((t) => t.chainageM >= from.chainageM && (t.chainageM < to.chainageM || i === corridor.towers.length - 1));
    for (let c = from.chainageM + 6; c < to.chainageM - 6; c += 9 + random() * 8) {
      for (const side of [-1, 1]) {
        if (random() < 0.25) continue;
        trees.push({ chainageM: c, offsetM: side * (24 + random() * 26), canopyHeightM: 9 + random() * 10, canopyRadiusM: 2.2 + random() * 2.2 });
      }
    }
    const middle = pointAt(corridor.line, (from.chainageM + to.chainageM) / 2, 0);
    const middleGround = groundHeight(corridor, middle.lonDeg, middle.latDeg);
    const origin = toEcef(middle.lonDeg, middle.latDeg, middleGround);
    const [e, n, u] = enuAxes(middle.lonDeg, middle.latDeg);
    const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
    let maxTop = middleGround;
    let minGround = middleGround;
    for (const tree of trees) {
      const at = pointAt(corridor.line, tree.chainageM, tree.offsetM);
      const ground = groundHeight(corridor, at.lonDeg, at.latDeg);
      const p = toEcef(at.lonDeg, at.latDeg, ground);
      const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      const dot = (axis: Ecef) => axis[0] * (d[0] ?? 0) + axis[1] * (d[1] ?? 0) + axis[2] * (d[2] ?? 0);
      // glTF is y-up: (east, up, -north).
      addTree(mesh, [dot(e), dot(u), -dot(n)], tree.canopyHeightM, tree.canopyRadiusM);
      maxTop = Math.max(maxTop, ground + tree.canopyHeightM);
      minGround = Math.min(minGround, ground);
      west = Math.min(west, at.lonDeg);
      east = Math.max(east, at.lonDeg);
      south = Math.min(south, at.latDeg);
      north = Math.max(north, at.latDeg);
    }
    const path = `tiles/span-${String(spanNumber).padStart(2, "0")}.glb`;
    files.set(path, glb(mesh, dracoEncode(draco, mesh)));
    const half = (to.chainageM - from.chainageM) / 2 + 20;
    const mid = (from.chainageM + to.chainageM) / 2;
    const regionPoints = [mid - half, mid + half].flatMap((c) => [-80, 80].map((offset) => pointAt(corridor.line, c, offset)));
    children.push({
      boundingVolume: {
        region: [
          rad(Math.min(...regionPoints.map((p) => p.lonDeg))),
          rad(Math.min(...regionPoints.map((p) => p.latDeg))),
          rad(Math.max(...regionPoints.map((p) => p.lonDeg))),
          rad(Math.max(...regionPoints.map((p) => p.latDeg))),
          minGround - 5,
          maxTop + 5,
        ],
      },
      geometricError: 0,
      transform: [e[0], e[1], e[2], 0, n[0], n[1], n[2], 0, u[0], u[1], u[2], 0, origin[0], origin[1], origin[2], 1],
      content: { uri: path },
    });
  }
  const pad = 0.002;
  const tileset = {
    asset: { version: "1.1", generator: "Spanwise survey fixture" },
    geometricError: 400,
    root: {
      boundingVolume: { region: [rad(west - pad), rad(south - pad), rad(east + pad), rad(north + pad), -100, 9000] },
      geometricError: 60,
      refine: "ADD",
      children,
    },
  };
  files.set("tileset.json", Buffer.from(JSON.stringify(tileset, null, 2), "utf8"));
  files.set("textures/foliage.ktx2", foliageTexture());
  return files;
}
