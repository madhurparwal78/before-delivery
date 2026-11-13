import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { isSafeReturn } from "../shared/safeReturn";
import { COPY } from "../shared/copy";
import { validName } from "../shared/params";
import { pool, one } from "./db";
import { ApiError, validation } from "./errors";
import { SESSION_COOKIE, hashToken, route, type Ctx, type Reply } from "./http";
import { newId } from "./ids";

const SESSION_SECONDS = 30 * 24 * 3600;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailKey = (email: string): string => email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "base64")), expected);
}

function sessionHeader(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)", [hashToken(token), userId, new Date(Date.now() + SESSION_SECONDS * 1000)]);
  return sessionHeader(token, SESSION_SECONDS);
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}
const publicUser = (row: UserRow): { id: string; email: string; displayName: string } => ({ id: row.id, email: row.email, displayName: row.display_name });

function record(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

async function landingFor(userId: string): Promise<string> {
  const last = await one<{ id: string }>(
    pool,
    "SELECT w.id FROM users u JOIN memberships m ON m.workspace_id = u.last_workspace_id AND m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id WHERE u.id = $1",
    [userId],
  );
  if (last) return `/w/${last.id}`;
  const earliest = await one<{ workspace_id: string }>(pool, "SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY joined_at ASC, workspace_id ASC LIMIT 1", [userId]);
  return earliest ? `/w/${earliest.workspace_id}` : "/workspaces/new";
}

async function signUp(ctx: Ctx): Promise<Reply> {
  const body = record(ctx.body);
  const displayName = text(body.displayName).trim();
  const email = text(body.email).trim();
  const password = text(body.password);
  const fields: Record<string, string> = {};
  if (!validName(displayName)) fields.displayName = COPY.displayName;
  if (!EMAIL_PATTERN.test(email)) fields.email = COPY.email;
  const length = [...password].length;
  if (length < 10 || length > 128) fields.password = COPY.password;
  if (Object.keys(fields).length > 0) throw validation(fields);
  const id = newId();
  const created = await one<UserRow>(
    pool,
    "INSERT INTO users (id, email, email_key, display_name, password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email_key) DO NOTHING RETURNING id, email, display_name",
    [id, email, emailKey(email), displayName, await hashPassword(password)],
  );
  if (!created) throw new ApiError(409, "email_taken", "An account already uses this email.", { email: COPY.emailTaken });
  const invite = text(body.invite);
  return { status: 201, json: { user: publicUser(created), landing: invite ? `/invite/${invite}` : "/workspaces/new" }, headers: { "set-cookie": await startSession(id) } };
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const body = record(ctx.body);
  const user = await one<UserRow & { password_hash: string }>(pool, "SELECT id, email, display_name, password_hash FROM users WHERE email_key = $1", [emailKey(text(body.email))]);
  const bad = new ApiError(401, "bad_credentials", COPY.badCredentials);
  if (!user || !(await passwordMatches(text(body.password), user.password_hash))) throw bad;
  const invite = text(body.invite);
  const wanted = text(body.return);
  const landing = invite ? `/invite/${invite}` : wanted && isSafeReturn(wanted) ? wanted : await landingFor(user.id);
  return { status: 200, json: { user: publicUser(user), landing }, headers: { "set-cookie": await startSession(user.id) } };
}

export function registerAuthRoutes(): void {
  route("POST", "/api/auth/sign-up", signUp, { public: true });
  route("POST", "/api/auth/sign-in", signIn, { public: true });
  route(
    "POST",
    "/api/auth/sign-out",
    async (ctx) => {
      const cookie = ctx.req.headers.cookie?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === SESSION_COOKIE);
      if (cookie?.[1]) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(cookie[1])]);
      return { status: 204, bytes: new Uint8Array(), headers: { "set-cookie": sessionHeader("", 0) } };
    },
    {},
  );
  route("GET", "/api/me", async (ctx) => {
    const spaces = await pool.query<{ id: string; name: string; role: string }>(
      "SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.joined_at, w.id",
      [ctx.user.id],
    );
    const last = await one<{ last_workspace_id: string | null }>(pool, "SELECT last_workspace_id FROM users WHERE id = $1", [ctx.user.id]);
    const lastId = last?.last_workspace_id && spaces.rows.some((w) => w.id === last.last_workspace_id) ? last.last_workspace_id : null;
    return { status: 200, json: { user: { id: ctx.user.id, email: ctx.user.email, displayName: ctx.user.displayName }, workspaces: spaces.rows, lastWorkspaceId: lastId } };
  });
}

