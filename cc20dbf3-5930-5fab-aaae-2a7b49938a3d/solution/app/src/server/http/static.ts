// The browser app: built assets from `dist/public` only. The brief's screen paths answer 200 with the app;
// every other path answers 404 with the app, which renders its Not found page. Nothing outside the asset
// folder is ever read.

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));

const SCREENS = [/^\/$/, /^\/catalogue$/, /^\/items\/[^/]+$/, /^\/my-loans$/, /^\/loans\/[^/]+$/, /^\/counter$/, /^\/ledger$/];

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

async function asset(pathname: string): Promise<{ data: Buffer; type: string } | null> {
  const type = TYPES[extname(pathname)];
  if (!type || pathname.split("/").some((part) => part.startsWith("."))) return null;
  const file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT) || file.slice(ROOT.length).split(sep).includes("..")) return null;
  try {
    return { data: await readFile(file), type };
  } catch {
    return null;
  }
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const found = req.method === "GET" || req.method === "HEAD" ? await asset(url.pathname) : null;
  if (found) {
    res.writeHead(200, { ...HEADERS, "Content-Type": found.type, "Content-Length": found.data.length, "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : found.data);
    return;
  }
  const page = await readFile(join(ROOT, "index.html"));
  const status = SCREENS.some((screen) => screen.test(url.pathname)) ? 200 : 404;
  res.writeHead(status, { ...HEADERS, "Content-Type": TYPES[".html"] ?? "text/html", "Content-Length": page.length, "Cache-Control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : page);
}
