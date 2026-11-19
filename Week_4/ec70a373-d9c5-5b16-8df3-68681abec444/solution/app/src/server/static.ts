// The built frontend: hashed-free assets from dist/public and the SPA shell for the brief's screens only.
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { ApiError, sendBytes } from "./http.ts";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const SCREENS = new Set(["/", "/book", "/packs", "/documents", "/truck", "/site", "/compliance", "/trucks", "/rates", "/reports"]);

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function isScreen(path: string): boolean {
  return SCREENS.has(path) || /^\/inspect\/[^/]+$/.test(path);
}

export async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    throw new ApiError("not_found");
  }
  if (isScreen(path)) {
    const shell = await readFile(join(PUBLIC_DIR, "index.html"));
    sendBytes(res, 200, shell, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    });
    return;
  }
  const extension = /\.[a-z0-9]+$/.exec(path)?.[0] ?? "";
  const type = TYPES[extension];
  const allowed = /^\/(assets|fonts)\/[A-Za-z0-9._-]+$/.test(path);
  const target = normalize(join(PUBLIC_DIR, path));
  if (!type || !allowed || !target.startsWith(PUBLIC_DIR + sep)) throw new ApiError("not_found");
  let data: Buffer;
  try {
    data = await readFile(target);
  } catch {
    throw new ApiError("not_found");
  }
  sendBytes(res, 200, data, { "Content-Type": type, "Cache-Control": "public, max-age=3600" });
}
