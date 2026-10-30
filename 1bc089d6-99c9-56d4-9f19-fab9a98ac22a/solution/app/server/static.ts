import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = fileURLToPath(new URL("../client/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const PAGES: Array<[RegExp, string]> = [
  [/^\/$/, "index.html"],
  [/^\/manage\/?$/, "manage.html"],
  [/^\/p\/[^/]+\/?$/, "share.html"],
  [/^\/signin\/?$/, "signin.html"],
  [/^\/privacy\/?$/, "privacy.html"],
];

const NOT_FOUND_FILE = "notfound.html";
const PAGE_FILES = new Set([...PAGES.map(([, file]) => file), NOT_FOUND_FILE]);

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

/** "This page is not here." with a link home, built by Vite with the account pages' styles. */
const NOT_FOUND_PAGE = readFileSync(join(CLIENT, NOT_FOUND_FILE));

/** Maps a URL path to a file inside dist/client, refusing dotfiles, traversal and page files under other names. */
function resolveFile(pathname: string): string | null {
  const page = PAGES.find(([pattern]) => pattern.test(pathname));
  if (page) return join(CLIENT, page[1]);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.split("/").some((part) => part.startsWith("."))) return null;
  const file = normalize(join(CLIENT, decoded));
  if (!file.startsWith(CLIENT) || file.endsWith(sep)) return null;
  if (PAGE_FILES.has(file.slice(CLIENT.length))) return null;
  return TYPES[extname(file).toLowerCase()] ? file : null;
}

function cacheFor(pathname: string, type: string) {
  if (type.startsWith("text/html")) return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

/** Serves a page or a built asset, with single byte ranges for audio and video. */
export async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string) {
  const file = resolveFile(pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile()) {
    response.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : NOT_FOUND_PAGE);
    return;
  }
  const type = TYPES[extname(file).toLowerCase()];
  const headers: Record<string, string | number> = {
    ...SECURITY_HEADERS,
    "content-type": type,
    "cache-control": cacheFor(pathname, type),
    "accept-ranges": "bytes",
    "last-modified": info.mtime.toUTCString(),
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` }).end();
      return;
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["content-length"] = end - start + 1;
  response.writeHead(status, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file, { start, end }).pipe(response);
}
