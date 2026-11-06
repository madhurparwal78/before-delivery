import { Router } from "express";
import { randomBytes } from "node:crypto";
import { query, pool } from "../db";
import { errors, requireAuth, seatsUsed, seatsPurchased, isReadOnly } from "../http";
import { audit } from "../audit";
import { hashPassword, hashToken, newAgentSecret, newInviteToken, newSessionToken, SESSION_COOKIE } from "../auth";

import { mailer, pocketbase } from "../services";
import { iso } from "./auth";

export const membersRouter = Router();
membersRouter.use(requireAuth);

function canInvite(role: string): boolean {
  return role === "owner" || role === "admin" || role === "billing_manager";
}

function canInviteRole(role: string, target: string): boolean {
  // Billing managers cannot invite admins.
  if (role === "billing_manager" && (target === "admin" || target === "owner")) return false;
  return true;
}

function canRemove(role: string): boolean {
  return role === "owner" || role === "admin";
}

function canManageTokens(role: string): boolean {
  return role === "owner" || role === "admin";
}

membersRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const members = await query(
      "SELECT id, name, email, role, joined_at FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY joined_at",
      [ws],
    );
    const invites = await query(
      "SELECT i.id, i.email, i.role, i.expires_at, i.invited_by, m.name AS inviter_name FROM invites i JOIN members m ON m.id = i.invited_by WHERE i.workspace_id = $1 AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > now()",
      [ws],
    );
    res.json({
      members: members.rows.map((r) => {
        const row = r as { id: string; name: string; email: string; role: string; joined_at: Date };
        return { id: row.id, name: row.name, email: row.email, role: row.role, joinedAt: iso(row.joined_at) };
      }),
      invites: invites.rows.map((r) => {
        const row = r as { id: string; email: string; role: string; expires_at: Date; invited_by: string; inviter_name: string };
        return {
          id: row.id,
          email: row.email,
          role: row.role,
          expiresAt: iso(row.expires_at),
          invitedBy: { kind: "member" as const, id: row.invited_by, name: row.inviter_name },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

membersRouter.post("/invites", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    const role = caller.member.role;
    if (!canInvite(role)) throw errors.forbidden();
    const body = req.body ?? {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const targetRole = typeof body.role === "string" ? body.role : "";
    const fieldErrors: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Email is invalid";
    if (!["admin", "billing_manager", "editor", "viewer"].includes(targetRole)) fieldErrors.role = "Role is invalid";
    if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
    if (!canInviteRole(role, targetRole)) throw errors.forbidden();
    const ws = caller.member.workspace_id;

    const already = await query(
      `SELECT 1 FROM members WHERE workspace_id = $1 AND email = $2 AND removed_at IS NULL
       UNION ALL
       SELECT 1 FROM invites WHERE workspace_id = $1 AND email = $2 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now()`,
      [ws, email],
    );
    if (already.rows.length > 0) throw errors.conflict("already_member");

    const used = await seatsUsed(ws);
    const purchased = await seatsPurchased(ws);
    if (used >= purchased) throw errors.conflict("no_seats_left", { seatsUsed: used, seatsPurchased: purchased });

    const id = `inv_${randomBytes(9).toString("hex")}`;
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Billing changes and invitations apply one at a time per workspace; the lock
      // makes the seat recheck below atomic so exactly one last-seat invite wins.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ws]);
      const recheck = await client.query(
        `SELECT
          (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL) +
          (SELECT count(*) FROM invites WHERE workspace_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now()) AS used`,
        [ws],
      );
      const usedNow = Number((recheck.rows[0] as { used: string }).used);
      if (usedNow >= purchased) {
        await client.query("ROLLBACK");
        throw errors.conflict("no_seats_left", { seatsUsed: usedNow, seatsPurchased: purchased });
      }
      await client.query(
        "INSERT INTO invites (id, workspace_id, email, role, token_hash, expires_at, invited_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, ws, email, targetRole, hashToken(token), expiresAt, caller.member.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    audit(caller, "member.invited", { type: "invite", id });
    const wsRes = await query("SELECT name FROM workspaces WHERE id = $1", [ws]);
    const wsName = (wsRes.rows[0] as { name: string }).name;
    const publicUrl = process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.APP_PUBLIC_PORT ?? 4173}`;
    mailer().send({
      to: [email],
      fromName: `${caller.member.name} via Orrery Studio`,
      subject: `Join ${wsName} on Orrery Studio`,
      text: `You have been invited to join ${wsName} on Orrery Studio as ${targetRole}.\n\nOpen this link to accept:\n${publicUrl}/invite/${token}\n\nThis invitation expires at ${expiresAt.toISOString()}.`,
    });
    res.status(201).json({ id, email, role: targetRole, expiresAt: iso(expiresAt) });
  } catch (e) {
    next(e);
  }
});

membersRouter.delete("/invites/:inviteId", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canInvite(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const result = await query(
      "UPDATE invites SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL",
      [req.params.inviteId, ws],
    );
    if (result.rowCount === 0) throw errors.notFound();
    audit(caller, "invite.revoked", { type: "invite", id: req.params.inviteId });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

membersRouter.delete("/:memberId", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canRemove(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const target = await query(
      "SELECT id, role, name FROM members WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL",
      [req.params.memberId, ws],
    );
    const row = target.rows[0] as { id: string; role: string; name: string } | undefined;
    if (!row) throw errors.notFound();
    if (row.role === "owner") throw errors.conflict("owner_cannot_be_removed");
    await query("UPDATE members SET removed_at = now() WHERE id = $1", [row.id]);
    await query("DELETE FROM sessions WHERE member_id = $1", [row.id]);
    await pocketbase().releaseAllLocks(row.id, ws).catch(() => {});
    await pocketbase().clearPresence(ws, row.id).catch(() => {});
    audit(caller, "member.removed", { type: "member", id: row.id });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Public invitation endpoints
// ---------------------------------------------------------------------------

export const invitesPublicRouter = Router();

invitesPublicRouter.get("/invites/:token", async (req, res, next) => {
  try {
    const token = req.params.token;
    const res2 = await query(
      "SELECT i.email, i.role, i.expires_at, i.revoked_at, i.accepted_at, w.name AS ws_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1",
      [hashToken(token)],
    );
    const row = res2.rows[0] as { email: string; role: string; expires_at: Date; revoked_at: Date | null; accepted_at: Date | null; ws_name: string } | undefined;
    if (!row || row.revoked_at || row.accepted_at || row.expires_at.getTime() <= Date.now()) throw errors.notFound();
    res.json({ workspace: { name: row.ws_name }, email: row.email, role: row.role });
  } catch (e) {
    next(e);
  }
});

invitesPublicRouter.post("/invites/:token/accept", async (req, res, next) => {
  try {
    const token = req.params.token;
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fieldErrors: Record<string, string> = {};
    if (name.length < 1 || name.length > 80) fieldErrors.name = "Name must be 1-80 characters";
    if (password.length < 10) fieldErrors.password = "Password must be at least 10 characters";
    if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
    const res2 = await query(
      "SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, i.revoked_at, i.accepted_at, w.name AS ws_name, w.time_zone, w.review_links_enabled FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1",
      [hashToken(token)],
    );
    const invite = res2.rows[0] as { id: string; workspace_id: string; email: string; role: string; expires_at: Date; revoked_at: Date | null; accepted_at: Date | null; ws_name: string; time_zone: string; review_links_enabled: boolean } | undefined;
    if (!invite || invite.revoked_at || invite.accepted_at || invite.expires_at.getTime() <= Date.now()) throw errors.notFound();

    // A member of another workspace cannot join: the invitation stays open.
    const taken = await query("SELECT 1 FROM members WHERE email = $1 AND removed_at IS NULL", [invite.email]);
    if (taken.rows.length > 0) throw errors.conflict("email_taken");

    const memberId = `mem_${randomBytes(9).toString("hex")}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO members (id, workspace_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)",
        [memberId, invite.workspace_id, name, invite.email, await hashPassword(password), invite.role],
      );
      await client.query("UPDATE invites SET accepted_at = now() WHERE id = $1", [invite.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { token: sessionToken } = newSessionToken();
    await query("INSERT INTO sessions (token_hash, member_id) VALUES ($1,$2)", [hashToken(sessionToken), memberId]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    const caller = {
      kind: "member" as const,
      member: { id: memberId, workspace_id: invite.workspace_id, name, email: invite.email, role: invite.role as "viewer" },
      workspace: { id: invite.workspace_id, name: invite.ws_name, time_zone: invite.time_zone, review_links_enabled: invite.review_links_enabled },
      sessionId: sessionToken,
    };
    audit(caller, "member.joined", { type: "member", id: memberId });
    res.status(201).json({
      member: { id: memberId, name, email: invite.email, role: invite.role, joinedAt: iso(new Date()) },
      workspace: { id: invite.workspace_id, name: invite.ws_name, timeZone: invite.time_zone },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Agent tokens
// ---------------------------------------------------------------------------

export const tokensRouter = Router();
tokensRouter.use(requireAuth);

tokensRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canManageTokens(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const rows = await query(
      `SELECT t.id, t.name, t.scope, t.expires_at, t.revoked_at, t.issued_by, m.name AS issuer_name
       FROM agent_tokens t LEFT JOIN members m ON m.id = t.issued_by
       WHERE t.workspace_id = $1 ORDER BY t.issued_at`,
      [ws],
    );
    res.json({
      tokens: rows.rows.map((r) => {
        const row = r as { id: string; name: string; scope: string; expires_at: Date; revoked_at: Date | null; issued_by: string; issuer_name: string | null };
        const status = row.revoked_at ? "revoked" : row.expires_at.getTime() <= Date.now() ? "expired" : "active";
        return {
          id: row.id,
          name: row.name,
          scope: row.scope,
          expiresAt: iso(row.expires_at),
          status,
          issuedBy: { kind: "member" as const, id: row.issued_by, name: row.issuer_name ?? "Removed member" },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

tokensRouter.post("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canManageTokens(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const state = (await query("SELECT state FROM subscriptions WHERE workspace_id = $1", [ws])).rows[0] as { state: string };
    if (isReadOnly(state.state)) throw errors.readOnly();
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name : "";
    const scope = body.scope;
    const expiresAtRaw = typeof body.expiresAt === "string" ? body.expiresAt : "";
    const fieldErrors: Record<string, string> = {};
    if (name.length < 1 || name.length > 60) fieldErrors.name = "Name must be 1-60 characters";
    if (scope !== "read" && scope !== "edit") fieldErrors.scope = "Scope is invalid";
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expiresAtRaw)) fieldErrors.expiresAt = "Use YYYY-MM-DD HH:mm:ss.";
    let expiresAt: Date | null = null;
    if (!fieldErrors.expiresAt) {
      const tzRes = await query("SELECT time_zone FROM workspaces WHERE id = $1", [ws]);
      const tz = (tzRes.rows[0] as { time_zone: string }).time_zone;
      expiresAt = parseLocal(expiresAtRaw, tz);
      if (!expiresAt) fieldErrors.expiresAt = "Use YYYY-MM-DD HH:mm:ss.";
    }
    if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
    const now = Date.now();
    if (expiresAt!.getTime() < now + 10_000 || expiresAt!.getTime() > now + 365 * 24 * 3600 * 1000) {
      throw errors.validation({ expiresAt: "Expiry must be between 10 seconds and 365 days from now" });
    }
    // token limit by plan
    const planRes = await query("SELECT plan FROM subscriptions WHERE workspace_id = $1", [ws]);
    const plan = (planRes.rows[0] as { plan: string }).plan;
    const limit = plan === "business" ? 25 : 5;
    const activeCount = await query(
      "SELECT count(*) AS c FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()",
      [ws],
    );
    if (Number((activeCount.rows[0] as { c: string }).c) >= limit) throw errors.conflict("token_limit_reached");
    const secret = newAgentSecret();
    const id = `tok_${randomBytes(6).toString("hex")}`;
    await query(
      "INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ws, name, scope, hashToken(secret), expiresAt, caller.member.id],
    );
    audit(caller, "token.issued", { type: "agent_token", id });
    res.status(201).json({
      id,
      name,
      scope,
      expiresAt: iso(expiresAt!),
      status: "active",
      issuedBy: { kind: "member", id: caller.member.id, name: caller.member.name },
      token: secret,
    });
  } catch (e) {
    next(e);
  }
});

tokensRouter.delete("/:tokenId", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canManageTokens(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const rows = await query(
      "SELECT id, expires_at, revoked_at FROM agent_tokens WHERE id = $1 AND workspace_id = $2",
      [req.params.tokenId, ws],
    );
    const row = rows.rows[0] as { id: string; expires_at: Date; revoked_at: Date | null } | undefined;
    if (!row) throw errors.notFound();
    const status = row.revoked_at ? "revoked" : row.expires_at.getTime() <= Date.now() ? "expired" : "active";
    if (status !== "active") throw errors.conflict("invalid_transition", { from: status, to: "revoked" });
    await query("UPDATE agent_tokens SET revoked_at = now() WHERE id = $1", [row.id]);
    await pocketbase().releaseAllLocks(row.id, ws).catch(() => {});
    audit(caller, "token.revoked", { type: "agent_token", id: row.id });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Converts a wall-clock time ("YYYY-MM-DD HH:mm:ss") in an IANA zone to a UTC instant. */
export function parseLocal(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const first = new Date(asUtc);
  const off1 = zoneOffsetMinutes(first, timeZone);
  const candidate = new Date(asUtc - off1 * 60_000);
  const off2 = zoneOffsetMinutes(candidate, timeZone);
  if (off2 !== off1) {
    const retry = new Date(asUtc - off2 * 60_000);
    return retry;
  }
  return candidate;
}

