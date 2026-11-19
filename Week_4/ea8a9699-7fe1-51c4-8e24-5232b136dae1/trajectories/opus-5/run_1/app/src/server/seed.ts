import { hashPassword } from './auth.js';
import { one, query } from './db.js';
import { liftLocalOf } from './domain/embargo.js';
import { mediaExtensions } from './domain/media.js';
import { totalFramesFor } from '../shared/timecode.js';
import { schemaSql } from './schema.js';
import { placeholderPng } from './assets/placeholder.js';
import { seedClipDurationMs, seedClipFrameRate, seedClipWebm } from './assets/seedClip.js';
import { objectExists, putObject } from './services/storage.js';
import { planById } from '../shared/plans.js';
import {
  seedAccounts,
  seedClusters,
  seedFollows,
  seedGroups,
  seedId,
  seedPassword,
  seedReferences,
  seedWorkspaces,
} from './seedData.js';

export async function applySchema(): Promise<void> {
  await query(schemaSql);
}

function referenceId(workspace: string, title: string): string {
  return seedId(`ref:${workspace}:${title}`);
}

function clusterId(workspace: string, title: string): string {
  return seedId(`cluster:${workspace}:${title}`);
}

function accountId(handle: string): string {
  return seedId(`account:${handle}`);
}

async function seedOrganisation(): Promise<void> {
  for (const group of seedGroups) {
    await query('insert into groups (id, name) values ($1, $2) on conflict (id) do update set name = $2', [
      seedId(`group:${group.name}`),
      group.name,
    ]);
  }
  for (const [index, workspace] of seedWorkspaces.entries()) {
    const definition = planById(workspace.plan);
    if (definition === undefined) {
      throw new Error(`Unknown seeded plan ${workspace.plan}`);
    }
    await query(
      `insert into workspaces (id, group_id, slug, name, time_zone, plan, seat_cap, seeded_plan, sort_order)
            values ($1, $2, $3, $4, $5, $6, $7, $6, $8)
       on conflict (id) do update set name = $4, time_zone = $5, seeded_plan = $6, sort_order = $8`,
      [
        seedId(`workspace:${workspace.slug}`),
        seedId(`group:${workspace.group}`),
        workspace.slug,
        workspace.name,
        workspace.timeZone,
        workspace.plan,
        definition.seatCap,
        index,
      ],
    );
  }
  const passwordHash = await hashPassword(seedPassword);
  for (const account of seedAccounts) {
    await query(
      `insert into accounts (id, email, display_name, handle, role, password_hash, group_id, workspace_id)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do nothing`,
      [
        accountId(account.handle),
        account.email,
        account.displayName,
        account.handle,
        account.role,
        passwordHash,
        account.group === undefined ? null : seedId(`group:${account.group}`),
        account.workspace === undefined ? null : seedId(`workspace:${account.workspace}`),
      ],
    );
    if (account.seat === true && account.workspace !== undefined) {
      await query(
        'insert into seats (workspace_id, account_id) values ($1, $2) on conflict do nothing',
        [seedId(`workspace:${account.workspace}`), accountId(account.handle)],
      );
    }
  }
  for (const follow of seedFollows) {
    await query('insert into follows (follower_id, curator_id) values ($1, $2) on conflict do nothing', [
      accountId(follow.follower),
      accountId(follow.curator),
    ]);
  }
}

async function seedReferenceRows(): Promise<boolean> {
  let complete = true;
  for (const reference of seedReferences) {
    const id = referenceId(reference.workspace, reference.title);
    const isClip = reference.kind === 'clip';
    const contentType = isClip ? 'video/webm' : 'image/png';
    const key = `references/${reference.workspace}/${id}.${mediaExtensions[contentType]}`;
    const existing = await one<{ id: string }>('select id from refs where id = $1', [id]);
    const bytes = isClip ? seedClipWebm : placeholderPng(id);
    try {
      if (existing === null || !(await objectExists(key))) {
        await putObject(key, bytes, contentType);
      }
    } catch {
      complete = false;
      continue;
    }
    if (existing !== null) {
      continue;
    }
    await query(
      `insert into refs (id, workspace_id, kind, title, object_key, content_type, created_by, created_at,
                         frame_rate, duration_ms, total_frames)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do nothing`,
      [
        id,
        seedId(`workspace:${reference.workspace}`),
        reference.kind,
        reference.title,
        key,
        contentType,
        accountId(reference.createdBy),
        new Date(Date.parse('2026-10-10T08:00:00.000Z') + seedReferences.indexOf(reference) * 60_000),
        isClip ? seedClipFrameRate : null,
        isClip ? seedClipDurationMs : null,
        isClip ? totalFramesFor(seedClipDurationMs, seedClipFrameRate) : null,
      ],
    );
  }
  return complete;
}

async function seedClusterRows(): Promise<void> {
  for (const [index, cluster] of seedClusters.entries()) {
    const id = clusterId(cluster.workspace, cluster.title);
    const workspaceId = seedId(`workspace:${cluster.workspace}`);
    const workspace = seedWorkspaces.find((candidate) => candidate.slug === cluster.workspace);
    if (workspace === undefined) {
      throw new Error(`Unknown seeded workspace ${cluster.workspace}`);
    }
    const publishedAt = cluster.publishedAt === undefined ? null : new Date(cluster.publishedAt);
    const createdAt =
      publishedAt === null ? new Date(Date.parse('2026-10-15T09:00:00.000Z') + index * 3_600_000) : new Date(publishedAt.getTime() - 86_400_000);
    await query(
      `insert into clusters (id, workspace_id, title, public_description, internal_note, status, owner_id,
                             version, lift_local, lifts_at, published_at, digests_created_at, created_at, updated_at)
            values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $9, $9, $10, $10)
       on conflict (id) do nothing`,
      [
        id,
        workspaceId,
        cluster.title,
        cluster.publicDescription ?? '',
        cluster.internalNote ?? '',
        cluster.status,
        accountId(cluster.owner),
        publishedAt === null ? null : liftLocalOf(workspace.timeZone, publishedAt),
        publishedAt,
        createdAt,
      ],
    );

    const state = await one<{ seed_entries_complete: boolean }>(
      'select seed_entries_complete from clusters where id = $1',
      [id],
    );
    if (state !== null && !state.seed_entries_complete) {
      let allPresent = true;
      for (const [position, entry] of cluster.entries.entries()) {
        const entryReferenceId = referenceId(cluster.workspace, entry.reference);
        const reference = await one<{ id: string }>('select id from refs where id = $1', [entryReferenceId]);
        if (reference === null) {
          allPresent = false;
          continue;
        }
        await query(
          `insert into cluster_entries (id, cluster_id, reference_id, position, is_private, added_by, added_at)
                values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (cluster_id, reference_id) do nothing`,
          [
            seedId(`entry:${id}:${entryReferenceId}`),
            id,
            entryReferenceId,
            position + 1,
            entry.isPrivate === true,
            accountId(entry.addedBy),
            new Date(createdAt.getTime() + position * 60_000),
          ],
        );
      }
      if (allPresent) {
        await query('update clusters set seed_entries_complete = true where id = $1', [id]);
      }
    }

    for (const [commentIndex, comment] of (cluster.comments ?? []).entries()) {
      const author = seedAccounts.find((candidate) => candidate.handle === comment.authorHandle);
      if (author === undefined) {
        throw new Error(`Unknown seeded comment author ${comment.authorHandle}`);
      }
      await query(
        `insert into comments (id, cluster_id, author_name, author_account_id, body, created_at)
              values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [
          seedId(`comment:${id}:${commentIndex}`),
          id,
          author.displayName,
          accountId(author.handle),
          comment.body,
          new Date(createdAt.getTime() + 3_600_000),
        ],
      );
    }

    for (const link of cluster.reviewLinks ?? []) {
      await query(
        `insert into review_links (id, cluster_id, email, token, expires_at, can_comment, created_at)
              values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do nothing`,
        [seedId(`link:${link.token}`), id, link.email, link.token, new Date(link.expiresAt), link.canComment, createdAt],
      );
    }
  }
}

/** Applies the seed. Returns false when storage was unreachable, so the caller retries. */
export async function applySeed(): Promise<boolean> {
  await seedOrganisation();
  const referencesComplete = await seedReferenceRows();
  await seedClusterRows();
  return referencesComplete;
}
