/** Join endpoints (DP-06, DP-53, DP-57). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_MESSAGES as FM } from './errors.js';
import { ApiError, sendJson } from './http.js';
import { newId } from './ids.js';
import { RATE_CLASSES, takeRateSlot } from './ops.js';
import type { Ctx } from './context.js';
import { ipOf, newSessionId, setCookie } from './context.js';
import type { JoinLink, Workshop } from './db.js';

export async function handleJoinInfo(req: IncomingMessage, res: ServerResponse, ctx: Ctx, token: string): Promise<void> {
  const info = await joinTarget(ctx, token);
  sendJson(res, 200, {
    workshop: {
      title: info.workshop.title,
      status: info.workshop.status,
      scheduledStart: info.workshop.scheduled_start,
      scheduledEnd: info.workshop.scheduled_end,
      timeZone: info.timeZone,
    },
  });
}

interface JoinTarget { link: JoinLink; workshop: Workshop; timeZone: string }

async function joinTarget(ctx: Ctx, token: string): Promise<JoinTarget> {
  const link = await ctx.db.row<JoinLink>('select * from join_links where token = $1', [token]);
  if (!link) throw new ApiError(404, 'not_found');
  const workshop = await ctx.db.row<Workshop>('select * from workshops where id = $1', [link.workshop_id]);
  if (!workshop) throw new ApiError(404, 'not_found');
  const fac = await ctx.db.row<{ time_zone: string }>('select time_zone from facilitators where id = $1', [workshop.facilitator_id]);
  if (link.revoked) throw new ApiError(410, 'link_revoked');
  if (link.expires_at.getTime() <= Date.now()) throw new ApiError(410, 'link_expired');
  return { link, workshop, timeZone: fac?.time_zone ?? 'UTC' };
}

export async function handleJoinPost(req: IncomingMessage, res: ServerResponse, ctx: Ctx, token: string): Promise<void> {
  const bodyJson = await (await import('./context.js')).readJsonBody(req);
  // rate limit: join, per IP
  const limited = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.join, ipOf(req), RATE_CLASSES.join.windowSeconds));
  if (!limited.allowed) {
    throw new ApiError(429, 'rate_limited', {
      retryAfter: limited.reset,
      rateHeaders: { limit: RATE_CLASSES.join.limit, remaining: 0, reset: limited.reset },
    });
  }
  const { link, workshop, timeZone } = await joinTarget(ctx, token);
  // an existing valid session for this workshop keeps one participant
  const cookies = (await import('./http.js')).parseCookies(req);
  for (const [name, value] of Object.entries(cookies)) {
    if (name.startsWith('lf_p_') && value) {
      const row = await ctx.db.row<{ id: string; workshop_id: string; session_ended: boolean }>(
        'select id, workshop_id, session_ended from participants where session_id = $1', [value]);
      if (row && row.workshop_id === workshop.id && !row.session_ended) {
        sendJson(res, 200, { participant: { id: row.id, displayName: '' }, workshopId: workshop.id });
        return;
      }
    }
  }
  const displayName = typeof bodyJson.displayName === 'string' ? bodyJson.displayName.trim() : '';
  if (displayName.length < 1 || displayName.length > 40) {
    throw new ApiError(422, 'validation', { fields: { displayName: FM.fallback } });
  }
  if (workshop.status === 'draft') throw new ApiError(409, 'workshop_not_open');
  if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
  // room capacity (DP-53)
  const mirror = await ctx.db.tx((c) => import('./billing.js').then((mod) => mod.readMirror(c, workshop.facilitator_id)));
  const cap = mirror?.entitlements.participantsPerWorkshop ?? 8;
  const joinResult = await ctx.db.tx(async (c) => {
    const count = (await c.query('select count(*)::int as n from participants where workshop_id = $1 and session_ended = false', [workshop.id])).rows[0] as { n: number };
    if (count.n >= cap) return { full: true as const, participantId: null };
    const participantId = newId('pt');
    const sessionId = newSessionId();
    await c.query(
      `insert into participants (id, workshop_id, display_name, join_link_id, session_id, hue, active, session_ended)
       values ($1,$2,$3,$4,$5,$6,true,false)`,
      [participantId, workshop.id, displayName, link.id, sessionId, Math.floor(Math.random() * 360)]);
    return { full: false as const, participantId, sessionId, displayName };
  });
  if (joinResult.full) throw new ApiError(409, 'room_full');
  const cookieName = `lf_p_${workshop.id.slice(-12)}`;
  setCookie(res, cookieName, joinResult.sessionId ?? '', 7 * 86400);
  sendJson(res, 201, { participant: { id: joinResult.participantId ?? '', displayName }, workshopId: workshop.id });
  void timeZone;
}
