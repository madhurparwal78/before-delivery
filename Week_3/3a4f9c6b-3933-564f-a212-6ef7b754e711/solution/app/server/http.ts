// The server boundary: body limits, content type, same origin, JSON replies and the built client.
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, invalid } from "./errors.js";

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  raw: Buffer;
  now: Date;
}

const INGEST_LIMIT = 1_000_000;
const BODY_LIMIT = 64_000;
const INGEST_PATH = /^\/api\/projects\/[^/]+\/bundles$/;

export function json(status: number, body?: unknown, headers?: Record<string, string>): Reply {
  return { status, body, headers };
}

export function errorReply(error: ApiError): Reply {
  return json(error.status, error.body());
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, headers).end(reply.bytes);
  } else if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
  } else {
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers }).end(JSON.stringify(reply.body));
  }
}

/** Steps 1 and 2 of the error precedence: body size and content type, then a foreign origin. */
export async function readRequest(req: IncomingMessage, method: string, pathname: string): Promise<Buffer> {
  const limit = method === "POST" && INGEST_PATH.test(pathname) ? INGEST_LIMIT : BODY_LIMIT;
  const tooLarge = new ApiError("payload_too_large", `The request body is larger than ${limit} bytes.`);
  if (Number(req.headers["content-length"] ?? 0) > limit) {
    req.resume();
    throw tooLarge;
  }
  // Read to the end even past the limit, so the client still receives the 413 on an open connection.
  const raw = await new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
  if (raw === null) throw tooLarge;
  const mediaType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (raw.length > 0 && mediaType !== "application/json") {
    throw new ApiError("unsupported_media_type", "Send the request body as application/json.");
  }
  const origin = req.headers.origin;
  if (method !== "GET" && method !== "HEAD" && origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
    throw new ApiError("cross_origin", "Keelson accepts changes only from its own origin.");
  }
  return raw;
}

/** The parsed JSON body; a body that is not JSON is a validation error. */
export function body(ctx: Ctx): unknown {
  if (ctx.raw.length === 0) return {};
  try {
    return JSON.parse(ctx.raw.toString("utf8"));
  } catch {
    throw invalid({ body: "Send a JSON object." });
  }
}

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
const CLIENT_ROUTES = [/^\/sign-in$/, /^\/projects\/[^/]+$/, /^\/projects\/[^/]+\/windows$/, /^\/approvals\/[^/]+$/];
const ASSET = /^\/assets\/[A-Za-z0-9._-]+\.(js|css|woff2)$/;
const TYPES: Record<string, string> = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", woff2: "font/woff2" };

/** The built client: index.html for the four client routes and hashed files under /assets. */
export async function clientFile(pathname: string): Promise<Reply | null> {
  if (CLIENT_ROUTES.some((route) => route.test(pathname))) {
    const bytes = await readFile(path.join(CLIENT_DIR, "index.html"));
    return { status: 200, bytes, headers: { "Content-Type": "text/html; charset=utf-8" } };
  }
  const asset = ASSET.exec(pathname);
  if (!asset) return null;
  try {
    const bytes = await readFile(path.join(CLIENT_DIR, pathname));
    return { status: 200, bytes, headers: { "Content-Type": TYPES[asset[1] ?? ""] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" } };
  } catch {
    return null;
  }
}
