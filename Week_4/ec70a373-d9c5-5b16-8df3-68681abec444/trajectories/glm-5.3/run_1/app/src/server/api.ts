import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AppContext, SessionUser } from './context.js';
import { memberById, visibleSite } from './context.js';
import { clientQuery, type DbClient, type Row } from './db.js';
import { ApiError, jsonError, validationError, validationBody, errorBody } from './errors.js';
import { sendJson } from './send.js';
import { addressPrefix, isJsonContent, originOf, peerAddress, readCookie, type AuthedRequest } from './http.js';
import { outcomeForStatus, writeAudit } from './audit.js';
import { isIdempotencyKey, isUuid, randomToken, uuid } from './ids.js';
import { nowMs } from '../clock.js';
import { datePlusDays, localDateOfInstant, minutesToWall, zoneDayStart, zoneInstant } from '../sitetime.js';
import type { Json, Role } from '../types.js';
import {
  certificateCovers,
  certificateValidThrough,
  conflictsForWindow,
  cutoffRefusal,
  loadBooking,
  loadSite,
  loadStation,
  liveHolds,
  missingHourMinutes,
  nextReference,
  parseWindow,
  pastHorizon,
  resolveWindow,
  withMemberLock,
  type BookingRow,
  type SiteRow,
} from './domain.js';
import {
  drawFromLots,
  loadLots,
  memberBalances,
  recordBookingDraw,
  returnToLots,
  writeMovement,
  type LotDraw,
} from './ledger.js';
import { sanitationBufferMinutes, HOLD_LIMIT, SERVICES, MAX_FILE_BYTES, MAX_MULTIPART_BYTES, EXPIRING_SOON_DAYS, RETURN_GAP_HOURS, COI_MIN_COVERAGE_DOLLARS, CHECK_IN_LEAD_MINUTES, NO_SHOW_DELAY_MINUTES, LOT_VALID_DAYS } from './rules.js';
import { queueMail, type MailEvent } from './mail.js';
import { bookingWire, minutesToTime, movementWire, documentWire, visitWire, rateWire, lotsWire, expiringSoon } from './wire.js';
import { formatHoursTwo, formatMoney, serviceLabel } from '../labels.js';
import { isoInstant } from './iso.js';
import { parseMultipart, displayName } from './multipart.js';
import { detectedType, isAcceptedType } from './filetypes.js';
import { sha256Hex } from './ids.js';
import { buildPdf } from './pdf.js';
import { createHold, cancelBooking, createSeries, balancesFor, memberEmail } from './bookingService.js';
import { purchasePack } from './purchaseService.js';
import { checkOut } from './checkoutService.js';
import bcrypt from 'bcryptjs';

interface AuditOutcomeName {
  outcome: 'allowed' | 'refused_session' | 'refused_csrf' | 'refused_rate' | 'refused_role' | 'refused_scope' | 'refused_validation' | 'refused_conflict' | 'failed_dependency';
}

export interface HandlerResult {
  status: number;
  body: Json | null;
  headers?: Record<string, string>;
  targetType?: string | null;
  targetId?: string | null;
  extra?: Record<string, string>;
}

export function buildApiRouter(ctx: AppContext): Router {
  const router = Router();

  const authenticate = async (client: DbClient, req: AuthedRequest): Promise<SessionUser | null> => {
    const token = readCookie(req, 'pl_session');
    if (!token || token.length < 32) return null;
    const rows = await clientQuery<Row>(
      client,
      `SELECT s.id AS session_id, s.token, s.csrf, s.created_at, s.last_used_at, u.id AS user_id,
              u.tenant_id, u.name, u.email, u.role, u.site_id
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
      [token],
    );
    if (rows.length === 0) {
      req.authFailure = 'session_invalid';
      return null;
    }
    const row = rows[0];
    const at = nowMs();
    const idleLimit = ctx.env.SESSION_IDLE_SECONDS * 1000;
    const absoluteLimit = ctx.env.SESSION_ABSOLUTE_SECONDS * 1000;
    const expired = at - Number(row.last_used_at) > idleLimit || at - Number(row.created_at) > absoluteLimit;
    if (expired) {
      req.authFailure = 'session_expired';
      return null;
    }
    await clientQuery(client, `UPDATE sessions SET last_used_at = $1 WHERE id = $2`, [at, row.session_id]);
    return {
      userId: String(row.user_id),
      tenantId: String(row.tenant_id),
      name: String(row.name),
      email: String(row.email),
      role: row.role as Role,
      siteId: row.site_id === null ? null : String(row.site_id),
      sessionId: String(row.session_id),
      csrf: String(row.csrf),
    };
  };

  const audit = async (
    client: DbClient,
    req: AuthedRequest,
    subject: { tenantId: string | null; userId: string | null; name: string; role: Role | null; siteId: string | null },
    action: string,
    targetType: string | null,
    targetId: string | null,
    outcome: AuditOutcomeName['outcome'],
  ): Promise<void> => {
    await writeAudit(client, {
      subject: {
        tenantId: subject.tenantId,
        userId: subject.userId,
        name: subject.name,
        role: subject.role,
        scopeSiteId: subject.siteId,
      },
      action,
      targetType,
      targetId,
      outcome,
      addressPrefix: addressPrefix(req),
    });
  };

  const routes: Array<{
    action: string;
    roles: Role[] | null;
    methods: string[];
    pattern: RegExp;
    csrf: boolean;
    needsSession: boolean;
    work: (req: AuthedRequest, res: Response, client: DbClient, user: SessionUser | null) => Promise<HandlerResult>;
  }> = [];

  const handler = (
    options: {
      action: string;
      roles: Role[] | null;
      methods: string[];
      pattern: RegExp;
      csrf: boolean;
      needsSession: boolean;
    },
    work: (req: AuthedRequest, res: Response, client: DbClient, user: SessionUser | null) => Promise<HandlerResult>,
  ) => {
    routes.push({ ...options, work });
  };

  const registerRoutes = (): void => {
    const byPattern = new Map<string, { pattern: RegExp; list: typeof routes }>();
    for (const route of routes) {
      const entry = byPattern.get(route.pattern.source) ?? { pattern: route.pattern, list: [] };
      entry.list.push(route);
      byPattern.set(route.pattern.source, entry);
    }
    for (const { pattern, list } of byPattern.values()) {
      router.use(pattern, async (req, res) => {
        const authed = req as AuthedRequest;
        const allowedMethods = Array.from(new Set(list.flatMap((route) => route.methods)));
        const route = list.find((item) => item.methods.includes(req.method));
        const options = route ?? { action: 'unknown', roles: null as Role[] | null, methods: allowedMethods, pattern, csrf: false, needsSession: false };
        if (!route || !options.methods.includes(req.method)) {
        if (options.methods.length > 0) {
          res.status(405);
          res.setHeader('Allow', allowedMethods.join(', '));
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.json({ error: { code: 'method_not_allowed', message: 'That method is not allowed here.' } });
          return;
        }
        res.status(404);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({ error: { code: 'not_found', message: 'There is nothing here.' } });
        return;
      }
      try {
        await ctx.withDb(async (client) => {
          if (['POST', 'PUT', 'PATCH'].includes(req.method) && !isJsonContent(req) && !isMultipart(req)) {
            throw new ApiError(415, 'unsupported_media_type', 'Send a JSON body.');
          }
          const user = await authenticate(client, authed);
          if (options.needsSession && !user) {
            const code = authed.authFailure === 'session_expired' ? 'session_expired' : authed.authFailure ?? 'unauthenticated';
            await audit(client, authed, { tenantId: null, userId: null, name: 'anonymous', role: null, siteId: null }, options.action, pathTargetType(authed), pathTargetId(authed), 'refused_session');
            jsonError(res, new ApiError(401, code, 'Sign in to continue.'));
            return;
          }
          if (user && options.csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            const token = req.headers['x-csrf-token'];
            if (typeof token !== 'string' || token !== user.csrf) {
              await audit(client, authed, { tenantId: user.tenantId, userId: user.userId, name: user.name, role: user.role, siteId: user.siteId }, options.action, pathTargetType(authed), pathTargetId(authed), 'refused_csrf');
              jsonError(res, new ApiError(403, 'csrf_failed', 'Your session changed in another tab. Refresh and try again.'));
              return;
            }
          }
          if (user && options.roles && !options.roles.includes(user.role)) {
            await audit(client, authed, { tenantId: user.tenantId, userId: user.userId, name: user.name, role: user.role, siteId: user.siteId }, options.action, pathTargetType(authed), pathTargetId(authed), 'refused_role');
            jsonError(res, new ApiError(403, 'forbidden', 'Your role cannot use this endpoint.'));
            return;
          }
          const result = await route.work(authed, res, client, user);
          if (res.headersSent) return;
          if (user) {
            await audit(client, authed, { tenantId: user.tenantId, userId: user.userId, name: user.name, role: user.role, siteId: user.siteId }, options.action, result.targetType ?? pathTargetType(authed), result.targetId ?? pathTargetId(authed), outcomeForStatus(result.status));
          } else {
            await auditForAnonymous(client, authed, options.action, result);
          }
          res.status(result.status);
          for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
          if (result.body !== null) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json(result.body);
          } else {
            res.end();
          }
        });
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, 'internal', 'Something went wrong.');
        if (!res.headersSent) {
          if (apiError.status === 500) {
            try {
              await ctx.withDb(async (client) => {
                const user = await authenticate(client, authed);
                await audit(client, authed, {
                  tenantId: user?.tenantId ?? null,
                  userId: user?.userId ?? null,
                  name: user?.name ?? 'anonymous',
                  role: user?.role ?? null,
                  siteId: user?.siteId ?? null,
                }, options.action, pathTargetType(authed), pathTargetId(authed), 'failed_dependency');
              });
            } catch {
              // The 500 body has already gone out.
            }
          } else {
            try {
              await ctx.withDb(async (client) => {
                const user = await authenticate(client, authed);
                const outcome = outcomeForStatus(apiError.status);
                await audit(client, authed, {
                  tenantId: user?.tenantId ?? null,
                  userId: user?.userId ?? null,
                  name: user?.name ?? 'anonymous',
                  role: user?.role ?? null,
                  siteId: user?.siteId ?? null,
                }, options.action, pathTargetType(authed), pathTargetId(authed), outcome);
              });
            } catch {
              // The error body has already gone out.
            }
          }
          jsonError(res, apiError);
        }
      }
    });
    }
  };

  async function auditForAnonymous(client: DbClient, req: AuthedRequest, action: string, result: HandlerResult): Promise<void> {
        const outcome = outcomeForStatus(result.status);
    let tenantId: string | null = null;
    let subjectUserId: string | null = null;
    let subjectName = 'anonymous';
    let role: Role | null = null;
    let siteId: string | null = null;
    if (action === 'POST /api/session') {
      const body = req.body as Record<string, Json> | undefined;
      const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';
      const userRow = await clientQuery<Row>(client, `SELECT id, tenant_id, name, role, site_id FROM users WHERE email_key = $1`, [email]);
      if (userRow.length > 0) {
        tenantId = String(userRow[0].tenant_id);
        subjectUserId = String(userRow[0].id);
        subjectName = String(userRow[0].name);
        role = userRow[0].role as Role;
        siteId = userRow[0].site_id === null ? null : String(userRow[0].site_id);
      }
    } else if (req.user) {
      tenantId = req.user.tenantId;
      subjectUserId = req.user.userId;
      subjectName = req.user.name;
      role = req.user.role;
      siteId = req.user.siteId;
    }
    await audit(client, req, { tenantId, userId: subjectUserId, name: subjectName, role, siteId }, action, pathTargetType(req), pathTargetId(req), outcome);
  }

  function pathTargetType(req: AuthedRequest): string | null {
    const parts = (req.originalUrl.split('?')[0]).split('/').filter(Boolean);
    if (parts[0] !== 'api') return null;
    const tail = parts.slice(1);
    if (tail.length === 0) return null;
    if (tail[0] === 'session') return 'session';
    if (tail[0] === 'inspect') return 'inspector_link';
    if (tail[0] === 'bookings' && tail.length >= 2 && isUuid(tail[1])) return 'booking';
    if (tail[0] === 'documents' && tail.length >= 2 && isUuid(tail[1])) return 'document';
    if (tail[0] === 'trucks' && tail.length >= 2 && isUuid(tail[1])) return 'truck';
    if (tail[0] === 'visits' && tail.length >= 2 && isUuid(tail[1])) return 'visit';
    if (tail[0] === 'inspector-links' && tail.length >= 2 && isUuid(tail[1])) return 'inspector_link';
    if ((tail[0] === 'sites') && tail.length >= 2 && isUuid(tail[1])) return 'site';
    return null;
  }

  function pathTargetId(req: AuthedRequest): string | null {
    const parts = (req.originalUrl.split('?')[0]).split('/').filter(Boolean);
    if (parts[0] !== 'api') return null;
    const tail = parts.slice(1);
    for (const part of tail) {
      if (isUuid(part)) return part;
    }
    return null;
  }

  // ---------- Health ----------

  router.all('/api/health', (req, res) => {
    if (req.method !== 'GET') {
      res.status(405);
      res.setHeader('Allow', 'GET');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ error: { code: 'method_not_allowed', message: 'That method is not allowed here.' } });
      return;
    }
    if (!ctx.isReady()) {
      res.status(503);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ status: 'starting' });
      return;
    }
    sendJson(res, 200, { status: 'ok' });
  });

  // ---------- Session ----------

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+[^\s@]*[^\s@.]$/;

  function isMultipart(req: AuthedRequest): boolean {
    return (req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data');
  }


function validEmail(value: string): boolean {
    if (value.length < 3 || value.length > 254) return false;
    const at = value.indexOf('@');
    if (at <= 0) return false;
    if (value.indexOf('@', at + 1) !== -1) return false;
    const domain = value.slice(at + 1);
    const dot = domain.indexOf('.');
    if (dot <= 0 || dot === domain.length - 1) return false;
    return !/\s/.test(value);
  }

  handler(
    { action: 'POST /api/session', roles: null, methods: ['POST'], pattern: /^\/api\/session$/, csrf: false, needsSession: false },
    async (req, res, client) => {
      const body = (req.body ?? {}) as Record<string, Json>;
      const known = ['email', 'password'];
      for (const key of Object.keys(body)) {
        if (!known.includes(key)) return { status: 422, body: validationBody({ [key]: 'Unknown field.' }) };
      }
      if (typeof body.email !== 'string' || !validEmail(body.email)) {
        return { status: 422, body: validationBody({ email: 'Enter a valid email address.' }) };
      }
      if (typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 200) {
        return { status: 422, body: validationBody({ password: 'Enter your password.' }) };
      }
      const email = body.email.toLowerCase();
      const at = nowMs();
      const windowMs = ctx.env.SIGN_IN_THROTTLE_WINDOW_SECONDS * 1000;
      const emailFails = await clientQuery<Row>(client, `SELECT failed_at FROM sign_in_failures WHERE email_key = $1 AND failed_at > $2`, [email, at - windowMs]);
      const address = peerAddress(req);
      const addressFails = await clientQuery<Row>(client, `SELECT failed_at FROM sign_in_failures WHERE address = $1 AND failed_at > $2`, [address, at - windowMs]);
      if (emailFails.length >= 5 || addressFails.length >= 20) {
        const emailEnd = emailFails.length >= 5 ? Number(emailFails[0].failed_at) + windowMs : 0;
        const addressEnd = addressFails.length >= 20 ? Number(addressFails[0].failed_at) + windowMs : 0;
        const end = Math.max(emailEnd, addressEnd);
        const retry = Math.max(1, Math.ceil((end - at) / 1000));
        return { status: 429, body: errorBody('too_many_attempts', 'Too many sign-in attempts.'), headers: { 'Retry-After': String(retry) } };
      }
      const userRows = await clientQuery<Row>(client, `SELECT id, tenant_id, name, email, role, site_id, password_hash FROM users WHERE email_key = $1`, [email]);
      const user = userRows[0];
      let ok = false;
      if (user) {
        ok = await bcrypt.compare(body.password, String(user.password_hash));
      } else {
        await bcrypt.compare(body.password, '$2a$10$C6UzMDM.H6dfI/f/IKcEe.6bBIksJ5vJgRi0jS3vX2k4O7gS1g1y');
      }
      if (!user || !ok) {
        await clientQuery(client, `INSERT INTO sign_in_failures (email_key, address, failed_at) VALUES ($1, $2, $3)`, [email, address, at]);
        return { status: 401, body: errorBody('invalid_credentials', 'That email and password do not match.') };
      }
      await clientQuery(client, `DELETE FROM sign_in_failures WHERE email_key = $1`, [email]);
      const token = randomToken(32);
      const csrf = randomToken(32);
      const oldToken = readCookie(req, 'pl_session');
      if (oldToken) {
        await clientQuery(client, `DELETE FROM sessions WHERE token = $1`, [oldToken]);
      }
      await clientQuery(client, `INSERT INTO sessions (id, user_id, token, csrf, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6)`, [uuid(), String(user.id), token, csrf, at, at]);
      const live = await clientQuery<Row>(client, `SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at ASC, id ASC`, [String(user.id)]);
      if (live.length > 3) {
        const extra = live.slice(0, live.length - 3);
        for (const row of extra) {
          await clientQuery(client, `DELETE FROM sessions WHERE id = $1`, [row.id]);
        }
      }
      const me = await meBody(client, String(user.id));
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', [
        `pl_session=${token}${cookieAttributes(Boolean(secure))}`,
        `pl_csrf=${csrf}${csrfCookieAttributes(Boolean(secure))}`,
      ]);
      return { status: 200, body: me, targetType: 'session', targetId: null };
    },
  );

  handler(
    { action: 'DELETE /api/session', roles: null, methods: ['DELETE'], pattern: /^\/api\/session$/, csrf: false, needsSession: false },
    async (req, res, client) => {
      const token = readCookie(req, 'pl_session');
      if (token) {
        await clientQuery(client, `DELETE FROM sessions WHERE token = $1`, [token]);
      }
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', [
        `pl_session=${cookieAttributes(Boolean(secure)).replace('HttpOnly; ', '')}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        `pl_csrf=; Expires=Thu, 01 Jan 1970 00:00:00 GMT${csrfCookieAttributes(Boolean(secure)).replace('; Path=; SameSite=Strict', '; Path=/; SameSite=Strict')}`,
      ]);
      return { status: 204, body: null, targetType: "session", targetId: null };
    },
  );

  // ---------- Me and sites ----------

  handler(
    { action: 'GET /api/me', roles: null, methods: ['GET'], pattern: /^\/api\/me$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const me = await meBody(client, user?.userId ?? '');
      return { status: 200, body: me };
    },
  );

  handler(
    { action: 'GET /api/sites', roles: null, methods: ['GET'], pattern: /^\/api\/sites$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const siteRows = await clientQuery<Row>(
        client,
        `SELECT * FROM sites WHERE tenant_id = $1 ${user?.role === 'kitchen_manager' ? 'AND id = $2' : ''} ORDER BY display_order`,
        user?.role === 'kitchen_manager' ? [user.tenantId, user.siteId] : [user?.tenantId ?? ''],
      );
      const sites = siteRows.map((site) => {
        const zone = String(site.time_zone);
        const now = nowMs();
        const local = localNow(zone, now);
        return {
          id: String(site.id),
          name: String(site.name),
          time_zone: zone,
          address: String(site.address),
          local_now: local,
          local_date: local.slice(0, 10),
        };
      });
      return { status: 200, body: { sites } };
    },
  );

  handler(
    { action: 'GET /api/sites/{site_id}/availability', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/sites\/([^/]+)\/availability$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const siteId = (req.params[0] ?? '') as string;
      const site = await visibleSite(client, user as SessionUser, siteId);
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const date = String(req.query.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw validationError({ date: 'Enter a site-local date.' });
      }
      const stations = await clientQuery<Row>(client, `SELECT * FROM stations WHERE site_id = $1 ORDER BY display_order`, [siteId]);
      const at = nowMs();
      const stationSectors: Json[] = [];
      for (const station of stations) {
        const bufferMinutes = sanitationBufferMinutes(String(station.kind));
        const bufferMs = bufferMinutes * 60000;
        const dayStart = zoneDayStart(date, site.time_zone);
        const dayEnd = zoneDayStart(datePlusDays(date, 1), site.time_zone);
        const rows = await clientQuery<Row>(
          client,
          `SELECT * FROM bookings WHERE station_id = $1 AND status IN ('held','confirmed','checked_in')
             AND ((date = $2 AND start_at < $3) OR (date = $4 AND start_at < $5 AND start_at + 0 > 0))`,
          [station.id, date, dayEnd, date, dayStart],
        );
        const relevant = await clientQuery<Row>(
          client,
          `SELECT * FROM bookings WHERE station_id = $1 AND status IN ('held','confirmed','checked_in')`,
          [station.id],
        );
        const sectors: Json[] = [];
        const occupied: Array<{ start: number; end: number; kind: string; bookingId: string | null; mine: boolean }> = [];
        for (const row of relevant) {
          const status = String(row.status);
          const holdExpires = row.hold_expires_at === null ? null : Number(row.hold_expires_at);
          if (status === 'held' && holdExpires !== null && holdExpires <= at) continue;
          const startAt = Number(row.start_at);
          const endAt = Number(row.end_at);
          const mine = user?.role === 'member' && String(row.member_id) === user.userId;
          const spanEnd = endAt + bufferMs;
          // The booking part, if it falls on this date.
          if (startAt < dayEnd && spanEnd > dayStart) {
            occupied.push({ start: Math.max(startAt, dayStart), end: Math.min(endAt, dayEnd), kind: bookingKind(status, mine), bookingId: mine || user?.role === 'kitchen_manager' ? String(row.id) : null, mine });
          }
          // The buffer part, which can cross midnight.
          const bufferStart = Math.max(endAt, dayStart);
          const bufferEnd = Math.min(spanEnd, dayEnd);
          if (bufferEnd > bufferStart) {
            occupied.push({ start: bufferStart, end: bufferEnd, kind: 'buffer', bookingId: mine || user?.role === 'kitchen_manager' ? String(row.id) : null, mine });
          }
        }
        occupied.sort((a, b) => a.start - b.start);
        for (const span of occupied) {
          sectors.push({
            kind: span.kind,
            start: minutesToTime(Math.max(0, Math.round((span.start - dayStart) / 60000))),
            end: minutesToTime(Math.min(1440, Math.round((span.end - dayStart) / 60000))),
            booking_id: span.bookingId,
          });
        }
        for (const [from, to] of missingHourMinutes(site, date)) {
          sectors.push({ kind: 'nonexistent', start: minutesToTime(from), end: minutesToTime(to), booking_id: null });
        }
        sectors.sort((a, b) => {
          const startA = (a as Record<string, string>).start;
          const startB = (b as Record<string, string>).start;
          if (startA !== startB) return startA < startB ? -1 : 1;
          const endA = (a as Record<string, string>).end;
          const endB = (b as Record<string, string>).end;
          return endA < endB ? -1 : endA > endB ? 1 : 0;
        });
        stationSectors.push({
          id: String(station.id),
          name: String(station.name),
          kind: String(station.kind),
          sectors,
        });
        void rows;
      }
      return { status: 200, body: { site_id: siteId, date, stations: stationSectors } };
    },
  );

  // ---------- Bookings ----------

  const takeIdempotencyKey = (req: AuthedRequest): string => {
    const value = req.headers['idempotency-key'];
    if (typeof value !== 'string' || !isIdempotencyKey(value)) {
      throw validationError({ 'Idempotency-Key': 'Send an Idempotency-Key header.' });
    }
    return value;
  };

  const balancesWire = async (client: DbClient, memberId: string): Promise<Json> => balancesFor(client, memberId);

  const idempotencyLookup = async (
    client: DbClient,
    userId: string,
    key: string,
    method: string,
    path: string,
    binding: string,
  ): Promise<Row | null> => {
    const rows = await clientQuery<Row>(
      client,
      `SELECT * FROM idempotency_records WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    return rows[0] ?? null;
  };

  const idempotencyBind = async (
    client: DbClient,
    userId: string,
    key: string,
    method: string,
    path: string,
    binding: string,
  ): Promise<'fresh' | 'stored' | 'in-progress' | 'conflict'> => {
    const existing = await idempotencyLookup(client, userId, key, method, path, binding);
    if (existing === null) {
      await clientQuery(
        client,
        `INSERT INTO idempotency_records (user_id, key, method, path, binding, status, response_body, created_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
        [userId, key, method, path, binding, nowMs()],
      );
      return 'fresh';
    }
    if (existing.status !== null && existing.response_body !== null) {
      return existing.binding === binding ? 'stored' : 'conflict';
    }
    if (existing.binding !== binding) return 'conflict';
    const age = nowMs() - Number(existing.created_at);
    if (age < 60000) return 'in-progress';
    await clientQuery(client, `DELETE FROM idempotency_records WHERE user_id = $1 AND key = $2`, [userId, key]);
    await clientQuery(
      client,
      `INSERT INTO idempotency_records (user_id, key, method, path, binding, status, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
      [userId, key, method, path, binding, nowMs()],
    );
    return 'fresh';
  };

  const idempotencyStore = async (
    client: DbClient,
    userId: string,
    key: string,
    status: number,
    body: Json,
  ): Promise<void> => {
    await clientQuery(
      client,
      `UPDATE idempotency_records SET status = $3, response_body = $4 WHERE user_id = $1 AND key = $2`,
      [userId, key, status, JSON.stringify(body)],
    );
  };

  const idempotencyRelease = async (client: DbClient, userId: string, key: string): Promise<void> => {
    await clientQuery(client, `DELETE FROM idempotency_records WHERE user_id = $1 AND key = $2 AND status IS NULL`, [userId, key]);
  };

  handler(
    { action: 'POST /api/bookings', roles: ['member'], methods: ['POST'], pattern: /^\/api\/bookings$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const member = user as SessionUser;
      const key = takeIdempotencyKey(req);
      const body = (req.body ?? {}) as Record<string, Json>;
      const known = ['station_id', 'date', 'start', 'end'];
      for (const field of Object.keys(body)) {
        if (!known.includes(field)) throw validationError({ [field]: 'Unknown field.' });
      }
      if (typeof body.station_id !== 'string' || !isUuid(body.station_id)) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (typeof body.date !== 'string' || typeof body.start !== 'string' || typeof body.end !== 'string') {
        throw validationError({ date: 'Enter a site-local date.', start: 'Pick quarter-hour times.', end: 'Pick quarter-hour times.' });
      }
      const binding = `${body.station_id}|${body.date}|${body.start}|${body.end}`;
      const state = await idempotencyBind(client, member.userId, key, 'POST', '/api/bookings', binding);
      if (state === 'stored') {
        const record = await idempotencyLookup(client, member.userId, key, 'POST', '/api/bookings', binding);
        return {
          status: Number(record?.status ?? 201),
          body: (typeof record?.response_body === 'string' ? JSON.parse(record.response_body) : (record?.response_body ?? {})) as Json,
          headers: { 'Idempotent-Replay': 'true' },
          targetType: 'booking',
          targetId: null,
        };
      }
      if (state === 'conflict') throw new ApiError(409, 'idempotency_conflict', 'That key is bound to another request.');
      if (state === 'in-progress') throw new ApiError(409, 'idempotency_in_progress', 'That request is still in progress.');
      try {
        const result = await withMemberLock(member.userId, () =>
          createHold(ctx, client, member, {
            stationId: body.station_id as string,
            date: body.date as string,
            start: body.start as string,
            end: body.end as string,
          }),
        );
        await idempotencyStore(client, member.userId, key, 201, result.body);
        return { status: 201, body: result.body as Json, targetType: 'booking', targetId: result.bookingId };
      } catch (err) {
        await idempotencyRelease(client, member.userId, key);
        throw err;
      }
    },
  );

  handler(
    { action: 'POST /api/bookings/{id}/confirm', roles: ['member'], methods: ['POST'], pattern: /^\/api\/bookings\/([^/]+)\/confirm$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const bookingId = (req.params[0] ?? '') as string;
      const booking = await loadBooking(client, bookingId);
      if (!booking || booking.member_id !== user?.userId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const at = nowMs();
      const expired = booking.status === 'held' && booking.hold_expires_at !== null && Number(booking.hold_expires_at) <= at;
      if (booking.status === 'expired' || expired) throw new ApiError(409, 'hold_expired', 'That hold has expired.');
      if (booking.status !== 'held') throw new ApiError(409, 'invalid_transition', 'That booking cannot be confirmed.');
      const site = await loadSite(client, booking.site_id);
      const station = await loadStation(client, booking.station_id);
      const validThrough = await certificateValidThrough(client, booking.member_id);
      if (!certificateCovers(validThrough, site?.time_zone ?? 'UTC', booking.date, at)) {
        throw new ApiError(422, 'certificate_expired', 'The certificate of insurance does not cover that date.');
      }
      const updated = await clientQuery<Row>(
        client,
        `UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1 AND status = 'held' RETURNING *`,
        [bookingId],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'That booking cannot be confirmed.');
      const wire = bookingWire(updated[0] as unknown as BookingRow, String(station?.name ?? ''), String((await memberById(client, booking.member_id))?.business_name ?? ''));
      const balances = await balancesFor(client, booking.member_id);
      const email = await memberEmail(client, booking.member_id);
      await queueMail(client, booking.tenant_id, {
        kind: 'booking_confirmed',
        to: email,
        station: String(station?.name ?? ''),
        date: booking.date,
        start: minutesToTime(Number(booking.start_minute)),
        end: minutesToTime(Number(booking.end_minute)),
        site: String(site?.name ?? ''),
        reference: booking.reference,
        hours: Number(booking.quarter_hours) / 4,
        availableAfter: (await memberBalances(client, booking.member_id)).availableQh / 4,
      });
      return { status: 200, body: { booking: wire, balances } as unknown as Json, targetType: 'booking', targetId: bookingId };
    },
  );

  handler(
    { action: 'POST /api/bookings/{id}/cancel', roles: ['member', 'kitchen_manager'], methods: ['POST'], pattern: /^\/api\/bookings\/([^/]+)\/cancel$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const bookingId = (req.params[0] ?? '') as string;
      const booking = await loadBooking(client, bookingId);
      if (!booking) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (booking.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (actor.role === 'kitchen_manager' && booking.site_id !== actor.siteId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (actor.role === 'member' && booking.member_id !== actor.userId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      let reason: string | null = null;
      const body = (req.body ?? {}) as Record<string, Json>;
      if (actor.role === 'kitchen_manager') {
        for (const field of Object.keys(body)) {
          if (field !== 'reason') throw validationError({ [field]: 'Unknown field.' });
        }
        if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 300) {
          throw validationError({ reason: 'Give a reason the member can act on.' });
        }
        reason = body.reason.trim();
      } else {
        for (const field of Object.keys(body)) {
          if (field !== 'reason') throw validationError({ [field]: 'Unknown field.' });
          throw validationError({ reason: 'A member cancels without a reason.' });
        }
      }
      const at = nowMs();
      const result = await withMemberLock(booking.member_id, () =>
        cancelBooking(ctx, client, actor, booking, reason, at),
      );
      return { status: 200, body: result.body as Json, targetType: 'booking', targetId: bookingId };
    },
  );

  handler(
    { action: 'GET /api/bookings', roles: ['member'], methods: ['GET'], pattern: /^\/api\/bookings$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const rows = await clientQuery<Row>(
        client,
        `SELECT b.*, s.name AS station_name, u.business_name FROM bookings b
           JOIN stations s ON s.id = b.station_id JOIN users u ON u.id = b.member_id
          WHERE b.member_id = $1 ORDER BY b.created_at DESC, b.id DESC`,
        [user?.userId ?? ''],
      );
      const bookings = rows.map((row) => bookingWire(row as unknown as BookingRow, String(row.station_name), String(row.business_name)));
      return { status: 200, body: { bookings } as unknown as Json };
    },
  );

  handler(
    { action: 'GET /api/bookings/{id}', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/bookings\/([^/]+)$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const bookingId = (req.params[0] ?? '') as string;
      const booking = await loadBooking(client, bookingId);
      if (!booking || booking.tenant_id !== user?.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (user?.role === 'member' && booking.member_id !== user.userId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (user?.role === 'kitchen_manager' && booking.site_id !== user.siteId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const station = await loadStation(client, booking.station_id);
      const member = await memberById(client, booking.member_id);
      const wire = bookingWire(booking, String(station?.name ?? ''), String(member?.business_name ?? ''));
      return { status: 200, body: { booking: wire } as unknown as Json };
    },
  );

  handler(
    { action: 'GET /api/sites/{site_id}/bookings', roles: ['kitchen_manager', 'finance_lead'], methods: ['GET'], pattern: /^\/api\/sites\/([^/]+)\/bookings$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const siteId = (req.params[0] ?? '') as string;
      const site = await visibleSite(client, user as SessionUser, siteId);
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const date = String(req.query.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError({ date: 'Enter a site-local date.' });
      const rows = await clientQuery<Row>(
        client,
        `SELECT b.*, s.name AS station_name, u.business_name FROM bookings b
           JOIN stations s ON s.id = b.station_id JOIN users u ON u.id = b.member_id
          WHERE b.site_id = $1 AND b.date = $2 ORDER BY b.start_at ASC, b.reference ASC`,
        [siteId, date],
      );
      const bookings = rows.map((row) => bookingWire(row as unknown as BookingRow, String(row.station_name), String(row.business_name)));
      return { status: 200, body: { bookings } as unknown as Json };
    },
  );

  handler(
    { action: 'POST /api/recurring-series', roles: ['member'], methods: ['POST'], pattern: /^\/api\/recurring-series$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const member = user as SessionUser;
      const body = (req.body ?? {}) as Record<string, Json>;
      const known = ['station_id', 'first_date', 'start', 'end', 'weeks'];
      for (const field of Object.keys(body)) {
        if (!known.includes(field)) throw validationError({ [field]: 'Unknown field.' });
      }
      if (typeof body.station_id !== 'string' || !isUuid(body.station_id)) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (typeof body.first_date !== 'string' || typeof body.start !== 'string' || typeof body.end !== 'string') {
        throw validationError({ first_date: 'Enter a site-local date.', start: 'Pick quarter-hour times.', end: 'Pick quarter-hour times.' });
      }
      if (typeof body.weeks !== 'number' || !Number.isInteger(body.weeks) || body.weeks < 2 || body.weeks > 12) {
        throw validationError({ weeks: 'Choose 2 to 12 weeks.' });
      }
      const result = await withMemberLock(member.userId, () =>
        createSeries(ctx, client, member, {
          stationId: body.station_id as string,
          firstDate: body.first_date as string,
          start: body.start as string,
          end: body.end as string,
          weeks: body.weeks as number,
        }),
      );
      return { status: 201, body: result.body as Json, targetType: 'series', targetId: result.seriesId };
    },
  );

  // ---------- Packs and purchases ----------

  handler(
    { action: 'GET /api/packs', roles: ['member', 'finance_lead'], methods: ['GET'], pattern: /^\/api\/packs$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const rows = await clientQuery<Row>(
        client,
        `SELECT * FROM packs WHERE tenant_id = $1 ORDER BY display_order`,
        [user?.tenantId ?? ''],
      );
      return {
        status: 200,
        body: {
          packs: rows.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            hours: Number(row.quarter_hours) / 4,
            price_cents: Number(row.price_cents),
          })),
        },
      };
    },
  );

  handler(
    { action: 'POST /api/pack-purchases', roles: ['member'], methods: ['POST'], pattern: /^\/api\/pack-purchases$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const member = user as SessionUser;
      const key = takeIdempotencyKey(req);
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        if (field !== 'pack_id') throw validationError({ [field]: 'Unknown field.' });
      }
      if (typeof body.pack_id !== 'string' || !isUuid(body.pack_id)) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const binding = `${body.pack_id}`;
      const state = await idempotencyBind(client, member.userId, key, 'POST', '/api/pack-purchases', binding);
      if (state === 'stored') {
        const record = await idempotencyLookup(client, member.userId, key, 'POST', '/api/pack-purchases', binding);
        return {
          status: Number(record?.status ?? 201),
          body: (typeof record?.response_body === 'string' ? JSON.parse(record.response_body) : (record?.response_body ?? {})) as Json,
          headers: { 'Idempotent-Replay': 'true' },
          targetType: 'purchase',
          targetId: null,
        };
      }
      if (state === 'conflict') throw new ApiError(409, 'idempotency_conflict', 'That key is bound to another request.');
      if (state === 'in-progress') throw new ApiError(409, 'idempotency_in_progress', 'That request is still in progress.');
      try {
        const result = await withMemberLock(member.userId, () => purchasePack(ctx, client, member, body.pack_id as string));
        await idempotencyStore(client, member.userId, key, 201, result.body);
        return { status: 201, body: result.body, targetType: 'purchase', targetId: result.purchaseId };
      } catch (err) {
        await idempotencyRelease(client, member.userId, key);
        throw err;
      }
    },
  );

  handler(
    { action: 'GET /api/me/ledger', roles: ['member'], methods: ['GET'], pattern: /^\/api\/me\/ledger$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const balances = await balancesFor(client, user?.userId ?? '');
      const rows = await clientQuery<Row>(
        client,
        `SELECT m.*,
           (SELECT COALESCE(json_agg(ml ORDER BY ml.lot_id), '[]'::json) FROM movement_lots ml WHERE ml.movement_id = m.id) AS lots,
           (SELECT COALESCE(json_agg(me ORDER BY me.account), '[]'::json) FROM movement_entries me WHERE me.movement_id = m.id) AS entries
           FROM movements m WHERE m.member_id = $1 ORDER BY m.id DESC`,
        [user?.userId ?? ''],
      );
      return { status: 200, body: { balances, movements: rows.map((row) => movementWire(row)) } as unknown as Json };
    },
  );

  // ---------- Documents ----------

  const rawBodyLimit = MAX_MULTIPART_BYTES;

  handler(
    { action: 'POST /api/documents', roles: ['member'], methods: ['POST'], pattern: /^\/api\/documents$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload with multipart/form-data.');
      }
      const raw = await readRawBody(req);
      if (raw.length > rawBodyLimit) throw new ApiError(413, 'body_too_large', 'The request is too large.');
      const parsed = parseMultipart(raw, contentType);
      const fieldMap = new Map(parsed.fields.map((field) => [field.name, field.value]));
      const filePart = parsed.files.find((part) => part.name === 'file') ?? null;

      const type = fieldMap.get('type') ?? '';
      const expiryDate = fieldMap.get('expiry_date') ?? '';
      const allowedFields = type === 'certificate_of_insurance'
        ? ['type', 'expiry_date', 'file', 'per_occurrence_limit', 'names_additional_insured']
        : ['type', 'expiry_date', 'file'];
      const unknown: Record<string, string> = {};
      for (const part of [...parsed.fields, ...parsed.files]) {
        if (!allowedFields.includes(part.name)) unknown[part.name] = 'Unknown field.';
      }
      if (Object.keys(unknown).length > 0) throw validationError(unknown);
      if (type !== 'certificate_of_insurance' && type !== 'food_handler_certificate' && type !== 'business_licence') {
        throw validationError({ type: 'Choose a document type.' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || Number.isNaN(Date.parse(expiryDate + 'T00:00:00Z'))) {
        throw validationError({ expiry_date: 'Enter the expiry date shown on the document.' });
      }
      if (!filePart || filePart.bytes.length === 0) {
        throw validationError({ file: 'Choose a file to upload.' });
      }
      if (filePart.bytes.length > MAX_FILE_BYTES) {
        throw new ApiError(413, 'file_too_large', 'Files can be at most 5,000,000 bytes.');
      }
      const detected = detectedType(filePart.contentType, filePart.bytes);
      if (detected === null) {
        throw new ApiError(415, 'unsupported_type', 'Upload a PDF, PNG or JPEG file.');
      }
      if (type === 'certificate_of_insurance') {
        const rawLimit = fieldMap.get('per_occurrence_limit') ?? '';
        const rawInsured = fieldMap.get('names_additional_insured') ?? '';
        if (!/^\d+$/.test(rawLimit) || Number.isNaN(Number(rawLimit))) {
          throw validationError({ per_occurrence_limit: 'Coverage must be at least $1,000,000 per occurrence.' });
        }
        const perOccurrenceLimit = Number(rawLimit);
        if (perOccurrenceLimit < COI_MIN_COVERAGE_DOLLARS) {
          throw validationError({ per_occurrence_limit: 'Coverage must be at least $1,000,000 per occurrence.' });
        }
        if (rawInsured !== 'true') {
          throw validationError({ names_additional_insured: 'The certificate must name the incubator as additional insured.' });
        }
      }

      const documentId = uuid();
      const member = await memberById(client, actor.userId);
      if (!member) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const tenantRows = await clientQuery<Row>(client, `SELECT id FROM tenants WHERE id = $1`, [actor.tenantId]);
      const key = `documents/${tenantRows[0].id}/${actor.userId}/${documentId}`;
      const bytes = filePart.bytes;
      const digest = sha256Hex(bytes);
      const fileName = displayName(filePart.filename);
      try {
        await ctx.storage.putObject({
          key,
          body: bytes,
          contentType: detected,
          metadata: { sha256: digest, 'document-id': documentId },
        });
        const confirmed = await ctx.storage.confirmObject({
          key,
          sizeBytes: bytes.length,
          contentType: detected,
          metadata: { sha256: digest, 'document-id': documentId },
        });
        if (!confirmed) {
          await ctx.storage.deleteObject(key);
          throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      }
      await clientQuery(
        client,
        `INSERT INTO documents (id, tenant_id, member_id, type, expiry_date, status, file_name, content_type, size_bytes, sha256, rejection_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, NULL, $10)`,
        [documentId, actor.tenantId, actor.userId, type, expiryDate, fileName, detected, bytes.length, digest, nowMs()],
      );
      const row = (await clientQuery<Row>(client, `SELECT * FROM documents WHERE id = $1`, [documentId]))[0];
      return { status: 201, body: { document: documentWire(row) } as unknown as Json, targetType: 'document', targetId: documentId };
    },
  );

  handler(
    { action: 'GET /api/documents', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/documents$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      let rows: Row[];
      if (actor.role === 'member') {
        rows = await clientQuery<Row>(
          client,
          `SELECT d.*, u.business_name FROM documents d JOIN users u ON u.id = d.member_id
            WHERE d.member_id = $1 ${status ? 'AND d.status = $2' : ''} ORDER BY d.created_at DESC, d.id DESC`,
          status ? [actor.userId, status] : [actor.userId],
        );
      } else {
        rows = await clientQuery<Row>(
          client,
          `SELECT d.*, u.business_name FROM documents d JOIN users u ON u.id = d.member_id
            WHERE u.site_id = $1 ${status ? 'AND d.status = $2' : ''} ORDER BY d.created_at DESC, d.id DESC`,
          status ? [actor.siteId, status] : [actor.siteId],
        );
      }
      return {
        status: 200,
        body: {
          documents: rows.map((row) => ({
            ...documentWire(row),
            business_name: String(row.business_name ?? ''),
          })),
        } as unknown as Json,
      };
    },
  );

  const visibleDocument = async (client: DbClient, actor: SessionUser, documentId: string): Promise<Row | null> => {
    const rows = await clientQuery<Row>(client, `SELECT * FROM documents WHERE id = $1`, [documentId]);
    const row = rows[0];
    if (!row || row.tenant_id !== actor.tenantId) return null;
    if (actor.role === 'member' && row.member_id !== actor.userId) return null;
    if (actor.role === 'kitchen_manager') {
      const member = await memberById(client, String(row.member_id));
      if (!member || member.site_id !== actor.siteId) return null;
    }
    return row;
  };

  handler(
    { action: 'GET /api/documents/{id}', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/documents\/([^/]+)$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const documentId = (req.params[0] ?? '') as string;
      const row = await visibleDocument(client, user as SessionUser, documentId);
      if (!row) throw new ApiError(404, 'not_found', 'There is nothing here.');
      return { status: 200, body: { document: documentWire(row) } as unknown as Json };
    },
  );

  handler(
    { action: 'GET /api/documents/{id}/file', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/documents\/([^/]+)\/file$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const documentId = (req.params[0] ?? '') as string;
      const row = await visibleDocument(client, user as SessionUser, documentId);
      if (!row) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const key = `documents/${row.tenant_id}/${row.member_id}/${documentId}`;
      let bytes: Buffer | null;
      try {
        bytes = await ctx.storage.getObject(key);
      } catch {
        bytes = null;
      }
      if (bytes === null) throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      res.status(200);
      res.setHeader('Content-Type', String(row.content_type));
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('ETag', `"${row.sha256}"`);
      res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
      return { status: 200, body: null, targetType: 'document', targetId: documentId };
    },
  );

  handler(
    { action: 'POST /api/documents/{id}/verify', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/documents\/([^/]+)\/verify$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const documentId = (req.params[0] ?? '') as string;
      const row = await visibleDocument(client, actor, documentId);
      if (!row) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (row.status !== 'pending') throw new ApiError(409, 'invalid_transition', 'This document was already reviewed.');
      const member = await memberById(client, String(row.member_id));
      const homeZone = member?.site_id
        ? String((await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [member.site_id]))[0].time_zone)
        : 'UTC';
      const today = siteToday(homeZone);
      if (String(row.expiry_date).slice(0, 10) < today) {
        throw new ApiError(422, 'document_expired', 'This document has already expired. Reject it instead.');
      }
      const updated = await clientQuery<Row>(
        client,
        `UPDATE documents SET status = 'verified' WHERE id = $1 AND status = 'pending' RETURNING *`,
        [documentId],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'This document was already reviewed.');
      const column = documentColumn(String(row.type));
      const validThrough = String(row.expiry_date).slice(0, 10);
      const seededRows = await clientQuery<Row>(client, `SELECT ${column} AS current FROM users WHERE id = $1`, [row.member_id]);
      const current = seededRows[0].current === null ? null : String(seededRows[0].current).slice(0, 10);
      if (current === null || validThrough > current) {
        await clientQuery(client, `UPDATE users SET ${column} = $2 WHERE id = $1`, [row.member_id, validThrough]);
      }
      return {
        status: 200,
        body: { document: documentWire(updated[0]), valid_through: validThrough } as unknown as Json,
        targetType: 'document',
        targetId: documentId,
      };
    },
  );

  handler(
    { action: 'POST /api/documents/{id}/reject', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/documents\/([^/]+)\/reject$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const documentId = (req.params[0] ?? '') as string;
      const row = await visibleDocument(client, actor, documentId);
      if (!row) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        if (field !== 'reason') throw validationError({ [field]: 'Unknown field.' });
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 300) {
        throw validationError({ reason: 'Give a reason the member can act on.' });
      }
      if (row.status !== 'pending') throw new ApiError(409, 'invalid_transition', 'This document was already reviewed.');
      const updated = await clientQuery<Row>(
        client,
        `UPDATE documents SET status = 'rejected', rejection_reason = $2 WHERE id = $1 AND status = 'pending' RETURNING *`,
        [documentId, body.reason.trim()],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'This document was already reviewed.');
      return { status: 200, body: { document: documentWire(updated[0]) } as unknown as Json, targetType: 'document', targetId: documentId };
    },
  );

  // ---------- Trucks and visits ----------

  const truckFor = async (client: DbClient, actor: SessionUser, truckId: string): Promise<Row | null> => {
    const rows = await clientQuery<Row>(client, `SELECT * FROM trucks WHERE id = $1`, [truckId]);
    const truck = rows[0];
    if (!truck) return null;
    const member = await memberById(client, String(truck.member_id));
    if (!member || member.tenant_id !== actor.tenantId) return null;
    if (actor.role === 'kitchen_manager' && member.site_id !== actor.siteId) return null;
    if (actor.role === 'member' && truck.member_id !== actor.userId) return null;
    return truck;
  };

  const visitsBody = async (client: DbClient, truck: Row, zone: string): Promise<Json> => {
    const rows = await clientQuery<Row>(
      client,
      `SELECT * FROM visits WHERE truck_id = $1 ORDER BY arrived_at DESC, id DESC`,
      [truck.id],
    );
    const member = await memberById(client, String(truck.member_id));
    const at = nowMs();
    const departed = rows.filter((row) => row.departed_at !== null).map((row) => Number(row.departed_at));
    const lastDepartedAt = departed.length > 0 ? Math.max(...departed) : null;
    const overdue = lastDepartedAt !== null && at - lastDepartedAt > RETURN_GAP_HOURS * 3600000;
    const withGaps = rows.map((row, index) => {
      if (row.departed_at === null) return { row, gapHours: null, flagged: false };
      const previous = rows.slice(index + 1).find((candidate) => candidate.departed_at !== null);
      if (!previous) return { row, gapHours: null, flagged: false };
      const gapMs = Number(row.departed_at) - Number(previous.departed_at);
      const gapHours = Math.round((gapMs / 3600000) * 100) / 100;
      return { row, gapHours, flagged: gapHours > RETURN_GAP_HOURS };
    });
    return {
      truck: {
        id: String(truck.id),
        name: String(truck.name),
        permit_number: String(truck.permit_number),
        member_id: String(truck.member_id),
        business_name: String(member?.business_name ?? ''),
      },
      visits: withGaps.map((item) => ({
        id: String(item.row.id),
        truck_id: String(truck.id),
        site_id: String(item.row.site_id),
        arrived_at: isoInstant(Number(item.row.arrived_at)),
        departed_at: item.row.departed_at === null ? null : isoInstant(Number(item.row.departed_at)),
        services: item.row.services as Json,
        operator_signature: String(item.row.operator_signature),
        manager_name: String(item.row.manager_name),
        gap_hours: item.gapHours,
        gap_flagged: item.flagged,
      })),
      last_departed_at: lastDepartedAt === null ? null : isoInstant(lastDepartedAt),
      overdue,
    } as unknown as Json;
  };

  handler(
    { action: 'GET /api/trucks/{truck_id}/visits', roles: ['member', 'kitchen_manager'], methods: ['GET'], pattern: /^\/api\/trucks\/([^/]+)\/visits$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const truckId = (req.params[0] ?? '') as string;
      const truck = await truckFor(client, user as SessionUser, truckId);
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const site = await loadSite(client, String(truck.site_id));
      const body = await visitsBody(client, truck, site?.time_zone ?? 'UTC');
      return { status: 200, body, targetType: 'truck', targetId: truckId };
    },
  );

  handler(
    { action: 'POST /api/trucks/{truck_id}/visits', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/trucks\/([^/]+)\/visits$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const truckId = (req.params[0] ?? '') as string;
      const truck = await truckFor(client, actor, truckId);
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        throw validationError({ [field]: 'Unknown field.' });
      }
      const open = await clientQuery<Row>(
        client,
        `SELECT id FROM visits WHERE truck_id = $1 AND departed_at IS NULL`,
        [truckId],
      );
      if (open.length > 0) throw new ApiError(409, 'visit_open', 'This truck is already checked in.');
      const at = nowMs();
      const result = await clientQuery<Row>(
        client,
        `INSERT INTO visits (id, tenant_id, truck_id, site_id, arrived_at, departed_at, services, operator_signature, manager_name)
         VALUES ($1, $2, $3, $4, $5, NULL, '{}', '', $6) RETURNING *`,
        [uuid(), truck.tenant_id, truckId, truck.site_id, at, actor.name],
      );
      return { status: 201, body: { visit: visitWire(result[0]) } as unknown as Json, targetType: 'visit', targetId: String(result[0].id) };
    },
  );

  handler(
    { action: 'POST /api/visits/{id}/depart', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/visits\/([^/]+)\/depart$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const visitId = (req.params[0] ?? '') as string;
      const rows = await clientQuery<Row>(client, `SELECT * FROM visits WHERE id = $1`, [visitId]);
      const visit = rows[0];
      if (!visit || visit.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      if (visit.site_id !== actor.siteId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        if (field !== 'services' && field !== 'operator_signature') throw validationError({ [field]: 'Unknown field.' });
      }
      if (!Array.isArray(body.services) || body.services.length === 0 || !body.services.every((service) => typeof service === 'string' && SERVICES.includes(service as never))) {
        throw validationError({ services: 'Choose at least one service.' });
      }
      if (typeof body.operator_signature !== 'string' || body.operator_signature.trim().length < 2 || body.operator_signature.trim().length > 80) {
        throw validationError({ operator_signature: "Type the operator's name to sign." });
      }
      if (visit.departed_at !== null) throw new ApiError(409, 'invalid_transition', 'This visit already has a departure.');
      const at = nowMs();
      const updated = await clientQuery<Row>(
        client,
        `UPDATE visits SET departed_at = $2, services = $3, operator_signature = $4 WHERE id = $1 AND departed_at IS NULL RETURNING *`,
        [visitId, at, body.services, body.operator_signature.trim()],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'This visit already has a departure.');
      const withGap = await gapFor(client, updated[0]);
      return { status: 200, body: { visit: withGap } as unknown as Json, targetType: 'visit', targetId: visitId };
    },
  );

  async function gapFor(client: DbClient, visit: Row): Promise<Json> {
    const previous = await clientQuery<Row>(
      client,
      `SELECT * FROM visits WHERE truck_id = $1 AND departed_at IS NOT NULL AND departed_at < $2 ORDER BY departed_at DESC LIMIT 1`,
      [visit.truck_id, visit.departed_at],
    );
    let gapHours: number | null = null;
    let flagged = false;
    if (previous.length > 0) {
      const gapMs = Number(visit.departed_at) - Number(previous[0].departed_at);
      gapHours = Math.round((gapMs / 3600000) * 100) / 100;
      flagged = gapHours > RETURN_GAP_HOURS;
    }
    return {
      id: String(visit.id),
      truck_id: String(visit.truck_id),
      site_id: String(visit.site_id),
      arrived_at: isoInstant(Number(visit.arrived_at)),
      departed_at: visit.departed_at === null ? null : isoInstant(Number(visit.departed_at)),
      services: visit.services as Json,
      operator_signature: String(visit.operator_signature),
      manager_name: String(visit.manager_name),
      gap_hours: gapHours,
      gap_flagged: flagged,
    } as unknown as Json;
  }

  // ---------- Inspector links ----------

  const truckVisitsSnapshot = async (client: DbClient, truck: Row, site: SiteRow): Promise<Buffer> => {
    const rows = await clientQuery<Row>(
      client,
      `SELECT * FROM visits WHERE truck_id = $1 AND departed_at IS NOT NULL ORDER BY arrived_at DESC, id DESC`,
      [truck.id],
    );
    const member = await memberById(client, String(truck.member_id));
    const lines: string[] = [
      `${String(truck.name)} (${String(truck.permit_number)})`,
      `Operator: ${String(member?.business_name ?? '')}`,
      `Commissary: ${site.name}, ${site.address}`,
      `Time zone: ${site.time_zone}`,
      '',
      'Visits (newest first):',
    ];
    for (const row of rows) {
      const arrived = zoneInstantWall(site.time_zone, Number(row.arrived_at));
      const departed = zoneInstantWall(site.time_zone, Number(row.departed_at));
      const services = (row.services as string[]).map((service) => serviceLabel(service)).join(', ');
      lines.push(`Arrived ${arrived} · Departed ${departed} · Services: ${services} · Operator signature: ${String(row.operator_signature)} · Manager: ${String(row.manager_name)}`);
    }
    return buildPdf(lines);
  };

  handler(
    { action: 'GET /api/trucks/{truck_id}/inspector-links', roles: ['kitchen_manager'], methods: ['GET'], pattern: /^\/api\/trucks\/([^/]+)\/inspector-links$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const truckId = (req.params[0] ?? '') as string;
      const truck = await truckFor(client, user as SessionUser, truckId);
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const rows = await clientQuery<Row>(
        client,
        `SELECT * FROM inspector_links WHERE truck_id = $1 ORDER BY created_at DESC, id DESC`,
        [truckId],
      );
      const at = nowMs();
      return {
        status: 200,
        body: {
          links: rows.map((row) => ({
            id: String(row.id),
            truck_id: String(row.truck_id),
            inspector_email: String(row.inspector_email),
            url: `${originOf(req)}/inspect/${String(row.token)}`,
            expires_at: isoInstant(Number(row.expires_at)),
            revoked_at: row.revoked_at === null ? null : isoInstant(Number(row.revoked_at)),
            created_at: isoInstant(Number(row.created_at)),
            state: linkState(row, at),
          })),
        } as unknown as Json,
      };
    },
  );

  function linkState(row: Row, at: number): string {
    if (row.revoked_at !== null) return 'revoked';
    if (at >= Number(row.expires_at)) return 'expired';
    return 'live';
  }

  handler(
    { action: 'POST /api/trucks/{truck_id}/inspector-links', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/trucks\/([^/]+)\/inspector-links$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const truckId = (req.params[0] ?? '') as string;
      const truck = await truckFor(client, actor, truckId);
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        if (field !== 'inspector_email') throw validationError({ [field]: 'Unknown field.' });
      }
      if (typeof body.inspector_email !== 'string' || !validEmail(body.inspector_email)) {
        throw validationError({ inspector_email: 'Enter a valid email address.' });
      }
      const site = await loadSite(client, String(truck.site_id));
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const linkId = uuid();
      const token = randomToken(24);
      const at = nowMs();
      const expiresAt = at + ctx.env.INSPECTOR_LINK_TTL_SECONDS * 1000;
      const key = `visit-logs/${actor.tenantId}/${truckId}/${linkId}.pdf`;
      let pdf: Buffer;
      try {
        pdf = await truckVisitsSnapshot(client, truck, site);
      } catch {
        throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      }
      try {
        await ctx.storage.putObject({ key, body: pdf, contentType: 'application/pdf', metadata: {} });
        const confirmed = await ctx.storage.confirmObject({ key, sizeBytes: pdf.length, contentType: 'application/pdf', metadata: {} });
        if (!confirmed) {
          await ctx.storage.deleteObject(key);
          throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      }
      await clientQuery(
        client,
        `INSERT INTO inspector_links (id, tenant_id, truck_id, token, inspector_email, expires_at, revoked_at, snapshot_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
        [linkId, actor.tenantId, truckId, token, body.inspector_email, expiresAt, key, at],
      );
      const siteZone = site.time_zone;
      const expiresLocal = `${new Intl.DateTimeFormat('en-CA', { timeZone: siteZone, dateStyle: 'short' }).format(new Date(expiresAt))} ${new Intl.DateTimeFormat('en-GB', { timeZone: siteZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(expiresAt))}`;
      const url = `${originOf(req)}/inspect/${token}`;
      await queueMail(client, actor.tenantId, {
        kind: 'inspector_link',
        to: body.inspector_email,
        truckName: String(truck.name),
        siteName: site.name,
        url,
        expiresLocal,
      });
      return {
        status: 201,
        body: {
          link: {
            id: linkId,
            truck_id: truckId,
            inspector_email: body.inspector_email,
            url,
            expires_at: isoInstant(expiresAt),
            revoked_at: null,
            created_at: isoInstant(at),
            state: 'live',
          },
        } as unknown as Json,
        targetType: 'inspector_link',
        targetId: linkId,
      };
    },
  );

  handler(
    { action: 'POST /api/inspector-links/{id}/revoke', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/inspector-links\/([^/]+)\/revoke$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const linkId = (req.params[0] ?? '') as string;
      const rows = await clientQuery<Row>(client, `SELECT * FROM inspector_links WHERE id = $1`, [linkId]);
      const link = rows[0];
      if (!link || link.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const truck = await truckFor(client, actor, String(link.truck_id));
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const at = nowMs();
      if (linkState(link, at) !== 'live') throw new ApiError(409, 'invalid_transition', 'This link is no longer live.');
      await clientQuery(client, `UPDATE inspector_links SET revoked_at = $2 WHERE id = $1`, [linkId, at]);
      const updated = (await clientQuery<Row>(client, `SELECT * FROM inspector_links WHERE id = $1`, [linkId]))[0];
      return {
        status: 200,
        body: {
          link: {
            id: String(updated.id),
            truck_id: String(updated.truck_id),
            inspector_email: String(updated.inspector_email),
            url: `${originOf(req)}/inspect/${String(updated.token)}`,
            expires_at: isoInstant(Number(updated.expires_at)),
            revoked_at: updated.revoked_at === null ? null : isoInstant(Number(updated.revoked_at)),
            created_at: isoInstant(Number(updated.created_at)),
            state: 'revoked',
          },
        } as unknown as Json,
        targetType: 'inspector_link',
        targetId: linkId,
      };
    },
  );

  handler(
    { action: 'POST /api/inspector-links/{id}/reissue', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/inspector-links\/([^/]+)\/reissue$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const linkId = (req.params[0] ?? '') as string;
      const rows = await clientQuery<Row>(client, `SELECT * FROM inspector_links WHERE id = $1`, [linkId]);
      const link = rows[0];
      if (!link || link.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const truck = await truckFor(client, actor, String(link.truck_id));
      if (!truck) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const site = await loadSite(client, String(truck.site_id));
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const at = nowMs();
      if (linkState(link, at) !== 'live') throw new ApiError(409, 'invalid_transition', 'This link is no longer live.');
      const newId = uuid();
      const token = randomToken(24);
      const expiresAt = at + ctx.env.INSPECTOR_LINK_TTL_SECONDS * 1000;
      const key = `visit-logs/${actor.tenantId}/${String(truck.id)}/${newId}.pdf`;
      let pdf: Buffer;
      try {
        pdf = await truckVisitsSnapshot(client, truck, site);
      } catch {
        throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      }
      try {
        await ctx.storage.putObject({ key, body: pdf, contentType: 'application/pdf', metadata: {} });
        const confirmed = await ctx.storage.confirmObject({ key, sizeBytes: pdf.length, contentType: 'application/pdf', metadata: {} });
        if (!confirmed) {
          await ctx.storage.deleteObject(key);
          throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.');
      }
      await clientQuery(client, `UPDATE inspector_links SET revoked_at = $2 WHERE id = $1`, [linkId, at]);
      await clientQuery(
        client,
        `INSERT INTO inspector_links (id, tenant_id, truck_id, token, inspector_email, expires_at, revoked_at, snapshot_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
        [newId, actor.tenantId, String(truck.id), token, link.inspector_email, expiresAt, key, at],
      );
      const siteZone = site.time_zone;
      const expiresLocal = `${new Intl.DateTimeFormat('en-CA', { timeZone: siteZone, dateStyle: 'short' }).format(new Date(expiresAt))} ${new Intl.DateTimeFormat('en-GB', { timeZone: siteZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(expiresAt))}`;
      const url = `${originOf(req)}/inspect/${token}`;
      await queueMail(client, actor.tenantId, {
        kind: 'inspector_link',
        to: String(link.inspector_email),
        truckName: String(truck.name),
        siteName: site.name,
        url,
        expiresLocal,
      });
      const revokedRow = (await clientQuery<Row>(client, `SELECT * FROM inspector_links WHERE id = $1`, [linkId]))[0];
      return {
        status: 201,
        body: {
          link: {
            id: newId,
            truck_id: String(truck.id),
            inspector_email: String(link.inspector_email),
            url,
            expires_at: isoInstant(expiresAt),
            revoked_at: null,
            created_at: isoInstant(at),
            state: 'live',
          },
          replaced: {
            id: String(revokedRow.id),
            truck_id: String(revokedRow.truck_id),
            inspector_email: String(revokedRow.inspector_email),
            url: `${originOf(req)}/inspect/${String(revokedRow.token)}`,
            expires_at: isoInstant(Number(revokedRow.expires_at)),
            revoked_at: isoInstant(Number(revokedRow.revoked_at)),
            created_at: isoInstant(Number(revokedRow.created_at)),
            state: 'revoked',
          },
        } as unknown as Json,
        targetType: 'inspector_link',
        targetId: newId,
      };
    },
  );

  // ---------- Inspector view ----------

  router.all(/^\/api\/inspect(\/|$)/, (req, res) => {
    if (req.method !== 'GET') {
      res.status(405);
      res.setHeader('Allow', 'GET');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.json({ error: { code: 'read_only', message: 'The inspector view is read-only.' } });
      return;
    }
    void ctx.withDb(async (client) => {
      const token = (req.originalUrl.split('?')[0].split('/')[3]) ?? '';
      const rows = await clientQuery<Row>(client, `SELECT * FROM inspector_links WHERE token = $1`, [token]);
      const link = rows[0];
      const at = nowMs();
      let outcome: 'allowed' | 'refused_scope' = 'refused_scope';
      if (!link) {
        res.status(404);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(errorBody('not_found', 'There is nothing here.'));
      } else if ((req.originalUrl.split('?')[0]).endsWith('/log.pdf')) {
        if (linkState(link, at) === 'revoked') {
          res.status(410);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.json(errorBody('link_revoked', 'This link was revoked.'));
        } else if (linkState(link, at) === 'expired') {
          res.status(410);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.json(errorBody('link_expired', 'This link has expired.'));
        } else {
          const bytes = await ctx.storage.getObject(String(link.snapshot_key));
          if (bytes === null) {
            res.status(503);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json(errorBody('storage_unavailable', 'The PDF cannot be downloaded right now.'));
          } else {
            outcome = 'allowed';
            res.status(200);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', String(bytes.length));
            res.setHeader('Content-Disposition', 'attachment; filename="visit-log.pdf"');
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(bytes);
          }
        }
      } else if (linkState(link, at) === 'revoked') {
        res.status(410);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(errorBody('link_revoked', 'This link was revoked.'));
      } else if (linkState(link, at) === 'expired') {
        res.status(410);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(errorBody('link_expired', 'This link has expired.'));
      } else {
        outcome = 'allowed';
        const truckRows = await clientQuery<Row>(client, `SELECT * FROM trucks WHERE id = $1`, [link.truck_id]);
        const truck = truckRows[0];
        const member = await memberById(client, String(truck.member_id));
        const site = await loadSite(client, String(truck.site_id));
        const visitRows = await clientQuery<Row>(
          client,
          `SELECT * FROM visits WHERE truck_id = $1 ORDER BY arrived_at DESC, id DESC`,
          [truck.id],
        );
        const departed = visitRows.filter((row) => row.departed_at !== null).map((row) => Number(row.departed_at));
        const lastDepartedAt = departed.length > 0 ? Math.max(...departed) : null;
        const overdue = lastDepartedAt !== null && at - lastDepartedAt > RETURN_GAP_HOURS * 3600000;
        const zone = site?.time_zone ?? 'UTC';
        const withGaps = visitRows.map((row, index) => {
          if (row.departed_at === null) return { row, gapHours: null, flagged: false };
          const previous = visitRows.slice(index + 1).find((candidate) => candidate.departed_at !== null);
          if (!previous) return { row, gapHours: null, flagged: false };
          const gapMs = Number(row.departed_at) - Number(previous.departed_at);
          const gapHours = Math.round((gapMs / 3600000) * 100) / 100;
          return { row, gapHours, flagged: gapHours > RETURN_GAP_HOURS };
        });
        res.status(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({
          truck: { name: String(truck.name), permit_number: String(truck.permit_number) },
          operator: { business_name: String(member?.business_name ?? '') },
          commissary: { site_name: String(site?.name ?? ''), address: String(site?.address ?? ''), time_zone: zone },
          expires_at: isoInstant(Number(link.expires_at)),
          overdue,
          last_departed_at: lastDepartedAt === null ? null : isoInstant(lastDepartedAt),
          visits: withGaps.map((item) => ({
            arrived_at: zoneInstantWall(zone, Number(item.row.arrived_at)),
            departed_at: item.row.departed_at === null ? null : zoneInstantWall(zone, Number(item.row.departed_at)),
            services: (item.row.services as string[]).map((service) => serviceLabel(service)),
            operator_signature: String(item.row.operator_signature),
            manager_name: String(item.row.manager_name),
            gap_hours: item.gapHours,
            gap_flagged: item.flagged,
          })),
        });
      }
      await writeAudit(client, {
        subject: { tenantId: link === undefined || link === null ? null : String(link.tenant_id), userId: null, name: 'inspector', role: null, scopeSiteId: null },
        action: (req.originalUrl.split('?')[0]).endsWith('/log.pdf') ? 'GET /api/inspect/{token}/log.pdf' : 'GET /api/inspect/{token}',
        targetType: 'inspector_link',
        targetId: null,
        outcome,
        addressPrefix: addressPrefix(req),
      });
      return undefined;
    }).catch(() => {
      if (!res.headersSent) {
        res.status(500);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(errorBody('internal', 'Something went wrong.'));
      }
    });
  });

  // ---------- Member search ----------

  handler(
    { action: 'GET /api/members', roles: ['kitchen_manager', 'finance_lead'], methods: ['GET'], pattern: /^\/api\/members$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (q.length < 2) throw validationError({ q: 'Type at least 2 characters.' });
      if (q.length > 100) throw validationError({ q: 'Search text is too long.' });
      const escaped = q.replace(/([%_\\])/g, '\\$1');
      const rows = await clientQuery<Row>(
        client,
        `SELECT u.id, u.business_name, u.contact_name, u.site_id, t.id AS truck_id, t.name AS truck_name
           FROM users u LEFT JOIN trucks t ON t.member_id = u.id
          WHERE u.role = 'member' AND u.tenant_id = $1
            ${actor.role === 'kitchen_manager' ? 'AND u.site_id = $2' : ''}
            AND (u.business_name ILIKE $${actor.role === 'kitchen_manager' ? 3 : 2} ESCAPE '\\' OR u.contact_name ILIKE $${actor.role === 'kitchen_manager' ? 3 : 2} ESCAPE '\\')
          ORDER BY u.business_name ASC LIMIT 10`,
        actor.role === 'kitchen_manager' ? [actor.tenantId, actor.siteId, `%${escaped}%`] : [actor.tenantId, `%${escaped}%`],
      );
      return {
        status: 200,
        body: {
          members: rows.map((row) => ({
            id: String(row.id),
            business_name: String(row.business_name ?? ''),
            contact_name: String(row.contact_name ?? ''),
            home_site_id: row.site_id === null ? null : String(row.site_id),
            truck: row.truck_id === null ? null : { id: String(row.truck_id), name: String(row.truck_name) },
          })),
        } as unknown as Json,
      };
    },
  );

  // ---------- Rates ----------

  handler(
    { action: 'GET /api/sites/{site_id}/rates', roles: ['finance_lead'], methods: ['GET'], pattern: /^\/api\/sites\/([^/]+)\/rates$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const siteId = (req.params[0] ?? '') as string;
      const site = await visibleSite(client, user as SessionUser, siteId);
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const today = siteToday(site.time_zone);
      const rows = await clientQuery<Row>(
        client,
        `SELECT * FROM rates WHERE site_id = $1 ORDER BY effective_from ASC`,
        [siteId],
      );
      const latest = rows.filter((row) => String(row.effective_from) <= today).pop();
      return {
        status: 200,
        body: { rates: rows.map((row) => rateWire(row, today, latest ? String(latest.effective_from) : null)) } as unknown as Json,
        targetType: 'site',
        targetId: siteId,
      };
    },
  );

  handler(
    { action: 'POST /api/sites/{site_id}/rates', roles: ['finance_lead'], methods: ['POST'], pattern: /^\/api\/sites\/([^/]+)\/rates$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const siteId = (req.params[0] ?? '') as string;
      const site = await visibleSite(client, user as SessionUser, siteId);
      if (!site) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) {
        if (field !== 'effective_from' && field !== 'hourly_rate_cents' && field !== 'tax_rate_percent') {
          throw validationError({ [field]: 'Unknown field.' });
        }
      }
      if (typeof body.effective_from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.effective_from)) {
        throw validationError({ effective_from: 'Enter a site-local date.' });
      }
      if (typeof body.hourly_rate_cents !== 'number' || !Number.isInteger(body.hourly_rate_cents) || body.hourly_rate_cents < 1 || body.hourly_rate_cents > 100000) {
        throw validationError({ hourly_rate_cents: 'Enter an hourly rate between $0.01 and $1,000.00.' });
      }
      if (typeof body.tax_rate_percent !== 'string' || !/^\d{1,2}(\.\d{1,3})?$/.test(body.tax_rate_percent) || Number(body.tax_rate_percent) > 25) {
        throw validationError({ tax_rate_percent: 'Enter a tax rate between 0 and 25 percent with up to three decimals.' });
      }
      const today = siteToday(site.time_zone);
      if (body.effective_from <= today) {
        throw validationError({ effective_from: 'The effective date must be after today in site time.' });
      }
      const existing = await clientQuery<Row>(client, `SELECT id FROM rates WHERE site_id = $1 AND effective_from = $2`, [siteId, body.effective_from]);
      if (existing.length > 0) {
        const err = validationError({ effective_from: 'The effective date must be after today in site time.' });
        throw new ApiError(409, 'rate_exists', `A rate already starts on ${body.effective_from}.`, { fields: err.fields });
      }
      const rateId = uuid();
      await clientQuery(
        client,
        `INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [rateId, siteId, body.effective_from, body.hourly_rate_cents, body.tax_rate_percent, nowMs()],
      );
      const rows = await clientQuery<Row>(client, `SELECT * FROM rates WHERE site_id = $1 ORDER BY effective_from ASC`, [siteId]);
      const latest = rows.filter((row) => String(row.effective_from) <= today).pop();
      return {
        status: 201,
        body: {
          rate: rateWire(rows.find((row) => row.id === rateId) ?? rows[0], today, latest ? String(latest.effective_from) : null),
          rates: rows.map((row) => rateWire(row, today, latest ? String(latest.effective_from) : null)),
        } as unknown as Json,
        targetType: 'rate',
        targetId: rateId,
      };
    },
  );

  // ---------- Reports ----------

  handler(
    { action: 'GET /api/reports/utilisation', roles: ['finance_lead'], methods: ['GET'], pattern: /^\/api\/reports\/utilisation$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const month = typeof req.query.month === 'string' ? req.query.month : '';
      if (!/^\d{4}-\d{2}$/.test(month) || month < '2000-01' || month > '2099-12') {
        throw validationError({ month: 'Enter a month as YYYY-MM.' });
      }
      let memberFilter: string | null = null;
      const memberParam = typeof req.query.member_id === 'string' ? req.query.member_id : null;
      if (memberParam !== null) {
        if (!isUuid(memberParam)) throw new ApiError(404, 'not_found', 'There is nothing here.');
        const member = await memberById(client, memberParam);
        if (!member || member.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
        memberFilter = memberParam;
      }
      const result = await utilisationReport(client, actor.tenantId, month, memberFilter);
      return { status: 200, body: result as unknown as Json };
    },
  );

  handler(
    { action: 'GET /api/reports/utilisation.csv', roles: ['finance_lead'], methods: ['GET'], pattern: /^\/api\/reports\/utilisation\.csv$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const month = typeof req.query.month === 'string' ? req.query.month : '';
      if (!/^\d{4}-\d{2}$/.test(month) || month < '2000-01' || month > '2099-12') {
        throw validationError({ month: 'Enter a month as YYYY-MM.' });
      }
      let memberFilter: string | null = null;
      const memberParam = typeof req.query.member_id === 'string' ? req.query.member_id : null;
      if (memberParam !== null) {
        if (!isUuid(memberParam)) throw new ApiError(404, 'not_found', 'There is nothing here.');
        const member = await memberById(client, memberParam);
        if (!member || member.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
        memberFilter = memberParam;
      }
      const report = await utilisationReport(client, actor.tenantId, month, memberFilter);
      const csv = csvFor(report);
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="utilisation-${month}.csv"`);
      res.send(csv);
      return { status: 200, body: null };
    },
  );

  // ---------- Audit ----------

  handler(
    { action: 'GET /api/audit', roles: ['kitchen_manager', 'finance_lead'], methods: ['GET'], pattern: /^\/api\/audit$/, csrf: false, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const sinceRaw = typeof req.query.since === 'string' ? req.query.since : null;
      let since = 0;
      if (sinceRaw !== null) {
        if (!/^\d+$/.test(sinceRaw) || Number(sinceRaw) > 2147483647 || Number(sinceRaw) < 1) {
          throw validationError({ since: 'Enter a positive integer.' });
        }
        since = Number(sinceRaw);
      }
      const subjectFilter = actor.role === 'kitchen_manager'
        ? `AND (
             (e.subject_user_id IN (SELECT id FROM users WHERE site_id = $2 AND role = 'kitchen_manager'))
             OR (e.subject_user_id IN (SELECT id FROM users WHERE site_id = $2 AND role = 'member'))
             OR (e.scope_site_id = $2)
           )`
        : '';
      const params = actor.role === 'kitchen_manager' ? [actor.tenantId, actor.siteId, since] : [actor.tenantId, since];
      const rows = await clientQuery<Row>(
        client,
        `SELECT e.* FROM audit_events e
          WHERE e.tenant_id = $1 ${subjectFilter} AND e.id > $${actor.role === 'kitchen_manager' ? 3 : 2}
          ORDER BY e.id DESC LIMIT 200`,
        params,
      );
      return {
        status: 200,
        body: {
          events: rows.map((row) => ({
            id: Number(row.id),
            at: isoInstant(Number(row.at)),
            actor: row.actor_user_id === null
              ? null
              : { user_id: String(row.actor_user_id), name: String(row.actor_name), role: row.actor_role as Json },
            action: String(row.action),
            target_type: (row.target_type as string | null) ?? null,
            target_id: (row.target_id as string | null) ?? null,
            outcome: String(row.outcome) as Json,
            address_prefix: (row.address_prefix as string | null) ?? null,
          })),
        } as unknown as Json,
      };
    },
  );

  // ---------- Site day actions ----------

  const visibleBooking = async (client: DbClient, actor: SessionUser, bookingId: string): Promise<BookingRow | null> => {
    const booking = await loadBooking(client, bookingId);
    if (!booking || booking.tenant_id !== actor.tenantId) return null;
    if (actor.role === 'kitchen_manager' && booking.site_id !== actor.siteId) return null;
    if (actor.role === 'member' && booking.member_id !== actor.userId) return null;
    return booking;
  };

  handler(
    { action: 'POST /api/bookings/{id}/check-in', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/bookings\/([^/]+)\/check-in$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const bookingId = (req.params[0] ?? '') as string;
      const booking = await visibleBooking(client, actor, bookingId);
      if (!booking) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) throw validationError({ [field]: 'Unknown field.' });
      const at = nowMs();
      if (booking.status !== 'confirmed') throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');
      if (at < Number(booking.start_at) - CHECK_IN_LEAD_MINUTES * 60000) {
        throw new ApiError(409, 'too_early', 'Too early to check in.');
      }
      if (at >= Number(booking.end_at)) {
        throw new ApiError(409, 'too_late', 'This booking has ended and can no longer be checked in.');
      }
      const site = await loadSite(client, booking.site_id);
      const validThrough = await certificateValidThrough(client, booking.member_id);
      if (!certificateCovers(validThrough, site?.time_zone ?? 'UTC', booking.date, at)) {
        throw new ApiError(422, 'certificate_expired', "The member's certificate of insurance has expired.");
      }
      const updated = await clientQuery<Row>(
        client,
        `UPDATE bookings SET status = 'checked_in', checked_in_at = $2, checked_in_by_name = $3 WHERE id = $1 AND status = 'confirmed' RETURNING *`,
        [bookingId, at, actor.name],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');
      const station = await loadStation(client, booking.station_id);
      const member = await memberById(client, booking.member_id);
      return {
        status: 200,
        body: { booking: bookingWire(updated[0] as unknown as BookingRow, String(station?.name ?? ''), String(member?.business_name ?? '')) } as unknown as Json,
        targetType: 'booking',
        targetId: bookingId,
      };
    },
  );

  handler(
    { action: 'POST /api/bookings/{id}/no-show', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/bookings\/([^/]+)\/no-show$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const bookingId = (req.params[0] ?? '') as string;
      const booking = await visibleBooking(client, actor, bookingId);
      if (!booking) throw new ApiError(404, 'not_found', 'There is nothing here.');
      const body = (req.body ?? {}) as Record<string, Json>;
      for (const field of Object.keys(body)) throw validationError({ [field]: 'Unknown field.' });
      const at = nowMs();
      if (booking.status !== 'confirmed') throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');
      if (at < Number(booking.start_at) + NO_SHOW_DELAY_MINUTES * 60000) {
        throw new ApiError(409, 'too_early', 'Too early to mark a no-show.');
      }
      const updated = await clientQuery<Row>(
        client,
        `UPDATE bookings SET status = 'no_show', no_show_by_name = $2 WHERE id = $1 AND status = 'confirmed' RETURNING *`,
        [bookingId, actor.name],
      );
      if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');
      await writeMovement(client, {
        memberId: booking.member_id,
        tenantId: booking.tenant_id,
        kind: 'forfeit',
        fromAccount: 'committed',
        toAccount: 'forfeited',
        quarterHours: Number(booking.quarter_hours),
        bookingId,
        actor: { userId: actor.userId, name: actor.name, role: 'kitchen_manager' },
        atMs: at,
        lots: [],
      });
      const station = await loadStation(client, booking.station_id);
      const member = await memberById(client, booking.member_id);
      return {
        status: 200,
        body: { booking: bookingWire(updated[0] as unknown as BookingRow, String(station?.name ?? ''), String(member?.business_name ?? '')) } as unknown as Json,
        targetType: 'booking',
        targetId: bookingId,
      };
    },
  );

  handler(
    { action: 'POST /api/bookings/{id}/check-out', roles: ['kitchen_manager'], methods: ['POST'], pattern: /^\/api\/bookings\/([^/]+)\/check-out$/, csrf: true, needsSession: true },
    async (req, res, client, user) => {
      const actor = user as SessionUser;
      const bookingId = (req.params[0] ?? '') as string;
      const key = takeIdempotencyKey(req);
      const binding = `${bookingId}`;
      const state = await idempotencyBind(client, actor.userId, key, 'POST', `/api/bookings/${bookingId}/check-out`, binding);
      if (state === 'stored') {
        const record = await idempotencyLookup(client, actor.userId, key, 'POST', `/api/bookings/${bookingId}/check-out`, binding);
        return {
          status: Number(record?.status ?? 200),
          body: (typeof record?.response_body === 'string' ? JSON.parse(record.response_body) : (record?.response_body ?? {})) as Json,
          headers: { 'Idempotent-Replay': 'true' },
          targetType: 'booking',
          targetId: bookingId,
        };
      }
      if (state === 'conflict') throw new ApiError(409, 'idempotency_conflict', 'That key is bound to another request.');
      if (state === 'in-progress') throw new ApiError(409, 'idempotency_in_progress', 'That request is still in progress.');
      try {
        const result = await checkOut(ctx, client, actor, bookingId);
        await idempotencyStore(client, actor.userId, key, 200, result.body);
        return { status: 200, body: result.body, targetType: 'booking', targetId: bookingId };
      } catch (err) {
        await idempotencyRelease(client, actor.userId, key);
        throw err;
      }
    },
  );

  registerRoutes();

  return router;
}

function csvFor(report: UtilisationReport): string {
  const lines = ['site_name,month,scheduled_hours,used_hours,forfeited_hours,overage_cents'];
  for (const site of report.sites) {
    lines.push(`${site.site_name},${report.month},${site.scheduled_hours.toFixed(2)},${site.used_hours.toFixed(2)},${site.forfeited_hours.toFixed(2)},${String(site.overage_cents)}`);
  }
  lines.push(`TOTAL,${report.month},${report.totals.scheduled_hours.toFixed(2)},${report.totals.used_hours.toFixed(2)},${report.totals.forfeited_hours.toFixed(2)},${String(report.totals.overage_cents)}`);
  return lines.join('\n');
}

export interface UtilisationReport {
  month: string;
  member: { id: string; business_name: string } | null;
  sites: Array<{ site_id: string; site_name: string; scheduled_hours: number; used_hours: number; forfeited_hours: number; overage_cents: number }>;
  totals: { scheduled_hours: number; used_hours: number; forfeited_hours: number; overage_cents: number };
}

async function utilisationReport(
  client: DbClient,
  tenantId: string,
  month: string,
  memberId: string | null,
): Promise<UtilisationReport> {
  const sites = await clientQuery<Row>(client, `SELECT * FROM sites WHERE tenant_id = $1 ORDER BY name ASC`, [tenantId]);
  const memberRow = memberId
    ? await clientQuery<Row>(client, `SELECT id, business_name FROM users WHERE id = $1`, [memberId])
    : [];
  const sitesOut: UtilisationReport['sites'] = [];
  for (const site of sites) {
    const zone = String(site.time_zone);
    const monthStartDay = Math.round(Date.parse(month + '-01T00:00:00Z') / 86400000);
    const monthStart = zoneDayStart(new Date(monthStartDay * 86400000).toISOString().slice(0, 10), zone);
    const nextMonth = month.endsWith('-12') ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(Number(month.slice(5, 7)) + 1).padStart(2, '0')}`;
    const monthEndDay = Math.round(Date.parse(nextMonth + '-01T00:00:00Z') / 86400000);
    const monthEnd = zoneDayStart(new Date(monthEndDay * 86400000).toISOString().slice(0, 10), zone);
    const scheduledRows = await clientQuery<Row>(
      client,
      `SELECT COALESCE(SUM(quarter_hours), 0) AS total FROM bookings
        WHERE site_id = $1 AND status IN ('confirmed','checked_in') AND start_at >= $2 AND start_at < $3 ${memberId ? 'AND member_id = $4' : ''}`,
      memberId ? [site.id, monthStart, monthEnd, memberId] : [site.id, monthStart, monthEnd],
    );
    const usedRows = await clientQuery<Row>(
      client,
      `SELECT COALESCE(SUM(m.quarter_hours), 0) AS total
         FROM movements m JOIN bookings b ON b.id = m.booking_id
        WHERE m.tenant_id = $1 AND m.kind IN ('usage','late_checkout') AND b.site_id = $2
          AND b.start_at >= $3 AND b.start_at < $4 ${memberId ? 'AND b.member_id = $5' : ''}`,
      memberId ? [tenantId, site.id, monthStart, monthEnd, memberId] : [tenantId, site.id, monthStart, monthEnd],
    );
    const forfeitedRows = await clientQuery<Row>(
      client,
      `SELECT COALESCE(SUM(m.quarter_hours), 0) AS total
         FROM movements m JOIN bookings b ON b.id = m.booking_id
        WHERE m.tenant_id = $1 AND m.kind = 'forfeit' AND b.site_id = $2
          AND b.start_at >= $3 AND b.start_at < $4 ${memberId ? 'AND b.member_id = $5' : ''}`,
      memberId ? [tenantId, site.id, monthStart, monthEnd, memberId] : [tenantId, site.id, monthStart, monthEnd],
    );
    const overageRows = await clientQuery<Row>(
      client,
      `SELECT COALESCE(SUM((b.overage->>'total_cents')::int), 0) AS total
         FROM bookings b
        WHERE b.tenant_id = $1 AND b.site_id = $2 AND b.overage IS NOT NULL
          AND b.start_at >= $3 AND b.start_at < $4 ${memberId ? 'AND b.member_id = $5' : ''}`,
      memberId ? [tenantId, site.id, monthStart, monthEnd, memberId] : [tenantId, site.id, monthStart, monthEnd],
    );
    sitesOut.push({
      site_id: String(site.id),
      site_name: String(site.name),
      scheduled_hours: Number(scheduledRows[0].total) / 4,
      used_hours: Number(usedRows[0].total) / 4,
      forfeited_hours: Number(forfeitedRows[0].total) / 4,
      overage_cents: Number(overageRows[0].total),
    });
  }
  const totals = sitesOut.reduce(
    (acc, site) => ({
      scheduled_hours: acc.scheduled_hours + site.scheduled_hours,
      used_hours: acc.used_hours + site.used_hours,
      forfeited_hours: acc.forfeited_hours + site.forfeited_hours,
      overage_cents: acc.overage_cents + site.overage_cents,
    }),
    { scheduled_hours: 0, used_hours: 0, forfeited_hours: 0, overage_cents: 0 },
  );
  return {
    month,
    member: memberRow.length > 0 ? { id: String(memberRow[0].id), business_name: String(memberRow[0].business_name) } : null,
    sites: sitesOut,
    totals,
  };
}

function zoneInstantWall(zone: string, at: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(at));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}`;
}

async function readRawBody(req: AuthedRequest): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function documentColumn(type: string): string {
  if (type === 'certificate_of_insurance') return 'coi_valid_through';
  if (type === 'food_handler_certificate') return 'fhc_valid_through';
  return 'bl_valid_through';
}

function bookingKind(status: string, mine: boolean): string {
  if (mine && status === 'held') return 'own_held';
  if (mine) return 'own_confirmed';
  return 'booked';
}

function localNow(zone: string, atMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(atMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`;
}

function cookieAttributes(secure: boolean): string {
  return secure ? '; Path=/; HttpOnly; SameSite=Strict; Secure' : '; Path=/; HttpOnly; SameSite=Strict';
}

function csrfCookieAttributes(secure: boolean): string {
  return secure ? '; Path=/; SameSite=Strict; Secure' : '; Path=/; SameSite=Strict';
}

async function meBody(client: DbClient, userId: string): Promise<Json> {
  const rows = await clientQuery<Row>(client, `SELECT * FROM users WHERE id = $1`, [userId]);
  const user = rows[0];
  const tenantRows = await clientQuery<Row>(client, `SELECT * FROM tenants WHERE id = $1`, [user.tenant_id]);
  const tenant = tenantRows[0];
  let member: Json | null = null;
  if (user.role === 'member') {
    const balance = await memberBalances(client, userId);
    const lots = await loadLots(client, userId);
    const homeSiteRows = user.site_id === null ? [] : await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [user.site_id]);
    const zone = homeSiteRows.length > 0 ? String(homeSiteRows[0].time_zone) : 'UTC';
    const today = siteToday(zone);
    const truckRows = await clientQuery<Row>(client, `SELECT id, name, permit_number FROM trucks WHERE member_id = $1`, [userId]);
    const truck = truckRows[0] ?? null;
    member = {
      id: String(user.id),
      business_name: String(user.business_name ?? ''),
      home_site_id: user.site_id === null ? null : String(user.site_id),
      available_hours: balance.availableQh / 4,
      committed_hours: balance.committedQh / 4,
      valid_through: {
        certificate_of_insurance: dateOnly(user.coi_valid_through),
        food_handler_certificate: dateOnly(user.fhc_valid_through),
        business_licence: dateOnly(user.bl_valid_through),
      },
      truck: truck === null ? null : { id: String(truck.id), name: String(truck.name), permit_number: String(truck.permit_number) },
    };
    void lots;
    void today;
  }
  return {
    user: {
      id: String(user.id),
      name: String(user.name),
      email: String(user.email),
      role: user.role as Role,
      tenant: { id: String(tenant.id), name: String(tenant.name), legal_name: String(tenant.legal_name) },
      site_id: user.site_id === null ? null : String(user.site_id),
    },
    member,
  };
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = value as Date;
  return date.toISOString().slice(0, 10);
}

function siteToday(zone: string): string {
  return localDateOfInstant(nowMs(), zone);
}
