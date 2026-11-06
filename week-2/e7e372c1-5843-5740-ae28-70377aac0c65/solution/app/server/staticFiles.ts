// Serves only the built browser assets. Source, manifests and environment files are never reachable.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./client/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

interface StaticFile {
  body: Buffer;
  type: string;
  immutable: boolean;
}

const files = new Map<string, StaticFile>();

function walk(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    const url = `/${relative(ROOT, path).split(sep).join("/")}`;
    files.set(url, { body: readFileSync(path), type: TYPES[extname(path)] ?? "application/octet-stream", immutable: url.startsWith("/assets/") });
  }
}

export function loadStaticFiles(): void {
  walk(ROOT);
}

const PAGE_ROUTES = [/^\/$/, /^\/cite\/[^/]+\/[^/]+$/, /^\/staff$/, /^\/staff\/restatements$/, /^\/staff\/restatements\/[^/]+$/, /^\/operator$/];

export function staticFor(pathname: string): StaticFile | null {
  const direct = files.get(pathname);
  if (direct && pathname !== "/index.html") return direct;
  return PAGE_ROUTES.some((route) => route.test(pathname)) ? (files.get("/index.html") ?? null) : null;
}
