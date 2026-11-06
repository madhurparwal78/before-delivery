import { createServer } from 'node:http';
import { config } from './config.js';
import { connectWithRetry } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { handle, register } from './http/app.js';
import { promoteDueMissions } from './domain/missions.js';
import { sweepStaleHeartbeats } from './domain/presence.js';
import { sweepMailSlots, sweepPostboxKeys, sweepPostcards } from './domain/postcards.js';
import { coreRoutes } from './routes/core.js';
import { parcelRoutes } from './routes/parcels.js';
import { authRoutes } from './routes/auth.js';
import { presenceRoutes } from './routes/presence.js';
import { founderRoutes } from './routes/founder.js';
import { postcardRoutes } from './routes/postcards.js';
import { pageRoutes } from './routes/pages.js';

register([
  ...coreRoutes,
  ...parcelRoutes,
  ...authRoutes,
  ...presenceRoutes,
  ...founderRoutes,
  ...postcardRoutes,
  ...pageRoutes,
]);

const server = createServer((request, response) => {
  void handle(request, response);
});
server.keepAliveTimeout = 10_000;
server.listen(config.port, '0.0.0.0');

function repeat(everyMs: number, work: () => Promise<unknown>): void {
  const timer = setInterval(() => {
    void work().catch(() => undefined);
  }, everyMs);
  timer.unref();
}

await connectWithRetry(async () => {
  await applySchema();
  await applySeed();
});

repeat(250, promoteDueMissions);
repeat(15_000, sweepStaleHeartbeats);
repeat(30_000, sweepPostcards);
repeat(60_000, sweepMailSlots);
repeat(3_600_000, sweepPostboxKeys);
