import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { App } from './http/app.js';
import { authRoutes } from './routes/auth.js';
import { checkinRoutes } from './routes/checkin.js';
import { contentRoutes } from './routes/content.js';
import { deskRoutes } from './routes/desk.js';
import { holdRoutes } from './routes/holds.js';
import { cancelRoutes, paymentRoutes } from './routes/payments.js';
import { publicRoutes } from './routes/publicApi.js';
import { seatRoutes } from './routes/seats.js';
import { waitlistRoutes } from './routes/waitlist.js';
import { seedContent, seedStaffAccounts } from './seed.js';
import { ensureBucket } from './services/s3.js';
import { startWorkers } from './workers/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = new App(join(here, 'public'));

app.addAll(authRoutes);
app.addAll(publicRoutes);
app.addAll(holdRoutes);
app.addAll(paymentRoutes);
app.addAll(cancelRoutes);
app.addAll(waitlistRoutes);
app.addAll(seatRoutes);
app.addAll(deskRoutes);
app.addAll(contentRoutes);
app.addAll(checkinRoutes);

const server = app.server();
server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Opaline Bench Days listening on ${config.port}\n`);
});

function warn(what: string, error: unknown): void {
  process.stderr.write(
    `${what} is not ready yet: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
}

async function prepare(): Promise<void> {
  try {
    await applySchema();
    await seedStaffAccounts();
    startWorkers();
  } catch (error) {
    warn('Postgres', error);
    setTimeout(() => void prepare(), 3_000).unref();
    return;
  }
  void retryUntilReady('MinIO', ensureBucket);
  void retryUntilReady('PocketBase', seedContent);
}

async function retryUntilReady(what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    warn(what, error);
    setTimeout(() => void retryUntilReady(what, work), 10_000).unref();
  }
}

void prepare();
