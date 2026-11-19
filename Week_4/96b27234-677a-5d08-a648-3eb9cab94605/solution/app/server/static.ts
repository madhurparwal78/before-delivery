import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../client");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

interface Served {
  bytes: Buffer;
  type: string;
  immutable: boolean;
}

/** The built client, read once: only these files are ever served, so no other path reaches the disk. */
function load(): Map<string, Served> {
  const found = new Map<string, Served>();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!name.startsWith(".")) {
        const path = `/${relative(ROOT, full).split("\\").join("/")}`;
        found.set(path, { bytes: readFileSync(full), type: TYPES[extname(name)] ?? "application/octet-stream", immutable: path.startsWith("/assets/") });
      }
    }
  };
  try {
    walk(ROOT);
  } catch {
    return found;
  }
  return found;
}

const files = load();

const PAGES = [/^\/$/, /^\/signin$/, /^\/signup$/, /^\/confirm\/[^/]+$/, /^\/sessions(\/[^/]+)?$/, /^\/friends$/, /^\/invites\/[^/]+$/, /^\/studio$/, /^\/communities(\/[^/]+)?$/, /^\/gatherings\/[^/]+$/, /^\/moderation$/];

interface Page {
  status: number;
  bytes: Buffer;
  type: string;
  cache: string;
}

/** A built file, the app shell for a page path, or the shell with a 404 for any other path. */
export function pageFor(rawPath: string): Page {
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = "\u0000";
  }
  const shell = files.get("/index.html");
  const file = path.includes("\u0000") || path.includes("..") ? undefined : files.get(path);
  if (file && path !== "/index.html") {
    return { status: 200, bytes: file.bytes, type: file.type, cache: file.immutable ? "public, max-age=31536000, immutable" : "no-cache" };
  }
  const known = PAGES.some((pattern) => pattern.test(path.length > 1 ? path.replace(/\/$/, "") : path));
  return { status: known ? 200 : 404, bytes: shell?.bytes ?? Buffer.from("Not found."), type: TYPES[".html"] ?? "text/html", cache: "no-cache" };
}
