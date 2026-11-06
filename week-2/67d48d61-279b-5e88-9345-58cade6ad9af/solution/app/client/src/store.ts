// The tab's state: tasks from the server with optimistic overlays, the latest snapshot, the
// change stream, the cascade staging, notices and the address.

import { useSyncExternalStore } from "react";
import {
  cycleName,
  type Attachment,
  type ChangeEvent,
  type ChangeResult,
  type Freed,
  type Production,
  type Reblocked,
  type ServiceStatus,
  type Snapshot,
  type StatusKey,
  type Task,
} from "../../shared/catalog";
import { Unreachable, call, get, newKey, setActor, type ApiReply } from "./api";
import { copy } from "./copy";
import { reducedMotion } from "./motion";
import { DEFAULT_VIEW, formatView, parseView, type View } from "./url";

export interface Cue {
  serial: number;
  from: string | null;
  targets: Array<{ id: string; at: number }>;
  reverse: boolean;
  span: number;
}

type AppDialog = { kind: "new-task"; parent: string | null; opener: Element | null } | { kind: "file-request"; opener: Element | null };

interface PendingEdit {
  token: number;
  patch: Partial<Task>;
}

const ACTOR_KEY = "promptside.working-as";
const STEP_MS = 60;

export const state = {
  loaded: false,
  production: null as Production | null,
  tasks: new Map<string, Task>(),
  overlays: new Map<string, PendingEdit[]>(),
  busy: new Map<string, number>(),
  saving: 0,
  snapshot: null as Snapshot | null,
  status: { intake: "up", plot_storage: "up" } as ServiceStatus,
  freed: new Map<string, Freed>(),
  hold: new Map<string, boolean>(),
  progressDelay: 0,
  cue: null as Cue | null,
  notice: { text: "", serial: 0 },
  actor: localStorage.getItem(ACTOR_KEY) ?? "maya",
  path: location.pathname,
  view: parseView(location.search),
  marked: new Set<string>(),
  anchor: null as string | null,
  rangeEnd: null as string | null,
  order: [] as string[],
  current: null as string | null,
  touched: new Map<string, number>(),
  attachments: new Map<string, number>(),
  requestsSerial: 0,
  palette: null as { prefix: string; opener: Element | null } | null,
  dialog: null as AppDialog | null,
};
setActor(state.actor);

let version = 0;
const listeners = new Set<() => void>();
export const emit = (): void => {
  version += 1;
  for (const l of listeners) l();
};
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useApp = (): typeof state => {
  useSyncExternalStore(subscribe, () => version);
  return state;
};

// What a row shows: the server's task, any edit still waiting for the server, and the blocked
// state the cascade has not yet reached.
const shownCache = new Map<string, { base: Task; edits: PendingEdit[] | undefined; hold: boolean | undefined; task: Task }>();
export const shown = (id: string): Task | undefined => {
  const base = state.tasks.get(id);
  if (!base) return undefined;
  const edits = state.overlays.get(id);
  const hold = state.hold.get(id);
  if (!edits && hold === undefined) return base;
  const cached = shownCache.get(id);
  if (cached && cached.base === base && cached.edits === edits && cached.hold === hold) return cached.task;
  const task = { ...base };
  for (const e of edits ?? []) Object.assign(task, e.patch);
  if (hold !== undefined) task.blocked = hold;
  shownCache.set(id, { base, edits, hold, task });
  return task;
};

export const shownBlockedCount = (): number => {
  let n = state.snapshot?.blocked ?? 0;
  for (const held of state.hold.values()) n += held ? 1 : -1;
  return n;
};

export const announce = (text: string): void => {
  state.notice = { text, serial: state.notice.serial + 1 };
  emit();
};

export const openPalette = (prefix: string, opener: Element | null): void => {
  state.palette = { prefix, opener };
  emit();
};

export const closePalette = (): void => {
  state.palette = null;
  emit();
};

export const openDialog = (dialog: AppDialog): void => {
  state.dialog = dialog;
  emit();
};

export const closeDialog = (): void => {
  state.dialog = null;
  emit();
};

export const setWorkingAs = (handle: string): void => {
  state.actor = handle;
  localStorage.setItem(ACTOR_KEY, handle);
  setActor(handle);
  emit();
};

// ---- navigation -------------------------------------------------------------------------

// `patch` is laid over the current tasks view; pass every field (DEFAULT_VIEW) to start afresh.
export const navigate = (path: string, patch: Partial<View> = DEFAULT_VIEW, replace = false): void => {
  const view = { ...state.view, ...patch };
  const target = path === "/tasks" ? `${path}${formatView(view)}` : path;
  if (`${location.pathname}${location.search}` !== target) {
    if (replace) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
  }
  state.path = path;
  state.view = path === "/tasks" ? view : state.view;
  emit();
};

window.addEventListener("popstate", () => {
  state.path = location.pathname;
  state.view = parseView(location.search);
  emit();
});

// ---- applying changes -------------------------------------------------------------------

const applied = new Set<number>();
let inflight = 0;
const deferred: ChangeEvent[] = [];
let cueSerial = 0;

const touch = (id: string): void => {
  state.touched.set(id, (state.touched.get(id) ?? 0) + 1);
};

const stage = (cascade: Freed[], reblocked: Reblocked[], from: string | null): void => {
  for (const f of cascade) {
    const t = state.tasks.get(f.id);
    if (t) state.tasks.set(f.id, { ...t, blocked: false });
  }
  for (const r of reblocked) {
    const t = state.tasks.get(r.id);
    if (t) state.tasks.set(r.id, { ...t, blocked: true });
  }
  if (reducedMotion()) {
    for (const f of cascade) {
      state.hold.delete(f.id);
      state.freed.set(f.id, f);
    }
    for (const r of reblocked) {
      state.hold.delete(r.id);
      state.freed.delete(r.id);
    }
    state.progressDelay = 0;
    return;
  }
  const reverseStep = reblocked.length ? Math.min(STEP_MS, 480 / reblocked.length) : 0;
  const targets: Cue["targets"] = [];
  for (const f of cascade) {
    state.hold.set(f.id, true);
    targets.push({ id: f.id, at: f.depth * STEP_MS });
    setTimeout(() => {
      state.hold.delete(f.id);
      state.freed.set(f.id, f);
      emit();
    }, f.depth * STEP_MS);
  }
  for (const r of reblocked) {
    state.hold.set(r.id, false);
    targets.push({ id: r.id, at: r.order * reverseStep });
    setTimeout(() => {
      state.hold.delete(r.id);
      state.freed.delete(r.id);
      emit();
    }, r.order * reverseStep);
  }
  const span = Math.max(0, ...targets.map((t) => t.at));
  state.progressDelay = span;
  if (targets.length) {
    cueSerial += 1;
    state.cue = { serial: cueSerial, from, targets, reverse: cascade.length === 0, span };
  }
};

const applyChange = (result: ChangeResult | ChangeEvent): void => {
  if (applied.has(result.change)) return;
  applied.add(result.change);
  for (const t of result.tasks ?? []) {
    const prev = state.tasks.get(t.id);
    if (prev && prev.version > t.version) continue;
    if (prev && prev.version !== t.version) state.freed.delete(t.id);
    state.tasks.set(t.id, t);
    touch(t.id);
  }
  const attachment = (result as ChangeEvent).attachment;
  if (attachment) attachmentAdded(attachment);
  if (!state.snapshot || result.snapshot.seq > state.snapshot.seq) state.snapshot = result.snapshot;
  stage(result.cascade, result.reblocked, result.tasks?.[0]?.id ?? null);
  const kind = (result as ChangeEvent).kind;
  if (kind === "pull" || kind === "decision" || "request" in result) state.requestsSerial += 1;
  emit();
};

const flush = (): void => {
  if (inflight > 0 || !state.loaded) return;
  while (deferred.length) applyChange(deferred.shift() as ChangeEvent);
};

// Runs a write; stream copies arriving meanwhile wait so the tab applies its own reply first.
const writing = async <T>(work: () => Promise<T>): Promise<T> => {
  inflight += 1;
  state.saving += 1;
  emit();
  try {
    return await work();
  } finally {
    inflight -= 1;
    state.saving -= 1;
    flush();
    emit();
  }
};

let tokens = 0;
const markBusy = (ids: string[], patch: Partial<Task> | null): (() => void) => {
  const token = (tokens += 1);
  for (const id of ids) {
    state.busy.set(id, (state.busy.get(id) ?? 0) + 1);
    if (patch) state.overlays.set(id, [...(state.overlays.get(id) ?? []), { token, patch }]);
  }
  emit();
  return () => {
    for (const id of ids) {
      const n = (state.busy.get(id) ?? 1) - 1;
      if (n) state.busy.set(id, n);
      else state.busy.delete(id);
      const left = (state.overlays.get(id) ?? []).filter((e) => e.token !== token);
      if (left.length) state.overlays.set(id, left);
      else state.overlays.delete(id);
    }
  };
};

const takeSaved = (tasks: Task[] | Task | undefined): void => {
  for (const t of Array.isArray(tasks) ? tasks : tasks ? [tasks] : []) {
    const prev = state.tasks.get(t.id);
    if (!prev || prev.version <= t.version) {
      state.tasks.set(t.id, t);
      touch(t.id);
    }
  }
};

const queues = new Map<string, Promise<unknown>>();
const queued = <T>(id: string, work: () => Promise<T>): Promise<T> => {
  const next = (queues.get(id) ?? Promise.resolve()).then(work, work);
  queues.set(id, next.catch(() => undefined));
  return next;
};

const singleRefusal = (id: string, reply: ApiReply<unknown>, patch: Partial<Task>): string => {
  const error = reply.error;
  const saved = state.tasks.get(id);
  if (!error || !saved) return copy.offline;
  if (error.code === "version_conflict") return copy.conflict(id);
  if (error.code === "illegal_transition") return copy.illegal(id, saved.status, patch.status as StatusKey);
  if (error.code === "blocked_by_open") return copy.stillBlocked(id, error.blocked_by ?? []);
  if (error.code === "open_subtasks") return copy.openSubtasks(id);
  if (error.code === "not_editable") return copy.notEditable(id, saved.status);
  return Object.values(error.fields ?? {})[0] ?? copy.offline;
};

const editMessage = (id: string, patch: Partial<Task>, result: ChangeResult, before: Map<string, Task>): string => {
  if (patch.status) {
    const others = result.tasks.filter((t) => t.id !== id);
    const closed = others.filter((t) => t.status === "done" && before.get(t.id)?.status !== "done").map((t) => t.id);
    const reopened = others.filter((t) => before.get(t.id)?.status === "done" && t.status !== "done").map((t) => t.id);
    return copy.statusMoved(id, patch.status, closed, reopened, result.cascade.length);
  }
  if (patch.priority !== undefined) return copy.priority(id, patch.priority);
  if (patch.owner !== undefined) return copy.owner(id, patch.owner);
  return copy.updated(id);
};

export const editTask = (id: string, patch: Partial<Task>): Promise<void> => {
  const release = markBusy([id], patch);
  return queued(id, () =>
    writing(async () => {
      const before = new Map(state.tasks);
      const base = state.tasks.get(id);
      try {
        const reply = await call<ChangeResult>("PATCH", `/api/tasks/${id}`, patch, { "If-Match": String(base?.version ?? 0) });
        release();
        if (reply.ok) {
          applyChange(reply.body);
          announce(editMessage(id, patch, reply.body, before));
        } else {
          takeSaved(reply.error?.current);
          announce(singleRefusal(id, reply, patch));
        }
      } catch (error) {
        release();
        if (!(error instanceof Unreachable)) throw error;
        announce(copy.offline);
      }
    }),
  );
};

export const bulkSet = (ids: string[], set: Partial<Pick<Task, "status" | "priority" | "owner">>): Promise<void> => {
  if (ids.length === 1) return editTask(ids[0], set);
  const release = markBusy(ids, set);
  return writing(async () => {
    const entries = ids.map((id) => ({ id, version: state.tasks.get(id)?.version ?? 0 }));
    try {
      const reply = await call<ChangeResult>("POST", "/api/tasks/bulk", { tasks: entries, set }, { "Idempotency-Key": newKey() });
      release();
      if (reply.ok) {
        applyChange(reply.body);
        const n = ids.length;
        if (set.status) announce(copy.bulkStatus(n, set.status, reply.body.cascade.length));
        else if (set.priority !== undefined) announce(copy.bulkPriority(n, set.priority));
        else announce(copy.bulkOwner(n, set.owner ?? null));
      } else if (reply.error?.code === "version_conflict") {
        takeSaved(reply.error.current);
        announce(copy.bulkConflict);
      } else {
        announce(copy.bulkRefused(reply.error?.tasks?.length ?? ids.length));
      }
    } catch (error) {
      release();
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
    }
  });
};

export const undoLast = (): Promise<void> =>
  writing(async () => {
    try {
      const reply = await call<ChangeResult>("POST", "/api/undo", {}, { "Idempotency-Key": newKey() });
      if (reply.ok) {
        applyChange(reply.body);
        announce(copy.undo(reply.body.tasks.length, reply.body.reblocked.length));
      } else {
        announce(reply.error?.code === "undo_stale" ? copy.undoStale : copy.nothingToUndo);
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
    }
  });

interface FormOutcome {
  fields?: Record<string, string>;
  done?: boolean;
}

export const createTask = (body: Record<string, unknown>, key: string): Promise<FormOutcome> =>
  writing(async () => {
    try {
      const reply = await call<ChangeResult>("POST", "/api/tasks", body, { "Idempotency-Key": key });
      if (reply.ok) {
        applyChange(reply.body);
        announce(copy.created(reply.body.tasks[0].id));
        return { done: true };
      }
      if (reply.error?.fields) return { fields: reply.error.fields };
      announce(copy.parentHasBlockers);
      return {};
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
      return {};
    }
  });

export const linkTasks = (blocker: string, blocked: string): Promise<FormOutcome> =>
  writing(async () => {
    try {
      const reply = await call<ChangeResult>("POST", `/api/tasks/${blocker}/relations`, { blocks: blocked });
      if (reply.ok) {
        applyChange(reply.body);
        announce(copy.linked(blocker, blocked));
        return { done: true };
      }
      if (reply.status === 422 && reply.error?.fields?.blocks && blocked === "") return { fields: reply.error.fields };
      announce(reply.error?.code === "relation_cycle" ? copy.loop : copy.linkRefused);
      return { done: true };
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
      return {};
    }
  });

export const unlinkTasks = (blocker: string, blocked: string): Promise<void> =>
  writing(async () => {
    try {
      const reply = await call<ChangeResult>("DELETE", `/api/tasks/${blocker}/relations/${blocked}`);
      if (reply.ok) {
        applyChange(reply.body);
        announce(copy.unlinked(blocker, blocked));
      } else {
        announce(copy.unlinkRefused);
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
    }
  });

export type Decision =
  | { decision: "accept"; department: string; priority: number; owner: string | null; label: string | null }
  | { decision: "decline"; reason: string }
  | { decision: "merge"; duplicate_of: string };

export const decide = (id: string, body: Decision, key: string): Promise<FormOutcome> =>
  writing(async () => {
    try {
      const reply = await call<ChangeResult>("POST", `/api/triage/${id}/decision`, body, { "Idempotency-Key": key });
      if (reply.ok) {
        applyChange(reply.body);
        const message =
          body.decision === "accept"
            ? copy.accepted(id, cycleName(reply.body.tasks[0].cycle) ?? "")
            : body.decision === "decline"
              ? copy.declined(id)
              : copy.merged(id, body.duplicate_of);
        announce(message + (reply.body.snapshot.triage === 0 ? copy.triageClear : ""));
        return { done: true };
      }
      if (reply.status === 422 && reply.error?.fields) return { fields: reply.error.fields };
      const code = reply.error?.code;
      announce(
        code === "intake_unavailable"
          ? copy.intakeUnreachable(id)
          : code === "already_decided"
            ? copy.alreadyDecided(id)
            : copy.intakeRefused(id),
      );
      return { done: true };
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      announce(copy.offline);
      return {};
    }
  });

// An attachment adds 1 to its task's version, but its reply and event carry the attachment in
// place of the task, so the tab reads the saved task back.
const attachmentAdded = (attachment: Attachment): void => {
  state.attachments.set(attachment.task, (state.attachments.get(attachment.task) ?? 0) + 1);
  touch(attachment.task);
  get<{ task: Task }>(`/api/tasks/${attachment.task}`)
    .then(({ task }) => {
      const prev = state.tasks.get(task.id);
      if (prev && prev.version >= task.version) return;
      state.tasks.set(task.id, task);
      touch(task.id);
      emit();
    })
    .catch(() => undefined);
};

export const noteAttachment = (attachment: Attachment): void => {
  attachmentAdded(attachment);
  emit();
};

// ---- loading and the stream -------------------------------------------------------------

const refresh = async (): Promise<void> => {
  const [production, listing, triage, status] = await Promise.all([
    get<Production>("/api/production"),
    get<{ tasks: Task[]; snapshot: Snapshot }>("/api/tasks"),
    get<{ tasks: Task[] }>("/api/tasks?status=triage"),
    get<ServiceStatus>("/api/status"),
  ]);
  state.production = production;
  state.tasks = new Map([...listing.tasks, ...triage.tasks].map((t) => [t.id, t]));
  if (!state.snapshot || listing.snapshot.seq >= state.snapshot.seq) state.snapshot = listing.snapshot;
  state.status = status;
  state.loaded = true;
  state.requestsSerial += 1;
  flush();
  emit();
};

export const refreshProduction = async (): Promise<void> => {
  state.production = await get<Production>("/api/production");
  emit();
};

export const start = (): void => {
  const source = new EventSource("/api/events");
  let dropped = false;
  source.addEventListener("change", (e) => {
    deferred.push(JSON.parse((e as MessageEvent<string>).data) as ChangeEvent);
    flush();
  });
  source.addEventListener("status", (e) => {
    state.status = JSON.parse((e as MessageEvent<string>).data) as ServiceStatus;
    emit();
  });
  source.addEventListener("open", () => {
    if (dropped) void refresh();
    dropped = false;
  });
  source.addEventListener("error", () => {
    dropped = true;
  });
  void refresh();
};

