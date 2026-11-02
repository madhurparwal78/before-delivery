import type { IncomingMessage, ServerResponse } from "node:http";
import { actorForToken, type Actor } from "./auth.ts";
import { ApiError, forbidden, inPrecedence, internalError, invalid, notFound, payloadTooLarge, unauthenticated } from "./errors.ts";

const JSON_LIMIT = 1_000_000;
export const MULTIPART_LIMIT = 6_000_000;
const MAX_DEPTH = 20;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  token: string | undefined;
  /** Present on every route that needs a session. */
  actor: Actor;
  raw: Buffer;
  /** The parsed JSON body; throws the published 422 when it is malformed or nested too deeply. */
  json(): Record<string, unknown>;
}

export interface Route {
  method: string;
  pattern: string;
  /** Anyone may call it (sign-in, health). */
  open?: boolean;
  /** The handler reads the body itself (multipart verify), after the session check. */
  streamsBody?: boolean;
  handler(ctx: Context): Promise<Reply | null>;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function depth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  let deepest = 0;
  for (const child of children) deepest = Math.max(deepest, depth(child));
  return 1 + deepest;
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => !failed && resolve(Buffer.concat(chunks)));
    req.on("error", (error) => !failed && ((failed = true), reject(error)));
    req.on("aborted", () => !failed && ((failed = true), reject(new Error("client aborted"))));
  });
}

function declaredTooLarge(req: IncomingMessage, limit: number): boolean {
  const length = Number(req.headers["content-length"] ?? 0);
  return Number.isFinite(length) && length > limit;
}

/** A request from another site cannot change data. */
function crossSite(req: IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof ApiError) {
    send(res, { status: error.status, body: error.body(), headers: error.headers });
    return;
  }
  console.error(error);
  const internal = internalError();
  send(res, { status: internal.status, body: internal.body() });
}

interface Compiled {
  route: Route;
  parts: string[];
}

export class Router {
  private readonly routes: Compiled[] = [];

  add(...routes: Route[]): void {
    for (const route of routes) this.routes.push({ route, parts: route.pattern.split("/").slice(1) });
  }

  match(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
    for (const { route, parts } of this.routes) {
      if (route.method !== method || parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        if (parts[i].startsWith(":")) params[parts[i].slice(1)] = segments[i];
        else ok = parts[i] === segments[i];
      }
      if (ok) return { route, params };
    }
    return null;
  }

  /** Supplies the generic checks (body size, session, cross-site writes) to the one precedence order. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    let segments: string[];
    try {
      segments = url.pathname.split("/").slice(1).map((s) => decodeURIComponent(s));
    } catch {
      sendError(res, notFound());
      return;
    }
    const found = this.match(req.method ?? "GET", segments);
    if (!found) {
      sendError(res, notFound());
      return;
    }
    const { route, params } = found;
    try {
      const limit = route.streamsBody ? MULTIPART_LIMIT : JSON_LIMIT;
      const token = parseCookies(req.headers.cookie).strata_session;
      let raw: Buffer = Buffer.alloc(0);
      let actor = null as Actor | null;
      await inPrecedence({
        async size() {
          if (declaredTooLarge(req, limit)) {
            res.setHeader("Connection", "close");
            throw payloadTooLarge();
          }
          if (!route.streamsBody) raw = await readBody(req, limit);
        },
        async session() {
          actor = route.open ? null : await actorForToken(token);
          if (!route.open && !actor) {
            if (route.streamsBody) res.setHeader("Connection", "close");
            throw unauthenticated();
          }
        },
        permission() {
          if (WRITE_METHODS.has(req.method ?? "") && crossSite(req)) throw forbidden();
        },
      });
      let parsed: Record<string, unknown> | undefined;
      const ctx: Context = {
        req, res, url, params, token, raw,
        actor: actor as Actor,
        json() {
          if (parsed) return parsed;
          let value: unknown;
          try {
            value = raw.length ? JSON.parse(raw.toString("utf8")) : {};
          } catch {
            throw invalid({});
          }
          if (depth(value) > MAX_DEPTH) throw invalid({}, "Request body is nested too deeply.");
          parsed = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
          return parsed;
        },
      };
      const reply = await route.handler(ctx);
      if (reply) send(res, reply);
    } catch (error) {
      sendError(res, error);
    }
  }
}
