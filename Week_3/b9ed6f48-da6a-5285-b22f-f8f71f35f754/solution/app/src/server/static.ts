// The built browser app. Only files Vite emitted are served; every page route answers with the
// app shell, and unknown or unpublished pages answer it with status 404 (brief: Not found;
// Server boundary › Nothing private is served).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, normalize } from "node:path";
import type { ServerResponse } from "node:http";
import { publishedChapter } from "./archive.js";

const ROOT = fileURLToPath(new URL("../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const PAGES = new Set(["/", "/timeline", "/sources", "/sessions", "/support", "/account", "/studio", "/box-office"]);

let shell: Buffer | null = null;

async function pageStatus(pathname: string): Promise<number> {
  if (PAGES.has(pathname)) return 200;
  const chapter = /^\/chapters\/([1-8])$/.exec(pathname);
  return chapter && (await publishedChapter(Number(chapter[1]))) ? 200 : 404;
}

export async function serveStatic(pathname: string, res: ServerResponse, head: boolean): Promise<void> {
  if (pathname.startsWith("/assets/")) {
    const relative = normalize(pathname).replace(/^\/+/, "");
    if (!relative.startsWith("assets/") || relative.includes("..") || !TYPES[extname(relative)]) return notFound(res);
    try {
      const body = await readFile(`${ROOT}${relative}`);
      res.writeHead(200, { "Content-Type": TYPES[extname(relative)], "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      res.end(head ? undefined : body);
    } catch {
      notFound(res);
    }
    return;
  }
  shell ??= await readFile(`${ROOT}index.html`);
  res.writeHead(await pageStatus(pathname), {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  });
  res.end(head ? undefined : shell);
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
}
