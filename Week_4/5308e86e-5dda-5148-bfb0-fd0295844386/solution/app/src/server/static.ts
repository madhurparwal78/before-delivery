/** Static files from dist/public under /assets. Source maps and anything outside that folder are never served. */
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_ROOT = resolve(fileURLToPath(new URL("../public/", import.meta.url)));

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

interface StaticFile {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

export async function readAsset(urlPath: string): Promise<StaticFile | null> {
  let relative: string;
  try {
    relative = normalize(decodeURIComponent(urlPath.slice("/assets/".length)));
  } catch {
    return null;
  }
  const extension = extname(relative);
  const contentType = TYPES[extension];
  if (!contentType) return null;
  const file = resolve(join(PUBLIC_ROOT, relative));
  if (!file.startsWith(PUBLIC_ROOT + "/")) return null;
  try {
    const body = await readFile(file);
    const cacheControl = extension === ".woff2" ? "public, max-age=31536000, immutable" : "no-cache";
    return { body, contentType, cacheControl };
  } catch {
    return null;
  }
}
