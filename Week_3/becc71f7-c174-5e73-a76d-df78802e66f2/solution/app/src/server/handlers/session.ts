import { randomBytes, randomUUID } from "node:crypto";
import type { Member, SessionBody } from "../../shared/api";
import type { Role } from "../../shared/catalog";
import { formatInstant } from "../../shared/format";
import { config } from "../config";
import { pool, transaction } from "../db";
import { ApiError, conflict, notFound } from "../errors";
import { DECOY_HASH, hashPassword, passwordMatches } from "../passwords";
import { noContent, reply, tokenHash, type Context, type Reply, type SignedIn } from "../pipeline";
import { EMAIL_MESSAGE, FieldProblems, isEmail, isText, isUuid, NAME_MESSAGE } from "../validate";

const HOME_ROUTES: Record<Role, string> = { owner: "/staff/consignors", assistant: "/staff/pieces", bookkeeper: "/staff/sales-book" };

const sessionBody = (member: SignedIn): SessionBody => ({
  member: { id: member.id, name: member.name, email: member.email, role: member.role },
  homeRoute: HOME_ROUTES[member.role],
});

export async function signIn({ body, now }: Context): Promise<Reply> {
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const { rows } = await pool.query<SignedIn & { password_hash: string }>("SELECT id, name, email, role, password_hash FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);
  const member = rows[0];
  const matches = await passwordMatches(password, member?.password_hash ?? DECOY_HASH);
  if (!member || !matches) throw new ApiError(401, "invalid_credentials", "That email and password don't match a member.");
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, member_id, ends_at) VALUES ($1, $2, $3)", [tokenHash(token), member.id, new Date(now.getTime() + config.sessionSeconds * 1000)]);
  return reply(200, sessionBody(member), { "Set-Cookie": `ourlet_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
}

export async function currentSession(_context: Context, member: SignedIn): Promise<Reply> {
  return reply(200, sessionBody(member));
}

export async function signOut({ sessionToken, now }: Context): Promise<Reply> {
  await pool.query("UPDATE sessions SET ended_at = $2 WHERE token_hash = $1", [tokenHash(String(sessionToken)), now]);
  return noContent();
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: Date;
}

const memberView = (row: MemberRow): Member => ({ id: row.id, name: row.name, email: row.email, role: row.role, createdAt: formatInstant(row.created_at) });

export async function listMembers(): Promise<Reply> {
  const { rows } = await pool.query<MemberRow>("SELECT id, name, email, role, created_at FROM members WHERE removed_at IS NULL ORDER BY created_at, name");
  return reply(200, { members: rows.map(memberView) });
}

const currentMembers = (id: string) => pool.query<MemberRow>("SELECT id, name, email, role, created_at FROM members WHERE id = $1 AND removed_at IS NULL", [id]);

export async function memberExists({ params }: Context): Promise<void> {
  if (!isUuid(params.id) || !(await currentMembers(params.id)).rows.length) throw notFound();
}

const STAFF_ROLES: readonly unknown[] = ["assistant", "bookkeeper"];
const ROLE_MESSAGE = "Choose Shop assistant or Bookkeeper.";

export async function addMember({ body, now }: Context): Promise<Reply> {
  const { name, email, password, role } = body;
  const problems = new FieldProblems();
  if (!isText(name, 80)) problems.add("name", NAME_MESSAGE);
  if (!isEmail(email)) problems.add("email", EMAIL_MESSAGE);
  if (typeof password !== "string" || password.length < 10 || password.length > 128) problems.add("password", "Use a starting password of 10 to 128 characters.");
  if (!STAFF_ROLES.includes(role)) problems.add("role", ROLE_MESSAGE);
  problems.check();
  const id = randomUUID();
  const inserted = await pool.query<MemberRow>(
    `INSERT INTO members (id, name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING id, name, email, role, created_at`,
    [id, name, email, await hashPassword(String(password)), role, now],
  );
  const row = inserted.rows[0];
  if (!row) throw conflict("member_email_taken", "A member already uses this email address.");
  return reply(201, { member: memberView(row) });
}

export async function getMember({ params }: Context): Promise<Reply> {
  const { rows: [row] } = await currentMembers(params.id);
  return reply(200, { member: memberView(row) });
}

export async function changeMemberRole({ params, body }: Context): Promise<Reply> {
  const problems = new FieldProblems();
  const { rows: [target] } = await currentMembers(params.id);
  if (!STAFF_ROLES.includes(body.role) || target.role === "owner") problems.add("role", ROLE_MESSAGE);
  problems.check();
  const { rows } = await pool.query<MemberRow>("UPDATE members SET role = $2 WHERE id = $1 RETURNING id, name, email, role, created_at", [params.id, body.role]);
  return reply(200, { member: memberView(rows[0]) });
}

export async function removeMember({ params, now }: Context): Promise<Reply> {
  const { rows: [target] } = await currentMembers(params.id);
  if (target.role === "owner") throw conflict("cannot_remove_owner", "The shop owner can't be removed.");
  await transaction(async (db) => {
    await db.query("UPDATE members SET removed_at = $2 WHERE id = $1", [params.id, now]);
    await db.query("UPDATE sessions SET ended_at = $2 WHERE member_id = $1 AND ended_at IS NULL", [params.id, now]);
  });
  return noContent();
}
