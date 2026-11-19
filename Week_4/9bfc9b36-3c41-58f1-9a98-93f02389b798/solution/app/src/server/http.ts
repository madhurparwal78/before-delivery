/** Request and response plumbing: bodies, replies, routing and the transport refusals. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Refusal, invalid, refuse } from "./errors.js";
import type { AccountRow } from "./accounts.js";
import type { Body } from "./validate.js";
import { matchPath } from "../shared/routes.js";

export const JSON_LIMIT = 65536;
export const PHOTO_LIMIT = 5_000_000;

export interface Reply {
  status: number;
  json?: unknown;
  /** A body already serialised, sent as is (stored replies, files). */
  raw?: Buffer | string;
  type?: string;
  headers?: Record<string, string>;
  cookies?: string[];
}

export interface Ctx {
  method: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  bytes: Buffer;
  actor: AccountRow;
  json(): Body;
}

type Handler = (ctx: Ctx) => Promise<Reply>;
type Auth = "public" | "cookie" | "user";

export interface Route {
  method: string;
  pattern: string;
  auth: Auth;
  body: "none" | "json" | "photo";
  handler: Handler;
}

export const ok = (json: unknown): Reply => ({ status: 200, json });
export const created = (json: unknown): Reply => ({ status: 201, json });

class TooLarge extends Error {}

const DRAIN_CAP = 16_000_000;

/** Reads the whole body up to `limit`; an oversize body is drained (so the client can read the 413) and then refused. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = Number(req.headers["content-length"] ?? 0) > limit;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) exceeded = true;
    if (!exceeded) chunks.push(chunk as Buffer);
    if (size > DRAIN_CAP) {
      req.destroy();
      break;
    }
  }
  if (exceeded) throw new TooLarge();
  return Buffer.concat(chunks);
}

export const isTooLarge = (error: unknown): boolean => error instanceof TooLarge;

export function parseJson(bytes: Buffer): Body {
  if (bytes.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalid({});
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {};
}

const literalCount = (pattern: string): number => pattern.split("/").filter((segment) => !segment.startsWith(":")).length;

export function findRoute(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const ordered = [...routes].sort((a, b) => literalCount(b.pattern) - literalCount(a.pattern));
  for (const route of ordered) {
    if (route.method !== method) continue;
    const params = matchPath(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

export const BASE_HEADERS: Record<string, string> = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export function send(res: ServerResponse, reply: Reply): void {
  const body = reply.raw !== undefined ? Buffer.from(reply.raw) : reply.json !== undefined ? Buffer.from(JSON.stringify(reply.json)) : Buffer.alloc(0);
  const headers: Record<string, string | number | string[]> = { ...BASE_HEADERS, ...reply.headers };
  if (reply.status !== 204 && reply.status !== 304) {
    headers["content-type"] = reply.type ?? (reply.json !== undefined || reply.raw !== undefined ? "application/json; charset=utf-8" : "");
    if (!headers["content-type"]) delete headers["content-type"];
    headers["content-length"] = body.length;
  }
  if (reply.cookies?.length) headers["set-cookie"] = reply.cookies;
  res.writeHead(reply.status, headers);
  res.end(body);
}

export function sendRefusal(res: ServerResponse, refusal: Refusal): void {
  send(res, { status: refusal.status, json: refusal.body, headers: refusal.headers });
}

/** The one 404, byte for byte the same wherever it comes from. */
export const NOT_FOUND_REPLY: Reply = { status: 404, json: refuse("not_found").body };

export function ifMatchRevision(headers: IncomingMessage["headers"]): number {
  const raw = headers["if-match"];
  if (raw === undefined) throw refuse("precondition_required");
  const match = /^(?:W\/)?"(\d+)"$/.exec(String(raw).trim());
  if (!match) throw refuse("stale_revision");
  return Number(match[1]);
}

/** Versioned records carry their revision as an ETag for the sailmaker only. */
export const sailmakerEtag = (role: string, revision: number): Record<string, string> => (role === "sailmaker" ? { etag: `"${revision}"` } : {});

export const SESSION_COOKIE = "boltrope_session";

export function cookieValue(headers: IncomingMessage["headers"], name: string): string | null {
  for (const part of String(headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

/** A readable hint (no secret) that a session cookie exists, so a cold page asks for a token only when one can come back. */
const SESSION_HINT_COOKIE = "boltrope_signed";

export function sessionCookies(token: string, maxAgeSeconds: number): string[] {
  return [
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
    `${SESSION_HINT_COOKIE}=1; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
  ];
}

export const clearedCookies = [
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  `${SESSION_HINT_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`,
];
