/**
 * Pending index updates: rows queued in Postgres with each change, pushed to Meilisearch every 2 seconds and
 * confirmed only when Meilisearch reports the task `succeeded`.
 */
import { monotonicMs, type AppClock } from "./clock.js";
import { INDEXER_LOCK, type Database } from "./db.js";
import { SearchClient, SearchUnavailable } from "./meili.js";
import { UNIT_SELECT, isVisible, toSearchDocument, type UnitRow } from "./units.js";

const TICK_MS = 2_000;

export class Indexer {
  private reachable = true;
  private indexReady = false;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly search: SearchClient,
    private readonly clock: AppClock,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs one push-and-confirm pass now; overlapping calls share the pass already running. */
  tick(): Promise<void> {
    this.running ??= this.pass()
      .catch((error: unknown) => {
        if (error instanceof SearchUnavailable) this.reachable = false;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Waits up to `timeoutMs` for the given units' updates to be confirmed; gives up at once while search is down. */
  async settle(codes: string[], timeoutMs: number): Promise<void> {
    if (codes.length === 0) return;
    const deadline = monotonicMs() + timeoutMs;
    while (monotonicMs() < deadline) {
      await this.tick();
      if (!this.reachable) return;
      const pending = await this.db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM index_updates WHERE unit_code = ANY($1) AND confirmed_at IS NULL",
        [codes],
      );
      if ((pending.rows[0]?.n ?? 0) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  private async pass(): Promise<void> {
    if (!this.db.ready) return;
    if (!this.indexReady) {
      await this.search.ensureIndex();
      this.indexReady = true;
    }
    await this.reconcile();
    await this.push();
    this.reachable = true;
  }

  private async reconcile(): Promise<void> {
    const submitted = await this.db.query<{ task_uid: number }>(
      "SELECT DISTINCT task_uid FROM index_updates WHERE confirmed_at IS NULL AND task_uid IS NOT NULL",
    );
    const uids = submitted.rows.map((row) => row.task_uid);
    if (uids.length === 0) return;
    const tasks = await this.search.tasks(uids);
    const byUid = new Map(tasks.map((task) => [task.uid, task.status]));
    const succeeded = uids.filter((uid) => byUid.get(uid) === "succeeded");
    const lost = uids.filter((uid) => {
      const status = byUid.get(uid);
      return status === undefined || status === "failed" || status === "canceled";
    });
    if (succeeded.length > 0) {
      await this.db.query("UPDATE index_updates SET confirmed_at = $2 WHERE task_uid = ANY($1) AND confirmed_at IS NULL", [
        succeeded,
        this.clock.now(),
      ]);
    }
    if (lost.length > 0) {
      await this.db.query("UPDATE index_updates SET task_uid = NULL WHERE task_uid = ANY($1) AND confirmed_at IS NULL", [lost]);
    }
  }

  private async push(): Promise<void> {
    await this.db.tx(async (client) => {
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS locked", [INDEXER_LOCK]);
      if (!lock.rows[0]?.locked) return;
      const pending = await client.query<{ id: number; unit_code: string }>(
        "SELECT id, unit_code FROM index_updates WHERE confirmed_at IS NULL AND task_uid IS NULL ORDER BY id",
      );
      if (pending.rows.length === 0) return;
      const codes = [...new Set(pending.rows.map((row) => row.unit_code))];
      const units = await client.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = ANY($1)`, [codes]);
      const live = units.rows.filter(isVisible);
      const gone = units.rows.filter((row) => !isVisible(row)).map((row) => row.code);
      const taskOf = new Map<string, number>();
      if (live.length > 0) {
        const uid = await this.search.putDocuments(live.map(toSearchDocument));
        for (const row of live) taskOf.set(row.code, uid);
      }
      if (gone.length > 0) {
        const uid = await this.search.deleteDocuments(gone);
        for (const code of gone) taskOf.set(code, uid);
      }
      for (const [code, uid] of taskOf) {
        const ids = pending.rows.filter((row) => row.unit_code === code).map((row) => row.id);
        await client.query("UPDATE index_updates SET task_uid = $1 WHERE id = ANY($2)", [uid, ids]);
      }
    });
  }
}
