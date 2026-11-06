import type { PoolClient } from "pg";
import {
  computeCascade, idFromNumber, numberFromId, OPEN_STATUSES,
  type ActivityKind, type Status,
} from "../domain/model.js";
import type { StoredUndo, TaskBefore, TaskRow } from "../domain/types.js";


export class RuleError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) { super(code) }
}

export interface CascadeEntry { id: string; depth: number; order: number; freed_by: string }
export interface ReblockedEntry { id: string; order: number }

export interface FinishOptions {
  kind: string;
  /** tasks the change wrote directly (listed in `tasks` unless removed as freed) */
  direct: Set<number>;
  /** tasks always listed in `tasks` in addition (the blocked task of a removed link) */
  alsoListed?: Set<number>;
  /** level per task the change closed: 0 direct, >0 rolled-up parent */
  levels: Map<number, number>;
  /** the roll-up runs unless this is an undo */
  skipRollup?: boolean;
  /** link-removal path: the freed task, if any, and its blocker */
  link?: { freed: number[]; blocker: string };
  undo?: { crew: string; kind: "edit" | "bulk" };
  request?: unknown;
}

export interface Outcome {
  change: number;
  kind: string;
  touched: number[];
  cascade: CascadeEntry[];
  reblocked: ReblockedEntry[];
  undoable: boolean;
  request: unknown;
  /** set when the request changed nothing: no new change is committed */
  noop?: boolean;
}

/**
 * One change = one transaction. Everything a change touches is written through
 * this engine so the blocked overlay, the roll-up, the cascade order and the
 * undo journal are each decided in exactly one place.
 */
export class Engine {
  change = 0;
  private before = new Map<number, TaskRow>();
  /** blocked state of every task, read inside the transaction before any write */
  private preBlocked = new Map<number, boolean>();

  constructor(private client: PoolClient, private actor: string) {}

  async begin(): Promise<void> {
    await this.client.query("begin");
    await this.client.query("select pg_advisory_xact_lock(781273)");
    const r = await this.client.query("select coalesce(max(seq),0)::int as seq from journal");
    this.change = r.rows[0].seq + 1;
    const pre = await this.client.query(
      `select t.number, t.status,
        exists(select 1 from links l join tasks b on b.number = l.source
               where l.target = t.number and b.status in ('backlog','todo','in_progress')) as blocked
      from tasks t`);
    for (const row of pre.rows) {
      this.preBlocked.set(row.number, row.blocked && OPEN_STATUSES.includes(row.status as Status));
    }
  }

  async commit(): Promise<void> { await this.client.query("commit") }
  async rollback(): Promise<void> {
    try { await this.client.query("rollback") } catch { /* already aborted */ }
  }

  selectRow = async (sql: string, params?: unknown[]): Promise<TaskRow | null> =>
    (await this.client.query(sql, params)).rows[0] ?? null;
  selectAllRows = async (sql: string, params?: unknown[]): Promise<TaskRow[]> =>
    (await this.client.query(sql, params)).rows;

  async task(number: number): Promise<TaskRow | null> {
    return this.selectRow("select * from tasks where number = $1", [number]) as unknown as Promise<TaskRow | null>;
  }

  async taskForUpdate(number: number): Promise<TaskRow | null> {
    return this.selectRow("select * from tasks where number = $1 for update", [number]) as unknown as Promise<TaskRow | null>;
  }

  remember(row: TaskRow): void {
    if (!this.before.has(row.number)) this.before.set(row.number, row);
  }

  /** Snapshot of the fields undo restores, captured before the first write. */
  beforeValues(numbers: number[]): TaskBefore[] {
    const out: TaskBefore[] = [];
    for (const n of numbers) {
      const b = this.before.get(n);
      if (b) out.push({
        number: n, status: b.status, priority: b.priority, owner: b.owner,
        title: b.title, details: b.details, label: b.label, cycle: b.cycle,
      });
    }
    return out.sort((a, b) => a.number - b.number);
  }

  /** Write fields to a task, bump its version and write its one activity entry. */
  async write(
    number: number,
    fields: Partial<TaskRow>,
    act: { kind: ActivityKind; changes: Record<string, { from: unknown; to: unknown }>; actor?: string | null } | null,
  ): Promise<TaskRow> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = $${i++}`); params.push(v) }
    sets.push("updated_at = now()");
    params.push(number);
    const r = await this.client.query(
      `update tasks set ${sets.join(", ")}, version = version + 1 where number = $${i} returning *`,
      params,
    );
    const row = r.rows[0] as TaskRow;
    if (act) await this.activity(number, act.kind, act.changes, act.actor === undefined ? this.actor : act.actor);
    return row;
  }

  async activity(
    task: number, kind: ActivityKind, changes: Record<string, { from: unknown; to: unknown }>, actor: string | null,
  ): Promise<void> {
    await this.client.query(
      "insert into activity (task, kind, changes, actor_handle, change) values ($1,$2,$3,$4,$5)",
      [task, kind, JSON.stringify(changes), actor, this.change],
    );
  }

  /**
   * Runs the sub-task roll-up, recomputes the blocked overlay, computes the
   * cascade and reblocked lists and writes the journal entry. The one place
   * for the roll-up (DP-23), the cascade order (DP-11) and reblocked.
   */
  async finish(opts: FinishOptions): Promise<Outcome> {
    const levels = new Map(opts.levels);
    const allDirect = [...opts.direct, ...(opts.alsoListed ?? [])];
    const scope = new Set<number>(allDirect);
    const touchedParents = new Set<number>();

    // --- roll-up (DP-23), the one place ---
    if (!opts.skipRollup) {
      const parentRows = await this.selectAllRows(
        "select distinct parent from tasks where parent is not null and number = any($1::int[])", [allDirect],
      );
      for (const pr of parentRows) {
        const parent = pr.parent as number;
        const p = await this.task(parent);
        if (!p) continue;
        const subs = await this.selectAllRows(
          "select number, status from tasks where parent = $1 and status <> 'cancelled'", [parent],
        ) as { number: number; status: Status }[];
        if (subs.length === 0) continue;
        const allDone = subs.every((s) => s.status === "done");
        const anyDone = subs.some((s) => s.status === "done");
        const anyOpen = subs.some((s) => OPEN_STATUSES.includes(s.status));
        if (OPEN_STATUSES.includes(p.status) && allDone && anyDone) {
          let maxSub = 0;
          for (const s of subs) {
            if (s.status !== "done") continue;
            const lvl = levels.get(s.number);
            if (lvl !== undefined && lvl > maxSub) maxSub = lvl;
          }
          this.remember(p);
          await this.write(parent, { status: "done" }, {
            kind: "auto_closed", changes: { status: { from: p.status, to: "done" } }, actor: null,
          });
          levels.set(parent, maxSub + 1);
          scope.add(parent);
          touchedParents.add(parent);
        } else if (p.status === "done" && anyOpen) {
          this.remember(p);
          await this.write(parent, { status: "in_progress" }, {
            kind: "auto_reopened", changes: { status: { from: p.status, to: "in_progress" } }, actor: null,
          });
          scope.add(parent);
          touchedParents.add(parent);
        }
      }
    }

    const after = await this.blockedState(scope);

    const cascade: CascadeEntry[] = [];
    const reblocked: ReblockedEntry[] = [];

    if (opts.link) {
      for (const n of opts.link.freed) {
        cascade.push({ id: idFromNumber(n), depth: 1, order: 1, freed_by: opts.link.blocker });
      }
    } else {
      const freed: { id: string; blockersClosedInChange: { id: string; number: number; level: number }[] }[] = [];
      for (const num of after.keys()) {
        const wasBlocked = this.preBlocked.get(num) ?? false;
        const nowBlocked = after.get(num) ?? false;
        if (wasBlocked && !nowBlocked) {
          const s = await this.selectRow("select status from tasks where number = $1", [num]);
          if (s && OPEN_STATUSES.includes(s.status as Status)) {
            const bl = await this.selectAllRows(
              `select l.source from links l join tasks b on b.number = l.source
               where l.target = $1 and b.status not in ('backlog','todo','in_progress')`, [num],
            ) as unknown as { source: number }[];
            freed.push({
              id: idFromNumber(num),
              blockersClosedInChange: bl.map((r) => ({
                id: idFromNumber(r.source), number: r.source, level: levels.get(r.source) ?? -1,
              })),
            });
          }
        }
        if (!wasBlocked && nowBlocked) reblocked.push({ id: idFromNumber(num), order: 0 });
      }
      cascade.push(...computeCascade(freed));
      reblocked.sort((a, b) => numberFromId(a.id) - numberFromId(b.id));
      reblocked.forEach((r, i) => { r.order = i + 1 });
    }

    const touched = new Set<number>([...allDirect, ...touchedParents]);
    for (const c of cascade) touched.delete(numberFromId(c.id));

    await this.client.query(
      "insert into journal (seq, kind, actor, undoable, undone) values ($1,$2,$3,$4,false)",
      [this.change, opts.kind, this.actor, opts.undo ? true : false],
    );
    if (opts.undo) {
      // the undo journal holds every task the change touched, parents included,
      // with its exact pre-change fields and the version the change left it at
      const nums = [...allDirect, ...touchedParents];
      const before = this.beforeValues(nums);
      const afterVersions: { number: number; version: number }[] = [];
      for (const n of nums) {
        const row = await this.task(n);
        if (row) afterVersions.push({ number: n, version: row.version });
      }
      await this.client.query(
        `insert into undo_journal (change, crew, kind, before, after_versions, cascade_json)
         values ($1,$2,$3,$4,$5,$6)`,
        [this.change, opts.undo.crew, opts.undo.kind, JSON.stringify(before),
         JSON.stringify(afterVersions), JSON.stringify(cascade)],
      );
    }

    return {
      change: this.change, kind: opts.kind, touched: [...touched].sort((a, b) => a - b),
      cascade, reblocked, undoable: opts.undo !== undefined && opts.undo !== null,
      request: opts.request ?? null,
    };
  }

  /** The blocked overlay (DP-10), the one place it is derived. */
  private async blockedState(scope: Set<number>): Promise<Map<number, boolean>> {
    const m = new Map<number, boolean>();
    const visit = async (nums: number[]) => {
      if (nums.length === 0) return;
      const r = (await this.selectAllRows(
        `select t.number, t.status,
          exists(select 1 from links l join tasks b on b.number = l.source
                 where l.target = t.number and b.status in ('backlog','todo','in_progress')) as blocked
        from tasks t where t.number = any($1::int[])`, [nums],
      )) as unknown as { number: number; status: Status; blocked: boolean }[];
      for (const row of r) m.set(row.number, row.blocked && OPEN_STATUSES.includes(row.status));
    };
    const scopeNums = [...scope];
    await visit(scopeNums);
    const neigh = await this.selectAllRows(
      `select l.target as n from links l where l.source = any($1::int[])
       union select l.source as n from links l where l.target = any($1::int[])`, [scopeNums],
    );
    await visit((neigh as unknown as { n: number }[]).map((x) => x.n).filter((n) => !scope.has(n)));
    return m;
  }
}
