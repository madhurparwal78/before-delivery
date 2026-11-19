import type { AssetKind, Measures } from './ranks.js';
import { MEASURE_LABELS, MEASURE_ORDER, measureRank, rankOf } from './ranks.js';
import type { RankResult } from './ranks.js';

export const GLB_TEXT = {
  notGlb: 'This file is not a GLB model.',
  damaged: 'This GLB file is damaged.',
  external: 'This GLB refers to files outside itself.'
} as const;

export type GlbRefusal = { ok: false; status: number; text: string };
export type GlbInspection = { ok: true; measures: Measures; ranking: RankResult } | GlbRefusal;

interface GltfJson {
  buffers?: Array<{ uri?: string; byteLength?: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
  images?: Array<{ uri?: string; bufferView?: number }>;
  materials?: unknown[];
  accessors?: Array<{ count: number }>;
  meshes?: Array<{ primitives: Array<{ mode?: number; indices?: number; attributes: Record<string, number> }> }>;
  nodes?: Array<{ mesh?: number }>;
  asset?: { version?: string };
}

function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1] ?? 0;
      const length = view.getUint16(offset + 2);
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function trianglesOf(json: GltfJson): number {
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  let total = 0;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = meshes[node.mesh];
    if (!mesh) continue;
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      const accessorIndex = primitive.indices ?? primitive.attributes['POSITION'];
      const count = accessorIndex === undefined ? 0 : (accessors[accessorIndex]?.count ?? 0);
      if (mode === 4) total += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
    }
  }
  return total;
}

export function inspectGlb(bytes: Uint8Array, kind: AssetKind): GlbInspection {
  const damaged: GlbRefusal = { ok: false, status: 422, text: GLB_TEXT.damaged };
  if (bytes.length < 12 || String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) !== 'glTF') {
    return { ok: false, status: 422, text: GLB_TEXT.notGlb };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2) return damaged;
  if (view.getUint32(8, true) !== bytes.length) return damaged;

  let offset = 12;
  let jsonChunk: Uint8Array | null = null;
  let binChunk: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > bytes.length) return damaged;
    const chunk = bytes.subarray(start, start + chunkLength);
    if (chunkType === 0x4e4f534a && jsonChunk === null) jsonChunk = chunk;
    else if (chunkType === 0x004e4942 && binChunk === null) binChunk = chunk;
    offset = start + chunkLength;
  }
  if (jsonChunk === null) return damaged;

  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(jsonChunk)) as GltfJson;
  } catch {
    return damaged;
  }
  if (typeof json !== 'object' || json === null) return damaged;

  for (const buffer of json.buffers ?? []) {
    if (typeof buffer.uri === 'string') return { ok: false, status: 422, text: GLB_TEXT.external };
  }
  for (const image of json.images ?? []) {
    if (typeof image.uri === 'string') return { ok: false, status: 422, text: GLB_TEXT.external };
  }

  let textureSize = 0;
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) return damaged;
    const bufferView = (json.bufferViews ?? [])[image.bufferView];
    if (!bufferView || binChunk === null) return damaged;
    const start = bufferView.byteOffset ?? 0;
    if (start + bufferView.byteLength > binChunk.length) return damaged;
    const size = imageSize(binChunk.subarray(start, start + bufferView.byteLength));
    if (size === null) return damaged;
    textureSize = Math.max(textureSize, size.width, size.height);
  }

  const measures: Measures = {
    triangles: trianglesOf(json),
    materials: (json.materials ?? []).length,
    textureSize,
    fileSize: bytes.length
  };

  for (const measure of MEASURE_ORDER) {
    if (measureRank(kind, measure, measures[measure]) === null) {
      return {
        ok: false,
        status: measure === 'fileSize' ? 413 : 422,
        text: `This model is over the Granite limit for ${MEASURE_LABELS[measure]}.`
      };
    }
  }

  return { ok: true, measures, ranking: rankOf(kind, measures) };
}
