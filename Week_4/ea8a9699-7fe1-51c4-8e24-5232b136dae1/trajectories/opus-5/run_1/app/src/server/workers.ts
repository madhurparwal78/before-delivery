import { lock, query, transact } from './db.js';
import { config } from './config.js';
import { digestBody } from './domain/digest.js';
import { publicClusterSql } from './domain/lift.js';
import { applySeed } from './seed.js';
import { digestMessage, sendMail } from './services/mail.js';
import { ensureCatalog, ensureWorkspaceSubscription } from './services/killbill.js';
import { ensureBucket } from './services/storage.js';
import type { PlanId } from '../shared/types.js';

const digestTickMs = 5_000;
const serviceTickMs = 15_000;

async function promoteLiftedClusters(): Promise<void> {
  await query(
    `update clusters
        set status = 'public', published_at = coalesce(published_at, lifts_at)
      where status = 'embargoed' and lifts_at is not null and lifts_at <= now()`,
  );
}

async function createDigests(): Promise<void> {
  const clusters = await query<{ id: string }>(
    `select c.id from clusters c
      where c.digests_created_at is null and c.lifts_at is not null and ${publicClusterSql}`,
  );
  for (const cluster of clusters) {
    await transact(async (client) => {
      await lock(client, 'digests', cluster.id);
      const fresh = await client.query<{ owner_id: string; digests_created_at: Date | null }>(
        'select owner_id, digests_created_at from clusters where id = $1',
        [cluster.id],
      );
      if (fresh.rows.length === 0 || fresh.rows[0].digests_created_at !== null) {
        return;
      }
      await client.query(
        `insert into digests (cluster_id, follower_id)
              select $1, f.follower_id from follows f where f.curator_id = $2
         on conflict do nothing`,
        [cluster.id, fresh.rows[0].owner_id],
      );
      await client.query('update clusters set digests_created_at = now() where id = $1', [cluster.id]);
    });
  }
}

interface PendingDigest {
  cluster_id: string;
  follower_id: string;
  follower_email: string;
  title: string;
  public_description: string;
  owner_display_name: string;
  owner_handle: string;
  public_item_count: number;
}

async function sendPendingDigests(): Promise<void> {
  const pending = await query<PendingDigest>(
    `select d.cluster_id, d.follower_id, f.email as follower_email,
            c.title, c.public_description,
            o.display_name as owner_display_name, o.handle as owner_handle,
            (select count(*)::int from cluster_entries e
              where e.cluster_id = c.id and e.is_private = false) as public_item_count
       from digests d
       join accounts f on f.id = d.follower_id
       join clusters c on c.id = d.cluster_id
       join accounts o on o.id = c.owner_id
      where d.sent_at is null
      limit 50`,
  );
  for (const digest of pending) {
    await transact(async (client) => {
      const claimed = await client.query(
        `select 1 from digests
          where cluster_id = $1 and follower_id = $2 and sent_at is null
            for update skip locked`,
        [digest.cluster_id, digest.follower_id],
      );
      if (claimed.rowCount === 0) {
        return;
      }
      await sendMail(
        digestMessage({
          to: digest.follower_email,
          ownerDisplayName: digest.owner_display_name,
          clusterTitle: digest.title,
          body: digestBody(
            {
              clusterId: digest.cluster_id,
              title: digest.title,
              publicDescription: digest.public_description,
              publicItemCount: digest.public_item_count,
              ownerHandle: digest.owner_handle,
            },
            config.publicUrl,
          ),
        }),
      );
      await client.query('update digests set sent_at = now() where cluster_id = $1 and follower_id = $2', [
        digest.cluster_id,
        digest.follower_id,
      ]);
    }).catch(() => undefined);
  }
}

async function syncBilling(): Promise<void> {
  const pending = await query<{ id: string; slug: string; name: string; seeded_plan: PlanId }>(
    'select id, slug, name, seeded_plan from workspaces where kb_synced = false order by sort_order',
  );
  if (pending.length === 0) {
    return;
  }
  await ensureCatalog();
  for (const workspace of pending) {
    await ensureWorkspaceSubscription(workspace.slug, workspace.name, workspace.seeded_plan);
    await query('update workspaces set kb_synced = true where id = $1', [workspace.id]);
  }
}

let seedComplete = false;

export function markSeedComplete(complete: boolean): void {
  seedComplete = complete;
}

async function serviceTick(): Promise<void> {
  if (!seedComplete) {
    await ensureBucket().catch(() => undefined);
    seedComplete = await applySeed().catch(() => false);
  }
  await syncBilling().catch(() => undefined);
}

async function digestTick(): Promise<void> {
  await promoteLiftedClusters();
  await createDigests();
  await sendPendingDigests();
}

export function startWorkers(): void {
  const digestTimer = setInterval(() => {
    void digestTick().catch(() => undefined);
  }, digestTickMs);
  const serviceTimer = setInterval(() => {
    void serviceTick().catch(() => undefined);
  }, serviceTickMs);
  digestTimer.unref();
  serviceTimer.unref();
  void serviceTick().catch(() => undefined);
}
