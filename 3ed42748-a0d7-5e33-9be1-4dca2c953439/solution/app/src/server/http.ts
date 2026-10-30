// Request plumbing: routing, the front of the error precedence (origin, size, content type,
// session), reply helpers and the published request fields.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";
import { ApiError, INTERNAL_BODY, validation, type Fields } from "./errors";

export const JSON_TYPE = "application/json; charset=utf-8";
const JSON_LIMIT = 16_384;
const PNG_LIMIT = 2_000_000;
const MAX_DEPTH = 32;

export interface Reply {
  status: number;
  body?: string | Buffer;
  type?: string;
  headers?: Record<string, string>;
}

type BodyKind = "json" | "png" | "none";

export interface Ctx {
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  raw: Buffer;
  cookieToken: string | null;
  /** Lazily resolved and cached by the session module. */
  cache: Map<string, unknown>;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface MethodEntry {
  body: BodyKind;
  handler: Handler;
}

interface Route {
  regex: RegExp;
  keys: string[];
  methods: Map<string, MethodEntry>;
  /** For a refused method: does this path answer 401 first when there is no session? */
  needsSession: boolean;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, body: BodyKind, handler: Handler, needsSession = true): void {
  const keys: string[] = [];
  const source = pattern.replace(/:([a-z_]+)(\*)?/g, (_m, key: string, rest?: string) => {
    keys.push(key);
    return rest ? "(.+)" : "([^/]+)";
  });
  const regex = new RegExp(`^${source}$`);
  let entry = routes.find((r) => r.regex.source === regex.source);
  if (!entry) {
    entry = { regex, keys, methods: new Map(), needsSession };
    routes.push(entry);
  }
  entry.methods.set(method, { body, handler });
}

export const json = (status: number, value: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  body: typeof value === "string" ? value : JSON.stringify(value),
  type: JSON_TYPE,
  headers,
});

export const noContent = (headers: Record<string, string> = {}): Reply => ({ status: 204, headers });

// ---- the app's own origins ----

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const given = normaliseOrigin(origin);
  if (!given) return false;
  const own = [normaliseOrigin(config.base)];
  if (req.headers.host) own.push(normaliseOrigin(`http://${req.headers.host}`));
  return own.includes(given);
}

// ---- bodies ----

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? "too_large" : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

function depth(value: unknown): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [node, level] = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    deepest = Math.max(deepest, level);
    if (deepest > MAX_DEPTH) return deepest;
    for (const child of Object.values(node)) stack.push([child, level + 1]);
  }
  return deepest;
}

type BodySpec = { [key: string]: true | BodySpec };

function unknownKeys(value: Record<string, unknown>, spec: BodySpec, prefix: string, out: Fields): void {
  for (const [key, child] of Object.entries(value)) {
    const rule = spec[key];
    const path = prefix + key;
    if (rule === undefined) out[path] = "unknown_field";
    else if (rule !== true && isObject(child)) unknownKeys(child, rule, `${path}.`, out);
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Parses the JSON body; null when it is not valid JSON. A zero-byte body counts as {}. */
export function parsedBody(ctx: Ctx): { value: unknown } | null {
  if (ctx.raw.length === 0) return { value: {} };
  try {
    return { value: JSON.parse(ctx.raw.toString("utf8")) as unknown };
  } catch {
    return null;
  }
}

/** Step 10's gate: the body is a JSON object of published keys only, or the request is refused whole. */
export function publishedBody(ctx: Ctx, spec: BodySpec): Record<string, unknown> {
  const parsed = parsedBody(ctx);
  if (!parsed || !isObject(parsed.value) || depth(parsed.value) > MAX_DEPTH) throw validation({ body: "invalid" });
  const unknown: Fields = {};
  unknownKeys(parsed.value, spec, "", unknown);
  if (Object.keys(unknown).length) throw validation(unknown);
  return parsed.value;
}

// ---- dispatch ----

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "pm_session") return rest.join("=") || null;
  }
  return null;
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  if (reply.type) headers["Content-Type"] = reply.type;
  const body = reply.body ?? "";
  headers["Content-Length"] = String(Buffer.byteLength(body));
  res.writeHead(reply.status, headers);
  res.end(reply.status === 204 ? undefined : body);
}

type Fallback = (ctx: Ctx) => Promise<Reply>;

export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  sessionPresent: (ctx: Ctx) => Promise<boolean>,
  fallback: Fallback,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://bramble.invalid");
    const method = (req.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !originAllowed(req)) {
      req.resume();
      return send(res, json(403, new ApiError(403, "cross_origin").body()));
    }
    let found: { route: Route; params: Record<string, string> } | null = null;
    for (const r of routes) {
      const m = r.regex.exec(url.pathname);
      if (m) {
        const params: Record<string, string> = {};
        try {
          r.keys.forEach((k, i) => {
            const value = decodeURIComponent(m[i + 1] ?? "");
            if (value.includes("\u0000")) throw new URIError("nul in path");
            params[k] = value;
          });
        } catch {
          break; // a malformed escape or a NUL names nothing: the fixed 404 below
        }
        found = { route: r, params };
        break;
      }
    }
    const entry = found?.route.methods.get(method === "HEAD" ? "GET" : method);
    const kind: BodyKind = entry?.body ?? "none";
    const raw = await readBody(req, kind === "png" ? PNG_LIMIT : JSON_LIMIT);
    if (raw === "too_large") return send(res, json(413, new ApiError(413, "too_large").body()));
    const ctx: Ctx = {
      req,
      method,
      path: url.pathname,
      query: url.searchParams,
      params: found?.params ?? {},
      raw,
      cookieToken: cookieToken(req),
      cache: new Map(),
    };
    if (kind === "json" && raw.length > 0 && mediaType(req) !== "application/json")
      return send(res, json(415, new ApiError(415, "unsupported_media_type").body()));
    if (kind === "png" && mediaType(req) !== "image/png")
      return send(res, json(415, new ApiError(415, "unsupported_media_type").body()));
    if (!found) return send(res, await fallback(ctx));
    if (!entry) {
      if (found.route.needsSession && !(await sessionPresent(ctx)))
        return send(res, json(401, new ApiError(401, "unauthenticated").body()));
      return send(res, json(405, new ApiError(405, "method_not_allowed").body()));
    }
    send(res, await entry.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      return send(res, json(error.status, error.body(), error.headers));
    }
    console.error("internal error:", error);
    if (!res.headersSent) send(res, json(500, INTERNAL_BODY));
    else res.destroy();
  }
}
