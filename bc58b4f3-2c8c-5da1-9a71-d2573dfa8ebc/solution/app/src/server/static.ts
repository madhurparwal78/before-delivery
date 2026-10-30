// Serves only the built client: the screens' HTML, hashed assets and the self-hosted fonts.
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, sendError } from "./http.js";

const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));

const SCREENS = new Set(["/", "/requests", "/board", "/offers", "/my-seats", "/billing", "/org"]);

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

export async function serveClient(res: ServerResponse, pathname: string): Promise<void> {
  if (SCREENS.has(pathname)) {
    const html = await readFile(join(CLIENT_ROOT, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
    return;
  }
  const relative = normalize(pathname).replace(/^\/+/, "");
  const type = TYPES[extname(relative)];
  if (!type || !/^(assets|fonts)\/[\w.-]+$/.test(relative)) {
    sendError(res, new ApiError("not_found"));
    return;
  }
  try {
    const body = await readFile(join(CLIENT_ROOT, relative));
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
    res.end(body);
  } catch {
    sendError(res, new ApiError("not_found"));
  }
}
