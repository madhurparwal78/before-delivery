import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import { one, pool } from "./db.js";

const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));

/** Screens the client router owns; any other path that is not an API call is a 404. */
const SCREENS = /^\/(signin|join\/[^/]+|events|events\/\d+(\/(timing|rota|live|protests|corrections|publish))?|index-tables|season|operator)?$/;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

/** The join page carries its club's name in the page itself, so no extra endpoint is needed to read it. */
async function clubJson(pathname: string): Promise<string> {
  const slug = /^\/join\/([^/]+)$/.exec(pathname)?.[1];
  const club = slug === undefined ? null : await one<{ name: string }>(pool, "select name from clubs where slug = $1", [slug]);
  return JSON.stringify(club === null ? null : { name: club.name }).replaceAll("<", "\\u003c");
}

async function send(c: Context, file: string, cache: string): Promise<Response> {
  const bytes = await readFile(path.join(CLIENT_DIR, file));
  const body = file === "index.html" ? Buffer.from(bytes.toString("utf8").replace("<!--club-->", await clubJson(c.req.path))) : bytes;
  return c.body(new Uint8Array(body), 200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });
}

/** Built client files only: hashed assets under /assets, and index.html for the client's own screens. */
export async function serveClient(c: Context): Promise<Response | null> {
  const pathname = c.req.path;
  if (SCREENS.test(pathname)) return send(c, "index.html", "no-cache");
  if (/^\/assets\/[\w.-]+$/.test(pathname)) {
    return send(c, pathname.slice(1), "public, max-age=31536000, immutable").catch(() => null);
  }
  return null;
}
