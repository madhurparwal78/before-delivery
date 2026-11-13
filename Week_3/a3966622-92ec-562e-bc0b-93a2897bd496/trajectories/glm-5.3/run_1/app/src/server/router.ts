// The API routes. Every error uses the published shape, and precedence is
// applied per route: 401, 404, 403, keyed replay, 428/412, 409, 422 — with
// stale_plan and window_closed after 422.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { daySteps, formatPortTime, formatPortStamp, portInstantFromApi } from './porttime.js';
import { computePlan } from './plan.js';
import { estimateLines, totalOf } from './tariff.js';
import {
  ApiError, beginKeyed, finishKeyed, forbidden, notFound, readBody,
  readJsonBody, requireRole, unauthenticated, errorBody,
} from './api-util.js';
import { validationError as fieldError } from './validate.js';
import { serializeInvoice, serializeMove, serializePlan, serializeReport, serializeVessel } from './serialize.js';
import { canReadMove, renderCsv, exportRows } from './export.js';
import { moveVisibleTo, reportVisibleTo, invoiceVisibleTo, vesselVisibleTo } from './visibility.js';
import { Store, SEED_PASSWORD } from './store.js';
import { Actions } from './actions.js';
import type { TariffBody } from './actions.js';
import { serializePort } from './serialize.js';
import { makeNotice, enqueueNotice } from './steps.js';
import { formatPortDateTimeSpace, portInstant } from './porttime.js';
import { sha256Hex, signatureMatches } from './checksum.js';
import type { User } from './types.js';

const PHOTO_MAX_BYTES = 5_000_000;
const CARD_MAX_BYTES = 10_000_000;


export interface HttpEnv {
  store: Store;
  now: () => number;
  detentionUnitSeconds: number;
  photoStore: PhotoStoreLike;
  servicesState: () => Promise<{ billing: 'up' | 'down'; storage: 'up' | 'down'; mail: 'up' | 'down' }>;
  runPendingStep(stepId: string): Promise<boolean>;
  runPendingDue(): Promise<void>;
}

import type { Invoice, Move, Vessel } from './types.js';

type MoveRecord = Move;
type VesselRow = Vessel;
type InvoiceRecord = Invoice;

export interface PhotoStoreLike {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  reachable(): Promise<boolean>;
}

export class Router {
  constructor(private readonly env: HttpEnv) {}

  async handle(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams): Promise<void> {
    const method = req.method ?? 'GET';
    const user = this.userOf(req);
    const key = idempotencyKeyOf(req);

    const respond = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(payload);
    };
    const respondError = (err: ApiError): void => {
      const headers: Record<string, string> = {};
      if (err.status === 401) headers['WWW-Authenticate'] = 'Session';
      res.writeHead(err.status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(errorBody(err)));
    };

    // Health is public and never reflects the providers.
    if (method === 'GET' && pathname === '/api/health') {
      respond(200, { status: 'ok' });
      return;
    }
    if (method === 'GET' && pathname === '/api/port') {
      respond(200, serializePort(this.env.store, this.env.now()));
      return;
    }

    // A state-changing request with a foreign Origin is refused.
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(origin).host === req.headers.host;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) {
          respondError(forbidden());
          return;
        }
      }
    }

    if (method === 'POST' && pathname === '/api/session') {
      const raw = await readBody(req, 65_536);
      if (raw === null) throw badBody();
      const contentType = String(req.headers['content-type'] ?? '');
      if (contentType !== '' && !contentType.toLowerCase().startsWith('application/json')) {
        throw unsupportedType();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        throw badBody();
      }
      const body = (parsed ?? {}) as Record<string, unknown>;
      const email = String(body.email ?? '');
      const password = String(body.password ?? '');
      const found = this.env.store.users.find((u) => u.email === email);
      if (!found || password !== SEED_PASSWORD) {
        respondError(new ApiError(401, 'invalid_credentials', 'Email or password is incorrect'));
        return;
      }
      const token = this.env.store.nextSessionToken();
      this.env.store.sessions.push({ token, user_id: found.id, created_ms: Date.now() });
      await this.env.store.save();
      const cookie = `slackwater_session=${token}; HttpOnly; Path=/; SameSite=Lax`;
      respond(200, { user: publicUser(found) }, { 'Set-Cookie': cookie });
      return;
    }

    if (method === 'GET' && pathname === '/api/session') {
      if (!user) { respondError(unauthenticated()); return; }
      respond(200, { user: publicUser(user) });
      return;
    }
    if (method === 'DELETE' && pathname === '/api/session') {
      if (!user) { respondError(unauthenticated()); return; }
      const token = sessionTokenOf(req);
      const record = this.env.store.sessions.find((s) => s.token === token);
      if (record) {
        this.env.store.sessions.splice(this.env.store.sessions.indexOf(record), 1);
        await this.env.store.save();
      }
      res.writeHead(204, { 'Set-Cookie': 'slackwater_session=; HttpOnly; Path=/; Max-Age=0' });
      res.end();
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!user) { respondError(unauthenticated()); return; }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: 'Not found' }));
      return;
    }

    try {
      await this.routeSigned(req, res, user, method, pathname, query, key, respond, respondError);
    } catch (err) {
      if (err instanceof ApiError) {
        respondError(err);
      } else {
        throw err;
      }
    }
  }

  private async routeSigned(
    req: IncomingMessage,
    res: ServerResponse,
    user: User,
    method: string,
    pathname: string,
    query: URLSearchParams,
    key: string | null,
    respond: (status: number, body: unknown, headers?: Record<string, string>) => void,
    respondError: (err: ApiError) => void,
  ): Promise<void> {
    const store = this.env.store;
    const nowMs = this.env.now();

    // ---- services ----
    if (method === 'GET' && pathname === '/api/services') {
      respond(200, await this.servicesState());
      return;
    }

    // ---- vessels ----
    if (method === 'GET' && pathname === '/api/vessels') {
      if (user.role === 'clerk') { respondError(forbidden()); return; }
      const vessels = store.vessels
        .filter((v) => vesselVisibleTo(user, v.agency_code))
        .map((v) => serializeVessel(store, v.id));
      respond(200, { vessels });
      return;
    }

    // ---- plan ----
    if (method === 'POST' && pathname === '/api/plan') {
      requireRole(user, ['agent', 'dispatcher']);
      const body = await readJsonBody(req, await readBody(req, 65_536));
      respond(200, await this.planFromBody(body as Record<string, unknown>, nowMs, store));
      return;
    }

    // ---- moves ----
    if (method === 'GET' && pathname === '/api/moves') {
      const q = query.get('q') ?? '';
      const status = query.get('status');
      const moves = store.moves
        .filter((m) => canReadMove(store, user, m))
        .filter((m) => status === null || m.status === status)
        .filter((m) => q === '' || matchesSearch(store, m, q))
        .sort((a, b) => a.boarding_ms - b.boarding_ms || (a.ref < b.ref ? -1 : 1))
        .map((m) => serializeMove(store, m, user, nowMs));
      respond(200, { moves });
      return;
    }

    if (method === 'GET' && pathname === '/api/exports/moves.csv') {
      requireRole(user, ['agent', 'dispatcher', 'clerk']);
      const csv = renderCsv(exportRows(store, user));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
      res.end(csv);
      return;
    }

    if (method === 'POST' && pathname === '/api/moves') {
      requireRole(user, ['agent']);
      const body = await readJsonBody(req, await readBody(req, 65_536));
      await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
        const move = await this.createMove(user, body as Record<string, unknown>, nowMs);
        return { status: 201, body: serializeMove(store, move, user, this.env.now()) };
      });
      return;
    }

    const moveMatch = /^\/api\/moves\/([^/]+)(\/.*)?$/.exec(pathname);
    if (moveMatch) {
      const ref = moveMatch[1]!;
      const rest = moveMatch[2] ?? '';
      if (rest === '' && method === 'GET') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        respond(200, serializeMove(store, move, user, nowMs), { ETag: `"${move.version}"` });
        return;
      }
      if (rest === '' && method === 'PATCH') {
        requireRole(user, ['agent', 'dispatcher']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        const outcome = await this.patchMove(user, move, req, body as Record<string, unknown>, nowMs);
        respond(outcome.status, outcome.body, outcome.headers);
        return;
      }
      if (rest === '/cancel' && method === 'POST') {
        requireRole(user, ['agent', 'dispatcher']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
          const result = await this.cancelMove(user, move, nowMs);
          return { status: 200, body: result.body };
        });
        return;
      }
      if (rest === '/reorder' && method === 'POST') {
        requireRole(user, ['agent']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        const result = await this.reorderMove(user, move, body as Record<string, unknown>, nowMs);
        respond(result.status, result.body);
        return;
      }
      if (rest === '/plan' && method === 'GET') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        if (user.role === 'clerk') { respondError(forbidden()); return; }
        const boardingQuery = query.get('boarding_at');
        const boardingMs = boardingQuery ? portInstantFromApi(boardingQuery) : move.boarding_ms;
        const plan = computePlan({
          draught_mm: move.draught_mm,
          speed_kn: move.speed_kn,
          block_coefficient: move.block_coefficient,
          boardingMs: boardingMs ?? move.boarding_ms,
          tideEventsFor: (date: string) => store.eventsForDate(date),
          tideVersion: store.tideVersion,
        });
        const revision = store.tariffForInstant(boardingMs ?? move.boarding_ms);
        const lines = estimateLines(revision, move.draught_mm, move.gross_tonnage, boardingMs ?? move.boarding_ms);
        respond(200, serializePlan(plan, { tariff_revision: revision.label, lines, total_cents: totalOf(lines) }));
        return;
      }
      if (rest === '/windows' && method === 'GET') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        if (user.role === 'clerk') { respondError(forbidden()); return; }
        const date = query.get('date');
        if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw fieldError({ date: 'A date is required' });
        }
        const windows = this.openWindows(move, date);
        respond(200, { date, tide_version: store.tideVersion, windows });
        return;
      }
      if (rest === '/commit' && method === 'POST') {
        requireRole(user, ['dispatcher']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        const result = await this.commitWindow(user, move, req, body as Record<string, unknown>, nowMs);
        respond(result.status, result.body, result.headers);
        return;
      }
      if (rest === '/eligibility' && method === 'GET') {
        requireRole(user, ['dispatcher']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move) { respondError(notFound()); return; }
        respond(200, this.eligibility(move, user, nowMs));
        return;
      }
      if (rest === '/assignment' && method === 'POST') {
        requireRole(user, ['dispatcher']);
        const move = store.moves.find((m) => m.ref === ref);
        if (!move) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
          const result = await this.assignPilot(user, move, req, body as Record<string, unknown>, nowMs);
          return { status: result.status, body: result.body };
        });
        return;
      }
      if (rest === '/transitions' && method === 'POST') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        requireRole(user, ['dispatcher', 'pilot']);
        const body = await readJsonBody(req, await readBody(req, 65_536));
        await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
          const result = await this.transition(user, move, body as Record<string, unknown>, nowMs);
          return { status: result.status, body: result.body };
        });
        return;
      }
      if (rest === '/detention' && method === 'POST') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        requireRole(user, ['dispatcher', 'pilot']);
        const body = await readJsonBody(req, await readBody(req, 65_536));
        await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
          const result = await this.detention(user, move, body as Record<string, unknown>, nowMs);
          return { status: result.status, body: result.body };
        });
        return;
      }
      if (rest === '/photos' && method === 'POST') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move) { respondError(notFound()); return; }
        await this.uploadPhoto(user, move, req, res, respond, respondError);
        return;
      }
      if (rest === '/ladder-reports' && method === 'POST') {
        const move = store.moves.find((m) => m.ref === ref);
        if (!move || !moveVisibleTo(store, user, move)) { respondError(notFound()); return; }
        const body = await readJsonBody(req, await readBody(req, 65_536));
        await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
          const result = await this.fileReport(user, move, body as Record<string, unknown>, nowMs);
          return { status: result.status, body: result.body };
        });
        return;
      }
    }

    // ---- photos ----
    const photoContent = /^\/api\/photos\/([^/]+)\/content$/.exec(pathname);
    if (photoContent && method === 'GET') {
      await this.downloadPhoto(user, photoContent[1]!, res, respondError);
      return;
    }

    // ---- ladder reports ----
    const reportMatch = /^\/api\/ladder-reports\/([^/]+)$/.exec(pathname);
    if (reportMatch && method === 'GET') {
      const report = store.ladderReports.find((r) => r.id === reportMatch[1]);
      if (!report || !reportVisibleTo(store, user, report)) { respondError(notFound()); return; }
      respond(200, serializeReport(store, report));
      return;
    }

    // ---- pilot cards ----
    const cardPost = /^\/api\/vessels\/([^/]+)\/pilot-cards$/.exec(pathname);
    if (cardPost && method === 'POST') {
      const vessel = store.vessels.find((v) => v.id === cardPost[1]);
      if (!vessel || !vesselVisibleTo(user, vessel.agency_code)) { respondError(notFound()); return; }
      requireRole(user, ['agent', 'dispatcher']);
      await this.uploadCard(user, vessel, req, res, respond, respondError);
      return;
    }
    const cardContent = /^\/api\/vessels\/([^/]+)\/pilot-cards\/([^/]+)\/content$/.exec(pathname);
    if (cardContent && method === 'GET') {
      const vessel = store.vessels.find((v) => v.id === cardContent[1]);
      if (!vessel) { respondError(notFound()); return; }
      const card = store.pilotCards.find((c) => c.id === cardContent[2] && c.vessel_id === vessel.id);
      if (!card) { respondError(notFound()); return; }
      const mayRead =
        user.role === 'dispatcher' ||
        (user.role === 'agent' && vessel.agency_code === user.agency_code) ||
        (user.role === 'pilot' && store.moves.some((m) => m.vessel_id === vessel.id && m.pilot_id === user.id));
      if (!mayRead) { respondError(notFound()); return; }
      await this.downloadBytes(card.key, card.content_type, res, respondError);
      return;
    }

    // ---- tide ----
    if (method === 'GET' && pathname === '/api/tide') {
      const date = query.get('date') ?? '';
      const events = store.eventsForDate(date);
      respond(200, {
        date, version: store.tideVersion,
        events: events.map((e) => ({ at: e.at, type: e.type, height_mm: e.height_mm })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/tide-revisions') {
      requireRole(user, ['dispatcher']);
      const body = await readJsonBody(req, await readBody(req, 65_536));
      const result = await this.publishTideRevision(body as Record<string, unknown>, nowMs);
      respond(result.status, result.body);
      return;
    }

    // ---- pilots ----
    if (method === 'GET' && pathname === '/api/pilots') {
      requireRole(user, ['dispatcher']);
      const rows = store.pilotOrder.map((id, index) => {
        const pilot = store.pilots.find((p) => p.id === id)!;
        return { id: pilot.id, name: pilot.name, licence_class: pilot.licence_class, position: index + 1 };
      });
      respond(200, { pilots: rows });
      return;
    }

    if (method === 'GET' && pathname === '/api/me/next-job') {
      requireRole(user, ['pilot']);
      const moves = store.moves
        .filter((m) => m.pilot_id === user.id)
        .filter((m) => m.status === 'Pilot assigned' || m.status === 'Pilot away' || m.status === 'On board')
        .sort((a, b) => a.boarding_ms - b.boarding_ms);
      const move = moves[0];
      if (!move) { respond(200, { move: null, plan: null }); return; }
      const plan = computePlan({
        draught_mm: move.draught_mm,
        speed_kn: move.speed_kn,
        block_coefficient: move.block_coefficient,
        boardingMs: move.boarding_ms,
        tideEventsFor: (date: string) => store.eventsForDate(date),
        tideVersion: store.tideVersion,
      });
      const revision = store.tariffForInstant(move.boarding_ms);
      const lines = estimateLines(revision, move.draught_mm, move.gross_tonnage, move.boarding_ms);
      respond(200, {
        move: serializeMove(store, move, user, nowMs),
        plan: serializePlan(plan, { tariff_revision: revision.label, lines, total_cents: totalOf(lines) }),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/skips') {
      requireRole(user, ['dispatcher']);
      respond(200, {
        skips: store.skips.map((s) => ({
          pilot_id: s.pilot_id, reasons: s.reasons, move_ref: s.move_ref,
          at: formatPortStamp(s.at_ms),
        })),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/overrides') {
      requireRole(user, ['dispatcher']);
      respond(200, {
        overrides: store.overrides.map((o) => ({
          id: o.id, move_ref: o.move_ref, pilot_id: o.pilot_id,
          reason: o.reason, by: o.by, at: formatPortStamp(o.at_ms),
        })),
      });
      return;
    }
    const overrideOne = /^\/api\/overrides\/([^/]+)$/.exec(pathname);
    if (overrideOne && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      respondError(new ApiError(405, 'method_not_allowed', 'Method not allowed'));
      return;
    }

    // ---- tariff revisions ----
    if (method === 'GET' && pathname === '/api/tariff-revisions') {
      const revisions = [...store.tariffRevisions]
        .sort((a, b) => a.effective_ms - b.effective_ms)
        .map((r) => {
          const body = JSON.parse(r.body) as TariffBody;
          const moves = store.moves
            .filter((m) => moveVisibleTo(store, user, m))
            .filter((m) => m.billing_events.some((e) => e.lines.some((l) => l.tariff_revision === r.label)))
            .map((m) => m.ref);
          return {
            id: r.id,
            label: body.label,
            effective_at: body.effective_at,
            draft_foot_cents: body.draft_foot_cents,
            minimum_cents: body.minimum_cents,
            tonnage_bands: body.tonnage_bands,
            night_percent: body.night_percent,
            detention_half_hour_cents: body.detention_half_hour_cents,
            detention_allowance_half_hours: body.detention_allowance_half_hours,
            cancellation_cents: body.cancellation_cents,
            moves,
          };
        });
      respond(200, { revisions });
      return;
    }

    if (method === 'POST' && pathname === '/api/tariff-revisions') {
      requireRole(user, ['clerk']);
      const body = await readJsonBody(req, await readBody(req, 65_536));
      const result = await this.publishTariffRevision(body as Record<string, unknown>, nowMs);
      respond(result.status, result.body);
      return;
    }

    // ---- invoices ----
    if (method === 'GET' && pathname === '/api/invoices') {
      requireRole(user, ['clerk', 'agent']);
      const invoices = store.invoices
        .filter((i) => invoiceVisibleTo(user, i))
        .map(serializeInvoice);
      respond(200, { invoices });
      return;
    }
    const invoiceOne = /^\/api\/invoices\/([^/]+)$/.exec(pathname);
    if (invoiceOne && method === 'GET') {
      requireRole(user, ['clerk', 'agent']);
      const invoice = store.invoices.find((i) => i.id === invoiceOne[1]);
      if (!invoice || !invoiceVisibleTo(user, invoice)) { respondError(notFound()); return; }
      respond(200, serializeInvoice(invoice));
      return;
    }
    const invoiceIssue = /^\/api\/invoices\/([^/]+)\/issue$/.exec(pathname);
    if (invoiceIssue && method === 'POST') {
      requireRole(user, ['clerk']);
      const invoice = store.invoices.find((i) => i.id === invoiceIssue[1]);
      if (!invoice) { respondError(notFound()); return; }
      const raw = await readBody(req, 65_536);
      const body = raw === null ? {} : JSON.parse(raw.toString('utf8') || '{}') as unknown;
      await this.withKeyed(req, user, method, pathname, key, body, respond, respondError, async () => {
        const result = await this.issueInvoice(invoice);
        return { status: result.status, body: result.body };
      });
      return;
    }

    respondError(notFound());
  }

  // ---- helpers -----------------------------------------------------------
  private userOf(req: IncomingMessage): User | null {
    const token = sessionTokenOf(req);
    if (!token) return null;
    const session = this.env.store.sessions.find((s) => s.token === token);
    if (!session) return null;
    return this.env.store.users.find((u) => u.id === session.user_id) ?? null;
  }

  private async servicesState(): Promise<{ billing: string; storage: string; mail: string }> {
    const state = await this.env.servicesState();
    return { billing: state.billing, storage: state.storage, mail: state.mail };
  }

  private actions(): Actions {
    return new Actions(this.env);
  }

  private async planFromBody(body: Record<string, unknown>, nowMs: number, store: Store): Promise<unknown> {
    const actions = this.actions();
    const result = await actions.planFromBody(body);
    void nowMs;
    void store;
    return result;
  }

  private async createMove(user: User, body: Record<string, unknown>, nowMs: number): Promise<MoveRecord> {
    void nowMs;
    return this.actions().createMove(user, body);
  }

  private async patchMove(user: User, move: MoveRecord, req: IncomingMessage, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
    const outcome = await this.actions().patchMove(user, move, ifMatchOf(req), body);
    void nowMs;
    return { status: outcome.status, body: outcome.body, headers: {} };
  }

  private async cancelMove(user: User, move: MoveRecord, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().cancelMove(user, move);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  private async reorderMove(user: User, move: MoveRecord, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().reorderMove(user, move, body);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  private async commitWindow(user: User, move: MoveRecord, req: IncomingMessage, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
    const outcome = await this.actions().commitWindow(user, move, ifMatchOf(req), body);
    void nowMs;
    return { status: outcome.status, body: outcome.body, headers: {} };
  }

  private eligibility(move: MoveRecord, user: User, nowMs: number): unknown {
    void user;
    void nowMs;
    return this.actions().eligibility(move);
  }

  private async assignPilot(user: User, move: MoveRecord, req: IncomingMessage, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().assignPilot(user, move, ifMatchOf(req), body);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  private async transition(user: User, move: MoveRecord, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().transition(user, move, body);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  private async detention(user: User, move: MoveRecord, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().detention(user, move, body);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  private async fileReport(user: User, move: MoveRecord, body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const outcome = await this.actions().fileReport(user, move, body);
    void nowMs;
    return { status: outcome.status, body: outcome.body };
  }

  // The open boarding windows for a move and day, in 5-minute port-time steps
  // that skip any hour that does not exist.
  private openWindows(move: MoveRecord, date: string): { from: string; to: string }[] {
    const windows: { from: string; to: string }[] = [];
    for (const step of daySteps(date)) {
      const plan = computePlan({
        draught_mm: move.draught_mm,
        speed_kn: move.speed_kn,
        block_coefficient: move.block_coefficient,
        boardingMs: step,
        tideEventsFor: (d: string) => this.env.store.eventsForDate(d),
        tideVersion: this.env.store.tideVersion,
      });
      const hm = formatPortTime(step);
      if (plan.gateOpen) {
        const last = windows[windows.length - 1];
        // Steps are consecutive among the date's existing steps.
        if (last && step - portInstant(date, last.to)! <= 5 * 60_000) {
          last.to = hm;
        } else {
          windows.push({ from: hm, to: hm });
        }
      }
    }
    return windows;
  }

  // ---- evidence -----------------------------------------------------------
  private async uploadPhoto(user: User, move: MoveRecord, req: IncomingMessage, _res: ServerResponse, respond: (status: number, body: unknown, headers?: Record<string, string>) => void, respondError: (err: ApiError) => void): Promise<void> {
    // Only the assigned pilot or a dispatcher may upload to a move.
    if (!(user.role === 'dispatcher' || (user.role === 'pilot' && move.pilot_id === user.id))) {
      respondError(forbidden());
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '');
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > PHOTO_MAX_BYTES) {
      respondError(new ApiError(413, 'payload_too_large', 'Photo is over 5,000,000 bytes'));
      return;
    }
    const raw = await readBody(req, PHOTO_MAX_BYTES).catch(() => {
      throw new ApiError(413, 'payload_too_large', 'Photo is over 5,000,000 bytes');
    });
    if (raw === null) {
      respondError(fieldError({ photo: 'A photo is required' }));
      return;
    }
    if (raw.length > PHOTO_MAX_BYTES) {
      respondError(new ApiError(413, 'payload_too_large', 'Photo is over 5,000,000 bytes'));
      return;
    }
    const allowedTypes: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const kind = allowedTypes[contentType];
    if (!kind) {
      respondError(new ApiError(415, 'unsupported_media_type', 'Photo is not a JPEG, PNG or WebP image'));
      return;
    }
    if (!signatureMatches(raw, kind)) {
      respondError(new ApiError(415, 'unsupported_media_type', 'File content does not match its type'));
      return;
    }
    const sha256 = sha256Hex(raw);
    const photoId = this.env.store.nextPhotoId();
    const key = `ladder-photos/${photoId}`;
    try {
      await this.env.photoStore.put(key, raw, contentType);
    } catch {
      respondError(new ApiError(503, 'storage_unavailable', 'Evidence store unreachable'));
      return;
    }
    this.env.store.photos.push({
      id: photoId,
      move_ref: move.ref,
      uploader_id: user.id,
      sha256,
      size_bytes: raw.length,
      content_type: contentType,
      key,
      stored: true,
    });
    await this.env.store.save();
    respond(201, { photo_id: photoId, sha256, size_bytes: raw.length, key });
  }

  private async downloadPhoto(user: User, photoId: string, res: ServerResponse, respondError: (err: ApiError) => void): Promise<void> {
    const photo = this.env.store.photos.find((p) => p.id === photoId);
    if (!photo || !photo.stored) {
      respondError(notFound());
      return;
    }
    const claimed = this.env.store.ladderReports.some((r) =>
      r.photos.some((p) => p.photo_id === photoId) && reportVisibleTo(this.env.store, user, r),
    );
    if (!claimed && photo.uploader_id !== user.id) {
      respondError(notFound());
      return;
    }
    await this.downloadBytes(photo.key, photo.content_type, res, respondError);
  }

  private async uploadCard(user: User, vessel: VesselRow, req: IncomingMessage, _res: ServerResponse, respond: (status: number, body: unknown, headers?: Record<string, string>) => void, respondError: (err: ApiError) => void): Promise<void> {
    const contentType = String(req.headers['content-type'] ?? '');
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > CARD_MAX_BYTES) {
      respondError(new ApiError(413, 'payload_too_large', 'Pilot card is over 10,000,000 bytes'));
      return;
    }
    const raw = await readBody(req, CARD_MAX_BYTES).catch(() => {
      throw new ApiError(413, 'payload_too_large', 'Pilot card is over 10,000,000 bytes');
    });
    if (raw === null) {
      respondError(fieldError({ card: 'A pilot card is required' }));
      return;
    }
    if (raw.length > CARD_MAX_BYTES) {
      respondError(new ApiError(413, 'payload_too_large', 'Pilot card is over 10,000,000 bytes'));
      return;
    }
    if (contentType !== 'application/pdf') {
      respondError(new ApiError(415, 'unsupported_media_type', 'Pilot card must be a PDF'));
      return;
    }
    if (!(raw.slice(0, 5).toString('latin1') === '%PDF-')) {
      respondError(new ApiError(415, 'unsupported_media_type', 'File content does not match its type'));
      return;
    }
    const sha256 = sha256Hex(raw);
    const cardId = this.env.store.nextCardId();
    const key = `pilot-cards/${vessel.id}/${cardId}.pdf`;
    try {
      await this.env.photoStore.put(key, raw, 'application/pdf');
    } catch {
      respondError(new ApiError(503, 'storage_unavailable', 'Evidence store unreachable'));
      return;
    }
    this.env.store.pilotCards.push({
      id: cardId,
      vessel_id: vessel.id,
      uploader_id: user.id,
      sha256,
      size_bytes: raw.length,
      content_type: 'application/pdf',
      key,
      at_ms: this.env.now(),
    });
    await this.env.store.save();
    respond(201, { card_id: cardId, sha256, size_bytes: raw.length, key });
  }

  private async downloadBytes(key: string, contentType: string, res: ServerResponse, respondError: (err: ApiError) => void): Promise<void> {
    try {
      const bytes = await this.env.photoStore.get(key);
      res.writeHead(200, {
        'Content-Type': contentType,
        'X-Checksum-Sha256': sha256Hex(bytes),
      });
      res.end(bytes);
    } catch {
      respondError(new ApiError(503, 'storage_unavailable', 'Evidence store unreachable'));
    }
  }

  // ---- tide revisions (DP-16) ----
  private async publishTideRevision(body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const store = this.env.store;
    const date = typeof body.date === 'string' ? body.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw fieldError({ date: 'A date is required' });
    }
    const events = Array.isArray(body.events) ? body.events as unknown[] : [];
    if (events.length < 2 || events.length > 6) {
      throw fieldError({ events: 'A tide revision needs 2 to 6 events' });
    }
    const parsed: { at: string; type: 'high' | 'low'; height_mm: number }[] = [];
    for (const event of events) {
      const row = (event ?? {}) as Record<string, unknown>;
      const at = typeof row.at === 'string' ? row.at : '';
      const type = row.type === 'high' ? 'high' : row.type === 'low' ? 'low' : null;
      const height = Number(row.height_mm);
      if (!/^\d{2}:\d{2}$/.test(at) || type === null || !Number.isFinite(height)) {
        throw fieldError({ events: 'Each event needs a time, a type and a height' });
      }
      if (portInstant(date, at) === null) {
        throw fieldError({ events: 'That time does not exist in port time on this date' });
      }
      parsed.push({ at, type, height_mm: height });
    }
    for (let i = 0; i < parsed.length - 1; i++) {
      if (parsed[i]!.type === parsed[i + 1]!.type) {
        throw fieldError({ events: 'Events must alternate between high and low water' });
      }
    }
    const existing = store.tideRevisions.find((r) => r.date === date);
    const version = store.tideVersion + 1;
    if (existing) {
      existing.events = JSON.stringify(parsed);
      existing.version = version;
    } else {
      store.tideRevisions.push({ date, events: JSON.stringify(parsed), version });
    }
    store.tideVersion = version;

    // Each committed or assigned move is recomputed at its committed time.
    const returned: string[] = [];
    for (const move of store.moves) {
      if (move.status !== 'Window committed' && move.status !== 'Pilot assigned') continue;
      const plan = computePlan({
        draught_mm: move.draught_mm,
        speed_kn: move.speed_kn,
        block_coefficient: move.block_coefficient,
        boardingMs: move.committed?.boarding_ms ?? move.boarding_ms,
        tideEventsFor: (d: string) => store.eventsForDate(d),
        tideVersion: version,
      });
      if (plan.gateOpen) {
        if (move.committed) {
          move.committed.pinch_waypoint = plan.waypoints.find((w) => w.pinch)!.name;
          move.committed.margin_mm = plan.pinchMarginMm;
          move.committed.tide_version = version;
        }
      } else {
        if (move.pilot_id) {
          const pilot = store.pilots.find((pl) => pl.id === move.pilot_id)!;
          const notice = makeNotice(
            move, 'Assignment withdrawn', pilot.email,
            `Assignment withdrawn: ${store.vessels.find((v) => v.id === move.vessel_id)!.name}`,
            `Vessel: ${store.vessels.find((v) => v.id === move.vessel_id)!.name}\nBoarding: ${formatPortDateTimeSpace(move.boarding_ms)} port time`,
          );
          enqueueNotice(store, move, notice);
          store.pilotOrder = [move.pilot_id, ...store.pilotOrder.filter((id) => id !== move.pilot_id)];
          move.pilot_id = null;
        }
        move.committed = null;
        move.status = 'Ordered';
        store.addHistory(move, 'Ordered', 'slackwater');
        const vessel = store.vessels.find((v) => v.id === move.vessel_id)!;
        const agent = store.users.find((u) => u.role === 'agent' && u.agency_code === move.agency_code)!;
        const amended = makeNotice(
          move, 'Order amended', agent.email,
          `Pilot order amended: ${vessel.name}`,
          `Vessel: ${vessel.name}\nBoarding: ${formatPortDateTimeSpace(move.boarding_ms)} port time\nStatus: ${move.status}`,
        );
        enqueueNotice(store, move, amended);
        returned.push(move.ref);
      }
    }
    void nowMs;
    await store.save();
    await this.env.runPendingDue();
    return { status: 201, body: { version, returned_to_ordered: returned } };
  }

  // ---- tariff revisions (DP-41, DP-44) ----
  private async publishTariffRevision(body: Record<string, unknown>, nowMs: number): Promise<{ status: number; body: unknown }> {
    const store = this.env.store;
    const errors: Record<string, string> = {};
    const label = typeof body.label === 'string' ? body.label : '';
    if (label.length < 1 || label.length > 40 || /[\r\n]/.test(label)) {
      errors.label = 'Label must be one line of 1 to 40 characters';
    }
    const effectiveAt = typeof body.effective_at === 'string' ? body.effective_at : '';
    let effectiveMs: number | null = null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(effectiveAt)) {
      effectiveMs = portInstant(effectiveAt.slice(0, 10), effectiveAt.slice(11, 16));
    }
    // A taken effective time is a state conflict, decided before validation.
    if (effectiveMs !== null && store.tariffRevisions.some((r) => r.effective_ms === effectiveMs)) {
      throw new ApiError(409, 'effective_time_taken', 'That effective time is taken');
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(effectiveAt)) {
      errors.effective_at = 'An effective time is required';
    } else {
      if (effectiveMs === null || effectiveMs <= nowMs) {
        errors.effective_at = 'The effective time must be later than now';
      }
    }
    const draftFoot = nonNegativeWhole(body.draft_foot_cents);
    const minimum = nonNegativeWhole(body.minimum_cents);
    const detentionHalfHour = nonNegativeWhole(body.detention_half_hour_cents);
    const cancellation = nonNegativeWhole(body.cancellation_cents);
    const allowance = nonNegativeWhole(body.detention_allowance_half_hours);
    const nightPercent = wholeBetween(body.night_percent, 0, 100);
    const bands = Array.isArray(body.tonnage_bands) ? body.tonnage_bands as unknown[] : [];
    const parsedBands: { from_gt: number; to_gt: number | null; cents: number }[] = [];
    for (let i = 0; i < bands.length; i++) {
      const row = (bands[i] ?? {}) as Record<string, unknown>;
      const from = Number(row.from_gt);
      const to = row.to_gt === null ? null : Number(row.to_gt);
      const cents = nonNegativeWhole(row.cents);
      if (!Number.isInteger(from) || from < 0) errors.tonnage_bands = 'Tonnage bands must be whole gross tons';
      else if (to !== null && (!Number.isInteger(to) || to < from)) errors.tonnage_bands = 'Tonnage band bounds must rise';
      else if (i > 0 && from !== (parsedBands[i - 1]!.to_gt ?? -1) + 1) errors.tonnage_bands = 'Tonnage bands must be consecutive';
      else parsedBands.push({ from_gt: from, to_gt: to, cents });
    }
    if (bands.length === 0) errors.tonnage_bands = 'At least one tonnage band is required';
    if (parsedBands.length > 0 && parsedBands[parsedBands.length - 1]!.to_gt !== null) {
      errors.tonnage_bands = 'Only the last band may have no upper limit';
    }
    if (parsedBands.length > 0 && parsedBands[0]!.from_gt !== 0) {
      errors.tonnage_bands = 'The first band must start at 0';
    }
    if (Object.keys(errors).length > 0) throw fieldError(errors);
    if (effectiveMs === null) throw new ApiError(422, 'validation_failed', 'Some fields need attention', errors);

    const revisionBody = JSON.stringify({
      label, effective_at: effectiveAt,
      draft_foot_cents: draftFoot, minimum_cents: minimum,
      tonnage_bands: parsedBands, night_percent: nightPercent,
      detention_half_hour_cents: detentionHalfHour,
      detention_allowance_half_hours: allowance,
      cancellation_cents: cancellation,
    });
    store.tariffRevisions.push({
      id: `TR-${store.tariffRevisions.length + 1}`,
      label,
      effective_at: effectiveAt,
      effective_ms: effectiveMs,
      body: revisionBody,
    });
    await store.save();
    return { status: 201, body: JSON.parse(revisionBody) };
  }

  // ---- invoices (DP-46 to DP-48) ----
  private async issueInvoice(invoice: InvoiceRecord): Promise<{ status: number; body: unknown }> {
    if (invoice.state === 'issued') {
      return { status: 200, body: serializeInvoice(invoice) };
    }
    const step = this.env.store.pendingSteps.find(
      (s) => s.kind === 'invoice_commit' && s.payload.includes(invoice.id) && s.state === 'pending',
    );
    if (!step) {
      this.env.store.pendingSteps.push({
        id: `PS-${this.env.store.pendingSteps.length + 1}-${this.env.now()}`,
        kind: 'invoice_commit',
        payload: JSON.stringify({ invoice_id: invoice.id }),
        state: 'pending',
        attempts: 0,
        attempt_token: null,
        at_ms: this.env.now(),
      });
      await this.env.store.save();
    }
    await this.env.runPendingDue();
    const fresh = this.env.store.invoices.find((i) => i.id === invoice.id)!;
    if (fresh.state === 'issued') {
      return { status: 200, body: serializeInvoice(fresh) };
    }
    return { status: 202, body: serializeInvoice(fresh) };
  }

  private async withKeyed(
    _req: IncomingMessage,
    user: User,
    method: string,
    pathname: string,
    key: string | null,
    body: unknown,
    respond: (status: number, body: unknown, headers?: Record<string, string>) => void,
    respondError: (err: ApiError) => void,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<void> {
    const outcome = await beginKeyed(this.env.store, user, method, pathname, key, body);
    if (outcome.replay) {
      respond(outcome.replay.status, outcome.replay.body);
      return;
    }
    try {
      const result = await run();
      const payload = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      await finishKeyed(this.env.store, user, method, pathname, key, body, result.status, payload);
      respond(result.status, result.body);
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = JSON.stringify(errorBody(err));
        await finishKeyed(this.env.store, user, method, pathname, key, body, err.status, payload);
        respondError(err);
      } else {
        throw err;
      }
    }
  }
}

function idempotencyKeyOf(req: IncomingMessage): string | null {
  const value = req.headers['idempotency-key'];
  if (typeof value === 'string' && value !== '') return value;
  return null;
}

function ifMatchOf(req: IncomingMessage): string | null {
  const value = req.headers['if-match'];
  return typeof value === 'string' ? value : null;
}

function sessionTokenOf(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'slackwater_session') return rest.join('=');
  }
  return null;
}

function publicUser(user: User): { id: string; name: string; role: string; agency_code: string | null } {
  return { id: user.id, name: user.name, role: user.role, agency_code: user.agency_code };
}

function badBody(): ApiError {
  return new ApiError(422, 'validation_failed', 'Body required', {});
}

function unsupportedType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'Unsupported content type');
}

function matchesSearch(store: Store, move: { ref: string; status: string; vessel_id: string }, q: string): boolean {
  const vessel = store.vessels.find((v) => v.id === move.vessel_id);
  const haystack = `${move.ref} ${vessel?.name ?? ''} ${move.status}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((term) => term === '' || haystack.includes(term));
}

function nonNegativeWhole(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

function wholeBetween(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return min;
  return n;
}
