import type { IncomingMessage, ServerResponse } from "node:http";
import { copy } from "../domain/copy.ts";
import { readSession, type Session } from "./session.ts";
import { ApiError, errorBody, invalid, notFound } from "./errors.ts";
import { type FileLimit, type ReadBody, readBody } from "./body.ts";
import { notFoundPage } from "../pages/notFound.ts";

const QUERY_TEXT_LIMIT = 200;
const JSON_DEPTH_LIMIT = 16;

type BodyKind = "json" | "multipart" | "none";

export interface Ctx {
  req: IncomingMessage;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The app's own origin as this request reached it. */
  origin: string;
  /** The session, or null; `deskId` below is only for routes behind authentication. */
  session: Session | null;
  deskId: string;
  raw: Buffer;
  json: unknown;
  form: ReadBody["form"];
  /** Whatever a route's `resource` step loaded, for its handler. */
  loaded: Record<string, unknown>;
}

export type Reply =
  | { kind: "json"; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: "empty"; status: number; headers?: Record<string, string> }
  | { kind: "bytes"; status: number; type: string; bytes: Buffer | string; headers?: Record<string, string> }
  | { kind: "redirect"; status: number; location: string };

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ kind: "json", status, body, ...(headers ? { headers } : {}) });
export const empty = (status = 204, headers?: Record<string, string>): Reply => ({ kind: "empty", status, ...(headers ? { headers } : {}) });
export const bytes = (status: number, type: string, data: Buffer | string, headers?: Record<string, string>): Reply => ({ kind: "bytes", status, type, bytes: data, ...(headers ? { headers } : {}) });
export const html = (status: number, text: string): Reply => bytes(status, "text/html; charset=utf-8", text);
export const redirect = (location: string): Reply => ({ kind: "redirect", status: 302, location });

interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  /** `public` routes need no session; every other route answers 401 without a live one. */
  access?: "public";
  /** Defaults to `json` for POST, PUT and PATCH, `none` otherwise. */
  body?: BodyKind;
  /** Multipart only: the file limit, counted on the file alone. */
  file?: FileLimit;
  /** Step 4 of the order. Runs with the session read but not yet required. */
  rate?: (ctx: Ctx) => Promise<void>;
  /** Step 6 of the order: load the resource or throw 404 (410 for an ended private page). */
  resource?: (ctx: Ctx) => Promise<void>;
  handle: (ctx: Ctx) => Promise<Reply>;
}

interface Compiled extends Route {
  parts: string[];
}

const routes: Compiled[] = [];

export function route(definition: Route): void {
  routes.push({ ...definition, parts: definition.pattern.split("/") });
}

function matchParts(parts: readonly string[], path: readonly string[]): Record<string, string> | null {
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of parts.entries()) {
    const value = path[index] as string;
    if (part.startsWith(":")) {
      if (!value) return null;
      try {
        params[part.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

function findRoute(method: string, path: string): { found: Compiled; params: Record<string, string> } | { allow: string[] } {
  const pieces = path.split("/");
  const allow: string[] = [];
  let staticHit: { found: Compiled; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    const params = matchParts(candidate.parts, pieces);
    if (!params) continue;
    if (candidate.method === method) {
      const isStatic = Object.keys(params).length === 0;
      if (isStatic) return { found: candidate, params };
      staticHit ??= { found: candidate, params };
    } else if (!allow.includes(candidate.method)) {
      allow.push(candidate.method);
    }
  }
  return staticHit ?? { allow };
}

function ownOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? ""}`;
}

function checkOrigin(req: IncomingMessage, allowed: string | null): void {
  if (["GET", "HEAD"].includes(req.method ?? "")) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === ownOrigin(req) || origin === allowed) return;
  throw new ApiError(403, "foreignOrigin", "This request came from another site.");
}

function jsonDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") deepest = Math.max(deepest, (depth += 1));
    else if (char === "}" || char === "]") depth -= 1;
  }
  return deepest;
}

function readJson(raw: Buffer): unknown {
  const text = raw.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof RangeError) throw invalid("body", copy("F-08"));
    throw new ApiError(400, "malformedJson", "This request could not be read.");
  }
  if (jsonDepth(text) > JSON_DEPTH_LIMIT) throw new ApiError(422, "tooDeep", "This request is nested too deeply.");
  return parsed;
}

function contentType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The published order for every request, in one place. Steps 9 to 11 belong to the handlers. */
async function run(found: Compiled, params: Record<string, string>, req: IncomingMessage, url: URL, publicUrl: string | null): Promise<Reply> {
  const kind = found.body ?? (["POST", "PUT", "PATCH"].includes(found.method) ? "json" : "none");
  const read = await readBody(req, kind === "multipart" ? found.file : undefined);
  checkOrigin(req, publicUrl);
  const session = await readSession(req);
  const ctx: Ctx = {
    req,
    method: found.method,
    path: url.pathname,
    params,
    query: url.searchParams,
    origin: publicUrl ?? ownOrigin(req),
    session: session.live,
    deskId: session.live?.deskId ?? "",
    raw: read.raw,
    json: undefined,
    form: read.form,
    loaded: {},
  };
  await found.rate?.(ctx);
  if (found.access !== "public" && !session.live) {
    throw new ApiError(401, session.ended ? "sessionEnded" : "notSignedIn", copy("F-03"));
  }
  await found.resource?.(ctx);
  if (kind === "json" && contentType(req) !== "application/json") throw new ApiError(415, "unsupportedType", "This request must be JSON.");
  if (kind === "multipart" && contentType(req) !== "multipart/form-data") throw new ApiError(415, "unsupportedType", "This request must be a file upload.");
  if (kind === "multipart" && !read.form) throw new ApiError(400, "malformedUpload", "This upload could not be read.");
  if (kind === "json") ctx.json = readJson(read.raw);
  for (const value of url.searchParams.values()) {
    if ([...value].length > QUERY_TEXT_LIMIT) throw new ApiError(422, "queryTooLong", copy("F-05", { n: QUERY_TEXT_LIMIT }));
  }
  return found.handle(ctx);
}

function send(res: ServerResponse, reply: Reply): void {
  if (reply.kind === "json") {
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...reply.headers });
    res.end(JSON.stringify(reply.body));
  } else if (reply.kind === "empty") {
    res.writeHead(reply.status, reply.headers);
    res.end();
  } else if (reply.kind === "redirect") {
    res.writeHead(reply.status, { Location: reply.location });
    res.end();
  } else {
    res.writeHead(reply.status, { "Content-Type": reply.type, ...reply.headers });
    res.end(reply.bytes);
  }
}

/** Keeps reading what a refused request is still sending, so the client gets its answer and never a dropped connection. */
function drain(req: IncomingMessage): void {
  if (!req.complete) req.resume();
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, publicUrl: string | null): Promise<void> {
  try {
    const url = URL.parse(`http://desk.invalid${req.url ?? "/"}`);
    if (!url) throw notFound();
    const isApi = url.pathname.startsWith("/api/");
    const match = findRoute(req.method ?? "GET", url.pathname);
    if ("allow" in match) {
      if (match.allow.length === 0) {
        if (isApi) throw notFound();
        send(res, html(404, notFoundPage()));
        drain(req);
        return;
      }
      throw new ApiError(405, "methodNotAllowed", "This address does not take that method.", undefined, { Allow: match.allow.join(", ") });
    }
    send(res, await run(match.found, match.params, req, url, publicUrl));
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
    const failure = error instanceof ApiError ? error : new ApiError(500, "internal", "Something went wrong on the desk.");
    if (!req.complete) res.setHeader("Connection", "close");
    send(res, json(failure.status, errorBody(failure), failure.headers));
  }
  drain(req);
}
