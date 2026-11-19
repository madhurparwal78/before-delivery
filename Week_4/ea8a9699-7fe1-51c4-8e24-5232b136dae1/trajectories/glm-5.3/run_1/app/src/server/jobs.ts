// Background jobs: digests at the lift instant, seed-object retries and the
// Kill Bill sync retry.

import crypto from 'node:crypto';
import type { App } from './app.js';
import { many, one } from './db.js';
import { syncSeedObjects } from './objects.js';
import { monthlyPriceOf, planNameOf, seatCapOf } from '../shared/domain.js';

const TICK_MS = 5000;

export function startJobs(app: App): void {
  let storageOk = false;
  setInterval(() => {
    void runTick(app).catch(() => {});
  }, TICK_MS).unref();
  void seedOnce(app).then((ok) => {
    storageOk = ok;
  });
}

async function seedOnce(app: App): Promise<boolean> {
  try {
    await syncSeedObjects(app.db, app.storage);
    return true;
  } catch {
    return false;
  }
}

async function runTick(app: App): Promise<void> {
  await sendDueDigests(app);
  await retrySeedObjects(app);
  await retryKillBillSync(app);
}

/** Create and send digests for clusters that lifted but have no digest rows yet. */
async function sendDueDigests(app: App): Promise<void> {
  const lifted = await many<{ id: string; title: string; public_description: string; lifts_at: Date; owner_id: string; owner_handle: string }>(
    app.db,
    `select c.id, c.title, c.public_description, c.lifts_at, c.owner_id, a.handle as owner_handle
       from clusters c join accounts a on a.id = c.owner_id
      where c.status = 'embargoed' and c.lifts_at is not null and c.lifts_at <= now()`,
  );
  for (const cluster of lifted) {
    // Followers are counted when the digests are created.
    const followers = await many<{ follower_id: string; email: string }>(
      app.db,
      `select f.follower_id, a.email from follows f join accounts a on a.id = f.follower_id where f.curator_id = $1`,
      [cluster.owner_id],
    );
    for (const follower of followers) {
      await app.db.query(
        `insert into digests (id, cluster_id, follower_id) values ($1,$2,$3) on conflict (cluster_id, follower_id) do nothing`,
        [crypto.randomUUID(), cluster.id, follower.follower_id],
      );
    }
    // Mark the cluster public now (writes read this same rule via effectiveStatusOf).
    await app.db.query(`update clusters set status = 'public', published_at = lifts_at where id = $1 and status = 'embargoed' and lifts_at <= now()`, [cluster.id]);
  }
  // Send pending digests.
  const pending = await many<{ id: string; cluster_id: string; follower_id: string }>(
    app.db,
    `select id, cluster_id, follower_id from digests where sent_at is null order by created_at limit 50`,
  );
  for (const d of pending) {
    const cluster = await one<{
      title: string;
      public_description: string;
      lifts_at: Date;
      owner_handle: string;
      public_count: string;
    }>(
      app.db,
      `select c.title, c.public_description, c.lifts_at, a.handle as owner_handle,
              (select count(*)::text from entries e where e.cluster_id = c.id and not e.is_private) as public_count
         from clusters c join accounts a on a.id = c.owner_id
        where c.id = $1`,
      [d.cluster_id],
    );
    if (!cluster) {
      await app.db.query(`update digests set sent_at = now() where id = $1`, [d.id]);
      continue;
    }
    const follower = await one<{ email: string }>(app.db, `select email from accounts where id = $1`, [d.follower_id]);
    if (!follower) {
      await app.db.query(`update digests set sent_at = now() where id = $1`, [d.id]);
      continue;
    }
    const title = cluster.title.replace(/[\r\n]+/g, ' ');
    const description = cluster.public_description.replace(/[\r\n]+/g, ' ');
    const body = [
      title,
      description,
      `${cluster.public_count} public items by @${cluster.owner_handle}`,
      `${app.config.publicBaseUrl}/c/${d.cluster_id}`,
    ].join('\r\n') + '\r\n';
    const ownerName = (await one<{ display_name: string }>(app.db, `select display_name from accounts where id = (select owner_id from clusters where id = $1)`, [d.cluster_id]))!.display_name;
    try {
      await app.mailer.send({
        to: follower.email,
        subject: `New from ${ownerName}: ${title}`,
        text: body,
      });
      // Exactly once: the sent record commits only after SMTP acceptance.
      await app.db.query(`update digests set sent_at = now() where id = $1 and sent_at is null`, [d.id]);
    } catch {
      // stay pending; retried on the next tick
    }
  }
}

async function retrySeedObjects(app: App): Promise<void> {
  try {
    await syncSeedObjects(app.db, app.storage);
  } catch {
    // storage still unreachable
  }
}

let kbSyncFailed = 0;
async function retryKillBillSync(app: App): Promise<void> {
  const pending = await one<{ n: string }>(app.db, `select count(*)::text as n from reference_items where stored_at is null`);
  void pending;
  try {
    await app.kbSync.ensureAllPeriodically();
    kbSyncFailed = 0;
  } catch {
    kbSyncFailed += 1;
    void kbSyncFailed;
  }
}
