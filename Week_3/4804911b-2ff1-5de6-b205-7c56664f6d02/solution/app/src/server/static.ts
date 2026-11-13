import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(DIST, "public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json",
};

const FONTS = ["bebas-neue-latin-400-normal", "eb-garamond-latin-400-normal", "eb-garamond-latin-400-italic"];

async function shell(): Promise<string> {
  let assets = { js: "", css: "" };
  try {
    assets = JSON.parse(await readFile(path.join(DIST, "manifest.json"), "utf8")) as typeof assets;
  } catch {
    // the client half has not been built yet; the shell still answers so the server stays up
  }
  const preload = FONTS.map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#9c1220"><title>Interval | Vasant Talkies Drinks</title>${preload}${assets.css ? `<link rel="stylesheet" href="/assets/${assets.css}">` : ""}</head><body><div id="root"></div>${assets.js ? `<script type="module" src="/assets/${assets.js}"></script>` : ""}</body></html>`;
}

export async function sendShell(res: ServerResponse, status: number, noStore: boolean): Promise<void> {
  const html = await shell();
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": noStore ? "no-store" : "no-cache",
  });
  res.end(html);
}

/** Serves a built file when the path names one; returns false when it does not. */
export async function sendAsset(res: ServerResponse, pathname: string, head: boolean): Promise<boolean> {
  const target = path.normalize(path.join(PUBLIC, pathname));
  if (!target.startsWith(PUBLIC + path.sep)) return false;
  try {
    if (!(await stat(target)).isFile()) return false;
    const bytes = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target)] ?? "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": pathname.startsWith("/assets/") || pathname.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(head ? undefined : bytes);
    return true;
  } catch {
    return false;
  }
}
