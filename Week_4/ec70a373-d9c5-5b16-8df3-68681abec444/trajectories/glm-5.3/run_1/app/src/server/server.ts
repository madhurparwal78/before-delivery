import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import { AppContext, type SessionUser } from './context.js';
import { Database, clientQuery, type DbClient, type Row } from './db.js';
import { KillBillClient } from './killbill.js';
import { StorageClient } from './storage.js';
import { Mailer } from './mailer.js';
import { loadEnv, type Env } from '../env.js';
import { httpDate, nowMs } from '../clock.js';
import { ApiError, INTERNAL_ERROR, errorBody } from './errors.js';
import { addressPrefix, isJsonContent, type AuthedRequest } from './http.js';


import { seedDatabase } from './seed.js';
import { queueMail } from './mail.js';
import { documentTypeLabel } from '../labels.js';
import { zoneInstant, zoneDayStart, datePlusDays } from '../sitetime.js';
import { buildApiRouter } from './api.js';
import type { Json } from '../types.js';

const require = createRequire(import.meta.url);
const express = require('express') as () => Express;

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';";

export class PilotServer {
  readonly app: Express;
  private readonly env: Env;
  readonly db: Database;
  readonly killbill: KillBillClient;
  readonly storage: StorageClient;
  readonly mailer: Mailer;
  readonly ctx: AppContext;
  private ready = false;
  private startedAt = 0;

  constructor() {
    this.env = loadEnv();
    this.startedAt = Date.now();
    this.db = new Database(this.env);
    this.killbill = new KillBillClient(this.env);
    this.storage = new StorageClient(this.env);
    this.mailer = new Mailer(this.env);
    this.ctx = new AppContext(this.db, this.env, this.killbill, this.storage, this.mailer);
    this.app = express();
    this.installMiddleware();
    this.app.use(buildApiRouter(this.ctx));
    this.installStaticRoutes();
  }

  private installMiddleware(): void {
    this.app.disable('x-powered-by');
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Date', httpDate());
      next();
    });
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (!isJsonContent(req)) {
        next();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) {
          const err = new ApiError(413, 'body_too_large', 'The JSON body is too large.');
          this.sendError(req, res, err);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw === '') {
          (req as AuthedRequest).body = {};
          next();
          return;
        }
        try {
          const parsed = JSON.parse(raw) as Json;
          (req as AuthedRequest).body = parsed;
        } catch {
          this.sendError(req, res, new ApiError(415, 'unsupported_media_type', 'Send a JSON body.'));
          return;
        }
        next();
      });
      req.on('error', () => {
        // Connection problems are ignored; the response has already gone out.
      });
    });
  }

  private sendError(req: Request, res: Response, err: ApiError): void {
    if (res.headersSent) return;
    res.status(err.status);
    for (const [key, value] of Object.entries(err.headers ?? {})) res.setHeader(key, value);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(errorBody(err.code, err.message, err.fields, err.extra));
  }

  private installStaticRoutes(): void {
    const publicDir = path.join(process.cwd(), 'dist', 'public');
    this.app.use((req: Request, res: Response) => {
      const url = req.path.replace(/\/+$/, '') || '/';
      // Under /api, any path the endpoint table does not list answers with the JSON error body.
      if (url === '/api' || url.startsWith('/api/')) {
        this.sendError(req, res, new ApiError(404, 'not_found', 'There is nothing here.'));
        return;
      }
      // Only built frontend assets are served: never source, manifests or credentials.
      const deniedExact = new Set(['/run.json', '/package.json', '/package-lock.json', '/tsconfig.json', '/build.mjs', '/.env', '/source.ts']);
      const deniedPrefixes = ['/src/', '/node_modules/', '/tools/', '/dist/server/', '/tmp/'];
      if (deniedExact.has(url) || deniedPrefixes.some((prefix) => url.startsWith(prefix))) {
        this.sendError(req, res, new ApiError(404, 'not_found', 'There is nothing here.'));
        return;
      }
      const hasExtension = path.extname(url) !== '';
      if (hasExtension) {
        const target = path.join(publicDir, url);
        const normalised = path.normalize(target);
        if (!normalised.startsWith(publicDir + path.sep) || !fs.existsSync(normalised) || fs.statSync(normalised).isDirectory()) {
          this.sendError(req, res, new ApiError(404, 'not_found', 'There is nothing here.'));
          return;
        }
        const ext = path.extname(url).toLowerCase();
        const types: Record<string, string> = {
          '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
          '.ttf': 'font/ttf',
          '.txt': 'text/plain; charset=utf-8',
          '.png': 'image/png',
          '.pdf': 'application/pdf',
        };
        res.status(200);
        res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
        res.send(fs.readFileSync(normalised));
        return;
      }
      const html = fs.readFileSync(path.join(publicDir, 'index.html'));
      res.status(200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', CSP);
      res.send(html);
    });
  }

  async start(): Promise<void> {
    const port = this.env.APP_PUBLIC_PORT;
    this.app.listen(port, '0.0.0.0', () => {
      process.stdout.write(`pilotlight serving on ${port}\n`);
    });
    void this.prepare();
    this.startOutboxLoop();
    this.startExpiryLoop();
    this.startNoticeLoop();
  }

  /** Schema and seed: retried until the database is reachable, exactly one process seeds. */
  private async prepare(): Promise<void> {
    for (;;) {
      try {
        await this.db.withTransaction(async (client) => {
          await this.db.applySchema();
          await seedDatabase(client, {
            nowMs: nowMs(),
            seedSet: this.env.PILOTLIGHT_SEED_SET,
            zoneInstant: (date, zone, minutes) => zoneInstant(date, zone, minutes),
          });
        });
        this.ctx.markReady();
        this.ready = true;
        return;
      } catch (err) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  /** Expiry notices: at most one 14-day and one 3-day notice per valid-through date. */
  private startNoticeLoop(): void {
    const tick = async () => {
      if (!this.ready) return;
      try {
        await this.scanNotices();
      } catch {
        // The next pass retries.
      }
      setTimeout(tick, 30000);
    };
    setTimeout(tick, 5000);
  }

  private async scanNotices(): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const members = await clientQuery<Row>(client, `SELECT id, coi_valid_through, fhc_valid_through, bl_valid_through FROM users WHERE role = 'member'`);
      const at = nowMs();
      for (const member of members) {
        const zones = await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = (SELECT site_id FROM users WHERE id = $1)`, [member.id]);
        const zone = zones.length > 0 ? String(zones[0].time_zone) : 'UTC';
        const today = localDateAt(zone, at);
        for (const [type, validThrough] of [
          ['certificate_of_insurance', member.coi_valid_through],
          ['food_handler_certificate', member.fhc_valid_through],
          ['business_licence', member.bl_valid_through],
        ] as Array<[string, string | null]>) {
          if (validThrough === null) continue;
          const date = String(validThrough).slice(0, 10);
          const daysLeft = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
          let noticeKind: '14-day' | '3-day' | null = null;
          if (daysLeft >= 4 && daysLeft <= 14) noticeKind = '14-day';
          else if (daysLeft >= 0 && daysLeft <= 3) noticeKind = '3-day';
          if (noticeKind === null) continue;
          const already = await clientQuery<Row>(
            client,
            `SELECT member_id FROM expiry_notices WHERE member_id = $1 AND doc_type = $2 AND valid_through = $3 AND notice_kind = $4`,
            [member.id, type, date, noticeKind],
          );
          if (already.length > 0) continue;
          await clientQuery(
            client,
            `INSERT INTO expiry_notices (member_id, doc_type, valid_through, notice_kind) VALUES ($1, $2, $3, $4)`,
            [member.id, type, date, noticeKind],
          );
          const userRow = await clientQuery<Row>(client, `SELECT email, tenant_id FROM users WHERE id = $1`, [member.id]);
          await queueMail(client, String(userRow[0].tenant_id), {
            kind: 'expiry_notice',
            to: String(userRow[0].email),
            typeLabel: documentTypeLabel(type),
            date,
            noticeKind,
          });
        }
      }
    });
  }

  private startOutboxLoop(): void {
    const tick = async () => {
      if (!this.ready) return;
      try {
        await this.deliverOutbox();
      } catch {
        // Delivery retries on the next tick.
      }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 500);
  }

  private async deliverOutbox(): Promise<void> {
    const rows = await this.db.query<Row>(
      `SELECT id, to_email, subject, body FROM email_outbox WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < $1) ORDER BY id LIMIT 10`,
      [nowMs() - 60000],
    );
    for (const row of rows) {
      const claimed = await this.db.query<Row>(
        `UPDATE email_outbox SET claimed_at = $1 WHERE id = $2 AND (claimed_at IS NULL OR claimed_at < $3) RETURNING id`,
        [nowMs(), Number(row.id), nowMs() - 60000],
      );
      if (claimed.length === 0) continue;
      try {
        await this.mailer.send({ to: String(row.to_email), subject: String(row.subject), body: String(row.body) });
        await this.db.query(`UPDATE email_outbox SET sent_at = $1 WHERE id = $2`, [nowMs(), Number(row.id)]);
      } catch {
        // claimed_at stays set; the next pass retries after it goes stale.
      }
    }
  }

  private startExpiryLoop(): void {
    const tick = async () => {
      if (!this.ready) return;
      try {
        await this.expireHolds();
        await this.expireLots();
      } catch {
        // The next pass retries.
      }
      setTimeout(tick, 500);
    };
    setTimeout(tick, 1000);
  }

  private async expireHolds(): Promise<void> {
    const at = nowMs();
    await this.db.withTransaction(async (client) => {
      const rows = await clientQuery<Row>(
        client,
        `SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at <= $1 LIMIT 50`,
        [at],
      );
      for (const row of rows) {
        await this.expireOneHold(client, row);
      }
    });
  }

  private async expireLots(): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const rows = await clientQuery<Row>(
        client,
        `SELECT l.*, u.site_id AS home_site_id, u.tenant_id AS home_tenant_id FROM lots l JOIN users u ON u.id = l.member_id
          WHERE l.valid_through IS NOT NULL AND l.remainder_qh > 0`,
      );
      const at = nowMs();
      const zones = new Map<string, string>();
      for (const row of rows) {
        const homeSiteId = String(row.home_site_id);
        if (!zones.has(homeSiteId)) {
          const site = await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [homeSiteId]);
          zones.set(homeSiteId, site.length > 0 ? String(site[0].time_zone) : 'UTC');
        }
        const zone = zones.get(homeSiteId) ?? 'UTC';
        const validThrough = String(row.valid_through).slice(0, 10);
        const expiryInstant = zoneDayStart(datePlusDays(validThrough, 1), zone);
        if (at >= expiryInstant) {
          await this.expireOneLot(client, row, at);
        }
      }
    });
  }

  private async expireOneHold(client: DbClient, row: Row): Promise<void> {
    const updated = await clientQuery<Row>(
      client,
      `UPDATE bookings SET status = 'expired' WHERE id = $1 AND status = 'held' RETURNING id`,
      [row.id],
    );
    if (updated.length === 0) return;
    const quarterHours = Number(row.quarter_hours);
    if (quarterHours > 0) {
      const { returnToLots, writeMovement } = await import('./ledger.js');
      const returns = await returnToLots(client, String(row.member_id), String(row.id), quarterHours);
      await writeMovement(client, {
        memberId: String(row.member_id),
        tenantId: String(row.tenant_id),
        kind: 'hold_release',
        fromAccount: 'committed',
        toAccount: 'available',
        quarterHours,
        bookingId: String(row.id),
        actor: null,
        atMs: nowMs(),
        lots: returns,
      });
      await this.followExpiryReturns(client, String(row.member_id), String(row.tenant_id), returns);
    }
  }

  private async expireOneLot(client: DbClient, row: Row, at: number): Promise<void> {
    const { writeMovement } = await import('./ledger.js');
    const quarterHours = Number(row.remainder_qh);
    if (quarterHours <= 0) return;
    await clientQuery(client, `UPDATE lots SET remainder_qh = 0 WHERE id = $1`, [row.id]);
    await writeMovement(client, {
      memberId: String(row.member_id),
      tenantId: String(row.home_tenant_id),
      kind: 'pack_expiry',
      fromAccount: 'available',
      toAccount: 'expired',
      quarterHours,
      actor: null,
      atMs: at,
      lots: [{ lotId: Number(row.id), purchaseId: row.purchase_id as string | null, quarterHours }],
    });
  }

  private async followExpiryReturns(
    client: DbClient,
    memberId: string,
    tenantId: string,
    returns: Array<{ lotId: number; purchaseId: string | null; quarterHours: number }>,
  ): Promise<void> {
    const { writeMovement } = await import('./ledger.js');
    const at = nowMs();
    for (const item of returns) {
      const lotRows = await clientQuery<Row>(client, `SELECT valid_through, remainder_qh, member_id FROM lots WHERE id = $1`, [item.lotId]);
      const lot = lotRows[0];
      if (!lot || lot.valid_through === null) continue;
      const home = await clientQuery<Row>(
        client,
        `SELECT si.time_zone FROM users u JOIN sites si ON si.id = u.site_id WHERE u.id = $1`,
        [memberId],
      );
      const zone = home.length > 0 ? String(home[0].time_zone) : 'UTC';
      const expiryInstant = zoneDayStart(datePlusDays(String(lot.valid_through).slice(0, 10), 1), zone);
      if (at >= expiryInstant) {
        await clientQuery(client, `UPDATE lots SET remainder_qh = GREATEST(0, remainder_qh - $1) WHERE id = $2`, [item.quarterHours, item.lotId]);
        await writeMovement(client, {
          memberId,
          tenantId,
          kind: 'pack_expiry',
          fromAccount: 'available',
          toAccount: 'expired',
          quarterHours: item.quarterHours,
          actor: null,
          atMs: at,
          lots: [item],
        });
      }
    }
  }
}

function localDateAt(zone: string, at: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(at));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

const run = async (): Promise<void> => {
  const server = new PilotServer();
  await server.start();
};

void run();
