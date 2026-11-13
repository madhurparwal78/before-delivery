// Serves the built client: hashed assets and fonts, and the app shell for client routes.
// Nothing else on disk is reachable (no source, maps, manifests, lockfiles or env files).

import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { ServerResponse } from "node:http";

const CLIENT_DIR = join(import.meta.dirname, "..", "..", "client");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function notFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

export async function serveClient(path: string, response: ServerResponse): Promise<void> {
  const type = TYPES[extname(path)];
  if (type) {
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    if (!/^\/(assets|fonts)\/[\w.-]+$/.test(safe)) return notFound(response);
    try {
      const data = await readFile(join(CLIENT_DIR, safe));
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
      response.end(data);
    } catch {
      notFound(response);
    }
    return;
  }
  if (extname(path) !== "" || path.split("/").some((segment) => segment.startsWith("."))) return notFound(response);
  const shell = await readFile(join(CLIENT_DIR, "index.html"));
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  response.end(shell);
}
