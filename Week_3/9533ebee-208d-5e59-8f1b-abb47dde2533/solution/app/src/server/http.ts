import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { inLedger, isDatabaseFailure, one, pool, type Tx } from "./db.js";
import { ApiError, fail, FIELD, problemJson, problemResponse, validation } from "./errors.js";
import { sync } from "./positions.js";
import type { Market } from "./pools.js";
import { removeAll } from "./storage.js";
import { serverNow } from "./time.js";

// The API pipeline. Every request is checked in the published error precedence:
// 413 body size, 403 cross origin, 415 content type, 400 JSON, 401 member, 400 Idempotency-Key, stored replay or
// 409 key reuse, then the handler's own 404, 403, 428/412, state conflicts and 422, and finally 503 when a
// statement or evidence object cannot be stored.

const BODY_LIMIT = 16_384;

export type Role = "risk_steward" | "liquidity_provider" | "borrower" | "trader" | "liquidator";

export interface Member {
  actor_id: string;
  name: string;
  email: string;
  role: Role;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Ctx {
  tx: Tx;
  now: Date;
  market: Market;
  member: Member;
  params: string[];
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Record<string, Json>;
  /** Strict-body findings (unknown fields, control characters), reported with the handler's own 422. */
  bodyErrors: Record<string, string>;
  /** Object keys written by this request, removed again if the transaction then fails to commit. */
  stored: string[];
}

export type Reply =
  | { status: number; body: unknown; headers?: Record<string, string>; binary?: undefined }
  | { status: number; binary: Buffer; contentType: string };

export interface Route {
  method: "GET" | "POST" | "PATCH";
  pattern: RegExp;
  /** The body fields the endpoint defines; any other key is refused as unknown. */
  fields?: readonly string[];
  /** Keyed routes need an Idempotency-Key and replay their first stored response. */
  keyed?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export interface PublicCall {
  body: Record<string, Json>;
  bodyErrors: Record<string, string>;
}

export interface PublicRoute {
  method: "GET" | "POST";
  pattern: RegExp;
  fields?: readonly string[];
  handler: (call: PublicCall) => Promise<Reply>;
}

/** One field's parsed value, or null with the message to show for it. */
type Check = readonly [value: unknown, message: string];

/**
 * The one 422 check. Each named field is a parsed value (null or undefined when it failed) and its published
 * message. Every failing field is reported, strict-body findings take precedence over a field's own message, and
 * when nothing fails the parsed values come back narrowed.
 */
export function valid<C extends Record<string, Check>>(findings: Record<string, string>, checks: C): { [K in keyof C]: NonNullable<C[K][0]> } {
  const messages: Record<string, string | false> = {};
  for (const [field, [value, message]] of Object.entries(checks)) messages[field] = value == null && message;
  const merged = { ...messages, ...findings };
  if (Object.values(merged).some((message) => typeof message === "string")) throw validation(merged);
  return Object.fromEntries(Object.entries(checks).map(([field, [value]]) => [field, value])) as { [K in keyof C]: NonNullable<C[K][0]> };
}

export function requireRole(member: Member, ...roles: Role[]): void {
  if (!roles.includes(member.role)) throw fail("forbidden");
}

function send(res: ServerResponse, reply: Reply, extra: Record<string, string> = {}): void {
  if (reply.binary !== undefined) {
    res.writeHead(reply.status, { "Content-Type": reply.contentType, "Cache-Control": "no-store", ...extra });
    res.end(reply.binary);
    return;
  }
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...reply.headers, ...extra });
  res.end(JSON.stringify(reply.body));
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Sorted-key JSON, so the fingerprint of a body does not depend on key order or whitespace. */
function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Strict bodies: a key the endpoint does not define, and control characters in a string field. Built with
 * `Object.fromEntries` so a key named `__proto__` stays an ordinary property.
 */
function strictFindings(body: Record<string, Json>, allowed: readonly string[]): Record<string, string> {
  const found = Object.entries(body).flatMap(([key, value]): [string, string][] => {
    if (!allowed.includes(key)) return [[key, FIELD.unknownField]];
    return typeof value === "string" && CONTROL_CHARACTERS.test(value) ? [[key, FIELD.controlCharacters]] : [];
  });
  return Object.fromEntries(found);
}

function isOwnOrigin(req: IncomingMessage, origin: string): boolean {
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function memberOf(req: IncomingMessage): Promise<Member> {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw fail("unauthenticated");
  const found = await pool.query<Member>(
    "SELECT m.actor_id, m.name, m.email, m.role FROM sessions s JOIN members m ON m.actor_id = s.actor_id WHERE s.token = $1",
    [token],
  );
  const member = found.rows[0];
  if (!member) throw fail("unauthenticated");
  return member;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, routes: Route[], publicRoutes: PublicRoute[]): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const raw = await readBody(req);
  const stored: string[] = [];
  try {
    if (raw === null) throw fail("payload_too_large");
    const origin = req.headers.origin;
    if (UNSAFE_METHODS.has(method) && origin !== undefined && !isOwnOrigin(req, origin)) throw fail("cross_origin");
    let body: Record<string, Json> = {};
    if (method === "POST" || method === "PATCH") {
      const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") throw fail("unsupported_media_type");
      let parsed: Json;
      try {
        parsed = JSON.parse(raw.toString("utf8")) as Json;
      } catch {
        throw fail("invalid_json");
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw fail("invalid_json");
      body = parsed;
    }

    const open = publicRoutes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (open) {
      send(res, await open.handler({ body, bodyErrors: strictFindings(body, open.fields ?? []) }));
      return;
    }
    let params: string[] = [];
    const route = routes.find((r) => {
      const match = r.method === method ? r.pattern.exec(url.pathname) : null;
      if (match) params = match.slice(1).map((p) => decodeURIComponent(p));
      return match !== null;
    });
    if (!route) throw fail("not_found");

    const member = await memberOf(req);
    const keyHeader = req.headers["idempotency-key"];
    const key = typeof keyHeader === "string" ? keyHeader : "";
    if (route.keyed && !KEY_PATTERN.test(key)) throw fail("idempotency_key_required");
    const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
    const bodyErrors = strictFindings(body, route.fields ?? []);

    const result = await inLedger(async (tx) => {
      if (route.keyed) {
        const previous = await one<{ fingerprint: string; status: number; response: string }>(
          tx,
          "SELECT fingerprint, status, response FROM idempotency_keys WHERE actor_id = $1 AND endpoint = $2 AND key = $3",
          [member.actor_id, url.pathname, key],
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw fail("idempotency_key_reused");
          return { status: previous.status, text: previous.response, replayed: true };
        }
      }
      const now = serverNow();
      const market = await sync(tx, now);
      const ctx: Ctx = { tx, now, market, member, params, query: url.searchParams, headers: req.headers, body, bodyErrors, stored };
      let reply: Reply;
      try {
        reply = await route.handler(ctx);
        // A body that broke the strict rules is refused even when the handler found nothing else wrong.
        valid(bodyErrors, {});
      } catch (error) {
        // A refusal below 500 is a real answer: keyed requests store it like any other response.
        if (!route.keyed || !(error instanceof ApiError) || error.status >= 500) throw error;
        await removeAll(stored.splice(0));
        return storeAnswer(tx, member.actor_id, url.pathname, key, fingerprint, now, { status: error.status, body: problemJson(error), problem: true });
      }
      if (reply.binary !== undefined) return { status: reply.status, binary: reply.binary, contentType: reply.contentType };
      if (!route.keyed) return { status: reply.status, text: JSON.stringify(reply.body), headers: reply.headers, replayed: false };
      return storeAnswer(tx, member.actor_id, url.pathname, key, fingerprint, now, { status: reply.status, body: reply.body, problem: false });
    });
    if (result.binary !== undefined) {
      send(res, { status: result.status, binary: result.binary, contentType: result.contentType });
      return;
    }
    res.writeHead(result.status, {
      "Content-Type": result.status >= 400 ? "application/problem+json; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...result.headers,
      ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
    res.end(result.text);
  } catch (error) {
    await removeAll(stored);
    if (error instanceof ApiError) {
      problemResponse(res, error, error.code === "unauthenticated" ? { "WWW-Authenticate": "Bearer" } : {});
      return;
    }
    if (isDatabaseFailure(error)) {
      console.error("database unavailable:", error instanceof Error ? error.message : error);
      problemResponse(res, fail("ledger_unavailable"));
      return;
    }
    console.error("request failed:", error);
    problemResponse(res, fail("internal_error"));
  }
}

/** Stores the first response below 500 for a key, in the same transaction as its effect. */
async function storeAnswer(
  tx: Tx,
  actorId: string,
  endpoint: string,
  key: string,
  fingerprint: string,
  now: Date,
  answer: { status: number; body: unknown; problem: boolean },
): Promise<{ status: number; text: string; replayed: false }> {
  const text = JSON.stringify(answer.body);
  await tx.query(
    "INSERT INTO idempotency_keys (actor_id, endpoint, key, fingerprint, status, response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [actorId, endpoint, key, fingerprint, answer.status, text, now],
  );
  return { status: answer.status, text, replayed: false };
}
