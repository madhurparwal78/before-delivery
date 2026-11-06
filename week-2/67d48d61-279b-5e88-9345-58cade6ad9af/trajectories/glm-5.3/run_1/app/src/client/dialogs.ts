import { requestRender } from "./render.js";
/** Dialogs, palette, drawer and the phone sheet: opening, focus trap, actions. */
import { store, view, pushAddress, bulkChange, undo, createTask, addLink, decide, fileRequest, rowIds, clearSelection, focusRow, type Dialog as AppDialog } from "./app.js";
import { filteredCommands, esc } from "./ui.js";

type OpenDialog = (d: AppDialog) => void;

let lastOpener: HTMLElement | null = null;

export function openDialog(d: AppDialog): void {
  lastOpener = d.opener ?? (document.activeElement as HTMLElement | null);
  store.formValues.clear();
  store.dialog = d;
  store.formErrors = null;
  requestRender();
  focusFirstInDialog();
}

export function closeDialog(): void {
  const opener = lastOpener;
  const openerId = opener?.id ?? null;
  const openerRow = opener?.getAttribute("data-task-id") ?? null;
  lastOpener = null;
  store.dialog = null;
  store.formErrors = null;
  store.formValues.clear();
  requestRender();
  if (openerId) {
    document.getElementById(openerId)?.focus();
    return;
  }
  if (openerRow) {
    const row = document.querySelector(`[data-task-id="${openerRow}"]`) as HTMLElement | null;
    if (row) { row.focus(); return }
  }
  focusRow(store.current);
}

function focusFirstInDialog(): void {
  requestAnimationFrame(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const first = firstFocusable(dlg as HTMLElement | null);
    first?.focus();
  });
}

function firstFocusable(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const list = el.querySelectorAll<HTMLElement>("input, select, textarea, button, [href]");
  return list[0] ?? null;
}

function focusablesIn(el: HTMLElement | null): HTMLElement[] {
  if (!el) return [];
  return [...el.querySelectorAll<HTMLElement>("input, select, textarea, button, [href]")]
    .filter((e) => !e.hasAttribute("disabled"));
}

/** Focus is never lost (DP-07): Tab stays inside, focus returns to the opener. */
export function trapTab(container: HTMLElement, e: KeyboardEvent): void {
  const list = focusablesIn(container);
  if (list.length === 0) return;
  const idx = list.indexOf(document.activeElement as HTMLElement);
  if (!e.shiftKey && (idx === -1 || idx === list.length - 1)) {
    e.preventDefault();
    list[0]!.focus();
  } else if (e.shiftKey && (idx === -1 || idx === 0)) {
    e.preventDefault();
    list[list.length - 1]!.focus();
  }
}

// ---------- palette ----------

let paletteActive = 0;

export function wireDialog(root: HTMLElement): void {
  const overlay = root.querySelector("#dialog-overlay");
  const paletteInput = root.querySelector("#palette-input") as HTMLInputElement | null;
  if (paletteInput) {
    paletteActive = 0;
    paletteInput.focus();
    paletteInput.setSelectionRange(paletteInput.value.length, paletteInput.value.length);
    paletteInput.addEventListener("input", () => {
      const d = store.dialog;
      if (d?.kind === "palette") d.filter = paletteInput.value;
      paletteActive = 0;
      rerenderKeepingPalette(paletteInput.value);
    });
    paletteInput.addEventListener("keydown", (e) => onPaletteKey(e));
  }
  root.querySelectorAll("#nt-create").forEach((el) => el.addEventListener("click", () => submitNewTask()));
  root.querySelectorAll("#nt-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("#link-add").forEach((el) => el.addEventListener("click", () => submitLink()));
  root.querySelectorAll("#link-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("#ta-accept").forEach((el) => el.addEventListener("click", () => submitAccept()));
  root.querySelectorAll("#ta-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("#td-decline").forEach((el) => el.addEventListener("click", () => submitDecline()));
  root.querySelectorAll("#td-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("#tm-merge").forEach((el) => el.addEventListener("click", () => submitMerge()));
  root.querySelectorAll("#tm-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("#fr-submit").forEach((el) => el.addEventListener("click", () => submitFileRequest()));
  root.querySelectorAll("#fr-cancel").forEach((el) => el.addEventListener("click", () => closeDialog()));
  root.querySelectorAll("[data-focus-field]").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    const field = (e.currentTarget as HTMLElement).getAttribute("data-focus-field")!;
    const target = document.getElementById(`d-${field}`)
      ?? document.getElementById(`nt-${field}`)
      ?? document.getElementById(`err-${field}`)
      ?? document.getElementById(`ta-${field}`);
    (target as HTMLElement | null)?.focus();
  }));
  if (overlay) {
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeDialog() });
    overlay.addEventListener("keydown", (e0) => { const e = e0 as KeyboardEvent;
      const dlg = (e.currentTarget as HTMLElement).querySelector('[role="dialog"]') as HTMLElement | null;
      if (e.key === "Tab") trapTab(dlg ?? (overlay as HTMLElement), e);
      if (e.key === "Escape") { e.stopPropagation(); closeDialog() }
      if (e.key === "Enter") {
        const d = store.dialog;
        if (!d) return;
        if (d.kind === "newtask") { e.preventDefault(); void submitNewTask() }
        else if (d.kind === "link") { e.preventDefault(); void submitLink() }
        else if (d.kind === "triage-accept") { e.preventDefault(); void submitAccept() }
        else if (d.kind === "triage-decline") { e.preventDefault(); void submitDecline() }
        else if (d.kind === "triage-merge") { e.preventDefault(); void submitMerge() }
        else if (d.kind === "file-request") { e.preventDefault(); void submitFileRequest() }
      }
    });
    if (!paletteInput) (overlay as HTMLElement).focus?.();
  }
}

function rerenderKeepingPalette(filter: string): void {
  const active = paletteActive;
  requestRender();
  requestAnimationFrame(() => {
    const input = document.getElementById("palette-input") as HTMLInputElement | null;
    if (input) {
      input.value = filter;
      input.focus();
      input.setSelectionRange(filter.length, filter.length);
      const opts = document.querySelectorAll("#palette-list li[role='option']");
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === Math.min(active, opts.length - 1))));
    }
  });
}

function onPaletteKey(e: KeyboardEvent): void {
  const d = store.dialog;
  if (!d || d.kind !== "palette") return;
  const opts = filteredCommands(d.filter);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    paletteActive = Math.min(Math.max(paletteActive + delta, 0), Math.max(opts.length - 1, 0));
    const items = document.querySelectorAll("#palette-list li[role='option']");
    items.forEach((o, i) => o.setAttribute("aria-selected", String(i === paletteActive)));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const cmd = opts[paletteActive] ?? opts[0];
    if (cmd) runCommand(cmd.kind);
  }
  // Tab and Escape reach the overlay handler so the trap and close both work
  if (["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) e.stopPropagation();
}

export function runCommand(kind: string): void {
  closeDialog();
  if (kind.startsWith("owner:")) {
    const owner = kind.slice(6);
    void bulkChange({ owner: owner === "none" ? null : owner }, kind);
  } else if (kind.startsWith("priority:")) {
    void bulkChange({ priority: Number(kind.slice(9)) }, kind);
  } else if (kind.startsWith("status:")) {
    void bulkChange({ status: kind.slice(7) }, kind);
  } else if (kind === "undo") {
    void undo();
  } else if (kind === "newtask") {
    openDialog({ kind: "newtask", opener: null });
  } else if (kind === "filerequest") {
    openDialog({ kind: "file-request", opener: null, sending: false });
  } else if (kind.startsWith("goto:")) {
    location.href = kind.slice(5);
  } else if (kind.startsWith("group:")) {
    view.group = kind.slice(6) as typeof view.group;
    pushAddress();
    requestRender();
  } else if (kind.startsWith("blocked:")) {
    view.blocked = kind.slice(8) === "1";
    pushAddress();
    requestRender();
  } else if (kind.startsWith("view:")) {
    view.view = kind.slice(5) as "list" | "board";
    pushAddress();
    requestRender();
  }
}


/** Dialog values come from the typed-value store, not from a re-rendered node. */
function dv(id: string): string {
  return store.formValues.get(id) ?? (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
}
// ---------- dialog submissions ----------

function submitNewTask(): void {
  const title = dv("nt-title");
  const department = (document.getElementById("nt-dept") as HTMLSelectElement).value;
  const priority = Number((document.getElementById("nt-priority") as HTMLSelectElement).value);
  const ownerSel = (document.getElementById("nt-owner") as HTMLSelectElement).value;
  const d = store.dialog;
  const body: Record<string, unknown> = { title, department, priority, owner: ownerSel || null };
  if (d?.kind === "newtask" && d.parent) body.parent = d.parent;
  void createTask(body);
}

function submitLink(): void {
  const d = store.dialog;
  if (d?.kind !== "link") return;
  const target = dv("link-task").trim().toUpperCase();
  void addLink(d.task, target);
}

function submitAccept(): void {
  const d = store.dialog;
  if (d?.kind !== "triage-accept") return;
  const department = (document.getElementById("ta-dept") as HTMLSelectElement).value;
  const priority = Number((document.getElementById("ta-priority") as HTMLSelectElement).value);
  const owner = (document.getElementById("ta-owner") as HTMLSelectElement).value || null;
  const label = (document.getElementById("ta-label") as HTMLSelectElement).value || null;
  void decide(d.task, "accept", { department, priority, owner, label });
}

function submitDecline(): void {
  const d = store.dialog;
  if (d?.kind !== "triage-decline") return;
  const reason = dv("td-reason");
  void decide(d.task, "decline", { reason });
}

function submitMerge(): void {
  const d = store.dialog;
  if (d?.kind !== "triage-merge") return;
  const duplicate_of = (document.getElementById("tm-target") as HTMLSelectElement).value;
  void decide(d.task, "merge", { duplicate_of });
}

function submitFileRequest(): void {
  const title = dv("fr-title");
  const details = dv("fr-details");
  const requester = dv("fr-name");
  const department = (document.getElementById("fr-dept") as HTMLSelectElement).value || null;
  void fileRequest({ title, details, requester, department });
}

// ---------- drawer (phone) ----------

export function wireDrawer(root: HTMLElement): void {
  const overlay = root.querySelector("#drawer-overlay");
  if (!overlay) return;
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeDrawer() });
  overlay.addEventListener("keydown", (e0) => { const e = e0 as KeyboardEvent;
    const drawer = (e.currentTarget as HTMLElement).querySelector(".drawer") as HTMLElement | null;
    if (e.key === "Tab" && drawer) trapTab(drawer, e);
    if (e.key === "Escape") { e.stopPropagation(); closeDrawer() }
  });
  overlay.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { store.drawer = false }));
  overlay.querySelectorAll("#actor-select").forEach((el) => el.addEventListener("change", (e) => {
    store.actor = (e.target as HTMLSelectElement).value;
    localStorage.setItem("promptside-actor", store.actor);
    requestRender();
  }));
}

export function closeDrawer(): void {
  const opener = document.getElementById("drawer-btn");
  store.drawer = false;
  requestRender();
  opener?.focus();
}

export function focusDrawer(): void {
  requestAnimationFrame(() => {
    const first = document.querySelector("#drawer-overlay a, #drawer-overlay select") as HTMLElement | null;
    first?.focus();
  });
}

