/** App state, address state, live updates and every action. No DOM rendering. */
import {
  CYCLE_KEYS, DEPT_ORDER, STATUS_ORDER, countdownText, crewName, cycleName, priorityName,
  setProduction, statusName, taskWord,
  type ActivityJson, type AttachmentJson, type CascadeEntry, type ChangeResult, type ProductionJson,
  type RequestJson, type SnapshotJson, type TaskJson,
} from "./domain.js";
import { api, ApiError } from "./api.js";
import { requestRender } from "./render.js";
import { playCascade, playReverseCascade, rollDigits } from "./motion.js";

export interface Store {
  production: ProductionJson | null;
  tasks: Map<string, TaskJson>;
  snapshot: SnapshotJson | null;
  actor: string;
  selection: Set<string>;
  current: string | null;
  busy: Set<string>;
  saving: boolean;
  notice: string | null;
  requests: RequestJson[] | null;
  requestsDown: boolean;
  intakeDown: boolean;
  storageDown: boolean;
  freedBadges: Map<string, string>;
  freedMeta: Map<string, { order: number; depth: number }>;
  detail: { id: string; activity: ActivityJson[] | null; attachments: AttachmentJson[] | null } | null;
  upload: { name: string; pct: number } | null;
  drawer: boolean;
  dialog: Dialog | null;
  formErrors: Record<string, string> | null;
  lastSeq: number;
  triageCurrent: string | null;
  /** typed-but-unsaved text field values, kept across re-renders */
  formValues: Map<string, string>;
}

export type Dialog =
  | { kind: "palette"; filter: string; opener: HTMLElement | null }
  | { kind: "newtask"; opener: HTMLElement | null; parent?: string }
  | { kind: "link"; task: string; opener: HTMLElement | null }
  | { kind: "triage-accept"; task: string; opener: HTMLElement | null; sending: boolean }
  | { kind: "triage-decline"; task: string; opener: HTMLElement | null; sending: boolean }
  | { kind: "triage-merge"; task: string; opener: HTMLElement | null; sending: boolean }
  | { kind: "file-request"; opener: HTMLElement | null; sending: boolean };

export interface View {
  path: "/tasks" | "/triage" | "/requests" | "/notfound";
  view: "list" | "board";
  dept: string | null;
  blocked: boolean;
  group: "status" | "cycle" | "department" | "owner";
  cycle: string | null;
  row: string | null;
  task: string | null;
}

export const store: Store = {
  production: null,
  tasks: new Map(),
  snapshot: null,
  actor: localStorage.getItem("promptside-actor") ?? "maya",
  selection: new Set(),
  current: null,
  busy: new Set(),
  saving: false,
  notice: null,
  requests: null,
  requestsDown: false,
  intakeDown: false,
  storageDown: false,
  freedBadges: new Map(),
  freedMeta: new Map(),
  detail: null,
  upload: null,
  drawer: false,
  dialog: null,
  formErrors: null,
  lastSeq: 0,
  triageCurrent: null,
  formValues: new Map(),
};

export const view: View = {
  path: "/tasks", view: "list", dept: null, blocked: false,
  group: "status", cycle: null, row: null, task: null,
};

// ================= address state (DP-31) =================

export function buildUrl(): string {
  const p = new URLSearchParams();
  if (view.view === "board") p.set("view", "board");
  if (view.dept) p.set("dept", view.dept);
  if (view.blocked) p.set("blocked", "1");
  if (view.group !== "status" && view.view !== "board") p.set("group", view.group);
  if (view.cycle) p.set("cycle", view.cycle);
  if (view.row) p.set("row", view.row);
  if (view.task) p.set("task", view.task);
  const qs = p.toString();
  return `${view.path}${qs ? `?${qs}` : ""}`;
}

export function pushAddress(): void { history.pushState(null, "", buildUrl()) }
export function replaceAddress(): void { history.replaceState(null, "", buildUrl()) }

export function readAddress(): void {
  const path = location.pathname;
  if (path === "/triage" || path === "/requests") {
    view.path = path;
    resetViewParams();
    return;
  }
  if (path !== "/tasks") { view.path = "/notfound"; resetViewParams(); return }
  view.path = "/tasks";
  const p = new URLSearchParams(location.search);
  view.view = p.get("view") === "board" ? "board" : "list";
  const dept = p.get("dept");
  view.dept = dept && DEPT_ORDER.includes(dept) ? dept : null;
  view.blocked = p.get("blocked") === "1";
  const group = p.get("group");
  view.group = group === "cycle" || group === "department" || group === "owner" ? group : "status";
  const cycle = p.get("cycle");
  view.cycle = cycle && CYCLE_KEYS.includes(cycle) ? cycle : null;
  view.row = p.get("row");
  view.task = p.get("task");
  validateRowAndTask();
}

function resetViewParams(): void {
  view.view = "list"; view.dept = null; view.blocked = false;
  view.group = "status"; view.cycle = null; view.row = null; view.task = null;
}

function validateRowAndTask(): void {
  const ids = rowIds();
  if (view.row && !ids.includes(view.row)) view.row = null;
  if (view.task && (!store.tasks.has(view.task) || !ids.includes(view.task))) view.task = null;
  if (view.row === null && ids.length > 0) view.row = ids[0] ?? null;
}

// ================= rows =================

export function rowIds(): string[] {
  if (view.path === "/triage") {
    return [...store.tasks.values()].filter((t) => t.status === "triage")
      .sort((a, b) => a.number - b.number).map((t) => t.id);
  }
  if (view.path !== "/tasks") return [];
  let rows = [...store.tasks.values()]
    .filter((t) => t.status !== "triage" && t.status !== "duplicate");
  if (view.dept) rows = rows.filter((t) => t.department === view.dept);
  if (view.blocked) rows = rows.filter((t) => t.blocked);
  if (view.cycle) rows = rows.filter((t) => t.cycle === view.cycle);
  return rows.map((t) => t.id).sort((a, b) => store.tasks.get(a)!.number - store.tasks.get(b)!.number);
}

export function setCurrent(id: string | null, replace: boolean): void {
  store.current = id;
  view.row = id;
  if (replace) replaceAddress();
}

export function moveCurrent(delta: number): void {
  const ids = rowIds();
  if (ids.length === 0) return;
  const idx = store.current ? ids.indexOf(store.current) : -1;
  const next = idx === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(Math.max(idx + delta, 0), ids.length - 1);
  const id = ids[next] ?? null;
  setCurrent(id, true);
  requestRender();
  focusRow(id);
}

export function jumpCurrent(index: number): void {
  const ids = rowIds();
  if (ids.length === 0) return;
  const id = ids[Math.min(Math.max(index, 0), ids.length - 1)] ?? null;
  setCurrent(id, true);
  requestRender();
  focusRow(id);
}

export function focusRow(id: string | null): void {
  if (id) {
    const el = document.querySelector(`[data-task-id="${id}"]`) as HTMLElement | null;
    if (el) { el.scrollIntoView({ block: "nearest" }); el.focus(); return }
  }
  const first = document.querySelector("[data-task-id]") as HTMLElement | null;
  if (first) { first.focus(); return }
  const heading = document.querySelector("#empty-heading") as HTMLElement | null;
  heading?.focus();
}

export function toggleSelect(id: string): void {
  if (store.selection.has(id)) store.selection.delete(id);
  else store.selection.add(id);
  if (!store.current) setCurrent(id, true);
  requestRender();
}

/** Shift+arrow: anchor is the row current at the first press; adds to x marks. */
let rangeAnchor: string | null = null;
export function rangeSelect(id: string, delta: number): void {
  const ids = rowIds();
  const from = ids.indexOf(rangeAnchor ?? id);
  const to = Math.min(Math.max(ids.indexOf(id) + delta, 0), ids.length - 1);
  if (from === -1) return;
  const [a, b] = [Math.min(from, to), Math.max(from, to)];
  for (let i = a; i <= b; i++) store.selection.add(ids[i]!);
  const next = ids[to] ?? id;
  setCurrent(next, true);
  requestRender();
  focusRow(next);
}

export function setRangeAnchor(id: string | null): void { rangeAnchor = id }
export function clearSelection(): void { store.selection.clear(); requestRender() }
export function selectAll(rows: string[]): void { rows.forEach((r) => store.selection.add(r)); requestRender() }

export function afterRemoval(ids: string[]): void {
  const remaining = rowIds().filter((r) => !ids.includes(r));
  store.selection.clear();
  const next = remaining[0] ?? null;
  setCurrent(next, true);
  requestRender();
  if (next) focusRow(next);
  else {
    const heading = document.querySelector("#empty-heading") as HTMLElement | null;
    if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus() }
  }
}

// ================= notices (DP-17) =================

export function setNotice(msg: string): void {
  store.notice = msg;
  requestRender();
}

// ================= boot + live updates (DP-21) =================

const myChanges = new Set<number>();
export function markMine(change: number): void { myChanges.add(change) }

export async function boot(): Promise<void> {
  const prod = await api.production();
  setProduction(prod);
  store.production = prod;
  await reloadTasks();
  readAddress();
  connectStream();
  setInterval(() => void refreshProduction(), 60_000);
  void refreshRequests();
  window.addEventListener("popstate", () => { readAddress(); requestRender() });
}

async function refreshProduction(): Promise<void> {
  try {
    const prod = await api.production();
    setProduction(prod);
    store.production = prod;
    requestRender();
  } catch { /* keep the last known values */ }
}

export async function reloadTasks(): Promise<void> {
  // the default task list hides Triage and Duplicate rows, so all statuses are merged here
  const [d, triage, dup] = await Promise.all([
    api.tasks(),
    api.tasksFiltered({ status: "triage" }),
    api.tasksFiltered({ status: "duplicate" }),
  ]);
  const merged = new Map<string, TaskJson>();
  for (const t of [...d.tasks, ...triage.tasks, ...dup.tasks]) merged.set(t.id, t);
  store.tasks = merged;
  store.snapshot = d.snapshot;
  store.lastSeq = d.snapshot.seq;
}

function connectStream(): void {
  const es = new EventSource("/api/events");
  es.addEventListener("change", (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as ChangeResult & { kind: string };
    if (myChanges.has(data.change)) { myChanges.delete(data.change); return }
    if (data.snapshot.seq <= store.lastSeq && data.snapshot.seq !== 0) return;
    applyChange(data);
  });
  es.addEventListener("status", (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { intake: string; plot_storage: string };
    const wasDown = store.intakeDown;
    store.intakeDown = data.intake === "down";
    store.storageDown = data.plot_storage === "down";
    store.requestsDown = store.intakeDown;
    if (!store.intakeDown && wasDown) void refreshRequests();
    requestRender();
  });
  es.addEventListener("error", () => {
    es.close();
    setTimeout(async () => {
      try { await reloadTasks() } catch { /* retry via reconnect */ }
      connectStream();
      requestRender();
    }, 1000);
  });
}

export function applyChange(data: ChangeResult & { kind?: string }): void {
  if (data.snapshot) {
    if (data.snapshot.seq < store.lastSeq) return;
    store.lastSeq = data.snapshot.seq;
    store.snapshot = data.snapshot;
  }
  for (const t of data.tasks ?? []) store.tasks.set(t.id, t);
  for (const e of data.cascade ?? []) {
    const t = store.tasks.get(e.id);
    if (t) {
      t.blocked = false;
      store.freedBadges.set(e.id, e.freed_by);
      store.freedMeta.set(e.id, { order: e.order, depth: e.depth });
    }
  }
  for (const r of data.reblocked ?? []) {
    const t = store.tasks.get(r.id);
    if (t) { t.blocked = true; store.freedBadges.delete(r.id); store.freedMeta.delete(r.id) }
  }
  const kind = data.kind ?? "";
  if (kind === "pull" || kind === "decision" || kind === "rollover" || kind === "create") {
    void reloadTasksQuiet();
  }
  if (kind === "attachment") {
    const att = (data as unknown as { attachment?: AttachmentJson }).attachment;
    if (att && store.detail?.id === att.task) void loadDetail(att.task);
  }
  requestRender();
  const cascade = data.cascade ?? [];
  if (cascade.length > 0) runCascade(cascade);
}

async function reloadTasksQuiet(): Promise<void> {
  try { await reloadTasks(); requestRender() } catch { /* keep last state */ }
}

export async function refreshRequests(): Promise<void> {
  if (store.intakeDown) { store.requestsDown = true; requestRender(); return }
  try {
    const d = await api.requests();
    store.requests = d.requests;
    store.requestsDown = false;
    requestRender();
  } catch {
    store.requestsDown = true;
    requestRender();
  }
}

// ================= cascade on screen (DP-12) =================

function runCascade(cascade: CascadeEntry[]): void {
  const changedRow = store.current ? document.querySelector(`[data-task-id="${store.current}"]`) as HTMLElement | null : null;
  const before = store.snapshot?.blocked ?? 0;
  let steps = 0;
  playCascade(cascade, changedRow,
    (id, entry) => {
      const el = document.querySelector(`[data-task-id="${id}"]`);
      if (el) {
        el.setAttribute("data-freed-order", String(entry.order));
        el.setAttribute("data-freed-depth", String(entry.depth));
      }
      steps += 1;
      const counter = document.getElementById("blocked-count");
      if (counter) rollDigits(counter, before, before - cascade.length, 60);
    },
    () => { steps = steps },
    () => requestRender(),
  );
}

function runReverseCascade(reblocked: { id: string; order: number }[]): void {
  const before = store.snapshot?.blocked ?? 0;
  playReverseCascade(reblocked,
    (id) => {
      const el = document.querySelector(`[data-task-id="${id}"]`);
      el?.removeAttribute("data-freed-order");
      el?.removeAttribute("data-freed-depth");
    },
    () => {
      const counter = document.getElementById("blocked-count");
      if (counter) rollDigits(counter, before, before + reblocked.length, 60);
    },
    () => requestRender(),
  );
}

// ================= announcements (DP-17, DP-50) =================

function announceFor(result: ChangeResult, ids: string[], commandKind: string): string {
  const byId = new Map(result.tasks.map((t) => [t.id, t]));
  const changed = ids.filter((id) => byId.has(id));
  const n = changed.length;
  if (n === 1) {
    const t = byId.get(changed[0]!)!;
    if (commandKind.startsWith("status:")) {
      let msg = `${t.id} moved to ${statusName(t.status)}.`;
      for (const other of result.tasks) {
        if (other.id === t.id) continue;
        if (other.status === "done") msg += ` ${other.id} closed.`;
        if (other.status === "in_progress") msg += ` ${other.id} reopened.`;
      }
      if (result.cascade.length > 0) msg += ` ${result.cascade.length} ${taskWord(result.cascade.length)} freed.`;
      return msg;
    }
    if (commandKind.startsWith("priority:")) return `${t.id} priority set to ${priorityName(t.priority)}.`;
    if (commandKind.startsWith("owner:")) return t.owner === null ? `${t.id} unassigned.` : `${t.id} assigned to ${crewName(t.owner)}.`;
    return `${t.id} updated.`;
  }
  const first = byId.get(changed[0] ?? "");
  if (!first) return "";
  if (commandKind.startsWith("status:")) {
    let msg = `${n} ${taskWord(n)} moved to ${statusName(first.status)}.`;
    if (result.cascade.length > 0) msg += ` ${result.cascade.length} ${taskWord(result.cascade.length)} freed.`;
    return msg;
  }
  if (commandKind.startsWith("priority:")) return `Priority set to ${priorityName(first.priority)} on ${n} ${taskWord(n)}.`;
  if (commandKind.startsWith("owner:")) return first.owner === null
    ? `${n} ${taskWord(n)} unassigned.` : `${n} ${taskWord(n)} assigned to ${crewName(first.owner)}.`;
  return `${n} ${taskWord(n)} updated.`;
}

// ================= writes =================

export function targetIds(): string[] {
  const sel = [...store.selection];
  if (sel.length > 0) return sel;
  return store.current ? [store.current] : [];
}

export async function bulkChange(set: Record<string, unknown>, commandKind: string, key?: string): Promise<void> {
  const ids = targetIds();
  if (ids.length === 0) return;
  const targets = ids.map((id) => ({ id, version: store.tasks.get(id)!.version }));
  for (const id of ids) {
    const t = store.tasks.get(id)!;
    const next = { ...t };
    if (set.status !== undefined) next.status = set.status as string;
    if (set.priority !== undefined) next.priority = set.priority as number;
    if (set.owner !== undefined) next.owner = (set.owner as string | null) ?? null;
    store.tasks.set(id, next);
    store.busy.add(id);
  }
  store.saving = true;
  requestRender();
  try {
    const result = await api.bulk(targets, set, store.actor, key);
    markMine(result.change);
    finishChange(result, ids, commandKind);
  } catch (e) {
    rollbackBulk(e, ids, commandKind);
  }
}

export async function patchTask(id: string, body: Record<string, unknown>, commandKind: string): Promise<void> {
  const before = store.tasks.get(id);
  if (!before) return;
  const next = { ...before } as Record<string, unknown>;
  for (const [k, v] of Object.entries(body)) next[k] = v;
  store.tasks.set(id, next as unknown as TaskJson);
  store.busy.add(id);
  store.saving = true;
  requestRender();
  try {
    const result = await api.patch(id, body, before.version, store.actor);
    markMine(result.change);
    finishChange(result, [id], commandKind);
  } catch (e) {
    rollbackBulk(e, [id], commandKind);
  }
}

function finishChange(result: ChangeResult, ids: string[], commandKind: string): void {
  for (const id of ids) {
    store.busy.delete(id);
    store.freedBadges.delete(id);
    store.freedMeta.delete(id);
  }
  // a saved text field shows the saved value again, not the stored typing
  if (commandKind === "title") store.formValues.delete("d-title");
  if (commandKind === "details") store.formValues.delete("d-details");
  store.saving = false;
  applyChange(result);
  setNotice(announceFor(result, ids, commandKind));
  requestRender();
  if ((result.cascade?.length ?? 0) > 0) runCascade(result.cascade);
}

function rollbackBulk(e: unknown, ids: string[], commandKind: string): void {
  for (const id of ids) store.busy.delete(id);
  store.saving = false;
  if (e instanceof ApiError && e.code === "version_conflict") {
    const cur = e.data.current;
    const saved = Array.isArray(cur) ? cur : [cur];
    for (const t of saved) if (t) store.tasks.set(t.id, t);
    setNotice(ids.length === 1
      ? `${ids[0]} was changed by someone else. Showing the saved version.`
      : "No tasks changed: some were edited by someone else. Showing the saved versions.");
    requestRender();
  } else {
    setNotice(refusalNotice(e, ids, commandKind));
    void reloadTasks().then(() => requestRender());
  }
}

function refusalNotice(e: unknown, ids: string[], commandKind: string): string {
  if (!(e instanceof ApiError)) return "Couldn't reach Promptside. Nothing was saved.";
  switch (e.code) {
    case "blocked_by_open": {
      if (ids.length === 1) return `${ids[0]} is still blocked by ${(e.data.blocked_by ?? []).join(", ")}.`;
      return `No tasks changed. ${(e.data.tasks ?? []).length} of the selected tasks can't take that change.`;
    }
    case "illegal_transition": {
      const target = commandKind.startsWith("status:") ? commandKind.slice(7) : "";
      return `${ids[0]} can't move from ${statusName((e.data.current as TaskJson | undefined)?.status ?? "")} to ${statusName(target)}.`;
    }
    case "open_subtasks": return `${ids[0]} has open sub-tasks.`;
    case "not_editable": return `${ids[0]} can't be edited in ${statusName((e.data.current as TaskJson | undefined)?.status ?? "")}.`;
    case "nothing_to_undo": return "Nothing to undo.";
    case "undo_stale": return "Undo stopped: a task changed after that edit.";
    default: return "Couldn't reach Promptside. Nothing was saved.";
  }
}

// ================= undo (DP-15, DP-16) =================

export async function undo(): Promise<void> {
  store.saving = true;
  requestRender();
  try {
    const result = await api.undo(store.actor);
    markMine(result.change);
    store.saving = false;
    applyChange(result);
    const restored = result.tasks.length;
    let msg = `Undo restored ${restored} ${taskWord(restored)}.`;
    if (result.reblocked.length > 0) msg += ` ${result.reblocked.length} ${taskWord(result.reblocked.length)} blocked again.`;
    setNotice(msg);
    requestRender();
    if (result.reblocked.length > 0) runReverseCascade(result.reblocked);
  } catch (e) {
    store.saving = false;
    if (e instanceof ApiError && e.code === "nothing_to_undo") setNotice("Nothing to undo.");
    else if (e instanceof ApiError && e.code === "undo_stale") setNotice("Undo stopped: a task changed after that edit.");
    else setNotice("Couldn't reach Promptside. Nothing was saved.");
    await reloadTasks();
    requestRender();
  }
}

// ================= detail pane =================

export async function openDetail(id: string, focusHeading: boolean): Promise<void> {
  view.task = id;
  if (store.detail?.id !== id) store.formValues.delete("d-title");
  if (store.detail?.id !== id) store.formValues.delete("d-details");
  store.detail = { id, activity: null, attachments: null };
  pushAddress();
  requestRender();
  await loadDetail(id);
  if (focusHeading) {
    const h = document.getElementById("detail-heading") as HTMLElement | null;
    h?.setAttribute("tabindex", "-1");
    h?.focus();
  }
}

export async function loadDetail(id: string): Promise<void> {
  if (store.detail?.id !== id) return;
  const [activity, attachments] = await Promise.all([api.activity(id), api.attachments(id)]);
  if (store.detail?.id !== id) return;
  store.detail.activity = activity.activity;
  store.detail.attachments = attachments.attachments;
  requestRender();
}

export function closeDetail(): void {
  const row = view.row;
  view.task = null;
  store.detail = null;
  store.upload = null;
  replaceAddress();
  requestRender();
  focusRow(row);
}

// ================= triage decisions (DP-04) =================

export async function decide(id: string, decision: "accept" | "decline" | "merge", body: Record<string, unknown>): Promise<void> {
  if (store.dialog) store.dialog = { ...store.dialog, sending: true } as Dialog;
  requestRender();
  try {
    const result = await api.decide(id, { decision, ...body }, store.actor);
    markMine(result.change);
    store.dialog = null;
    store.formErrors = null;
    applyChange(result);
    await reloadTasks();
    const triageLeft = rowIds().length;
    let msg: string;
    if (decision === "accept") {
      const cycle = cycleName(store.production!.current_cycle);
      msg = `${id} accepted into ${cycle}.`;
    } else if (decision === "decline") msg = `${id} declined.`;
    else msg = `${id} merged into ${body.duplicate_of}.`;
    if (triageLeft === 0) msg += " Triage is clear.";
    setNotice(msg);
    void refreshRequests();
    afterRemoval([id]);
    requestRender();
  } catch (e) {
    store.dialog = { ...(store.dialog as Dialog), sending: false } as Dialog;
    if (e instanceof ApiError) {
      if (e.code === "validation_failed") {
        store.formErrors = e.data.fields ?? {};
        requestRender();
        focusErrorSummary();
        return;
      }
      if (e.code === "intake_unavailable") setNotice(`Request intake is unreachable, so ${id} stays in triage.`);
      else if (e.code === "intake_rejected") setNotice(`Request intake refused the decision, so ${id} stays in triage.`);
      else if (e.code === "already_decided") setNotice(`${id} was already decided.`);
      else setNotice("Couldn't reach Promptside. Nothing was saved.");
    } else setNotice("Couldn't reach Promptside. Nothing was saved.");
    await reloadTasks();
    requestRender();
  }
}

export function focusErrorSummary(): void {
  const el = document.querySelector(".error-summary") as HTMLElement | null;
  el?.setAttribute("tabindex", "-1");
  el?.focus();
}

// ================= creation and links =================

export async function createTask(body: Record<string, unknown>): Promise<void> {
  try {
    const result = await api.create(body, store.actor);
    markMine(result.change);
    store.dialog = null;
    store.formErrors = null;
    applyChange(result);
    await reloadTasks();
    const created = result.tasks[0];
    if (created) setNotice(`${created.id} created.`);
    requestRender();
  } catch (e) {
    handleCreateError(e);
  }
}

function handleCreateError(e: unknown): void {
  if (e instanceof ApiError && e.code === "validation_failed") {
    store.formErrors = e.data.fields ?? {};
    requestRender();
    focusErrorSummary();
    return;
  }
  store.dialog = null;
  store.formErrors = null;
  setNotice("Couldn't reach Promptside. Nothing was saved.");
  requestRender();
}

export async function addLink(id: string, blocks: string): Promise<void> {
  try {
    const result = await api.addLink(id, blocks, store.actor);
    markMine(result.change);
    store.dialog = null;
    store.formErrors = null;
    applyChange(result);
    setNotice(`${id} now blocks ${blocks}.`);
    await loadDetail(id);
    requestRender();
  } catch (e) {
    if (e instanceof ApiError && e.code === "validation_failed") {
      store.formErrors = e.data.fields ?? {};
      requestRender();
      focusErrorSummary();
      return;
    }
    store.dialog = null;
    store.formErrors = null;
    if (e instanceof ApiError && e.code === "relation_cycle") setNotice("That link would make a loop, so it was not added.");
    else setNotice("That link can't be added.");
    requestRender();
  }
}

export async function removeLink(id: string, target: string): Promise<void> {
  try {
    const result = await api.removeLink(id, target, store.actor);
    markMine(result.change);
    applyChange(result);
    setNotice(`${id} no longer blocks ${target}.`);
    await loadDetail(id);
    requestRender();
  } catch {
    setNotice("That link can't be removed.");
    requestRender();
  }
}

// ================= requests =================

export async function fileRequest(body: Record<string, unknown>): Promise<void> {
  if (store.dialog) store.dialog = { ...store.dialog, sending: true } as Dialog;
  requestRender();
  try {
    await api.fileRequest(body);
    store.dialog = null;
    store.formErrors = null;
    setNotice("Request filed. It reaches triage within a few seconds.");
    await refreshRequests();
    requestRender();
  } catch (e) {
    store.dialog = { ...(store.dialog as Dialog), sending: false } as Dialog;
    if (e instanceof ApiError && e.code === "validation_failed") {
      store.formErrors = e.data.fields ?? {};
      requestRender();
      focusErrorSummary();
      return;
    }
    setNotice("Request intake is unreachable, so it was not filed.");
    requestRender();
  }
}

// ================= attachments =================

export async function uploadAttachment(file: File, kind: string): Promise<void> {
  const id = view.task;
  if (!id) return;
  store.upload = { name: file.name, pct: 0 };
  requestRender();
  try {
    await api.upload(id, file, kind, store.actor, (pct) => {
      store.upload = { name: file.name, pct };
      const bars = document.querySelectorAll('.detail [role="progressbar"]');
      bars.forEach((b) => (b as HTMLElement).style.setProperty("--pct", `${pct}%`));
    });
    store.upload = null;
    setNotice(`${file.name} attached to ${id}.`);
    await loadDetail(id);
  } catch (e) {
    store.upload = null;
    if (e instanceof ApiError && e.code === "storage_unavailable") {
      setNotice(`Plot storage is unreachable. ${file.name} was not attached.`);
    } else {
      setNotice(`${file.name} was not attached.`);
    }
    requestRender();
  }
}

export { STATUS_ORDER };
