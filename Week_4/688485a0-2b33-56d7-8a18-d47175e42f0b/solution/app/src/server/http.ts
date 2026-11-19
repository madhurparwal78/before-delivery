import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonObject, JsonValue } from "../shared/json.js";
import { isObject } from "../shared/json.js";
import { config } from "./config.js";
import { ApiError, fail } from "./errors.js";

/** The HTTP boundary: routing, body limits, content-type rule and the one error shape. */

export const STREAMED = Symbol("streamed");

interface Reply {
  status: number;
  body?: JsonValue;
  raw?: Buffer;
  type?: string;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The request body bytes, already size-checked. */
  bytes: Buffer;
  /** The body parsed as a JSON object. */
  object(): JsonObject;
  cookie(name: string): string | undefined;
}

export type Handler = (ctx: Ctx) => Promise<Reply | typeof STREAMED>;
type BodyKind = "json" | "grading" | "file";

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  kind: BodyKind;
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, kind: BodyKind = "json"): void {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, kind, handler });
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DRAIN_CAP = 100_000_000;

async function readBody(req: IncomingMessage, limit: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  let drained = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      tooLarge = true;
      drained += chunk.length;
      if (drained > DRAIN_CAP) req.destroy();
    } else {
      chunks.push(chunk);
    }
  }
  return { bytes: Buffer.concat(chunks), tooLarge };
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...reply.headers };
  if (reply.raw !== undefined) {
    headers["content-type"] = reply.type ?? "application/octet-stream";
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
  } else if (reply.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    res.writeHead(reply.status, headers);
    res.end(JSON.stringify(reply.body));
  } else {
    res.writeHead(reply.status, headers);
    res.end();
  }
}

export const sendError = (res: ServerResponse, error: ApiError): void => send(res, { status: error.status, body: error.body() });

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams): Promise<void> {
  const method = req.method ?? "GET";
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = candidate.pattern.exec(pathname);
    if (found) {
      matched = { route: candidate, params: Object.fromEntries(candidate.keys.map((key, index) => [key, decodeURIComponent(found[index + 1] ?? "")])) };
      break;
    }
  }
  const kind = matched?.route.kind ?? "json";
  const limit = config.bodyLimits[kind];
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] === "chunked";
  const { bytes, tooLarge } = hasBody ? await readBody(req, limit) : { bytes: Buffer.alloc(0), tooLarge: false };
  try {
    if (tooLarge) fail("too_large", { limit });
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (hasBody && WRITES.has(method) && kind !== "file" && type !== "application/json") fail("unsupported_media_type");
    if (!matched) fail("not_found");
    const cookies = parseCookies(req.headers.cookie);
    const ctx: Ctx = {
      req,
      res,
      params: matched.params,
      query,
      bytes,
      object() {
        try {
          const parsed = JSON.parse(bytes.toString("utf8")) as JsonValue;
          if (isObject(parsed)) return parsed;
        } catch {
          /* falls through to the refusal below */
        }
        return fail("invalid_field", { field: "body" });
      },
      cookie: (name) => cookies.get(name),
    };
    const reply = await matched.route.handler(ctx);
    if (reply !== STREAMED) send(res, reply);
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    sendError(res, new ApiError("internal_error"));
  }
}
