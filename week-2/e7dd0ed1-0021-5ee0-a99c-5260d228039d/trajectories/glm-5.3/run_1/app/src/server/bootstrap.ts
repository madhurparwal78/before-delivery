import { config } from './config.js';
import { migrate, seed } from './seed.js';
import { ensureBucket } from './storage.js';
import { startReplicationLoop } from './replication.js';
import { startWebhookLoop } from './webhooks.js';
import { startLifecycleLoop } from './lifecycle.js';
import { startBillingLoop, startMailLoop } from './billing.js';

/** Applies schema and seed, then starts every background worker. */
export async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      await seed();
      break;
    } catch (e) {
      console.error('[farshore] schema/seed pending:', (e as Error).message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  try { await ensureBucket(); } catch { /* retried by storage calls */ }
  startReplicationLoop();
  startWebhookLoop();
  startLifecycleLoop();
  startBillingLoop();
  startMailLoop();
  console.log('[farshore] background workers started');
}

void config;
