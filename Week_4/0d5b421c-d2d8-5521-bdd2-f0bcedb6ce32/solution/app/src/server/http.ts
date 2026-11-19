// The request pipeline. Errors are chosen by the published precedence, first match wins:
// 1 body size, media type, JSON, idempotency key  2 cross origin  3 host session  4 idempotent replay
// 5 not found  6 gone  7 validation  8 state conflicts  9 payment and outages (steps 4 to 9 run in the handlers).
import http from "node:http";
import { ApiError, apiErrors, errorBody } from "./errors.js";
import { runIdempotent, type Reply } from "./idempotency.js";
import { requireHostSession, SESSION_COOKIE } from "./host.js";
import { serveStatic } from "./static.js";

const BODY_LIMIT_BYTES = 16_384;

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req: http.IncomingMessage;
  sessionToken: string | null;
}

export interface JsonRoute {
  method: string;
  path: string;
  host?: boolean;
  keyed?: boolean;
  handler: (context: Context) => Promise<Reply>;
}

export interface StreamRoute {
  method: "GET";
  path: string;
  host?: boolean;
  stream: (context: Context, res: http.ServerResponse) => Promise<void>;
}

export type Route = JsonRoute | StreamRoute;

/** A path segment that is not valid percent-encoding is simply a value that opens nothing. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function compile(path: string): RegExp {
  return new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
}

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([a-z]+)/g)].map((match) => match[1] ?? "");
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        reject(apiErrors.bodyTooLarge());
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Steps 1: 413, 415, 400 malformed_json. */
async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (Number(req.headers["content-length"] ?? 0) > BODY_LIMIT_BYTES) throw apiErrors.bodyTooLarge();
  const raw = await readBody(req);
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) throw apiErrors.unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw apiErrors.malformedJson();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw apiErrors.malformedJson();
  return Object.fromEntries(Object.entries(parsed));
}

function idempotencyKey(req: http.IncomingMessage): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,64}$/.test(key)) throw apiErrors.idempotencyKeyRequired();
  return key;
}

function assertSameOrigin(req: http.IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== req.headers.host) throw apiErrors.crossOrigin();
}

function cookieValue(req: http.IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function send(res: http.ServerResponse, reply: Reply): void {
  const payload = reply.status === 204 || reply.body === undefined ? "" : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    ...(payload === "" ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    ...reply.headers,
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, error: unknown): void {
  const known = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Something went wrong on our side.");
  if (!(error instanceof ApiError)) console.error(error instanceof Error ? error.message : "unexpected failure");
  if (res.headersSent) {
    res.end();
    return;
  }
  send(res, { status: known.status, body: errorBody(known), headers: known.status === 413 ? { Connection: "close" } : {} });
}

export function createApp(routes: Route[]): http.Server {
  const compiled = routes.map((route) => ({ route, pattern: compile(route.path), names: paramNames(route.path) }));

  async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://app.invalid");
    const method = req.method ?? "GET";
    if (!url.pathname.startsWith("/api/")) {
      serveStatic(method, url.pathname, res);
      return;
    }
    const found = compiled.find((candidate) => candidate.route.method === method && candidate.pattern.test(url.pathname));
    if (found === undefined) throw apiErrors.notFound();
    const { route } = found;
    const values = found.pattern.exec(url.pathname)?.slice(1) ?? [];
    const params = Object.fromEntries(found.names.map((name, index) => [name, decodeSegment(values[index] ?? "")]));
    // A NUL byte opens nothing and Postgres refuses it in text, so the address is simply not found.
    if (Object.values(params).some((value) => value.includes("\u0000"))) throw apiErrors.notFound();
    const hasBody = method === "POST" || method === "PUT";
    const body = hasBody ? await parseJsonBody(req) : {};
    const key = "keyed" in route && route.keyed === true ? idempotencyKey(req) : null;
    if (method !== "GET") assertSameOrigin(req);
    const sessionToken = cookieValue(req, SESSION_COOKIE);
    if (route.host === true) await requireHostSession(sessionToken);
    const context: Context = { params, query: url.searchParams, body, req, sessionToken };
    if ("stream" in route) {
      await route.stream(context, res);
      return;
    }
    const reply =
      key === null
        ? await route.handler(context)
        : await runIdempotent(key, method, url.pathname, body, () => route.handler(context));
    send(res, reply);
  }

  return http.createServer((req, res) => {
    dispatch(req, res).catch((error: unknown) => sendError(res, error));
  });
}
