import type { IncomingMessage } from "node:http";
import { db, write, type Tx } from "./db.js";
import { ApiError, Fields, checkBody, parseCookies, type Reply, type Spec } from "./http.js";
import { config } from "./config.js";
import { now } from "./clock.js";
import { hashToken, newToken } from "./crypto.js";
import { passwordGrant, KeycloakUnavailable } from "./keycloak.js";
import { landingFor } from "./landing.js";
import type { PersonRow } from "./model.js";
import { nextNineteen, officeStamp } from "./office-time.js";
import { personJson } from "./people-view.js";

const COOKIE = "lockset_session";

export interface Session {
  tokenHash: string;
  person: PersonRow;
  startedAt: Date;
  endsAt: Date;
}

interface SessionRow {
  token_hash: string;
  person_id: string;
  started_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
}

const signedOut = (): ApiError => new ApiError(401, "signed_out", "Sign in to continue.");

/** Resolves the cookie to a live session, or refuses with signed_out / session_ended. */
export async function authenticate(req: IncomingMessage): Promise<Session> {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) throw signedOut();
  const tokenHash = hashToken(token);
  const row = await db.one<SessionRow>("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash]);
  if (!row) throw signedOut();
  const person = await db.one<PersonRow>("SELECT * FROM people WHERE id = $1", [row.person_id]);
  if (!person || person.left_at || row.revoked_at) throw signedOut();
  if (now().getTime() >= row.ends_at.getTime()) throw new ApiError(401, "session_ended", "Your reveal session has ended.");
  return { tokenHash, person, startedAt: row.started_at, endsAt: row.ends_at };
}

function sessionEnd(startedAt: Date): Date {
  const byLimit = new Date(startedAt.getTime() + config.revealSessionSeconds * 1000);
  const byCutOff = nextNineteen(startedAt);
  return byLimit.getTime() < byCutOff.getTime() ? byLimit : byCutOff;
}

export function revokeSessions(tx: Tx, personId: string, at: Date): Promise<unknown[]> {
  return tx.query("UPDATE sessions SET revoked_at = $2 WHERE person_id = $1 AND revoked_at IS NULL", [personId, at]);
}

// ---- sign-in lockout ----

interface LockRow {
  handle: string;
  failures: number;
  window_started_at: Date;
  locked_until: Date | null;
}

const FAILURES_TO_LOCK = 5;

function lockKey(username: unknown): string {
  return typeof username === "string" ? username.trim().toLowerCase().slice(0, 64) : "";
}

/** Throws 429 sign_in_locked while the handle is locked. Real and unknown handles answer identically. */
export async function refuseWhileLocked(username: unknown): Promise<void> {
  const row = await db.one<LockRow>("SELECT * FROM sign_in_state WHERE handle = $1", [lockKey(username)]);
  if (!row?.locked_until || row.locked_until.getTime() <= now().getTime()) return;
  const seconds = Math.max(1, Math.ceil((row.locked_until.getTime() - now().getTime()) / 1000));
  throw new ApiError(
    429,
    "sign_in_locked",
    `Too many tries. Sign-in for this username reopens at ${officeStamp(row.locked_until)}.`,
    undefined,
    { "Retry-After": String(seconds) },
  );
}

async function recordFailure(username: unknown): Promise<void> {
  const handle = lockKey(username);
  await write(async (tx) => {
    const at = now();
    const row = await tx.one<LockRow>("SELECT * FROM sign_in_state WHERE handle = $1", [handle]);
    const windowMs = config.signInLockSeconds * 1000;
    const fresh = !row || at.getTime() - row.window_started_at.getTime() >= windowMs;
    const failures = fresh ? 1 : row.failures + 1;
    const started = fresh || !row ? at : row.window_started_at;
    const lockedUntil = failures >= FAILURES_TO_LOCK ? new Date(at.getTime() + windowMs) : null;
    await tx.query(
      `INSERT INTO sign_in_state (handle, failures, window_started_at, locked_until) VALUES ($1,$2,$3,$4)
       ON CONFLICT (handle) DO UPDATE SET failures = $2, window_started_at = $3, locked_until = $4`,
      [handle, failures, started, lockedUntil],
    );
  });
}

const SIGN_IN: Spec = {
  username: { kind: "string" },
  password: { kind: "string" },
  next: { kind: "any", optional: true },
};

export async function signIn(body: unknown): Promise<Reply> {
  const fields = new Fields();
  const values = checkBody(body, SIGN_IN, fields);
  fields.throwIfAny();
  const username = String(values.username);
  const handle = lockKey(username);
  const person = await db.one<PersonRow>("SELECT * FROM people WHERE handle = $1", [handle]);
  let grant: Awaited<ReturnType<typeof passwordGrant>> = "bad_credentials";
  if (person) {
    try {
      grant = await passwordGrant(person.handle, String(values.password));
    } catch (error) {
      if (error instanceof KeycloakUnavailable) {
        throw new ApiError(503, "sign_in_unavailable", "Sign-in is unavailable right now. Try again in a minute.");
      }
      throw error;
    }
  }
  if (grant === "account_disabled") {
    throw new ApiError(401, "account_disabled", "This sign-in is switched off. Ask the office manager.");
  }
  if (grant === "bad_credentials" || !person) {
    await recordFailure(username);
    throw new ApiError(401, "bad_credentials", "That username and password don't match.");
  }
  const token = newToken();
  const startedAt = now();
  const endsAt = sessionEnd(startedAt);
  const landing = await write(async (tx) => {
    await tx.query("DELETE FROM sign_in_state WHERE handle = $1", [handle]);
    await tx.query("INSERT INTO sessions (token_hash, person_id, started_at, ends_at) VALUES ($1,$2,$3,$4)", [
      hashToken(token),
      person.id,
      startedAt,
      endsAt,
    ]);
    await tx.query("UPDATE people SET first_sign_in_at = COALESCE(first_sign_in_at, $2) WHERE id = $1", [person.id, startedAt]);
    return landingFor(tx, person, values.next);
  });
  const fresh = await db.one<PersonRow>("SELECT * FROM people WHERE id = $1", [person.id]);
  return {
    status: 201,
    body: { person: await personJson(db, fresh ?? person, now()), session_ends_at: endsAt.toISOString(), landing },
    headers: { "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` },
  };
}

export async function signOut(req: IncomingMessage): Promise<Reply> {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await write((tx) => tx.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1", [hashToken(token), now()]));
  return { status: 204, headers: { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
}
