// Loafline: waits for PostgreSQL, applies schema and seed, then serves on 0.0.0.0.
import { createServer } from 'node:http';
import './account.js';
import './audit.js';
import { openDueBatches } from './batches.js';
import './checkout.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { expireHolds } from './holds.js';
import { handleApi } from './http.js';
import { startOutbox } from './outbox.js';
import { handlePage } from './pages.js';
import './reconciliation.js';
import './refunds.js';
import './staff.js';
import { startMonitors } from './status.js';
import './stepup.js';
import { startRenewals } from './subscriptions.js';

await migrate();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const handle = url.pathname === '/api' || url.pathname.startsWith('/api/') ? handleApi : handlePage;
  handle(req, res, url).catch((error: Error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(config.port, '0.0.0.0', () => console.log(`Loafline listening on 0.0.0.0:${config.port}`));

startMonitors();
startOutbox();
startRenewals();
setInterval(() => {
  const now = new Date();
  void openDueBatches(pool, now).catch(() => undefined);
  void expireHolds(pool, now).catch(() => undefined);
}, 1000).unref();

const stop = () => {
  server.closeAllConnections();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
