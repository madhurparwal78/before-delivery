/** Bootstrap, global keyboard, and the phone sheet close. */
import { store, view, boot, rowIds, bulkChange, undo, clearSelection, openDetail, closeDetail, setCurrent, focusRow, toggleSelect, rangeSelect, setRangeAnchor, moveCurrent, jumpCurrent, type Dialog as AppDialog } from "./app.js";
import { render, layoutMode } from "./ui.js";
import { registerRender, requestRender } from "./render.js";
import { openDialog, closeDialog, closeDrawer } from "./dialogs.js";

registerRender(render);

void boot().then(() => {
  render();
  // highlight and focus the row named in the address
  if (view.row) {
    const el = document.querySelector(`[data-task-id="${view.row}"]`) as HTMLElement | null;
    if (el) { el.scrollIntoView({ block: "nearest" }); setCurrent(view.row, false); render(); el.focus() }
    else focusRow(view.row);
  }
});

window.addEventListener("resize", () => requestRender());

function isTextEntry(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox" && (el as HTMLInputElement).type !== "file"
    || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function inGrid(el: HTMLElement | null): boolean {
  return !!el?.closest('[role="grid"], .toolbar');
}

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  // Ctrl+K / Cmd+K opens the palette from anywhere (DP-06)
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    openDialog({ kind: "palette", filter: "", opener: target });
    return;
  }
  // Ctrl+Z / Cmd+Z undo
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    if (store.dialog) return;
    e.preventDefault();
    void undo();
    return;
  }
  if (store.dialog || store.drawer) return;
  // Escape closes the phone sheet, drawer and detail, or clears the selection
  if (e.key === "Escape" && !isTextEntry(target)) {
    if (store.detail) { e.preventDefault(); closeDetail(); return }
    if (store.selection.size > 0) { e.preventDefault(); clearSelection(); return }
  }
  // grid keys (DP-05): work from any control in the grid or toolbar, never in text fields
  if (!inGrid(target) || isTextEntry(target)) return;
  const ids = rowIds();
  if (ids.length === 0) return;
  const currentId = store.current ?? ids[0] ?? null;
  const idx = currentId ? ids.indexOf(currentId) : -1;

  // Shift with an arrow builds a selection before plain movement
  if (e.key === "ArrowDown" && e.shiftKey) {
    e.preventDefault();
    if (!store.current) setCurrent(ids[0] ?? null, true);
    if (store.current) {
      setRangeAnchor(store.current);
      rangeSelect(store.current, 1);
    }
    return;
  }
  if (e.key === "ArrowUp" && e.shiftKey) {
    e.preventDefault();
    if (store.current) {
      setRangeAnchor(store.current);
      rangeSelect(store.current, -1);
    }
    return;
  }
  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    moveCurrent(1);
    return;
  }
  if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    moveCurrent(-1);
    return;
  }
  if (e.key === "Home") { e.preventDefault(); jumpCurrent(0); return }
  if (e.key === "End") { e.preventDefault(); jumpCurrent(ids.length - 1); return }
  // board view at the wide breakpoint: Left and Right move between columns (DP-05)
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && view.view === "board" && view.path === "/tasks" && layoutMode() === "wide") {
    e.preventDefault();
    const t = store.current ? store.tasks.get(store.current) : null;
    if (!t) return;
    const boardCols = ["backlog", "todo", "in_progress", "done"];
    const colIdx = boardCols.indexOf(t.status);
    if (colIdx === -1) return;
    const nextCol = Math.min(Math.max(colIdx + (e.key === "ArrowRight" ? 1 : -1), 0), boardCols.length - 1);
    const colIds = (c: string) => ids.filter((id) => store.tasks.get(id)!.status === c);
    const fromIds = colIds(boardCols[colIdx]!);
    const toIds = colIds(boardCols[nextCol]!);
    if (toIds.length === 0) return;
    const pos = fromIds.indexOf(store.current!);
    const nextId = pos >= toIds.length ? toIds[toIds.length - 1]! : toIds[pos]!;
    setCurrent(nextId, true);
    requestRender();
    focusRow(nextId);
    return;
  }
  if (e.key === "Enter") {
    if (!currentId) return;
    e.preventDefault();
    setCurrent(currentId, true);
    if (view.path === "/triage") {
      // triage keys: handled on the triage screen
      requestRender();
    } else {
      void openDetail(currentId, true);
    }
    return;
  }
  if (e.key === "x") {
    if (!currentId) return;
    e.preventDefault();
    toggleSelect(currentId);
    focusRow(currentId);
    return;
  }
  // on the triage screen a, d and m are the decision keys, not palette shortcuts
  if (view.path === "/triage" && ["a", "s", "p", "c", "d", "m", "0", "1", "2", "3", "4"].includes(e.key)) return;
  if (["0", "1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    void bulkChange({ priority: Number(e.key) }, `priority:${e.key}`);
    return;
  }
  if (e.key === "a") {
    e.preventDefault();
    openDialog({ kind: "palette", filter: "Assign to ", opener: target });
    return;
  }
  if (e.key === "s") {
    e.preventDefault();
    openDialog({ kind: "palette", filter: "Move to ", opener: target });
    return;
  }
  if (e.key === "p") {
    e.preventDefault();
    openDialog({ kind: "palette", filter: "Set priority: ", opener: target });
    return;
  }
  if (e.key === "c") {
    e.preventDefault();
    openDialog({ kind: "newtask", opener: target });
    return;
  }
});

// triage keys: a accept, d decline, m merge — only on the triage grid
window.addEventListener("keydown", (e) => {
  if (view.path !== "/triage" || store.dialog || store.drawer) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest('[role="grid"]') || isTextEntry(target)) return;
  const ids = rowIds();
  const currentId = store.current ?? ids[0] ?? null;
  if (!currentId) return;
  if (e.key === "a") {
    e.preventDefault();
    openDialog({ kind: "triage-accept", task: currentId, opener: target, sending: false });
  } else if (e.key === "d") {
    e.preventDefault();
    openDialog({ kind: "triage-decline", task: currentId, opener: target, sending: false });
  } else if (e.key === "m") {
    e.preventDefault();
    openDialog({ kind: "triage-merge", task: currentId, opener: target, sending: false });
  }
});
