// Promptside's domain rules on the task graph. The blocked overlay, the sub-task roll-up, the
// cascade order, the undo restore and the snapshot counts are decided here, in one place each;
// the status edges live beside the statuses in shared/catalog.ts. Everything works on a
// TaskGraph read inside the change's transaction.

import { CYCLES, canMove, isOpen, taskId, type CycleSpan, type Freed, type Reblocked, type Snapshot, type StatusKey, type Task } from "../shared/catalog.js";
import type { CycleWindow } from "./cycles.js";

export interface TaskRow {
  number: number;
  title: string;
  details: string;
  department: string | null;
  label: string | null;
  status: StatusKey;
  priority: number;
  owner: string | null;
  cycle: string | null;
  parent: number | null;
  duplicate_of: number | null;
  request: string | null;
  version: number;
  updated_at: Date;
}

export const RESTORED_FIELDS = ["status", "priority", "owner", "title", "details", "label", "cycle"] as const;
export type Restorable = Pick<TaskRow, (typeof RESTORED_FIELDS)[number]>;
export type Edit = Partial<Restorable>;

const isClosed = (status: StatusKey): boolean => status === "done" || status === "cancelled" || status === "duplicate";

const isoSeconds = (instant: Date): string => instant.toISOString().replace(/\.\d{3}Z$/, "Z");

export const restorable = (row: TaskRow): Restorable =>
  Object.fromEntries(RESTORED_FIELDS.map((f) => [f, row[f]])) as Restorable;

const push = (map: Map<number, number[]>, key: number, value: number): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

// Done and total sub-tasks of a parent, leaving out cancelled ones.
const tally = (kids: TaskRow[]): { done: number; total: number } => {
  const counted = kids.filter((k) => k.status !== "cancelled");
  return { done: counted.filter((k) => k.status === "done").length, total: counted.length };
};

export class TaskGraph {
  readonly rows: Map<number, TaskRow>;
  readonly links: ReadonlyArray<readonly [number, number]>;
  private readonly blockersOf = new Map<number, number[]>();
  private readonly blocksOf = new Map<number, number[]>();
  private readonly childrenOf = new Map<number, number[]>();

  constructor(rows: Iterable<TaskRow>, links: ReadonlyArray<readonly [number, number]>) {
    this.rows = new Map([...rows].map((row) => [row.number, row]));
    this.links = links;
    for (const [blocker, blocked] of links) {
      push(this.blockersOf, blocked, blocker);
      push(this.blocksOf, blocker, blocked);
    }
    for (const row of this.rows.values()) if (row.parent !== null) push(this.childrenOf, row.parent, row.number);
    for (const list of [...this.blockersOf.values(), ...this.blocksOf.values(), ...this.childrenOf.values()]) list.sort((a, b) => a - b);
  }

  with(changed: Iterable<TaskRow>, links = this.links): TaskGraph {
    const rows = new Map(this.rows);
    for (const row of changed) rows.set(row.number, row);
    return new TaskGraph(rows.values(), links);
  }

  // Callers pass numbers already resolved against this graph (taskOrThrow, links, children).
  row(n: number): TaskRow {
    return this.rows.get(n) as TaskRow;
  }

  blockers(n: number): number[] {
    return this.blockersOf.get(n) ?? [];
  }

  blocks(n: number): number[] {
    return this.blocksOf.get(n) ?? [];
  }

  children(n: number): number[] {
    return this.childrenOf.get(n) ?? [];
  }

  hasLink(blocker: number, blocked: number): boolean {
    return this.blocks(blocker).includes(blocked);
  }

  // The blocked overlay: open, with at least one open blocker. Never stored.
  openBlockers(n: number): number[] {
    return this.blockers(n).filter((b) => isOpen(this.row(b).status));
  }

  isBlocked(n: number): boolean {
    return isOpen(this.row(n).status) && this.openBlockers(n).length > 0;
  }

  blockedSet(): Set<number> {
    return new Set([...this.rows.keys()].filter((n) => this.isBlocked(n)));
  }

  // True when linking blocker → blocked would close a loop through existing links.
  wouldLoop(blocker: number, blocked: number): boolean {
    const seen = new Set<number>();
    const stack = [blocked];
    while (stack.length) {
      const n = stack.pop() as number;
      if (n === blocker) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...this.blocks(n));
    }
    return false;
  }

  task(n: number): Task {
    const row = this.row(n);
    const kids = this.children(n);
    return {
      id: taskId(row.number),
      number: row.number,
      title: row.title,
      details: row.details,
      department: row.department,
      label: row.label,
      status: row.status,
      priority: row.priority,
      owner: row.owner,
      cycle: row.cycle,
      parent: row.parent === null ? null : taskId(row.parent),
      subtasks: kids.length ? tally(kids.map((k) => this.row(k))) : null,
      blocked_by: this.blockers(n).map(taskId),
      blocks: this.blocks(n).map(taskId),
      blocked: this.isBlocked(n),
      duplicate_of: row.duplicate_of === null ? null : taskId(row.duplicate_of),
      request: row.request,
      version: row.version,
      updated_at: isoSeconds(row.updated_at),
    };
  }
}

export type TouchKind = "edited" | "auto_closed" | "auto_reopened";

// The sub-task roll-up. `changed` are sub-tasks whose status this change set (a new sub-task
// has no earlier status); their parents close or reopen in `rows`, which is updated in place.
export const rollUp = (before: TaskGraph, after: TaskGraph, changed: number[], rows: Map<number, TaskRow>, touched: Map<number, TouchKind>): void => {
  const current = (n: number): TaskRow => rows.get(n) ?? after.row(n);
  for (const n of changed) {
    const was = before.rows.get(n);
    const now = current(n);
    if (now.parent === null || now.status === was?.status || touched.has(now.parent)) continue;
    const parent = current(now.parent);
    if ((now.status === "done" || now.status === "cancelled") && isOpen(parent.status)) {
      const { done, total } = tally(after.children(parent.number).map(current));
      if (total > 0 && done === total) {
        rows.set(parent.number, { ...parent, status: "done" });
        touched.set(parent.number, "auto_closed");
      }
    } else if (isOpen(now.status) && !(was && isOpen(was.status)) && parent.status === "done") {
      rows.set(parent.number, { ...parent, status: "in_progress" });
      touched.set(parent.number, "auto_reopened");
    }
  }
};

export interface EditOutcome {
  after: TaskGraph;
  touched: Map<number, TouchKind>;
  levels: Map<number, number>;
}

// Applies requested edits, then the roll-up, in one step. Tasks closed by the request have level 0;
// a parent closed by roll-up has level 1 (sub-tasks go one level deep).
export const applyEdits = (before: TaskGraph, edits: Map<number, Edit>): EditOutcome => {
  const rows = new Map<number, TaskRow>();
  const touched = new Map<number, TouchKind>();
  for (const [n, edit] of edits) {
    const row = before.row(n);
    const next = { ...row, ...edit };
    if (RESTORED_FIELDS.some((f) => next[f] !== row[f])) {
      rows.set(n, next);
      touched.set(n, "edited");
    }
  }
  rollUp(before, before, [...touched.keys()], rows, touched);
  const levels = new Map([...touched].filter(([, kind]) => kind === "auto_closed").map(([n]) => [n, 1]));
  return { after: before.with(rows.values()), touched, levels };
};

export interface Refusal {
  code: "not_editable" | "illegal_transition" | "blocked_by_open" | "open_subtasks";
  tasks: number[];
  blockedBy: number[];
}

// The refusal checks of an edit or bulk change, in the brief's order, judged after the whole change.
export const refusalOf = (before: TaskGraph, after: TaskGraph, edits: Map<number, Edit>): Refusal | null => {
  const ids = [...edits.keys()].sort((a, b) => a - b);
  const moving = (n: number): StatusKey | undefined => {
    const to = edits.get(n)?.status;
    return to !== undefined && to !== before.row(n).status ? to : undefined;
  };
  const refuse = (code: Refusal["code"], tasks: number[], blockedBy: number[] = []): Refusal | null =>
    tasks.length ? { code, tasks, blockedBy } : null;
  const toDone = ids.filter((n) => moving(n) === "done");
  const blockedBy = [...new Set(toDone.flatMap((n) => after.openBlockers(n)))].sort((a, b) => a - b);
  return (
    refuse("not_editable", ids.filter((n) => before.row(n).status === "triage" || before.row(n).status === "duplicate")) ??
    refuse("illegal_transition", ids.filter((n) => moving(n) !== undefined && !canMove(before.row(n).status, moving(n) as StatusKey))) ??
    refuse("blocked_by_open", toDone.filter((n) => after.openBlockers(n).length > 0), blockedBy) ??
    refuse("open_subtasks", toDone.filter((n) => after.children(n).some((k) => isOpen(after.row(k).status))))
  );
};

// The cascade of a change that closes tasks: every task taken from blocked to unblocked while it
// stays open, with the freeing task, depth and order.
export const cascadeOf = (before: TaskGraph, after: TaskGraph, levels: Map<number, number>): Freed[] => {
  const closedNow = (n: number): boolean => !isClosed(before.row(n).status) && isClosed(after.row(n).status);
  const level = (b: number): number => levels.get(b) ?? 0;
  const freed = [...before.blockedSet()]
    .filter((n) => isOpen(after.row(n).status) && !after.isBlocked(n))
    .map((n) => {
      const by = after.blockers(n).filter(closedNow).reduce((best, b) => (level(b) > level(best) || (level(b) === level(best) && b > best) ? b : best));
      return { n, by, depth: level(by) + 1 };
    })
    .sort((a, b) => a.depth - b.depth || a.n - b.n);
  return freed.map((f, i) => ({ id: taskId(f.n), depth: f.depth, order: i + 1, freed_by: taskId(f.by) }));
};

// The cascade of removing a link, which closes nothing: only the task the link blocked can be freed.
export const unlinkCascade = (before: TaskGraph, after: TaskGraph, blocker: number, blocked: number): Freed[] =>
  before.isBlocked(blocked) && !after.isBlocked(blocked) ? [{ id: taskId(blocked), depth: 1, order: 1, freed_by: taskId(blocker) }] : [];

// Tasks a change took from not blocked to blocked: for an undo, the undone cascade in reverse
// order (then anything else re-blocked); otherwise in task-number order.
export const reblockedOf = (before: TaskGraph, after: TaskGraph, undone: Freed[] = []): Reblocked[] => {
  const blockedBefore = before.blockedSet();
  const now = [...after.blockedSet()].filter((n) => !blockedBefore.has(n)).sort((a, b) => a - b);
  const reversed = [...undone].reverse().map((f) => now.find((n) => taskId(n) === f.id)).filter((n): n is number => n !== undefined);
  return [...reversed, ...now.filter((n) => !reversed.includes(n))].map((n, i) => ({ id: taskId(n), order: i + 1 }));
};

// Undo puts each touched task back exactly as it was; no roll-up, no edge checks.
export const restore = (before: TaskGraph, saved: Map<number, Restorable>): TaskGraph =>
  before.with([...saved].map(([n, fields]) => ({ ...before.row(n), ...fields })));

export const snapshotOf = (graph: TaskGraph, seq: number, windows: CycleWindow[], current: number): Snapshot => {
  const rows = [...graph.rows.values()];
  const count = (status: StatusKey): number => rows.filter((r) => r.status === status).length;
  const cycles: CycleSpan[] = windows.map((w, i) => {
    const mine = rows.filter((r) => r.cycle === w.key);
    return {
      key: w.key,
      name: w.name,
      starts_at: isoSeconds(w.start),
      ends_at: w.end ? isoSeconds(w.end) : null,
      current: i === current,
      done: mine.filter((r) => r.status === "done").length,
      total: mine.filter((r) => r.status !== "cancelled").length,
    };
  });
  return {
    seq,
    triage: count("triage"),
    columns: {
      backlog: count("backlog"),
      todo: count("todo"),
      in_progress: count("in_progress"),
      done: count("done"),
      cancelled: count("cancelled"),
    },
    blocked: graph.blockedSet().size,
    cycles,
  };
};

export const cycleIndex = (key: string | null): number => CYCLES.findIndex((c) => c.key === key);
