// The server boundary and the one error path (brief: API, Error shape and check order; Server boundary).
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { first, pool } from "./db.js";
import { PART_SIZE, type Person } from "../shared/api.js";

/** Every refusal leaves the server as one of these and is written by `sendError`. */
export class Fail extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}

const tooLarge = () => new Fail(413, { error: "too_large" });
const unsupportedMedia = () => new Fail(415, { error: "unsupported_media_type" });
const crossOrigin = () => new Fail(403, { error: "cross_origin" });
const unauthenticated = () => new Fail(401, { error: "unauthenticated" });
export const notFound = () => new Fail(404, { error: "not_found" });
export const forbidden = () => new Fail(403, { error: "forbidden" });
export const conflict = (error: string, extra: Record<string, unknown> = {}) => new Fail(409, { error, ...extra });
export const invalid = (fields: Record<string, string>) => new Fail(422, { error: "validation", fields });
export const storageUnavailable = () => new Fail(503, { error: "storage_unavailable" });
export const directoryUnavailable = () => new Fail(503, { error: "directory_unavailable" });

const JSON_LIMIT = 65_536;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const SESSION_COOKIE = "lintel_session";

interface Session {
  tokenHash: string;
  person: Person;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  raw: Buffer | null;
  session: Session;
}

type Handler = (ctx: Ctx) => Promise<void>;
type PublicHandler = (ctx: Omit<Ctx, "session">) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  binary: boolean;
  handler: { auth: true; run: Handler } | { auth: false; run: PublicHandler };
}

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_m, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function route(method: string, path: string, run: Handler, options: { binary?: boolean } = {}): void {
  routes.push({ method, ...compile(path), binary: options.binary ?? false, handler: { auth: true, run } });
}

export function publicRoute(method: string, path: string, run: PublicHandler): void {
  routes.push({ method, ...compile(path), binary: false, handler: { auth: false, run } });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function sessionOf(req: IncomingMessage): Promise<Session | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await first<{ person: Person }>(pool, "SELECT person FROM sessions WHERE token_hash = $1", [tokenHash]);
  return row ? { tokenHash, person: row.person } : null;
}

function ownOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? ""}`;
}

/** A write from another origin is refused (an absent Origin header is a same-origin or non-browser client). */
export function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin !== undefined && origin !== ownOrigin(req);
}

/** Reads the whole body; null when it is longer than `limit` (the rest is drained so the reply can be read). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    req.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(length > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status = 204, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end();
}

/** The one error path: every refusal, API or page, leaves here. */
export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof Fail) {
    sendJson(res, error.status, error.body);
    return;
  }
  console.error("request failed:", error instanceof Error ? error.message : error);
  sendJson(res, 500, { error: "internal" });
}

/** Steps 1–3 of the check order run here; each handler runs steps 4–9 in the same order. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const method = req.method ?? "GET";
    let params: Record<string, string> = {};
    const match = routes.find((r) => {
      if (r.method !== method) return false;
      const found = r.pattern.exec(url.pathname);
      if (!found) return false;
      params = Object.fromEntries(r.keys.map((key, i) => [key, decodeURIComponent(found[i + 1] ?? "")]));
      return true;
    });
    const declared = Number(req.headers["content-length"] ?? 0);
    const hasBody = declared > 0 || req.headers["transfer-encoding"] !== undefined;
    let body: unknown = undefined;
    let raw: Buffer | null = null;
    if (hasBody) {
      const binary = match?.binary ?? false;
      const data = await readBody(req, binary ? PART_SIZE : JSON_LIMIT);
      if (data === null) throw tooLarge();
      if (mediaType(req.headers["content-type"]) !== (binary ? "application/octet-stream" : "application/json")) throw unsupportedMedia();
      if (binary) raw = data;
      else if (data.length) {
        try {
          body = JSON.parse(data.toString("utf8"));
        } catch {
          body = Symbol.for("unparsable");
        }
      }
    } else {
      req.resume();
    }
    if (WRITES.has(method) && foreignOrigin(req)) throw crossOrigin();
    if (match?.handler.auth === false) {
      await match.handler.run({ req, res, url, params, body, raw });
      return;
    }
    const session = await sessionOf(req);
    if (!session) throw unauthenticated();
    if (!match) throw notFound();
    if (typeof body === "symbol") throw invalid({ body: "Send a JSON object." });
    await match.handler.run({ req, res, url, params, body, raw, session });
  } catch (error) {
    sendError(res, error);
  }
}

/** The JSON body as a plain object (an absent body reads as empty, so field checks report what is missing). */
export function bodyObject(ctx: { body: unknown }): Record<string, unknown> {
  const body = ctx.body;
  if (body === undefined) return {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid({ body: "Send a JSON object." });
  return body as Record<string, unknown>;
}
