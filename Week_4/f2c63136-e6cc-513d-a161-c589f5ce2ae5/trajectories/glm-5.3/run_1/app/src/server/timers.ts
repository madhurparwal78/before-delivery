import type { Services } from './index.js';
import { getRepoById } from './store/revisions.js';
import { getQueueEntries, queueStep } from './store/queue.js';
import { removeQueueEntry } from './store/push.js';
import type pg from 'pg';

/**
 * Server-clock timers: check timeouts and queue steps fire in due time order.
 * The grading clock route fires every due timer before answering, so the
 * browser never decides time-dependent state.
 */
export class Timers {
  private running = false;

  constructor(private s: Services) {}

  start(): void {
    const tick = async () => {
      // One tick at a time: overlapping ticks would stack pool clients and
      // row locks until the pool is exhausted.
      if (this.running) return;
      this.running = true;
      try {
        await this.fireDue();
      } catch (e) {
        console.error('timer tick failed', e);
      } finally {
        this.running = false;
      }
    };
    setInterval(() => { void tick(); }, 1000).unref();
    const outbox = async () => {
      try {
        await this.s.mailer.flush();
      } catch {
        // Mailpit outage: retried on the next tick.
      }
    };
    setInterval(() => { void outbox(); }, 2000).unref();
  }

  /** Fires every timer due at or before now: timeouts first, then steps. */
  async fireDue(): Promise<void> {
    // One fireDue at a time across the process.
    while (Timers.firing) {
      await new Promise((r) => setTimeout(r, 20));
    }
    Timers.firing = true;
    try {
      const now = this.s.clock.nowMs();
      const repoRows = await this.s.db.pool.query('SELECT id FROM repos');
      for (const row of repoRows.rows) {
        await this.fireRepo(row.id, now);
      }
    } finally {
      Timers.firing = false;
    }
  }

  private static firing = false;

  private async fireRepo(repoId: number, now: number): Promise<void> {
    const repo = await this.s.db.withTransaction(async (tx) => getRepoById(tx, repoId));
    if (!repo) return;
    // 1. Check timeouts on the head revision of every unmerged change.
    await this.s.db.withTransaction(async (tx) => {
      await this.fireTimeouts(tx, repo, now);
    });
    // 2. Queue steps due at or before now, in due order.
    for (;;) {
      const due = await this.s.db.withTransaction(async (tx) => {
        const state = await tx.query('SELECT next_step_at_ms FROM queue_state WHERE repo_id = $1', [repoId]);
        if (state.rows.length === 0) return false;
        if (state.rows[0].next_step_at_ms > now) return false;
        await queueStep(this.deps(tx), tx, repoId);
        return true;
      });
      if (!due) break;
    }
  }

  private async fireTimeouts(tx: pg.PoolClient, repo: { id: number; required_checks: string[]; queue: boolean }, now: number): Promise<void> {
    // Change head revisions.
    const changes = await tx.query(
      `SELECT c.number, c.head_branch, c.state FROM changes c
       WHERE c.repo_id = $1 AND c.state IN ('draft','open','removed')`,
      [repo.id],
    );
    const deps = this.deps(tx);
    for (const c of changes.rows) {
      const branch = await tx.query('SELECT revision_id FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, c.head_branch]);
      if (branch.rows.length === 0) continue;
      const revision = branch.rows[0].revision_id;
      const revRow = await tx.query('SELECT created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, revision]);
      if (revRow.rows.length === 0) continue;
      const deadline = revRow.rows[0].created_at_ms + this.s.cfg.checkTimeoutSeconds * 1000;
      if (now < deadline) continue;
      for (const name of repo.required_checks) {
        const final = await tx.query(
          "SELECT 1 FROM checks WHERE repo_id = $1 AND revision = $2 AND name = $3 AND state IN ('success','failure')",
          [repo.id, revision, name],
        );
        if (final.rows.length > 0) continue;
        // Mark timed out with a synthetic report so later reports are refused.
        await tx.query(
          "INSERT INTO checks (repo_id, revision, name, state, summary, created_at_ms) VALUES ($1,$2,$3,'timed_out','',$4)",
          [repo.id, revision, name, now],
        );
      }
    }
    // Queue revisions of waiting/checking entries.
    if (repo.queue) {
      const entries = await getQueueEntries(tx, repo.id);
      for (const e of entries) {
        const revRow = await tx.query('SELECT created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, e.revision]);
        if (revRow.rows.length === 0) continue;
        const deadline = revRow.rows[0].created_at_ms + this.s.cfg.checkTimeoutSeconds * 1000;
        if (now < deadline) continue;
        const timedOutNames: string[] = [];
        for (const name of repo.required_checks) {
          const final = await tx.query(
            "SELECT 1 FROM checks WHERE repo_id = $1 AND revision = $2 AND name = $3 AND state IN ('success','failure','timed_out')",
            [repo.id, e.revision, name],
          );
          if (final.rows.length === 0) timedOutNames.push(name);
        }
        if (timedOutNames.length > 0) {
          for (const name of timedOutNames) {
            await tx.query(
              "INSERT INTO checks (repo_id, revision, name, state, summary, created_at_ms) VALUES ($1,$2,$3,'timed_out','',$4)",
              [repo.id, e.revision, name, now],
            );
          }
          const first = [...timedOutNames].sort()[0];
          await removeQueueEntry(deps, tx, repo.id, e.id, `Removed: check ${first} timed out`);
        }
      }
    }
  }

  /** A failure report on a queue revision removes its entry at once. */
  async onCheckFailure(repoId: number, revision: string, name: string): Promise<void> {
    await this.s.db.withTransaction(async (tx) => {
      const entries = await getQueueEntries(tx, repoId);
      for (const e of entries) {
        if (e.revision === revision) {
          await removeQueueEntry(this.deps(tx), tx, repoId, e.id, `Removed: check ${name} failed`);
        }
      }
    });
  }

  private deps(tx: pg.PoolClient) {
    return {
      db: this.s.db.pool, cfg: this.s.cfg, clock: this.s.clock, storage: this.s.storage,
      mailer: this.s.mailer, live: this.s.live, tx,
    };
  }
}
