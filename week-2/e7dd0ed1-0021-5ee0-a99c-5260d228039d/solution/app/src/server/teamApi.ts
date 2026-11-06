// Sign-in, team, invites and access keys (brief: API, Session and identity; Team and invites;
// Access keys; Business rules, Sign-in throttling, Membership changes, Invites, Access keys).
import type pg from "pg";
import { authorize, membership, moveSessions, ROLES, sessionCookie, type Role, type User } from "./access.js";
import { completeSignIn, refuseAttempt, requireCsrfHeader, sessionBody, throttle } from "./account.js";
import { appendAudit } from "./audit.js";
import { config } from "./config.js";
import { one, pool, query, row, tx, type Db } from "./db.js";
import { ApiError, invalid, rateLimited, transition } from "./errors.js";
import { fieldErrors, isoOrNull, isoSecond, readJson, secondsUntil, sendJson, sendNoContent, truncateToSecond, type Ctx } from "./http.js";
import {
  DESCRIPTION_MESSAGE, descriptionAllowed, EMAIL_MESSAGE, emailAllowed, INVITE_RATE, keyAllowed, nameAllowed, passwordAllowed,
  RATE_WINDOW_SECONDS, utf8Bytes,
} from "./limits.js";
import { revokeLinks } from "./links.js";
import { enqueueMail, ownersOf, wakeMail } from "./mail.js";
import { REGIONS } from "./schema.js";
import { hashPassword, newId, newKeyId, newKeySecret, passwordMatches, randomToken, seal, sha256Hex } from "./secrets.js";
import { formatTime } from "../shared/format.js";

export async function regions(ctx: Ctx): Promise<void> {
  sendJson(ctx, 200, { regions: REGIONS.map((r) => ({ id: r.id, name: r.name, continent: r.continent, lon: r.lon, lat: r.lat })) });
}

// ---- Members ----

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
}

const memberJson = (r: MemberRow): Record<string, unknown> => ({ user_id: r.user_id, name: r.name, email: r.email, role: r.role });

export async function listMembers(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const rows = await query<MemberRow>(pool,
    `SELECT u.id AS user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 ORDER BY u.name, u.email`, [m.workspace.id]);
  sendJson(ctx, 200, { members: rows.map(memberJson) });
}

// Membership changes in a workspace are decided one at a time, and never leave it without an owner.
async function changeMember(ctx: Ctx, to: Role | "removed"): Promise<MemberRow> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  return tx(async (client) => {
    await client.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [m.workspace.id]);
    const caller = await one<{ role: Role }>(client, "SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2",
      [m.workspace.id, m.user.id]);
    if (!caller) throw new ApiError("not_found");
    const target = await one<MemberRow>(client,
      `SELECT u.id AS user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.user_id::text = $2`, [m.workspace.id, ctx.params.user ?? ""]);
    if (!target) throw new ApiError("not_found");
    authorize({ ...m, role: caller.role }, "administer");
    if (to !== "removed" && target.role === to) return target;
    if (target.role === "owner") {
      const owners = await one<{ n: number }>(client,
        "SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'owner'", [m.workspace.id]);
      if ((owners?.n ?? 0) <= 1) throw new ApiError("last_owner");
    }
    if (to === "removed") {
      await client.query("DELETE FROM members WHERE workspace_id = $1 AND user_id = $2", [m.workspace.id, target.user_id]);
      await revokeLinks(client, { workspaceId: m.workspace.id, createdBy: target.user_id }, ctx.now);
      await appendAudit(client, m.workspace.slug, { actor: m.user.email, action: "member.removed", target: target.email, detail: "" }, ctx.now);
      return target;
    }
    await client.query("UPDATE members SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [m.workspace.id, target.user_id, to]);
    await appendAudit(client, m.workspace.slug,
      { actor: m.user.email, action: "member.role_changed", target: target.email, detail: `${target.role} -> ${to}` }, ctx.now);
    return { ...target, role: to };
  });
}

export async function patchMember(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const exists = await one(pool, "SELECT 1 FROM members WHERE workspace_id = $1 AND user_id::text = $2", [m.workspace.id, ctx.params.user ?? ""]);
  if (!exists) throw new ApiError("not_found");
  authorize(m, "administer");
  const body = await readJson(ctx);
  const errors = fieldErrors(body, ["role"], ["role"]);
  if (!errors.role && !(typeof body.role === "string" && (ROLES as readonly string[]).includes(body.role))) {
    errors.role = "Choose owner, developer or viewer.";
  }
  if (Object.keys(errors).length) throw invalid(errors);
  sendJson(ctx, 200, memberJson(await changeMember(ctx, body.role as Role)));
}

export async function removeMember(ctx: Ctx): Promise<void> {
  await changeMember(ctx, "removed");
  sendNoContent(ctx);
}

// ---- Invites ----

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  expires_at: Date;
  state: "pending" | "accepted" | "replaced";
}

const inviteState = (i: InviteRow, now: Date): string =>
  i.state === "pending" && now.getTime() >= i.expires_at.getTime() ? "expired" : i.state;

// Invite transitions, decided here and nowhere else: pending → accepted, pending → replaced when the
// email is invited again; pending → expired is derived from expires_at by inviteState.
async function moveInvites(client: pg.PoolClient, to: "accepted" | "replaced", scope: { id: string } | { workspaceId: string; email: string }): Promise<void> {
  const [where, params] = "id" in scope ? ["id = $2", [scope.id]] : ["workspace_id = $2 AND lower(email) = lower($3)", [scope.workspaceId, scope.email]];
  await client.query(`UPDATE invites SET state = $1 WHERE ${where} AND state = 'pending'`, [to, ...params]);
}

const inviteJson = (i: InviteRow, now: Date): Record<string, unknown> => ({
  id: i.id, email: i.email, role: i.role, expires_at: isoSecond(i.expires_at), state: inviteState(i, now),
});

export async function listInvites(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const rows = await query<InviteRow>(pool, "SELECT * FROM invites WHERE workspace_id = $1 ORDER BY created_at DESC, id", [m.workspace.id]);
  sendJson(ctx, 200, { invites: rows.map((i) => inviteJson(i, ctx.now)) });
}

export async function createInvite(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const body = await readJson(ctx);
  const token = randomToken(32);
  const invite = await tx(async (client) => {
    await client.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [m.workspace.id]);
    const recent = await query<{ created_at: Date }>(client,
      "SELECT created_at FROM invites WHERE workspace_id = $1 AND created_at > $2 ORDER BY created_at",
      [m.workspace.id, new Date(ctx.now.getTime() - RATE_WINDOW_SECONDS * 1000)]);
    const oldest = recent[0];
    if (recent.length >= INVITE_RATE && oldest) {
      throw rateLimited(secondsUntil(ctx.now, new Date(oldest.created_at.getTime() + RATE_WINDOW_SECONDS * 1000)));
    }
    const errors = fieldErrors(body, ["email", "role"], ["email", "role"]);
    if (!errors.email && !emailAllowed(body.email)) errors.email = EMAIL_MESSAGE;
    if (!errors.role && body.role !== "developer" && body.role !== "viewer") errors.role = "Choose developer or viewer.";
    if (!errors.email && await one(client,
      `SELECT 1 FROM members mb JOIN users u ON u.id = mb.user_id WHERE mb.workspace_id = $1 AND lower(u.email) = lower($2)`,
      [m.workspace.id, body.email])) throw new ApiError("already_member");
    if (Object.keys(errors).length) throw invalid(errors);
    const email = (body.email as string).trim();
    await moveInvites(client, "replaced", { workspaceId: m.workspace.id, email });
    const expiresAt = new Date(truncateToSecond(ctx.now).getTime() + config.inviteTtlSeconds * 1000);
    const created = await row<InviteRow>(client,
      `INSERT INTO invites (id, workspace_id, email, role, token_hash, created_at, expires_at, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [newId(), m.workspace.id, email, body.role, sha256Hex(token), ctx.now, expiresAt]);
    await appendAudit(client, m.workspace.slug, { actor: m.user.email, action: "invite.created", target: email, detail: created.role }, ctx.now);
    await enqueueMail(client, email, `You're invited to ${m.workspace.name} on Farshore`, [
      `${m.user.name} invited you to join ${m.workspace.name} on Farshore as a ${created.role}.`, "",
      `Accept the invite: ${ctx.origin}/invite/${token}`, "",
      `Role: ${created.role}`, `This invite expires ${formatTime(expiresAt)}.`,
    ].join("\n"));
    return created;
  });
  wakeMail();
  sendJson(ctx, 201, inviteJson(invite, ctx.now));
}

async function inviteByToken(db: Db | pg.PoolClient, ctx: Ctx, lock = false): Promise<InviteRow & { slug: string; name: string }> {
  const invite = await one<InviteRow & { slug: string; name: string }>(db,
    `SELECT i.*, w.slug, w.name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1
     ${lock ? "FOR UPDATE OF i" : ""}`, [sha256Hex(ctx.params.token ?? "")]);
  if (!invite || invite.state !== "pending") throw new ApiError("not_found");
  if (ctx.now.getTime() >= invite.expires_at.getTime()) throw new ApiError("invite_expired");
  return invite;
}

export async function getInvite(ctx: Ctx): Promise<void> {
  const invite = await inviteByToken(pool, ctx);
  const account = await one(pool, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [invite.email]);
  sendJson(ctx, 200, {
    workspace: { slug: invite.slug, name: invite.name }, email: invite.email, role: invite.role,
    expires_at: isoSecond(invite.expires_at), existing_account: account !== undefined,
  });
}

export async function acceptInvite(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const invite = await inviteByToken(pool, ctx);
  const account = await one<User & { password_hash: string }>(pool,
    "SELECT id, email, name, operator, two_step_enabled_at, password_hash FROM users WHERE lower(email) = lower($1)", [invite.email]);
  if (account) await throttle(ctx, account.email);
  requireCsrfHeader(ctx);
  if (account) {
    const errors = fieldErrors(body, ["password"], ["password"]);
    if (Object.keys(errors).length || typeof body.password !== "string") throw invalid({ ...errors, ...(typeof body.password === "string" ? {} : { password: "This field is required." }) });
    if (!(await passwordMatches(body.password, account.password_hash))) {
      return refuseAttempt(ctx, account.email, new ApiError("invalid_credentials", "That password doesn't match your Farshore account."));
    }
  } else {
    const errors = fieldErrors(body, ["name", "password"], ["name", "password"]);
    if (!errors.name && !nameAllowed(body.name)) errors.name = "Names are 1 to 80 characters.";
    if (!errors.password && !passwordAllowed(body.password)) errors.password = "Passwords are 12 to 128 characters.";
    if (Object.keys(errors).length) throw invalid(errors);
  }
  const passwordHash = account ? null : await hashPassword(body.password as string);
  const { user, issued } = await tx(async (client) => {
    const locked = await inviteByToken(client, ctx, true);
    const joined: User = account ?? await row<User>(client,
      `INSERT INTO users (id, email, name, password_hash) VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id, email, name, operator, two_step_enabled_at`, [locked.email, (body.name as string).trim(), passwordHash]);
    await client.query(
      "INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO NOTHING",
      [locked.workspace_id, joined.id, locked.role]);
    await moveInvites(client, "accepted", { id: locked.id });
    await appendAudit(client, locked.slug, { actor: joined.email, action: "invite.accepted", target: joined.email, detail: locked.role }, ctx.now);
    // An enrolled existing account finishes with the code step, exactly as at sign-in.
    if (joined.two_step_enabled_at) return { user: joined, issued: await moveSessions(client, { to: "pending", ctx, userId: joined.id }) };
    return { user: joined, issued: account ? await completeSignIn(client, ctx, account, null) : await moveSessions(client, { to: "active", ctx, userId: joined.id }) };
  });
  const cookie = { "Set-Cookie": sessionCookie(issued.token) };
  if (issued.session.state === "pending") {
    sendJson(ctx, 202, { two_step: "required", expires_at: isoOrNull(issued.session.pending_until) }, cookie);
    return;
  }
  sendJson(ctx, 201, await sessionBody(pool, user), cookie);
}

// ---- Access keys ----
// States: active → disabled → deleted, plus active → active by rotation; expired is derived from
// expires_at. Secrets are shown once and stored only sealed.

interface KeyRow {
  key_id: string;
  workspace_id: string;
  description: string;
  permission: "read" | "read-write";
  buckets: string[] | null;
  prefix: string | null;
  expires_at: Date | null;
  state: "active" | "disabled";
  sealed_secret: string;
  previous_sealed_secret: string | null;
  previous_secret_expires_at: Date | null;
  previous_secret_last_used_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
}

// Each limit's end second is exclusive: a key stops working at expires_at, a previous secret at
// previous_secret_expires_at.
export const keyExpired = (k: Pick<KeyRow, "expires_at">, now: Date): boolean =>
  k.expires_at !== null && truncateToSecond(now).getTime() >= k.expires_at.getTime();
export const previousSecretLive = (k: Pick<KeyRow, "state" | "previous_sealed_secret" | "previous_secret_expires_at">, now: Date): boolean =>
  k.state === "active" && k.previous_sealed_secret !== null && k.previous_secret_expires_at !== null &&
  truncateToSecond(now).getTime() < k.previous_secret_expires_at.getTime();

const keyJson = (k: KeyRow, now: Date): Record<string, unknown> => ({
  key_id: k.key_id, description: k.description, permission: k.permission, buckets: k.buckets, prefix: k.prefix,
  expires_at: isoOrNull(k.expires_at), expired: keyExpired(k, now), state: k.state, created_at: isoSecond(k.created_at),
  last_used_at: isoOrNull(k.last_used_at),
  previous_secret_expires_at: previousSecretLive(k, now) ? isoOrNull(k.previous_secret_expires_at) : null,
  previous_secret_last_used_at: isoOrNull(k.previous_secret_last_used_at),
});

export async function listKeys(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const rows = await query<KeyRow>(pool, "SELECT * FROM access_keys WHERE workspace_id = $1 ORDER BY created_at DESC, key_id", [m.workspace.id]);
  sendJson(ctx, 200, { keys: rows.map((k) => keyJson(k, ctx.now)) });
}

const PREFIX_MESSAGE = "Prefixes are 1 to 1,024 bytes and follow the key rules.";
const EXPIRES_MESSAGE = "Pick a time after now and within 365 days.";
const ISO_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function parseIsoTime(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_SECOND.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function createKey(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer", false, true);
  const body = await readJson(ctx);
  const errors = fieldErrors(body, ["description", "permission", "buckets", "prefix", "expires_at"], ["description", "permission", "buckets"]);
  if (!errors.description && !descriptionAllowed(body.description)) errors.description = DESCRIPTION_MESSAGE;
  if (!errors.permission && body.permission !== "read" && body.permission !== "read-write") errors.permission = "Choose read or read-write.";
  if (!errors.buckets && body.buckets !== null) {
    const names = new Set((await query<{ name: string }>(pool, "SELECT name FROM buckets WHERE workspace_id = $1", [m.workspace.id])).map((b) => b.name));
    const buckets = body.buckets;
    if (!(Array.isArray(buckets) && buckets.length >= 1 && buckets.every((b) => typeof b === "string" && names.has(b)) &&
        new Set(buckets).size === buckets.length)) errors.buckets = "Choose buckets from this workspace, or all buckets.";
  }
  const prefix = body.prefix ?? null;
  if (prefix !== null && !(typeof prefix === "string" && utf8Bytes(prefix) <= 1024 && keyAllowed(prefix))) errors.prefix = PREFIX_MESSAGE;
  const expiresRaw = body.expires_at ?? null;
  const expiresAt = expiresRaw === null ? null : parseIsoTime(expiresRaw);
  if (expiresRaw !== null && (expiresAt === null || expiresAt.getTime() <= ctx.now.getTime() ||
      expiresAt.getTime() > ctx.now.getTime() + 365 * 86_400_000)) errors.expires_at = EXPIRES_MESSAGE;
  if (Object.keys(errors).length) throw invalid(errors);
  const secret = newKeySecret();
  const key = await tx(async (client) => {
    const created = await row<KeyRow>(client,
      `INSERT INTO access_keys (key_id, workspace_id, description, permission, buckets, prefix, expires_at, state, sealed_secret,
         created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, date_trunc('second', now())) RETURNING *`,
      [newKeyId(), m.workspace.id, body.description, body.permission, body.buckets, prefix, expiresAt && truncateToSecond(expiresAt),
        seal(secret), m.user.id]);
    for (const owner of await ownersOf(client, m.workspace.id)) {
      await enqueueMail(client, owner.email, `New access key ${created.key_id} in ${m.workspace.name}`, [
        `${m.user.name} created an access key in ${m.workspace.name}.`, "",
        `Key ID: ${created.key_id}`, `Description: ${created.description}`, `Permission: ${created.permission}`,
        `Buckets: ${created.buckets ? created.buckets.join(", ") : "all buckets"}`, `Created by: ${m.user.name}`, "",
        "The secret was shown once to its creator and is never sent by email.",
      ].join("\n"));
    }
    await appendAudit(client, m.workspace.slug,
      { actor: m.user.email, action: "access_key.created", target: created.key_id, detail: created.description }, ctx.now);
    return created;
  });
  wakeMail();
  sendJson(ctx, 201, { ...keyJson(key, ctx.now), secret });
}

// The previous secret of a key rotated at `now` works until this second (exclusive).
const overlapEnd = (now: Date): Date => new Date(truncateToSecond(now).getTime() + config.keyRotationOverlapSeconds * 1000);

// Access-key transitions, decided here and nowhere else: active → active by rotation, active →
// disabled, disabled → deleted. Expired is derived from expires_at: an expired key may still be
// disabled or deleted, never rotated. Each edge checks the locked row, then makes its one write;
// `validation` is thrown after the state checks, as Error precedence orders them.
type KeyEdge = { to: "rotated"; secret: string; now: Date } | { to: "disabled" } | { to: "deleted" };

async function moveKey(client: pg.PoolClient, k: KeyRow, edge: { to: "deleted" }): Promise<null>;
async function moveKey(client: pg.PoolClient, k: KeyRow, edge: Exclude<KeyEdge, { to: "deleted" }>, validation?: Record<string, string>): Promise<KeyRow>;
async function moveKey(client: pg.PoolClient, k: KeyRow, edge: KeyEdge, validation: Record<string, string> = {}): Promise<KeyRow | null> {
  if (edge.to === "rotated") {
    if (k.state !== "active") throw transition(k.state, "rotated");
    if (keyExpired(k, edge.now)) throw transition("expired", "rotated");
    if (previousSecretLive(k, edge.now)) throw new ApiError("rotation_in_progress");
  } else if (k.state !== (edge.to === "disabled" ? "active" : "disabled")) {
    throw transition(k.state, edge.to);
  }
  if (Object.keys(validation).length) throw invalid(validation);
  if (edge.to === "deleted") {
    await client.query("DELETE FROM access_keys WHERE key_id = $1", [k.key_id]);
    return null;
  }
  if (edge.to === "disabled") {
    return row<KeyRow>(client, "UPDATE access_keys SET state = 'disabled', previous_sealed_secret = NULL WHERE key_id = $1 RETURNING *", [k.key_id]);
  }
  return row<KeyRow>(client,
    `UPDATE access_keys SET previous_sealed_secret = sealed_secret, sealed_secret = $2, previous_secret_expires_at = $3,
       previous_secret_last_used_at = NULL WHERE key_id = $1 RETURNING *`, [k.key_id, seal(edge.secret), overlapEnd(edge.now)]);
}

async function keyFor(ctx: Ctx, client: pg.PoolClient, workspaceId: string): Promise<KeyRow> {
  const key = await one<KeyRow>(client, "SELECT * FROM access_keys WHERE key_id = $1 AND workspace_id = $2 FOR UPDATE",
    [ctx.params.key ?? "", workspaceId]);
  if (!key) throw new ApiError("not_found");
  return key;
}

// Rotation: a new secret, while the previous one keeps working until the overlap's exact second.
export async function rotateKey(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const extra = fieldErrors(await readJson(ctx), [], []);
  const secret = newKeySecret();
  const key = await tx(async (client) => {
    const k = await keyFor(ctx, client, m.workspace.id);
    authorize(m, "administer", false, true);
    const rotated = await moveKey(client, k, { to: "rotated", secret, now: ctx.now }, extra);
    const until = overlapEnd(ctx.now);
    for (const owner of await ownersOf(client, m.workspace.id)) {
      await enqueueMail(client, owner.email, `Access key ${k.key_id} rotated in ${m.workspace.name}`, [
        `${m.user.name} rotated the access key ${k.key_id} in ${m.workspace.name}.`, "",
        `Key ID: ${k.key_id}`, `The previous secret stops working at ${formatTime(until)}.`, "",
        "Neither secret is ever sent by email.",
      ].join("\n"));
    }
    await appendAudit(client, m.workspace.slug, { actor: m.user.email, action: "access_key.rotated", target: k.key_id, detail: "" }, ctx.now);
    return rotated;
  });
  wakeMail();
  sendJson(ctx, 200, { ...keyJson(key, ctx.now), secret });
}

// Disabling ends both secrets at once.
export async function disableKey(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const key = await tx(async (client) => {
    const k = await keyFor(ctx, client, m.workspace.id);
    authorize(m, "administer");
    const disabled = await moveKey(client, k, { to: "disabled" });
    await appendAudit(client, m.workspace.slug, { actor: m.user.email, action: "access_key.disabled", target: k.key_id, detail: "" }, ctx.now);
    return disabled;
  });
  sendJson(ctx, 200, keyJson(key, ctx.now));
}

export async function deleteKey(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  await tx(async (client) => {
    const k = await keyFor(ctx, client, m.workspace.id);
    authorize(m, "administer");
    await moveKey(client, k, { to: "deleted" });
    await appendAudit(client, m.workspace.slug, { actor: m.user.email, action: "access_key.deleted", target: k.key_id, detail: "" }, ctx.now);
  });
  sendNoContent(ctx);
}
