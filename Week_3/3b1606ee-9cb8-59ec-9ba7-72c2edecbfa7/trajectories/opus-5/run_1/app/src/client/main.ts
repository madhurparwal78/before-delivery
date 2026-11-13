import { api, ApiFailure, Offline, onStorageOutage, onUnauthenticated } from './data/api.js';
import { currentIdentity, loadIdentity } from './data/keys.js';
import { kick, primeOutbox } from './data/outbox.js';
import { loadCachedProfiles, openMyProfile } from './data/profiles.js';
import { startSocket } from './data/socket.js';
import { emit, loadLettersFromStore, state } from './data/store.js';
import { sendProfileKeyToAllContacts, syncNow } from './data/sync.js';
import { setStorageOutage } from './ui/live.js';
import { startShell } from './ui/shell.js';

let socketStarted = false;

/** Brings the signed-in app to life: local store, held letters and the live socket. */
async function begin(restored: boolean): Promise<void> {
  await loadLettersFromStore();
  await loadCachedProfiles();
  await primeOutbox();
  await openMyProfile(state.me?.profile ?? null);
  if (!socketStarted) {
    socketStarted = true;
    startSocket();
  }
  await syncNow();
  if (restored) await sendProfileKeyToAllContacts();
  kick();
}

async function boot(): Promise<void> {
  try {
    state.config = await api.config();
  } catch (error) {
    if (!(error instanceof Offline)) throw error;
  }

  onStorageOutage(setStorageOutage);
  onUnauthenticated(() => {
    if (currentIdentity() === null || state.signedOut) return;
    state.signedOut = true;
    emit('signed-out');
  });
  try {
    const health = await api.health();
    if (health.status === 'unavailable') setStorageOutage(true);
  } catch {
    // Health is unreachable; the next storage call reports it.
  }

  const identity = await loadIdentity();
  if (identity !== null) {
    try {
      const me = await api.me();
      if (me.id === identity.accountId) {
        state.me = me;
        await begin(false);
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) state.signedOut = true;
      else if (!(error instanceof Offline)) throw error;
    }
  }

  startShell(async () => {
    await begin(true);
  });
}

void boot();
