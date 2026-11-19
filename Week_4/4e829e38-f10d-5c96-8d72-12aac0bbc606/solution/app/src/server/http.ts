import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";

/** One error shape for the whole API: `{"error": code}` or `{"errors": {field: message}}`. */
export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>, public headers: Record<string, string> = {}) {
    super(JSON.stringify(body));
  }
}

export const unauthenticated = () => new ApiError(401, { error: "unauthenticated" });
export const notFound = () => new ApiError(404, { error: "not_found" });
export const forbidden = () => new ApiError(403, { error: "forbidden" });
export const storageUnavailable = () => new ApiError(503, { error: "storage_unavailable" });
export const invalid = (errors: Record<string, string>) => new ApiError(422, { errors });

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Filled by the router after the 401 check for routes that need a person. */
  personId: string;
}

const TOO_LARGE = Symbol("too large");
const BAD_JSON = Symbol("bad json");

type RawBody = Buffer | typeof TOO_LARGE;

export async function readRaw(req: IncomingMessage, cap: number): Promise<RawBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= cap) chunks.push(chunk);
  }
  return size > cap ? TOO_LARGE : Buffer.concat(chunks);
}

/** Reads the JSON body: 413 when over the cap; an unreadable body is reported later by `fields`. */
export async function readJson(ctx: Ctx, cap: number = config.jsonBodyBytes): Promise<unknown> {
  const raw = await readRaw(ctx.req, cap);
  if (raw === TOO_LARGE) throw new ApiError(413, { error: "body_too_large" });
  if (raw.length === 0) return BAD_JSON;
  try {
    return JSON.parse(raw.toString("utf8"), (key, value) => {
      if (key.includes("\0") || (typeof value === "string" && value.includes("\0"))) throw BAD_JSON;
      return value;
    });
  } catch {
    return BAD_JSON;
  }
}

/** The body as an object; anything else is the 422 "Send a JSON body". */
export function fields(body: unknown): Record<string, unknown> {
  if (body === BAD_JSON || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid({ body: "Send a JSON body" });
  }
  return body as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { "cache-control": "no-store" });
  res.end();
}

type Handler = (ctx: Ctx) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  open: boolean;
  status: number;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: { open?: boolean; status?: number } = {}): void {
  const names: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, handler, open: options.open ?? false, status: options.status ?? 200 });
}

export function findRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (!match) continue;
    try {
      const values = candidate.names.map((_, i) => decodeURIComponent(match[i + 1]));
      // A path value with a NUL byte can never name a record, and the database refuses it: no route.
      if (values.some((v) => v.includes("\0"))) return null;
      return { route: candidate, params: Object.fromEntries(candidate.names.map((n, i) => [n, values[i]])) };
    } catch {
      return null;
    }
  }
  return null;
}


const PARSE_COOKIE = /(?:^|;\s*)everyweek_session=([^;]+)/;

export function sessionToken(req: IncomingMessage): string | null {
  const match = PARSE_COOKIE.exec(req.headers.cookie ?? "");
  return match ? match[1] : null;
}
