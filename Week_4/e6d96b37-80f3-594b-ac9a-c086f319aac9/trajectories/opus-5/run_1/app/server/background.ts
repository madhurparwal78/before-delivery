import { app, limits } from './config.ts';
import { db, ensureSchema } from './providers/db.ts';
import { ensureBucket } from './providers/storage.ts';
import { ensureIdentity, ensureRealm } from './providers/keycloak.ts';
import { seedDefaultNamespace } from './fixtures/seed.ts';
import { appendEvent, publish } from './store/events.ts';
import { expireLapsedOffers } from './store/state.ts';
import { tx } from './providers/db.ts';

/**
 * Setup is applied idempotently on every serve. When a dependency is
 * unreachable at boot the server still starts and serves health, and the setup
 * is retried on each sweep and on each request that needs it.
 */

let setupDone = false;

async function applySetup(): Promise<void> {
  if (setupDone) return;
  await ensureSchema();
  await ensureBucket();
  await ensureRealm();
  // Wren Halloway, Odile Marsh and Penn Ostrander hold the default desk.
  for (const role of ['dealer', 'counterpart', 'outsider'] as const) {
    await ensureIdentity(app.defaultNamespace, role);
  }
  await seedDefaultNamespace();
  setupDone = true;
}

/**
 * A review hold is released FLAN_HOLD_GRACE_S after the counterpart's last
 * stream closes, unless they reconnect first.
 */
async function releaseLapsedHolds(): Promise<void> {
  const released = await tx(async (sql) => {
    const due = await sql.query<{ ns: string; offer: string; specimen: string }>(
      `SELECT ns, offer, specimen FROM offer_holds
        WHERE release_after IS NOT NULL AND release_after <= now() FOR UPDATE`,
    );
    const events: { ns: string; event: Awaited<ReturnType<typeof appendEvent>> }[] = [];
    for (const hold of due.rows) {
      await sql.query(
        'DELETE FROM offer_holds WHERE ns = $1 AND offer = $2 AND specimen = $3',
        [hold.ns, hold.offer, hold.specimen],
      );
      events.push({
        ns: hold.ns,
        event: await appendEvent(sql, hold.ns, {
          type: 'hold.released',
          actor: 'system',
          commandId: null,
          payload: { offer: hold.offer, specimen: hold.specimen, reason: 'grace' },
        }),
      });
    }
    return events;
  });
  for (const { ns, event } of released) publish(ns, [event]);
}

/** Expiry is settled for every namespace so a window closes on its own. */
async function sweepExpiries(): Promise<void> {
  const sql = await db();
  const namespaces = await sql.query<{ ns: string }>('SELECT ns FROM namespaces');
  for (const row of namespaces.rows) await expireLapsedOffers(row.ns);
}

export function startBackground(): void {
  const sweep = (): void => {
    void applySetup()
      .then(() => Promise.all([releaseLapsedHolds(), sweepExpiries()]))
      .catch(() => {
        // A dependency is down; the next sweep and the next request retry.
        setupDone = false;
      });
  };
  sweep();
  const timer = setInterval(sweep, Math.max(limits.liveMs, 1000));
  timer.unref();
}

export { applySetup };
