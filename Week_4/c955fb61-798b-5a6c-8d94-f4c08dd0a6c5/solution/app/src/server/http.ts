import { STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { projectAccess, sessionPerson } from "./auth";
import { settings } from "./config";
import { ApiError, errorBody, notFound } from "./errors";
import { openConnection } from "./live";
import type { Person } from "../shared/types";

const BODY_LIMIT = 100_000;
const DISCARD_LIMIT = 5_000_000;
const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface Context {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Takes over the response (downloads, the live channel). */
  stream?: (res: ServerResponse) => Promise<void> | void;
}

interface SessionContext extends Context {
  person: Person;
}

type Route =
  | { method: string; segments: string[]; access: "session"; handler: (context: SessionContext) => Promise<Reply> }
  | { method: string; segments: string[]; access: "public" | "grading"; handler: (context: Context) => Promise<Reply> };

const routes: Route[] = [];

/** A route that needs a signed-in person. */
export function route(method: string, pattern: string, handler: (context: SessionContext) => Promise<Reply>): void {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), access: "session", handler });
}

/** A route anyone may call; `grading` routes also need the grading key. */
export function openRoute(method: string, pattern: string, handler: (context: Context) => Promise<Reply>, access: "public" | "grading" = "public"): void {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), access, handler });
}

/** A path parameter, decoded; null when it is malformed or holds a NUL byte (no id can). */
function decodeParam(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw);
    return value.includes("\0") ? null : value;
  } catch {
    return null;
  }
}

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = candidate.segments.every((segment, index) => {
      if (!segment.startsWith(":")) return segment === parts[index];
      const value = decodeParam(parts[index]);
      if (value === null) return false;
      params[segment.slice(1)] = value;
      return true;
    });
    if (fits) return { route: candidate, params };
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DISCARD_LIMIT) req.destroy();
      else if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_LIMIT ? "too_large" : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(raw: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(415, "unsupported_media_type");
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function sameOrigin(req: IncomingMessage, origin: string): boolean {
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === new URL(settings.publicUrl).host;
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export function setCookieHeader(cookie: string): Record<string, string> {
  return { "set-cookie": cookie };
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const raw = await readBody(req);
    if (raw === "too_large") throw new ApiError(413, "too_large");
    const isJson = /^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "");
    if (BODY_METHODS.has(method) && !isJson) throw new ApiError(415, "unsupported_media_type");
    const body = BODY_METHODS.has(method) ? parseJson(raw) : {};
    const found = match(method, url.pathname);
    if (found?.route.access === "grading" && (!settings.gradingKey || req.headers["x-grading-key"] !== settings.gradingKey)) throw notFound();
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(method) && origin !== undefined && !sameOrigin(req, origin)) throw new ApiError(403, "bad_origin");
    const base: Context = { req, params: found?.params ?? {}, query: url.searchParams, body };
    let reply: Reply;
    if (found && found.route.access !== "session") {
      reply = await found.route.handler(base);
    } else {
      const person = await sessionPerson(req);
      if (!person) throw new ApiError(401, "unauthenticated");
      if (!found || found.route.access !== "session") throw notFound();
      reply = await found.route.handler({ ...base, person });
    }
    if (reply.stream) {
      await reply.stream(res);
      return;
    }
    sendJson(res, reply.status, reply.body, reply.headers);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, errorBody(error));
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "server_error" });
  }
}

const LIVE_PATH = /^\/api\/projects\/([^/]+)\/live$/;

/** The live channel: a WebSocket on the project's own origin, for signed-in members only. */
export async function handleUpgrade(req: IncomingMessage, socket: Duplex, url: URL): Promise<void> {
  try {
    const origin = req.headers.origin;
    if (origin !== undefined && !sameOrigin(req, origin)) throw new ApiError(403, "bad_origin");
    const person = await sessionPerson(req);
    if (!person) throw new ApiError(401, "unauthenticated");
    const found = LIVE_PATH.exec(url.pathname);
    if (!found || req.headers.upgrade?.toLowerCase() !== "websocket") throw notFound();
    const projectId = decodeParam(found[1]);
    const access = projectId === null ? null : await projectAccess(person.id, projectId);
    if (!access) throw notFound();
    openConnection(req, socket, { userId: person.id, userName: person.name, projectId: access.projectId, workspaceId: access.workspaceId });
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error(error);
    const status = known ? error.status : 500;
    const body = JSON.stringify(known ? errorBody(error) : { error: "server_error" });
    socket.end(
      `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
    );
  }
}
