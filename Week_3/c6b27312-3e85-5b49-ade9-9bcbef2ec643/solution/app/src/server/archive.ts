// Revision archives: ZIP (stored, no compression) and TAR, built by hand on first download and kept in storage.
import { crc32 } from "node:zlib";
import { bboxText, volumeText } from "../shared/numbers";
import { compareText } from "../shared/order";
import { db } from "./db";
import { notFound } from "./errors";
import type { Ctx } from "./http";
import { get, type Route } from "./route";
import { requiredObject } from "./objects";
import { loadRevision, readablePart, revisionJson, revisionLabel, type RevisionRow } from "./records";
import type { Reply } from "./reply";
import { sha256 } from "./solids";
import { getObject, putObject } from "./storage";

interface Entry {
  path: string;
  data: Buffer;
}

// 1980-01-01 00:00: archives are reproducible, so the stored copy equals any rebuilt one.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const BLOCK = 512;

function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { path, data } of entries) {
    const name = Buffer.from(path);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

/** A ustar name field pair: a path over 100 bytes is split at a slash into prefix and name. */
function splitName(path: string): { prefix: string; name: string } {
  if (Buffer.byteLength(path) <= 100) return { prefix: "", name: path };
  for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { prefix, name };
  }
  throw new Error(`archive path is too long: ${path}`);
}

function tar(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { path, data } of entries) {
    const header = Buffer.alloc(BLOCK);
    const { prefix, name } = splitName(path);
    header.write(name, 0, "utf8");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    header.write(prefix, 345, "utf8");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    blocks.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(blocks);
}

const FORMATS = {
  zip: { contentType: "application/zip", pack: zip },
  tar: { contentType: "application/x-tar", pack: tar },
};

async function archiveEntries(revision: RevisionRow, folder: string): Promise<Entry[]> {
  const [evaluation, tape] = await Promise.all([
    db.one<{ volume: number; bbox: [number, number, number] }>("SELECT volume, bbox FROM evaluations WHERE id = $1", [revision.evaluation_id]),
    db.rows<{ digest: string }>("SELECT DISTINCT digest FROM tape_operations WHERE revision_id = $1", [revision.id]),
  ]);
  const files: Entry[] = [
    { path: `${folder}/part.tine`, data: await requiredObject(revision.source_ref) },
    { path: `${folder}/revision.json`, data: Buffer.from(`${JSON.stringify(revisionJson(revision), null, 2)}\n`) },
    ...(await Promise.all(tape.map(async ({ digest }) => ({ path: `${folder}/solids/${digest}.json`, data: await requiredObject(`solids/${digest}.json`) })))),
  ];
  const manifest = [
    `Volume: ${volumeText(evaluation.volume)}`,
    `Bounding box: ${bboxText(evaluation.bbox)}`,
    ...files.sort((a, b) => compareText(a.path, b.path)).map(({ path, data }) => `${path} ${sha256(data)} ${data.length}`),
  ];
  return [...files, { path: `${folder}/manifest.txt`, data: Buffer.from(`${manifest.join("\n")}\n`) }].sort((a, b) => compareText(a.path, b.path));
}

function download(kind: keyof typeof FORMATS) {
  return async (ctx: Ctx): Promise<Reply> => {
    const format = FORMATS[kind];
    const revision = await loadRevision(db, ctx.params.id);
    if (!revision) throw notFound();
    const part = await readablePart(ctx, revision.part_slug);
    const folder = `${part.slug}-${revisionLabel(revision.n)}`;
    const key = `archives/${revision.id}.${kind}`;
    let bytes = await getObject(key);
    if (bytes === null) {
      bytes = format.pack(await archiveEntries(revision, folder));
      await putObject(key, bytes, format.contentType);
    }
    return {
      status: 200,
      headers: { "Content-Type": format.contentType, "Content-Disposition": `attachment; filename="${folder}.${kind}"`, "Content-Length": String(bytes.length) },
      body: bytes,
    };
  };
}

export const archiveRoutes: Route[] = [
  get("/api/revisions/:id/archive.zip", download("zip"), { outage: "download" }),
  get("/api/revisions/:id/archive.tar", download("tar"), { outage: "download" }),
];
