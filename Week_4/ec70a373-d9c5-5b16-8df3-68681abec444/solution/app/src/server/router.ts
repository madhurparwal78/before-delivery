// Request dispatch in the API's single precedence order. Steps 1 to 7 are decided here; each handler then
// decides scope, replay, state, validation, rules and contention in that order.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { ApiError, sendBytes, sendEmpty, sendError, sendJson, statusOf, type ReplyHeaders } from "./http.ts";
import { clientAddress, csrfMatches, readSession, type SessionState, type SessionUser } from "./auth.ts";
import { addressPrefix, auditAnswer, currentDraft, withAuditDraft, type AuditDraft } from "./audit.ts";
import { parseMultipart, type Multipart } from "./multipart.ts";
import { serveStatic } from "./static.ts";
import { one, pool } from "./db.ts";
import type { Role } from "../shared/api.ts";

const JSON_LIMIT = 65_536;
const JSON_DEPTH_LIMIT = 20;
const UPLOAD_REQUEST_LIMIT = 5_500_000;
const FILE_LIMIT = 5_000_000;
const UPLOAD_ENDPOINT = "POST /api/documents";

export type Reply =
  | { kind: "json"; status: number; body: unknown; headers?: ReplyHeaders }
  | { kind: "bytes"; status: number; data: Buffer | string; headers: ReplyHeaders }
  | { kind: "empty"; status: number; headers?: ReplyHeaders };

export function json(status: number, body: unknown, headers?: ReplyHeaders): Reply {
  return { kind: "json", status, body, headers };
}

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The server's own origin for this request: scheme plus the Host header as sent. */
  origin: string;
  /** Parsed JSON body; `{}` when the request has none; undefined when malformed or nested too deeply. */
  body: unknown;
  multipart: Multipart | null;
  user: SessionUser | null;
  /** The live session's key, for sign-out. */
  sessionTokenHash: string | null;
}

/** A context whose route needs a session. */
export interface AuthedCtx extends Ctx {
  user: SessionUser;
}

type Access = "public" | "signed_in" | Role[];

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  access: Access;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, access: "public", handler: (ctx: Ctx) => Promise<Reply>): void;
export function route(method: string, pattern: string, access: "signed_in" | Role[], handler: (ctx: AuthedCtx) => Promise<Reply>): void;
export function route(
  method: string,
  pattern: string,
  access: Access,
  handler: ((ctx: AuthedCtx) => Promise<Reply>) | ((ctx: Ctx) => Promise<Reply>),
): void {
  routes.push({ method, pattern, segments: pattern.split("/"), access, handler: handler as (ctx: Ctx) => Promise<Reply> });
}

function match(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of route.segments.entries()) {
    const part = parts[i] ?? "";
    if (segment.startsWith("{")) {
      if (part === "") return null;
      params[segment.slice(1, -1)] = part;
    } else if (segment !== part) return null;
  }
  return params;
}

function readBody(req: IncomingMessage, limit: number): Promise<{ data: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve({ data: Buffer.concat(chunks), tooLarge: size > limit }));
    req.on("error", reject);
  });
}

function ownOrigin(req: IncomingMessage): string {
  const secure = (req.socket as TLSSocket).encrypted === true;
  return `${secure ? "https" : "http"}://${req.headers.host ?? ""}`;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** How deep the JSON text nests, scanned without recursion so that a pathological body cannot exhaust the stack. */
function jsonDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") deepest = Math.max(deepest, ++depth);
    else if (c === "}" || c === "]") depth--;
  }
  return deepest;
}

function parseJsonBody(text: string): unknown {
  if (jsonDepth(text) > JSON_DEPTH_LIMIT) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Precedence step 2: 413 body, 413 file, 415 media type, then 403 cross-origin. Only writes carry a body. */
async function transport(req: IncomingMessage, endpoint: string, origin: string): Promise<{ body: unknown; multipart: Multipart | null }> {
  const upload = endpoint === UPLOAD_ENDPOINT;
  const { data, tooLarge } = await readBody(req, upload ? UPLOAD_REQUEST_LIMIT : JSON_LIMIT);
  if (!WRITES.has(req.method ?? "")) return { body: {}, multipart: null };
  if (tooLarge) throw new ApiError("body_too_large");
  let body: unknown = {};
  let multipart: Multipart | null = null;
  if (upload) {
    const isMultipart = mediaType(req) === "multipart/form-data";
    multipart = isMultipart ? (parseMultipart(data, req.headers["content-type"] ?? "") ?? { fields: new Map(), files: [], repeated: [] }) : null;
    if (multipart?.files.some((file) => file.data.length > FILE_LIMIT)) throw new ApiError("file_too_large");
    if (!isMultipart) throw new ApiError("unsupported_media_type");
  } else if (data.length > 0) {
    if (mediaType(req) !== "application/json") throw new ApiError("unsupported_media_type");
    body = parseJsonBody(data.toString("utf8"));
    const draft = currentDraft();
    if (draft && endpoint === "POST /api/session" && body !== null && typeof body === "object" && "email" in body && typeof body.email === "string") {
      draft.signInEmail = body.email.includes("\0") ? null : body.email;
    }
  }
  const sentOrigin = req.headers.origin;
  if (sentOrigin !== undefined && sentOrigin !== origin) throw new ApiError("cross_origin");
  return { body, multipart };
}

function send(res: ServerResponse, reply: Reply): void {
  if (reply.kind === "json") sendJson(res, reply.status, reply.body, reply.headers);
  else if (reply.kind === "bytes") sendBytes(res, reply.status, reply.data, reply.headers);
  else sendEmpty(res, reply.status, reply.headers);
}

/** The endpoint-table pattern a path matches, whatever the method. */
function findPattern(parts: string[]): { pattern: string; params: Record<string, string> } | null {
  for (const candidate of routes) {
    const params = match(candidate, parts);
    if (params) return { pattern: candidate.pattern, params };
  }
  return null;
}

/** Any method but GET on an inspector token path, or a path below it. */
function isReadOnlyPath(parts: string[], method: string): boolean {
  return parts[1] === "api" && parts[2] === "inspect" && parts.length >= 4 && parts[3] !== "" && method !== "GET";
}

function newDraft(req: IncomingMessage, method: string, found: { pattern: string; params: Record<string, string> } | null, readOnly: boolean): AuditDraft {
  const pattern = found?.pattern ?? (readOnly ? "/api/inspect/{token}" : null);
  return {
    method,
    pattern,
    params: found?.params ?? {},
    actor: null,
    subjectUserId: null,
    signInEmail: null,
    tokenTenantId: null,
    tokenSiteId: null,
    addressPrefix: addressPrefix(clientAddress(req)),
    written: false,
  };
}

/** Events under an inspector token belong to the token's tenant and the truck's home site. */
async function attachToken(draft: AuditDraft, token: string | undefined): Promise<void> {
  if (token === undefined || !/^[A-Za-z0-9_-]+$/.test(token)) return;
  const owner = await one<{ tenant_id: string; home_site_id: string }>(
    pool,
    `SELECT m.tenant_id, m.home_site_id FROM inspector_links l JOIN trucks t ON t.id = l.truck_id JOIN members m ON m.id = t.member_id WHERE l.token = $1`,
    [token],
  );
  draft.tokenTenantId = owner?.tenant_id ?? null;
  draft.tokenSiteId = owner?.home_site_id ?? null;
}

/** The caller of a write for the audit event: only a live session's user is an actor. */
function attachCaller(draft: AuditDraft, session: SessionState, pattern: string | null): void {
  if (session.state === "none" || session.state === "invalid") return;
  if (pattern === "/api/session" && draft.method === "POST") return;
  draft.subjectUserId = session.user.id;
  if (session.state === "live") draft.actor = { userId: session.user.id, name: session.user.name, role: session.user.role };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, parts: string[], query: URLSearchParams, method: string): Promise<void> {
  const found = findPattern(parts);
  const readOnly = isReadOnlyPath(parts, method);
  const candidate = routes.find((r) => r.method === method && match(r, parts));
  const endpoint = `${method} ${found?.pattern ?? "unknown"}`;
  const answer = async (reply: Reply): Promise<void> => {
    await auditAnswer(reply.status, null, reply.kind === "json" ? reply.body : null);
    send(res, reply);
  };
  try {
    if (readOnly) {
      const draft = currentDraft();
      if (draft) await attachToken(draft, parts[3]);
      await readBody(req, 0);
      throw new ApiError("read_only", { headers: { Allow: "GET" } });
    }
    const session: SessionState = found?.pattern === "/api/health" ? { state: "none" } : await readSession(req);
    const draft = currentDraft();
    if (draft) attachCaller(draft, session, found?.pattern ?? null);
    const origin = ownOrigin(req);
    const { body, multipart } = await transport(req, endpoint, origin);
    if (!found) throw new ApiError("not_found");
    if (!candidate) {
      const allow = routes.filter((r) => r.pattern === found.pattern).map((r) => r.method);
      throw new ApiError("method_not_allowed", { headers: { Allow: allow.join(", ") } });
    }
    const access = candidate.access;
    if (access !== "public") {
      if (session.state === "none") throw new ApiError("unauthenticated");
      if (session.state === "invalid") throw new ApiError("session_invalid");
      if (session.state === "dead") throw new ApiError(session.code);
    }
    if (session.state === "live" && WRITES.has(method) && endpoint !== "POST /api/session" && !csrfMatches(req.headers["x-csrf-token"], session.csrfHash)) {
      throw new ApiError("csrf_failed");
    }
    const user = session.state === "live" ? session.user : null;
    if (access !== "public" && access !== "signed_in" && user && !access.includes(user.role)) throw new ApiError("forbidden");
    await answer(
      await candidate.handler({
        req,
        params: found.params,
        query,
        origin,
        body,
        multipart,
        user,
        sessionTokenHash: session.state === "live" ? session.tokenHash : null,
      }),
    );
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error(error);
    const refusal = known ? error : new ApiError("internal");
    await auditAnswer(statusOf(refusal.code), refusal.code, null).catch((failure: unknown) => console.error(failure));
    sendError(res, refusal);
  }
}

export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const [path = "/", rawQuery = ""] = (req.url ?? "/").split(/\?(.*)/s);
  try {
    if (path !== "/api" && !path.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") throw new ApiError("not_found");
      await serveStatic(path, res);
      return;
    }
    const parts = path.split("/");
    const draft = WRITES.has(method) ? newDraft(req, method, findPattern(parts), isReadOnlyPath(parts, method)) : null;
    await withAuditDraft(draft, () => handleApi(req, res, parts, new URLSearchParams(rawQuery), method));
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
    sendError(res, error instanceof ApiError ? error : new ApiError("internal"));
  }
}
