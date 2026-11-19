import type pg from 'pg';
import type { SessionStatus } from '../../shared/protocol.js';
import { LEASE_TAKEOVER_MS, TICK_MS } from '../config.js';
import { pool, tx } from '../db/pool.js';
import { runTick, type SessionRecord } from '../domain/session.js';
import { publishPending } from './outbox.js';
import { commitSession, commitTick, markRunningClock } from './sessionStore.js';
import { ensureProbed, renewLease, takeLease } from './valkey.js';

const COLUMNS = `id, workspace_id, layout_id, name, status, hold_reason, ratio,
  revision::int as revision, control_revision::int as control_revision,
  session_version, tick::int as tick, layout_version_id, layout_version_number,
  timetable_version, state`;

async function lockForTick(
  client: pg.PoolClient,
  sessionId: string,
): Promise<{ record: SessionRecord; ageMs: number } | null> {
  const { rows } = await client.query<SessionRecord & { age_ms: string }>(
    `select ${COLUMNS}, extract(epoch from (now() - last_tick_at)) * 1000 as age_ms
     from sessions where id = $1 for update`,
    [sessionId],
  );
  const row = rows[0];
  return row ? { record: row, ageMs: Number(row.age_ms) } : null;
}

async function holdForValkey(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from sessions where status = 'Running'`,
  );
  for (const row of rows) {
    await tx(async (client) => {
      const locked = await lockForTick(client, row.id);
      if (!locked || locked.record.status !== 'Running') return;
      const record = locked.record;
      record.status = 'Held';
      record.hold_reason = 'valkey';
      record.control_revision += 1;
      await commitSession(client, record, 'session.status', {
        command: 'hold',
        status: 'Held',
        hold_reason: 'valkey',
        tick: record.tick,
      });
    });
  }
}

async function resumeAfterValkey(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from sessions where status = 'Held' and hold_reason = 'valkey'`,
  );
  for (const row of rows) {
    await tx(async (client) => {
      const locked = await lockForTick(client, row.id);
      if (!locked || locked.record.status !== 'Held' || locked.record.hold_reason !== 'valkey') {
        return;
      }
      const record = locked.record;
      record.status = 'Running';
      record.hold_reason = null;
      record.control_revision += 1;
      await markRunningClock(client, record.id);
      await commitSession(client, record, 'session.status', {
        command: 'resume',
        status: 'Running',
        hold_reason: null,
        tick: record.tick,
      });
    });
  }
}

async function advance(sessionId: string, instanceId: string): Promise<void> {
  const held = (await takeLease(sessionId, instanceId)) || (await renewLease(sessionId, instanceId));
  if (!held) return;

  await tx(async (client) => {
    const locked = await lockForTick(client, sessionId);
    if (!locked || locked.record.status !== 'Running') return;
    const record = locked.record;

    if (locked.ageMs > LEASE_TAKEOVER_MS) {
      record.status = 'Interrupted';
      record.hold_reason = null;
      record.control_revision += 1;
      await commitSession(client, record, 'session.status', {
        command: 'interrupted',
        status: 'Interrupted',
        hold_reason: null,
        tick: record.tick,
      });
      return;
    }
    if (locked.ageMs < TICK_MS) return;

    const detail = runTick(record);
    await commitTick(client, record, detail);
  });
}

/** The tick engine: one instance advances each running session under the lease. */
export function startTicker(instanceId: string): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const up = await ensureProbed(1000);
        if (!up) {
          await holdForValkey();
          return;
        }
        await publishPending();
        await resumeAfterValkey();
        const { rows } = await pool.query<{ id: string; status: SessionStatus }>(
          `select id, status from sessions where status = 'Running'`,
        );
        for (const row of rows) await advance(row.id, instanceId);
      } catch {
        /* the next pass tries again */
      } finally {
        busy = false;
      }
    })();
  }, 200);
}
