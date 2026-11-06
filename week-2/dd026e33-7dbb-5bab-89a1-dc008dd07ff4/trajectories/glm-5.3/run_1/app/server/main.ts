import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.ts';
import { createDb } from './db.ts';
import { createStorage } from './providers/storage.ts';
import { KillBill } from './providers/killbill.ts';
import { createMail } from './providers/mail.ts';
import { refreshStatus, startStatusLoop } from './providers/status.ts';
import { applySchema } from './schema.ts';
import { seedIfEmpty } from './seed.ts';
import { dispatch } from './router.ts';
import { routes } from './routes.ts';
import type { AppCtx, ServiceStatus } from './context.ts';
import { startQueueWorker, queuePass } from './queue.ts';
import { purgeOldIdempotency } from './idem.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../browser-assets');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.databaseUrl);
  const storage = createStorage(env);
  const killbill = new KillBill(env);
  const mail = createMail(env);
  const status: ServiceStatus = { storage: 'down', billing: 'down', mail: 'down', checkedAt: 0 };
  const ctx: AppCtx = { db, env, storage, killbill, mail, status };

  // Schema and seed apply on every serve start, without duplicating anything.
  await applySchema(db);
  await seedIfEmpty(db, env);

  // Probe providers once at boot; failures never stop the server.
  try {
    await refreshStatus(ctx);
  } catch {
    // keep serving
  }
  startStatusLoop(ctx);

  // The catalog is ensured in the background until it succeeds.
  const ensureCatalogLoop = async (): Promise<void> => {
    for (;;) {
      try {
        await killbill.ensureCatalog();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  };
  void ensureCatalogLoop();

  // Queue worker: applies queued provider effects, retried until they land.
  await startQueueWorker(ctx);

  // Refresh bay billing for cars that need attention, every pass.
  setInterval(async () => {
    try {
      await refreshBayBilling(ctx);
    } catch {
      // keep the loop alive
    }
  }, 5_000).unref();

  setInterval(async () => {
    try {
      await purgeOldIdempotency(db);
    } catch {
      // ignore
    }
  }, 3_600_000).unref();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://internal');
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
        const handled = await dispatch(ctx, routes, req, res);
        if (handled) return;
      }
      await serveStatic(req, res);
    } catch (err) {
      process.stderr.write(`outer: ${err instanceof Error ? err.stack : String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal' }));
      } else {
        res.destroy();
      }
    }
  });

  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`lacquer listening on ${env.port}\n`);
  });
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://internal');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // never serve anything outside the built browser assets
  const resolved = path.normalize(path.join(publicDir, pathname));
  if (!resolved.startsWith(publicDir + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!existsSync(resolved)) {
    // app pages: serve the shell for any non-API path
    if (path.extname(resolved) === '') {
      const indexPath = path.join(publicDir, 'index.html');
      const index = await readFile(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(index);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const extension = path.extname(resolved);
  const body = await readFile(resolved);
  res.writeHead(200, {
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Content-Length': String(body.length),
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=86400',
  });
  res.end(body);
}

/** Live-refresh bay billing for stored cars whose billing needs attention. */
async function refreshBayBilling(ctx: AppCtx): Promise<void> {
  const rows = await ctx.db.query<{ id: string; bay_subscription_id: string | null; bay_class: string | null; bay_billing_cancel_requested: boolean; bay_billing_end_date: string | null }>(
    `SELECT c.id, c.bay_subscription_id, b.class AS bay_class, c.bay_billing_cancel_requested, c.bay_billing_end_date
     FROM cars c LEFT JOIN bays b ON b.id = c.bay_id
     WHERE (c.status = 'stored' AND c.bay_subscription_id IS NOT NULL AND c.bay_billing_charged_through IS NULL)
        OR (c.bay_billing_cancel_requested = TRUE AND c.bay_billing_end_date IS NULL)`,
  );
  for (const car of rows) {
    if (!car.bay_subscription_id) continue;
    try {
      const sub = await ctx.killbill.getSubscription(car.bay_subscription_id);
      const price = car.bay_class ? priceForClass(car.bay_class) : null;
      await ctx.db.query(
        `UPDATE cars SET bay_billing_charged_through = COALESCE($2, bay_billing_charged_through),
          bay_billing_plan_price = COALESCE($3, bay_billing_plan_price) WHERE id = $1`,
        [car.id, sub.chargedThroughDate, price],
      );
    } catch {
      // keep the last known values
    }
  }
}

function priceForClass(klass: string): string {
  switch (klass) {
    case 'standard': return '480.00';
    case 'covered_lift': return '690.00';
    case 'sealed_capsule': return '950.00';
    default: return '480.00';
  }
}

void queuePass;
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
