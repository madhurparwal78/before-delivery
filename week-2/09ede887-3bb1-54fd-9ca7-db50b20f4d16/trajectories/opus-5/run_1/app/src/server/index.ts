import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings } from './config.js';
import { Accounts } from './db/accounts.js';
import { BookingStore } from './db/booking.js';
import { Contest } from './db/contest.js';
import { IdempotencyKeys } from './db/idempotency.js';
import { Database } from './db/pool.js';
import { Reads } from './db/reads.js';
import { Readiness } from './db/readiness.js';
import { createAppServer } from './http/server.js';

const settings = readSettings();
const database = new Database(settings);
const readiness = new Readiness(database);
readiness.start();

const accounts = new Accounts(database, settings.signinThrottleWindowSeconds);
const server = createAppServer({
  services: {
    accounts,
    reads: new Reads(database),
    booking: new BookingStore(database, settings.holdSeconds),
    contest: new Contest(database, settings.contestClosesAt),
    idempotency: new IdempotencyKeys(database, settings.idempotencyKeyTtlSeconds),
  },
  accounts,
  readiness,
  publicDirectory: join(dirname(fileURLToPath(import.meta.url)), 'public'),
});

server.listen(settings.port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    readiness.stop();
    server.close(() => {
      void database.close().then(() => process.exit(0));
    });
  });
}
