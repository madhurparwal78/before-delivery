import { config } from './config.js';
import { startDatabaseProbe } from './db.js';
import { startHttpServer } from './http/server.js';
import { startMailSender } from './mail/queue.js';

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`unhandled rejection: ${String(reason)}\n`);
});

async function main(): Promise<void> {
  startDatabaseProbe();
  startMailSender();
  await startHttpServer();
  process.stdout.write(`Saltreach listening on ${config.port}\n`);
}

void main();
