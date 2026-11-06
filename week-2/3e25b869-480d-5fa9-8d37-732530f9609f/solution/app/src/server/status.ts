// Dependency status: Kill Bill checked every 5 seconds, the catalog made sure of until it succeeds.
import { route } from './http.js';
import { ensureCatalog, healthy } from './killbill.js';
import { mailStatus } from './outbox.js';

let billingUp: boolean | null = null;
let checkedAt = new Date();

async function checkBilling(): Promise<void> {
  billingUp = await healthy();
  checkedAt = new Date();
}

async function catalogUntilReady(): Promise<void> {
  try {
    await ensureCatalog();
  } catch (error) {
    console.error(`catalog: ${(error as Error).message}`);
    setTimeout(() => void catalogUntilReady(), 10_000).unref();
  }
}

export function startMonitors(): void {
  void checkBilling();
  setInterval(() => void checkBilling(), 5000).unref();
  void catalogUntilReady();
}

route('GET', '/api/health', async () => ({ status: 200, body: { status: 'ok' } }));

route('GET', '/api/status', async () => ({
  status: 200,
  body: { billing: billingUp === false ? 'down' : 'up', mail: mailStatus(), checked_at: checkedAt.toISOString() },
}));
