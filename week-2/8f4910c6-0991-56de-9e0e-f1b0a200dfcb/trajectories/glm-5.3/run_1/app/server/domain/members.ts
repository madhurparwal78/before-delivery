import { query, one, withTransaction } from "../db.js";
import { errors } from "../http/errors.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import { randomToken, OFFICES, ROLE_HOME, type Office } from "../../shared/domain.js";
import { config } from "../config.js";
import { queueEmail } from "./outbox.js";
import { memberRow, publicMember, type SessionMember } from "./sessions.js";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  office: string;
  talent_id: string | null;
  removed_at: Date | null;
  created_at: Date;
}

export async function findByEmail(email: string): Promise<MemberRow | null> {
  return one<MemberRow>(`SELECT * FROM members WHERE lower(email) = lower($1)`, [email]);
}

export async function signIn(email: string, password: string): Promise<{ member: SessionMember; home: string }> {
  const row = await findByEmail(email);
  if (!row || row.removed_at) throw errors.invalidCredentials();
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw errors.invalidCredentials();
  const member = memberRow(row);
  return { member, home: ROLE_HOME[member.role] || "/workspace/board" };
}

export async function memberView(row: { id: string; name: string; email: string; role: string; office: string; talent_id: string | null }): Promise<Record<string, unknown>> {
  return { id: row.id, name: row.name, email: row.email, role: row.role, office: row.office, talentId: row.talent_id };
}

export async function listMembers(): Promise<unknown> {
  const rows = await query<{ id: string; name: string; email: string; role: string; office: string; talent_id: string | null }>(
    `SELECT id, name, email, role, office, talent_id FROM members WHERE removed_at IS NULL ORDER BY name`
  );
  return { members: rows.map((r) => publicMember(memberRow(r))) };
}

export async function getMember(id: string): Promise<Record<string, unknown>> {
  const row = await one<{ id: string; name: string; email: string; role: string; office: string; talent_id: string | null }>(
    `SELECT id, name, email, role, office, talent_id FROM members WHERE id = $1 AND removed_at IS NULL`,
    [id]
  );
  if (!row) throw errors.notFound();
  return memberView(row);
}

/** Sends a single-use password reset link only when the email belongs to a member. */
export async function requestPasswordReset(email: string): Promise<string> {
  const member = await findByEmail(email);
  if (member && !member.removed_at) {
    const token = randomToken(40);
    await query(`DELETE FROM password_resets WHERE member_id = $1`, [member.id]);
    await query(`INSERT INTO password_resets (token, member_id, expires_at) VALUES ($1, $2, $3)`, [token, member.id, new Date(Date.now() + 86400 * 1000)]);
    const link = `${config.baseUrl}/reset/${token}`;
    await queueEmail({
      to: member.email,
      subject: "Reset your Rungboard password",
      body: [`Hello,`, ``, `Use this link to set a new Rungboard password:`, ``, link, ``, `Vesper & Rowe Talent`].join("\r\n"),
    });
  }
  return "If that address has an account, a reset link is on its way.";
}

export async function completePasswordReset(token: string, password: string): Promise<SessionMember> {
  const row = await one<{ token: string; member_id: string; expires_at: Date; used_at: Date | null }>(
    `SELECT * FROM password_resets WHERE token = $1`,
    [token]
  );
  if (!row) throw errors.notFound();
  if (row.used_at) throw errors.gone("link_used");
  const member = await one<MemberRow>(`SELECT * FROM members WHERE id = $1`, [row.member_id]);
  if (!member || member.removed_at) throw errors.gone("link_used");
  const hash = await hashPassword(password);
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE members SET password_hash = $2 WHERE id = $1`, [member.id, hash]);
    await tx.query(`UPDATE password_resets SET used_at = now() WHERE token = $1`, [token]);
  });
  return memberRow(member);
}

/** Invitations: identical replies whether or not the email already has an account. */
export async function createInvitation(input: { email: string; name: string; role: string; office: string; talentId?: string | null }, director: SessionMember): Promise<string> {
  void director;
  const existing = await findByEmail(input.email);
  if (existing && !existing.removed_at) {
    return "If that address has no account yet, an invitation is on its way.";
  }
  if (input.talentId) {
    const talent = await one<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = $1`, [input.talentId]);
    if (!talent || talent.state === "erased") throw errors.notFound();
  }
  const token = randomToken(40);
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM invitations WHERE email = lower($1) AND used_at IS NULL`, [input.email]);
    await tx.query(
      `INSERT INTO invitations (token, email, name, role, office, talent_id, expires_at) VALUES ($1, lower($2), $3, $4, $5, $6, $7)`,
      [token, input.email, input.name, input.role, input.office, input.talentId || null, new Date(Date.now() + 7 * 86400 * 1000)]
    );
  });
  const link = `${config.baseUrl}/invite/${token}`;
  await queueEmail({
    to: input.email,
    subject: "You're invited to Rungboard",
    body: [`Hello,`, ``, `You have been invited to Rungboard. Set your password here:`, ``, link, ``, `Vesper & Rowe Talent`].join("\r\n"),
  });
  return "If that address has no account yet, an invitation is on its way.";
}

export async function acceptInvitation(token: string, password: string): Promise<SessionMember> {
  const row = await one<{ token: string; email: string; name: string; role: string; office: string; talent_id: string | null; expires_at: Date; used_at: Date | null }>(
    `SELECT * FROM invitations WHERE token = $1`,
    [token]
  );
  if (!row) throw errors.notFound();
  if (row.used_at) throw errors.gone("link_used");
  const hash = await hashPassword(password);
  let member: SessionMember | null = null;
  await withTransaction(async (tx) => {
    const claimed = await tx.one<{ token: string }>(`UPDATE invitations SET used_at = now() WHERE token = $1 AND used_at IS NULL RETURNING token`, [token]);
    if (!claimed) throw errors.gone("link_used");
    const existing = await tx.one<MemberRow>(`SELECT * FROM members WHERE lower(email) = lower($1)`, [row.email]);
    if (existing) {
      await tx.query(`UPDATE members SET password_hash = $2, role = $3, office = $4 WHERE id = $1`, [existing.id, hash, row.role, row.office]);
      member = memberRow({ ...existing, role: row.role, office: row.office });
    } else {
      const id = `mem_${randomToken(12)}`;
      await tx.query(`INSERT INTO members (id, name, email, password_hash, role, office, talent_id) VALUES ($1, $2, lower($3), $4, $5, $6, $7)`, [
        id,
        row.name,
        row.email,
        hash,
        row.role,
        row.office,
        row.talent_id,
      ]);
      const fresh = await tx.one<MemberRow>(`SELECT * FROM members WHERE id = $1`, [id]);
      if (fresh) member = memberRow(fresh);
    }
  });
  if (!member) throw errors.notFound();
  return member;
}

export async function changeRole(id: string, role: string, director: SessionMember): Promise<Record<string, unknown>> {
  if (id === director.id) throw errors.conflict("own_membership");
  const row = await one<MemberRow>(`SELECT * FROM members WHERE id = $1 AND removed_at IS NULL`, [id]);
  if (!row) throw errors.notFound();
  await query(`UPDATE members SET role = $2 WHERE id = $1`, [id, role]);
  const fresh = await one<{ id: string; name: string; email: string; role: string; office: string; talent_id: string | null }>(
    `SELECT id, name, email, role, office, talent_id FROM members WHERE id = $1`,
    [id]
  );
  if (!fresh) throw errors.notFound();
  return memberView(fresh);
}

export async function removeMember(id: string, director: SessionMember): Promise<void> {
  if (id === director.id) throw errors.conflict("own_membership");
  const row = await one<MemberRow>(`SELECT * FROM members WHERE id = $1 AND removed_at IS NULL`, [id]);
  if (!row) throw errors.notFound();
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [id]);
    await tx.query(`UPDATE sessions SET ended_at = now() WHERE member_id = $1 AND ended_at IS NULL`, [id]);
  });
}

export async function memberHome(member: SessionMember): Promise<string> {
  return ROLE_HOME[member.role] || "/workspace/board";
}

export function isValidOffice(office: string): office is Office {
  return (OFFICES as readonly string[]).includes(office);
}

