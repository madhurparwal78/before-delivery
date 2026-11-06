// Static serving: the built web app only. Source files, run.json, .env,
// package.json and lockfiles live outside the web root and are unreachable;
// safeJoin also rejects any path that escapes the web root.
import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function serveStatic(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api")) {
      reply.status(404).send({ error: "not_found", message: "Not found." });
      return;
    }
    const pathname = decodeURIComponent(request.url.split("?")[0]);
    const candidates = pathname === "/" ? ["index.html"] : [pathname];
    for (const candidate of candidates) {
      const full = safeJoin(candidate);
      if (full && existsSync(full) && statSync(full).isFile()) {
        reply.header("content-type", MIME[path.extname(full)] ?? "application/octet-stream");
        reply.send(readFileSync(full));
        return;
      }
    }
    // Client-side routes fall back to the app shell.
    if (!path.extname(pathname)) {
      const shell = safeJoin("index.html");
      if (shell && existsSync(shell)) {
        reply.header("content-type", "text/html; charset=utf-8");
        reply.send(readFileSync(shell));
        return;
      }
    }
    reply.status(404).send({ error: "not_found", message: "Not found." });
  });
}

function safeJoin(candidate: string): string | null {
  const rel = candidate.replace(/^\/+/, "");
  if (rel.includes("..")) return null;
  const full = path.resolve(WEB_ROOT, rel);
  if (full !== WEB_ROOT && !full.startsWith(WEB_ROOT + path.sep)) return null;
  return full;
}
