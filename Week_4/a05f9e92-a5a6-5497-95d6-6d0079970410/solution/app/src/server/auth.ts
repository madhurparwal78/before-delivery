import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ROLES, type Role, type SessionUser } from "../shared/types.js";
import { query } from "./db.js";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":") as [string, string];
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export interface Session {
  token: string;
  user: SessionUser;
  /** The signed-in person; differs from `user` while impersonating. */
  actor: SessionUser;
  workspace: "live" | "test";
  impersonating: { username: string; display_name: string } | null;
}

export async function loadUser(username: string): Promise<SessionUser | null> {
  const rows = await query(
    "SELECT p.username, p.display_name, p.department, p.active, u.roles, u.time_zone FROM people p JOIN users u ON u.username = p.username WHERE p.username = $1",
    [username],
  );
  const r = rows[0];
  if (!r || r.active !== true) return null;
  const roles = (r.roles as string[]).filter((x): x is Role => (ROLES as readonly string[]).includes(x));
  return { username: r.username as string, display_name: r.display_name as string, roles, department: r.department as string, time_zone: r.time_zone as string };
}

export async function startSession(username: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions (token, username) VALUES ($1, $2)", [token, username]);
  return token;
}

export async function sessionFor(token: string | null): Promise<Session | null> {
  if (!token) return null;
  const rows = await query("SELECT username, workspace, impersonating FROM sessions WHERE token = $1", [token]);
  const row = rows[0];
  if (!row) return null;
  const actor = await loadUser(row.username as string);
  if (!actor) return null;
  const target = row.impersonating ? await loadUser(row.impersonating as string) : null;
  return {
    token,
    actor,
    user: target ?? actor,
    workspace: row.workspace as "live" | "test",
    impersonating: target ? { username: target.username, display_name: target.display_name } : null,
  };
}
