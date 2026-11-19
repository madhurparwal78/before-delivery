import { config } from './config.js';
import { prepareDatabase, pool, rows } from './db.js';
import { createServer, state } from './http.js';
import { now } from './clock.js';
import { seedIfEmpty } from './seed.js';
import { ensureBucket } from './storage.js';
import { emitPostState } from './events.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCommunityRoutes } from './routes/communities.js';
import { registerPostRoutes } from './routes/posts.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerVoteRoutes } from './routes/votes.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerStreamRoutes, startFanout } from './routes/stream.js';
import { registerGradingRoutes } from './routes/grading.js';
import { registerSystemRoutes } from './routes/system.js';

const RETRY_MS = 2000;
const LOCK_SWEEP_MS = 250;

registerSystemRoutes();
registerAuthRoutes();
registerCommunityRoutes();
registerPostRoutes();
registerCommentRoutes();
registerVoteRoutes();
registerMediaRoutes();
registerReportRoutes();
registerStreamRoutes();
registerGradingRoutes();
startFanout();

/** Applies the schema and seed; while Postgres is unreachable the server keeps listening and retries. */
async function prepare(): Promise<void> {
  try {
    await prepareDatabase(seedIfEmpty);
    state.databaseReady = true;
    void ensureBucket().catch(() => undefined);
  } catch (error) {
    console.error('database not ready:', error instanceof Error ? error.message : error);
    setTimeout(() => void prepare(), RETRY_MS);
  }
}

/** A timed lock ends on the server's clock; tell open pages when it does. */
async function sweepExpiredLocks(): Promise<void> {
  if (!state.databaseReady) return;
  try {
    const ended = await rows<{ id: string }>(pool,
      'UPDATE posts SET locked = false, locked_until = NULL WHERE locked AND locked_until IS NOT NULL AND locked_until <= $1 RETURNING id',
      [now()]);
    for (const { id } of ended) await emitPostState(id);
  } catch (error) {
    console.error('lock sweep failed:', error instanceof Error ? error.message : error);
  }
}

const server = createServer();
server.listen(config.port, '0.0.0.0', () => console.log(`Moothall listening on ${config.port}`));
void prepare();
setInterval(() => void sweepExpiredLocks(), LOCK_SWEEP_MS);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
