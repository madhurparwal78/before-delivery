import { createHash } from "node:crypto";
import type { Rank } from "../shared/protocol.js";
import type { Kind } from "./rank.js";

/** Materials per rank: each count sits inside its rank's limit and above the lighter rank's. */
const MATERIALS: Record<Kind, Record<Rank, number>> = {
  avatar: { Feather: 1, Linen: 3, Cedar: 5, Granite: 9 },
  room: { Feather: 1, Linen: 9, Cedar: 17, Granite: 33 },
};

const PAPER = [
  [0.95, 0.71, 0.2],
  [0.44, 0.53, 0.61],
  [0.55, 0.65, 0.55],
  [0.79, 0.55, 0.52],
  [0.85, 0.72, 0.55],
  [0.14, 0.19, 0.23],
] as const;

const pad = (data: Buffer, byte: number): Buffer => Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, byte)]);

/**
 * A small original paper-cut model: one flat piece per material, laid out as a patchwork,
 * so the file's material count gives the rank asked for and everything else stays Feather.
 */
export function generateModel(kind: Kind, rank: Rank, name: string): Buffer {
  const count = MATERIALS[kind][rank];
  const hash = createHash("sha256").update(name).digest();
  const columns = Math.ceil(Math.sqrt(count));
  const pieces: Buffer[] = [];
  const accessors: object[] = [];
  const bufferViews: object[] = [];
  const primitives: object[] = [];
  const materials: object[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * 0.3 - (columns * 0.3) / 2;
    const y = row * 0.3;
    const quad = Buffer.alloc(48);
    [[x, y], [x + 0.26, y], [x + 0.26, y + 0.26], [x, y + 0.26]].forEach(([px, py], corner) => {
      quad.writeFloatLE(px ?? 0, corner * 12);
      quad.writeFloatLE(py ?? 0, corner * 12 + 4);
      quad.writeFloatLE(0, corner * 12 + 8);
    });
    const indices = Buffer.alloc(12);
    [0, 1, 2, 0, 2, 3].forEach((value, slot) => indices.writeUInt16LE(value, slot * 2));
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: 48 });
    bufferViews.push({ buffer: 0, byteOffset: offset + 48, byteLength: 12 });
    pieces.push(quad, pad(indices, 0));
    offset += 48 + 16;
    const positionAccessor = accessors.length;
    accessors.push({ bufferView: positionView, componentType: 5126, count: 4, type: "VEC3", min: [x, y, 0], max: [x + 0.26, y + 0.26, 0] });
    accessors.push({ bufferView: positionView + 1, componentType: 5123, count: 6, type: "SCALAR" });
    const color = PAPER[(index + (hash[index % hash.length] ?? 0)) % PAPER.length] ?? PAPER[0];
    materials.push({ name: `paper-${index + 1}`, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 1 } });
    primitives.push({ attributes: { POSITION: positionAccessor }, indices: positionAccessor + 1, material: index });
  }
  const binary = Buffer.concat(pieces);
  const doc = {
    asset: { version: "2.0", generator: "Hearthtile paper-cut maker" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
  };
  const json = pad(Buffer.from(JSON.stringify(doc)), 0x20);
  const total = 12 + 8 + json.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = (type: number, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(body.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, body]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, binary)]);
}
