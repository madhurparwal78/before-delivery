import type { ServerResponse } from "node:http";
import pg from "pg";
import type { Actor } from "./auth.ts";
import { latestSeq } from "./audit.ts";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { may } from "./permissions.ts";
import type { Role } from "./text.ts";

interface CommittedAuditRow {
  seq: number;
  action: string;
  target_type: string;
  target_id: string;
  before: { role?: Role } | null;
  after: { role?: Role } | null;
}

const ROW_COLUMNS = "seq, action, target_type, target_id, before, after";

/**
 * One activity stream (DP-81..84): its own cursor, backlog position and visibility decisions.
 * Visibility comes from the caller's role right after each row committed, read from role history.
 */
class ActivityStream {
  private cursor: number;
  private buffer: CommittedAuditRow[] | null = [];
  private readonly roleChanges: { seq: number; before: Role; after: Role }[] = [];
  private readonly keepAlive: NodeJS.Timeout;

  constructor(
    readonly actor: Actor,
    private readonly currentRole: Role,
    private readonly res: ServerResponse,
    cursor: number,
  ) {
    this.cursor = cursor;
    this.keepAlive = setInterval(() => this.res.write(": keep-alive\n\n"), 10_000);
  }

  addRoleHistory(rows: CommittedAuditRow[]): void {
    for (const r of rows) this.roleChanges.push({ seq: r.seq, before: r.before!.role!, after: r.after!.role! });
  }

  private roleAt(seq: number): Role {
    let role: Role | null = null;
    for (const change of this.roleChanges) {
      if (change.seq <= seq) role = change.after;
      else return role ?? change.before;
    }
    return role ?? this.currentRole;
  }

  private visible(row: CommittedAuditRow): boolean {
    if (row.action === "user.role_change" && row.target_id === this.actor.id) return true;
    if (may.administer(this.roleAt(row.seq))) return true;
    return !row.action.startsWith("user.") && row.action !== "evidence.download";
  }

  offer(row: CommittedAuditRow): void {
    if (this.buffer) this.buffer.push(row);
    else this.deliver(row);
  }

  /** Backlog first, then whatever arrived live meanwhile; nothing repeated or skipped. */
  finishCatchUp(backlog: CommittedAuditRow[]): void {
    for (const row of backlog) this.deliver(row);
    const held = this.buffer ?? [];
    this.buffer = null;
    for (const row of held) this.deliver(row);
  }

  private deliver(row: CommittedAuditRow): void {
    if (row.seq <= this.cursor) return;
    this.cursor = row.seq;
    if (row.action === "user.role_change" && row.target_id === this.actor.id && !this.roleChanges.some((c) => c.seq === row.seq)) {
      this.addRoleHistory([row]);
    }
    if (!this.visible(row)) return;
    const data = JSON.stringify({ seq: row.seq, action: row.action, target: { type: row.target_type, id: row.target_id } });
    this.res.write(`id: ${row.seq}\nevent: change\ndata: ${data}\n\n`);
  }

  close(): void {
    clearInterval(this.keepAlive);
    this.res.end();
  }

  /** Ends a windowed stream cleanly; the closing id is the cursor its client resumes from. */
  endWindow(): void {
    this.res.write(`id: ${this.cursor}\n\n`);
    this.close();
  }

  release(): void {
    clearInterval(this.keepAlive);
  }
}

class Hub {
  private head = 0;
  private readonly streams = new Set<ActivityStream>();
  private pulling: Promise<void> | null = null;
  private again = false;

  async start(): Promise<void> {
    this.head = await latestSeq(pool);
    await this.listen();
    setInterval(() => void this.pull(), 1_000).unref();
    setInterval(() => void this.endSessions(), 2_000).unref();
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: config.databaseUrl, application_name: "strata-listen" });
    client.on("notification", () => void this.pull());
    client.on("error", () => {
      client.end().catch(() => undefined);
      setTimeout(() => void this.listen().catch(() => undefined), 1_000);
    });
    await client.connect();
    await client.query("listen strata_audit");
  }

  /** Reads newly committed rows once per instance and offers them to every open stream in seq order. */
  pull(): Promise<void> {
    if (this.pulling) {
      this.again = true;
      return this.pulling;
    }
    this.pulling = (async () => {
      do {
        this.again = false;
        const { rows } = await pool.query(`select ${ROW_COLUMNS} from audit_log where seq > $1 order by seq`, [this.head]);
        for (const row of rows as CommittedAuditRow[]) {
          this.head = row.seq;
          for (const stream of this.streams) stream.offer(row);
        }
      } while (this.again);
    })()
      .catch(() => undefined)
      .finally(() => (this.pulling = null));
    return this.pulling;
  }

  private async endSessions(): Promise<void> {
    if (!this.streams.size) return;
    const hashes = [...new Set([...this.streams].map((s) => s.actor.tokenHash))];
    const { rows } = await pool.query("select token_hash from sessions where token_hash = any($1)", [hashes]).catch(() => ({ rows: null }));
    if (!rows) return;
    const live = new Set(rows.map((r: { token_hash: string }) => r.token_hash));
    for (const stream of this.streams) {
      if (!live.has(stream.actor.tokenHash)) {
        this.streams.delete(stream);
        stream.close();
      }
    }
  }

  async open(actor: Actor, res: ServerResponse, cursor: number | null, windowMs: number | null): Promise<void> {
    const start = cursor ?? await latestSeq(pool);
    const stream = new ActivityStream(actor, actor.role, res, start);
    this.streams.add(stream);
    const window = windowMs === null ? null : setTimeout(() => {
      this.streams.delete(stream);
      stream.endWindow();
    }, windowMs);
    res.on("close", () => {
      if (window) clearTimeout(window);
      this.streams.delete(stream);
      stream.release();
    });
    const history = await pool.query(
      `select ${ROW_COLUMNS} from audit_log where action = 'user.role_change' and target_id = $1 order by seq`,
      [actor.id],
    );
    stream.addRoleHistory(history.rows);
    const backlog = await pool.query(`select ${ROW_COLUMNS} from audit_log where seq > $1 order by seq`, [start]);
    stream.finishCatchUp(backlog.rows);
  }
}

export const hub = new Hub();
