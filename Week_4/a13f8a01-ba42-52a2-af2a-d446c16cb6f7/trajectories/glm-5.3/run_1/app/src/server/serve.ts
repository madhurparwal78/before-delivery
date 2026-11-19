import { readFileSync, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "./server.js";
import type { AppConfig } from "../shared/config.js";
import { findShelf } from "../shared/shelf.js";
import { send404 } from "./http.js";
import { rewriteJsForLoopGuard } from "./loopguard.js";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
  const len = typeof body === "string" ? Buffer.byteLength(body) : body.length;
  res.writeHead(status, { "content-type": type, "content-length": String(len), ...extra });
  res.end(body);
}

export async function serveStatic(app: App, res: ServerResponse, url: URL, frameHeaders: Record<string, string>): Promise<boolean> {
  if (url.pathname.startsWith("/assets/")) {
    const file = url.pathname.slice("/assets/".length).replace(/[^a-zA-Z0-9._-]/g, "");
    const path = new URL(`./client/public/${file}`, import.meta.url).pathname;
    if (!existsSync(path)) {
      send404(res);
      return true;
    }
    const ext = file.slice(file.lastIndexOf("."));
    send(res, 200, readFileSync(path), MIME[ext] ?? "application/octet-stream", {
      "cache-control": "public, max-age=3600",
      ...frameHeaders,
    });
    return true;
  }
  return false;
}

// Every page route shares one shell; the client router decides what shows.
export async function servePage(app: App, req: IncomingMessage, res: ServerResponse, url: URL, frameHeaders: Record<string, string>): Promise<void> {
  const shellPath = new URL(`./client/public/index.html`, import.meta.url).pathname;
  if (!existsSync(shellPath)) {
    send(res, 503, "The app is still building.", "text/plain; charset=utf-8");
    return;
  }
  send(res, 200, readFileSync(shellPath), "text/html; charset=utf-8", {
    "cache-control": "no-store",
    ...frameHeaders,
  });
}

const CSP = "sandbox allow-scripts; script-src 'unsafe-inline' 'self' /shelf/; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; default-src 'none'; base-uri 'none'; form-action 'none'";

export function servePreview(app: App, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const id = url.pathname.slice("/preview/".length);
  const rec = app.renders.get(id);
  if (!rec) {
    send(res, 404, "This render has expired or never existed.", "text/plain; charset=utf-8");
    return;
  }
  const doc = previewDocument(app.config, rec.id, rec.nonce, rec.html, rec.css, rec.js, rec.libraries);
  send(res, 200, doc, "text/html; charset=utf-8", { "content-security-policy": CSP, "cache-control": "no-store" });
}

export function previewDocument(config: AppConfig, renderId: string, nonce: string, html: string, css: string, js: string, libraries: string[]): string {
  const libraryTags = libraries
    .map((id) => findShelf(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => `<script src="/shelf/${s.id}/${s.file}"></script>`)
    .join("\n");
  const harness = readFileSync(new URL("./harness.js", import.meta.url).pathname, "utf8");
  const guarded = rewriteJsForLoopGuard(js, config.loopLimit);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
</style>
<script>window.__ASHLAR = { render: ${JSON.stringify(renderId)}, nonce: ${JSON.stringify(nonce)}, loopLimit: ${config.loopLimit} };</script>
${libraryTags}
</head>
<body>
${html}
<script>
${harness}
</script>
<script>
${guarded}
</script>
</body>
</html>`;
}

export async function serveShelfFile(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const rest = url.pathname.slice("/shelf/".length);
  const slash = rest.indexOf("/");
  const libId = slash > 0 ? rest.slice(0, slash) : "";
  const file = slash > 0 ? rest.slice(slash + 1) : "";
  const entry = libId ? findShelf(libId) : undefined;
  if (!entry || file !== entry.file) {
    send404(res);
    return;
  }
  const local = new URL(`../shelf/${entry.file}`, import.meta.url).pathname;
  if (existsSync(local)) {
    send(res, 200, readFileSync(local), "text/javascript; charset=utf-8", { "cache-control": "public, max-age=86400" });
    return;
  }
  send404(res);
}
