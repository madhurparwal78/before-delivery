/** Session, workshop lifecycle, join links and invite handlers. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_MESSAGES as FM } from './errors.js';
import { ApiError, sendJson } from './http.js';
import { STATUS_LABELS, LEGAL_EDGES, TEMPLATES, type TemplateCode, type WorkshopStatus } from '../domain.js';
import { ensureTemplateFrames, type Workshop } from './db.js';
import { newId, newJoinToken, newRecapToken } from './ids.js';
import { resolveWallClock, dateKey } from './time.js';
import { parseFee } from './money.js';
import { verifyPassword } from './password.js';
import { invitesToday, addInviteCount, RATE_CLASSES, takeRateSlot, signinLimited, countSigninFailure } from './ops.js';
import {
  Ctx, loadSession, requireFacilitator, readJsonBody, ipOf, facilitatorWorkshopObject, workshopForFacilitator,
  newSessionId, setCookie, unauthenticatedError,
} from './context.js';
import type { PoolClient } from 'pg';
import { bumpVersion, snapshotForClose, notifyEnded } from './versions.js';

/** The bare-address rule (Business rules), decided once. */
export function isBareAddress(s: string): boolean {
  if (s.length > 254 || s.length === 0) return false;
  const m = /^local@domain$/.exec('local@domain');
  void m;
  return /^[^\s<>;,"'@]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(s)
    && !/[\s\x00-\x1f\x7f]/.test(s);
}

export async function handleSignIn(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const body = await readJsonBody(req);
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (typeof body.email !== 'string' || body.email.length === 0) fields.email = FM.fallback;
  if (typeof body.password !== 'string' || body.password.length === 0) fields.password = FM.fallback;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  const limited = await ctx.db.tx((c) => signinLimited(c, email, ipOf(req), ctx.cfg.signinWindowSeconds));
  if (limited) {
    const scope = `${email}|${ipOf(req)}`;
    const win = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.signinFailure, scope, ctx.cfg.signinWindowSeconds));
    throw new ApiError(429, 'rate_limited', {
      retryAfter: win.reset,
      rateHeaders: { limit: RATE_CLASSES.signinFailure.limit, remaining: 0, reset: win.reset },
    });
  }
  const fac = await ctx.db.row<{ id: string; email: string; name: string; password_hash: string; time_zone: string }>(
    'select * from facilitators where email = $1', [email]);
  if (!fac || !verifyPassword(password, fac.password_hash)) {
    await ctx.db.tx((c) => countSigninFailure(c, email, ipOf(req), ctx.cfg.signinWindowSeconds));
    throw new ApiError(401, 'invalid_credentials');
  }
  const sessionId = newSessionId();
  const expires = new Date(Date.now() + 30 * 86400000);
  await ctx.db.createFacilitatorSession(fac.id, sessionId, expires);
  setCookie(res, 'lf_fac', sessionId, 30 * 86400);
  sendJson(res, 200, { facilitator: { name: fac.name, email: fac.email, timeZone: fac.time_zone } });
}

export async function handleSignOut(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const { parseCookies } = await import('./http.js');
  const sid = parseCookies(req)['lf_fac'];
  if (sid) await ctx.db.deleteFacilitatorSession(sid);
  setCookie(res, 'lf_fac', '', 0);
  sendJson(res, 204, undefined);
}

export async function handleGetSession(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const session = await loadSession(req, ctx.db);
  if (!session || session.role !== 'facilitator' || !session.facilitator) {
    throw await unauthenticatedError(req, ctx.db);
  }
  sendJson(res, 200, { facilitator: { name: session.facilitator.name, email: session.facilitator.email, timeZone: session.facilitator.time_zone } });
}

// ---- workshops

export async function handleListWorkshops(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const workshops = await ctx.db.rows<Workshop>('select * from workshops where facilitator_id = $1', [fac.id]);
  workshops.sort((a, b) => (a.scheduled_start < b.scheduled_start ? 1 : a.scheduled_start > b.scheduled_start ? -1 : a.id < b.id ? 1 : -1));
  const out: Record<string, unknown>[] = [];
  for (const w of workshops) {
    out.push(await facilitatorWorkshopObject(ctx.db, ctx.cfg, w, fac));
  }
  sendJson(res, 200, { workshops: out });
}

export async function handleCreateWorkshop(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const body = await readJsonBody(req);
  const fields: Record<string, string> = {};
  const title = typeof body.title === 'string' ? body.title : '';
  if (title.length < 1 || title.length > 120) fields.title = FM.workshopTitleLength;
  if (/[\x00-\x1f\x7f\u2028\u2029]/.test(title)) fields.title = FM.workshopTitleControl;
  const template = typeof body.template === 'string' ? body.template : '';
  if (!(template in TEMPLATES)) fields.template = FM.template;
  const starts = typeof body.scheduledStart === 'string' ? body.scheduledStart : '';
  const ends = typeof body.scheduledEnd === 'string' ? body.scheduledEnd : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(starts)) fields.scheduledStart = FM.datetimeMalformed;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ends)) fields.scheduledEnd = FM.datetimeMalformed;
  const sponsorEmail = typeof body.sponsorEmail === 'string' ? body.sponsorEmail.trim() : '';
  if (!isBareAddress(sponsorEmail)) fields.sponsorEmail = FM.sponsorEmail;
  let feeCents = 0;
  const feeRaw = body.fee;
  if (feeRaw !== undefined && feeRaw !== null && feeRaw !== '') {
    const parsed = parseFee(feeRaw);
    if (!parsed.ok) fields.fee = FM.fee;
    else feeCents = parsed.cents;
  }
  let startInstant: number | null = null;
  let endInstant: number | null = null;
  if (!fields.scheduledStart) {
    startInstant = resolveWallClock(starts, fac.time_zone);
    if (startInstant === null) fields.scheduledStart = FM.datetimeGap(fac.time_zone);
  }
  if (!fields.scheduledEnd) {
    endInstant = resolveWallClock(ends, fac.time_zone);
    if (endInstant === null) fields.scheduledEnd = FM.datetimeGap(fac.time_zone);
  }
  if (startInstant !== null && endInstant !== null && endInstant <= startInstant) fields.scheduledEnd = FM.endNotAfterStart;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });

  // entitlement check: active workshops
  const mirror = await ctx.db.tx((c) => import('./billing.js').then((mod) => mod.readMirror(c, fac.id)));
  const cap = mirror?.entitlements.activeWorkshops ?? null;
  const activeCount = await ctx.db.row<{ n: string }>("select count(*)::text as n from workshops where facilitator_id=$1 and status <> 'archived'", [fac.id]);
  if (cap !== null && Number(activeCount?.n ?? 0) >= cap) {
    throw new ApiError(402, 'plan_limit', {
      message: `Your ${mirror?.plan ?? 'free'} plan allows ${cap} active workshops`,
      extra: { limit: cap, used: Number(activeCount?.n ?? 0), plan: mirror?.plan ?? 'free' },
    });
  }
  const workshopId = newId('ws');
  const token = newJoinToken();
  await ctx.db.tx(async (c) => {
    await c.query(
      `insert into workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end, sponsor_email, fee_cents, version)
       values ($1,$2,$3,$4,'draft',$5,$6,$7,$8,1)`,
      [workshopId, fac.id, title, template, starts, ends, sponsorEmail.toLowerCase(), feeCents]);
    await ensureTemplateFrames(c, workshopId, template as TemplateCode);
    const endInst = resolveWallClock(ends, fac.time_zone) ?? Date.now();
    await c.query(
      `insert into join_links (id, workshop_id, token, revoked, expires_at) values ($1,$2,$3,false, $4)`,
      [newId('jl'), workshopId, token, new Date(endInst + ctx.cfg.joinLinkGraceSeconds * 1000)]);
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','workshop.created',$3)`,
      [newId('act'), fac.id, workshopId]);
  });
  ctx.hub.pushBoardEvent(workshopId, 1);
  const w = await workshopForFacilitator(ctx.db, workshopId, fac);
  sendJson(res, 201, { workshop: await facilitatorWorkshopObject(ctx.db, ctx.cfg, w, fac) });
}

export async function handleGetWorkshop(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const w = await workshopForFacilitator(ctx.db, workshopId, fac);
  sendJson(res, 200, { workshop: await facilitatorWorkshopObject(ctx.db, ctx.cfg, w, fac) });
}

// ---- transitions

export async function handleTransition(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const w = await workshopForFacilitator(ctx.db, workshopId, fac);
  const body = await readJsonBody(req);
  const { validOpId, opIdError, withReplay, bodyHashOf } = await import('./ops.js');
  const opId = body.clientOpId;
  if (!validOpId(opId)) throw opIdError();
  const to = typeof body.to === 'string' ? body.to : '';
  let durationSeconds = 300;
  let dotBudget = 3;
  if (to === 'silent_round' || to === 'voting') {
    const d = body.durationSeconds;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 5 || d > 3600) {
      throw new ApiError(422, 'validation', { fields: { durationSeconds: FM.fallback } });
    }
    durationSeconds = d;
  }
  if (to === 'voting') {
    const b = body.dotBudget;
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 1 || b > 20) {
      throw new ApiError(422, 'validation', { fields: { dotBudget: FM.fallback } });
    }
    dotBudget = b;
  }
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: opId as string, method: 'POST', path: `/api/workshops/${workshopId}/transitions`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const current = (await c.query('select * from workshops where id = $1 for update', [workshopId])).rows[0] as Workshop | undefined;
    if (!current) throw new ApiError(404, 'not_found');
    // DP-03: workshop_closed first for edges out of closed/archived
    if ((current.status === 'closed' || current.status === 'archived') && to !== 'archived') {
      throw new ApiError(409, 'workshop_closed');
    }
    if (current.status === 'closed' && to === 'archived') {
      const updated = await applyTransition(ctx, c, current, to, durationSeconds, dotBudget, fac);
      return { status: 200, body: { workshop: updated } };
    }
    const legal = LEGAL_EDGES[current.status as WorkshopStatus] ?? [];
    if (!legal.includes(to as WorkshopStatus)) {
      throw new ApiError(409, 'illegal_transition', {
        message: `The workshop can't move from ${STATUS_LABELS[current.status as WorkshopStatus]} to ${STATUS_LABELS[to as WorkshopStatus] ?? to}`,
      });
    }
    if (to === 'silent_round') {
      const mirror = await (await import('./billing.js')).readMirror(c, fac.id);
      const cap = mirror?.entitlements.silentRoundsPerWorkshop ?? null;
      if (cap !== null && current.round_number >= cap) {
        throw new ApiError(402, 'plan_limit', {
          message: `Your ${mirror?.plan ?? 'free'} plan allows ${cap} silent rounds per workshop`,
          extra: { limit: cap, used: current.round_number, plan: mirror?.plan ?? 'free' },
        });
      }
    }
    const updated = await applyTransition(ctx, c, current, to, durationSeconds, dotBudget, fac);
    return { status: 200, body: { workshop: updated } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  if (result.status === 200) {
    const w2 = await workshopForFacilitator(ctx.db, workshopId, fac);
    result.body = { workshop: await facilitatorWorkshopObject(ctx.db, ctx.cfg, w2, fac) };
  }
  sendJson(res, result.status, result.body);
}

async function currentVersion(ctx: Ctx, workshopId: string): Promise<number> {
  const row = await ctx.db.row<{ version: number }>('select version from workshops where id = $1', [workshopId]);
  return row?.version ?? 1;
}

async function applyTransition(ctx: Ctx, c: PoolClient, current: Workshop, to: string, durationSeconds: number, dotBudget: number, fac: { id: string; time_zone: string }): Promise<Record<string, unknown>> {
  const now = new Date();
  let roundEndsAt: Date | null = null;
  let votingEndsAt: Date | null = null;
  let roundNumber = current.round_number;
  let dotBudgetValue = current.dot_budget;
  let newVersion = current.version + 1;
  if (to === 'silent_round') {
    roundNumber = current.round_number + 1;
    roundEndsAt = new Date(now.getTime() + durationSeconds * 1000);
  } else if (to === 'voting') {
    votingEndsAt = new Date(now.getTime() + durationSeconds * 1000);
    dotBudgetValue = dotBudget;
  } else if (to === 'revealed') {
    roundEndsAt = null;
    await c.query('update notes set revealed = true where workshop_id = $1 and revealed = false', [current.id]);
  } else if (to === 'closed') {
    votingEndsAt = null;
    roundEndsAt = null;
  }
  await c.query(
    'update workshops set status=$2, round_number=$3, round_ends_at=$4, voting_ends_at=$5, dot_budget=$6 where id=$1',
    [current.id, to, roundNumber, roundEndsAt, votingEndsAt, dotBudgetValue]);
  const version = await bumpVersion(c, current.id);
  if (to === 'closed') {
    // the close snapshot is written before the response
    await snapshotForClose(c, current.id, version);
    const token = newRecapToken();
    await c.query(
      `insert into recaps (workshop_id, recap_token, status, scale) values ($1,$2,'queued',$3)
       on conflict (workshop_id) do nothing`,
      [current.id, token, (await (await import('./billing.js')).readMirror(c, fac.id))?.entitlements.recapScale ?? 1]);
  }
  await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator',$3,$4)`,
    [newId('act'), fac.id, 'workshop.transitioned', current.id]);
  return { status: current.status };
}



// ---- join links

export async function handleLinkRotate(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const w = await workshopForFacilitator(ctx.db, workshopId, fac);
  const token = newJoinToken();
  const endInstant = resolveWallClock(w.scheduled_end, fac.time_zone) ?? Date.now();
  const expiresAt = new Date(endInstant + ctx.cfg.joinLinkGraceSeconds * 1000);
  await ctx.db.tx(async (c) => {
    const old = (await c.query(`select id from join_links where workshop_id = $1 and revoked = false for update`, [workshopId])).rows as Array<{ id: string }>;
    for (const l of old) {
      await c.query('update join_links set revoked = true where id = $1', [l.id]);
      const ended = await endSessionsForLink(c, l.id);
      await notifyEnded(c, workshopId, ended);
    }
    await c.query(`insert into join_links (id, workshop_id, token, revoked, expires_at) values ($1,$2,$3,false,$4)`,
      [newId('jl'), workshopId, token, expiresAt]);
    await bumpVersion(c, workshopId);
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','join_link.rotated',$3)`,
      [newId('act'), fac.id, workshopId]);
  });
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, 200, { joinUrl: `${ctx.cfg.publicBaseUrl}/join/${token}`, joinLinkExpiresAt: expiresAt.toISOString() });
}

export async function handleLinkOff(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  await workshopForFacilitator(ctx.db, workshopId, fac);
  await ctx.db.tx(async (c) => {
    const old = (await c.query(`select id from join_links where workshop_id = $1 and revoked = false for update`, [workshopId])).rows as Array<{ id: string }>;
    for (const l of old) {
      await c.query('update join_links set revoked = true where id = $1', [l.id]);
      const ended = await endSessionsForLink(c, l.id);
      await notifyEnded(c, workshopId, ended);
    }
    await bumpVersion(c, workshopId);
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','join_link.turned_off',$3)`,
      [newId('act'), fac.id, workshopId]);
  });
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, 200, { joinUrl: null });
}

export async function endSessionsForLink(c: PoolClient, linkId: string): Promise<string[]> {
  const rows = (await c.query(
    'update participants set session_ended = true, active = false where join_link_id = $1 and session_ended = false returning id',
    [linkId])).rows as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ---- invites

export async function handleInvites(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const w = await workshopForFacilitator(ctx.db, workshopId, fac);
  const body = await readJsonBody(req);
  const emailsRaw = Array.isArray(body.emails) ? body.emails : [];
  const entries = emailsRaw.map((e) => (typeof e === 'string' ? e.trim() : ''));
  const fields: Record<string, string> = {};
  if (entries.length < 1 || entries.length > 30) fields.emails = FM.emailsCount;
  for (const e of entries) {
    if (!isBareAddress(e)) { fields.emails = FM.emailsEntry; break; }
  }
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  // distinct by lower case, first-seen order
  const distinct: string[] = [];
  for (const e of entries) {
    const lower = e.toLowerCase();
    if (!distinct.includes(lower)) distinct.push(lower);
  }
  // quota
  const today = dateKey(new Date(), fac.time_zone);
  const mirror = await ctx.db.tx((c) => import('./billing.js').then((mod) => mod.readMirror(c, fac.id)));
  const quota = mirror?.entitlements.invitesPerDay ?? 20;
  const used = await ctx.db.tx((c) => invitesToday(c, fac.id, today));
  if (used + distinct.length > quota) {
    const wait = (await import('./time.js')).secondsUntilMidnight(new Date(), fac.time_zone);
    throw new ApiError(429, 'quota_exceeded', {
      message: "You've reached today's invite limit",
      extra: { limit: quota, used, plan: mirror?.plan ?? 'free' },
      retryAfter: wait,
    });
  }
  const activeLink = await ctx.db.row<{ token: string }>(
    'select token from join_links where workshop_id = $1 and revoked = false and expires_at > now() order by created_at desc limit 1', [workshopId]);
  if (!activeLink) throw new ApiError(409, 'no_join_link');
  const mailUp = ctx.healthy.mail;
  const out = await ctx.db.tx(async (c) => {
    for (const email of distinct) {
      await c.query(
        `insert into invites (id, workshop_id, email, status) values ($1,$2,$3,$4)
         on conflict (workshop_id, email) do update set status = $4`,
        [newId('inv'), workshopId, email, mailUp ? 'sent' : 'queued']);
      await c.query(
        `insert into invite_queue (id, workshop_id, email) values ($1,$2,$3)
         on conflict (workshop_id, email) do nothing`,
        [newId('q'), workshopId, email]);
    }
    await addInviteCount(c, fac.id, today, distinct.length);
    await bumpVersion(c, workshopId);
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','invites.sent',$3)`,
      [newId('act'), fac.id, workshopId]);
    const rows = (await c.query('select email, status from invites where workshop_id = $1 order by created_at', [workshopId])).rows as Array<{ email: string; status: string }>;
    return distinct.map((d) => ({ email: d, status: rows.find((r) => r.email === d)?.status ?? 'queued' }));
  });
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  void w;
  sendJson(res, 202, { invites: out });
}
