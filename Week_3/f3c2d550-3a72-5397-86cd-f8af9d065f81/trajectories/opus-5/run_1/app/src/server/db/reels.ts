import { FIELD_COPY } from '../../shared/copy.js';
import type { PersistedReferenceState, ReelJson, ReelSummaryJson } from '../../shared/types.js';
import { nowIso } from '../domain/clock.js';
import { ApiError, validationError } from '../domain/errors.js';
import { assertStored } from '../domain/states.js';
import type { Queryable } from './pool.js';
import { newId, pool, withTransaction } from './pool.js';
import { REFERENCE_COLUMNS, toReferenceJson, type ReferenceRow } from './references.js';

export const MAX_STOPS = 60;

interface ReelRow {
  id: string;
  name: string;
  demo: boolean;
  version: number;
}

export async function loadReel(client: Queryable, id: string): Promise<ReelJson | null> {
  const reel = await client.query<ReelRow>(
    'select id, name, demo, version from reel where id = $1',
    [id],
  );
  const row = reel.rows[0];
  if (!row) return null;
  const stops = await client.query<ReferenceRow & { position: number }>(
    `select s.position, ${REFERENCE_COLUMNS}
     from reel_stop s join reference r on r.id = s.reference_id
     where s.reel_id = $1 order by s.position`,
    [id],
  );
  return {
    id: row.id,
    name: row.name,
    demo: row.demo,
    version: row.version,
    stops: stops.rows.map((stop) => ({
      position: stop.position,
      reference: toReferenceJson(stop),
    })),
  };
}

export async function listReels(): Promise<ReelSummaryJson[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    demo: boolean;
    version: number;
    stop_count: string;
    playable_count: string;
  }>(
    `select r.id, r.name, r.demo, r.version,
            count(s.reference_id)::text as stop_count,
            count(*) filter (where ref.state = 'stored')::text as playable_count
     from reel r
     left join reel_stop s on s.reel_id = r.id
     left join reference ref on ref.id = s.reference_id
     group by r.id, r.name, r.demo, r.version
     order by r.created_at`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    demo: row.demo,
    version: row.version,
    stop_count: Number(row.stop_count),
    playable_count: Number(row.playable_count),
  }));
}

export async function createReel(name: string): Promise<ReelJson> {
  const id = newId('reel');
  await pool.query(
    'insert into reel (id, name, demo, version, created_at) values ($1, $2, false, 1, $3::timestamptz)',
    [id, name, nowIso()],
  );
  return { id, name, demo: false, version: 1, stops: [] };
}

/**
 * Appends a stored reference at the end. The reel row is locked, so the cap and the
 * uniqueness rule pick one winner however many copies append at once.
 */
export async function appendStop(reelId: string, referenceId: string): Promise<ReelJson | null> {
  return withTransaction(async (client) => {
    const reel = await client.query<ReelRow>(
      'select id, name, demo, version from reel where id = $1 for update',
      [reelId],
    );
    if (!reel.rows[0]) return null;

    const reference = await client.query<{ state: string }>(
      `select state from reference where id = $1`,
      [referenceId],
    );
    const state = reference.rows[0]?.state;
    if (!state || state === 'purged') {
      throw validationError({ reference_id: FIELD_COPY.reference_id });
    }
    assertStored(state as PersistedReferenceState);

    const existing = await client.query<{ count: string; taken: string }>(
      `select count(*)::text as count,
              count(*) filter (where reference_id = $2)::text as taken
       from reel_stop where reel_id = $1`,
      [reelId, referenceId],
    );
    if (Number(existing.rows[0]!.taken) > 0) throw new ApiError('already_in_reel');
    const count = Number(existing.rows[0]!.count);
    if (count >= MAX_STOPS) throw new ApiError('reel_full');

    await client.query(
      'insert into reel_stop (reel_id, position, reference_id) values ($1, $2, $3)',
      [reelId, count + 1, referenceId],
    );
    await client.query('update reel set version = version + 1 where id = $1', [reelId]);
    return loadReel(client, reelId);
  });
}

/** Replaces the whole order. Of reorders carrying the same version, exactly one succeeds. */
export async function reorderStops(
  reelId: string,
  version: number,
  referenceIds: string[],
): Promise<ReelJson | null> {
  return withTransaction(async (client) => {
    const reel = await client.query<ReelRow>(
      'select id, name, demo, version from reel where id = $1 for update',
      [reelId],
    );
    if (!reel.rows[0]) return null;

    if (referenceIds.length > MAX_STOPS || new Set(referenceIds).size !== referenceIds.length) {
      throw validationError({ reference_ids: FIELD_COPY.reference_ids });
    }
    if (referenceIds.length > 0) {
      const known = await client.query<{ id: string }>(
        `select id from reference where id = any($1::text[]) and state in ('stored', 'trashed')`,
        [referenceIds],
      );
      if (known.rowCount !== referenceIds.length) {
        throw validationError({ reference_ids: FIELD_COPY.reference_ids });
      }
    }

    const claimed = await client.query(
      'update reel set version = version + 1 where id = $1 and version = $2',
      [reelId, version],
    );
    if (claimed.rowCount !== 1) throw new ApiError('reel_version_conflict');

    await client.query('delete from reel_stop where reel_id = $1', [reelId]);
    for (const [index, referenceId] of referenceIds.entries()) {
      await client.query(
        'insert into reel_stop (reel_id, position, reference_id) values ($1, $2, $3)',
        [reelId, index + 1, referenceId],
      );
    }
    return loadReel(client, reelId);
  });
}

/** A purge takes the reference out of every reel and adds one to each changed reel's version. */
export async function removeReferenceFromAllReels(
  client: Queryable,
  referenceId: string,
): Promise<void> {
  const affected = await client.query<{ reel_id: string }>(
    'delete from reel_stop where reference_id = $1 returning reel_id',
    [referenceId],
  );
  const reelIds = [...new Set(affected.rows.map((row) => row.reel_id))];
  for (const reelId of reelIds) {
    const remaining = await client.query<{ reference_id: string; position: number }>(
      'delete from reel_stop where reel_id = $1 returning reference_id, position',
      [reelId],
    );
    const ordered = remaining.rows
      .sort((a, b) => a.position - b.position)
      .map((row) => row.reference_id);
    for (const [index, id] of ordered.entries()) {
      await client.query(
        'insert into reel_stop (reel_id, position, reference_id) values ($1, $2, $3)',
        [reelId, index + 1, id],
      );
    }
    await client.query('update reel set version = version + 1 where id = $1', [reelId]);
  }
}
