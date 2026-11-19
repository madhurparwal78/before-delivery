import type pg from 'pg';
import type { SessionEventType, TickDetail } from '../../shared/protocol.js';
import { pool } from '../db/pool.js';
import {
  buildSnapshot,
  countersOf,
  snapshotBlocks,
  tickPositions,
  type SessionRecord,
} from '../domain/session.js';
import { writeOutbox } from './outbox.js';
import { sessionStream } from './valkey.js';

const COLUMNS = `id, workspace_id, layout_id, name, status, hold_reason, ratio,
  revision::int as revision, control_revision::int as control_revision,
  session_version, tick::int as tick, layout_version_id, layout_version_number,
  timetable_version, state`;

export async function loadSession(
  sessionId: string,
  workspaceId: string,
): Promise<SessionRecord | null> {
  const { rows } = await pool.query<SessionRecord>(
    `select ${COLUMNS} from sessions where id = $1 and workspace_id = $2`,
    [sessionId, workspaceId],
  );
  return rows[0] ?? null;
}

export async function lockSession(
  client: pg.PoolClient,
  sessionId: string,
  workspaceId: string,
): Promise<SessionRecord | null> {
  const { rows } = await client.query<SessionRecord>(
    `select ${COLUMNS} from sessions where id = $1 and workspace_id = $2 for update`,
    [sessionId, workspaceId],
  );
  return rows[0] ?? null;
}

export async function lockSessionById(
  client: pg.PoolClient,
  sessionId: string,
): Promise<SessionRecord | null> {
  const { rows } = await client.query<SessionRecord>(
    `select ${COLUMNS} from sessions where id = $1 for update`,
    [sessionId],
  );
  return rows[0] ?? null;
}

async function writeSession(client: pg.PoolClient, record: SessionRecord): Promise<void> {
  await client.query(
    `update sessions set name = $2, status = $3, hold_reason = $4, ratio = $5, revision = $6,
            control_revision = $7, session_version = $8, tick = $9, timetable_version = $10,
            state = $11 where id = $1`,
    [
      record.id,
      record.name,
      record.status,
      record.hold_reason,
      record.ratio,
      record.revision,
      record.control_revision,
      record.session_version,
      record.tick,
      record.timetable_version,
      JSON.stringify(record.state),
    ],
  );
}

/** The one place a session change is written: one revision, one event. */
export async function commitSession(
  client: pg.PoolClient,
  record: SessionRecord,
  type: SessionEventType,
  detail: Record<string, unknown>,
): Promise<SessionRecord> {
  record.revision += 1;
  await writeSession(client, record);
  await writeOutbox(client, sessionStream(record.id), record.revision, type, {
    seq: record.revision,
    type,
    session: buildSnapshot(record),
    detail,
  });
  return record;
}

/** A committed tick: positions, occupancy, counters and one outbox row together. */
export async function commitTick(
  client: pg.PoolClient,
  record: SessionRecord,
  detail: TickDetail,
): Promise<void> {
  record.revision += 1;
  const counters = countersOf(snapshotBlocks(record.state), record.state);
  await client.query(
    `insert into session_ticks (session_id, tick, revision, positions, counters)
     values ($1, $2, $3, $4, $5)`,
    [
      record.id,
      record.tick,
      record.revision,
      JSON.stringify(tickPositions(record.state)),
      JSON.stringify(counters),
    ],
  );
  await writeSession(client, record);
  await client.query(`update sessions set last_tick_at = now() where id = $1`, [record.id]);
  await writeOutbox(client, sessionStream(record.id), record.revision, 'tick.committed', {
    seq: record.revision,
    type: 'tick.committed',
    session: buildSnapshot(record),
    detail,
  });
}

export async function markRunningClock(client: pg.PoolClient, sessionId: string): Promise<void> {
  await client.query(`update sessions set last_tick_at = now() where id = $1`, [sessionId]);
}

export async function msSinceLastTick(sessionId: string): Promise<number> {
  const { rows } = await pool.query<{ age_ms: string }>(
    `select extract(epoch from (now() - last_tick_at)) * 1000 as age_ms
     from sessions where id = $1`,
    [sessionId],
  );
  return Number(rows[0]?.age_ms ?? 0);
}
