import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, one, query, withAdvisoryLock } from './db.js';
import { ApiError, conflict } from './errors.js';
import { createHttpServer, type Ctx, type Reply } from './http.js';
import { authenticate } from './auth.js';
import { hashBody } from './secretStore.js';
import { seedIfEmpty } from './seed.js';
import { startScheduler, warmUp } from './scheduler.js';
import { publicSessionRoutes, sessionRoutes, signInLockoutGuard } from './routes/sessions.js';
import { peopleRoutes } from './routes/people.js';
import { vaultRoutes } from './routes/vaults.js';
import { ruleRoutes } from './routes/rules.js';
import { rotationRoutes } from './routes/rotations.js';
import { reviewRoutes } from './routes/reviews.js';
import { reportRoutes } from './routes/reports.js';
import { importRoutes } from './routes/imports.js';
import { auditRoutes, eventStreamRoute } from './routes/audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..', 'client');

const IDEMPOTENT_ENDPOINTS = new Set([
  'POST /api/people',
  'POST /api/people/:id/leave',
  'POST /api/imports',
]);

const KEY = /^[\x21-\x7e]{1,100}$/;

async function runIdempotent(ctx: Ctx, endpoint: string, run: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.header('idempotency-key');
  if (key === null || !KEY.test(key)) return run();
  const personId = ctx.caller.person.id;
  const bodyHash = hashBody(ctx.body);
  return withAdvisoryLock(`idempotency:${personId}:${endpoint}:${key}`, async () => {
    const stored = await one<{ body_hash: string; status: number | null; response: unknown }>(
      'select body_hash, status, response from idempotency where person_id = $1 and endpoint = $2 and key = $3',
      [personId, endpoint, key],
    );
    if (stored !== null) {
      if (stored.body_hash !== bodyHash) {
        throw conflict('idempotency_conflict', 'This key was used for a different request.');
      }
      if (stored.status !== null) return { status: stored.status, body: stored.response };
    }
    await query(
      `insert into idempotency (person_id, endpoint, key, body_hash) values ($1,$2,$3,$4)
         on conflict (person_id, endpoint, key) do nothing`,
      [personId, endpoint, key, bodyHash],
    );
    try {
      const reply = await run();
      if (reply.status >= 200 && reply.status < 300) {
        await query(
          'update idempotency set status = $4, response = $5 where person_id = $1 and endpoint = $2 and key = $3',
          [personId, endpoint, key, reply.status, JSON.stringify(reply.body ?? null)],
        );
      } else {
        await query('delete from idempotency where person_id = $1 and endpoint = $2 and key = $3', [
          personId,
          endpoint,
          key,
        ]);
      }
      return reply;
    } catch (error) {
      await query('delete from idempotency where person_id = $1 and endpoint = $2 and key = $3', [
        personId,
        endpoint,
        key,
      ]);
      throw error;
    }
  });
}

const server = createHttpServer({
  routes: [
    ...publicSessionRoutes,
    ...sessionRoutes,
    ...peopleRoutes,
    ...vaultRoutes,
    ...ruleRoutes,
    ...rotationRoutes,
    ...reviewRoutes,
    ...reportRoutes,
    ...importRoutes,
    ...auditRoutes,
    eventStreamRoute,
  ],
  clientRoot,
  authenticate,
  lockoutGuard: async (ctx) => {
    if (ctx.method !== 'POST' || ctx.path !== '/api/sessions') return;
    const body = ctx.body;
    const handle =
      typeof body === 'object' && body !== null ? (body as { username?: unknown }).username : undefined;
    if (typeof handle === 'string') await signInLockoutGuard(handle);
  },
  runIdempotent,
  idempotentEndpoints: IDEMPOTENT_ENDPOINTS,
  log: (message) => {
    process.stderr.write(`${message}\n`);
  },
});

async function boot(): Promise<void> {
  await applySchema();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Lockset is listening on ${config.port}\n`);
  });
  await seedIfEmpty();
  await warmUp().catch(() => undefined);
  startScheduler();
}

void boot().catch((error: unknown) => {
  process.stderr.write(`Lockset could not start: ${error instanceof ApiError ? error.code : 'boot failed'}\n`);
  process.exit(1);
});
