import { createHash } from "node:crypto";
import type { Context } from "hono";
import { one, pool } from "./db.js";
import type { AppEnv } from "./env.js";
import { ApiError, type ErrorCode, validationError } from "./errors.js";

type Ctx = Context<AppEnv>;

/** JSON with object keys sorted at every depth and no whitespace. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

/** A stored answer: the success body, or the parts of the ApiError it was. */
type Answer =
  | { kind: "ok"; status: 200 | 201; body: unknown }
  | { kind: "error"; code: ErrorCode; message: string; fields?: Record<string, string> };

interface StoredResponse {
  fingerprint: string;
  answer: Answer;
}

const running = new Map<string, Promise<unknown>>();

interface Outcome {
  status: 200 | 201;
  body: unknown;
}

/**
 * Run a request once per Idempotency-Key. The same key with the same request replays the stored response;
 * with a different request it is a conflict. Only responses below 500 are stored, so a retry after an outage runs again.
 */
export async function idempotently(c: Ctx, userId: number, run: () => Promise<Outcome>): Promise<Response> {
  const key = c.req.header("idempotency-key");
  if (key === undefined) {
    const outcome = await run();
    return c.json(outcome.body, outcome.status);
  }
  if (key.length < 1 || key.length > 100) throw validationError({ "Idempotency-Key": "Use 1 to 100 characters." });
  const scope = `${userId}:${key}`;
  const previous = running.get(scope) ?? Promise.resolve();
  const turn = previous.then(() => once(c, userId, key, run));
  running.set(scope, turn.catch(() => undefined));
  return turn;
}

async function once(c: Ctx, userId: number, key: string, run: () => Promise<Outcome>): Promise<Response> {
  const fp = fingerprint(c.req.method, c.req.path, c.get("body"));
  await pool.query("delete from idempotency_keys where user_id = $1 and key = $2 and created_at <= now() - interval '24 hours'", [userId, key]);
  const stored = await one<StoredResponse>(
    pool,
    "select fingerprint, body as answer from idempotency_keys where user_id = $1 and key = $2",
    [userId, key],
  );
  if (stored) {
    if (stored.fingerprint !== fp) throw new ApiError("idempotency_key_reused");
    return replay(c, stored.answer);
  }
  const remember = (status: number, answer: Answer): Promise<unknown> =>
    pool.query("insert into idempotency_keys (user_id, key, fingerprint, status, body) values ($1, $2, $3, $4, $5) on conflict do nothing", [
      userId,
      key,
      fp,
      status,
      JSON.stringify(answer),
    ]);
  try {
    const outcome = await run();
    await remember(outcome.status, { kind: "ok", ...outcome });
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await remember(error.status, { kind: "error", code: error.code, message: error.message, fields: error.fields });
    }
    throw error;
  }
}

/** Answer again with what the key first answered; a stored error goes back through the error handler. */
function replay(c: Ctx, answer: Answer): Response {
  if (answer.kind === "ok") return c.json(answer.body, answer.status, { "Idempotent-Replayed": "true" });
  throw new ApiError(answer.code, answer.message, answer.fields, true);
}
