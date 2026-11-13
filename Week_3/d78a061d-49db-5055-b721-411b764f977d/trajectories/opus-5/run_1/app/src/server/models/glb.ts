const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export interface GlbFile {
  headerValid: boolean;
  json: GltfJson | null;
  bin: Buffer | null;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  type?: string;
}

export interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
}

export interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}

export interface GltfMesh {
  primitives?: GltfPrimitive[];
}

export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfSkin {
  joints?: number[];
}

export interface GltfImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

export interface GltfJson {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  skins?: GltfSkin[];
  materials?: unknown[];
  images?: GltfImage[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { uri?: string; byteLength?: number }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export function hasGltfMagic(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === GLB_MAGIC;
}

/** Reads a GLB container. The header check is R01's whole job. */
export function readGlb(bytes: Buffer): GlbFile {
  if (bytes.length < 20 || !hasGltfMagic(bytes)) {
    return { headerValid: false, json: null, bin: null };
  }
  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  const firstChunkLength = bytes.readUInt32LE(12);
  const firstChunkType = bytes.readUInt32LE(16);

  const headerValid =
    version === 2 && declaredLength === bytes.length && firstChunkType === CHUNK_JSON;

  let json: GltfJson | null = null;
  let bin: Buffer | null = null;

  if (firstChunkType === CHUNK_JSON && 20 + firstChunkLength <= bytes.length) {
    try {
      json = JSON.parse(bytes.subarray(20, 20 + firstChunkLength).toString('utf8')) as GltfJson;
    } catch {
      json = null;
    }
    let offset = 20 + firstChunkLength;
    while (offset + 8 <= bytes.length) {
      const chunkLength = bytes.readUInt32LE(offset);
      const chunkType = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + chunkLength > bytes.length) break;
      if (chunkType === CHUNK_BIN) {
        bin = bytes.subarray(start, start + chunkLength);
        break;
      }
      offset = start + chunkLength;
    }
  }

  return { headerValid, json, bin };
}

/** The default scene is `scene`, or scene 0 when absent. */
export function defaultSceneNodes(json: GltfJson): number[] {
  const scenes = json.scenes ?? [];
  if (scenes.length === 0) return [];
  const index = json.scene ?? 0;
  const scene = scenes[index];
  if (scene === undefined) return [];
  return scene.nodes ?? [];
}
