import { randomUUID } from 'node:crypto';
import { serverTime } from '../shared/businessTime.ts';
import { hashPassword } from './auth.ts';
import { type Queryable, pool } from './db.ts';
import { SCHEMA_SQL } from './schema.ts';
import {
  SEED_ASSETS,
  SEED_DEPRECATED_ASSET,
  SEED_EDGES,
  SEED_PASSWORD,
  SEED_TERMS,
  SEED_USERS,
} from './seedData.ts';

const SEED_LOCK = 8_421_378;

async function writeSeed(client: Queryable): Promise<void> {
  const at = serverTime();
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const user of SEED_USERS) {
    await client.query(
      'INSERT INTO users (id, name, email, role, password_hash, created_seq) VALUES ($1,$2,$3,$4,$5,0)',
      [user.id, user.name, user.email, user.role, passwordHash],
    );
    await client.query('INSERT INTO user_role_history (user_id, from_seq, role) VALUES ($1,0,$2)', [
      user.id,
      user.role,
    ]);
  }
  for (const term of SEED_TERMS) {
    await client.query('INSERT INTO terms (id, created_seq) VALUES ($1,0)', [term.id]);
    await client.query(
      'INSERT INTO term_revisions (term_id, revision, name, definition, from_seq) VALUES ($1,1,$2,$3,0)',
      [term.id, term.name, term.definition],
    );
  }
  for (const asset of SEED_ASSETS) {
    await client.query(
      'INSERT INTO assets (id, kind, description, owner_id, created_seq) VALUES ($1,$2,$3,$4,0)',
      [asset.id, asset.kind, asset.description, asset.ownerId],
    );
    const deprecated = asset.id === SEED_DEPRECATED_ASSET.assetId;
    await client.query(
      `INSERT INTO asset_certification (asset_id, from_seq, state, verified_at, evidence_id, deprecation)
       VALUES ($1, 0, $2, NULL, NULL, $3)`,
      [
        asset.id,
        deprecated ? 'deprecated' : 'draft',
        deprecated
          ? JSON.stringify({ reason: SEED_DEPRECATED_ASSET.reason, at, by: SEED_DEPRECATED_ASSET.actorId })
          : null,
      ],
    );
    for (const termId of asset.termIds) {
      await client.query('INSERT INTO asset_terms (asset_id, term_id, linked_seq) VALUES ($1,$2,0)', [
        asset.id,
        termId,
      ]);
    }
    let ordinal = 0;
    for (const column of asset.columns) {
      const columnId = `${asset.id}.${column.name}`;
      await client.query(
        `INSERT INTO asset_columns (id, asset_id, name, data_type, ordinal, samples, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,0)`,
        [columnId, asset.id, column.name, column.dataType, ordinal, JSON.stringify(column.samples)],
      );
      ordinal += 1;
      for (const tag of column.directTags) {
        await client.query('INSERT INTO column_tags (column_id, tag, added_seq) VALUES ($1,$2,0)', [
          columnId,
          tag,
        ]);
      }
    }
  }
  await client.query(
    'INSERT INTO deprecation_events (id, asset_id, at_seq, reason, actor_id, at) VALUES ($1,$2,0,$3,$4,$5)',
    [
      randomUUID(),
      SEED_DEPRECATED_ASSET.assetId,
      SEED_DEPRECATED_ASSET.reason,
      SEED_DEPRECATED_ASSET.actorId,
      at,
    ],
  );
  for (const edge of SEED_EDGES) {
    await client.query(
      'INSERT INTO lineage_edges (id, from_column, to_column, transform, added_seq) VALUES ($1,$2,$3,$4,0)',
      [randomUUID(), edge.from, edge.to, edge.transform],
    );
  }
  await client.query('INSERT INTO seed_state (id) VALUES (1)');
}

/**
 * Schema and seed are applied idempotently on every serve, under one lock, so instances
 * starting at the same moment against one database apply them exactly once.
 */
export async function applySchemaAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    await client.query(SCHEMA_SQL);
    const existing = await client.query('SELECT 1 FROM seed_state WHERE id = 1');
    if (existing.rowCount === 0) await writeSeed(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
