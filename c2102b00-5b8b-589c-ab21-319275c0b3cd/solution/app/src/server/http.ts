// The server boundary: same-origin writes only, body size and type limits, JSON replies, and the
// built client assets. Nothing else on disk is ever served.
import { readFileSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, type Reply } from "./errors.js";

export const JSON_LIMIT = 16_384;

const tooLarge = () => new ApiError(413, "too_large", "That request is too large.");
const unsupportedType = () => new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type application/json.");

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A state-changing request whose Origin is not this host is refused. */
export function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (!STATE_CHANGING.has(req.method ?? "") || origin === undefined) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== req.headers.host) throw new ApiError(403, "forbidden", "Cross-origin requests are refused.");
}

/**
 * Reads the body, keeping nothing past `limit` bytes; a larger body is drained and refused with
 * 413 before any work is done.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = Number(req.headers["content-length"] ?? 0) > limit;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) refused = true;
      if (!refused) chunks.push(chunk);
    });
    req.on("end", () => (refused ? reject(tooLarge()) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

/** A JSON object body, `{}` when there is none. */
export function parseJson(req: IncomingMessage, raw: Buffer): Record<string, unknown> {
  if (STATE_CHANGING.has(req.method ?? "") && req.method !== "DELETE" && mediaType(req) !== "application/json") {
    throw unsupportedType();
  }
  if (raw.length === 0) return {};
  if (mediaType(req) !== "application/json") throw unsupportedType();
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    value = null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "validation", "Some fields need fixing.", { body: "Send a JSON object." });
  }
  return value as Record<string, unknown>;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...NO_STORE, ...(reply.headers ?? {}) };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
}

// ---- Static client -----------------------------------------------------------------------------

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Only the built client files, read once at start. */
const assets = new Map<string, { type: string; data: Buffer }>();
for (const folder of ["assets", "fonts"]) {
  for (const name of readdirSync(path.join(PUBLIC, folder))) {
    const type = TYPES[path.extname(name)];
    if (type) assets.set(`/${folder}/${name}`, { type, data: readFileSync(path.join(PUBLIC, folder, name)) });
  }
}
const page = readFileSync(path.join(PUBLIC, "index.html"));

const APP_PATHS = [
  /^\/$/, /^\/cycles\/[^/]+$/, /^\/credit$/, /^\/coordinator$/, /^\/coordinator\/cycles\/[^/]+$/, /^\/breakdown$/,
];

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

/** Client assets, or the app page for every other path: 200 on an app address, 404 elsewhere. */
export function serveClient(req: IncomingMessage, res: ServerResponse): void {
  const pathname = new URL(req.url ?? "/", "http://local").pathname;
  const asset = assets.get(pathname);
  if (asset) {
    res.writeHead(200, { ...SECURITY, "Content-Type": asset.type, "Cache-Control": "no-cache" }).end(asset.data);
    return;
  }
  const known = APP_PATHS.some((p) => p.test(pathname));
  res
    .writeHead(known ? 200 : 404, { ...SECURITY, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
    .end(page);
}
