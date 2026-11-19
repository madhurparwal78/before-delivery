// Facilitator endpoints: workshops, the session state machine, join links, invites, trash, versions and recap status.
import crypto from "node:crypto";
import { db, newId, notify, tx, type Db } from "./db.js";
import { ApiError, FIELD, fail, type Fields } from "./errors.js";
import { reply, type Reply, type Req } from "./http.js";
import { authenticate, actorKey, requireFacilitator, type Facilitator } from "./auth.js";
import { once } from "./ops.js";
import { record } from "./activity.js";
import { assertWritable, entitlementsOf, planOf } from "./billing.js";
import { findWorkshop, lockWorkshop, type WorkshopRow } from "./store.js";
import { closeVersion, commit, findVersion, listVersions, restoreVersion } from "./versions.js";
import { facilitatorWorkshop, recapObject } from "./projection.js";
import { listTrash } from "./trash.js";
import { bareAddress, chargeQuota, deliver, parseBatch, queueInvites } from "./invites.js";
import { resolveWallTime, type Resolution } from "./zone.js";
import { checkState } from "./rules.js";
import { attemptRecap } from "./recap.js";
import { amountToCents } from "../shared/money.js";
import { STATUS_LABELS, isEnded, isLegalEdge, isStatus, type Status } from "../shared/states.js";
import { FRAME_HEIGHT, FRAME_STEP, FRAME_WIDTH, TEMPLATES, isTemplate } from "../shared/templates.js";
import { PLAN_LABELS, type Plan } from "../shared/plans.js";

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

export function joinToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function facilitator(req: Req): Promise<Facilitator> {
  return requireFacilitator(await authenticate(req));
}

/** The facilitator's own workshop, or 404. Participants get 404 for another workshop and 403 for their own. */
async function ownWorkshop(req: Req, id: string): Promise<{ fac: Facilitator; w: WorkshopRow }> {
  const caller = await authenticate(req);
  const w = await findWorkshop(db, id);
  if (caller.facilitator) {
    if (!w || w.facilitator_id !== caller.facilitator.id) fail("not_found");
    return { fac: caller.facilitator, w };
  }
  if (!w || !caller.participants.some((p) => p.workshopId === w.id)) fail("not_found");
  fail("forbidden");
}

function planLimit(plan: Plan, limit: number, used: number, resource: string): never {
  throw new ApiError("plan_limit", {
    status: 402,
    message: `Your ${PLAN_LABELS[plan]} plan allows ${limit} ${resource}`,
    extra: { limit, used, plan },
  });
}

function scheduleField(resolution: Resolution, zone: string): string | null {
  if (resolution.ok) return null;
  return resolution.reason === "gap" ? FIELD.gap(zone) : FIELD.scheduleFormat;
}

interface NewWorkshop {
  title: string;
  template: keyof typeof TEMPLATES;
  scheduledStart: string;
  scheduledEnd: string;
  startAt: Date;
  endAt: Date;
  sponsorEmail: string;
  feeCents: number;
}

function validateWorkshop(body: Record<string, unknown>, zone: string): NewWorkshop {
  const fields: Fields = {};
  const rawTitle = typeof body.title === "string" ? body.title : "";
  const title = rawTitle.trim();
  if (CONTROL.test(rawTitle)) fields.title = FIELD.titleControl;
  else if ([...title].length < 1 || [...title].length > 120) fields.title = FIELD.titleLength;
  if (!isTemplate(body.template)) fields.template = FIELD.template;
  const start = resolveWallTime(body.scheduledStart, zone);
  const end = resolveWallTime(body.scheduledEnd, zone);
  const startError = scheduleField(start, zone);
  const endError = scheduleField(end, zone);
  if (startError) fields.scheduledStart = startError;
  if (endError) fields.scheduledEnd = endError;
  if (start.ok && end.ok && end.instant.getTime() <= start.instant.getTime()) fields.scheduledEnd = FIELD.endAfterStart;
  const sponsor = bareAddress(body.sponsorEmail);
  if (!sponsor) fields.sponsorEmail = FIELD.sponsorEmail;
  let feeCents = 0;
  if ("fee" in body) {
    const cents = typeof body.fee === "string" ? amountToCents(body.fee) : null;
    if (cents === null || cents > 10_000_000) fields.fee = FIELD.fee;
    else feeCents = cents;
  }
  if (Object.keys(fields).length || !start.ok || !end.ok || !sponsor || !isTemplate(body.template)) throw new ApiError("validation", { fields });
  return {
    title,
    template: body.template,
    scheduledStart: body.scheduledStart as string,
    scheduledEnd: body.scheduledEnd as string,
    startAt: start.instant,
    endAt: end.instant,
    sponsorEmail: sponsor,
    feeCents,
  };
}

export async function listWorkshops(req: Req): Promise<Reply> {
  const fac = await facilitator(req);
  const rows = await db.rows<WorkshopRow>(
    `SELECT w.*, f.time_zone, f.name AS facilitator_name FROM workshops w JOIN facilitators f ON f.id = w.facilitator_id
     WHERE w.facilitator_id = $1 ORDER BY w.start_at DESC, w.created_at DESC`,
    [fac.id],
  );
  return reply(200, { workshops: await Promise.all(rows.map((w) => facilitatorWorkshop(db, w))) });
}

export async function createWorkshop(req: Req): Promise<Reply> {
  const fac = await facilitator(req);
  const body = req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>) : {};
  const id = await tx(async (t) => {
    await t.run("SELECT 1 FROM facilitators WHERE id = $1 FOR UPDATE", [fac.id]);
    await assertWritable(t, fac.id);
    const input = validateWorkshop(body, fac.timeZone);
    const cap = (await entitlementsOf(t, fac.id)).activeWorkshops;
    const used = (await t.one<{ n: number }>("SELECT count(*) AS n FROM workshops WHERE facilitator_id = $1 AND status <> 'archived'", [fac.id]))?.n ?? 0;
    if (cap !== null && used >= cap) planLimit(await planOf(t, fac.id), cap, used, "active workshops");
    const workshopId = newId();
    await t.run(
      `INSERT INTO workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end, start_at, end_at, sponsor_email, fee_cents)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10)`,
      [workshopId, fac.id, input.title, input.template, input.scheduledStart, input.scheduledEnd, input.startAt, input.endAt, input.sponsorEmail, input.feeCents],
    );
    await addTemplateFrames(t, workshopId, input.template);
    await t.run("INSERT INTO join_links (id, workshop_id, token) VALUES ($1, $2, $3)", [newId(), workshopId, joinToken()]);
    await record(t, fac.id, "workshop.created", workshopId);
    return workshopId;
  });
  const w = await findWorkshop(db, id);
  if (!w) fail("not_found");
  return reply(201, { workshop: await facilitatorWorkshop(db, w) });
}

export async function addTemplateFrames(t: Db, workshopId: string, template: keyof typeof TEMPLATES): Promise<string[]> {
  const ids: string[] = [];
  for (const [position, title] of TEMPLATES[template].frames.entries()) {
    const id = newId();
    ids.push(id);
    await t.run("INSERT INTO frames (id, workshop_id, title, x, y, width, height, position) VALUES ($1, $2, $3, $4, 0, $5, $6, $7)", [
      id, workshopId, title, position * FRAME_STEP, FRAME_WIDTH, FRAME_HEIGHT, position,
    ]);
  }
  return ids;
}

export async function getWorkshop(req: Req, p: Record<string, string>): Promise<Reply> {
  const { w } = await ownWorkshop(req, p.id ?? "");
  return reply(200, { workshop: await facilitatorWorkshop(db, w) });
}

function whole(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export async function transition(req: Req, p: Record<string, string>): Promise<Reply> {
  const { fac, w: found } = await ownWorkshop(req, p.id ?? "");
  const body = req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>) : {};
  const out = await once(req, actorKey(fac), async (t) => {
    const w = await lockWorkshop(t, found.id);
    await assertWritable(t, fac.id);
    if (!isStatus(body.to)) throw new ApiError("validation", { fields: { to: FIELD.other } });
    const to: Status = body.to;
    if (!isLegalEdge(w.status, to) && isEnded(w.status)) fail("workshop_closed");
    if (!isLegalEdge(w.status, to)) {
      throw new ApiError("illegal_transition", { message: `The workshop can't move from ${STATUS_LABELS[w.status]} to ${STATUS_LABELS[to]}` });
    }
    const fields: Fields = {};
    if ((to === "silent_round" || to === "voting") && !whole(body.durationSeconds, 5, 3600)) fields.durationSeconds = FIELD.other;
    if (to === "voting" && !whole(body.dotBudget, 1, 20)) fields.dotBudget = FIELD.other;
    if (Object.keys(fields).length) throw new ApiError("validation", { fields });
    const entitlements = await entitlementsOf(t, fac.id);
    const roundCap = entitlements.silentRoundsPerWorkshop;
    if (to === "silent_round" && roundCap !== null && w.round_number >= roundCap) {
      planLimit(await planOf(t, fac.id), roundCap, w.round_number, "silent rounds per workshop");
    }
    const seconds = typeof body.durationSeconds === "number" ? body.durationSeconds : 0;
    if (to === "silent_round") {
      await t.run("UPDATE workshops SET status = $2, round_number = round_number + 1, round_ends_at = $3 WHERE id = $1", [
        w.id, to, new Date(Date.now() + seconds * 1000),
      ]);
    } else if (to === "voting") {
      await t.run("UPDATE workshops SET status = $2, dot_budget = $3, voting_ends_at = $4 WHERE id = $1", [
        w.id, to, body.dotBudget as number, new Date(Date.now() + seconds * 1000),
      ]);
    } else {
      await t.run("UPDATE workshops SET status = $2 WHERE id = $1", [w.id, to]);
    }
    if (to === "revealed") await t.run("UPDATE notes SET revealed = true WHERE workshop_id = $1 AND NOT revealed", [w.id]);
    await record(t, fac.id, "workshop.transitioned", w.id);
    const version = await commit(t, w.id);
    if (to === "closed") {
      await closeVersion(t, w.id, version);
      await t.run("INSERT INTO recaps (workshop_id, token, status, scale) VALUES ($1, $2, 'queued', $3)", [w.id, joinToken(), entitlements.recapScale]);
    }
    const updated = await findWorkshop(t, w.id);
    if (!updated) fail("not_found");
    return reply(200, { workshop: await facilitatorWorkshop(t, updated) });
  });
  if (out.status === 200 && body.to === "closed") void attemptRecap(found.id);
  return out;
}

async function revokeLink(t: Db, w: WorkshopRow): Promise<void> {
  await t.run("UPDATE join_links SET revoked_at = now() WHERE workshop_id = $1 AND revoked_at IS NULL", [w.id]);
  await notify(t, { t: "ended", w: w.id });
}

export async function rotateLink(req: Req, p: Record<string, string>): Promise<Reply> {
  const { fac, w: found } = await ownWorkshop(req, p.id ?? "");
  return tx(async (t) => {
    const w = await lockWorkshop(t, found.id);
    await assertWritable(t, fac.id);
    checkState(fac, w, "link");
    await revokeLink(t, w);
    await t.run("INSERT INTO join_links (id, workshop_id, token) VALUES ($1, $2, $3)", [newId(), w.id, joinToken()]);
    await record(t, fac.id, "join_link.rotated", w.id);
    await commit(t, w.id);
    const view = await facilitatorWorkshop(t, w);
    return reply(200, { joinUrl: view.joinUrl, joinLinkExpiresAt: view.joinLinkExpiresAt });
  });
}

export async function turnOffLink(req: Req, p: Record<string, string>): Promise<Reply> {
  const { fac, w: found } = await ownWorkshop(req, p.id ?? "");
  return tx(async (t) => {
    const w = await lockWorkshop(t, found.id);
    await assertWritable(t, fac.id);
    checkState(fac, w, "link");
    await revokeLink(t, w);
    await record(t, fac.id, "join_link.turned_off", w.id);
    await commit(t, w.id);
    return reply(200, { joinUrl: null });
  });
}

export async function sendInvites(req: Req, p: Record<string, string>): Promise<Reply> {
  const { fac, w: found } = await ownWorkshop(req, p.id ?? "");
  const body = req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>) : {};
  const { emails, ids } = await tx(async (t) => {
    const w = await lockWorkshop(t, found.id);
    await assertWritable(t, fac.id);
    checkState(fac, w, "link");
    const link = await t.one("SELECT 1 AS ok FROM join_links WHERE workshop_id = $1 AND revoked_at IS NULL", [w.id]);
    if (!link) fail("no_join_link");
    const batch = parseBatch(body.emails);
    await chargeQuota(t, { id: fac.id, time_zone: fac.timeZone }, batch.length);
    const queued = await queueInvites(t, w, batch);
    await commit(t, w.id);
    return { emails: batch, ids: queued };
  });
  await deliver(ids);
  const statuses = await db.rows<{ id: string; status: string }>("SELECT id, status FROM invites WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))", [ids]);
  const byId = new Map(statuses.map((s) => [s.id, s.status]));
  return reply(202, { invites: emails.map((email, i) => ({ email, status: byId.get(ids[i] ?? "") ?? "queued" })) });
}

export async function trashList(req: Req, p: Record<string, string>): Promise<Reply> {
  const { w } = await ownWorkshop(req, p.id ?? "");
  return reply(200, { items: await listTrash(db, w.id) });
}

export async function versionList(req: Req, p: Record<string, string>): Promise<Reply> {
  const { w } = await ownWorkshop(req, p.id ?? "");
  return reply(200, { versions: await listVersions(db, w.id) });
}

export async function versionRestore(req: Req, p: Record<string, string>): Promise<Reply> {
  const { fac, w: found } = await ownWorkshop(req, p.id ?? "");
  const version = await findVersion(db, found.id, p.versionId ?? "");
  if (!version) fail("not_found");
  return once(req, actorKey(fac), async (t) => {
    const w = await lockWorkshop(t, found.id);
    await assertWritable(t, fac.id);
    checkState(fac, w, "versionRestore");
    const current = await findVersion(t, w.id, version.id);
    if (!current) fail("not_found");
    const saved = await restoreVersion(t, w, current.snapshot);
    const updated = await findWorkshop(t, w.id);
    if (!updated) fail("not_found");
    return reply(200, { workshop: await facilitatorWorkshop(t, updated), restoredFrom: current.version, saved });
  });
}

export async function recapStatus(req: Req, p: Record<string, string>): Promise<Reply> {
  const { w } = await ownWorkshop(req, p.id ?? "");
  const recap = await recapObject(db, w);
  if (!recap || !isEnded(w.status)) fail("not_closed");
  return reply(200, recap);
}
