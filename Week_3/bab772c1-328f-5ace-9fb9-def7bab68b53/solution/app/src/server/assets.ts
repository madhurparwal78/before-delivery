/** The only files served besides the API: the built bundle, the stylesheet and the fonts. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sendError } from "./http/context.js";
import { notFound } from "./errors.js";
import type { Context } from "./http/context.js";

const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));

export function publicFilePath(relative: string): string {
  return `${publicDir}${relative}`;
}

const FONT_FILES = [
  "archivo-latin-400-normal.woff2",
  "archivo-latin-600-normal.woff2",
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-500-normal.woff2",
];

const ASSETS = new Map<string, { file: string; type: string }>([
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/app.css", { file: "app.css", type: "text/css; charset=utf-8" }],
  ...FONT_FILES.map(
    (name) =>
      [`/fonts/${name}`, { file: `fonts/${name}`, type: "font/woff2" }] as [
        string,
        { file: string; type: string },
      ],
  ),
]);

export function isAssetPath(path: string): boolean {
  return ASSETS.has(path);
}

export async function serveAsset(context: Context): Promise<void> {
  const asset = ASSETS.get(context.path);
  if (!asset) {
    sendError(context, notFound());
    return;
  }
  const bytes = await readFile(publicFilePath(asset.file));
  context.response.writeHead(200, {
    "content-type": asset.type,
    "content-length": bytes.length,
    "cache-control": "public, max-age=3600",
  });
  context.response.end(context.method === "HEAD" ? undefined : bytes);
}
