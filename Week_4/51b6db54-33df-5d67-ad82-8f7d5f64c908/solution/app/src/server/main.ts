import { fileURLToPath } from 'node:url';
import { lookupSession } from './auth';
import { startClock, syncClock } from './clock';
import { config } from './config';
import { migrate, pool } from './db';
import { broadcastClock } from './hub';
import { createApp } from './http';
import { startJobWorker } from './jobs';
import { startMailer } from './mailer';
import { seedDemo } from './seed';
import { sharePageStatus, sweepLinks } from './share';
import { announceDelivery } from './comments';
import { ensureBucket, storageReachable } from './storage';
import { route } from './http';
import './projects';
import './sprites';
import './strokes';
import './palette';
import './tiles';
import './snapshots';
import './live';

const timeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

route('GET', '/api/health', async () => {
  const database = await timeout(pool.query('SELECT 1'), 2500).then(() => true, () => false);
  return { status: database && (await storageReachable()) ? 'ok' : 'unavailable' };
});

async function prepare(): Promise<boolean> {
  try {
    await migrate();
    await startClock();
    await seedDemo();
    await ensureBucket();
    return true;
  } catch (error) {
    process.stderr.write(`start-up: ${String((error as Error).message)}\n`);
    return false;
  }
}

/** The latest start-up attempt; requests wait for one in flight and answer 503 only once it has failed. */
let attempt = prepare();

async function initialise(): Promise<void> {
  while (!(await attempt)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempt = prepare();
  }
}

function startWorkers(): void {
  startMailer(announceDelivery);
  startJobWorker();
  setInterval(() => {
    void syncClock().then((moved) => (moved ? broadcastClock() : undefined)).catch(() => undefined);
    void sweepLinks().catch(() => undefined);
  }, 500);
}

const server = createApp({
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  lookupSession: (token) => lookupSession(token).catch(() => null),
  pageStatus: sharePageStatus,
  ready: () => attempt,
});

server.listen(config.port, '0.0.0.0');
void initialise().then(startWorkers);
