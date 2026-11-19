import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pool } from "./db";
import type { Person, Role } from "../shared/types";

const SESSION_COOKIE = "sid";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function tokenOf(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie ?? "";
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([0-9a-f]+)`).exec(cookie);
  return match ? match[1] : null;
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = tokenOf(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function sessionPerson(req: IncomingMessage): Promise<Person | null> {
  const token = tokenOf(req);
  if (!token) return null;
  const found = await pool.query(
    `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.created_at > now() - make_interval(secs => $2)`,
    [tokenHash(token), SESSION_SECONDS],
  );
  return found.rowCount === 0 ? null : { id: found.rows[0].id, name: found.rows[0].name, email: found.rows[0].email };
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export async function roleIn(workspaceId: string, userId: string): Promise<Role | null> {
  const found = await pool.query("SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return found.rowCount === 0 ? null : found.rows[0].role;
}

interface ProjectAccess {
  projectId: string;
  workspaceId: string;
  role: Role;
}

export async function projectAccess(userId: string, projectId: string): Promise<ProjectAccess | null> {
  const found = await pool.query(
    `SELECT p.workspace_id, m.role FROM projects p JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = $2 WHERE p.id = $1`,
    [projectId, userId],
  );
  return found.rowCount === 0 ? null : { projectId, workspaceId: found.rows[0].workspace_id, role: found.rows[0].role };
}

interface ItemAccess extends ProjectAccess {
  itemId: string;
}

export async function itemAccess(userId: string, itemId: string): Promise<ItemAccess | null> {
  const found = await pool.query(
    `SELECT i.project_id, p.workspace_id, m.role FROM items i JOIN projects p ON p.id = i.project_id
       JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = $2 WHERE i.id = $1`,
    [itemId, userId],
  );
  return found.rowCount === 0
    ? null
    : { itemId, projectId: found.rows[0].project_id, workspaceId: found.rows[0].workspace_id, role: found.rows[0].role };
}
