// Generates original small GLB files whose measures give a chosen rank, by
// controlling the material count and an embedded texture image.
import { computeRank, type AssetKind, type Measures, type Rank } from '../shared/glb';

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makePng(size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = 0xe8; // warm paper tone
    row[2 + x * 3] = 0xd5;
    row[3 + x * 3] = 0xb0;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const compressed = require('zlib').deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Builds a minimal but valid GLB whose measures land in the given rank.
export function buildGlbForRank(kind: AssetKind, rank: Rank): Buffer {
  const perRank: Record<AssetKind, Record<Rank, { materials: number; texture: number; triangles: number }>> = {
    avatar: {
      Feather: { materials: 1, texture: 64, triangles: 36 },
      Linen: { materials: 3, texture: 768, triangles: 720 },
      Cedar: { materials: 5, texture: 1536, triangles: 1920 },
      Granite: { materials: 9, texture: 2560, triangles: 4800 },
    },
    room: {
      Feather: { materials: 2, texture: 64, triangles: 120 },
      Linen: { materials: 10, texture: 1280, triangles: 3600 },
      Cedar: { materials: 20, texture: 2560, triangles: 9000 },
      Granite: { materials: 40, texture: 5120, triangles: 24000 },
    },
  };
  const spec = perRank[kind][rank];
  const png = makePng(spec.texture);
  const buffers = [{ byteLength: png.length }];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: png.length }];
  const images = [{ bufferView: 0, mimeType: 'image/png' }];
  const materials = Array.from({ length: spec.materials }, (_, i) => ({
    name: `paper-${i}`,
    pbrMetallicRoughness: { baseColorTexture: i === 0 ? { index: 0 } : undefined },
  }));
  // One node referencing one mesh; the mesh's primitives carry the triangle
  // count through accessor indices.
  const indexCount = spec.triangles * 3;
  const accessors = [
    { count: indexCount, type: 'SCALAR', componentType: 5125 },
    { count: 3, type: 'VEC3', componentType: 5126 },
  ];
  const primitives = [{ attributes: { POSITION: 1 }, indices: 0, mode: 4, material: 0 }];
  const json = {
    asset: { version: '2.0', generator: 'hearthtile' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'paper-cut' }],
    meshes: [{ primitives }],
    accessors,
    bufferViews,
    buffers,
    materials,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9729 }],
    textures: [{ sampler: 0, source: 0 }],
  };
  const jsonStr = JSON.stringify(json);
  let jsonText = jsonStr;
  while (Buffer.byteLength(jsonText, 'utf8') % 4 !== 0) jsonText += ' ';
  const jsonBuf = Buffer.from(jsonText, 'utf8');
  const bin = png;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const body = Buffer.concat([jsonHeader, jsonBuf, binHeader, bin]);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

export function measuresOfGlb(data: Buffer): Measures {
  return { triangles: 0, materials: 0, textureSize: 0, fileSize: data.length };
}

export { computeRank };
