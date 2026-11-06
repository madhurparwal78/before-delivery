/**
 * Serves the built browser assets and nothing else. Source files, source maps,
 * `run.json`, package manifests, lockfiles and environment files are outside this
 * directory, so requests for them answer 404.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join, normalize, resolve } from "node:path";
import { WEB_DIST_DIR } from "../paths.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/** The routes the single-page app owns. Anything else is not served at all. */
const APP_ROUTES: ReadonlyArray<RegExp> = [
  /^\/$/,
  /^\/catalogue$/,
  /^\/compare$/,
  /^\/products\/[A-Za-z0-9-]+$/,
  /^\/favourites$/,
  /^\/cart$/,
  /^\/checkout$/,
  /^\/orders\/[A-Za-z0-9-]+$/,
  /^\/signin$/,
  /^\/signup$/,
  /^\/account$/,
  /^\/projects$/,
  /^\/projects\/[0-9a-fA-F-]+$/,
  /^\/admin$/,
  /^\/newsletter\/confirm$/,
];

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some((route) => route.test(pathname));
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

async function sendFile(res: ServerResponse, absolutePath: string, immutable: boolean): Promise<boolean> {
  let size: number;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return false;
    size = info.size;
  } catch {
    return false;
  }

  res.writeHead(200, {
    "content-type": contentTypeFor(absolutePath),
    "content-length": size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(absolutePath).pipe(res);
  return true;
}

/** Resolves a request path inside the built assets, refusing any traversal. */
function safeJoin(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0")) return null;
  const candidate = resolve(join(WEB_DIST_DIR, normalize(decoded)));
  const root = resolve(WEB_DIST_DIR);
  return candidate === root || candidate.startsWith(`${root}/`) ? candidate : null;
}

/**
 * Serves a built asset, or the app shell for a route the app owns. Returns false
 * when the path is not served, so the caller can answer 404.
 */
export async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname !== "/") {
    const absolute = safeJoin(pathname);
    if (absolute === null) return false;
    const immutable = pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
    if (await sendFile(res, absolute, immutable)) return true;
  }
  if (!isAppRoute(pathname)) return false;
  return sendFile(res, join(WEB_DIST_DIR, "index.html"), false);
}
