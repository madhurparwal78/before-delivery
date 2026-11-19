import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorBody } from "../shared/api.js";

// One error shape for the whole API: {"error": code} plus "fields" on a 422.
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly fields?: Record<string, string>) {
    super(code);
  }

  body(): ApiErrorBody {
    return this.fields ? { error: this.code, fields: this.fields } : { error: this.code };
  }
}

export function fail(status: number, code: string): never {
  throw new ApiError(status, code);
}

export function invalid(fields: Record<string, string>): never {
  throw new ApiError(422, "invalid", fields);
}

/** A loggable description of a failure that never includes a message, which may name a host. */
export function describe(error: unknown): string {
  const e = error as { code?: string; name?: string };
  return e.code ?? e.name ?? "error";
}

export function notFound(): never {
  throw new ApiError(404, "not_found");
}

export interface Req {
  method: string;
  params: string[];
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  json: Record<string, unknown>;
  bytes: Buffer;
}

type Reply =
  | { status: number; json?: unknown }
  | { status: number; data: Buffer; type: string; filename?: string };

type BodyKind = "json" | "image" | "none";

interface Route {
  method: string;
  pattern: RegExp;
  body: BodyKind;
  handler: (req: Req) => Promise<Reply>;
}

const JSON_LIMIT = 65_536;
const IMAGE_LIMIT = 5_000_000;
const DISCARD_LIMIT = 12_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const routes: Route[] = [];

/** Registers an /api route; `:id` segments become params. */
export function route(method: string, path: string, handler: Route["handler"], body: BodyKind = "json"): void {
  const pattern = new RegExp(`^${path.replaceAll(".", "\\.").replace(/:[a-z]+/g, "([A-Za-z0-9_-]{1,128})")}$`);
  routes.push({ method, pattern, body, handler });
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? Number.NaN);
  const chunks: Buffer[] = [];
  let size = 0;
  if (declared > DISCARD_LIMIT) {
    req.resume();
    return null;
  }
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
    if (size > DISCARD_LIMIT) break;
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function mediaType(req: IncomingMessage): string {
  return String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

async function parse(req: IncomingMessage, kind: BodyKind): Promise<{ json: Record<string, unknown>; bytes: Buffer }> {
  if (kind === "none" || req.method === "GET" || req.method === "DELETE") {
    req.resume();
    return { json: {}, bytes: Buffer.alloc(0) };
  }
  const bytes = await readBody(req, kind === "image" ? IMAGE_LIMIT : JSON_LIMIT);
  if (!bytes) fail(413, "too_large");
  const type = mediaType(req);
  if (kind === "image") {
    if (!IMAGE_TYPES.has(type)) fail(415, "unsupported_media_type");
    return { json: {}, bytes };
  }
  if (!bytes.length && !type) return { json: {}, bytes };
  if (type !== "application/json") fail(415, "unsupported_media_type");
  let value: unknown;
  let hasNul = false;
  try {
    // Postgres text cannot hold U+0000; refuse it up front instead of failing in the insert.
    value = bytes.length
      ? JSON.parse(bytes.toString("utf8"), (key, item: unknown) => {
          if (key.includes("\u0000") || (typeof item === "string" && item.includes("\u0000"))) hasNul = true;
          return item;
        })
      : {};
  } catch {
    fail(400, "bad_json");
  }
  if (hasNul) invalid({ body: "Text cannot contain a null character." });
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(400, "bad_json");
  return { json: value as Record<string, unknown>, bytes };
}

function send(res: ServerResponse, reply: Reply): void {
  if ("data" in reply) {
    const headers: Record<string, string | number> = { "Content-Type": reply.type, "Content-Length": reply.data.length };
    if (reply.filename) headers["Content-Disposition"] = `attachment; filename="${reply.filename}"`;
    res.writeHead(reply.status, headers).end(reply.data);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status).end();
    return;
  }
  const text = JSON.stringify(reply.json);
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(text);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
  try {
    const found = routes
      .map((r) => ({ r, m: r.method === req.method ? r.pattern.exec(path) : null }))
      .find((x) => x.m);
    if (!found?.m) {
      req.resume();
      notFound();
    }
    const { json, bytes } = await parse(req, found.r.body);
    const reply = await found.r.handler({
      method: req.method ?? "GET",
      params: found.m.slice(1),
      query,
      headers: req.headers,
      json,
      bytes,
    });
    send(res, reply);
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, json: error.body() });
      return;
    }
    console.error(`unhandled ${req.method} ${path}: ${describe(error)}`);
    send(res, { status: 500, json: { error: "internal" } });
  }
}
