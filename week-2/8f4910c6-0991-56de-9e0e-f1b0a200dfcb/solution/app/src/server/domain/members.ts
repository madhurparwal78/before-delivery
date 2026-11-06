// Sign-in, sessions, password resets, invitations and the director's member management.

import { exec, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, publicRoute, json, type MemberCtx } from "../http.js";
import { ApiError, EMAIL_COPY, FieldErrors, conflict, gone, notFound, required } from "../errors.js";
import { CLEAR_COOKIE, HOMES, MEMBER_COLUMNS, endSession, hashPassword, hashToken, randomToken, startSession,
  toMember, verifyPassword, STAFF, isRole, type MemberRow, type Role } from "../auth.js";
import { appLink, enqueue } from "../mail.js";
import { asObject, newId, str } from "../util.js";
import { isEmail } from "../../shared/text.js";
import { isOfficeId, type OfficeId } from "../../shared/zones.js";

const RESET_REPLY = { message: "If that address has an account, a reset link is on its way." };
const INVITE_REPLY = { message: "If that address has no account yet, an invitation is on its way." };
const PASSWORD_COPY = "Choose a password of at least 12 characters.";

async function liveMemberByEmail(db: Db, email: string): Promise<(MemberRow & { password_hash: string }) | null> {
  return one<MemberRow & { password_hash: string }>(
    db,
    `SELECT ${MEMBER_COLUMNS}, m.password_hash FROM members m WHERE lower(m.email) = lower($1) AND m.removed_at IS NULL`,
    [email.trim()],
  );
}

async function memberById(db: Db, id: string): Promise<MemberRow | null> {
  return one<MemberRow>(db, `SELECT ${MEMBER_COLUMNS} FROM members m WHERE m.id = $1 AND m.removed_at IS NULL`, [id]);
}

function signedIn(row: MemberRow, cookie: string) {
  return json(200, { member: toMember(row), home: HOMES[row.role] }, { "Set-Cookie": cookie });
}

publicRoute("POST", "/api/session", async (ctx) => {
  const body = asObject(await ctx.json());
  const row = await liveMemberByEmail(pool, str(body, "email"));
  if (!row || !(await verifyPassword(str(body, "password"), row.password_hash))) {
    throw new ApiError(401, "invalid_credentials");
  }
  return signedIn(row, await startSession(pool, row.id, ctx.now));
});

memberRoute("DELETE", "/api/session", async (ctx) => {
  await endSession(ctx.req);
  return json(204, undefined, { "Set-Cookie": CLEAR_COOKIE });
});

memberRoute("GET", "/api/me", async (ctx) => json(200, ctx.member));

/** Issues a single-use link; a newer one for the same email replaces the older. */
async function issueLink(db: Db, kind: "reset" | "invite", email: string,
  fields: { name?: string; role?: string; office?: string; talentId?: string | null } = {}): Promise<string> {
  const token = randomToken();
  await exec(db, `UPDATE account_links SET replaced_at = now()
    WHERE kind = $1 AND lower(email) = lower($2) AND used_at IS NULL AND replaced_at IS NULL`, [kind, email]);
  await exec(
    db,
    `INSERT INTO account_links (token_hash, kind, email, name, role, office_id, talent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [hashToken(token), kind, email, fields.name ?? null, fields.role ?? null, fields.office ?? null,
      fields.talentId ?? null],
  );
  return token;
}

interface LinkRow {
  token_hash: string;
  email: string;
  name: string | null;
  /** Set on invitations; reset links never read them. */
  role: Role;
  office_id: OfficeId;
  talent_id: string | null;
  used_at: Date | null;
}

async function usableLink(db: Db, kind: string, token: string): Promise<LinkRow> {
  const link = await one<LinkRow & { replaced_at: Date | null }>(
    db,
    "SELECT * FROM account_links WHERE token_hash = $1 AND kind = $2 FOR UPDATE",
    [hashToken(token), kind],
  );
  if (!link || link.replaced_at) throw notFound();
  if (link.used_at) throw gone("link_used");
  return link;
}

function newPassword(body: Record<string, unknown>): string {
  const password = str(body, "password");
  if (password.length < 12) {
    const errors: FieldErrors = new FieldErrors();
    errors.add("password", password ? PASSWORD_COPY : required("New password"));
    errors.fail();
  }
  return password;
}

publicRoute("POST", "/api/password-resets", async (ctx) => {
  const body = asObject(await ctx.json());
  const email = str(body, "email").trim();
  const errors: FieldErrors = new FieldErrors();
  if (!email) errors.add("email", required("Email"));
  else if (!isEmail(email)) errors.add("email", EMAIL_COPY);
  errors.throwIfAny();
  await tx(async (client) => {
    const member = await liveMemberByEmail(client, email);
    if (!member) return;
    const token = await issueLink(client, "reset", member.email);
    await enqueue(client, {
      to: member.email,
      subject: "Reset your Rungboard password",
      text: [`Hello ${member.name},`, "", "Someone asked to reset your Rungboard password. Set a new one here:",
        appLink(`/reset/${token}`), "", "The link works once. If you did not ask for it, ignore this email.", "",
        "Vesper & Rowe Talent"].join("\n"),
      talentIds: member.talent_id ? [member.talent_id] : [],
    });
  });
  return json(202, RESET_REPLY);
});

publicRoute("POST", "/api/password-resets/:token", async (ctx) => {
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    const link = await usableLink(client, "reset", ctx.params.token);
    const password = newPassword(body);
    const member = await liveMemberByEmail(client, link.email);
    if (!member) throw notFound();
    await exec(client, "UPDATE account_links SET used_at = now() WHERE token_hash = $1", [link.token_hash]);
    await exec(client, "UPDATE members SET password_hash = $2 WHERE id = $1", [member.id, await hashPassword(password)]);
    return signedIn(member, await startSession(client, member.id, ctx.now));
  });
});

publicRoute("POST", "/api/invitations/:token/accept", async (ctx) => {
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    const link = await usableLink(client, "invite", ctx.params.token);
    const password = newPassword(body);
    if (await liveMemberByEmail(client, link.email)) throw gone("link_used");
    const id = newId();
    await exec(
      client,
      `INSERT INTO members (id, name, email, role, office_id, talent_id, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, link.name, link.email, link.role, link.office_id, link.talent_id, await hashPassword(password)],
    );
    await exec(client, "UPDATE account_links SET used_at = now() WHERE token_hash = $1", [link.token_hash]);
    const member: MemberRow = { id, name: link.name ?? "", email: link.email, role: link.role,
      office_id: link.office_id, talent_id: link.talent_id };
    return signedIn(member, await startSession(client, id, ctx.now));
  });
});

memberRoute("POST", "/api/invitations", async (ctx) => {
  ctx.allow("agency_director");
  const body = asObject(await ctx.json());
  const name = str(body, "name").trim();
  const email = str(body, "email").trim();
  const role = str(body, "role");
  const office = str(body, "office");
  const talentId = str(body, "talentId");
  const errors: FieldErrors = new FieldErrors();
  if (!name) errors.add("name", required("Name"));
  if (!email) errors.add("email", required("Email"));
  else if (!isEmail(email)) errors.add("email", EMAIL_COPY);
  if (!role) errors.add("role", required("Role"));
  else if (role === "talent") {
    const talent = talentId
      ? await one(pool, "SELECT 1 FROM talent WHERE id = $1 AND state <> 'erased'", [talentId])
      : null;
    if (!talent) errors.add("talentId", "Choose a talent on the roster.");
  } else if (!STAFF.some((staff) => staff === role)) errors.add("role", "Choose a role from the list.");
  if (!office) errors.add("office", required("Office"));
  else if (!isOfficeId(office)) errors.add("office", "Choose Toronto or Vancouver.");
  errors.throwIfAny();
  await tx(async (client) => {
    if (await liveMemberByEmail(client, email)) return;
    const token = await issueLink(client, "invite", email, {
      name, role, office, talentId: role === "talent" ? talentId : null,
    });
    await enqueue(client, {
      to: email,
      subject: "You're invited to Rungboard",
      text: [`Hello ${name},`, "", `${ctx.member.name} invited you to Rungboard, the Vesper & Rowe Talent workspace.`,
        "Set your password here to get started:", appLink(`/invite/${token}`), "", "Vesper & Rowe Talent"].join("\n"),
      talentIds: role === "talent" ? [talentId] : [],
    });
  });
  return json(202, INVITE_REPLY);
});

memberRoute("GET", "/api/members", async (ctx) => {
  ctx.allow(...STAFF);
  const found = await rows<MemberRow>(
    pool, `SELECT ${MEMBER_COLUMNS} FROM members m WHERE m.removed_at IS NULL ORDER BY m.name, m.id`);
  return json(200, { members: found.map(toMember) });
});

/** Step 4: staff read every member; a talent only their own record. */
async function visibleMember(ctx: MemberCtx): Promise<MemberRow> {
  const row = await memberById(pool, ctx.params.id);
  if (!row || (ctx.isTalent() && row.id !== ctx.member.id)) throw notFound();
  return row;
}

memberRoute("GET", "/api/members/:id", async (ctx) => json(200, toMember(await visibleMember(ctx))));

memberRoute("PATCH", "/api/members/:id", async (ctx) => {
  const row = await visibleMember(ctx);
  ctx.allow("agency_director");
  const body = asObject(await ctx.json());
  if (row.id === ctx.member.id) throw conflict("own_membership");
  const role = str(body, "role");
  if (!isRole(role) || (role === "talent") !== Boolean(row.talent_id)) {
    const errors: FieldErrors = new FieldErrors();
    errors.add("role", role ? "Choose a role from the list." : required("Role"));
    errors.fail();
  }
  await exec(pool, "UPDATE members SET role = $2 WHERE id = $1", [row.id, role]);
  return json(200, toMember({ ...row, role }));
});

memberRoute("DELETE", "/api/members/:id", async (ctx) => {
  const row = await visibleMember(ctx);
  ctx.allow("agency_director");
  if (row.id === ctx.member.id) throw conflict("own_membership");
  await exec(pool, "UPDATE members SET removed_at = now() WHERE id = $1", [row.id]);
  return json(204);
});
