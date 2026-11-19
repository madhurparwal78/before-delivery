// Who the caller is and what they reach (brief: API > Conventions, Business rules > Tenancy, Seats).
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { many, one, pool, type Db } from "./db.js";
import { refuse } from "./errors.js";
import type { Context } from "./http.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

import type { Role } from "../shared/api.js";
import { seated } from "../shared/lifecycle.js";

export interface Account {
  id: string;
  email: string;
  display_name: string;
  handle: string;
  role: Role;
  group_id: string | null;
  workspace_id: string | null;
}

export interface Workspace {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  time_zone: string;
}

export const ACCOUNT_COLUMNS = "a.id, a.email, a.display_name, a.handle, a.role, a.group_id, a.workspace_id";
const WORKSPACE_COLUMNS = "w.id, w.group_id, w.slug, w.name, w.time_zone";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(32)}`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, saltHex = "", hashHex = ""] = (stored ?? DUMMY_HASH).split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), 32);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newToken = (): string => randomBytes(24).toString("base64url");

const COOKIE = "rushes_session";

export async function startSession(res: ServerResponse, accountId: string): Promise<void> {
  const token = newToken();
  await pool.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [tokenHash(token), accountId]);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000`);
}

function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=") || null;
  }
  return null;
}

export async function endSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = sessionToken(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function sessionAccount(req: IncomingMessage): Promise<Account | null> {
  const token = sessionToken(req);
  if (!token) return null;
  return one<Account>(pool, `SELECT ${ACCOUNT_COLUMNS} FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1`, [tokenHash(token)]);
}

export async function requireAccount(ctx: Context): Promise<Account> {
  const account = await sessionAccount(ctx.req);
  if (!account) throw refuse("unauthenticated");
  return account;
}

/** The workspaces an account belongs to, in seed order: an ops lead's whole group, a designer's one workspace. */
async function workspacesOf(db: Db, account: Account): Promise<Workspace[]> {
  if (account.role === "ops_lead") {
    return many<Workspace>(db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.group_id = $1 ORDER BY w.sort_order`, [account.group_id]);
  }
  if (account.role === "designer") {
    return many<Workspace>(db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [account.workspace_id]);
  }
  return [];
}

export const reaches = (account: Account, ws: Pick<Workspace, "id" | "group_id">): boolean =>
  (account.role === "ops_lead" && account.group_id === ws.group_id) || (account.role === "designer" && account.workspace_id === ws.id);

/** A workspace in the path; anything outside the caller's reach is unknown. */
export async function memberWorkspace(account: Account, slug: string): Promise<Workspace> {
  const ws = await one<Workspace>(pool, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.slug = $1`, [slug]);
  if (!ws || !reaches(account, ws)) throw refuse("not_found");
  return ws;
}

export async function workspaceById(db: Db, id: string): Promise<Workspace> {
  const ws = await one<Workspace>(db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [id]);
  if (!ws) throw refuse("not_found");
  return ws;
}

export function requireOpsLead(account: Account): void {
  if (account.role !== "ops_lead") throw refuse("forbidden");
}

/** "Seated": a designer holding a pro seat in that workspace, or an ops lead. */
async function isSeated(db: Db, account: Account, workspaceId: string): Promise<boolean> {
  const seat = account.role === "designer" ? await one(db, "SELECT 1 FROM seats WHERE account_id = $1 AND workspace_id = $2", [account.id, workspaceId]) : null;
  return seated(account.role, seat !== null);
}

export async function requireSeat(db: Db, account: Account, workspaceId: string): Promise<void> {
  if (!(await isSeated(db, account, workspaceId))) throw refuse("seat_required");
}

interface AccountView {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: Role;
  workspaces: Array<{ slug: string; name: string; timeZone: string; hasSeat: boolean }>;
}

export async function accountView(account: Account): Promise<AccountView> {
  const workspaces = await workspacesOf(pool, account);
  const holdsSeat = account.role === "designer" && workspaces[0] ? await isSeated(pool, account, workspaces[0].id) : false;
  return {
    id: account.id,
    email: account.email,
    displayName: account.display_name,
    handle: account.handle,
    role: account.role,
    workspaces: workspaces.map((w) => ({ slug: w.slug, name: w.name, timeZone: w.time_zone, hasSeat: holdsSeat })),
  };
}
