import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type http from "node:http";

/**
 * The static file server for built client pages and assets. Only paths inside
 * dist are reachable, and source, configuration and credentials never are.
 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

export function makeStaticHandler() {
  const distRoot = join(process.cwd(), "dist");
  const cache = new Map<string, string>();

  return (pathname: string, res: http.ServerResponse): boolean => {
    if (isBlocked(pathname)) return false;
    let filePath = safeJoin(distRoot, pathname);
    if (filePath === null) return false;
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext];
    if (mime === undefined) return false;
    let body = cache.get(filePath);
    if (body === undefined) {
      body = readFileSync(filePath, "utf8");
      if (ext !== ".woff2") cache.set(filePath, body);
    }
    res.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
    res.end(body);
    return true;
  };
}

function safeJoin(root: string, pathname: string): string | null {
  const target = join(root, pathname);
  if (!target.startsWith(root + "/") && target !== root) return null;
  return target;
}

/** Source, configuration and credentials are never served. */
function isBlocked(pathname: string): boolean {
  const p = decodeURIComponent(pathname).toLowerCase();
  if (p.startsWith("/api/")) return true;
  if (p.includes("..")) return true;
  const blocked = [
    "/src/",
    "/run.json",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.json",
    "/build.mjs",
    "/third_party_notices.md",
    "/.env",
    "/dist/server/",
    "/node_modules/",
    "/license",
    "/readme",
    "/agentic",
    "/workspace",
    "/gemini",
    "/.git",
    "/.agents",
    "/.skills",
    "/kilocode",
    "/memory/",
    "/openhands",
    "/third_party",
  ];
  for (const b of blocked) {
    const t = b.startsWith("/") ? b : "/" + b;
    if (p === t || p === t + "/" || p.startsWith(t + "/") || p === t.slice(1)) return true;
  }
  if (p.endsWith(".ts")) return true;
  if (p.endsWith(".ts.map")) return true;
  if (p.endsWith(".js.map")) return true;
  if (p.startsWith("/dist/") && !p.startsWith("/dist/client") && !p.startsWith("/dist/assets")) {
    return true;
  }
  return false;
}

/** Names of the client page files, for the route table. */
export function pageNames(): string[] {
  const dir = join(process.cwd(), "dist", "client");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".html"));
}
