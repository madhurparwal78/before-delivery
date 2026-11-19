// GLB binary reading, measuring and rank computation — the single place the
// rank of a checked file is decided.

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}
export interface GltfJson {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  meshes?: { primitives: GltfPrimitive[] }[];
  accessors?: { count: number; type: string; componentType: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  materials?: unknown[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
}

export interface Measures {
  triangles: number;
  materials: number;
  textureSize: number;
  fileSize: number;
}

export type Rank = 'Feather' | 'Linen' | 'Cedar' | 'Granite';
export type MeasureName = 'triangles' | 'materials' | 'textureSize' | 'fileSize';
export type WorstMeasure = 'triangles' | 'materials' | 'texture size' | 'file size';
export type AssetKind = 'room' | 'avatar';

const MEASURE_ORDER: MeasureName[] = ['triangles', 'materials', 'textureSize', 'fileSize'];
const WORST_LABEL: Record<MeasureName, WorstMeasure> = {
  triangles: 'triangles',
  materials: 'materials',
  textureSize: 'texture size',
  fileSize: 'file size',
};
const RANK_ORDER: Record<Rank, number> = { Feather: 0, Linen: 1, Cedar: 2, Granite: 3 };

export const RANK_LIMITS: Record<AssetKind, Record<MeasureName, Record<Rank, number>>> = {
  avatar: {
    triangles: { Feather: 5000, Linen: 15000, Cedar: 40000, Granite: 100000 },
    materials: { Feather: 2, Linen: 4, Cedar: 8, Granite: 16 },
    textureSize: { Feather: 512, Linen: 1024, Cedar: 2048, Granite: 4096 },
    fileSize: { Feather: 1000000, Linen: 4000000, Cedar: 10000000, Granite: 20000000 },
  },
  room: {
    triangles: { Feather: 20000, Linen: 60000, Cedar: 150000, Granite: 400000 },
    materials: { Feather: 8, Linen: 16, Cedar: 32, Granite: 64 },
    textureSize: { Feather: 1024, Linen: 2048, Cedar: 4096, Granite: 8192 },
    fileSize: { Feather: 4000000, Linen: 12000000, Cedar: 30000000, Granite: 50000000 },
  },
};

export const GRANITE_TOP: Record<AssetKind, Record<MeasureName, number>> = {
  avatar: { triangles: 100000, materials: 16, textureSize: 4096, fileSize: 20000000 },
  room: { triangles: 400000, materials: 64, textureSize: 8192, fileSize: 50000000 },
};

export const RANKS: Rank[] = ['Feather', 'Linen', 'Cedar', 'Granite'];

export class GlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlbError';
  }
}

function measureRank(kind: AssetKind, measure: MeasureName, value: number): Rank {
  const limits = RANK_LIMITS[kind][measure];
  if (value <= limits.Feather) return 'Feather';
  if (value <= limits.Linen) return 'Linen';
  if (value <= limits.Cedar) return 'Cedar';
  return 'Granite';
}

// The single place a file's overall rank and worst measure are decided.
// The worst measure sets the rank; a tie names the earlier measure, so an
// all-Feather file reads worst "triangles".
export function computeRank(kind: AssetKind, m: Measures): { rank: Rank; worstMeasure: WorstMeasure; perMeasure: Record<MeasureName, Rank> } {
  const perMeasure = {} as Record<MeasureName, Rank>;
  let worst: Rank = 'Feather';
  let worstMeasure: MeasureName = 'triangles';
  for (const name of MEASURE_ORDER) {
    const r = measureRank(kind, name, m[name]);
    perMeasure[name] = r;
    if (RANK_ORDER[r] > RANK_ORDER[worst]) {
      worst = r;
      worstMeasure = name;
    }
  }
  return { rank: worst, worstMeasure: WORST_LABEL[worstMeasure], perMeasure };
}

export interface ParsedImage {
  bufferView: number;
  data: Buffer;
  width: number;
  height: number;
}

export interface ParsedGlb {
  json: GltfJson;
  binaryChunkStart: number;
  images: ParsedImage[];
}

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function parseGlb(data: Buffer): ParsedGlb {
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF') {
    throw new GlbError('This file is not a GLB model.');
  }
  const version = data.readUInt32LE(4);
  if (version !== 2) throw new GlbError('This GLB file is damaged.');
  const declaredLength = data.readUInt32LE(8);
  if (declaredLength !== data.length) throw new GlbError('This GLB file is damaged.');
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new GlbError('This GLB file is damaged.');
  const jsonChunk = data.subarray(20, 20 + jsonLength);
  if (jsonChunk.length !== jsonLength) throw new GlbError('This GLB file is damaged.');
  let json: GltfJson;
  try {
    json = JSON.parse(jsonChunk.toString('utf8').replace(/\0+$/, ''));
  } catch {
    throw new GlbError('This GLB file is damaged.');
  }
  const binHeaderStart = 20 + jsonLength;
  let binaryChunkStart = -1;
  if (binHeaderStart + 8 <= data.length) {
    const binType = data.readUInt32LE(binHeaderStart + 4);
    if (binType === 0x004e4942) binaryChunkStart = binHeaderStart + 8;
  }
  const images: ParsedImage[] = [];
  for (const img of json.images ?? []) {
    if (img.uri !== undefined && img.uri.length > 0) throw new GlbError('This GLB refers to files outside itself.');
    if (typeof img.bufferView !== 'number') throw new GlbError('This GLB file is damaged.');
    const bv = json.bufferViews?.[img.bufferView];
    if (!bv || binaryChunkStart < 0) throw new GlbError('This GLB file is damaged.');
    const offset = bv.byteOffset ?? 0;
    const b = data.subarray(binaryChunkStart + offset, binaryChunkStart + offset + bv.byteLength);
    let size: { width: number; height: number } | null = null;
    if (img.mimeType === 'image/png') size = readPngSize(b);
    else if (img.mimeType === 'image/jpeg') size = readJpegSize(b);
    else size = readPngSize(b) ?? readJpegSize(b);
    if (!size) throw new GlbError('This GLB file is damaged.');
    images.push({ bufferView: img.bufferView, data: b, width: size.width, height: size.height });
  }
  if ((json.buffers ?? []).some((b) => typeof b.uri === 'string' && b.uri.length > 0)) {
    throw new GlbError('This GLB refers to files outside itself.');
  }
  return { json, binaryChunkStart, images };
}

// Triangles: over all mesh primitives per referencing node. A mesh used by two
// nodes counts twice; an unreferenced mesh counts 0. Points and lines count 0.
export function countTriangles(json: GltfJson): number {
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const uses = new Map<number, number>();
  for (const n of nodes) {
    if (typeof n.mesh === 'number') uses.set(n.mesh, (uses.get(n.mesh) ?? 0) + 1);
  }
  let total = 0;
  uses.forEach((count, meshIndex) => {
    const mesh = meshes[meshIndex];
    if (!mesh) return;
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode < 4) continue;
      let verts = 0;
      if (typeof prim.indices === 'number') verts = accessors[prim.indices]?.count ?? 0;
      else if (typeof prim.attributes?.POSITION === 'number') verts = accessors[prim.attributes.POSITION]?.count ?? 0;
      const t = mode === 4 ? verts / 3 : Math.max(0, verts - 2);
      total += t * count;
    }
  });
  return Math.round(total);
}

export interface CheckedGlb {
  measures: Measures;
  rank: Rank;
  worstMeasure: WorstMeasure;
  perMeasure: Record<MeasureName, Rank>;
  json: GltfJson;
}

// The published check order. Judged from the file's content only.
export function checkAndMeasure(kind: AssetKind, data: Buffer): CheckedGlb {
  const parsed = parseGlb(data);
  const json = parsed.json;
  const measures: Measures = {
    triangles: countTriangles(json),
    materials: (json.materials ?? []).length,
    textureSize: parsed.images.reduce((max, i) => Math.max(max, i.width, i.height), 0),
    fileSize: data.length,
  };
  const { rank, worstMeasure, perMeasure } = computeRank(kind, measures);
  return { measures, rank, worstMeasure, perMeasure, json };
}

// An over-limit file names the first failing measure in the published order.
export function overGraniteMeasure(kind: AssetKind, m: Measures): MeasureName | null {
  for (const name of MEASURE_ORDER) {
    if (m[name] > GRANITE_TOP[kind][name]) return name;
  }
  return null;
}

export const MEASURE_LABELS: Record<MeasureName, string> = {
  triangles: 'triangles',
  materials: 'materials',
  textureSize: 'texture size',
  fileSize: 'file size',
};
