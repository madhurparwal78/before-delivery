import { createServer } from 'node:http';
import { migrate } from './db';
import { config } from './config';
import { dispatch } from './http';
import { attachHub, closeConnections } from './hub';
import { sweepLocks } from './locks';
import { purgeExpired } from './routes/projects';
import { startServiceJobs } from './routes/services';
import './routes/index';
import { storage } from './services';

const server = createServer((req, res) => void dispatch(req, res));
attachHub(server);
server.listen(config.port, '0.0.0.0', () => console.log(`Halation Studio listening on ${config.port}`));

const every = (ms: number, work: () => Promise<void>): void => {
  setInterval(() => void work().catch((error: Error) => console.error(error.message)), ms).unref();
};

async function ensureBucket(): Promise<void> {
  for (;;) {
    try {
      await storage.ensureBucket();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

void migrate().then(() => {
  startServiceJobs();
  every(1000, sweepLocks);
  every(5000, purgeExpired);
});
void ensureBucket();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    closeConnections();
    server.close(() => process.exit(0));
  });
}

// One failed request or socket must never take the server down.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) process.on(event, (error) => console.error(error));
