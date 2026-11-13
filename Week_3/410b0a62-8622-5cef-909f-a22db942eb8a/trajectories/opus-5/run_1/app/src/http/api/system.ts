import { config, SEED_BODY_MAX_BYTES } from '../../config.js';
import { storageReachable } from '../../storage/s3.js';
import { demoSetLoaded, loadSeed, resetRecords, type SeedBody } from '../../seed/engine.js';
import { addConnection, removeConnection, type LiveConnection } from '../../services/live.js';
import { readJsonBody } from '../body.js';
import { requireUser, type RequestContext } from '../context.js';
import { notFound } from '../errors.js';
import { sendJson } from '../respond.js';

let databaseReached = false;

export function markDatabaseReached(): void {
  databaseReached = true;
}

export async function health(ctx: RequestContext): Promise<void> {
  if (!databaseReached) {
    sendJson(ctx.res, 503, { status: 'starting' });
    return;
  }
  const reachable = await storageReachable();
  sendJson(ctx.res, 200, { status: reachable ? 'ok' : 'unavailable' });
}

function requireGradingKey(ctx: RequestContext): void {
  const provided = ctx.req.headers['x-grading-key'];
  if (config.gradingKey === undefined || provided !== config.gradingKey) throw notFound();
}

export async function gradingSeed(ctx: RequestContext): Promise<void> {
  requireGradingKey(ctx);
  const body = (await readJsonBody(ctx.req, SEED_BODY_MAX_BYTES)) as SeedBody;
  if (await demoSetLoaded()) await resetRecords();
  sendJson(ctx.res, 200, await loadSeed(body, ''));
}

export async function gradingReset(ctx: RequestContext): Promise<void> {
  requireGradingKey(ctx);
  await resetRecords();
  sendJson(ctx.res, 200, { status: 'reset' });
}

export async function live(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  ctx.res.write('retry: 1000\n\n');
  const connection: LiveConnection = {
    userId: user.id,
    send(event, data) {
      ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
  addConnection(connection);
  const heartbeat = setInterval(() => ctx.res.write(': heartbeat\n\n'), config.liveHeartbeatMs);
  const close = (): void => {
    clearInterval(heartbeat);
    removeConnection(connection);
  };
  ctx.req.on('close', close);
  ctx.res.on('close', close);
}
