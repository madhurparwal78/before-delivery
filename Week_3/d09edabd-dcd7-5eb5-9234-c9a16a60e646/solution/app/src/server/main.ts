import http from 'node:http';
import { config } from './config.js';
import { db } from './db.js';
import { hub } from './events.js';
import { healthRoutes } from './health.js';
import { notFound } from './errors.js';
import { dispatch, refuse } from './http.js';
import { mailer } from './mail.js';
import { store } from './s3.js';
import { serveStatic } from './static.js';
import { valkey } from './valkey.js';
import { accountRoutes, loadCookieSecret, seedWorkspaces } from './routes/accounts.js';
import { liveRoutes } from './routes/live.js';
import { lockRoutes } from './routes/locks.js';
import { nodeRoutes } from './routes/nodes.js';
import { placementRoutes } from './routes/placements.js';
import { playRoutes } from './routes/play.js';
import { playtestRoutes } from './routes/playtests.js';
import { propRoutes } from './routes/props.js';
import { roomRoutes } from './routes/rooms.js';
import { versionRoutes } from './routes/versions.js';
import { publishSession, settleExpired } from './domain/playtests.js';

const RETRY_MS = 2000;
const BOOT_WAIT_MS = 4000;
const SWEEP_MS = 1000;
const FOREIGN_GRACE_SECONDS = 5;

process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));

async function bootDatabase(): Promise<void> {
  for (;;) {
    try {
      if (db.migrated) {
        await loadCookieSecret();
        await seedWorkspaces();
        db.markBooted();
        return;
      }
    } catch (error) {
      console.error('boot work failed, retrying', error);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS / 4));
  }
}

/** Ends sessions past their deadline. An instance without Valkey waits a little, so one that can announce the end goes first. */
async function sweep(): Promise<void> {
  for (;;) {
    if (db.available) await settleExpired(undefined, new Date(Date.now() - (valkey.available ? 0 : FOREIGN_GRACE_SECONDS) * 1000)).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, SWEEP_MS));
  }
}

async function refreshSession(playtestId: string): Promise<void> {
  const found = await db.query<{ room_id: string }>(`SELECT room_id FROM playtests WHERE id = $1`, [playtestId]);
  if (found.rows[0]) await publishSession(found.rows[0].room_id, playtestId);
}

healthRoutes();
accountRoutes();
roomRoutes();
placementRoutes();
nodeRoutes();
lockRoutes();
liveRoutes();
propRoutes();
versionRoutes();
playtestRoutes();
playRoutes();

db.start();
const booted = bootDatabase();
store.start();
valkey.start(
  (channel, event, data) => hub.deliver(channel, event, data),
  (available) => hub.deliverAll('live', { available }),
);
mailer.start((playtestId) => void refreshSession(playtestId).catch(() => undefined));
void sweep();

await Promise.race([booted, new Promise((resolve) => setTimeout(resolve, BOOT_WAIT_MS))]);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!(await dispatch(req, res, url))) refuse(res, notFound());
      return;
    }
    await serveStatic(req, res, url.pathname);
  })
  .listen(config.port, '0.0.0.0', () => console.log(`keyway bench "${config.instance}" listening on ${config.port}`));
