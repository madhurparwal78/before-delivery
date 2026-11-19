import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** The only files the server ever sends from disk: the built assets and fonts, listed once at start. A request for
 * anything else (source files, source maps, `.env`, `run.json`, package files) is never looked up on disk. */

export interface StaticFile {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly cacheControl: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)])),
  );
  return nested.flat();
}

export async function loadStaticFiles(mounts: readonly { readonly urlPrefix: string; readonly directory: string }[]): Promise<ReadonlyMap<string, StaticFile>> {
  const files = new Map<string, StaticFile>();
  for (const mount of mounts) {
    for (const file of await listFiles(mount.directory)) {
      const contentType = CONTENT_TYPES[path.extname(file)];
      if (contentType === undefined) continue;
      const urlPath = `${mount.urlPrefix}${path.relative(mount.directory, file).split(path.sep).join("/")}`;
      const immutable = contentType === "font/woff2";
      files.set(urlPath, {
        bytes: await readFile(file),
        contentType,
        cacheControl: immutable ? "public, max-age=31536000, immutable" : "no-cache",
      });
    }
  }
  return files;
}
