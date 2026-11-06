import { ensureSchema } from './schema.js';
import { ensureSeed } from './seed.js';
import { reconcileRealmAccounts } from './realm.js';

const RETRY_MS = 5000;

const flags = { schema: false, seeded: false, realm: false };
let ready = false;

export function readinessState() {
  if (ready) return { ready: true, flags: { ...flags } };
  return { ready: false, flags: { ...flags } };
}

async function reconcile() {
  if (!flags.schema) {
    await ensureSchema();
    flags.schema = true;
  }
  if (!flags.seeded) {
    await ensureSeed();
    flags.seeded = true;
  }
  if (!flags.realm) {
    flags.realm = await reconcileRealmAccounts();
  }
  if (flags.schema && flags.seeded && flags.realm) ready = true;
}

/**
 * Brings the desk up without ever exiting because a backing service is down, retrying
 * until the schema, the seed and the realm accounts are all in place.
 */
export function startReadiness() {
  const tick = async () => {
    if (ready) return;
    try {
      await reconcile();
    } catch {
      /* a backing service is not there yet; the next tick tries again */
    }
    if (!ready) setTimeout(tick, RETRY_MS).unref();
  };
  tick();
}
