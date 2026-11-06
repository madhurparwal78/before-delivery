// Sign-in, sessions, invitations and password resets (brief: API → Health and auth; Accounts and sessions).
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { COPY } from "../shared/copy";
import { instantText } from "../shared/time";
import { config } from "./config";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { ApiError, type Ctx, type Json, reply, route, validationFailed } from "./http";
import { queueMail } from "./mail";
import { checkEmail, checkPassword, failed, isUuid, requiredText } from "./validate";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export const ROLES = ["launch_producer", "merchandiser", "finance_lead", "press_lead", "stockist_buyer"] as const;
export type Role = (typeof ROLES)[number];

export interface Member {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  email: string;
  role: Role;
  stockistId: string | null;
  createdAt: Date;
}

const COOKIE = "hourline_session";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  const derived = await scrypt(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}

const DUMMY_HASH = `${"00".repeat(16)}:${"00".repeat(32)}`;

export function memberJson(m: Member): Json {
  return { id: m.id, name: m.name, email: m.email, role: m.role, stockistId: m.stockistId, createdAt: instantText(m.createdAt.getTime()) };
}

const MEMBER_SQL = `SELECT m.id, m.workspace_id AS "workspaceId", w.name AS "workspaceName", m.name, m.email, m.role,
  m.stockist_id AS "stockistId", m.created_at AS "createdAt" FROM members m JOIN workspaces w ON w.id = m.workspace_id`;

export async function memberById(db: Db, id: string): Promise<Member | undefined> {
  return isUuid(id) ? one<Member>(db, `${MEMBER_SQL} WHERE m.id = $1 AND m.removed_at IS NULL`, [id]) : undefined;
}

/** A member the caller has just read or written in the same transaction. */
async function knownMember(db: Db, id: string): Promise<Member> {
  const [member] = await rows<Member>(db, `${MEMBER_SQL} WHERE m.id = $1`, [id]);
  return member;
}

function sessionToken(ctx: Ctx): string | null {
  const cookie = ctx.header("cookie") ?? "";
  for (const piece of cookie.split(";")) {
    const [name, ...rest] = piece.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

/** Step 4 of the ladder: the signed-in member, or the matching 401. */
export async function staff(ctx: Ctx): Promise<Member> {
  const token = sessionToken(ctx);
  const session = token
    ? await one<{ created_at: Date; signed_out_at: Date | null; member_id: string; removed_at: Date | null }>(
        pool,
        "SELECT s.created_at, s.signed_out_at, s.member_id, m.removed_at FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1",
        [sha256(token)],
      )
    : undefined;
  if (!session || session.signed_out_at) throw new ApiError(401, "unauthenticated", COPY.unauthenticated);
  if (Date.now() >= session.created_at.getTime() + config.ttl.session * 1000) throw new ApiError(401, "session_ended", COPY.sessionEnded);
  if (session.removed_at) throw new ApiError(401, "access_removed", COPY.accessRemoved);
  return knownMember(pool, session.member_id);
}

/** Step 6 of the ladder. */
export function requireRole(member: Member, ...roles: Role[]): void {
  if (!roles.includes(member.role)) throw new ApiError(403, "forbidden", COPY.forbidden);
}

async function startSession(db: Db, memberId: string): Promise<Record<string, string>> {
  const token = randomToken();
  await db.query("INSERT INTO sessions (token_hash, member_id, created_at) VALUES ($1, $2, $3)", [sha256(token), memberId, new Date()]);
  const secure = config.publicUrl.startsWith("https:") ? "; Secure" : "";
  return { "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}` };
}

const invalidCredentials = (): ApiError => new ApiError(401, "invalid_credentials", COPY.invalidCredentials);

route("POST", "/api/auth/sign-in", "json", async (ctx) => {
  const body = ctx.json();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const found = await one<{ id: string; password_hash: string }>(
    pool,
    "SELECT id, password_hash FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL",
    [email],
  );
  const matches = await passwordMatches(password, found?.password_hash ?? DUMMY_HASH);
  if (!found || !matches) throw invalidCredentials();
  const cookie = await startSession(pool, found.id);
  return reply(200, { member: memberJson(await knownMember(pool, found.id)) }, cookie);
});

route("POST", "/api/auth/sign-out", "none", async (ctx) => {
  const token = sessionToken(ctx);
  if (token) await pool.query("UPDATE sessions SET signed_out_at = $2 WHERE token_hash = $1", [sha256(token), new Date()]);
  return reply(204, undefined, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
});

route("GET", "/api/auth/session", "none", async (ctx) => {
  const member = await staff(ctx);
  return reply(200, { member: memberJson(member), workspace: { id: member.workspaceId, name: member.workspaceName } });
});

route("POST", "/api/auth/password-reset", "json", async (ctx) => {
  const body = ctx.json();
  const fields: Record<string, string> = {};
  const email = checkEmail(body.email, "email", fields);
  if (failed(fields)) throw validationFailed(fields);
  const member = await one<{ id: string; workspace_id: string; name: string; email: string }>(
    pool,
    "SELECT id, workspace_id, name, email FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL",
    [email],
  );
  if (member) {
    await tx(async (db) => {
      const token = randomToken();
      const issued = nowSeconds();
      await db.query(
        "INSERT INTO account_links (token_hash, kind, workspace_id, member_id, email, issued_at, expires_at) VALUES ($1, 'reset', $2, $3, $4, $5, $6)",
        [sha256(token), member.workspace_id, member.id, member.email, issued, new Date(issued.getTime() + config.ttl.reset * 1000)],
      );
      await queueMail(db, {
        toName: member.name,
        toEmail: member.email,
        subject: "Reset your Hourline password",
        body: `Hello ${member.name},\n\nChoose a new Hourline password here:\n${config.publicUrl}/reset-password/${token}\n\nThe link works once and expires in ${Math.round(config.ttl.reset / 60)} minutes. If you did not ask for it, ignore this email.\n`,
      });
    });
  }
  return reply(202, { status: "reset_requested" });
});

interface AccountLink {
  token_hash: string;
  kind: string;
  workspace_id: string;
  member_id: string | null;
  email: string;
  role: Role | null;
  stockist_id: string | null;
  expires_at: Date;
  used_at: Date | null;
}

/** A link that still works, or the 410 for a used or expired one. */
async function liveLink(db: Db, token: unknown, kind: string): Promise<AccountLink> {
  const link =
    typeof token === "string"
      ? await one<AccountLink>(db, "SELECT * FROM account_links WHERE token_hash = $1 AND kind = $2 FOR UPDATE", [sha256(token), kind])
      : undefined;
  const dead = kind === "reset" ? COPY.resetDead : COPY.inviteDead;
  if (!link) throw new ApiError(404, "not_found", dead);
  if (link.used_at) throw new ApiError(410, "link_used", dead);
  if (Date.now() >= link.expires_at.getTime()) throw new ApiError(410, "link_expired", dead);
  return link;
}

route("POST", "/api/auth/password-reset/complete", "json", async (ctx) => {
  const body = ctx.json();
  return tx(async (db) => {
    const link = await liveLink(db, body.token, "reset");
    const fields: Record<string, string> = {};
    const password = checkPassword(body.password, "password", fields);
    if (failed(fields)) throw validationFailed(fields);
    await db.query("UPDATE members SET password_hash = $2 WHERE id = $1", [link.member_id, await hashPassword(password)]);
    await db.query("UPDATE account_links SET used_at = $2 WHERE token_hash = $1", [link.token_hash, new Date()]);
    const member = await knownMember(db, link.member_id ?? "");
    const cookie = await startSession(db, member.id);
    return reply(200, { member: memberJson(member) }, cookie);
  });
});

route("POST", "/api/auth/invitations/accept", "json", async (ctx) => {
  const body = ctx.json();
  return tx(async (db) => {
    const link = await liveLink(db, body.token, "invite");
    const fields: Record<string, string> = {};
    const name = requiredText(body.name, "name", 80, fields);
    const password = checkPassword(body.password, "password", fields);
    if (failed(fields)) throw validationFailed(fields);
    const taken = await one(db, "SELECT 1 FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [link.email]);
    if (taken) throw new ApiError(410, "link_used", COPY.inviteDead);
    const created = await one<{ id: string }>(
      db,
      "INSERT INTO members (workspace_id, name, email, role, stockist_id, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [link.workspace_id, name, link.email, link.role, link.stockist_id, await hashPassword(password), nowSeconds()],
    );
    await db.query("UPDATE account_links SET used_at = $2 WHERE token_hash = $1", [link.token_hash, new Date()]);
    const member = await knownMember(db, created?.id ?? "");
    const cookie = await startSession(db, member.id);
    return reply(201, { member: memberJson(member) }, cookie);
  });
});

