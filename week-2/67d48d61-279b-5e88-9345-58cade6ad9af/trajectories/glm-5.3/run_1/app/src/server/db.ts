import type { Pool, PoolClient } from "pg";
import {
  CYCLES, CREW, type Priority, type Status, OPEN_STATUSES, idFromNumber, numberFromId,
} from "../domain/model.js";
import type { TaskJson, TaskRow, SnapshotJson, ActivityJson, AttachmentJson } from "../domain/types.js";

export class Db {
  spans: { key: string; startsAt: Date; endsAt: Date | null }[] = [];
  currentCycleKey = "";

  constructor(private pool: Pool) {}

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    return (await this.pool.query(sql, params)).rows;
  }

  async allTasks(): Promise<TaskRow[]> {
    return this.query("select * from tasks order by number") as unknown as Promise<TaskRow[]>;
  }

  async tasksJson(): Promise<Map<number, TaskJson>> {
    const rows = await this.allTasks();
    const links = (await this.query("select source, target from links")) as unknown as { source: number; target: number }[];
    const subs = (await this.query(
      `select parent, count(*)::int as total, count(*) filter (where status = 'done')::int as done
       from tasks where parent is not null and status <> 'cancelled' group by parent`,
    )) as unknown as { parent: number; total: number; done: number }[];
    const openRows = await this.query(`select number from tasks where status = any($1::text[])`, [OPEN_STATUSES]);
    const openSet = new Set<number>(openRows.map((r) => r.number as number));
    const blockedBy = new Map<number, number[]>();
    const blocks = new Map<number, number[]>();
    for (const l of links as { source: number; target: number }[]) {
      if (!blocks.has(l.source)) blocks.set(l.source, []);
      blocks.get(l.source)!.push(l.target);
      if (!blockedBy.has(l.target)) blockedBy.set(l.target, []);
      blockedBy.get(l.target)!.push(l.source);
    }
    const subMap = new Map<number, { done: number; total: number }>();
    for (const s of subs) subMap.set(s.parent as number, { done: Number(s.done), total: Number(s.total) });
    const byNumber = new Map<number, TaskJson>();
    for (const t of rows) {
      byNumber.set(t.number, {
        id: idFromNumber(t.number), number: t.number, title: t.title, details: t.details,
        department: t.department, label: t.label, status: t.status, priority: t.priority,
        owner: t.owner, cycle: t.cycle,
        parent: t.parent === null ? null : idFromNumber(t.parent),
        subtasks: subMap.has(t.number) ? subMap.get(t.number)! : null,
        blocked_by: (blockedBy.get(t.number) ?? []).map(idFromNumber).sort((a, b) => numberFromId(a) - numberFromId(b)),
        blocks: (blocks.get(t.number) ?? []).map(idFromNumber).sort((a, b) => numberFromId(a) - numberFromId(b)),
        blocked: OPEN_STATUSES.includes(t.status) && (blockedBy.get(t.number) ?? []).some((b) => openSet.has(b)),
        duplicate_of: t.duplicate_of === null ? null : idFromNumber(t.duplicate_of),
        request: t.request, version: t.version,
        updated_at: t.updated_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
    }
    return byNumber;
  }

  /** The one place the snapshot counts are decided (DP-03). */
  async snapshot(client?: PoolClient): Promise<SnapshotJson> {
    const c = client ?? this.pool;
    const seq = (await c.query("select coalesce(max(seq),0)::int as seq from journal")).rows[0].seq;
    const counts = await c.query(
      "select status, count(*)::int as n from tasks where status not in ('triage','duplicate') group by status");
    const triage = (await c.query("select count(*)::int as n from tasks where status = 'triage'")).rows[0].n;
    const blocked = (await c.query(
      `select count(distinct l.target)::int as n from links l
       join tasks b on b.number = l.source and b.status = any($1::text[])
       join tasks t on t.number = l.target and t.status = any($1::text[])`, [OPEN_STATUSES],
    )).rows[0].n;
    const columns: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0 };
    for (const r of counts.rows) columns[r.status] = r.n;

    const cyc = await c.query(
      `select cycle, count(*) filter (where status <> 'cancelled')::int as total,
              count(*) filter (where status = 'done')::int as done
       from tasks where cycle is not null group by cycle`);
    const cycMap = new Map<string, { total: number; done: number }>();
    for (const r of cyc.rows) cycMap.set(r.cycle, { total: r.total, done: r.done });
    return {
      seq, triage, columns, blocked,
      cycles: CYCLES.map((c2, i) => {
        const s = this.spans[i]!;
        const v = cycMap.get(c2.key) ?? { total: 0, done: 0 };
        return {
          key: c2.key, name: c2.name,
          starts_at: iso(s.startsAt), ends_at: s.endsAt ? iso(s.endsAt) : null,
          current: c2.key === this.currentCycleKey, done: v.done, total: v.total,
        };
      }),
    };
  }

  /** The saved Task, assembled the same way for reads and 412 errors. */
  async taskJson(number: number): Promise<TaskJson | null> {
    const byNumber = await this.tasksJson();
    return byNumber.get(number) ?? null;
  }

  async activityFor(taskNumber: number): Promise<ActivityJson[]> {
    interface ActivityRow extends Omit<ActivityJson, "at" | "id" | "actor" | "task"> { at: Date; id: number; actor_handle: string | null; task: number }
    const rows = (await this.query("select * from activity where task = $1 order by id", [taskNumber])) as unknown as ActivityRow[];
    const crew = new Map(CREW.map((c) => [c.handle, c.name]));
    return rows.map((a): ActivityJson => ({
      id: a.id,
      task: idFromNumber(a.task),
      at: iso(a.at),
      actor: a.actor_handle === null ? null : { handle: a.actor_handle, name: crew.get(a.actor_handle) ?? a.actor_handle },
      kind: a.kind,
      changes: a.changes,
      change: a.change,
    }));
  }

  async attachmentsFor(taskNumber: number): Promise<AttachmentJson[]> {
    interface AttachmentRow extends Omit<AttachmentJson, "created_at" | "id" | "task"> { created_at: Date; id: string; task: number }
    const rows = (await this.query(
      "select * from attachments where task = $1 order by created_at desc, id desc", [taskNumber])) as unknown as AttachmentRow[];
    // newest of each kind is current
    const newestByKind = new Map<string, string>();
    for (const a of rows) if (!newestByKind.has(a.kind)) newestByKind.set(a.kind, a.id);
    return rows.map((a) => ({
      id: a.id, task: idFromNumber(a.task), file_name: a.file_name, kind: a.kind,
      size: Number(a.size), content_type: a.content_type, created_at: iso(a.created_at),
      current: newestByKind.get(a.kind) === a.id,
    }));
  }
}

export function iso(d: Date): string { return d.toISOString().replace(/\.\d{3}Z$/, "Z") }

export function rowToJson(t: TaskRow, rel: { blockedBy: number[]; blocks: number[]; subtasks: { done: number; total: number } | null; blocked: boolean }): TaskJson {
  return {
    id: idFromNumber(t.number), number: t.number, title: t.title, details: t.details,
    department: t.department, label: t.label, status: t.status as Status, priority: t.priority as number as Priority,
    owner: t.owner, cycle: t.cycle,
    parent: t.parent === null ? null : idFromNumber(t.parent), subtasks: rel.subtasks,
    blocked_by: rel.blockedBy.map(idFromNumber), blocks: rel.blocks.map(idFromNumber),
    blocked: rel.blocked, duplicate_of: t.duplicate_of === null ? null : idFromNumber(t.duplicate_of),
    request: t.request, version: t.version, updated_at: iso(t.updated_at),
  };
}
