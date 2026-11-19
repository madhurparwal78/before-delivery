// Server-rendered HTML shells. The client bundles take over after first paint.

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
const ASSETS_DIR = path.join(__dirname, "..", "public");

export class Pages {
  async serve(_req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<void> {
    if (method === "GET" || method === "HEAD") {
      const assetPath = this.assetPath(url.pathname);
      if (assetPath) return this.serveAsset(res, assetPath);
      return this.servePage(res, url.pathname);
    }
    res.writeHead(405); res.end();
  }

  private assetPath(pathname: string): string | null {
    if (!pathname.startsWith("/assets/")) return null;
    const rel = pathname.slice("/assets/".length);
    if (rel.includes("..") || rel.startsWith("/") || rel.endsWith("/")) return null;
    return rel;
  }

  private serveAsset(res: http.ServerResponse, rel: string): void {
    const file = path.join(ASSETS_DIR, rel);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(ASSETS_DIR + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    const type = contentTypeOf(rel);
    const buf = fs.readFileSync(resolved);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": buf.length,
      "Cache-Control": rel.endsWith(".woff2") ? "public, max-age=31536000, immutable" : "no-cache"
    });
    res.end(buf);
  }

  private servePage(res: http.ServerResponse, pathname: string): void {
    const body = this.shell(pathname);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
    res.end(body);
  }

  private shell(pathname: string): string {
    const page = pageKey(pathname);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hushfoot${page.title ? " · " + page.title : ""}</title>
<link rel="stylesheet" href="/assets/styles.css">
<script defer src="/assets/bundle.js"></script>
</head>
<body data-page="${page.key}">
${page.chrome}
<main id="main"></main>
</body>
</html>`;
  }
}

function contentTypeOf(name: string): string {
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (name.endsWith(".woff2")) return "font/woff2";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function pageKey(pathname: string): { key: string; title: string; chrome: string } {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { key: "title", title: "", chrome: "" };
  if (p === "/signup") return { key: "signup", title: "Create account", chrome: "" };
  if (p === "/signin") return { key: "signin", title: "Sign in", chrome: "" };
  if (p === "/confirm") return { key: "confirm", title: "Confirm", chrome: "" };
  if (p === "/play") return { key: "play", title: "Play", chrome: "" };
  if (p === "/hall") return { key: "hall-edit", title: "Your hall", chrome: headerHtml() };
  if (p.startsWith("/hall/")) return { key: "hall-visit", title: "Gallery hall", chrome: headerHtml() };
  if (p === "/board") return { key: "board", title: "Notice board", chrome: headerHtml() };
  if (p === "/ranger") return { key: "ranger", title: "Ranger", chrome: headerHtml() };
  if (p.startsWith("/boards/")) return { key: "boards", title: "Challenge board", chrome: headerHtml() };
  if (p.startsWith("/postcards/")) return { key: "postcard", title: "Postcard", chrome: "" };
  if (p === "/text-world") return { key: "text-world", title: "Text world", chrome: headerHtml() };
  return { key: "not-found", title: "Not found", chrome: headerHtml() };
}

function headerHtml(): string {
  return `<a class="skip-link" href="#main">Skip to main</a>`;
}
