// The HTTP layer: routing, body limits, the one error exit and server-sent streams.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiError, errors } from "./errors";
import { config, JSON_BODY_MAX } from "./config";
import { isDatabaseDown } from "./db";
import { StorageUnavailable } from "./storage";
import { readMultipart, type UploadedFile } from "./multipart";

type BodyKind = "json" | "ndjson" | "multipart" | "none";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Buffer;
  file: UploadedFile | null;
  fields: Record<string, string>;
  /** The JSON body as an object; a body that is not one is a validation error. */
  json(): Record<string, unknown>;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

export const reply = (status: number, body?: unknown, headers?: Record<string, string | string[]>): Reply => ({ status, body, headers });
export const ok = (body: unknown): Reply => reply(200, body);

export const STREAMED = Symbol("streamed");
type Handler = (ctx: Ctx) => Promise<Reply | typeof STREAMED>;

interface Route {
  method: string;
  matcher: RegExp;
  names: string[];
  body: BodyKind;
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, body: BodyKind, handler: Handler): void {
  const names: string[] = [];
  const source = pattern.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, matcher: new RegExp(`^${source}$`), names, body, handler });
}

const DRAIN_CAP = 64 * 1024 * 1024;
const MULTIPART_OVERHEAD = 16 * 1024;

async function readBody(req: IncomingMessage, limit: number): Promise<{ data: Buffer; over: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) over = true;
    if (!over) chunks.push(chunk);
    if (size > DRAIN_CAP) {
      over = true;
      break;
    }
  }
  return { data: Buffer.concat(chunks), over };
}

function contentType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function receive(ctx: Ctx, kind: BodyKind): Promise<void> {
  const { req } = ctx;
  if (kind === "none") {
    await readBody(req, 0);
    return;
  }
  if (kind === "json") {
    const { data, over } = await readBody(req, JSON_BODY_MAX);
    if (over) throw errors.bodyTooLarge(JSON_BODY_MAX);
    ctx.body = data;
    return;
  }
  const limit = config.settings.uploadMaxBytes;
  const wrongKind = kind === "ndjson" ? contentType(req) !== "application/x-ndjson" : contentType(req) !== "multipart/form-data";
  const { data, over } = await readBody(req, kind === "ndjson" ? limit : limit + MULTIPART_OVERHEAD);
  if (wrongKind) throw errors.uploadKind();
  if (over) throw errors.uploadTooLarge(limit);
  if (kind === "ndjson") {
    ctx.body = data;
    return;
  }
  const parsed = readMultipart(data, req.headers["content-type"] ?? "");
  ctx.file = parsed.file;
  ctx.fields = parsed.fields;
  if (parsed.file) {
    if (parsed.file.content.length > limit) throw errors.uploadTooLarge(limit);
    if (!isNdjsonFile(parsed.file)) throw errors.uploadKind();
  }
}

/** A file is accepted when its name ends in .ndjson, it is UTF-8 without NUL, and its first non-space character is `{`. */
function isNdjsonFile(file: UploadedFile): boolean {
  if (!/\.ndjson$/i.test(file.name) || file.content.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    return false;
  }
  return text.trimStart().startsWith("{");
}

function send(res: ServerResponse, result: Reply): void {
  const payload = result.body === undefined ? "" : JSON.stringify(result.body);
  const headers: Record<string, string | string[] | number> = { ...result.headers };
  if (result.body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  headers["content-length"] = Buffer.byteLength(payload);
  headers["cache-control"] = "no-store";
  res.writeHead(result.status, headers);
  res.end(payload);
}

function failure(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) return errors.storageUnavailable();
  if (isDatabaseDown(error)) return errors.databaseUnavailable();
  console.error(error);
  return new ApiError(500, "internal", "Something went wrong on the server.");
}

function sendError(res: ServerResponse, error: unknown): void {
  const api = failure(error);
  if (res.headersSent) {
    res.end();
    return;
  }
  const headers: Record<string, string> = {};
  if (api.extra.retryAfter !== undefined) headers["retry-after"] = String(api.extra.retryAfter);
  send(res, reply(api.status, api.body(), headers));
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.matcher.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    candidate.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? "");
    });
    const ctx: Ctx = {
      req, res, method, path: url.pathname, params, query: url.searchParams, body: Buffer.alloc(0), file: null, fields: {},
      json() {
        let parsed: unknown;
        try {
          parsed = JSON.parse(this.body.toString("utf8"));
        } catch {
          throw errors.invalid({ body: "Send a JSON object." });
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw errors.invalid({ body: "Send a JSON object." });
        return parsed as Record<string, unknown>;
      },
    };
    await receive(ctx, candidate.body);
    const result = await candidate.handler(ctx);
    if (result !== STREAMED) send(res, result);
    return;
  }
  await readBody(req, 0);
  throw errors.notFound();
}

interface EventStream {
  send(event: string, data: unknown, id?: number): void;
  onClose(callback: () => void): void;
}

/** Opens a text/event-stream with a comment heartbeat; the stream stops its work when the client disconnects. */
export function openStream(ctx: Ctx): EventStream {
  const { req, res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  const closers: Array<() => void> = [];
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), config.settings.sseHeartbeatMs);
  req.on("close", () => {
    clearInterval(heartbeat);
    for (const close of closers) close();
  });
  return {
    send(event, data, id) {
      res.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(callback) {
      closers.push(callback);
    },
  };
}

export function createHttpServer(handle: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://spoorline.local");
    handle(req, res, url).catch((error: unknown) => sendError(res, error));
  });
}
