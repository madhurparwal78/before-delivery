import { query, transaction } from './db';
import { hashPassword, sha256Hex } from './crypto/seal';
import { normaliseRecoveryCode } from './crypto/totp';
import { seal } from './crypto/seal';
import { ensureBucket } from './services/storage';
import { loadBucketIn } from './domain/buckets';
import { currentVersionIn } from './domain/versions';
import { storeSingleUpload } from './domain/uploads';
import { objectSeeds, regionSeeds, seedPassword, userSeeds, workspaceSeeds } from './domain/seeddata';

/** Applies the seed data idempotently on every serve, so an empty database works. */
export async function applySeed(): Promise<void> {
  for (const region of regionSeeds) {
    await query(
      `insert into regions (id, name, continent, lon, lat, state) values ($1, $2, $3, $4, $5, 'online')
       on conflict (id) do update set name = $2, continent = $3, lon = $4, lat = $5`,
      [region.id, region.name, region.continent, region.lon, region.lat],
    );
  }

  const passwordHash = hashPassword(seedPassword);
  for (const user of userSeeds) {
    const inserted = await query<{ id: string }>(
      `insert into users (id, name, email, password_hash, is_operator, two_step_state)
       values ($1, $2, $3, $4, $5, 'off') on conflict (id) do nothing returning id`,
      [user.id, user.name, user.email, passwordHash, user.operator === true],
    );
    if (inserted.length === 0 || !user.twoStepSecret) continue;
    await query(
      `update users set two_step_state = 'on', two_step_secret_sealed = $2, two_step_enabled_at = date_trunc('second', now())
       where id = $1`,
      [user.id, seal(user.twoStepSecret)],
    );
    for (const code of user.recoveryCodes ?? []) {
      await query('insert into recovery_codes (user_id, code_hash, used) values ($1, $2, false) on conflict do nothing', [
        user.id,
        sha256Hex(normaliseRecoveryCode(code)),
      ]);
    }
  }

  for (const workspace of workspaceSeeds) {
    await query(
      `insert into workspaces (slug, name, plan_id, status, key_generation) values ($1, $2, $3, 'active', 1)
       on conflict (slug) do nothing`,
      [workspace.slug, workspace.name, workspace.plan],
    );
    for (const member of workspace.members) {
      await query('insert into memberships (workspace_slug, user_id, role) values ($1, $2, $3) on conflict do nothing', [
        workspace.slug,
        member.userId,
        member.role,
      ]);
    }
    for (const bucket of workspace.buckets) {
      await query(
        `insert into buckets (name, workspace_slug, placement, created_at, keep_newest_noncurrent)
         values ($1, $2, $3, date_trunc('second', now()), 0) on conflict (name) do nothing`,
        [bucket.name, workspace.slug, bucket.placement],
      );
    }
  }

  await ensureBucket();

  for (const seeded of objectSeeds) {
    await transaction(async (client) => {
      const bucket = await loadBucketIn(client, seeded.bucket);
      if (!bucket) return;
      const existing = await currentVersionIn(client, bucket.name, seeded.key);
      if (existing) return;
      const workspace = await client.query('select key_generation from workspaces where slug = $1', [bucket.workspace_slug]);
      await storeSingleUpload(client, {
        bucket,
        workspaceSlug: bucket.workspace_slug,
        keyGeneration: Number(workspace.rows[0].key_generation),
        key: seeded.key,
        bytes: seeded.body,
        contentType: seeded.contentType,
        metadata: {},
        tags: seeded.tags,
        meterRequestUnit: false,
        emitCreated: false,
      });
    });
  }
}
