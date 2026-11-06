// Task endpoints: listing, creation, versioned edits, bulk changes, undo and blocking links.

import {
  BULK_MAX,
  CREW,
  DEPARTMENTS,
  DETAILS_MAX,
  FIELD_MESSAGES as M,
  STATUSES,
  STATUS_NAMES,
  THEATRE,
  SHOW,
  TITLE_MAX,
  crewByHandle,
  departmentByKey,
  taskId,
  taskNumber,
  type ActivityEntry,
  type StatusKey,
  isEditable,
} from "../shared/catalog.js";
import { bumped, readGraph, snapshotFor, underLock, type ActivityDraft, type Journal, type Work } from "./changes.js";
import { config } from "./config.js";
import { calendar, daysBetween, localDate, openingNight } from "./cycles.js";
import { currentSeq, pool } from "./db.js";
import {
  RESTORED_FIELDS,
  applyEdits,
  cascadeOf,
  cycleIndex,
  reblockedOf,
  refusalOf,
  restorable,
  restore,
  rollUp,
  unlinkCascade,
  type TaskGraph,
  type Edit,
  type EditOutcome,
  type Refusal,
  type TaskRow,
  type TouchKind,
} from "./domain.js";
import { ApiError, invalid, notFound, route, type Reply } from "./http.js";
import { checkServices } from "./status.js";

type Fields = Record<string, string>;

export const ok = (body: unknown, status = 200): Reply => ({ status, body });

const isPriority = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4;
const isStatus = (v: unknown): v is StatusKey => typeof v === "string" && (STATUSES as string[]).includes(v);
const isLabelOf = (department: string | null, label: unknown): boolean =>
  label === null || (departmentByKey(department)?.labels.some((l) => l.key === label) ?? false);

const titleProblem = (v: unknown): string | null => {
  if (typeof v !== "string" || v.trim() === "") return M.titleEmpty;
  return v.trim().length > TITLE_MAX ? M.titleLong : null;
};

export const known = (graph: TaskGraph, id: unknown): number | null => {
  const n = typeof id === "string" ? taskNumber(id) : null;
  return n !== null && graph.rows.has(n) ? n : null;
};

export const taskOrThrow = (graph: TaskGraph, id: string): number => {
  const n = known(graph, id);
  if (n === null) throw notFound(`Task ${id}`);
  return n;
};

export const diff = (before: TaskRow, after: TaskRow): ActivityDraft["changes"] =>
  Object.fromEntries(RESTORED_FIELDS.filter((f) => before[f] !== after[f]).map((f) => [f, { from: before[f], to: after[f] }]));

const refusalError = (refusal: Refusal, bulk: boolean, graph: TaskGraph, edits: Map<number, Edit>): ApiError => {
  const first = refusal.tasks[0];
  const id = taskId(first);
  const from = STATUS_NAMES[graph.row(first).status];
  const to = STATUS_NAMES[edits.get(first)?.status ?? graph.row(first).status];
  const message = {
    not_editable: `${id} can't be edited in ${from}.`,
    illegal_transition: `${id} can't move from ${from} to ${to}.`,
    blocked_by_open: `${id} is still blocked by ${refusal.blockedBy.map(taskId).join(", ")}.`,
    open_subtasks: `${id} has open sub-tasks.`,
  }[refusal.code];
  const extra: Record<string, unknown> = bulk ? { tasks: refusal.tasks.map(taskId) } : {};
  if (refusal.code === "blocked_by_open") extra.blocked_by = refusal.blockedBy.map(taskId);
  return new ApiError(409, refusal.code, message, extra);
};

// Validates the fields a PATCH body or a bulk `set` may carry for any task.
const readEdit = (body: Record<string, unknown>, fields: Fields, keys: readonly string[]): Edit => {
  const edit: Edit = {};
  for (const key of keys) {
    if (!(key in body)) continue;
    const value = body[key];
    if (key === "title") {
      const problem = titleProblem(value);
      if (problem) fields.title = problem;
      else edit.title = (value as string).trim();
    } else if (key === "details") {
      if (typeof value !== "string" || value.length > DETAILS_MAX) fields.details = M.details;
      else edit.details = value;
    } else if (key === "status") {
      if (isStatus(value)) edit.status = value;
      else fields.status = M.status;
    } else if (key === "priority") {
      if (isPriority(value)) edit.priority = value;
      else fields.priority = M.priority;
    } else if (key === "owner") {
      if (value === null || (typeof value === "string" && crewByHandle(value))) edit.owner = value as string | null;
      else fields.owner = M.crew;
    }
  }
  return edit;
};

// Validates a PATCH's label and cycle, which depend on the task's department and cycle.
const readPlacement = (body: Record<string, unknown>, row: TaskRow, fields: Fields): Edit => {
  const edit: Edit = {};
  if ("label" in body) {
    if (isLabelOf(row.department, body.label)) edit.label = body.label as string | null;
    else fields.label = M.label;
  }
  if ("cycle" in body) {
    const index = cycleIndex(typeof body.cycle === "string" ? body.cycle : null);
    if (body.cycle === row.cycle || (index >= 0 && index >= calendar().current)) edit.cycle = body.cycle as string;
    else fields.cycle = M.cycle;
  }
  return edit;
};

// Commits a PATCH or bulk outcome as one undoable change.
const commitEdits = (w: Work, kind: "edit" | "bulk", actor: string, outcome: EditOutcome, first: number[]) => {
  const now = new Date();
  const touched = [...outcome.touched.keys()].sort((a, b) => Number(first.includes(b)) - Number(first.includes(a)) || a - b);
  const final = outcome.after.with(bumped(outcome.after, touched, now));
  const journal: Journal = {
    tasks: touched.map((n) => {
      const before = w.graph.row(n);
      return {
        number: n,
        version: final.row(n).version,
        before: restorable(before),
      };
    }),
    cascade: cascadeOf(w.graph, outcome.after, outcome.levels),
  };
  return w.commit({
    kind,
    actor,
    after: final,
    saved: touched,
    activity: touched.map((n) => {
      const how = outcome.touched.get(n) ?? "edited";
      return { task: n, kind: how, changes: diff(w.graph.row(n), final.row(n)), actor: how === "edited" ? actor : null };
    }),
    undoable: true,
    journal,
    cascade: journal.cascade,
    reblocked: reblockedOf(w.graph, outcome.after),
  });
};

// The reply to an edit or bulk change that changes nothing: no new change, versions unchanged.
const unchanged = async (w: Work, listed: number[]): Promise<Reply> => {
  const seq = await currentSeq(w.client);
  return ok({ change: seq, undoable: false, tasks: listed.map((n) => w.graph.task(n)), cascade: [], reblocked: [], snapshot: snapshotFor(w.graph, seq) });
};

const FILTERS: Record<string, (v: string) => boolean> = {
  dept: (v) => Boolean(departmentByKey(v)),
  status: (v) => isStatus(v),
  blocked: (v) => v === "1",
  cycle: (v) => cycleIndex(v) >= 0,
  owner: (v) => v === "none" || Boolean(crewByHandle(v)),
  label: (v) => DEPARTMENTS.some((d) => d.labels.some((l) => l.key === v)),
};

route("GET", "/api/tasks", async (req) => {
  const fields: Fields = {};
  for (const [name, valid] of Object.entries(FILTERS)) {
    const value = req.query.get(name);
    if (value !== null && !valid(value)) fields[name] = M.filter;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  const q = (name: string): string | null => req.query.get(name);
  const { graph, seq } = await readGraph();
  const status = q("status");
  const tasks = [...graph.rows.values()]
    .filter((r) => (status ? r.status === status : r.status !== "triage" && r.status !== "duplicate"))
    .filter((r) => !q("dept") || r.department === q("dept"))
    .filter((r) => !q("cycle") || r.cycle === q("cycle"))
    .filter((r) => !q("label") || r.label === q("label"))
    .filter((r) => !q("owner") || r.owner === (q("owner") === "none" ? null : q("owner")))
    .filter((r) => !q("blocked") || graph.isBlocked(r.number))
    .sort((a, b) => a.number - b.number)
    .map((r) => graph.task(r.number));
  return ok({ tasks, snapshot: snapshotFor(graph, seq) });
});

route("GET", "/api/tasks/:id", async (req) => {
  const { graph } = await readGraph();
  const task = graph.task(taskOrThrow(graph, req.params[0]));
  return { status: 200, body: { task }, headers: { ETag: `"${task.version}"` } };
});

route("GET", "/api/snapshot", async () => {
  const { graph, seq } = await readGraph();
  return ok(snapshotFor(graph, seq));
});

route("GET", "/api/status", async () => ok(await checkServices()));

route("GET", "/api/production", async () => {
  const { anchor, windows, current } = calendar();
  const today = localDate(new Date());
  const opening = openingNight(anchor);
  return ok({
    theatre: THEATRE,
    show: SHOW,
    time_zone: config.timeZone,
    today,
    opening_night: opening,
    days_to_opening: daysBetween(today, opening),
    current_cycle: windows[current].key,
    departments: DEPARTMENTS,
    crew: CREW,
  });
});

route("GET", "/api/tasks/:id/activity", async (req) => {
  const { graph } = await readGraph();
  const n = taskOrThrow(graph, req.params[0]);
  const { rows } = await pool.query<{ id: string; at: Date; actor: string | null; kind: string; changes: ActivityEntry["changes"]; change: string | null }>(
    "SELECT id, at, actor, kind, changes, change FROM activity WHERE task = $1 ORDER BY id",
    [n],
  );
  const activity: ActivityEntry[] = rows.map((r) => {
    const member = crewByHandle(r.actor);
    return {
      id: Number(r.id),
      task: taskId(n),
      at: r.at.toISOString(),
      actor: member ? { handle: member.handle, name: member.name } : null,
      kind: r.kind,
      changes: r.changes,
      change: r.change === null ? null : Number(r.change),
    };
  });
  return ok({ activity });
});

route("POST", "/api/tasks", (req) =>
  underLock(req, async (w) => {
    await w.idempotency();
    const b = req.json;
    const fields: Fields = { ...req.headerErrors };
    const { windows, current } = calendar();
    const parent = b.parent === undefined || b.parent === null ? null : known(w.graph, b.parent);
    const parentRow = parent === null ? null : w.graph.row(parent);
    const parentOk = parentRow !== null && parentRow.parent === null;
    if (parentOk && w.graph.blockers(parent as number).length) {
      throw new ApiError(409, "blocks_parent", `${taskId(parent as number)} has blockers, so it can't take sub-tasks.`);
    }
    if (b.parent !== undefined && b.parent !== null && !parentOk) fields.parent = M.parent;
    const title = titleProblem(b.title);
    if (title) fields.title = title;
    const department = typeof b.department === "string" && departmentByKey(b.department) ? b.department : null;
    if (!department) fields.department = M.department;
    if (b.details !== undefined && (typeof b.details !== "string" || b.details.length > DETAILS_MAX)) fields.details = M.details;
    if (b.label !== undefined && b.label !== null && (!department || !isLabelOf(department, b.label))) fields.label = M.label;
    if (b.priority !== undefined && !isPriority(b.priority)) fields.priority = M.priority;
    if (b.owner !== undefined && b.owner !== null && !(typeof b.owner === "string" && crewByHandle(b.owner))) fields.owner = M.crew;
    if (b.status !== undefined && b.status !== "backlog" && b.status !== "todo") fields.status = M.status;
    const cycle = b.cycle === undefined || b.cycle === null ? windows[current].key : b.cycle;
    if (typeof cycle !== "string" || cycleIndex(cycle) < current) fields.cycle = M.cycle;
    if (Object.keys(fields).length) throw invalid(fields);

    const now = new Date();
    const number = Math.max(0, ...w.graph.rows.keys()) + 1;
    const row: TaskRow = {
      number,
      title: (b.title as string).trim(),
      details: (b.details as string | undefined) ?? "",
      department,
      label: (b.label as string | null | undefined) ?? null,
      status: (b.status as StatusKey | undefined) ?? "backlog",
      priority: (b.priority as number | undefined) ?? 0,
      owner: (b.owner as string | null | undefined) ?? null,
      cycle: cycle as string,
      parent,
      duplicate_of: null,
      request: null,
      version: 1,
      updated_at: now,
    };
    const created = w.graph.with([row]);
    const activity: ActivityDraft[] = [
      {
        task: number,
        kind: "created",
        actor: req.actor,
        changes: Object.fromEntries(
          (["title", "department", "status", "priority", "owner", "label", "cycle"] as const)
            .filter((f) => row[f] !== null && row[f] !== "")
            .map((f) => [f, { from: null, to: row[f] }]),
        ),
      },
    ];
    const reopened = new Map<number, TaskRow>();
    const rolled = new Map<number, TouchKind>();
    rollUp(w.graph, created, [number], reopened, rolled);
    const after = created.with(bumped(created.with(reopened.values()), reopened.keys(), now));
    for (const n of reopened.keys()) activity.push({ task: n, kind: "auto_reopened", actor: null, changes: diff(w.graph.row(n), after.row(n)) });
    const saved = [number, ...reopened.keys()];
    const result = await w.commit({
      kind: "create",
      actor: req.actor,
      after,
      saved,
      inserted: [number],
      activity,
      undoable: false,
      reblocked: reblockedOf(w.graph, after),
    });
    return ok(result, 201);
  }),
);

route("PATCH", "/api/tasks/:id", (req) =>
  underLock(req, async (w) => {
    const n = taskOrThrow(w.graph, req.params[0]);
    const ifMatch = req.headers["if-match"];
    if (typeof ifMatch !== "string" || ifMatch.trim() === "") {
      throw new ApiError(428, "precondition_required", "Send If-Match with the task version the edit is based on.");
    }
    if (Number(ifMatch.replace(/^W\//, "").replace(/"/g, "").trim()) !== w.graph.row(n).version) {
      throw new ApiError(412, "version_conflict", `${taskId(n)} was changed by someone else.`, { current: w.graph.task(n) });
    }
    const fields: Fields = { ...req.headerErrors };
    const edits = new Map([[n, { ...readEdit(req.json, fields, RESTORED_FIELDS), ...readPlacement(req.json, w.graph.row(n), fields) }]]);
    const outcome = applyEdits(w.graph, edits);
    const refusal = refusalOf(w.graph, outcome.after, edits);
    if (refusal) throw refusalError(refusal, false, w.graph, edits);
    if (Object.keys(fields).length) throw invalid(fields);
    if (!outcome.touched.size) return unchanged(w, [n]);
    return ok(await commitEdits(w, "edit", req.actor, outcome, [n]));
  }),
);

route("POST", "/api/tasks/bulk", (req) =>
  underLock(req, async (w) => {
    const entries = req.json.tasks;
    const listed = Array.isArray(entries)
      ? entries.map((e: unknown) => (e !== null && typeof e === "object" ? (e as Record<string, unknown>) : {}))
      : null;
    if (listed) {
      const unknown = [...new Set(listed.filter((e) => typeof e.id === "string" && known(w.graph, e.id) === null).map((e) => e.id as string))];
      if (unknown.length) {
        unknown.sort((a, b) => (taskNumber(a) ?? Infinity) - (taskNumber(b) ?? Infinity));
        throw new ApiError(404, "not_found", "Some tasks were not found.", { tasks: unknown });
      }
    }
    await w.idempotency();
    const fields: Fields = { ...req.headerErrors };
    if (!listed || listed.length < 1 || listed.length > BULK_MAX || listed.some((e) => typeof e.id !== "string")) fields.tasks = M.tasks;
    const set = req.json.set;
    const change = set !== null && typeof set === "object" && !Array.isArray(set) ? (set as Record<string, unknown>) : {};
    if (!["status", "priority", "owner"].some((k) => k in change)) fields.set = M.set;
    const numbers = [...new Set((listed ?? []).flatMap((e) => known(w.graph, e.id) ?? []))].sort((a, b) => a - b);
    const stale = numbers.filter((n) => listed?.some((e) => known(w.graph, e.id) === n && e.version !== w.graph.row(n).version));
    if (stale.length) {
      throw new ApiError(412, "version_conflict", "Some tasks were changed by someone else.", { current: stale.map((n) => w.graph.task(n)) });
    }
    const setFields: Fields = {};
    const edits = new Map(numbers.map((n) => [n, readEdit(change, setFields, ["status", "priority", "owner"])]));
    Object.assign(fields, setFields);
    const outcome = applyEdits(w.graph, edits);
    const refusal = refusalOf(w.graph, outcome.after, edits);
    if (refusal) throw refusalError(refusal, true, w.graph, edits);
    if (Object.keys(fields).length) throw invalid(fields);
    if (!outcome.touched.size) return unchanged(w, []);
    return ok(await commitEdits(w, "bulk", req.actor, outcome, numbers));
  }),
);

route("POST", "/api/undo", (req) =>
  underLock(req, async (w) => {
    await w.idempotency();
    const { rows } = await w.client.query<{ seq: string; journal: Journal }>(
      "SELECT seq, journal FROM changes WHERE actor = $1 AND undoable AND NOT undone ORDER BY seq DESC LIMIT 1",
      [req.actor],
    );
    const target = rows[0];
    if (!target) throw new ApiError(409, "nothing_to_undo", "There is nothing to undo.");
    const journal = target.journal;
    if (journal.tasks.some((t) => w.graph.row(t.number).version !== t.version)) {
      throw new ApiError(409, "undo_stale", "A task changed after that edit, so it can't be undone.");
    }
    if (Object.keys(req.headerErrors).length) throw invalid(req.headerErrors);
    const after = restore(w.graph, new Map(journal.tasks.map((t) => [t.number, t.before])));
    const restored = journal.tasks.map((t) => t.number);
    const now = new Date();
    const final = after.with(bumped(after, restored, now));
    await w.client.query("UPDATE changes SET undone = true WHERE seq = $1", [target.seq]);
    const result = await w.commit({
      kind: "undo",
      actor: req.actor,
      after: final,
      saved: restored,
      activity: restored.map((n) => ({ task: n, kind: "undo", actor: req.actor, changes: diff(w.graph.row(n), final.row(n)) })),
      undoable: false,
      cascade: cascadeOf(w.graph, after, new Map()),
      reblocked: reblockedOf(w.graph, after, journal.cascade),
    });
    return ok(result);
  }),
);

const LINK_REFUSALS = {
  illegal_relation: "Tasks in Triage or merged as duplicates can't be linked.",
  relation_exists: "That link already exists.",
  blocks_parent: "A task with sub-tasks can't take blockers.",
  relation_cycle: "That link would make a loop.",
};

route("POST", "/api/tasks/:id/relations", (req) =>
  underLock(req, async (w) => {
    const source = taskOrThrow(w.graph, req.params[0]);
    const target = known(w.graph, req.json.blocks);
    if (target !== null && target !== source) {
      const refuse = (code: keyof typeof LINK_REFUSALS): never => {
        throw new ApiError(409, code, LINK_REFUSALS[code]);
      };
      if (!isEditable(w.graph.row(source).status) || !isEditable(w.graph.row(target).status)) refuse("illegal_relation");
      if (w.graph.hasLink(source, target)) refuse("relation_exists");
      if (w.graph.children(target).length) refuse("blocks_parent");
      if (w.graph.wouldLoop(source, target)) refuse("relation_cycle");
    }
    const fields: Fields = { ...req.headerErrors };
    if (target === null) fields.blocks = M.blocksUnknown;
    else if (target === source) fields.blocks = M.blocksSelf;
    if (Object.keys(fields).length) throw invalid(fields);
    const pair = [source, target as number] as const;
    const linked = w.graph.with([], [...w.graph.links, pair]);
    const after = linked.with(bumped(linked, pair, new Date()));
    const result = await w.commit({
      kind: "relation",
      actor: req.actor,
      after,
      saved: [...pair],
      linkAdded: pair,
      activity: [
        { task: source, kind: "linked", actor: req.actor, changes: { blocks: { from: null, to: taskId(pair[1]) } } },
        { task: pair[1], kind: "linked", actor: req.actor, changes: { blocked_by: { from: null, to: taskId(source) } } },
      ],
      undoable: false,
      reblocked: reblockedOf(w.graph, after),
    });
    return ok(result, 201);
  }),
);

route("DELETE", "/api/tasks/:id/relations/:target", (req) =>
  underLock(req, async (w) => {
    const source = taskOrThrow(w.graph, req.params[0]);
    const target = taskOrThrow(w.graph, req.params[1]);
    if (!w.graph.hasLink(source, target)) throw notFound("That link");
    if (Object.keys(req.headerErrors).length) throw invalid(req.headerErrors);
    const pair = [source, target] as const;
    const unlinked = w.graph.with([], w.graph.links.filter(([a, b]) => a !== source || b !== target));
    const after = unlinked.with(bumped(unlinked, pair, new Date()));
    const result = await w.commit({
      kind: "relation",
      actor: req.actor,
      after,
      saved: [...pair],
      linkRemoved: pair,
      activity: [
        { task: source, kind: "unlinked", actor: req.actor, changes: { blocks: { from: taskId(target), to: null } } },
        { task: target, kind: "unlinked", actor: req.actor, changes: { blocked_by: { from: taskId(source), to: null } } },
      ],
      undoable: false,
      cascade: unlinkCascade(w.graph, after, source, target),
    });
    return ok(result);
  }),
);

