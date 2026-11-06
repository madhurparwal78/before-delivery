// The request boundary: body limits, content types, the route table, JSON responses and the built browser
// assets. Every refusal leaves through `errorBody`, in the published precedence.

import { reason } from "./log";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, errorBody, fail } from "./errors";

const JSON_LIMIT = 65_536;
export const UPLOAD_LIMIT = 10_000_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

type BodyKind = "none" | "json" | "image";

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  params: Record<string, string>;
  json: unknown;
  image: { type: ImageType; bytes: Buffer } | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  text?: string;
}

type Handler = (req: Req) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  body: BodyKind;
  handler: Handler;
}

const routes: Route[] = [];

/** Registers a route; `{name}` segments become params. */
export function route(method: string, path: string, body: BodyKind, handler: Handler): void {
  const names: string[] = [];
  const source = path.replace(/\{(\w+)\}/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, body, handler });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

export const noContent: Reply = { status: 204 };

/** BigInt amounts serialise as JSON integers (every amount is far inside the safe-integer range). */
export function stringify(body: unknown): string {
  return JSON.stringify(body, (_, value: unknown) => (typeof value === "bigint" ? Number(value) : value));
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.status === 204) {
    res.writeHead(204, headers).end();
    return;
  }
  if (reply.text !== undefined) {
    res.writeHead(reply.status, headers).end(reply.text);
    return;
  }
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers }).end(stringify(reply.body));
}

/** Reads the whole body, keeping at most `limit + 1` bytes so an oversized body is detected without buffering it. */
async function readBody(req: IncomingMessage, limit: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit + 1) chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), tooLarge: size > limit };
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

/** Step 1 of the precedence: size, content type, JSON syntax. */
async function boundary(req: IncomingMessage, kind: BodyKind): Promise<Pick<Req, "json" | "image">> {
  if (kind === "image") {
    const { bytes, tooLarge } = await readBody(req, UPLOAD_LIMIT);
    if (tooLarge) fail("payload_too_large");
    const type = IMAGE_TYPES.find((t) => t === mediaType(req));
    if (!type || sniffImage(bytes) !== type) fail("unsupported_media_type");
    return { json: null, image: { type, bytes } };
  }
  const { bytes, tooLarge } = await readBody(req, JSON_LIMIT);
  if (tooLarge) fail("payload_too_large");
  if (kind === "none") return { json: null, image: null };
  if (mediaType(req) !== "application/json") fail("unsupported_media_type");
  try {
    return { json: JSON.parse(bytes.toString("utf8")) as unknown, image: null };
  } catch {
    return fail("malformed_json");
  }
}

/** The image type its leading bytes declare, or null. */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// ---- built browser assets ----------------------------------------------------------------------

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};
const SCREEN_PATHS = new Set(["/", "/run", "/jobs", "/library", "/webhooks", "/finance", "/admin"]);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const assets = new Map(
  listFiles(PUBLIC_DIR)
    .filter((file) => CONTENT_TYPES[extname(file)])
    .map((file) => [`/${relative(PUBLIC_DIR, file).split("\\").join("/")}`, readFileSync(file)]),
);
const shell = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---- dispatch --------------------------------------------------------------------------------

type ShellZone = () => Promise<string>;

export function createHandler(orgZone: ShellZone) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://dispatch.invalid");
    const method = req.method ?? "GET";
    try {
      if (!url.pathname.startsWith("/api/")) {
        await serveStatic(method, url.pathname, res, orgZone);
        return;
      }
      for (const r of routes) {
        const match = r.method === method ? r.pattern.exec(url.pathname) : null;
        if (!match) continue;
        const params = Object.fromEntries(r.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
        const body = await boundary(req, r.body);
        send(res, await r.handler({ method, path: url.pathname, query: url.searchParams, headers: req.headers, params, ...body }));
        return;
      }
      req.resume();
      fail("not_found");
    } catch (error) {
      if (error instanceof ApiError) {
        req.resume();
        send(res, json(error.status, errorBody(error)));
        return;
      }
      console.error(`request ${method} ${url.pathname} failed: ${reason(error)}`);
      send(res, json(500, errorBody(new ApiError("internal_error"))));
    }
  };
}

async function serveStatic(method: string, path: string, res: ServerResponse, orgZone: ShellZone): Promise<void> {
  const found = assets.get(path);
  if ((method === "GET" || method === "HEAD") && found) {
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(path)],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    }).end(method === "HEAD" ? undefined : found);
    return;
  }
  if ((method === "GET" || method === "HEAD") && SCREEN_PATHS.has(path)) {
    const page = shell.replace("__ORG_TIMEZONE__", escapeAttribute(await orgZone()));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    }).end(method === "HEAD" ? undefined : page);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }).end("Not found");
}
