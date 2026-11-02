import type { Database } from './db';
import type { DbRow } from './querier';

export interface AuditEventRow {
  seq: number;
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
  after: unknown;
}

type Listener = (rows: AuditEventRow[]) => void;

/**
 * Fans committed audit rows out to this instance's streams by polling the
 * shared database about once per second, so rows committed on any instance
 * reach every open stream within the 2-second bound (DP-82).
 */
export class Fanout {
  private lastSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly sessionChecks = new Map<string, () => void>();
  private running = false;

  constructor(private readonly db: Database) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onRows(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A stream registers its session token so the poller can report its end (DP-82). */
  watchSession(tokenHash: string, onEnd: () => void): () => void {
    this.sessionChecks.set(tokenHash, onEnd);
    return () => this.sessionChecks.delete(tokenHash);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.db.query<EventDbRow>(
        `SELECT seq, action, target_type, target_id, actor_id, after FROM audit_log WHERE seq > $1 ORDER BY seq ASC LIMIT 500`,
        [this.lastSeq]
      );
      if (rows.length > 0) {
        this.lastSeq = rows[rows.length - 1]!.seq;
        for (const l of [...this.listeners]) l(rows.map(toEvent));
      } else if (this.lastSeq === 0) {
        const max = await this.db.queryOne<{ max: string | null }>(`SELECT max(seq) AS max FROM audit_log`);
        this.lastSeq = Number(max?.max ?? 0);
      }
      if (this.sessionChecks.size > 0) {
        const tokens = [...this.sessionChecks.keys()];
        const alive = new Set(
          (await this.db.query<{ token_hash: string }>(`SELECT token_hash FROM sessions WHERE token_hash = ANY($1)`, [tokens])).map(
            (r) => r.token_hash
          )
        );
        for (const token of tokens) {
          if (!alive.has(token)) {
            const cb = this.sessionChecks.get(token);
            this.sessionChecks.delete(token);
            cb?.();
          }
        }
      }
    } catch {
      /* the next tick retries */
    } finally {
      this.running = false;
    }
  }
}

interface EventDbRow extends DbRow {
  seq: number;
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
  after: unknown;
}

function toEvent(r: EventDbRow): AuditEventRow {
  return { seq: r.seq, action: r.action, target_type: r.target_type, target_id: r.target_id, actor_id: r.actor_id, after: r.after ?? null };
}
