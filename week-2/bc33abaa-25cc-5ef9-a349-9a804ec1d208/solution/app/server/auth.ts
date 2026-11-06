// Credentials: member sessions in the orrery_session cookie, agent tokens as bearer secrets.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Author, Role, Scope } from "../shared/api-types.js";
import { one, pool, type Db } from "./db.js";

const scrypt = (password: string, salt: Buffer, keylen: number) => new Promise<Buffer>((resolve, reject) =>
  scryptCallback(password, salt, keylen, (error, key) => (error ? reject(error) : resolve(key))));

const SESSION_COOKIE = "orrery_session";

interface MemberCaller { kind: "member"; id: string; name: string; email: string; role: Role; workspaceId: string; sessionHash: string }
interface AgentCaller { kind: "agent"; id: string; name: string; scope: Scope; workspaceId: string }
export type Caller = MemberCaller | AgentCaller;

export const SCHEDULER: Author = { kind: "system", id: "system", name: "Orrery scheduler" };

export function authorOf(caller: Caller): Author {
  return { kind: caller.kind, id: caller.id, name: caller.name };
}

export function secretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function agentSecret(): string {
  const random = randomBytes(48);
  return `orr_${Array.from(random, (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join("")}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export async function startSession(db: Db, memberId: string): Promise<string> {
  const token = randomToken();
  await db.query("INSERT INTO sessions (token_hash, member_id, created_at) VALUES ($1, $2, now())", [secretHash(token), memberId]);
  return token;
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

interface MemberRow { id: string; name: string; email: string; role: Role; workspace_id: string }
interface TokenRow { id: string; name: string; scope: Scope; workspace_id: string }

/** The caller a request's credential names; when an Authorization header is present the cookie is ignored. */
export async function authenticate(headers: IncomingHttpHeaders, db: Db = pool): Promise<Caller | null> {
  const authorization = headers.authorization;
  if (authorization !== undefined) {
    const bearer = /^Bearer (\S+)$/.exec(authorization);
    if (!bearer) return null;
    const token = await one<TokenRow>(db,
      "SELECT id, name, scope, workspace_id FROM agent_tokens WHERE secret_hash = $1 AND revoked_at IS NULL AND expires_at > $2",
      [secretHash(bearer[1]), new Date()]);
    return token ? { kind: "agent", id: token.id, name: token.name, scope: token.scope, workspaceId: token.workspace_id } : null;
  }
  const session = cookieValue(headers.cookie, SESSION_COOKIE);
  if (!session) return null;
  const sessionHash = secretHash(session);
  const member = await one<MemberRow>(db,
    `SELECT m.id, m.name, m.email, m.role, m.workspace_id FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.ended_at IS NULL AND m.removed_at IS NULL`, [sessionHash]);
  return member
    ? { kind: "member", id: member.id, name: member.name, email: member.email, role: member.role, workspaceId: member.workspace_id, sessionHash }
    : null;
}
