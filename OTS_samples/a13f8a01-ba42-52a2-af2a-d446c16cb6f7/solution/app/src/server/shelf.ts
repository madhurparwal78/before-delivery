import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ShelfLibrary } from "../shared/types.js";
import { hasObject, putObject } from "./storage.js";

interface ShelfEntry {
  name: string;
  version: string;
  file: string;
  global: string;
  license: string;
}

const ENTRIES: readonly ShelfEntry[] = [
  { name: "dayjs", version: "1.11.13", file: "dayjs.min.js", global: "dayjs", license: "MIT" },
  { name: "lodash", version: "4.17.21", file: "lodash.min.js", global: "_", license: "MIT" },
  { name: "matter-js", version: "0.20.0", file: "matter.min.js", global: "Matter", license: "MIT" },
  { name: "tinycolor2", version: "1.6.0", file: "tinycolor.js", global: "tinycolor", license: "MIT" },
  { name: "canvas-confetti", version: "1.9.3", file: "confetti.js", global: "confetti", license: "ISC" },
];

const SHELF_DIRECTORY = path.resolve(import.meta.dirname, "../../shelf-files");

interface Bundled extends ShelfLibrary {
  file: string;
  content: Buffer;
}

const bundled = new Map<string, Bundled>();
for (const entry of ENTRIES) {
  const id = `${entry.name}@${entry.version}`;
  const content = readFileSync(path.join(SHELF_DIRECTORY, id, entry.file));
  bundled.set(id, {
    id,
    name: entry.name,
    version: entry.version,
    global: entry.global,
    path: `/shelf/${id}/${entry.file}`,
    license: entry.license,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    file: entry.file,
    content,
  });
}

export function shelfLibraries(): ShelfLibrary[] {
  return [...bundled.values()].map(({ file: _file, content: _content, ...library }) => library);
}

export function isShelfId(id: string): boolean {
  return bundled.has(id);
}

export function shelfFile(id: string, file: string): Buffer | null {
  const library = bundled.get(id);
  return library?.file === file ? library.content : null;
}

export function shelfScriptPath(id: string): string {
  const library = bundled.get(id);
  if (library === undefined) throw new Error(`${id} is not on the shelf`);
  return library.path;
}

export async function mirrorShelf(): Promise<void> {
  for (const library of bundled.values()) {
    const key = `shelf/${library.id}/${library.file}`;
    if (!(await hasObject(key))) await putObject(key, library.content, "text/javascript");
  }
}
