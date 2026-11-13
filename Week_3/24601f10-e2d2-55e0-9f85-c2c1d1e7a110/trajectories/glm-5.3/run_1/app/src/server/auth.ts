import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { errors } from "./errors.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { query, one, withTransaction, type Tx } from "./db.js";

export interface User {
  id: string;
  username: string;
}

const SESSION_COOKIE = "cupfold_session";

export function newId(): string {
  return randomBytes(12).toString("base64url");
}

export function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function applySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id text PRIMARY KEY,
      name text NOT NULL,
      format text NOT NULL,
      state text NOT NULL DEFAULT 'draft',
      fill text NOT NULL,
      time_zone text NOT NULL,
      organizer_id text NOT NULL REFERENCES users(id),
      checkin_closes_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      share_code text NOT NULL UNIQUE,
      logo_url text,
      logo_sha256 text,
      roster_file_name text,
      roster_sha256 text,
      roster_etag text,
      seeding_version int NOT NULL DEFAULT 1,
      swiss_rounds int,
      field_size int,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS co_organizers (
      tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (tournament_id, user_id)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS entrants (
      id text PRIMARY KEY,
      tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name text NOT NULL,
      seed int NOT NULL,
      username text,
      user_id text,
      checked_in boolean NOT NULL DEFAULT false,
      UNIQUE (tournament_id, username)
    )`);
  await query(`
    CREATE INDEX IF NOT EXISTS entrants_tournament_idx ON entrants (tournament_id, seed)`);
  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id text PRIMARY KEY,
      tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      bracket text NOT NULL,
      round int NOT NULL,
      number int NOT NULL,
      label text NOT NULL,
      upper_entrant_id text,
      upper_is_bye boolean NOT NULL DEFAULT false,
      lower_entrant_id text,
      lower_is_bye boolean NOT NULL DEFAULT false,
      state text NOT NULL DEFAULT 'pending',
      upper_games int,
      lower_games int,
      winner text,
      report jsonb,
      dispute jsonb,
      called_at timestamptz,
      overdue boolean NOT NULL DEFAULT false,
      version int NOT NULL DEFAULT 1,
      updated_by text,
      paired_at timestamptz,
      UNIQUE (tournament_id, bracket, round, number)
    )`);
  await query(`
    CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches (tournament_id)`);
  await query(`
    CREATE TABLE IF NOT EXISTS feed_edges (
      tournament_id text NOT NULL,
      from_match text NOT NULL,
      to_match text NOT NULL,
      side text NOT NULL,
      kind text NOT NULL,
      PRIMARY KEY (tournament_id, from_match, to_match, side)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS live_seq (
      tournament_id text PRIMARY KEY,
      seq bigint NOT NULL DEFAULT 0
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS live_messages (
      tournament_id text NOT NULL,
      seq bigint NOT NULL,
      type text NOT NULL,
      data jsonb NOT NULL,
      at timestamptz NOT NULL,
      PRIMARY KEY (tournament_id, seq)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key text PRIMARY KEY,
      window_start timestamptz NOT NULL,
      count int NOT NULL
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS history_rows (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tournament_id text NOT NULL,
      tournament_name text NOT NULL,
      entrant_id text,
      place int NOT NULL,
      field_size int NOT NULL,
      finished_on date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, tournament_id)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS previews (
      token text PRIMARY KEY,
      tournament_id text NOT NULL,
      match_id text NOT NULL,
      upper_games int NOT NULL,
      lower_games int NOT NULL,
      dependents jsonb NOT NULL,
      versions jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = createHash("sha256").update(salt).update(password).digest();
  return `s1:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [tag, saltText, hashText] = stored.split(":");
  if (tag !== "s1") return false;
  const salt = Buffer.from(saltText ?? "", "base64url");
  const expect = Buffer.from(hashText ?? "", "base64url");
  const hash = createHash("sha256").update(salt).update(password).digest();
  return hash.length === expect.length && timingSafeEqual(hash, expect);
}

export function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + clockOffset + offsetMs).toISOString();
}

/** Server clock offset for grading clock moves. */
let clockOffset = 0;
export function advanceClock(ms: number): void {
  clockOffset += ms;
}
export function resetClock(): void {
  clockOffset = 0;
}
export function serverNowMs(): number {
  return Date.now() + clockOffset;
}
export function nowMsIso(): string {
  return new Date(serverNowMs()).toISOString();
}

export async function validateSignup(
  tx: Tx,
  usernameRaw: string,
  password: string
): Promise<{ username: string; id: string }> {
  const username = String(usernameRaw ?? "").toLowerCase();
  const fields: Record<string, string> = {};
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fields.username = "Use 3 to 24 characters: a-z, 0-9 or _.";
  if (typeof password !== "string" || password.length < 8) fields.password = "Use at least 8 characters.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const existing = await tx.one<{ id: string }>("SELECT id FROM users WHERE username = $1", [username]);
  if (existing) throw errors.usernameTaken();
  const id = newId();
  await tx.query("INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)", [
    id,
    username,
    hashPassword(password),
  ]);
  return { username, id };
}

export async function signup(username: string, password: string): Promise<User> {
  return withTransaction(async (tx) => {
    const u = await validateSignup(tx, username, password);
    return { id: u.id, username: u.username };
  });
}

export async function signin(usernameRaw: string, password: string): Promise<User> {
  const username = String(usernameRaw ?? "").toLowerCase();
  const now = serverNowMs();
  const rl = await one<{ key: string; window_start: string; count: number }>(
    "SELECT * FROM rate_limits WHERE key = $1",
    [`login:${username}`]
  );
  if (rl) {
    const windowStart = new Date(rl.window_start).getTime();
    if (now - windowStart < 60000) {
      if (rl.count >= config.loginRate) throw errors.rateLimitedLogin();
    }
  }
  const user = await one<{ id: string; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [username]
  );
  if (!user || !verifyPassword(password ?? "", user.password_hash)) {
    await bumpRateLimit(`login:${username}`, now);
    throw errors.badCredentials();
  }
  await clearRateLimit(`login:${username}`);
  return { id: user.id, username: user.username };
}

export async function bumpRateLimit(key: string, now: number): Promise<void> {
  const existing = await one<{ window_start: string; count: number }>(
    "SELECT window_start, count FROM rate_limits WHERE key = $1",
    [key]
  );
  if (!existing || now - new Date(existing.window_start).getTime() >= 60000) {
    await query(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, to_timestamp($2/1000.0), 1)
       ON CONFLICT (key) DO UPDATE SET window_start = to_timestamp($2/1000.0), count = 1`,
      [key, now]
    );
  } else {
    await query("UPDATE rate_limits SET count = count + 1 WHERE key = $1", [key]);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  await query("DELETE FROM rate_limits WHERE key = $1", [key]);
}

export async function consumeMatchRate(userId: string): Promise<void> {
  const now = serverNowMs();
  const key = `write:${userId}`;
  const existing = await one<{ window_start: string; count: number }>(
    "SELECT window_start, count FROM rate_limits WHERE key = $1",
    [key]
  );
  if (!existing || now - new Date(existing.window_start).getTime() >= 60000) {
    await query(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, to_timestamp($2/1000.0), 0)
       ON CONFLICT (key) DO UPDATE SET window_start = to_timestamp($2/1000.0), count = 0`,
      [key, now]
    );
  }
  const row = await one<{ count: number }>("SELECT count FROM rate_limits WHERE key = $1", [key]);
  if ((row?.count ?? 0) >= config.reportRate) throw errors.rateLimitedReport();
  await query("UPDATE rate_limits SET count = count + 1 WHERE key = $1", [key]);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function userFromRequest(req: IncomingMessage): Promise<User | null> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<{ id: string; username: string }>(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  return row ?? null;
}

export async function createSession(res: ServerResponse, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  setSessionCookie(res, token);
  return token;
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function destroySession(req: IncomingMessage): Promise<void> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function findUserByUsername(username: string): Promise<User | null> {
  return one<{ id: string; username: string }>("SELECT id, username FROM users WHERE username = $1", [
    String(username ?? "").toLowerCase(),
  ]);
}

export async function getUserById(id: string): Promise<{ id: string; username: string } | null> {
  return one<{ id: string; username: string }>("SELECT id, username FROM users WHERE id = $1", [id]);
}
