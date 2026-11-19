/** Shared API context: session loading, access checks and workshop shaping. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { Db, type Facilitator, type Workshop } from './db.js';
import { ApiError, sendJson, readBody, parseCookies, JSON_BODY_LIMIT } from './http.js';
import { FIELD_MESSAGES } from './errors.js';
import { verifyPassword } from './password.js';
import type { Viewer } from './board.js';
import type { KillBillClient, S3Client, StreamHub } from './clients.js';
import { centsToAmount } from './money.js';
import { resolveWallClock } from './time.js';
import { readMirror } from './billing.js';
import { invitesToday } from './ops.js';
import { dateKey } from './time.js';

export interface Ctx {
  cfg: Config;
  db: Db;
  kb: KillBillClient;
  s3: S3Client;
  hub: StreamHub;
  healthy: { killbill: boolean; minio: boolean; mail: boolean; at: number };
  /** true once Postgres is connected and the schema and seed are applied */
  ready: boolean;
}

export interface Session {
  role: 'facilitator' | 'participant';
  facilitator?: Facilitator;
  participant?: { id: string; workshop_id: string; display_name: string; session_ended: boolean; join_link_id: string; hue: number; session_id: string };
}

export function ipOf(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? '0.0.0.0';
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.startsWith('application/json')) throw new ApiError(415, 'unsupported_media_type');
  const body = await readBody(req, JSON_BODY_LIMIT);
  if (!body.ok) {
    if (body.tooLarge) throw new ApiError(413, 'too_large');
    throw new ApiError(400, 'validation', { message: 'Malformed body' });
  }
  if (body.buf.length === 0) return {};
  try {
    const parsed = JSON.parse(body.buf.toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'validation', { message: 'Malformed body' });
  }
}

export async function loadSession(req: IncomingMessage, db: Db): Promise<Session | null> {
  const cookies = parseCookies(req);
  const facSessionId = cookies['lf_fac'];
  if (facSessionId) {
    const row = await db.row<Facilitator>(
      `select f.* from facilitator_sessions s join facilitators f on f.id = s.facilitator_id
       where s.id = $1 and s.expires_at > now()`, [facSessionId]);
    if (row) return { role: 'facilitator', facilitator: row };
  }
  for (const [name, value] of Object.entries(cookies)) {
    if (name.startsWith('lf_p_') && value) {
      const row = await db.row<{ id: string; workshop_id: string; display_name: string; session_ended: boolean; join_link_id: string; hue: number; session_id: string }>(
        'select * from participants where session_id = $1', [value]);
      if (row) return { role: 'participant', participant: row };
    }
  }
  return null;
}

/** 401 unauthenticated, or session_ended when an ended participant session is present. */
export async function unauthenticatedError(req: IncomingMessage, db: Db): Promise<ApiError> {
  const cookies = parseCookies(req);
  for (const [name, value] of Object.entries(cookies)) {
    if (name.startsWith('lf_p_') && value) {
      const row = await db.row<{ session_ended: boolean }>('select session_ended from participants where session_id = $1', [value]);
      if (row && row.session_ended) return new ApiError(401, 'session_ended');
    }
  }
  return new ApiError(401, 'unauthenticated');
}

export async function requireFacilitator(req: IncomingMessage, db: Db): Promise<Facilitator> {
  const session = await loadSession(req, db);
  if (!session) throw await unauthenticatedError(req, db);
  if (session.role !== 'facilitator' || !session.facilitator) throw new ApiError(403, 'forbidden');
  return session.facilitator;
}

export async function requireWorkshopAccess(req: IncomingMessage, db: Db, workshopId: string): Promise<{ session: Session; workshop: Workshop; viewer: Viewer }> {
  const session = await loadSession(req, db);
  if (!session) throw await unauthenticatedError(req, db);
  const workshop = await db.row<Workshop>('select * from workshops where id = $1', [workshopId]);
  if (!workshop) throw new ApiError(404, 'not_found');
  if (session.role === 'facilitator' && session.facilitator) {
    if (workshop.facilitator_id !== session.facilitator.id) throw new ApiError(404, 'not_found');
    const viewer: Viewer = { role: 'facilitator', facilitatorId: session.facilitator.id, facilitatorName: session.facilitator.name };
    return { session, workshop, viewer };
  }
  const p = session.participant;
  if (!p || p.workshop_id !== workshopId) throw new ApiError(404, 'not_found');
  if (p.session_ended) throw new ApiError(401, 'session_ended');
  const viewer: Viewer = { role: 'participant', participantId: p.id, displayName: p.display_name };
  return { session, workshop, viewer };
}

export async function workshopForFacilitator(db: Db, workshopId: string, fac: Facilitator): Promise<Workshop> {
  const w = await db.row<Workshop>('select * from workshops where id = $1', [workshopId]);
  if (!w || w.facilitator_id !== fac.id) throw new ApiError(404, 'not_found');
  return w;
}

/** The facilitator workshop object (API). */
export async function facilitatorWorkshopObject(db: Db, cfg: Config, w: Workshop, fac: Facilitator): Promise<Record<string, unknown>> {
  const links = await db.rows<{ token: string; revoked: boolean; expires_at: Date }>(
    'select token, revoked, expires_at from join_links where workshop_id = $1 order by created_at desc', [w.id]);
  const active = links.find((l) => !l.revoked && l.expires_at.getTime() > Date.now()) ?? null;
  const participants = await db.rows<{ id: string; session_ended: boolean }>('select id, session_ended from participants where workshop_id = $1', [w.id]);
  const invites = await db.rows<{ email: string; status: string }>('select email, status from invites where workshop_id = $1 order by created_at', [w.id]);
  const mirror = await db.tx((c) => readMirror(c, fac.id));
  const endInstant = resolveWallClock(w.scheduled_end, fac.time_zone);
  const expiresAt = endInstant !== null ? new Date(endInstant + cfg.joinLinkGraceSeconds * 1000) : null;
  const recap = await db.row<{ recap_token: string; status: string; reason: string | null; attempts: number; files_stored_at: Date | null; email_sent_at: Date | null; recipients: number | null; scale: number; sponsor_invoice_id: string | null }>(
    'select * from recaps where workshop_id = $1', [w.id]);
  let recapObj: Record<string, unknown> | null = null;
  let invoiceObj: Record<string, unknown> | null = null;
  if (recap) {
    if (recap.sponsor_invoice_id) {
      const inv = await db.row<{ id: string; number: string; cents: number }>('select * from kb_invoices where id = $1', [recap.sponsor_invoice_id]);
      if (inv) invoiceObj = { id: inv.id, number: inv.number, amount: centsToAmount(inv.cents), currency: 'EUR' };
    }
    recapObj = {
      status: recap.status,
      reason: recap.reason,
      attempts: recap.attempts,
      filesStoredAt: recap.files_stored_at?.toISOString() ?? null,
      emailSentAt: recap.email_sent_at?.toISOString() ?? null,
      recipients: recap.recipients,
      recapUrl: `${cfg.publicBaseUrl}/recap/${recap.recap_token}`,
      scale: recap.scale,
      invoice: invoiceObj,
    };
  }
  return {
    id: w.id,
    title: w.title,
    template: w.template,
    status: w.status,
    scheduledStart: w.scheduled_start,
    scheduledEnd: w.scheduled_end,
    timeZone: fac.time_zone,
    sponsorEmail: w.sponsor_email,
    fee: { amount: centsToAmount(w.fee_cents), currency: 'EUR' },
    invites: invites.map((i) => ({ email: i.email, status: i.status })),
    joinUrl: active ? `${cfg.publicBaseUrl}/join/${active.token}` : null,
    joinLinkExpiresAt: expiresAt?.toISOString() ?? null,
    participantCount: participants.filter((p) => !p.session_ended).length,
    participantCap: mirror?.entitlements.participantsPerWorkshop ?? null,
    roundsUsed: w.round_number,
    round: w.round_ends_at ? { number: w.round_number, endsAt: w.round_ends_at.toISOString() } : null,
    voting: w.voting_ends_at ? { dotBudget: w.dot_budget, endsAt: w.voting_ends_at.toISOString() } : null,
    version: w.version,
    recap: recapObj,
  };
}

export async function usageFor(db: Db, fac: Facilitator): Promise<{ activeWorkshops: number; invitesToday: number }> {
  const activeWorkshops = await db.row<{ n: string }>("select count(*)::text as n from workshops where facilitator_id=$1 and status <> 'archived'", [fac.id]);
  const today = dateKey(new Date(), fac.time_zone);
  const invites = await db.tx((c) => invitesToday(c, fac.id, today));
  return { activeWorkshops: Number(activeWorkshops?.n ?? 0), invitesToday: invites };
}

export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number | null): void {
  const cookie = value.length === 0
    ? `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    : `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds ?? 2592000}`;
  const prev = res.getHeader('Set-Cookie');
  const cookies = typeof prev === 'string' ? [prev] : Array.isArray(prev) ? prev : [];
  cookies.push(cookie);
  res.setHeader('Set-Cookie', cookies);
}

export { sendJson, FIELD_MESSAGES, verifyPassword, JSON_BODY_LIMIT };
