import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface Asset { body: Buffer; type: string; etag: string }

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

function load(directory: string, prefix: string, into: Map<string, Asset>): void {
  for (const file of filesUnder(join(APP_ROOT, directory))) {
    const body = readFileSync(file);
    const path = prefix + relative(join(APP_ROOT, directory), file).split(sep).join("/");
    into.set(path, { body, type: TYPES[extname(file)] ?? "application/octet-stream", etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 24)}"` });
  }
}

/** Every file the site serves, read once at start: public files and the compiled browser modules, nothing else. */
export function loadAssets(): Map<string, Asset> {
  const assets = new Map<string, Asset>();
  load("public", "/", assets);
  load("dist/client", "/assets/client/", assets);
  load("dist/shared", "/assets/shared/", assets);
  return assets;
}
