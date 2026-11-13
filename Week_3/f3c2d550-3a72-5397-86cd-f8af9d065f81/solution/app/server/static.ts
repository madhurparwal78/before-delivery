import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reply } from "./http.js";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const SCREEN = /^\/(library|capture|reels|trash|settings|reels\/[^/.]+|references\/[^/.]+)?\/?$/;

/**
 * Only the built browser assets are served. A screen address gets the app shell; any other address
 * without a file name gets the shell with 404 so the unknown-route screen shows; everything else is null.
 */
export async function serveBuilt(pathname: string): Promise<Reply | null> {
  const screen = SCREEN.test(pathname);
  const fileName = pathname.split("/").pop() ?? "";
  if (!screen && !fileName.includes(".")) {
    return pathname.split("/").some((segment) => segment.startsWith(".")) ? null : shell(404);
  }
  if (screen) return shell(200);
  const file = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const type = TYPES[extname(file)];
  if (!type || fileName.startsWith(".")) return null;
  try {
    const bytes = await readFile(join(WEB_ROOT, file));
    const hashed = file.startsWith("/assets/");
    return {
      status: 200,
      bytes,
      contentType: type,
      headers: { "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache" },
    };
  } catch {
    return null;
  }
}

async function shell(status: 200 | 404): Promise<Reply> {
  const bytes = await readFile(join(WEB_ROOT, "index.html"));
  return { status, bytes, contentType: TYPES[".html"], headers: { "cache-control": "no-cache" } };
}
