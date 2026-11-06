import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeNext, landingFor } from "../shared/next.ts";
import { isUuid, liveRole } from "./access.ts";
import { one, pool } from "./db.ts";
import { documentPolicy, newNonce, securityHeaders } from "./security.ts";
import { resolveSession } from "./sessions.ts";

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/** Serves only the built browser app's assets: no source, maps, manifests or environment files. */
export async function serveAsset(res: ServerResponse, path: string): Promise<boolean> {
  if (!/^\/assets\/(?:fonts\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path)) return false;
  const type = TYPES[extname(path)];
  if (!type) return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(PUBLIC_DIR, path));
  } catch {
    return false;
  }
  res.writeHead(200, { ...securityHeaders(path), "Content-Type": type, "Content-Length": String(bytes.length), "Cache-Control": "no-cache" });
  res.end(bytes);
  return true;
}

function shell(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scopewright</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="/assets/app.js"></script>
</body>
</html>
`;
}

function sendShell(res: ServerResponse, path: string, status: number): void {
  const nonce = newNonce();
  const body = Buffer.from(shell(nonce));
  res.writeHead(status, {
    ...securityHeaders(path),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    "Content-Security-Policy": documentPolicy(nonce),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function redirect(res: ServerResponse, path: string, location: string): void {
  res.writeHead(302, { ...securityHeaders(path), Location: location, "Cache-Control": "no-store" });
  res.end();
}

/** Malformed percent-encoding decodes to a value that names no diagram. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/** Whether the signed-in person can see this diagram address (and page, when given). */
async function canSee(userId: string, diagramId: string, pageId: string | undefined): Promise<boolean> {
  if (!(await liveRole(pool, diagramId, userId))) return false;
  if (pageId === undefined) return true;
  return isUuid(pageId) && !!(await one(pool, "SELECT 1 FROM pages WHERE id = $1 AND diagram_id = $2", [pageId, diagramId]));
}

/** Document requests: signed-out visits to `/` and `/d/...` go to sign-in; unknown or hidden addresses answer 404 with the app, which renders the not-found copy. */
export async function serveDocument(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path.startsWith("/invite/")) return sendShell(res, path, /^\/invite\/[^/]+$/.test(path) ? 200 : 404);
  const state = await resolveSession(pool, req, true);
  const user = state.kind === "active" ? state.session.user : null;
  if (path === "/signin") {
    if (user) return redirect(res, path, landingFor(url.searchParams.get("next")));
    return sendShell(res, path, 200);
  }
  if (path === "/" || path.startsWith("/d/")) {
    if (!user) return redirect(res, path, `/signin?next=${encodeNext(path + url.search)}`);
    if (path === "/") return sendShell(res, path, 200);
    const m = /^\/d\/([^/]+)(?:\/p\/([^/]+))?$/.exec(path);
    const visible = m ? await canSee(user.id, safeDecode(m[1]!), m[2] === undefined ? undefined : safeDecode(m[2])) : false;
    return sendShell(res, path, visible ? 200 : 404);
  }
  return sendShell(res, path, 404);
}
