import { applySchemaAndSeed } from './db/seed.js';
import { env } from './env.js';
import { createApp } from './http/app.js';
import { startHealthMonitor } from './services/health.js';
import { startExpiryReminders } from './services/reminders.js';

async function main(): Promise<void> {
  await applySchemaAndSeed();
  const app = createApp();
  app.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`Pilotlight is serving on port ${env.port}\n`);
  });
  startHealthMonitor();
  startExpiryReminders();
}

void main().catch((error: unknown) => {
  process.stderr.write(`Pilotlight could not start: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});
