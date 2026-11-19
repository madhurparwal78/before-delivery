// Sign-in, sign-out and joining a workshop from its link.
import crypto from "node:crypto";
import { db, newId, tx } from "./db.js";
import { ApiError, FIELD, fail } from "./errors.js";
import { reply, type Reply, type Req } from "./http.js";
import {
  ACTIVE_SESSION_SQL,
  FACILITATOR_COOKIE,
  checkPassword,
  clearCookie,
  cookie,
  facilitatorFromCookie,
  hashToken,
  linkExpiresAt,
  newToken,
  participantCookieName,
  participantSessions,
} from "./auth.js";
import { checkSigninFailures, consume, recordSigninFailure } from "./rateLimit.js";
import { assertWritable, entitlementsOf } from "./billing.js";
import { lockWorkshop } from "./store.js";
import { commit } from "./versions.js";
import { boundedText } from "./rules.js";

function facilitatorJson(f: { name: string; email: string; timeZone: string }) {
  return { facilitator: { name: f.name, email: f.email, timeZone: f.timeZone } };
}

export async function signIn(req: Req): Promise<Reply> {
  const body = req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>) : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const key = `${email}|${req.ip}`;
  await checkSigninFailures(req, key);
  const fields: Record<string, string> = {};
  if (typeof body.email !== "string" || !body.email.trim()) fields.email = FIELD.other;
  if (typeof body.password !== "string" || !body.password) fields.password = FIELD.other;
  if (Object.keys(fields).length) throw new ApiError("validation", { fields });
  const row = await db.one<{ id: string; name: string; email: string; time_zone: string; password_hash: string }>(
    "SELECT id, name, email, time_zone, password_hash FROM facilitators WHERE email = $1",
    [email],
  );
  if (!row || !checkPassword(body.password as string, row.password_hash)) {
    await recordSigninFailure(req, key);
    fail("invalid_credentials");
  }
  const token = newToken();
  await db.run("INSERT INTO facilitator_sessions (token_hash, facilitator_id) VALUES ($1, $2)", [hashToken(token), row.id]);
  return reply(200, facilitatorJson({ name: row.name, email: row.email, timeZone: row.time_zone }), { cookies: [cookie(FACILITATOR_COOKIE, token)] });
}

export async function currentSession(req: Req): Promise<Reply> {
  const f = await facilitatorFromCookie(req);
  if (!f) fail("unauthenticated");
  return reply(200, facilitatorJson(f));
}

export async function signOut(req: Req): Promise<Reply> {
  const token = req.cookies[FACILITATOR_COOKIE];
  if (token) await db.run("DELETE FROM facilitator_sessions WHERE token_hash = $1", [hashToken(token)]);
  return reply(204, undefined, { cookies: [clearCookie(FACILITATOR_COOKIE)] });
}

interface LinkRow {
  link_id: string;
  revoked_at: Date | null;
  workshop_id: string;
  facilitator_id: string;
  title: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  end_at: Date;
  time_zone: string;
}

/** 404 for an unknown link, 410 for a revoked or expired one. */
async function usableLink(token: string): Promise<LinkRow> {
  const link = await db.one<LinkRow>(
    `SELECT l.id AS link_id, l.revoked_at, w.id AS workshop_id, w.facilitator_id, w.title, w.status, w.scheduled_start, w.scheduled_end, w.end_at, f.time_zone
     FROM join_links l JOIN workshops w ON w.id = l.workshop_id JOIN facilitators f ON f.id = w.facilitator_id WHERE l.token = $1`,
    [token],
  );
  if (!link) fail("not_found");
  if (link.revoked_at) fail("link_revoked");
  if (Date.now() >= linkExpiresAt(link.end_at).getTime()) fail("link_expired");
  return link;
}

export async function joinInfo(_req: Req, p: Record<string, string>): Promise<Reply> {
  const link = await usableLink(p.token ?? "");
  return reply(200, {
    workshop: { title: link.title, status: link.status, scheduledStart: link.scheduled_start, scheduledEnd: link.scheduled_end, timeZone: link.time_zone },
  });
}

export async function join(req: Req, p: Record<string, string>): Promise<Reply> {
  await consume(req, "join", req.ip);
  const link = await usableLink(p.token ?? "");
  const existing = (await participantSessions(req)).active.find((s) => s.workshopId === link.workshop_id);
  if (existing) return reply(200, { participant: { id: existing.id, displayName: existing.displayName }, workshopId: link.workshop_id });
  const token = newToken();
  const participant = await tx(async (t) => {
    const w = await lockWorkshop(t, link.workshop_id);
    await assertWritable(t, w.facilitator_id);
    if (w.status === "draft") fail("workshop_not_open");
    if (w.status === "closed" || w.status === "archived") fail("workshop_closed");
    const name = boundedText(req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>).displayName : undefined, 1, 40);
    if (name === null) throw new ApiError("validation", { fields: { displayName: FIELD.other } });
    const cap = (await entitlementsOf(t, w.facilitator_id)).participantsPerWorkshop;
    const active = await t.one<{ n: number }>(
      `SELECT count(*) AS n FROM participants p JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id
       WHERE p.workshop_id = $1 AND ${ACTIVE_SESSION_SQL}`,
      [w.id],
    );
    if ((active?.n ?? 0) >= cap) fail("room_full");
    const id = newId();
    await t.run("INSERT INTO participants (id, workshop_id, link_id, display_name, session_hash, cursor_id, hue) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id, w.id, link.link_id, name, hashToken(token), newId(), crypto.randomInt(0, 360),
    ]);
    await commit(t, w.id);
    return { id, displayName: name };
  });
  return reply(201, { participant, workshopId: link.workshop_id }, { cookies: [cookie(participantCookieName(link.workshop_id), token)] });
}
