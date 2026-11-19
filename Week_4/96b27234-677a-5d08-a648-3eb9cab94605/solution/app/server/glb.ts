import type { Kind, Measures } from "./rank.js";
import { rankMeasures } from "./rank.js";
import type { MeasureName, Rank } from "../shared/protocol.js";

type GlbCheck =
  | { ok: true; rank: Rank; worstMeasure: MeasureName; measures: Measures; measureRanks: Record<MeasureName, Rank> }
  | { ok: false; status: number; message: string };

const NOT_GLB = "This file is not a GLB model.";
const DAMAGED = "This GLB file is damaged.";
const OUTSIDE = "This GLB refers to files outside itself.";

/** The refusal for a file above the top rank, naming the first measure that fails. */
export const overGranite = (measure: MeasureName): string => `This model is over the Granite limit for ${measure}.`;

const refuse = (message: string, status = 422): GlbCheck => ({ ok: false, status, message });

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface Gltf {
  buffers?: { uri?: unknown }[];
  images?: { uri?: unknown; bufferView?: number }[];
  bufferViews?: { byteOffset?: number; byteLength?: number }[];
  accessors?: { count?: number }[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
  nodes?: { mesh?: number }[];
  materials?: unknown[];
}

class Damaged extends Error {}

function imageSize(data: Buffer): number {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && data.toString("latin1", 12, 16) === "IHDR") {
    const size = Math.max(data.readUInt32BE(16), data.readUInt32BE(20));
    if (size > 0) return size;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= data.length) {
      if (data[at] !== 0xff) break;
      const marker = data[at + 1] ?? 0;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const length = data.readUInt16BE(at + 2);
      const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame && at + 9 <= data.length) {
        const size = Math.max(data.readUInt16BE(at + 5), data.readUInt16BE(at + 7));
        if (size > 0) return size;
        break;
      }
      at += 2 + length;
    }
  }
  throw new Damaged();
}

function accessorCount(doc: Gltf, index: number | undefined): number {
  const count = index === undefined ? undefined : doc.accessors?.[index]?.count;
  if (typeof count !== "number") throw new Damaged();
  return count;
}

function countTriangles(doc: Gltf): number {
  let total = 0;
  for (const node of doc.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = doc.meshes?.[node.mesh];
    if (!mesh) throw new Damaged();
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      if (mode < 4) continue;
      const count = accessorCount(doc, primitive.indices ?? primitive.attributes?.POSITION);
      total += mode === 4 ? Math.floor(count / 3) : Math.max(count - 2, 0);
    }
  }
  return total;
}

/** Judges the bytes by content only: magic, structure, outside references, then the rank. */
export function checkGlb(kind: Kind, bytes: Buffer): GlbCheck {
  if (bytes.length < 4 || bytes.toString("latin1", 0, 4) !== "glTF") return refuse(NOT_GLB);
  try {
    if (bytes.length < 20 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return refuse(DAMAGED);
    if (bytes.readUInt32LE(16) !== JSON_CHUNK) return refuse(DAMAGED);
    const jsonEnd = 20 + bytes.readUInt32LE(12);
    if (jsonEnd > bytes.length) return refuse(DAMAGED);
    const parsed: unknown = JSON.parse(bytes.toString("utf8", 20, jsonEnd));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return refuse(DAMAGED);
    const doc = parsed as Gltf;
    let binary: Buffer | null = null;
    if (jsonEnd < bytes.length) {
      if (jsonEnd + 8 > bytes.length) return refuse(DAMAGED);
      const length = bytes.readUInt32LE(jsonEnd);
      if (bytes.readUInt32LE(jsonEnd + 4) === BIN_CHUNK) {
        if (jsonEnd + 8 + length > bytes.length) return refuse(DAMAGED);
        binary = bytes.subarray(jsonEnd + 8, jsonEnd + 8 + length);
      }
    }
    let textureSize = 0;
    for (const image of doc.images ?? []) {
      if (image.uri !== undefined) continue;
      const view = doc.bufferViews?.[image.bufferView ?? -1];
      if (!view || !binary) return refuse(DAMAGED);
      const start = view.byteOffset ?? 0;
      const end = start + (view.byteLength ?? 0);
      if (end > binary.length) return refuse(DAMAGED);
      textureSize = Math.max(textureSize, imageSize(binary.subarray(start, end)));
    }
    if ((doc.buffers ?? []).some((item) => item.uri !== undefined) || (doc.images ?? []).some((item) => item.uri !== undefined)) {
      return refuse(OUTSIDE);
    }
    const measures: Measures = {
      triangles: countTriangles(doc),
      materials: doc.materials?.length ?? 0,
      textureSize,
      fileSize: bytes.length,
    };
    const ranked = rankMeasures(kind, measures);
    if ("over" in ranked) {
      return refuse(overGranite(ranked.over), ranked.over === "file size" ? 413 : 422);
    }
    return { ok: true, ...ranked, measures };
  } catch {
    return refuse(DAMAGED);
  }
}
