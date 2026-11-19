import type { Db, Tx } from './db';
import type { Valkey } from './services';
import { commitTick, recount, deriveOccupancy, type SessionState, checkDeadlock } from './sessionEngine';
import type { LayoutContent, SessionSnapshot } from '../shared/domain';
import { fastClockLabel } from '../shared/scaleUnits';

/**
 * The tick engine advances every Running session under the Valkey tick lease.
 * Exactly one instance commits each session's ticks; a survivor takes over
 * within 5 seconds of the holder's death; with no holder able to act the first
 * instance to notice records Interrupted.
 */
export class TickEngine {
  private running = false;
  private lastValkeyUp: boolean | true = true;

  constructor(
    private db: Db,
    private valkey: Valkey,
    private instanceId: string,
    private snapshotFor: (sessionId: string, state: SessionState, status: string, tick: number, fastClock: number, revision: number, sessionVersion: number, controlRevision: number, ratio: number, holdReason: string | null) => SessionSnapshot,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    // Give Valkey its first probe before deciding anything.
    await this.valkey.probe();
    while (this.running) {
      const started = Date.now();
      try {
        const valkeyUp = await this.valkey.probe();
        if (!valkeyUp) {
          await this.holdForValkey();
        } else {
          await this.resumeFromValkey();
          const sessions = await this.db.query(
            `SELECT id, status, tick, ratio, layout_version_id, revision, control_revision, session_version, fast_clock_seconds, last_tick_at, state
             FROM run_sessions WHERE status = 'Running'`,
          );
          for (const row of sessions.rows) {
            await this.handleSession(row, valkeyUp);
          }
        }
      } catch {
        // database hiccup: retry next loop
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(20, 1000 - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async handleSession(row: Record<string, unknown>, _valkeyUp: boolean): Promise<void> {
    const sessionId = row.id as string;
    const acquired = await this.valkey.acquireLease(sessionId, this.instanceId);
    if (!acquired) return;

    // Pace strictly: re-read last_tick_at under the lease and only tick when a full second has passed.
    const fresh = await this.db.query('SELECT last_tick_at FROM run_sessions WHERE id = $1', [sessionId]);
    const lastTickAt = fresh.rows[0]?.last_tick_at ? new Date(fresh.rows[0].last_tick_at as string).getTime() : null;
    if (lastTickAt === null) {
      await this.commitTick(sessionId, row);
      return;
    }
    if (Date.now() - lastTickAt >= 1000) {
      await this.commitTick(sessionId, row);
    }
  }

  private async commitTick(sessionId: string, row: Record<string, unknown>): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query(
        `SELECT status, tick, ratio, layout_version_id, revision, control_revision, session_version, fast_clock_seconds, state, hold_reason
         FROM run_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      const s = fresh.rows[0];
      if (!s || s.status !== 'Running') {
        await client.query('COMMIT');
        return;
      }
      const contentRes = await client.query('SELECT content FROM layout_versions WHERE id = $1', [s.layout_version_id]);
      const content = (contentRes.rows[0]?.content ?? null) as LayoutContent | null;
      if (!content) {
        await client.query('COMMIT');
        return;
      }
      const state = s.state as unknown as SessionState;
      const tick = Number(s.tick) + 1;
      const ratio = Number(s.ratio);
      const fastClock = tick * ratio;
      const tickResult = commitTick(state, content, fastClock, tick);
      const deadlockRaised = checkDeadlock(state, tick);
      if (deadlockRaised) {
        tickResult.deadlocks_raised.push(deadlockRaised);
      }
      recount(state);
      const revision = Number(s.revision) + 1;
      const positions = state.trains.map((t) => ({
        id: t.id,
        head_block_id: t.head_block_id,
        head_offset_mm: t.head_offset_mm,
        trail_block_ids: t.trail_block_ids,
        distance_run_mm: t.distance_run_mm,
      }));
      const snapshot = this.snapshotFor(
        sessionId,
        state,
        'Running',
        tick,
        fastClock,
        revision,
        s.session_version as number,
        s.control_revision as number,
        ratio,
        null,
      );
      await client.query(
        `UPDATE run_sessions
         SET tick = $2, fast_clock_seconds = $3, revision = $4, state = $5, last_tick_at = now()
         WHERE id = $1`,
        [sessionId, tick, fastClock, revision, JSON.stringify(state)],
      );
      await client.query(
        `INSERT INTO session_ticks (session_id, tick, revision, positions, counters, committed_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (session_id, tick) DO NOTHING`,
        [sessionId, tick, revision, JSON.stringify(positions), JSON.stringify(state.counters)],
      );
      await client.query(
        `INSERT INTO event_outbox (stream, seq, type, payload, published_at)
         VALUES ($1,$2,'tick.committed',$3,NULL)`,
        [
          `gandyboard:session:${sessionId}:events`,
          revision,
          { seq: revision, type: 'tick.committed', session: snapshot, detail: tickResult },
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection broken
      }
      console.error('tick failed', sessionId, e);
    } finally {
      client.release();
    }
  }

  /** Automatic hold when Valkey is unreachable: only sessions still Running. */
  private async holdForValkey(): Promise<void> {
    const held = await this.db.query(
      `UPDATE run_sessions SET status = 'Held', hold_reason = 'valkey', control_revision = control_revision + 1, revision = revision + 1
       WHERE status = 'Running'
       RETURNING id, revision, control_revision, state, tick, fast_clock_seconds, ratio, session_version`,
    );
    for (const row of held.rows) {
      const state = row.state as unknown as SessionState;
      const revision = Number(row.revision);
      const snapshot = this.snapshotFor(
        row.id as string,
        state,
        'Held',
        row.tick as number,
        row.fast_clock_seconds as number,
        revision,
        row.session_version as number,
        Number(row.control_revision),
        row.ratio as number,
        'valkey',
      );
      await this.db.query(
        `INSERT INTO event_outbox (stream, seq, type, payload)
         VALUES ($1,$2,'session.status',$3)`,
        [
          `gandyboard:session:${row.id as string}:events`,
          revision,
          { seq: revision, type: 'session.status', session: snapshot, detail: { to: 'Held', reason: 'valkey' } },
        ],
      );
    }
  }

  /** Automatic resume when Valkey returns: only sessions held for that reason. */
  private async resumeFromValkey(): Promise<void> {
    const resumed = await this.db.query(
      `UPDATE run_sessions SET status = 'Running', hold_reason = NULL, control_revision = control_revision + 1, revision = revision + 1, last_tick_at = now() - interval '1000 milliseconds'
       WHERE status = 'Held' AND hold_reason = 'valkey'
       RETURNING id, revision, control_revision, state, tick, fast_clock_seconds, ratio, session_version`,
    );
    for (const row of resumed.rows) {
      const state = row.state as unknown as SessionState;
      const revision = Number(row.revision);
      const snapshot = this.snapshotFor(
        row.id as string,
        state,
        'Running',
        row.tick as number,
        row.fast_clock_seconds as number,
        revision,
        row.session_version as number,
        Number(row.control_revision),
        row.ratio as number,
        null,
      );
      await this.db.query(
        `INSERT INTO event_outbox (stream, seq, type, payload)
         VALUES ($1,$2,'session.status',$3)`,
        [
          `gandyboard:session:${row.id as string}:events`,
          revision,
          { seq: revision, type: 'session.status', session: snapshot, detail: { to: 'Running', reason: 'valkey' } },
        ],
      );
    }
  }
}
