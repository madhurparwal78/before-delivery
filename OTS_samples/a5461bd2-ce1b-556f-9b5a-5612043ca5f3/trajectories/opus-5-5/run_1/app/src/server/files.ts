import { buildIsland, type Island, type Part } from "./islands.js";
import { FileStoreUnavailable, type FileStore } from "./fileStore.js";
import type { Mesh } from "./geometry.js";
import { worldsOf } from "../shared/rules.js";
import type { Colours, Content, Project } from "../shared/types.js";

export const GLB_TYPE = "model/gltf-binary";
export const SVG_TYPE = "image/svg+xml";
export const GALLERY_SIZE = 4;

const FILE_STORE_RETRY_MS = 10_000;

export function sceneKey(slug: string): string {
  return `scenes/${slug}/world.glb`;
}

export function mediaKey(slug: string, n: number): string {
  return `media/${slug}/${n}.svg`;
}

function linearChannel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

interface GltfJson {
  asset: { version: string; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{ name: string; mesh: number; translation?: number[] }>;
  meshes: Array<{ name: string; primitives: Array<{ attributes: { POSITION: number; NORMAL: number }; indices: number; material: number }> }>;
  materials: Array<{ name: string; pbrMetallicRoughness: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number } }>;
  accessors: Array<Record<string, unknown>>;
  bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number; target: number }>;
  buffers: Array<{ byteLength: number }>;
}

function encodeIslandGlb(island: Island, colours: Colours): Uint8Array {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const json: GltfJson = {
    asset: { version: "2.0", generator: "Vellum Orbit island builder" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "island", mesh: 0 },
      { name: "emblem", mesh: 1, translation: [0, island.emblemHeight, 0] },
    ],
    meshes: [],
    materials: (["ground", "ink", "accent"] as const).map((paint) => ({
      name: paint,
      pbrMetallicRoughness: {
        baseColorFactor: [0, 1, 2].map((i) => linearChannel(colours[paint], i)).concat(1),
        metallicFactor: 0,
        roughnessFactor: 0.75,
      },
    })),
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const paints = ["ground", "ink", "accent"];

  const addView = (data: Buffer, target: number): number => {
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target });
    chunks.push(data);
    byteLength += data.length;
    return json.bufferViews.length - 1;
  };

  const addVec3 = (values: number[], withBounds: boolean): number => {
    const data = Buffer.from(new Float32Array(values).buffer);
    const accessor: Record<string, unknown> = {
      bufferView: addView(data, 34962),
      componentType: 5126,
      count: values.length / 3,
      type: "VEC3",
    };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i++) {
        const f = Math.fround(values[i]);
        min[i % 3] = Math.min(min[i % 3], f);
        max[i % 3] = Math.max(max[i % 3], f);
      }
      accessor.min = min;
      accessor.max = max;
    }
    json.accessors.push(accessor);
    return json.accessors.length - 1;
  };

  const addIndices = (mesh: Mesh): number => {
    const data = Buffer.from(new Uint32Array(mesh.indices).buffer);
    json.accessors.push({ bufferView: addView(data, 34963), componentType: 5125, count: mesh.indices.length, type: "SCALAR" });
    return json.accessors.length - 1;
  };

  const addMesh = (name: string, parts: Part[]): void => {
    json.meshes.push({
      name,
      primitives: parts.map((part) => ({
        attributes: { POSITION: addVec3(part.mesh.positions, true), NORMAL: addVec3(part.mesh.normals, false) },
        indices: addIndices(part.mesh),
        material: paints.indexOf(part.paint),
      })),
    });
  };

  addMesh("island", island.body);
  addMesh("emblem", island.emblem);
  json.buffers.push({ byteLength });

  const bin = Buffer.concat(chunks);
  let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  if (jsonBytes.length % 4 !== 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(4 - (jsonBytes.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunkHeader = (length: number, type: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, chunkHeader(jsonBytes.length, 0x4e4f534a), jsonBytes, chunkHeader(bin.length, 0x004e4942), bin]);
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function galleryImageSvg(project: Project, n: number, projectIndex: number): string {
  const { ground, ink, accent } = project.colours;
  const random = seeded(projectIndex * 97 + n * 13 + 7);
  const shapes: string[] = [];
  const layout = (projectIndex + n) % 4;
  for (let i = 0; i < 9; i++) {
    const x = Math.round(80 + random() * 1040);
    const y = Math.round(80 + random() * 640);
    const size = Math.round(40 + random() * 220);
    const fill = i % 3 === 0 ? accent : ink;
    if (layout === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${fill}" opacity="${i % 2 ? 1 : 0.85}"/>`);
    else if (layout === 1) shapes.push(`<rect x="${x - size / 2}" y="${y - size / 4}" width="${size}" height="${size / 2}" fill="${fill}"/>`);
    else if (layout === 2) shapes.push(`<line x1="${x}" y1="${y}" x2="${x + size}" y2="${y - size / 2}" stroke="${fill}" stroke-width="${6 + i}"/>`);
    else shapes.push(`<polygon points="${x},${y - size / 2} ${x + size / 2},${y + size / 2} ${x - size / 2},${y + size / 2}" fill="${fill}"/>`);
  }
  const rules = Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${100 * i + 50}" x2="1200" y2="${100 * i + 50}" stroke="${ink}" stroke-width="1" opacity="0.25"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${ground}"/>${rules}${shapes.join("")}<rect x="60" y="60" width="1080" height="680" fill="none" stroke="${accent}" stroke-width="4"/></svg>`;
}

async function storeMissingFiles(store: FileStore, content: Content): Promise<void> {
  await store.ensureBucket();
  for (const world of worldsOf(content)) {
    const key = sceneKey(world.slug);
    if (!(await store.exists(key))) await store.put(key, encodeIslandGlb(buildIsland(world), world.colours), GLB_TYPE);
  }
  for (const [index, project] of content.projects.entries()) {
    for (let n = 1; n <= GALLERY_SIZE; n++) {
      const key = mediaKey(project.slug, n);
      if (!(await store.exists(key))) {
        await store.put(key, Buffer.from(galleryImageSvg(project, n, index + 1), "utf8"), SVG_TYPE);
      }
    }
  }
}

/** Stores any missing scene and gallery files, retrying until the file store answers. */
export function syncFiles(store: FileStore, content: Content): void {
  const attempt = (): void => {
    storeMissingFiles(store, content).then(
      () => console.log("File store is up to date."),
      (error: unknown) => {
        if (!(error instanceof FileStoreUnavailable)) throw error;
        console.log("File store unreachable; retrying in 10 seconds.");
        setTimeout(attempt, FILE_STORE_RETRY_MS);
      },
    );
  };
  attempt();
}
