import type { Context } from "hono";
import { cookieValue, SESSION_COOKIE, userOfSession, type SessionUser } from "../auth.ts";
import { catchUp } from "../engine.ts";
import { exclusive, maybeOne, pool, run, transaction, type AfterCommit, type Db } from "../db.ts";
import { isUuid } from "../ids.ts";
import { HttpError, forbidden, notFound, unauthorized } from "../errors.ts";
import { broadcast } from "../live.ts";
import { canonicalJson, fingerprint } from "../idempotency.ts";
import { OWNER_MEMBERS_COPY, OWNER_PRODUCER_COPY, VIEWER_COPY } from "../../shared/copy.ts";
import type { Role, TransactionCreated } from "../../shared/api.ts";

const BODY_LIMIT_BYTES = 1_048_576;
/** Past the limit the rest of a body is read and dropped (up to this much), so the 413 reaches a client still sending. */
const DRAIN_LIMIT_BYTES = 8 * BODY_LIMIT_BYTES;

export interface Scope {
  user: SessionUser;
  workspaceId: string;
  workspaceName: string;
  role: Role;
}

export async function requireUser(c: Context): Promise<SessionUser> {
  const user = await userOfSession(pool, cookieValue(c.req.header("cookie"), SESSION_COOKIE));
  if (!user) throw unauthorized();
  return user;
}

export async function memberScope(user: SessionUser, workspaceId: string): Promise<Scope | undefined> {
  if (!isUuid(workspaceId)) return undefined;
  const row = await maybeOne<{ name: string; role: Role }>(
    pool,
    "SELECT w.name, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE w.id = $1 AND m.user_id = $2",
    [workspaceId, user.id],
  );
  return row ? { user, workspaceId, workspaceName: row.name, role: row.role } : undefined;
}

async function scopeOf(c: Context): Promise<Scope> {
  const user = await requireUser(c);
  const scope = await memberScope(user, c.req.param("id") ?? "");
  if (!scope) throw notFound();
  return scope;
}

/** A JSON body: 415 without a JSON content type, 413 past 1,048,576 bytes. NUL characters, which PostgreSQL text cannot hold, are dropped from every string. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, { error: "Send JSON." });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = c.req.raw.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    size += part.value.length;
    if (size > DRAIN_LIMIT_BYTES) break;
    if (size <= BODY_LIMIT_BYTES) chunks.push(part.value);
  }
  if (size > BODY_LIMIT_BYTES) throw new HttpError(413, { error: "Request body is too large." });
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}", (_key, value: unknown) =>
      typeof value === "string" ? value.replaceAll("\0", "") : value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, { error: "Send valid JSON." });
  }
}

type ReadHandler = (c: Context, scope: Scope) => Promise<Response>;
type WriteHandler = (c: Context, scope: Scope, body: Record<string, unknown>) => Promise<Response>;

/** A read route: 401, then 404 for a workspace the person cannot see. */
export function read(handler: ReadHandler) {
  return async (c: Context) => handler(c, await scopeOf(c));
}

/** A write route: 401, 404, the body rules (415, 413), then the handler alone with the clock caught up. */
export function write(handler: WriteHandler) {
  return async (c: Context) => {
    const scope = await scopeOf(c);
    const body = await jsonBody(c);
    return exclusive(async () => {
      await catchUp();
      return handler(c, scope, body);
    });
  };
}

/** 403: viewers send no transactions. */
export function requireWriter(scope: Scope): void {
  if (scope.role === "viewer") throw forbidden(VIEWER_COPY);
}

/** 403: only the owner; the viewer copy wins on every write route. */
export function requireOwner(scope: Scope, developerCopy: typeof OWNER_PRODUCER_COPY | typeof OWNER_MEMBERS_COPY): void {
  if (scope.role === "viewer") throw forbidden(VIEWER_COPY);
  if (scope.role === "developer") throw forbidden(developerCopy);
}

/**
 * A write that creates a transaction. An Idempotency-Key replays the stored answer (step 3 of the error order, before the
 * role check inside `perform`); the same key with another request is a 409. Answers 201 with the transaction.
 */
export async function createTransaction(
  c: Context,
  scope: Scope,
  body: Record<string, unknown>,
  perform: (db: Db, after: AfterCommit) => Promise<TransactionCreated>,
): Promise<Response> {
  const key = c.req.header("Idempotency-Key");
  const scopeKey = `${scope.user.id}:${scope.workspaceId}`;
  const print = fingerprint(c.req.method, new URL(c.req.url).pathname, body);
  if (key) {
    const stored = await maybeOne<{ fingerprint: string; body: TransactionCreated }>(
      pool,
      "SELECT fingerprint, body FROM idempotency_keys WHERE scope = $1 AND key = $2",
      [scopeKey, key],
    );
    if (stored) {
      if (stored.fingerprint !== print) throw new HttpError(409, { error: "This idempotency key was used for a different request." });
      return c.json(stored.body, 201);
    }
  }
  const created = await transaction(async (db, after) => {
    const result = await perform(db, after);
    if (key) {
      await run(db, "INSERT INTO idempotency_keys (scope, key, fingerprint, body) VALUES ($1, $2, $3, $4)", [scopeKey, key, print, canonicalJson(result)]);
    }
    after(() => broadcast(scope.workspaceId, { type: "changed" }));
    return result;
  });
  return c.json(created, 201);
}
