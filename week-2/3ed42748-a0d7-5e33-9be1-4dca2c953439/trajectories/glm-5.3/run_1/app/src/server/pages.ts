import type { ServerResponse, IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Errors } from "./errors.js";
import { sendHtml, sendBytes, sendJson, escapeHtml } from "./http-util.js";

// What is served: the client routes, the public postcard pages, and only the client's
// built assets. Source, configuration and credentials are never served.

const CLIENT_DIR = path.resolve("dist/client");
const CLIENT_ROUTES = new Set(["/", "/claim", "/console"]);

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

const PAPER_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; color: #3b2a5c;
  background: #f6ead8; background-image: radial-gradient(circle at 30% 20%, #fdf6e8, #f2e2c9); }
.card { background: #fbf4e4; border: 2px solid #3b2a5c; border-radius: 14px;
  padding: 36px 40px; max-width: 720px; width: min(92vw, 720px); box-shadow: 6px 8px 0 rgba(59,42,92,0.18);
  position: relative; }
h1 { font-family: Georgia, 'Times New Roman', serif; letter-spacing: 0.02em; margin-top: 0; }
.stamp-frame { display: block; width: 100%; max-width: 640px; margin: 18px auto;
  border: 10px solid #fbf4e4; outline: 3px solid #3b2a5c; background: #efe1cc; }
.caption { text-align: center; font-size: 15px; }
.paper-nav { display: block; text-align: center; margin-top: 14px; color: #b5409c; }
`;

export function postcardPage(displayName: string, shareToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A postcard from Bramble</title>
<style>${PAPER_CSS}</style>
</head>
<body>
<main class="card">
<h1>A postcard from Bramble</h1>
<img class="stamp-frame" src="/p/${encodeURIComponent(shareToken)}/image.png" alt="Postcard">
<p class="caption">Sent by ${escapeHtml(displayName)}</p>
</main>
</body>
</html>`;
}

export function returnedToSenderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Returned to sender</title>
<style>${PAPER_CSS}</style>
</head>
<body>
<main class="card">
<h1>Returned to sender</h1>
<p>This postcard has been returned to sender.</p>
</main>
</body>
</html>`;
}

async function clientIndex(): Promise<string> {
  return readFile(path.join(CLIENT_DIR, "index.html"), "utf8");
}

/** Serves the client routes and built assets. Returns false when the path isn't served. */
export async function serveClient(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const pathname = url.pathname;

  if (CLIENT_ROUTES.has(pathname)) {
    sendHtml(res, 200, await clientIndex());
    return true;
  }

  if (pathname.startsWith("/assets/")) {
    const rel = pathname.slice("/assets/".length);
    if (rel.includes("..") || rel.includes("\0")) {
      sendJson(res, 404, Errors.notFound().body());
      return true;
    }
    const ext = path.extname(rel).toLowerCase();
    const type = ASSET_TYPES[ext];
    if (!type) {
      sendJson(res, 404, Errors.notFound().body());
      return true;
    }
    try {
      const bytes = await readFile(path.join(CLIENT_DIR, "assets", rel));
      sendBytes(res, 200, bytes, type, { "Cache-Control": "no-store" });
    } catch {
      sendJson(res, 404, Errors.notFound().body());
    }
    return true;
  }

  return false;
}
