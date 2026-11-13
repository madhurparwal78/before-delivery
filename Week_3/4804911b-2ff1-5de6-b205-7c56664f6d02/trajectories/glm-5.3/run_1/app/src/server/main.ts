import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { loadConfig, type Config } from './config.js';
import { createPool, applySchemaAndSeed } from './db/pool.js';
import { Clock } from './services/clock.js';
import { Storage } from './services/storage.js';
import { SvixService, attemptSucceeded, attemptPending } from './services/svix.js';
import { PrintService } from './services/print.js';
import { WorkQueue, BrokenJobError, type JobBody } from './services/queue.js';
import { SearchIndex } from './services/search.js';
import { PriceContext } from './domain/context.js';
import { RateLimiter, sendJson } from './api/http.js';
import { displayDate, kolkataToday, rupeesPlain } from '../shared/domain.js';
import { renderPage } from './pages.js';
import { serveAsset } from './assets.js';
import { handleApi } from './routes.js';

const SENTENCES = {
  printOutage: 'Printing is down. The prices on this page are still correct.',
  storageOutage: 'Stored copies are unavailable right now. The prices on this page are still correct.',
  messageOutage: 'Stockist messages are queued. Nothing has been lost.',
  workOutage: 'Background work is queued. Nothing has been lost.',
  unknownBatch: "We can't find that batch. Check the code printed near the best-before date.",
  unknownPack: "This pack isn't in the programme.",
  staleDraft: 'This draft changed in another tab. Reload to see it.',
  closedWrapper: 'No notice allows old wrappers for this pack on that date.',
  badCredentials: "That email and password don't match.",
  unavailable: 'The record is unavailable. Please try again shortly.',
  badOrigin: 'Requests from other origins are not allowed.',
  rotationUnavailable: 'Rotation needs the message service. Try again shortly.',
  rotationInProgress: 'This secret is already being rotated.',
  nothingToRecover: 'Nothing on this endpoint is waiting for recovery.',
};

interface App {
  config: Config;
  clock: Clock;
  pool: Pool;
  prices: PriceContext;
  storage: Storage;
  svix: SvixService;
  printer: PrintService;
  queue: WorkQueue;
  search: SearchIndex;
  copyId: string;
  dbReady: boolean;
  lookupLimiter: RateLimiter;
  signInLimiter: RateLimiter;
}

export type { App };


async function main(): Promise<void> {
  const config = loadConfig();
  const clock = new Clock(config.intervalTestClock);
  const pool = createPool(config.databaseUrl);
  const storage = new Storage(config);
  const svix = new SvixService(config.svixUrl, config.svixApiKey);
  const printer = new PrintService(config.gotenbergUrl);
  const search = new SearchIndex(config, 'pending');

  let copyId = '';
  const prices = new PriceContext(pool, () => clock.today());
  const lookupLimiter = new RateLimiter(60, 60000);
  const signInLimiter = new RateLimiter(5, 60000);

  const queue = new WorkQueue(config.amqpUrl, config.amqpConnectAddress, 'pending');
  const app: App = {
    config,
    clock,
    pool,
    prices,
    storage,
    svix,
    printer,
    queue,
    search,
    copyId: '',
    dbReady: false,
    lookupLimiter,
    signInLimiter,
  };

  async function connectDb(): Promise<void> {
    try {
      copyId = await applySchemaAndSeed(pool);
      app.copyId = copyId;
      app.dbReady = true;
      search['copyId'] = copyId; // the index name carries the copy id
      queue['copyId'] = copyId; // as do the queue names
      await storage.init();
      await onDatabaseReady();
    } catch (e) {
      app.dbReady = false;
      setTimeout(connectDb, 3000);
    }
  }
  void connectDb();

  async function onDatabaseReady(): Promise<void> {
    // retry seeded renders and index builds on each boot
    const versions = await pool.query<{ number: string; version: number }>(
      `SELECT number, version FROM notice_versions WHERE print_state IN ('pending','failed') ORDER BY number, version`
    );
    for (const v of versions.rows) {
      await enqueue({ jobId: `render-${v.number}-v${v.version}`, kind: 'render', number: v.number, version: v.version });
    }
    const skus = await pool.query<{ code: string }>('SELECT code FROM skus ORDER BY catalogue_order');
    for (const s of skus.rows) {
      await enqueue({ jobId: `index-${s.code}`, kind: 'index', skuCode: s.code });
    }
  }

  async function enqueue(job: JobBody): Promise<void> {
    await pool.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', [job.kind, JSON.stringify(job)]);
  }

  // Workers read current Postgres state, never data in the job body beyond naming the target.
  queue.on('render', async (job) => {
    const number = String(job.number);
    const version = Number(job.version);
    const v = await pool.query<{ print_state: string; title: string; effective_date: string; published_at: Date; reason: string | null }>(
      'SELECT print_state, title, effective_date::text, published_at, reason FROM notice_versions WHERE number = $1 AND version = $2 FOR UPDATE',
      [number, version]
    );
    if (v.rows.length === 0) throw new BrokenJobError('missing target');
    const row = v.rows[0];
    if (row.print_state === 'printable') return; // a replay changes nothing
    const rows = await pool.query<{ name: string; old_mrp_paise: number; revised_mrp_paise: number }>(
      'SELECT name, old_mrp_paise, revised_mrp_paise FROM notice_rows WHERE number = $1 AND version = $2 ORDER BY row_index',
      [number, version]
    );
    const html = printer.buildHtml(
      row.title,
      number,
      version,
      displayDate(row.effective_date),
      displayDate(kolkataToday(new Date(row.published_at))),
      rows.rows.map((r) => ({
        name: r.name,
        oldMrpRupees: rupeesPlain(r.old_mrp_paise),
        revisedMrpRupees: rupeesPlain(r.revised_mrp_paise),
      }))
    );
    const bytes = await printer.render(html);
    if (!bytes) {
      await pool.query("UPDATE notice_versions SET print_state = 'failed' WHERE number = $1 AND version = $2 AND print_state = 'pending'", [number, version]);
      return;
    }
    const key = `${copyId}/notices/${number}/v${version}.pdf`;
    try {
      await storage.putObject(key, bytes, 'application/pdf');
    } catch {
      await pool.query("UPDATE notice_versions SET print_state = 'failed' WHERE number = $1 AND version = $2 AND print_state = 'pending'", [number, version]);
      return;
    }
    const sha = storage.sha256(bytes);
    const upd = await pool.query(
      "UPDATE notice_versions SET print_state = 'printable', pdf_sha256 = $3 WHERE number = $1 AND version = $2 AND print_state = 'pending'",
      [number, version, sha]
    );
    if (upd.rowCount === 0) {
      // already stored: bytes, ETag and last-modified stay as stored
      return;
    }
  });

  queue.on('index', async (job) => {
    const code = String(job.skuCode);
    await indexSku(code);
  });

  queue.on('send', async (job) => {
    const eventId = String(job.eventId);
    await deliverEvent(eventId);
  });

  queue.onBroken = (reason) => {
    void (async () => {
      try {
        await pool.query('INSERT INTO held_work (job_body, reason) VALUES ($1, $2)', ['(moved to dead queue)', reason]);
      } catch {
        // db down; counted on the next write
      }
    })();
  };

  async function indexSku(code: string): Promise<void> {
    const sku = await prices.getSku(code);
    if (!sku) throw new BrokenJobError('missing target');
    const aliases = await pool.query<{ alias: string }>('SELECT alias FROM aliases WHERE sku_code = $1 ORDER BY id', [code]);
    const titles = await pool.query<{ title: string }>(
      `SELECT DISTINCT nv.title FROM notice_versions nv
       JOIN notice_rows r ON r.number = nv.number AND r.version = nv.version
       JOIN (SELECT number, max(version) AS version FROM notice_versions GROUP BY number) lv
         ON lv.number = nv.number AND lv.version = nv.version
       WHERE r.sku_code = $1`,
      [code]
    );
    search.markChange(code);
    await search.upsert({
      id: code,
      skuName: sku.name,
      drinkName: sku.drinkName,
      aliases: aliases.rows.map((a) => a.alias),
      noticeTitles: titles.rows.map((t) => t.title),
    });
  }

  async function deliverEvent(eventId: string): Promise<void> {
    const d = await pool.query<{ event_id: string; account_id: string; endpoint_id: string; event_type: string; notice_number: string | null; notice_version: number | null; state: string; redelivery_outstanding: boolean; handed_over: boolean; cancelled: boolean }>(
      'SELECT event_id, account_id, endpoint_id, event_type, notice_number, notice_version, state, redelivery_outstanding, handed_over, cancelled FROM deliveries WHERE event_id = $1',
      [eventId]
    );
    if (d.rows.length === 0) throw new BrokenJobError('missing target');
    const e = d.rows[0];
    if (e.cancelled) return; // a removed endpoint receives nothing
    // A send job for a redelivery sends only for a request still outstanding.
    if (e.redelivery_outstanding && !e.handed_over) {
      // redelivery path handled by redeliverEvent
    }
    if (!e.handed_over) {
      const ep = await pool.query<{ svix_endpoint_id: string | null; registered: boolean }>(
        'SELECT svix_endpoint_id, registered FROM endpoints WHERE id = $1 AND removed = false',
        [e.endpoint_id]
      );
      if (ep.rows.length === 0) throw new BrokenJobError('missing target');
      const epRow = ep.rows[0];
      if (!epRow.registered || !epRow.svix_endpoint_id) return; // wait for registration
      const payload = await buildPayload(e.event_id, e.event_type, e.notice_number, e.notice_version);
      const ok = await svix.sendMessage(e.account_id, e.event_id, e.event_type, payload);
      if (ok) {
        await pool.query('UPDATE deliveries SET handed_over = true WHERE event_id = $1', [e.event_id]);
        // check attempts now
        await refreshAttempts(e.account_id, e.endpoint_id);
      }
      return;
    }
    if (e.redelivery_outstanding) {
      const ep = await pool.query<{ svix_endpoint_id: string | null }>(
        'SELECT svix_endpoint_id FROM endpoints WHERE id = $1 AND removed = false',
        [e.endpoint_id]
      );
      if (ep.rows.length === 0) throw new BrokenJobError('missing target');
      const r = await svix.resend(e.account_id, ep.rows[0].svix_endpoint_id ?? '', e.event_id);
      if (r) {
        await pool.query('UPDATE deliveries SET redelivery_outstanding = false, redelivery_requested = true WHERE event_id = $1', [e.event_id]);
      }
    }
  }

  async function buildPayload(eventId: string, eventType: string, number: string | null, version: number | null): Promise<Record<string, unknown>> {
    if (number === null || version === null) {
      return { eventType: 'interval.test', eventId, endpointId: eventId.split('-')[1] ?? '' };
    }
    const v = await pool.query<{ title: string; effective_date: string }>(
      'SELECT title, effective_date::text FROM notice_versions WHERE number = $1 AND version = $2',
      [number, version]
    );
    const rows = await pool.query<{ sku_code: string; name: string; kind: string; old_mrp_paise: number; revised_mrp_paise: number }>(
      'SELECT sku_code, name, kind, old_mrp_paise, revised_mrp_paise FROM notice_rows WHERE number = $1 AND version = $2 ORDER BY row_index',
      [number, version]
    );
    return {
      eventType,
      eventId,
      noticeNumber: number,
      version,
      supersedesVersion: version > 1 ? version - 1 : null,
      effectiveDate: v.rows[0]?.effective_date,
      title: v.rows[0]?.title,
      rows: rows.rows.map((r) => ({
        skuCode: r.sku_code,
        name: r.name,
        kind: r.kind,
        oldMrpPaise: r.old_mrp_paise,
        revisedMrpPaise: r.revised_mrp_paise,
      })),
      pdfPath: `/api/notices/${number}/versions/${version}/pdf`,
    };
  }

  async function refreshAttempts(accountId: string, endpointId: string): Promise<void> {
    const ep = await pool.query<{ id: string; svix_endpoint_id: string | null }>(
      'SELECT id, svix_endpoint_id FROM endpoints WHERE id = $1',
      [endpointId]
    );
    if (ep.rows.length === 0 || !ep.rows[0].svix_endpoint_id) return;
    const attempts = await svix.listAttempts(accountId, ep.rows[0].svix_endpoint_id);
    if (!attempts) return;
    const byEvent = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const list = byEvent.get(a.eventId) ?? [];
      list.push(a);
      byEvent.set(a.eventId, list);
    }
    const deliveries = await pool.query<{ event_id: string; known_attempt_count: number; state: string; redelivery_outstanding: boolean; handed_over: boolean }>(
      'SELECT event_id, known_attempt_count, state, redelivery_outstanding, handed_over FROM deliveries WHERE endpoint_id = $1',
      [endpointId]
    );
    for (const d of deliveries.rows) {
      const seen = byEvent.get(d.event_id) ?? [];
      if (seen.length <= d.known_attempt_count) continue;
      // record the new attempts
      for (const a of seen.slice(d.known_attempt_count)) {
        await pool.query('INSERT INTO delivery_attempts (event_id, response_status, outcome, at) VALUES ($1, $2, $3, $4)', [
          d.event_id,
          a.responseStatusCode,
          attemptSucceeded(a) ? 'success' : attemptPending(a) ? 'pending' : 'failed',
          a.timestamp,
        ]);
      }
      const success = seen.some(attemptSucceeded);
      await pool.query('UPDATE deliveries SET known_attempt_count = $2 WHERE event_id = $1', [d.event_id, seen.length]);
      let newState = d.state;
      if (success) {
        newState = d.redelivery_outstanding || d.state === 'redelivered' ? 'redelivered' : 'delivered';
      } else if (seen.length > 0) {
        newState = 'failed';
      }
      if (newState !== d.state) {
        await pool.query('UPDATE deliveries SET state = $2 WHERE event_id = $1', [d.event_id, newState]);
      }
      if (success) {
        await pool.query('UPDATE deliveries SET redelivery_outstanding = false WHERE event_id = $1', [d.event_id]);
      }
    }
  }

  // The relay carries confirmed outbox rows to the durable work queue. Rows whose
  // work is a provider call run here; the rest become durable jobs. A provider
  // failure keeps the row, so the work is retried until accepted.
  async function relayOnce(): Promise<void> {
    const client = await pool.connect();
    const done: number[] = [];
    const requeued: number[] = [];
    try {
      await client.query('BEGIN');
      const rows = await client.query<{ id: number; kind: string; payload: unknown }>(
        'SELECT id, kind, payload FROM outbox ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100'
      );
      for (const r of rows.rows) {
        const payload = r.payload as Record<string, unknown>;
        if (r.kind === 'register_endpoint') {
          const ok = await runRegisterWork({ endpointId: String(payload.endpointId ?? '') });
          if (ok) done.push(r.id);
          else requeued.push(r.id);
        } else if (r.kind === 'remove_endpoint') {
          const ok = await runRemoveWork({ endpointId: String(payload.endpointId ?? '') });
          if (ok) done.push(r.id);
          else requeued.push(r.id);
        } else if (r.kind === 'render' || r.kind === 'index' || r.kind === 'send') {
          const ok = await queue.publish(r.payload as JobBody);
          if (ok) done.push(r.id);
          else requeued.push(r.id);
        } else {
          done.push(r.id);
        }
      }
      for (const id of done) {
        await client.query('DELETE FROM outbox WHERE id = $1', [id]);
      }
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  // Removals are applied at Svix even when queued during an outage; a provider
  // that refuses keeps the row so the removal is retried.
  async function runRemoveWork(job: { endpointId: string }): Promise<boolean> {
    const ep = await pool.query<{ id: string; account_id: string; svix_endpoint_id: string | null }>(
      'SELECT id, account_id, svix_endpoint_id FROM endpoints WHERE id = $1',
      [job.endpointId]
    );
    if (ep.rows.length === 0) return true;
    const e = ep.rows[0];
    if (!e.svix_endpoint_id) return true;
    return svix.deleteEndpoint(e.account_id, e.svix_endpoint_id);
  }

  // Registration work: endpoints saved during a Svix outage are registered later
  // with the secret issued during the outage.
  async function runRegisterWork(job: { endpointId: string }): Promise<boolean> {
    const ep = await pool.query<{ id: string; account_id: string; url: string; signing_secret: string; svix_endpoint_id: string | null; registered: boolean; removed: boolean }>(
      'SELECT id, account_id, url, signing_secret, svix_endpoint_id, registered, removed FROM endpoints WHERE id = $1',
      [job.endpointId]
    );
    if (ep.rows.length === 0) return true;
    const e = ep.rows[0];
    if (e.removed) return true;
    if (e.registered) return true;
    const ok = await svix.ensureApplication(e.account_id);
    if (!ok) return false;
    const svixId = await svix.createEndpoint(e.account_id, e.url, e.signing_secret);
    if (!svixId) return false;
    await pool.query('UPDATE endpoints SET registered = true, svix_endpoint_id = $2 WHERE id = $1', [e.id, svixId]);
    // An endpoint registered now receives only later versions.
    await refreshAttempts(e.account_id, e.id);
    return true;
  }

  setInterval(() => {
    void relayOnce().catch(() => undefined);
  }, 1000).unref();

  void queue.tryConnect();

  // Contact loops: at least every 10 seconds for each dependency. The Svix loop
  // also reads fresh attempts, so a delivery's state rises from the provider.
  setInterval(() => {
    void svix.contactCheck().then(async () => {
      try {
        const eps = await pool.query<{ id: string; account_id: string }>('SELECT id, account_id FROM endpoints WHERE removed = false AND svix_endpoint_id IS NOT NULL');
        for (const e of eps.rows) {
          await refreshAttempts(e.account_id, e.id);
        }
      } catch {
        // the next tick retries
      }
    });
  }, 10000).unref();
  setInterval(() => void search.contactCheck(), 10000).unref();
  setInterval(() => void storage.contact(), 10000).unref();
  setInterval(() => void queue.contactCheck(), 10000).unref();

  const server = createServer((req, res) => {
    void handle(app, req, res).catch((e: unknown) => {
      console.error('request failed', req.method, req.url, e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
      else res.end();
    });
  });
  server.listen(config.port, '0.0.0.0');
  console.log(`interval serving on ${config.port}`);
}

async function handle(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 1. Foreign origin: 403 for state-changing requests.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host) {
      try {
        const o = new URL(origin);
        if (o.host !== host) {
          return sendJson(res, 403, { error: 'bad_origin', message: SENTENCES.badOrigin });
        }
      } catch {
        return sendJson(res, 403, { error: 'bad_origin', message: SENTENCES.badOrigin });
      }
    }
  }

  // Health
  if (path === '/api/health') {
    if (!app.dbReady) return sendJson(res, 503, { status: 'unavailable' });
    try {
      await app.pool.query('SELECT 1');
      return sendJson(res, 200, { status: 'ok' });
    } catch {
      return sendJson(res, 503, { status: 'unavailable' });
    }
  }

  // Static assets
  if (path.startsWith('/assets/')) {
    serveAsset(path, res);
    return;
  }

  if (!app.dbReady) {
    if (path.startsWith('/api/')) {
      return sendJson(res, 503, { error: 'unavailable', message: SENTENCES.unavailable });
    }
  }

  // API routes
  if (path.startsWith('/api/')) {
    await handleApi(app, req, res, url);
    return;
  }

  // Pages
  await renderPage(app, path, res);
}

export { main };

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
