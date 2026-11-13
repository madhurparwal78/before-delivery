import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { ApiError, errorBody } from "./errors.js";
import type { RawFields } from "./facts.js";
import { contentHash, readKey, recordSuccess, releaseHold, takeHold } from "./idempotency.js";

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 16_000_000;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The `:name` parameters a route path declares, e.g. `"id"` for `/api/reels/:id/stops`. */
type ParamsOf<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamsOf<`/${Rest}`>
  : Path extends `${string}:${infer Name}`
    ? Name
    : never;

interface Context<Param extends string = string> {
  method: string;
  path: string;
  params: Record<Param, string>;
  search: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** The parsed JSON body; empty when the request has none. */
  json: RawFields;
  /** The parsed multipart body; null when the request is not multipart. */
  form: FormData | null;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export type Handler<Param extends string = string> = (context: Context<Param>) => Promise<Reply>;

/** An endpoint that takes an Idempotency-Key: what makes two requests "the same content", and the resource that must exist first. */
export interface Idempotent<Param extends string = string> {
  content: (context: Context<Param>) => Promise<readonly (string | Uint8Array)[]>;
  resource?: (context: Context<Param>) => Promise<void>;
}

export interface Route {
  method: string;
  body: "json" | "multipart" | "none";
  /** The route's parameters for a path, or null when the path is not this route's. */
  match: (pathname: string) => Record<string, string> | null;
  handler: Handler;
  idempotent: Idempotent | null;
}

export function route<Path extends string>(
  method: string,
  path: Path,
  body: Route["body"],
  handler: Handler<ParamsOf<Path>>,
  idempotent: Idempotent<ParamsOf<Path>> | null = null,
): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:(\w+)/g, (_match, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  const match = (pathname: string): Record<ParamsOf<Path>, string> | null => {
    const found = pattern.exec(pathname);
    if (!found) return null;
    // The pattern has exactly one capture group per declared key, so every key of ParamsOf<Path> is filled.
    // An id that is not valid percent-encoding, or that decodes to a NUL byte, names nothing (and
    // Postgres rejects NUL in text), so the path is not this route's and the request ends in a 404.
    const values: string[] = [];
    for (let index = 0; index < keys.length; index++) {
      let value: string;
      try {
        value = decodeURIComponent(found[index + 1] as string);
      } catch {
        return null;
      }
      if (value.includes("\u0000")) return null;
      values.push(value);
    }
    return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<ParamsOf<Path>, string>;
  };
  // A route only ever receives the params its own `match` produced, which carry every key its path declares.
  return { method, body, match, handler: handler as Handler, idempotent: idempotent as Idempotent | null };
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function parseForm(body: Buffer, contentType: string): Promise<FormData> {
  try {
    return await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
  } catch {
    return new FormData();
  }
}

const mediaType = (header: string | undefined): string => (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

/** The request target split into its path and query, exactly as sent. */
export function splitTarget(target: string): { pathname: string; search: URLSearchParams } {
  const query = target.indexOf("?");
  return query < 0
    ? { pathname: target, search: new URLSearchParams() }
    : { pathname: target.slice(0, query), search: new URLSearchParams(target.slice(query + 1)) };
}

/**
 * The published error precedence for the whole API, decided here and nowhere else: origin, size,
 * media type, JSON, route and resource (404), then for idempotent endpoints the key, a replay, the
 * hold and the content; the handler then raises state conflicts before validation before storage.
 */
export async function answer(request: IncomingMessage, routes: readonly Route[], target: string): Promise<Reply> {
  const method = request.method ?? "GET";
  if (WRITE_METHODS.has(method) && !sameOrigin(request)) throw new ApiError("cross_origin");
  const type = mediaType(request.headers["content-type"]);
  const hasBody = WRITE_METHODS.has(method);
  const limit = type === "multipart/form-data" ? MULTIPART_LIMIT : JSON_LIMIT;
  const body = hasBody ? await readBody(request, limit) : Buffer.alloc(0);
  if (body === null) throw new ApiError("too_large");

  const { pathname, search } = splitTarget(target);
  const routeMethod = method === "HEAD" ? "GET" : method;
  const matched = routes.find((candidate) => candidate.method === routeMethod && candidate.match(pathname) !== null);
  if (body.length > 0 && type !== "application/json" && type !== "multipart/form-data") throw new ApiError("unsupported_media_type");
  if (matched && body.length > 0 && matched.body !== (type === "application/json" ? "json" : "multipart")) {
    throw new ApiError("unsupported_media_type");
  }
  let json: RawFields = {};
  if (body.length > 0 && type === "application/json") {
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) json = parsed as RawFields;
    } catch {
      throw new ApiError("malformed_json");
    }
  }
  const params = matched?.match(pathname);
  if (!matched || !params) throw new ApiError("not_found");
  const form = type === "multipart/form-data" ? await parseForm(body, request.headers["content-type"] ?? "") : null;
  const context: Context = { method, path: pathname, params, search, headers: request.headers, json, form };
  if (!matched.idempotent) return matched.handler(context);

  await matched.idempotent.resource?.(context);
  const scope = { key: readKey(context.headers["idempotency-key"]), method, path: pathname };
  const recorded = await takeHold(scope, contentHash(await matched.idempotent.content(context)));
  if (recorded) return { status: recorded.status, json: recorded.body, headers: { "Idempotent-Replay": "true" } };
  try {
    const reply = await matched.handler(context);
    await recordSuccess(scope, { status: reply.status, body: reply.json });
    return reply;
  } catch (error) {
    await releaseHold(scope);
    throw error;
  }
}

export function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | number> = { "cache-control": "no-store", ...reply.headers };
  const payload = reply.bytes ?? Buffer.from(JSON.stringify(reply.json ?? {}));
  headers["content-type"] = reply.contentType ?? "application/json; charset=utf-8";
  headers["content-length"] = payload.length;
  response.writeHead(reply.status, headers);
  response.end(payload);
}

export function failure(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, json: errorBody(error) };
  console.error(error);
  const internal = new ApiError("internal_error");
  return { status: internal.status, json: errorBody(internal) };
}
