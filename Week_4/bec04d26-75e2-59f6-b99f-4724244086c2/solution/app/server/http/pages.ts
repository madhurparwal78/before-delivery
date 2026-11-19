import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { isPage } from "../../shared/routes";
import { type Env, canOpen, currentAccount } from "./context";

const CLIENT_DIR = fileURLToPath(new URL("../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
};

let indexHtml: Buffer | undefined;
const index = (): Buffer => (indexHtml ??= readFileSync(join(CLIENT_DIR, "index.html")));

const html = (status: number): Response =>
  new Response(new Uint8Array(index()), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });

/** Built assets live under /assets/ and nowhere else; no dot segments, no traversal, nothing outside the build. */
function asset(path: string): Response | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/assets/") || decoded.split("/").some((part) => part === ".." || part.startsWith("."))) return null;
  const file = normalize(join(CLIENT_DIR, decoded));
  if (!file.startsWith(CLIENT_DIR)) return null;
  try {
    if (!statSync(file).isFile()) return null;
    return new Response(new Uint8Array(readFileSync(file)), { headers: {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable",
    } });
  } catch {
    return null;
  }
}

export function registerPages(app: Hono<Env>): void {
  app.get("*", async (c) => {
    const path = c.req.path;
    const found = asset(path);
    if (found) return found;
    if (!isPage(path)) return html(404);
    const id = /^\/returns\/([^/]+)$/.exec(path)?.[1];
    if (id) {
      const account = await currentAccount(c);
      if (account && !(await canOpen(account, { id, table: "returns" }))) return html(404);
    }
    return html(200);
  });
}
