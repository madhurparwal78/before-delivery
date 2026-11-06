import { storeFlags, withBootLock } from "./db.mjs";
import { reconcileAccounts } from "./realm.mjs";
import { PEOPLE, SEED_PASSWORD, seed } from "./seed.mjs";

// Starting up: the server listens at once and keeps retrying postgres and the realm until both are in place.

const RETRY_MS = 2000;
const state = { realm: false, ready: false };

function retry(step, done = () => {}) {
  const attempt = async () => {
    try {
      if (await step()) return done();
    } catch (error) {
      console.error(`startup step will retry: ${error.message}`);
    }
    setTimeout(attempt, RETRY_MS).unref();
  };
  attempt();
}

export function startBoot() {
  retry(async () => {
    await withBootLock(seed);
    return true;
  });
  retry(() => reconcileAccounts(PEOPLE, SEED_PASSWORD), () => {
    state.realm = true;
  });
}

/** The three health flags; once all are true they stay true for the life of the process. */
export async function health() {
  if (state.ready) return { schema: true, seeded: true, realm: true };
  let flags = { schema: false, seeded: false };
  try {
    flags = await storeFlags();
  } catch {
    // postgres is unreachable: both store flags stay false
  }
  const realm = state.realm;
  state.ready = flags.schema && flags.seeded && realm;
  return { ...flags, realm };
}
