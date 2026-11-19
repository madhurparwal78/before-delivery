import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Db } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { seedIfEmpty } from './seed.js';
import { Store, type CohortContext, type CoachContext, type EnrolmentContext, type EnrolmentRowAlias } from './store.js';
import { KillBillClient } from './killbill.js';
import { MinioClient } from './minio.js';
import { Mailer } from './mailer.js';
import { CohortLocks } from './locks.js';
import { ApiError, billingUnavailable, fail, illegalTransition, MESSAGES, notFound, paymentDeclined, forbidden, unauthenticated, validation } from '../shared/errors.js';
import { bodyToObject, cookieHeader, crossOrigin, hasBody, isJsonType, ownOriginOf, parseCookies, readBody, sendError, sendJson, type Ctx } from './http.js';
import { JSON_MAX_BYTES, MEMO_MAX_BYTES, memoTypeOf, signatureMatches } from '../shared/memos.js';
import { isUuid } from '../shared/chars.js';
import { landingFor } from '../shared/landing.js';
import { derivedNightKey, nightNumberFor, wakeAlarmFor, snapshotFor, TECHNIQUE_NIGHT } from '../shared/nights.js';
import { validateCohort, validateEnrolment, validateEntry, validateSettings, validateSignShape } from '../shared/validation.js';
import { formatInstantUTC } from '../shared/timezones.js';
import { ZONE_LIST } from './zones.js';
import type { Cohort, Entry, RosterRow, SessionPayload, Sign } from '../shared/domain.js';

interface SignRow {
  id: string;
  entry_id: string;
  start_offset: number;
  end_offset: number;
  phrase: string;
  category: string;
  night_key: string;
}

interface Env {
  DATABASE_URL: string;
  KILLBILL_URL: string;
  KILLBILL_USERNAME: string;
  KILLBILL_PASSWORD: string;
  KILLBILL_API_KEY: string;
  KILLBILL_API_SECRET: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_FORCE_PATH_STYLE: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  MAIL_FROM: string;
  APP_PUBLIC_PORT: string;
}

const PORT = Number(process.env['APP_PUBLIC_PORT'] ?? '4173');

export class App {
  private readonly db: Db;
  private readonly store: Store;
  private readonly killbill: KillBillClient;
  private readonly minio: MinioClient;
  private readonly mailer: Mailer;
  private readonly mailFrom: string;
  private distDir: string;
  private readonly seatLocks = new CohortLocks();
  private readonly refundLocks = new CohortLocks();

  constructor(env: Env) {
    this.db = new Db(env.DATABASE_URL);
    this.store = new Store(this.db);
    this.killbill = new KillBillClient(env.KILLBILL_URL, env.KILLBILL_USERNAME, env.KILLBILL_PASSWORD, env.KILLBILL_API_KEY, env.KILLBILL_API_SECRET);
    this.minio = new MinioClient(env.S3_ENDPOINT, env.S3_REGION, env.S3_BUCKET, env.S3_FORCE_PATH_STYLE === 'true', env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY);
    this.mailer = new Mailer(env.SMTP_HOST, Number(env.SMTP_PORT));
    this.mailFrom = env.MAIL_FROM;
    this.distDir = join(process.cwd(), 'dist');
  }

  async start(): Promise<void> {
    // Retry Postgres for up to 60 seconds before listening.
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        await this.db.query('SELECT 1');
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    await this.applySchema();
    await seedIfEmpty(this.db, { wrenCode: 'coach-wren-4417', tobiasCode: 'coach-tobias-2290' });
    this.startReceiptRetry();
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof ApiError) {
          sendError(res, err);
          return;
        }
        sendError(res, fail(500, { error: 'internal' }));
      });
    });
    server.listen(PORT, '0.0.0.0');
  }

  private async applySchema(): Promise<void> {
    await this.db.exec(SCHEMA_SQL);
  }

  private startReceiptRetry(): void {
    setInterval(() => {
      void this.retryPendingReceipts().catch(() => undefined);
    }, 30_000).unref();
  }

  private async retryPendingReceipts(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM enrollments WHERE status = 'active' AND receipt_status = 'pending'`);
    for (const row of rows) {
      try {
        await this.sendReceipt(row.id);
      } catch {
        // keep pending; retried on the next tick
      }
    }
  }

  // ---------------- request handling ----------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
    const path = url.pathname;
    const query = url.searchParams;
    const ownOrigin = ownOriginOf(req);
    const cookies = parseCookies(req.headers['cookie']);

    const ctx: Ctx = { req, res, method, path, query, cookies, body: undefined, memoBody: undefined, ownOrigin };

    if (path === '/api/health' && method === 'GET') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (path.startsWith('/api/')) {
      await this.routeApi(ctx);
      return;
    }

    await this.serveStatic(ctx);
  }

  // ---------------- static files and screens ----------------

  private async serveStatic(ctx: Ctx): Promise<void> {
    const { res, path } = ctx;
    const screens = ['/', '/logbook', '/coach', '/signin', '/enroll', '/enrollments'];
    const isScreen = screens.some((s) => path === s || (s !== '/' && path.startsWith(s + '/')));
    let file: string;
    if (isScreen || path === '/index.html') {
      file = 'index.html';
    } else if (path.startsWith('/assets/')) {
      file = path.slice(1);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(notFoundPage());
      return;
    }
    try {
      const body = await readFile(join(this.distDir, file));
      const type = contentTypeFor(file);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(notFoundPage());
    }
  }

  // ---------------- API routing ----------------

  private async routeApi(ctx: Ctx): Promise<void> {
    const { path, method } = ctx;
    const seg = path.split('/').filter((s) => s !== '').slice(1);

    // ladder rungs 1-4 for body-carrying requests
    if (method !== 'GET' && method !== 'HEAD') {
      if (crossOrigin(ctx.req, ctx.ownOrigin)) {
        throw fail(403, { error: 'cross_origin' });
      }
    }

    const isMemoUpload = path.endsWith('/memo') && method === 'PUT';
    const jsonBody = !isMemoUpload && method !== 'GET' && method !== 'HEAD';

    if (isMemoUpload) {
      const contentType = ctx.req.headers['content-type'];
      if (memoTypeOf(contentType ?? '') === null) {
        throw fail(415, { error: 'unsupported_media_type' });
      }
      const raw = await readBody(ctx.req, MEMO_MAX_BYTES);
      ctx.memoBody = raw;
      // memo endpoints parse no JSON body
    } else if (jsonBody) {
      const hasBodyNow = hasBody(ctx.req);
      if (hasBodyNow) {
        const raw = await readBody(ctx.req, JSON_MAX_BYTES);
        if (!isJsonType(ctx.req.headers['content-type'])) {
          throw fail(415, { error: 'unsupported_media_type' });
        }
        let parsed: unknown;
        try {
          parsed = raw.length === 0 ? {} : JSON.parse(raw.toString('utf8'));
        } catch {
          throw fail(400, { error: 'invalid_json' });
        }
        ctx.body = parsed;
      }
    }

    await this.dispatch(ctx, seg);
  }

  private async dispatch(ctx: Ctx, seg: readonly string[]): Promise<void> {
    const { method } = ctx;
    const [a, b, c, d] = seg;

    // public
    if (a === 'time-zones' && method === 'GET') return this.timeZones(ctx);
    if (a === 'cohorts' && method === 'GET' && b === undefined) return this.listCohorts(ctx);
    if (a === 'cohorts' && method === 'GET' && b !== undefined && c === undefined) return this.getCohort(ctx, b);
    if (a === 'enrollments' && method === 'POST' && b === undefined) return this.createEnrollment(ctx);
    if (a === 'enrollments' && method === 'GET' && b !== undefined && c === undefined) return this.getEnrollment(ctx, b);
    if (a === 'enrollments' && b !== undefined && c === 'pay' && method === 'POST') return this.pay(ctx, b);
    if (a === 'session' && method === 'POST' && b === undefined) return this.signIn(ctx);
    if (a === 'session' && method === 'GET' && b === undefined) return this.getSession(ctx);
    if (a === 'session' && method === 'DELETE' && b === undefined) return this.signOut(ctx);
    if (a === 'landing' && method === 'GET') return this.landing(ctx);

    // dreamer
    if (a === 'me') {
      const session = await this.requireRole(ctx, 'dreamer');
      if (b === 'night' && method === 'GET' && c === undefined) return this.nightEndpoint(ctx, session);
      if (b === 'settings' && method === 'PATCH' && c === undefined) return this.patchSettings(ctx, session);
      if (b === 'entries' && method === 'GET' && c === undefined) return this.listEntries(ctx, session);
      if (b === 'entries' && c !== undefined && d === undefined && method === 'PUT') return this.saveEntry(ctx, session, c);
      if (b === 'entries' && c !== undefined && d === 'share' && method === 'PUT') return this.shareEntry(ctx, session, c);
      if (b === 'entries' && c !== undefined && d === 'memo' && method === 'PUT') return this.uploadMemo(ctx, session, c);
      if (b === 'entries' && c !== undefined && d === 'memo' && method === 'GET') return this.fetchMemo(ctx, session, c, null);
      if (b === 'entries' && c !== undefined && d === 'signs' && method === 'POST') return this.createSign(ctx, session, c);
      if (b === 'dreamscape' && method === 'GET' && c === undefined) return this.dreamscape(ctx, session);
      if (b === 'reality-checks' && method === 'POST' && c === undefined) return this.createRealityCheck(ctx, session);
      throw notFound();
    }

    // coach
    if (a === 'coach') {
      const session = await this.requireRole(ctx, 'coach');
      if (b === 'cohorts' && method === 'GET' && c === undefined) return this.coachCohorts(ctx, session);
      if (b === 'cohorts' && method === 'POST' && c === undefined) return this.createCohort(ctx, session);
      if (b === 'cohorts' && c !== undefined && d === 'publish' && method === 'POST') return this.publishCohort(ctx, session, c);
      if (b === 'cohorts' && c !== undefined && d === 'close' && method === 'POST') return this.closeCohort(ctx, session, c);
      if (b === 'cohorts' && c !== undefined && d === 'roster' && method === 'GET') return this.roster(ctx, session, c);
      if (b === 'cohorts' && c !== undefined && d === 'digest' && method === 'POST') return this.digest(ctx, session, c);
      if (b === 'cohorts' && c !== undefined && d === 'shared' && seg.length === 6 && seg[5] === 'memo' && method === 'GET') {
        return this.coachMemo(ctx, session, c, seg[4] as string);
      }
      if (b === 'enrollments' && c !== undefined && d === 'refund' && method === 'POST') return this.refund(ctx, session, c);
      throw notFound();
    }

    throw notFound();
  }

  private async requireRole(ctx: Ctx, role: 'dreamer' | 'coach'): Promise<SessionPayload> {
    const token = ctx.cookies['lf_session'] ?? '';
    const session = token === '' ? null : await this.store.sessionByToken(token);
    if (session === null) throw unauthenticated();
    if (session.role !== role) throw forbidden();
    return session;
  }

  // ---------------- public endpoints ----------------

  private async timeZones(ctx: Ctx): Promise<void> {
    sendJson(ctx.res, 200, { zones: ZONE_LIST });
  }

  private async listCohorts(ctx: Ctx): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT co.id FROM cohorts co JOIN coaches ca ON ca.id = co.coach_id WHERE co.published = TRUE ORDER BY co.starts_on, co.name`,
    );
    const out: Cohort[] = [];
    for (const row of rows) {
      const cohort = await this.store.cohortOf(row.id);
      if (!cohort) continue;
      const coach = await this.store.coachOf(cohort.coach_id);
      if (!coach) continue;
      const today = this.store.todayFor(coach ? coach.time_zone : 'UTC');
      const { phase } = this.store.phaseOf(cohort, today);
      if (phase !== 'enrolling' && phase !== 'baseline') continue;
      out.push(await this.store.cohortProjection(cohort, coach.name, await this.store.activeCount(cohort.id)));
    }
    sendJson(ctx.res, 200, { cohorts: out });
  }

  private async getCohort(ctx: Ctx, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const cohort = await this.store.cohortOf(id);
    if (!cohort || !cohort.published) throw notFound();
    const coach = await this.store.coachOf(cohort.coach_id);
    if (!coach) throw notFound();
    sendJson(ctx.res, 200, { cohort: await this.store.cohortProjection(cohort, coach.name, await this.store.activeCount(cohort.id)) });
  }

  private async createEnrollment(ctx: Ctx): Promise<void> {
    const body = bodyToObject(ctx.body);
    const cohortId = typeof body['cohort_id'] === 'string' ? body['cohort_id'] : '';
    if (!isUuid(cohortId)) throw notFound();
    const cohort = await this.store.cohortOf(cohortId);
    if (!cohort || !cohort.published) throw notFound();
    const coach = await this.store.coachOf(cohort.coach_id);
    if (!coach) throw notFound();
    const today = this.store.todayFor(coach.time_zone);
    const { phase } = this.store.phaseOf(cohort, today);
    if (phase === 'technique' || phase === 'closed') throw fail(409, { error: 'enrollment_closed' });
    const email = typeof body['email'] === 'string' ? body['email'] : '';
    const existing = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments WHERE cohort_id = $1 AND lower(email) = lower($2) AND status IN ('pending_payment','active')`,
      [cohortId, email],
    );
    if (Number(existing[0]?.n ?? 0) > 0) throw fail(409, { error: 'already_enrolled' });
    const result = validateEnrolment(body);
    if ('errors' in result) throw validation(result.errors);
    const id = randomUUID();
    const accessCode = accessCodeNew();
    await this.db.exec(
      `INSERT INTO enrollments (id, cohort_id, name, email, status, price_cents, home_tz, bedtime, receipt_status, access_code, paid_via_killbill)
       VALUES ($1,$2,$3,$4,'pending_payment',$5,$6,$7,'none',$8,FALSE)`,
      [id, cohortId, result.fields.name, result.fields.email, cohort.price_cents, result.fields.home_tz, result.fields.bedtime, accessCode],
    );
    const enrolment = await this.store.enrolmentOf(id);
    if (!enrolment) throw notFound();
    sendJson(ctx.res, 201, { enrollment: enrolmentProjection(enrolment), access_code: accessCode });
  }

  private async getEnrollment(ctx: Ctx, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const enrolment = await this.store.enrolmentOf(id);
    if (!enrolment) throw notFound();
    sendJson(ctx.res, 200, { enrollment: enrolmentProjection(enrolment) });
  }

  // ---------------- paying ----------------

  private async pay(ctx: Ctx, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const enrolment = await this.store.enrolmentOf(id);
    if (!enrolment) throw notFound();
    // 1. active replay
    if (enrolment.status === 'active') {
      sendJson(ctx.res, 200, { enrollment: enrolmentProjection(enrolment) });
      return;
    }
    // 2. refunded
    if (enrolment.status === 'refunded') throw illegalTransition('refunded', 'active');
    // 3. cohort phase
    const cohort = await this.store.cohortOf(enrolment.cohort_id);
    if (!cohort) throw notFound();
    const coach = await this.store.coachOf(cohort.coach_id);
    if (!coach) throw notFound();
    const today = this.store.todayFor(coach.time_zone);
    const { phase } = this.store.phaseOf(cohort, today);
    if (phase === 'technique' || phase === 'closed') throw fail(409, { error: 'enrollment_closed' });
    // 4+5. seat check, Kill Bill and activation as one step held per cohort
    const dollars = cohort.price_cents / 100;
    const outcome = await this.seatLocks.run(cohort.id, () => this.takeSeatAndCharge(enrolment, cohort, dollars));
    if ('error' in outcome) throw outcome.error;
    sendJson(ctx.res, 200, { enrollment: enrolmentProjection(outcome.enrolment) });
  }

  private async takeSeatAndCharge(
    enrolment: EnrolmentContext,
    cohort: CohortContext,
    dollars: number,
  ): Promise<{ enrolment: EnrolmentContext } | { error: ApiError }> {
    // seat check under the cohort lock, held until activation completes
    const activeNow = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments WHERE cohort_id = $1 AND status = 'active'`,
      [cohort.id],
    );
    if (cohort.seats - Number(activeNow[0]?.n ?? 0) <= 0) {
      return { error: fail(409, { error: 'cohort_full' }) };
    }
    // 5. Kill Bill
    const account = await this.killbill.ensureAccount(enrolment.id, enrolment.name, enrolment.email);
    const method = await this.killbill.ensurePaymentMethod(account.accountId);
    const payments = await this.killbill.paymentsFor(account.accountId, enrolment.id);
    const payment = payments[0];
    let hadSuccess = false;
    if (payment) {
      const success = payment.transactions.find((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS');
      if (success) hadSuccess = true;
    }
    if (!hadSuccess) {
      const txn = await this.killbill.createPurchase(account.accountId, method, enrolment.id, `${enrolment.id}-purchase`, dollars);
      if (txn.status !== 'SUCCESS') {
        return { error: paymentDeclined() };
      }
    }
    // activation: first night is the later of starts_on and the current night key
    const latest = await this.store.latestNightKey(enrolment.id);
    const snap = snapshotFor(new Date(), enrolment.home_tz, enrolment.bedtime, null, latest);
    const firstNight = snap.night_key > cohort.starts_on ? snap.night_key : cohort.starts_on;
    await this.db.transactionRetry(async (client) => {
      await client.query(`UPDATE enrollments SET status = 'active', first_night = $2, paid_via_killbill = TRUE, receipt_status = 'pending' WHERE id = $1 AND status = 'pending_payment'`, [enrolment.id, firstNight]);
    });
    await this.sendReceipt(enrolment.id).catch(() => undefined);
    const fresh = await this.store.enrolmentOf(enrolment.id);
    if (!fresh) return { error: notFound() };
    return { enrolment: fresh };
  }

  private async sendReceipt(enrolmentId: string): Promise<void> {
    const enrolment = await this.store.enrolmentOf(enrolmentId);
    if (!enrolment || enrolment.status !== 'active' || enrolment.receipt_status === 'sent') return;
    const cohort = await this.store.cohortOf(enrolment.cohort_id);
    if (!cohort) return;
    const body = [
      `Cohort: ${cohort.name}`,
      `First night: ${enrolment.first_night ?? ''}`,
      `Bedtime: ${enrolment.bedtime}`,
      `Wake alarm: ${wakeAlarmFor(enrolment.bedtime)}`,
      `Amount paid: $${(enrolment.price_cents / 100).toFixed(2)}`,
      `Enrollment: ${enrolment.id}`,
      `Access code: ${enrolment.access_code}`,
    ].join('\n');
    await this.mailer.send({
      from: this.mailFrom,
      to: enrolment.email,
      subject: `Your Lanternfish seat in ${cohort.name} is confirmed`,
      body,
    });
    await this.db.exec(`UPDATE enrollments SET receipt_status = 'sent' WHERE id = $1`, [enrolmentId]);
  }

  // ---------------- sessions ----------------

  private async signIn(ctx: Ctx): Promise<void> {
    const body = bodyToObject(ctx.body);
    const code = typeof body['access_code'] === 'string' ? body['access_code'] : '';
    if (code === '') throw fail(401, { error: 'invalid_code' });
    const coachRows = await this.db.query<{ id: string; name: string }>('SELECT id, name FROM coaches WHERE access_code = $1', [code]);
    const coach = coachRows[0];
    if (coach !== undefined) {
      const token = sessionToken();
      await this.db.exec(`INSERT INTO sessions (token, role, coach_id) VALUES ($1,'coach',$2)`, [token, coach.id]);
      setSessionCookie(ctx, token);
      sendJson(ctx.res, 200, { role: 'coach', name: coach.name, id: coach.id });
      return;
    }
    const dreamerRows = await this.db.query<{ id: string; name: string; status: string }>(
      'SELECT id, name, status FROM enrollments WHERE access_code = $1',
      [code],
    );
    const row = dreamerRows[0];
    if (!row) throw fail(401, { error: 'invalid_code' });
    if (row.status !== 'active') {
      throw fail(403, { error: 'enrollment_not_active', status: row.status });
    }
    const token = sessionToken();
    await this.db.exec(`INSERT INTO sessions (token, role, enrollment_id) VALUES ($1,'dreamer',$2)`, [token, row.id]);
    setSessionCookie(ctx, token);
    sendJson(ctx.res, 200, { role: 'dreamer', name: row.name, id: row.id });
  }

  private async getSession(ctx: Ctx): Promise<void> {
    const token = ctx.cookies['lf_session'] ?? '';
    const session = token === '' ? null : await this.store.sessionByToken(token);
    if (session === null) throw unauthenticated();
    sendJson(ctx.res, 200, session);
  }

  private async signOut(ctx: Ctx): Promise<void> {
    const token = ctx.cookies['lf_session'] ?? '';
    if (token !== '') await this.db.exec('DELETE FROM sessions WHERE token = $1', [token]);
    ctx.res.setHeader('Set-Cookie', cookieHeader('lf_session', '', true));
    sendJson(ctx.res, 204, {});
  }

  private async landing(ctx: Ctx): Promise<void> {
    const token = ctx.cookies['lf_session'] ?? '';
    const session = token === '' ? null : await this.store.sessionByToken(token);
    if (session === null) throw unauthenticated();
    const next = ctx.query.get('next');
    sendJson(ctx.res, 200, { landing: landingFor(next, session.role) });
  }

  // ---------------- dreamer endpoints ----------------

  private async nightEndpoint(ctx: Ctx, session: SessionPayload): Promise<void> {
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const snap = await this.store.nightSnapshot(enrolment);
    const cohort = await this.store.cohortOf(enrolment.cohort_id);
    if (!cohort) throw unauthenticated();
    const coach = await this.store.coachOf(cohort.coach_id);
    const today = this.store.todayFor(coach?.time_zone ?? 'UTC');
    const { phase } = this.store.phaseOf(cohort, today);
    sendJson(ctx.res, 200, {
      night_key: snap.night_key,
      night_number: snap.night_number,
      first_night: enrolment.first_night,
      capture_window: snap.capture_window,
      bedtime: enrolment.bedtime,
      wake_alarm: wakeAlarmFor(enrolment.bedtime),
      home_tz: enrolment.home_tz,
      technique_unlocked: snap.night_number >= TECHNIQUE_NIGHT,
      cohort_phase: phase,
    });
  }

  private async patchSettings(ctx: Ctx, session: SessionPayload): Promise<void> {
    const body = bodyToObject(ctx.body);
    const result = validateSettings(body);
    if ('errors' in result) throw validation(result.errors);
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const newTz = result.fields.home_tz ?? enrolment.home_tz;
    const newBedtime = result.fields.bedtime ?? enrolment.bedtime;
    await this.db.exec('UPDATE enrollments SET home_tz = $2, bedtime = $3 WHERE id = $1', [enrolment.id, newTz, newBedtime]);
    const fresh = await this.store.enrolmentOf(session.id);
    if (!fresh) throw unauthenticated();
    const latest = await this.store.latestNightKey(fresh.id);
    const snap = snapshotFor(new Date(), fresh.home_tz, fresh.bedtime, fresh.first_night, latest);
    // night_held: the derived key for the new settings is earlier than the
    // published night key after the change.
    const derived = derivedNightKey(new Date(), fresh.home_tz, fresh.bedtime);
    const held = derived < snap.night_key;
    sendJson(ctx.res, 200, {
      home_tz: fresh.home_tz,
      bedtime: fresh.bedtime,
      wake_alarm: wakeAlarmFor(fresh.bedtime),
      night_key: snap.night_key,
      night_number: snap.night_number,
      night_held: held,
    });
  }

  private async listEntries(ctx: Ctx, session: SessionPayload): Promise<void> {
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const entries = await this.store.entriesFor(enrolment.id);
    sendJson(ctx.res, 200, { entries });
  }

  private async saveEntry(ctx: Ctx, session: SessionPayload, entryId: string): Promise<void> {
    if (!isUuid(entryId)) {
      const body = bodyToObject(ctx.body);
      void body;
      throw validation({ id: MESSAGES.entryId });
    }
    const body = bodyToObject(ctx.body);
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const existing = await this.store.entryOf(entryId);
    if (existing && existing.enrollment_id !== enrolment.id) throw notFound();
    const hash = entryHash(body);
    if (existing && existing.enrollment_id === enrolment.id) {
      if (existing.body_hash === hash) {
        const signs = await this.store.signsForEntry(entryId);
        const memo = await this.store.memoOf(entryId);
        sendJson(ctx.res, 200, { entry: await this.store.entryProjection(existing, signs, memo, enrolment.first_night) });
        return;
      }
      throw fail(409, { error: 'entry_id_conflict' });
    }
    const cohort = await this.store.cohortOf(enrolment.cohort_id);
    if (!cohort) throw notFound();
    const snap = await this.store.nightSnapshot(enrolment);
    if (snap.night_number < 1) throw fail(409, { error: 'cohort_not_started' });
    const coach = await this.store.coachOf(cohort.coach_id);
    const today = this.store.todayFor(coach?.time_zone ?? 'UTC');
    const { phase } = this.store.phaseOf(cohort, today);
    if (snap.night_number > 28 || phase === 'closed') throw fail(409, { error: 'cohort_closed' });
    const result = validateEntry(body);
    if ('errors' in result) throw validation(result.errors);
    if (snap.night_number < TECHNIQUE_NIGHT) {
      if (result.fields.wbtb || result.fields.technique !== 'none' || result.fields.technique_minutes > 0) {
        throw validation({ technique: MESSAGES.techniqueUnlock });
      }
    }
    const late = snap.capture_window === 'closed';
    const inserted = await this.db.transactionRetry(async (client) => {
      const tryInsert = await client.query(
        `INSERT INTO entries (id, enrollment_id, cohort_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique, technique_minutes, late_recall, shared, created_at, body_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,now(),$13)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [entryId, enrolment.id, cohort.id, snap.night_key, result.fields.title, result.fields.text, result.fields.dreams_recalled, result.fields.lucid, result.fields.wbtb, result.fields.technique, result.fields.technique_minutes, late, hash],
      );
      return tryInsert.rowCount === 1;
    });
    if (!inserted) {
      const row = await this.store.entryOf(entryId);
      if (row && row.enrollment_id === enrolment.id && row.body_hash === hash) {
        const signs = await this.store.signsForEntry(entryId);
        const memo = await this.store.memoOf(entryId);
        sendJson(ctx.res, 200, { entry: await this.store.entryProjection(row, signs, memo, enrolment.first_night) });
        return;
      }
      throw fail(409, { error: 'entry_id_conflict' });
    }
    const row = await this.store.entryOf(entryId);
    if (!row) throw notFound();
    const signs = await this.store.signsForEntry(entryId);
    sendJson(ctx.res, 201, { entry: await this.store.entryProjection(row, signs, null, enrolment.first_night) });
  }

  private async shareEntry(ctx: Ctx, session: SessionPayload, entryId: string): Promise<void> {
    if (!isUuid(entryId)) throw notFound();
    const body = bodyToObject(ctx.body);
    const shared = body['shared'];
    if (typeof shared !== 'boolean') throw validation({ shared: MESSAGES.shared });
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const existing = await this.store.entryOf(entryId);
    if (!existing || existing.enrollment_id !== enrolment.id) throw notFound();
    await this.db.exec('UPDATE entries SET shared = $2 WHERE id = $1', [entryId, shared]);
    const row = await this.store.entryOf(entryId);
    if (!row) throw notFound();
    const signs = await this.store.signsForEntry(entryId);
    const memo = await this.store.memoOf(entryId);
    sendJson(ctx.res, 200, { entry: await this.store.entryProjection(row, signs, memo, enrolment.first_night) });
  }

  // ---------------- memos ----------------

  private async uploadMemo(ctx: Ctx, session: SessionPayload, entryId: string): Promise<void> {
    if (!isUuid(entryId)) throw notFound();
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const existing = await this.store.entryOf(entryId);
    if (!existing || existing.enrollment_id !== enrolment.id) throw notFound();
    const raw = ctx.memoBody;
    if (raw === undefined) throw validation({ duration_ms: MESSAGES.durationMs });
    const contentType = ctx.req.headers['content-type'] ?? '';
    const type = memoTypeOf(contentType);
    if (type === null) throw fail(415, { error: 'unsupported_media_type' });
    const durationHeader = ctx.req.headers['x-memo-duration-ms'];
    const duration = /^\d+$/.test(String(durationHeader ?? '')) ? Number(durationHeader) : null;
    if (duration === null || duration < 1 || duration > 600000) throw validation({ duration_ms: MESSAGES.durationMs });

    const slot = await this.db.query<{ stored: boolean; content_type: string | null; size_bytes: number | null; duration_ms: number | null }>(
      'SELECT stored, content_type, size_bytes, duration_ms FROM memo_slots WHERE entry_id = $1 FOR UPDATE',
      [entryId],
    );
    const slotRow = slot[0];
    if (slotRow && slotRow.stored) {
      if (slotRow.content_type === contentType && slotRow.size_bytes === raw.length && slotRow.duration_ms === duration) {
        sendJson(ctx.res, 200, { memo: { content_type: slotRow.content_type, size_bytes: slotRow.size_bytes, duration_ms: slotRow.duration_ms } });
        return;
      }
      throw fail(409, { error: 'memo_exists' });
    }
    if (raw.length === 0) throw validation({ memo: MESSAGES.memoEmpty });
    if (!signatureMatches(new Uint8Array(raw), type)) throw validation({ memo: MESSAGES.memoSignature });

    // claim, then write to MinIO
    const claimed = await this.db.transactionRetry(async (client) => {
      const res = await client.query(
        `INSERT INTO memo_slots (entry_id, content_type, size_bytes, duration_ms, stored) VALUES ($1,$2,$3,$4,FALSE)
         ON CONFLICT (entry_id) DO NOTHING`,
        [entryId, contentType, raw.length, duration],
      );
      return res.rowCount === 1;
    });
    if (!claimed) throw fail(409, { error: 'memo_exists' });
    const key = `memos/${enrolment.id}/${entryId}`;
    try {
      await this.minio.put(key, raw, contentType, duration);
    } catch (err) {
      await this.db.exec('DELETE FROM memo_slots WHERE entry_id = $1 AND stored = FALSE', [entryId]);
      throw err;
    }
    await this.db.exec('UPDATE memo_slots SET stored = TRUE WHERE entry_id = $1', [entryId]);
    sendJson(ctx.res, 201, { memo: { content_type: contentType, size_bytes: raw.length, duration_ms: duration } });
  }

  private async fetchMemo(ctx: Ctx, session: SessionPayload, entryId: string, coachOverride: { cohortId: string; coachId: string } | null): Promise<void> {
    if (!isUuid(entryId)) throw notFound();
    const enrolment = coachOverride === null ? await this.store.enrolmentOf(session.id) : null;
    if (coachOverride === null && (!enrolment)) throw unauthenticated();
    const existing = await this.store.entryOf(entryId);
    if (!existing) throw notFound();
    if (coachOverride === null) {
      if (existing.enrollment_id !== (enrolment as EnrolmentContext).id) throw notFound();
    } else {
      const cohort = await this.store.cohortOf(coachOverride.cohortId);
      if (!cohort || cohort.coach_id !== coachOverride.coachId) throw notFound();
      if (existing.cohort_id !== coachOverride.cohortId) throw notFound();
      if (!existing.shared) throw notFound();
      const owner = await this.store.enrolmentOf(existing.enrollment_id);
      if (!owner || owner.status !== 'active') throw notFound();
    }
    const slot = await this.db.query<{ content_type: string | null; size_bytes: number | null; duration_ms: number | null }>(
      'SELECT content_type, size_bytes, duration_ms FROM memo_slots WHERE entry_id = $1 AND stored = TRUE',
      [entryId],
    );
    const row = slot[0];
    if (!row || row.content_type === null || row.duration_ms === null) throw notFound();
    const enrolmentId = coachOverride === null ? (enrolment as EnrolmentContext).id : existing.enrollment_id;
    const stored = await this.minio.get(`memos/${enrolmentId}/${entryId}`);
    const range = ctx.req.headers['range'];
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': row.content_type,
      'X-Memo-Duration-Ms': String(row.duration_ms),
      'Cache-Control': 'no-store',
    };
    if (range === undefined) {
      headers['Content-Length'] = String(stored.body.length);
      ctx.res.writeHead(200, headers);
      ctx.res.end(stored.body);
      return;
    }
    const parsed = parseRange(range, stored.body.length);
    if (parsed === 'full') {
      headers['Content-Length'] = String(stored.body.length);
      ctx.res.writeHead(200, headers);
      ctx.res.end(stored.body);
      return;
    }
    if (parsed === 'unsatisfiable') {
      sendJson(ctx.res, 416, { error: 'range_not_satisfiable' }, { 'Content-Range': `bytes */${stored.body.length}` });
      return;
    }
    const slice = stored.body.subarray(parsed.start, parsed.end + 1);
    headers['Content-Length'] = String(slice.length);
    headers['Content-Range'] = `bytes ${parsed.start}-${parsed.end}/${stored.body.length}`;
    ctx.res.writeHead(206, headers);
    ctx.res.end(slice);
  }

  private async coachMemo(ctx: Ctx, session: SessionPayload, cohortId: string, entryId: string): Promise<void> {
    if (!isUuid(cohortId) || !isUuid(entryId)) throw notFound();
    await this.fetchMemo(ctx, session, entryId, { cohortId, coachId: session.id });
  }

  // ---------------- signs ----------------

  private async createSign(ctx: Ctx, session: SessionPayload, entryId: string): Promise<void> {
    if (!isUuid(entryId)) throw notFound();
    const body = bodyToObject(ctx.body);
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const existing = await this.store.entryOf(entryId);
    if (!existing || existing.enrollment_id !== enrolment.id) throw notFound();
    const shape = validateSignShape(body);
    if ('errors' in shape) throw validation(shape.errors);

    // Range validation happens before the lock so invalid requests never
    // reach the serialized section; the sign check order itself is enforced
    // again under the entry lock.
    const length = shape.fields.end - shape.fields.start;
    if (length < 1 || length > 200 || shape.fields.end > existing.text.length) {
      throw validation({ range: MESSAGES.range });
    }
    const phrase = existing.text.slice(shape.fields.start, shape.fields.end);
    if (phrase.trim().length === 0) throw validation({ range: MESSAGES.range });

    const outcome = await this.db.transactionRetry(async (client) => {
      // hold the entry row so overlapping tags serialize
      await client.query('SELECT id FROM entries WHERE id = $1 FOR UPDATE', [entryId]);
      const signRows = await client.query<SignRow>(
        `SELECT id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key::text AS night_key
         FROM signs WHERE entry_id = $1 ORDER BY created_at, id`,
        [entryId],
      );
      const signs: Sign[] = signRows.rows.map((r) => ({
        id: r.id,
        entry_id: r.entry_id,
        start: r.start_offset,
        end: r.end_offset,
        phrase: r.phrase,
        category: r.category as Sign['category'],
        night_key: r.night_key,
      }));
      const identical = signs.find((s) => s.start === shape.fields.start && s.end === shape.fields.end);
      if (identical) {
        if (identical.category === shape.fields.category) {
          return { replay: identical, conflict: null as null | 'conflict', overlap: null as null | string, inserted: null as null | string };
        }
        return { replay: null, conflict: 'conflict' as const, overlap: null, inserted: null };
      }
      const overlap = signs.find((s) => s.start < shape.fields.end && shape.fields.start < s.end);
      if (overlap) {
        return { replay: null, conflict: null, overlap: overlap.id, inserted: null };
      }
      const signId = randomUUID();
      await client.query(
        `INSERT INTO signs (id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [signId, entryId, enrolment.id, shape.fields.start, shape.fields.end, phrase, shape.fields.category, existing.night_key],
      );
      return { replay: null, conflict: null, overlap: null, inserted: signId };
    });

    if (outcome.replay !== null) {
      const tallies = await this.store.talliesFor(enrolment.id);
      sendJson(ctx.res, 200, { sign: outcome.replay, tallies });
      return;
    }
    if (outcome.conflict !== null) throw fail(409, { error: 'sign_conflict' });
    if (outcome.overlap !== null) throw fail(409, { error: 'sign_overlap', sign_id: outcome.overlap });
    const tallies = await this.store.talliesFor(enrolment.id);
    const signId = outcome.inserted as string;
    sendJson(ctx.res, 201, {
      sign: { id: signId, entry_id: entryId, start: shape.fields.start, end: shape.fields.end, phrase, category: shape.fields.category, night_key: existing.night_key },
      tallies,
    });
  }

  private async dreamscape(ctx: Ctx, session: SessionPayload): Promise<void> {
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const { constellations, target } = await this.store.constellations(enrolment.id);
    sendJson(ctx.res, 200, { constellations, target_category: target });
  }

  private async createRealityCheck(ctx: Ctx, session: SessionPayload): Promise<void> {
    const body = bodyToObject(ctx.body);
    const enrolment = await this.store.enrolmentOf(session.id);
    if (!enrolment) throw unauthenticated();
    const id = typeof body['id'] === 'string' ? body['id'] : '';
    const category = body['category'];
    if (!isUuid(id)) throw validation({ id: MESSAGES.checkId });
    if (typeof category !== 'string' || !['inner_awareness', 'action', 'form', 'context'].includes(category)) {
      throw validation({ category: MESSAGES.category });
    }
    const existing = await this.db.query<{ enrollment_id: string; category: string; night_key: string }>(
      'SELECT enrollment_id, category, night_key::text AS night_key FROM reality_checks WHERE id = $1',
      [id],
    );
    const row = existing[0];
    if (row) {
      if (row.enrollment_id !== enrolment.id) throw notFound();
      if (row.category === category) {
        const count = await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM reality_checks WHERE enrollment_id = $1 AND night_key = $2', [enrolment.id, row.night_key]);
        sendJson(ctx.res, 200, {
          reality_check: { id, category, night_key: row.night_key },
          night_count: Number(count[0]?.n ?? 0),
        });
        return;
      }
      throw fail(409, { error: 'reality_check_id_conflict' });
    }
    const snap = await this.store.nightSnapshot(enrolment);
    const inserted = await this.db.transactionRetry(async (client) => {
      const res = await client.query(
        `INSERT INTO reality_checks (id, enrollment_id, category, night_key) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [id, enrolment.id, category, snap.night_key],
      );
      return res.rowCount === 1;
    });
    if (!inserted) {
      const row2 = (await this.db.query<{ enrollment_id: string; category: string; night_key: string }>('SELECT enrollment_id, category, night_key::text AS night_key FROM reality_checks WHERE id = $1', [id]))[0];
      if (row2 && row2.enrollment_id === enrolment.id && row2.category === category) {
        const count = await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM reality_checks WHERE enrollment_id = $1 AND night_key = $2', [enrolment.id, row2.night_key]);
        sendJson(ctx.res, 200, { reality_check: { id, category, night_key: row2.night_key }, night_count: Number(count[0]?.n ?? 0) });
        return;
      }
      if (row2 && row2.enrollment_id !== enrolment.id) throw notFound();
      throw fail(409, { error: 'reality_check_id_conflict' });
    }
    const count = await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM reality_checks WHERE enrollment_id = $1 AND night_key = $2', [enrolment.id, snap.night_key]);
    sendJson(ctx.res, 201, { reality_check: { id, category, night_key: snap.night_key }, night_count: Number(count[0]?.n ?? 0) });
  }

  // ---------------- coach endpoints ----------------

  private async coachCohorts(ctx: Ctx, session: SessionPayload): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      'SELECT id FROM cohorts WHERE coach_id = $1 ORDER BY starts_on, name',
      [session.id],
    );
    const out: Cohort[] = [];
    for (const row of rows) {
      const cohort = await this.store.cohortOf(row.id);
      if (!cohort) continue;
      const coach = await this.store.coachOf(cohort.coach_id);
      if (!coach) continue;
      out.push(await this.store.cohortProjection(cohort, coach.name, await this.store.activeCount(cohort.id)));
    }
    sendJson(ctx.res, 200, { cohorts: out });
  }

  private async createCohort(ctx: Ctx, session: SessionPayload): Promise<void> {
    const body = bodyToObject(ctx.body);
    const name = typeof body['name'] === 'string' ? body['name'] : '';
    const taken = await this.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM cohorts WHERE coach_id = $1 AND lower(name) = lower($2)',
      [session.id, name],
    );
    if (Number(taken[0]?.n ?? 0) > 0) throw fail(409, { error: 'cohort_name_taken' });
    const result = validateCohort(body);
    if ('errors' in result) throw validation(result.errors);
    const id = randomUUID();
    const inserted = await this.db.transactionRetry(async (client) => {
      const res = await client.query(
        `INSERT INTO cohorts (id, coach_id, name, starts_on, price_cents, seats, published) VALUES ($1,$2,$3,$4,$5,$6,FALSE) ON CONFLICT DO NOTHING`,
        [id, session.id, result.fields.name, result.fields.starts_on, result.fields.price_cents, result.fields.seats],
      );
      return res.rowCount === 1;
    });
    if (!inserted) throw fail(409, { error: 'cohort_name_taken' });
    const cohort = await this.store.cohortOf(id);
    const coach = await this.store.coachOf(session.id);
    if (!cohort || !coach) throw notFound();
    sendJson(ctx.res, 201, { cohort: await this.store.cohortProjection(cohort, coach.name, 0) });
  }

  private async requireOwnCohort(session: SessionPayload, cohortId: string): Promise<CohortContext> {
    if (!isUuid(cohortId)) throw notFound();
    const cohort = await this.store.cohortOf(cohortId);
    if (!cohort || cohort.coach_id !== session.id) throw notFound();
    return cohort;
  }

  private async publishCohort(ctx: Ctx, session: SessionPayload, cohortId: string): Promise<void> {
    const cohort = await this.requireOwnCohort(session, cohortId);
    const today = this.store.todayFor((await this.store.coachOf(session.id))?.time_zone ?? 'UTC');
    const { phase } = this.store.phaseOf(cohort, today);
    if (phase !== 'draft') throw illegalTransition(phase, 'enrolling');
    await this.db.exec('UPDATE cohorts SET published = TRUE WHERE id = $1', [cohortId]);
    const fresh = await this.store.cohortOf(cohortId);
    const coach = await this.store.coachOf(session.id);
    if (!fresh || !coach) throw notFound();
    sendJson(ctx.res, 200, { cohort: await this.store.cohortProjection(fresh, coach.name, await this.store.activeCount(fresh.id)) });
  }

  private async closeCohort(ctx: Ctx, session: SessionPayload, cohortId: string): Promise<void> {
    const cohort = await this.requireOwnCohort(session, cohortId);
    const today = this.store.todayFor((await this.store.coachOf(session.id))?.time_zone ?? 'UTC');
    const { phase } = this.store.phaseOf(cohort, today);
    if (phase !== 'technique') throw illegalTransition(phase, 'closed');
    await this.db.exec('UPDATE cohorts SET closed_by_coach = TRUE WHERE id = $1', [cohortId]);
    const fresh = await this.store.cohortOf(cohortId);
    const coach = await this.store.coachOf(session.id);
    if (!fresh || !coach) throw notFound();
    sendJson(ctx.res, 200, { cohort: await this.store.cohortProjection(fresh, coach.name, await this.store.activeCount(fresh.id)) });
  }

  private async roster(ctx: Ctx, session: SessionPayload, cohortId: string): Promise<void> {
    const cohort = await this.requireOwnCohort(session, cohortId);
    const coach = await this.store.coachOf(session.id);
    if (!coach) throw notFound();
    const dreamers = await this.store.roster(cohort);
    sendJson(ctx.res, 200, {
      cohort: await this.store.cohortProjection(cohort, coach.name, await this.store.activeCount(cohort.id)),
      dreamers,
    });
  }

  private async digest(ctx: Ctx, session: SessionPayload, cohortId: string): Promise<void> {
    const cohort = await this.requireOwnCohort(session, cohortId);
    const coach = await this.store.coachOf(session.id);
    if (!coach) throw notFound();
    const today = this.store.todayFor(coach.time_zone);
    const { phase, week } = this.store.phaseOf(cohort, today);
    if (phase !== 'baseline' && phase !== 'technique') throw fail(409, { error: 'cohort_not_running' });
    const existing = await this.db.query<{ week: number; coach_email: string; dreamers: number }>(
      'SELECT week, coach_email, dreamers FROM digests WHERE cohort_id = $1 AND week = $2',
      [cohort.id, week],
    );
    const prior = existing[0];
    if (prior) {
      sendJson(ctx.res, 200, { digest: { week: prior.week, to: prior.coach_email, dreamers: prior.dreamers, replayed: true } });
      return;
    }
    const rows = await this.store.roster(cohort);
    const active = rows.filter((r) => r.status === 'active');
    const bodyLines = active.map((r) => {
      const pct = Math.round(r.recall_rate * 100);
      const t = r.sign_tallies;
      return `${r.display_name}: recall ${pct}%, technique ${r.technique_minutes} min, WBTB nights ${r.wbtb_nights}, reality checks ${r.reality_checks}, signs inner awareness ${t.inner_awareness} / action ${t.action} / form ${t.form} / context ${t.context}`;
    });
    const sums = { inner_awareness: 0, action: 0, form: 0, context: 0 };
    for (const r of active) {
      sums.inner_awareness += r.sign_tallies.inner_awareness;
      sums.action += r.sign_tallies.action;
      sums.form += r.sign_tallies.form;
      sums.context += r.sign_tallies.context;
    }
    const finalLine = `Cohort signs: inner awareness ${sums.inner_awareness} / action ${sums.action} / form ${sums.form} / context ${sums.context}`;
    const subject = `Lanternfish digest: ${cohort.name}, week ${week}`;
    const body = [...bodyLines, finalLine].join('\n');
    const locked = await this.db.transactionRetry(async (client) => {
      const res = await client.query(
        `INSERT INTO digests (cohort_id, week, coach_email, dreamers) VALUES ($1,$2,$3,$4) ON CONFLICT (cohort_id, week) DO NOTHING`,
        [cohort.id, week, coach.email, active.length],
      );
      return res.rowCount === 1;
    });
    if (!locked) {
      const priorRow = (await this.db.query<{ week: number; coach_email: string; dreamers: number }>(
        'SELECT week, coach_email, dreamers FROM digests WHERE cohort_id = $1 AND week = $2',
        [cohort.id, week],
      ))[0];
      sendJson(ctx.res, 200, { digest: { week: priorRow?.week ?? week, to: priorRow?.coach_email ?? coach.email, dreamers: priorRow?.dreamers ?? active.length, replayed: true } });
      return;
    }
    try {
      await this.mailer.send({ from: this.mailFrom, to: coach.email, subject, body });
    } catch (err) {
      await this.db.exec('DELETE FROM digests WHERE cohort_id = $1 AND week = $2', [cohort.id, week]);
      throw err;
    }
    sendJson(ctx.res, 200, { digest: { week: week as number, to: coach.email, dreamers: active.length, replayed: false } });
  }

  private async refund(ctx: Ctx, session: SessionPayload, enrolmentId: string): Promise<void> {
    if (!isUuid(enrolmentId)) throw notFound();
    const enrolment = await this.store.enrolmentOf(enrolmentId);
    if (!enrolment) throw notFound();
    const cohort = await this.store.cohortOf(enrolment.cohort_id);
    if (!cohort || cohort.coach_id !== session.id) throw notFound();
    // 1. pending or refunded
    if (enrolment.status !== 'active') throw illegalTransition(enrolment.status, 'refunded');
    // 2. window
    const coach = await this.store.coachOf(session.id);
    const today = this.store.todayFor(coach?.time_zone ?? 'UTC');
    const { phase } = this.store.phaseOf(cohort, today);
    if (phase === 'technique' || phase === 'closed') throw fail(409, { error: 'refund_window_closed' });
    // 3. comped
    if (!enrolment.paid_via_killbill) throw fail(409, { error: 'not_refundable' });
    // 4. Kill Bill, serialized per enrolment so only one REFUND is made
    const outcome = await this.refundLocks.run(enrolment.id, async () => {
      const fresh = await this.store.enrolmentOf(enrolment.id);
      if (!fresh) return { error: notFound() };
      if (fresh.status !== 'active') return { error: illegalTransition(fresh.status, 'refunded') };
      const account = await this.killbill.findAccount(fresh.id);
      if (!account) return { error: billingUnavailable() };
      const payments = await this.killbill.paymentsFor(account.accountId, fresh.id);
      const payment = payments[0];
      if (!payment) return { error: billingUnavailable() };
      const priorRefund = payment.transactions.find((t) => t.transactionExternalKey === `${fresh.id}-refund` && t.status === 'SUCCESS');
      if (!priorRefund) {
        const refundTxn = await this.killbill.createRefund(account.accountId, payment.paymentId, `${fresh.id}-refund`, cohort.price_cents / 100);
        if (refundTxn.status !== 'SUCCESS') {
          return { error: illegalTransition('active', 'refunded') };
        }
      }
      await this.db.transactionRetry(async (client) => {
        await client.query(`UPDATE enrollments SET status = 'refunded' WHERE id = $1 AND status = 'active'`, [fresh.id]);
      });
      return { error: null };
    });
    if (outcome.error !== null) throw outcome.error;
    await this.store.endSessionsOfEnrolment(enrolment.id);
    const fresh = await this.store.enrolmentOf(enrolment.id);
    if (!fresh) throw notFound();
    const rosterRow = await this.store.rosterRow(await this.enrolmentRow(fresh.id));
    sendJson(ctx.res, 200, { dreamer: rosterRow });
  }

  private async enrolmentRow(id: string): Promise<EnrolmentRowAlias> {
    const rows = await this.db.query<EnrolmentRowAlias>(
      `SELECT e.id, e.cohort_id, e.name, e.email, e.status, e.price_cents, e.home_tz, e.bedtime,
              e.first_night::text AS first_night, e.receipt_status, c.name AS cohort_name, '' AS access_code, FALSE AS paid_via_killbill
       FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id WHERE e.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw notFound();
    return row;
  }
}

// ---------------- helpers ----------------

function enrolmentProjection(e: EnrolmentContext): import('../shared/domain.js').Enrolment {
  return {
    id: e.id,
    cohort_id: e.cohort_id,
    cohort_name: e.cohort_name,
    name: e.name,
    email: e.email,
    status: e.status,
    price_cents: e.price_cents,
    home_tz: e.home_tz,
    bedtime: e.bedtime,
    wake_alarm: e.wake_alarm,
    first_night: e.first_night,
    receipt_status: e.receipt_status,
  };
}

function accessCodeNew(): string {
  return randomBytes(12).toString('base64url');
}

function sessionToken(): string {
  return randomBytes(24).toString('base64url');
}

function setSessionCookie(ctx: Ctx, token: string): void {
  ctx.res.setHeader('Set-Cookie', cookieHeader('lf_session', token, false));
}

function entryHash(body: Record<string, unknown>): string {
  const stable = JSON.stringify({
    title: body['title'],
    text: body['text'],
    dreams_recalled: body['dreams_recalled'],
    lucid: body['lucid'],
    wbtb: body['wbtb'],
    technique: body['technique'],
    technique_minutes: body['technique_minutes'],
  });
  return createHash('sha256').update(stable).digest('hex');
}

function parseRange(header: string, size: number): 'full' | 'unsatisfiable' | { start: number; end: number } {
  const m = /^bytes=(.+)$/.exec(header.trim());
  if (!m) return 'full';
  const parts = (m[1] as string).split(',');
  if (parts.length > 1) return 'full';
  const part = parts[0]?.trim() ?? '';
  const single = /^(\d*)-(\d*)$/.exec(part);
  if (!single) return 'full';
  const aStr = single[1] ?? '';
  const bStr = single[2] ?? '';
  if (aStr === '' && bStr === '') return 'full';
  if (aStr === '') {
    const n = Number(bStr);
    if (n === 0) return 'unsatisfiable';
    const start = Math.max(0, size - n);
    return { start, end: size - 1 };
  }
  const a = Number(aStr);
  if (a >= size) return 'unsatisfiable';
  if (bStr === '') return { start: a, end: size - 1 };
  const b = Number(bStr);
  if (b < a) return 'full';
  return { start: a, end: Math.min(b, size - 1) };
}

function contentTypeFor(file: string): string {
  const ext = extname(file);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function notFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found</title><link rel="stylesheet" href="/assets/styles.css"></head><body><div id="app"><main><h1>Page not found</h1><p>We couldn't find that page.</p></main></div><script src="/assets/app.js" type="module"></script></body></html>`;
}
