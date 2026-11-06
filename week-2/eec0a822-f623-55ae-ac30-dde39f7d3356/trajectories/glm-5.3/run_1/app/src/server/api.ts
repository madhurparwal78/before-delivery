import { type IncomingMessage, type ServerResponse } from 'node:http';
import { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError, accessRemoved, forbidden, invalidJson, methodNotAllowed, notFound, sessionEnded, tooLarge, unauthenticated, unsupportedMediaType } from './errors.js';
import { parseCookies, readRawBody, type Ctx } from './http.js';
import { isRecord } from './validate.js';
import { initStorage } from './minio.js';
import { sweep } from './sweeps.js';
import { applySchemaAndSeed } from './schema.js';
import * as base from '../shared/bases.js';

import * as Session from './endpoints-session.js';
import * as Holds from './endpoints-holds.js';
import * as Pages from './endpoints-pages.js';
import * as Ops from './endpoints-ops.js';
import * as Marina from './endpoints-marina.js';
import * as Stores from './endpoints-stores.js';
import { publicFleet, publicYacht, sitemap } from './public-api.js';

const JSON_LIMIT = 100000;

export interface MemberRow {
  id: string;
  workspace_slug: string;
  name: string;
  email: string;
  role: string;
  yacht_slug: string | null;
}

export class App {
  readonly config: Config;
  readonly pool: Pool;

  constructor(config: Config, pool: Pool) {
    this.config = config;
    this.pool = pool;
  }

  async start(): Promise<void> {
    for (let i = 0; i < 120; i++) {
      try {
        const client = await this.pool.connect();
        try {
          await applySchemaAndSeed(client);
        } finally {
          client.release();
        }
        break;
      } catch (e) {
        if (i === 119) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // MinIO: create the bucket when it can be reached; uploads retry at use
    // time, so a slow or absent MinIO never blocks startup (DP-40).
    void initStorage(this.config).catch(() => {});
    const timer = setInterval(() => {
      sweep(this).catch(() => {});
    }, 10000);
    timer.unref();
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let ctx: Ctx | null = null;
    try {
      ctx = await this.buildCtx(req, res);
      const result = await this.route(ctx);
      if (result === undefined) return;
      if (result === null) {
        res.writeHead(204, this.baseHeaders(ctx));
        res.end();
        return;
      }
      res.writeHead(200, { ...this.baseHeaders(ctx), 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (e instanceof ApiError) {
        if (!res.headersSent) {
          res.writeHead(e.status, { 'Content-Type': 'application/json; charset=utf-8', ...e.headers });
          res.end(JSON.stringify(e.body));
        }
        return;
      }
      console.error('unhandled', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal' }));
      }
    }
  }

  baseHeaders(ctx: Ctx): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const c of ctx.setCookies) headers['Set-Cookie'] = (headers['Set-Cookie'] ? headers['Set-Cookie'] + '\n' : '') + c;
    return headers;
  }

  async buildCtx(req: IncomingMessage, res: ServerResponse): Promise<Ctx> {
    const url = new URL(req.url ?? '/', 'http://local');
    const ctx: Ctx = {
      req,
      res,
      url,
      method: req.method ?? 'GET',
      params: {},
      query: url.searchParams,
      cookies: parseCookies(req.headers.cookie),
      body: null,
      rawBody: null,
      session: null,
      setCookies: [],
    };
    const sessionId = ctx.cookies['tw_session'];
    if (sessionId) {
      const rows = await this.pool.query(
        `SELECT s.id, s.ends_at, s.signed_out, m.id AS member_id,
           (m.id IS NULL) AS member_gone
         FROM sessions s LEFT JOIN members m ON m.id = s.member_id WHERE s.id = $1`,
        [sessionId],
      );
      const row = rows.rows[0];
      if (row) {
        ctx.session = { id: row.id, memberId: row.member_id };
        const info = ctx as Ctx & { sessionState?: string; memberGone?: boolean };
        info.memberGone = Boolean(row.member_gone);
        info.sessionState = row.signed_out || row.ends_at.getTime() <= Date.now() ? 'ended' : 'live';
      }
    }
    return ctx;
  }

  async route(ctx: Ctx): Promise<unknown> {
    const path = ctx.url.pathname;
    const m = ctx.method;

    if (path === '/api/health') {
      this.requireMethod(ctx, 'GET');
      return { status: 'ok' };
    }

    if (path === '/api/session') {
      if (m === 'GET') return Session.getSession(this, ctx);
      if (m === 'POST') return Session.postSession(this, ctx);
      if (m === 'DELETE') return Session.deleteSession(this, ctx);
      throw methodNotAllowed('GET, POST, DELETE');
    }

    let match: RegExpExecArray | null;
    if ((match = /^\/api\/public\/fleets\/([^/]+)$/.exec(path))) {
      this.requireMethod(ctx, 'GET');
      return publicFleet(this, ctx, decodeURIComponent(match[1]));
    }
    if ((match = /^\/api\/public\/fleets\/([^/]+)\/yachts\/([^/]+)$/.exec(path))) {
      this.requireMethod(ctx, 'GET');
      return publicYacht(this, ctx, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    }
    if (path === '/sitemap.xml') {
      this.requireMethod(ctx, 'GET');
      return sitemap(this, ctx);
    }

    if ((match = /^\/api\/manifest\/([^/]+)\/guests\/([^/]+)\/photo$/.exec(path))) {
      this.requireMethod(ctx, 'POST');
      return Pages.manifestUploadPhoto(this, ctx, match[1], match[2]);
    }
    if ((match = /^\/api\/manifest\/([^/]+)\/guests\/([^/]+)$/.exec(path))) {
      this.requireMethod(ctx, 'DELETE');
      return Pages.manifestDeleteGuest(this, ctx, match[1], match[2]);
    }
    if ((match = /^\/api\/manifest\/([^/]+)\/guests$/.exec(path))) {
      if (m === 'POST') return Pages.manifestAddGuest(this, ctx, match[1]);
      if (m === 'PUT') return Pages.manifestPutGuests(this, ctx, match[1]);
      throw methodNotAllowed('POST, PUT');
    }
    if ((match = /^\/api\/manifest\/([^/]+)$/.exec(path))) {
      this.requireMethod(ctx, 'GET');
      return Pages.manifestGet(this, ctx, match[1]);
    }

    if ((match = /^\/api\/broker\/([^/]+)\/holds\/([^/]+)\/release$/.exec(path))) {
      this.requireMethod(ctx, 'POST');
      return Pages.brokerReleaseHold(this, ctx, match[1], match[2]);
    }
    if ((match = /^\/api\/broker\/([^/]+)\/holds$/.exec(path))) {
      this.requireMethod(ctx, 'POST');
      return Pages.brokerPlaceHold(this, ctx, match[1]);
    }
    if ((match = /^\/api\/broker\/([^/]+)$/.exec(path))) {
      this.requireMethod(ctx, 'GET');
      return Pages.brokerGet(this, ctx, match[1]);
    }

    if ((match = /^\/api\/w\/([^/]+)(\/.*)?$/.exec(path))) {
      return this.staffRoute(ctx, decodeURIComponent(match[1]), match[2] ?? '/');
    }

    if (path.startsWith('/api/')) throw notFound();
    throw notFound();
  }

  requireMethod(ctx: Ctx, ...methods: string[]): void {
    if (!methods.includes(ctx.method)) throw methodNotAllowed(methods.join(', '));
  }

  async staffRoute(ctx: Ctx, ws: string, rest: string): Promise<unknown> {
    const m = ctx.method;
    let match: RegExpExecArray | null;

    if (rest === '/members') {
      if (m === 'GET') return Session.membersList(this, ctx, ws);
      if (m === 'POST') return Session.membersCreate(this, ctx, ws);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/members\/([^/]+)$/.exec(rest))) {
      if (m === 'PATCH') return Session.membersPatch(this, ctx, ws, match[1]);
      if (m === 'DELETE') return Session.membersDelete(this, ctx, ws, match[1]);
      throw methodNotAllowed('PATCH, DELETE');
    }

    if (rest === '/anchorages') {
      this.requireMethod(ctx, 'GET');
      await this.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member']);
      const rows = await this.pool.query('SELECT id, name, base, latitude, longitude FROM anchorages WHERE workspace_slug = $1 ORDER BY sort_order', [ws]);
      return { anchorages: rows.rows.map((r) => ({ id: r.id, name: r.name, base: r.base, latitude: Number(r.latitude), longitude: Number(r.longitude) })) };
    }

    if (rest === '/yachts') {
      this.requireMethod(ctx, 'GET');
      await this.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member']);
      return Holds.yachtsList(this, ctx, ws);
    }
    if ((match = /^\/yachts\/([^/]+)\/weeks$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Holds.yachtWeeks(this, ctx, ws, match[1]);
    }
    if ((match = /^\/yachts\/([^/]+)\/withdraw$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Holds.yachtWithdraw(this, ctx, ws, match[1]);
    }
    if ((match = /^\/yachts\/([^/]+)\/return-to-sale$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Holds.yachtReturn(this, ctx, ws, match[1]);
    }
    if ((match = /^\/yachts\/([^/]+)\/rota$/.exec(rest))) {
      if (m === 'GET') return Ops.rotaGet(this, ctx, ws, match[1]);
      if (m === 'PUT') return Ops.rotaPut(this, ctx, ws, match[1]);
      throw methodNotAllowed('GET, PUT');
    }
    if ((match = /^\/yachts\/([^/]+)\/stores\/([^/]+)\/movements$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Stores.storeMovement(this, ctx, ws, match[1], match[2]);
    }
    if ((match = /^\/yachts\/([^/]+)\/stores\/([^/]+)$/.exec(rest))) {
      if (m === 'GET') return Stores.storeGet(this, ctx, ws, match[1], match[2]);
      if (m === 'DELETE') return Stores.storeDelete(this, ctx, ws, match[1], match[2]);
      throw methodNotAllowed('GET, DELETE');
    }
    if ((match = /^\/yachts\/([^/]+)\/stores$/.exec(rest))) {
      if (m === 'GET') return Stores.storesList(this, ctx, ws, match[1]);
      if (m === 'POST') return Stores.storesCreate(this, ctx, ws, match[1]);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/yachts\/([^/]+)\/energy-logs$/.exec(rest))) {
      if (m === 'GET') return Stores.energyLogsList(this, ctx, ws, match[1]);
      if (m === 'POST') return Stores.energyLogUpload(this, ctx, ws, match[1]);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/yachts\/([^/]+)\/energy-days$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Stores.energyDays(this, ctx, ws, match[1]);
    }
    if ((match = /^\/yachts\/([^/]+)$/.exec(rest))) {
      if (m === 'GET') return Holds.yachtGet(this, ctx, ws, match[1]);
      if (m === 'PATCH') return Holds.yachtPatch(this, ctx, ws, match[1]);
      throw methodNotAllowed('GET, PATCH');
    }

    if (rest === '/holds') {
      if (m === 'GET') return Holds.holdsList(this, ctx, ws);
      if (m === 'POST') return Holds.holdsCreate(this, ctx, ws);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/holds\/([^/]+)\/quote$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Holds.holdQuote(this, ctx, ws, match[1]);
    }
    if ((match = /^\/holds\/([^/]+)\/release$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Holds.holdRelease(this, ctx, ws, match[1]);
    }
    if ((match = /^\/holds\/([^/]+)\/deposit$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Holds.holdDeposit(this, ctx, ws, match[1]);
    }
    if ((match = /^\/holds\/([^/]+)$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Holds.holdGet(this, ctx, ws, match[1]);
    }

    if (rest === '/charters') {
      if (m === 'GET') return Holds.chartersList(this, ctx, ws);
      if (m === 'POST') return Holds.chartersCreate(this, ctx, ws);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/charters\/([^/]+)\/manifest-page\/end$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Pages.manifestPageEnd(this, ctx, ws, match[1]);
    }
    if ((match = /^\/charters\/([^/]+)\/manifest-page$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Pages.manifestPageSend(this, ctx, ws, match[1]);
    }
    if ((match = /^\/charters\/([^/]+)\/manifest\/guests\/([^/]+)\/photo$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Pages.guestPhoto(this, ctx, ws, match[1], match[2]);
    }
    if ((match = /^\/charters\/([^/]+)\/manifest$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Pages.charterManifest(this, ctx, ws, match[1]);
    }
    if ((match = /^\/charters\/([^/]+)\/close$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Holds.charterClose(this, ctx, ws, match[1]);
    }
    if ((match = /^\/charters\/([^/]+)$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Holds.charterGet(this, ctx, ws, match[1]);
    }

    if (rest === '/passages') {
      if (m === 'GET') return Ops.passagesList(this, ctx, ws);
      if (m === 'POST') return Ops.passagesCreate(this, ctx, ws);
      throw methodNotAllowed('GET, POST');
    }
    if ((match = /^\/passages\/([^/]+)\/send$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Ops.passageSend(this, ctx, ws, match[1]);
    }
    if ((match = /^\/passages\/([^/]+)$/.exec(rest))) {
      if (m === 'GET') return Ops.passageGet(this, ctx, ws, match[1]);
      if (m === 'PUT') return Ops.passagePut(this, ctx, ws, match[1]);
      throw methodNotAllowed('GET, PUT');
    }

    if (rest === '/marinas') {
      this.requireMethod(ctx, 'GET');
      return Marina.marinasList(this, ctx, ws);
    }
    if ((match = /^\/marinas\/([^/]+)\/berths$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Marina.berthsSearch(this, ctx, ws, match[1]);
    }
    if ((match = /^\/marinas\/([^/]+)\/tariffs$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Marina.tariffAdd(this, ctx, ws, match[1]);
    }
    if ((match = /^\/marinas\/([^/]+)\/pontoons\/([^/]+)\/slots$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Marina.slotsList(this, ctx, ws, match[1], decodeURIComponent(match[2]));
    }
    if (rest === '/berth-bookings') {
      this.requireMethod(ctx, 'POST');
      return Marina.berthBook(this, ctx, ws);
    }
    if ((match = /^\/berth-bookings\/([^/]+)$/.exec(rest))) {
      this.requireMethod(ctx, 'GET');
      return Marina.berthBookingGet(this, ctx, ws, match[1]);
    }
    if (rest === '/exchange-tables') {
      if (m === 'GET') return Marina.exchangeTablesList(this, ctx, ws);
      if (m === 'POST') return Marina.exchangeTableAdd(this, ctx, ws);
      throw methodNotAllowed('GET, POST');
    }
    if (rest === '/shore-power-bookings') {
      this.requireMethod(ctx, 'POST');
      return Marina.slotBook(this, ctx, ws);
    }

    if (rest === '/brokers') {
      this.requireMethod(ctx, 'GET');
      return Pages.brokersList(this, ctx, ws);
    }
    if ((match = /^\/brokers\/([^/]+)\/page\/end$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Pages.brokerPageEnd(this, ctx, ws, match[1]);
    }
    if ((match = /^\/brokers\/([^/]+)\/page$/.exec(rest))) {
      this.requireMethod(ctx, 'POST');
      return Pages.brokerPageIssue(this, ctx, ws, match[1]);
    }

    throw notFound();
  }

  async requireStaff(ctx: Ctx, ws: string, roles: string[]): Promise<MemberRow> {
    const info = ctx as Ctx & { sessionState?: string; memberGone?: boolean };
    if (!ctx.session) throw unauthenticated();
    if (info.memberGone) throw accessRemoved();
    if (info.sessionState === 'ended') throw sessionEnded();
    const rows = await this.pool.query<MemberRow>(
      'SELECT id, workspace_slug, name, email, role, yacht_slug FROM members WHERE id = $1',
      [ctx.session.memberId],
    );
    const member = rows.rows[0];
    if (!member) throw accessRemoved();
    if (member.workspace_slug !== ws) throw notFound();
    if (!roles.includes(member.role)) throw forbidden();
    return member;
  }

  async readJsonBody(ctx: Ctx): Promise<Record<string, unknown>> {
    const ct = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim();
    if (ct !== 'application/json') throw unsupportedMediaType();
    const raw = await readRawBody(ctx.req, JSON_LIMIT);
    if (!raw.ok) throw tooLarge(JSON_LIMIT);
    const text = raw.body!.toString('utf8');
    if (text.trim() === '') throw invalidJson();
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : throwInvalid();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw invalidJson();
    }
  }
}

function throwInvalid(): never {
  throw invalidJson();
}
