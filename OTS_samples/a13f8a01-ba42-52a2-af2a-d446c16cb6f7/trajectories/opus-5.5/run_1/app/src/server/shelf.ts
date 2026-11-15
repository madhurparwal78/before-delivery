import { readFileSync } from "node:fs";
import { shelfEntries, shelfPath, type ShelfEntry } from "../shared/shelf";
import type { ShelfLibrary } from "../shared/types";
import { sha256Hex } from "./auth";
import { json, type Context, type Reply } from "./http";
import { objectExists, putObject } from "./storage";

interface ShelfFile {
  entry: ShelfEntry;
  bytes: Buffer;
}

const shelfFiles: ShelfFile[] = shelfEntries.map((entry) => ({
  entry,
  bytes: readFileSync(new URL(`../shelf/${entry.id}/${entry.file}`, import.meta.url)),
}));

const libraries: ShelfLibrary[] = shelfFiles.map(({ entry, bytes }) => ({
  id: entry.id,
  name: entry.name,
  version: entry.version,
  global: entry.global,
  path: shelfPath(entry),
  license: entry.license,
  bytes: bytes.length,
  sha256: sha256Hex(bytes),
}));

export async function listShelf(): Promise<Reply> {
  return json(200, { libraries });
}

export async function serveShelfFile(ctx: Context): Promise<Reply> {
  const found = shelfFiles.find(({ entry }) => entry.id === ctx.params[0] && entry.file === ctx.params[1]);
  if (!found) return { kind: "raw", status: 404, body: "Not found", headers: { "Content-Type": "text/plain; charset=utf-8" } };
  return {
    kind: "raw",
    status: 200,
    body: found.bytes,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

/** Copies each bundled shelf file into the bucket when it is absent there. */
export async function mirrorShelf(): Promise<void> {
  for (const { entry, bytes } of shelfFiles) {
    const key = `shelf/${entry.id}/${entry.file}`;
    if (!(await objectExists(key))) await putObject(key, bytes, "text/javascript");
  }
}
