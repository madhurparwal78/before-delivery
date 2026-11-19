// The grid at 768 and 1280: one Tab stop, the keyboard model, editors, the Reference picker,
// ranges with copy, clear and paste, the column options menu and the formula bar.
import type { Column, Row } from "./api.js";
import { tablePath } from "./api.js";
import { COPY } from "./copy.js";
import { announce, h, icon, isTextField, overlay, place } from "./dom.js";
import { Picker } from "./picker.js";
import { Preview } from "./preview.js";
import { paint } from "./roll.js";
import type { View, Workspace } from "./workspace.js";

interface Pos {
  r: number; // -1 is the header row
  c: number;
}

// Columns are sized from their content: the header name (with its options chevron) and the
// longest display, within a floor and a per-type cap past which a cell ends in an ellipsis.
const CAP: Record<Column["type"], number> = { text: 220, decimal: 150, date: 120, bool: 96, reference: 220, formula: 200 };
const FLOOR = 88;
const SANS_CH = 7; // average advance of 13px IBM Plex Sans
const MONO_CH = 7.8; // advance of 13px IBM Plex Mono
const HEADER_CH = 7.2; // 12px semibold header
const CELL_PAD = 18; // 8px padding each side plus the hairline
const HEADER_PAD = 40; // padding, gap and the chevron

function columnWidth(col: Column, rows: Row[]): number {
  const mono = col.type === "decimal" || col.type === "formula";
  let longest = 0;
  for (const row of rows) longest = Math.max(longest, row.cells[col.id]?.display.length ?? 0);
  const content = longest * (mono ? MONO_CH : SANS_CH) + CELL_PAD;
  const header = col.name.length * HEADER_CH + HEADER_PAD;
  return Math.round(Math.min(CAP[col.type], Math.max(FLOOR, content, header)));
}

export class GridView implements View {
  readonly el: HTMLElement;
  private grid!: HTMLElement;
  private cells = new Map<string, HTMLElement>();
  private headers: HTMLButtonElement[] = [];
  private active: Pos = { r: 0, c: 0 };
  private rangeEnd: Pos | null = null;
  private editor: { rowId: string; columnId: string; input: HTMLInputElement; original: string; message: string | null } | null = null;
  private fieldNotice: HTMLElement | null = null;
  private picker: Picker | null = null;
  private menu: HTMLElement | null = null;
  private conflict: { key: string; el: HTMLElement } | null = null;
  private tip: { key: string; el: HTMLElement; hidden: boolean } | null = null;
  private hovered: string | null = null;
  private pending = new Map<string, string>();
  private bar: FormulaBar | null = null;
  private readonly edge = new ResizeObserver(() => this.markOverflow());
  // Set when Tab carries focus out of the grid, so a re-render does not pull it back from the page.
  private tabbedOut = false;

  constructor(private readonly ws: Workspace) {
    this.el = h("div", { class: "grid-wrap" });
    this.edge.observe(this.el);
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.defaultPrevented) this.tabbedOut = true;
    });
    this.el.addEventListener("focusin", () => (this.tabbedOut = false));
    ws.deleteRowHook = () => this.deleteActiveRow();
    ws.formulaRender = () => {
      if (ws.formulaBar) {
        this.bar ??= new FormulaBar(ws, this);
        this.bar.mount(ws.formulaBar);
      }
    };
  }

  get columns(): Column[] {
    return this.ws.columns;
  }

  get rows(): Row[] {
    return this.ws.rows;
  }

  destroy(): void {
    this.clearFieldNotice();
    this.closeMenu(false);
    this.picker?.close(false);
    this.hideTip();
    this.conflict?.el.remove();
    this.bar?.destroy();
    this.ws.formulaRender = null;
    this.ws.deleteRowHook = null;
    this.edge.disconnect();
  }

  // A hairline fade at the right edge says the grid scrolls sideways for more columns.
  private markOverflow(): void {
    const g = this.grid;
    this.el.classList.toggle("overflow-right", !!g && g.scrollLeft + g.clientWidth < g.scrollWidth - 1);
  }

  // ---- rendering ------------------------------------------------------------------------

  render(): void {
    const hadFocus = this.el.contains(document.activeElement) || (document.activeElement === document.body && !this.tabbedOut);
    const table = this.ws.table!;
    const cols = this.columns;
    this.cells.clear();
    this.headers = [];
    this.clamp();
    const template = cols.map((c) => `${columnWidth(c, this.rows)}px`).join(" ") || "1fr";
    this.grid = h("div", {
      role: "grid",
      "aria-label": table.name,
      "aria-rowcount": String(this.rows.length + 1),
      "aria-colcount": String(cols.length),
      "aria-multiselectable": "true",
      "aria-readonly": this.ws.writer && table.kind === "table" ? null : "true",
      class: "grid grid-scroll",
      style: `--columns: ${template}`,
    });
    const header = h("div", { role: "row", "aria-rowindex": "1", class: "grid-row header-row" });
    cols.forEach((col, c) => {
      const btn = h(
        "button",
        { type: "button", class: "header-button", tabindex: "-1", "aria-label": `${col.name} options`, "aria-haspopup": "menu" },
        h("span", { class: "header-name", title: col.name }, col.name),
        icon("chevron"),
      ) as HTMLButtonElement;
      btn.addEventListener("click", () => {
        this.setActive({ r: -1, c }, true);
        this.openMenu(c);
      });
      this.headers.push(btn);
      header.append(h("div", { role: "columnheader", "aria-colindex": String(c + 1), class: `header-cell type-${col.type}` }, btn));
    });
    this.grid.append(header);
    this.rows.forEach((row, r) => this.grid.append(this.rowElement(row, r)));
    this.grid.addEventListener("keydown", (e) => this.keydown(e));
    this.grid.addEventListener("copy", (e) => this.copyEvent(e));
    this.grid.addEventListener("paste", (e) => this.pasteEvent(e));
    this.grid.addEventListener("scroll", () => this.markOverflow(), { passive: true });
    const parts: HTMLElement[] = [this.grid];
    if (this.rows.length === 0) parts.push(h("div", { class: "empty empty-table" }, icon("table"), h("p", { class: "empty-copy" }, COPY.emptyTable)));
    this.el.replaceChildren(...parts);
    this.markOverflow();
    this.sync();
    if (this.editor) this.reopenEditor();
    else if (hadFocus && this.el.isConnected) this.focusActive();
  }

  private rowElement(row: Row, r: number): HTMLElement {
    const el = h("div", { role: "row", "aria-rowindex": String(r + 2), class: "grid-row", "data-row": row.id });
    this.columns.forEach((col, c) => {
      const cell = h("div", {
        role: "gridcell", "aria-colindex": String(c + 1), tabindex: "-1", "aria-selected": "false",
        class: `cell type-${col.type}`, "data-key": `${row.id}|${col.id}`,
      });
      cell.addEventListener("mousedown", (e) => this.cellMouseDown(e, row.id, col.id));
      cell.addEventListener("mouseenter", () => {
        this.hovered = `${row.id}|${col.id}`;
        this.syncTip();
      });
      cell.addEventListener("mouseleave", () => {
        if (this.hovered === `${row.id}|${col.id}`) this.hovered = null;
        this.syncTip();
      });
      this.cells.set(`${row.id}|${col.id}`, cell);
      this.paintElement(cell, row, col);
      el.append(cell);
    });
    return el;
  }

  private paintElement(el: HTMLElement, row: Row, col: Column): void {
    const key = `${row.id}|${col.id}`;
    const pending = this.pending.get(key);
    const cell = row.cells[col.id];
    el.classList.toggle("pending", pending !== undefined);
    if (pending !== undefined) {
      el.setAttribute("aria-busy", "true");
      el.textContent = pending;
      return;
    }
    el.removeAttribute("aria-busy");
    el.classList.toggle("kind-error", cell?.kind === "error");
    el.classList.toggle("kind-number", cell?.kind === "decimal");
    paint(el, cell?.display ?? "", cell?.kind ?? "blank");
  }

  cell(rowId: string, columnId: string): HTMLElement | null {
    return this.cells.get(`${rowId}|${columnId}`) ?? null;
  }

  inView(el: HTMLElement): boolean {
    const box = el.getBoundingClientRect();
    const view = this.grid.getBoundingClientRect();
    return box.bottom > view.top + 1 && box.top < view.bottom - 1 && box.right > view.left + 1 && box.left < view.right - 1;
  }

  paintCell(rowId: string, columnId: string): void {
    const row = this.rows.find((r) => r.id === rowId);
    const col = this.columns.find((c) => c.id === columnId);
    const el = this.cell(rowId, columnId);
    if (row && col && el && !(this.editor && this.editor.rowId === rowId && this.editor.columnId === columnId)) this.paintElement(el, row, col);
    this.syncTip();
    this.bar?.refresh();
  }

  setPending(rowId: string, columnId: string, text: string | null): void {
    const key = `${rowId}|${columnId}`;
    if (text === null) this.pending.delete(key);
    else this.pending.set(key, text);
    this.paintCell(rowId, columnId);
  }

  // ---- active cell, range and the grid attributes -----------------------------------------

  private clamp(): void {
    const maxR = this.rows.length - 1;
    const maxC = this.columns.length - 1;
    // A header position stays on the header; a data position stays inside the rows.
    const r = this.active.r === -1 ? -1 : Math.max(maxR < 0 ? -1 : 0, Math.min(this.active.r, maxR));
    this.active = { r, c: Math.max(0, Math.min(this.active.c, maxC)) };
    this.rangeEnd = null;
  }

  private range(): { r1: number; r2: number; c1: number; c2: number } | null {
    if (!this.rangeEnd || this.active.r < 0) return null;
    return {
      r1: Math.min(this.active.r, this.rangeEnd.r), r2: Math.max(this.active.r, this.rangeEnd.r),
      c1: Math.min(this.active.c, this.rangeEnd.c), c2: Math.max(this.active.c, this.rangeEnd.c),
    };
  }

  private activeElement(): HTMLElement | null {
    if (this.active.r < 0) return this.headers[this.active.c] ?? null;
    const row = this.rows[this.active.r];
    const col = this.columns[this.active.c];
    return row && col ? this.cell(row.id, col.id) : null;
  }

  // Keeps exactly one tabindex="0" and the selection attributes true after every change.
  private sync(): void {
    const rg = this.range();
    this.rows.forEach((row, r) => {
      this.columns.forEach((col, c) => {
        const el = this.cell(row.id, col.id);
        if (!el) return;
        const isActive = r === this.active.r && c === this.active.c;
        const selected = rg ? r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2 : isActive;
        el.setAttribute("aria-selected", selected ? "true" : "false");
        el.tabIndex = isActive ? 0 : -1;
        el.classList.toggle("active", isActive);
        el.classList.toggle("in-range", !!rg && selected);
      });
    });
    this.headers.forEach((b, c) => (b.tabIndex = this.active.r === -1 && c === this.active.c ? 0 : -1));
    if (this.rows.length === 0 && this.active.r >= 0 && this.headers[this.active.c]) this.headers[this.active.c]!.tabIndex = 0;
    this.syncTip();
    this.bar?.refresh();
  }

  private setActive(pos: Pos, focus: boolean, keepRange = false): void {
    this.active = pos;
    if (!keepRange) this.rangeEnd = null;
    this.sync();
    if (focus) this.focusActive();
  }

  focusActive(): void {
    const el = this.activeElement();
    if (el) {
      el.focus();
      return;
    }
    this.ws.focusAddRowOrHeading();
  }

  focusLanding(): void {
    if (this.rows.length === 0) {
      this.ws.focusAddRowOrHeading();
      return;
    }
    this.focusActive();
  }

  afterReread(lost: boolean): void {
    if (lost || this.active.r >= this.rows.length) {
      this.active = { r: this.rows.length ? 0 : -1, c: 0 };
      this.rangeEnd = null;
      this.sync();
      this.focusLanding();
    }
  }

  readOnlyChanged(): void {
    if (this.editor) this.cancelEditor(false);
    this.picker?.close(false);
    this.render();
  }

  closeEditorsOn(rowIds: Set<string>): boolean {
    const onRow = (this.editor && rowIds.has(this.editor.rowId)) || (this.picker && rowIds.has(this.picker.rowId));
    if (!onRow) return false;
    this.editor = null;
    this.picker?.close(false);
    return true;
  }

  rowAdded(): void {
    this.render();
  }

  rowRemoved(_rowId: string, index: number): void {
    this.active = { r: Math.min(index, this.rows.length - 1), c: this.active.c };
    this.render();
    if (this.rows.length === 0) this.ws.focusAddRowOrHeading();
    else this.focusActive();
  }

  rowBack(rowId: string): void {
    const r = this.rows.findIndex((x) => x.id === rowId);
    if (r >= 0) this.active = { r, c: this.active.c };
    this.render();
    this.focusActive();
  }

  restored(rowId: string, columnId: string | null): void {
    const r = this.rows.findIndex((x) => x.id === rowId);
    if (r < 0) return;
    const c = columnId ? Math.max(0, this.columns.findIndex((x) => x.id === columnId)) : 0;
    this.setActive({ r, c }, true);
  }

  // ---- pointer --------------------------------------------------------------------------

  private cellMouseDown(e: MouseEvent, rowId: string, columnId: string): void {
    const r = this.rows.findIndex((x) => x.id === rowId);
    const c = this.columns.findIndex((x) => x.id === columnId);
    if (r < 0 || c < 0) return;
    if (this.editor && this.editor.rowId === rowId && this.editor.columnId === columnId) return;
    if (this.picker && this.picker.rowId === rowId && this.picker.columnId === columnId) return;
    if (this.editor) this.commitEditor(null);
    this.picker?.close(false);
    e.preventDefault();
    if (e.shiftKey && this.active.r >= 0) {
      this.rangeEnd = { r, c };
      this.sync();
      this.focusActive();
      return;
    }
    this.setActive({ r, c }, true);
  }

  // ---- keyboard ---------------------------------------------------------------------------

  private keydown(e: KeyboardEvent): void {
    if (this.editor || this.picker || isTextField(e.target as Element)) return;
    const cols = this.columns.length;
    const rows = this.rows.length;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (this.active.r === -1) {
      this.headerKey(e);
      return;
    }
    const move = (r: number, c: number) => {
      e.preventDefault();
      this.setActive({ r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) }, true);
    };
    if (e.shiftKey && !ctrl && key.startsWith("Arrow")) {
      e.preventDefault();
      const end = this.rangeEnd ?? { ...this.active };
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key as "ArrowUp"]!;
      this.rangeEnd = { r: Math.max(0, Math.min(rows - 1, end.r + d[0]!)), c: Math.max(0, Math.min(cols - 1, end.c + d[1]!)) };
      this.sync();
      return;
    }
    switch (key) {
      case "ArrowUp":
        if (this.active.r === 0) {
          e.preventDefault();
          this.setActive({ r: -1, c: this.active.c }, true);
        } else move(this.active.r - 1, this.active.c);
        return;
      case "ArrowDown":
        return move(this.active.r + 1, this.active.c);
      case "ArrowLeft":
        return move(this.active.r, this.active.c - 1);
      case "ArrowRight":
        return move(this.active.r, this.active.c + 1);
      case "Home":
        return ctrl ? move(0, 0) : move(this.active.r, 0);
      case "End":
        return ctrl ? move(rows - 1, cols - 1) : move(this.active.r, cols - 1);
      case "Escape":
        e.preventDefault();
        if (this.rangeEnd) {
          this.rangeEnd = null;
          this.sync();
        } else if (this.conflict) this.showConflict("", "", null);
        else if (this.tip) {
          this.tip.hidden = true;
          this.tip.el.hidden = true;
        }
        return;
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          this.openMenu(this.active.c);
        }
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        this.startEdit(null);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        this.clear();
        return;
      default:
        break;
    }
    if (ctrl && key.toLowerCase() === "c") {
      e.preventDefault();
      void this.copy();
      return;
    }
    if (key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      this.startEdit(key);
    }
  }

  private headerKey(e: KeyboardEvent): void {
    const c = this.active.c;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        this.setActive({ r: -1, c: Math.max(0, c - 1) }, true);
        return;
      case "ArrowRight":
        e.preventDefault();
        this.setActive({ r: -1, c: Math.min(this.columns.length - 1, c + 1) }, true);
        return;
      case "ArrowDown":
        e.preventDefault();
        if (e.altKey) this.openMenu(c);
        else if (this.rows.length) this.setActive({ r: 0, c }, true);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        this.openMenu(c);
        return;
      default:
        return;
    }
  }

  // ---- editing ----------------------------------------------------------------------------

  private startEdit(typed: string | null): void {
    const row = this.rows[this.active.r];
    const col = this.columns[this.active.c];
    if (!row || !col) return;
    if (!this.ws.canEditTable) {
      if (col.type !== "formula" || typed === null) this.ws.readOnlyAttempt();
      return;
    }
    if (col.type === "formula") {
      if (typed !== null) return;
      if (this.bar) this.bar.focus();
      else void import("./dialogs.js").then((d) => d.editFormulaDialog(this.ws, col, row.id, this.activeElement() ?? document.body, () => this.headers[this.active.c] ?? null));
      return;
    }
    if (col.type === "reference") {
      this.openPicker(row, col, typed ?? "");
      return;
    }
    const cell = row.cells[col.id];
    const original = cell?.kind === "blank" ? "" : (cell?.display ?? "");
    this.openEditor(row.id, col.id, typed ?? original, original);
  }

  // A refused value reopens its editor with the field message under it: text, icon and invalid state.
  private openEditor(rowId: string, columnId: string, text: string, original: string, message: string | null = null): void {
    const el = this.cell(rowId, columnId);
    const col = this.columns.find((c) => c.id === columnId);
    if (!el || !col) return;
    const input = h("input", { type: "text", class: "cell-editor", "aria-label": col.name, spellcheck: "false" }) as HTMLInputElement;
    input.value = text;
    this.editor = { rowId, columnId, input, original, message };
    el.replaceChildren(input);
    this.clearFieldNotice();
    if (message) {
      const notice = h("div", { id: `field-${rowId}-${columnId}`, class: "notice field-notice" }, icon("alert"), h("span", {}, message));
      overlay().append(notice);
      place(notice, el.getBoundingClientRect(), this.ws.statusBar.getBoundingClientRect().top);
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", notice.id);
      this.fieldNotice = notice;
      input.addEventListener("input", () => {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
        if (this.editor) this.editor.message = null;
        this.clearFieldNotice();
      }, { once: true });
    }
    input.addEventListener("keydown", (e) => this.editorKey(e));
    input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (this.editor?.input === input && !this.el.contains(document.activeElement)) this.commitEditor(null);
      });
    });
    input.focus();
    input.setSelectionRange(text.length, text.length);
  }

  private reopenEditor(): void {
    const ed = this.editor!;
    const text = ed.input.value;
    this.editor = null;
    this.openEditor(ed.rowId, ed.columnId, text, ed.original, ed.message);
  }

  private clearFieldNotice(): void {
    this.fieldNotice?.remove();
    this.fieldNotice = null;
  }

  private editorKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      this.commitEditor("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.commitEditor(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.cancelEditor(true);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
  }

  private cancelEditor(focus: boolean): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    this.clearFieldNotice();
    this.paintCell(ed.rowId, ed.columnId);
    if (focus) this.focusActive();
  }

  private target(direction: "down" | "right" | "left" | null, from: Pos): Pos {
    const lastR = this.rows.length - 1;
    const lastC = this.columns.length - 1;
    if (direction === "down") return { r: Math.min(lastR, from.r + 1), c: from.c };
    if (direction === "right") {
      if (from.c < lastC) return { r: from.r, c: from.c + 1 };
      return from.r < lastR ? { r: from.r + 1, c: 0 } : from;
    }
    if (direction === "left") {
      if (from.c > 0) return { r: from.r, c: from.c - 1 };
      return from.r > 0 ? { r: from.r - 1, c: lastC } : from;
    }
    return from;
  }

  private commitEditor(direction: "down" | "right" | "left" | null): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    this.clearFieldNotice();
    const text = ed.input.value;
    const from = { r: this.rows.findIndex((r) => r.id === ed.rowId), c: this.columns.findIndex((c) => c.id === ed.columnId) };
    if (text !== ed.original) this.write(ed.rowId, ed.columnId, text, text);
    else this.paintCell(ed.rowId, ed.columnId);
    if (direction !== null) this.setActive(this.target(direction, from), true);
  }

  // Sends one cell write; a refusal brings the active cell back as the brief states.
  private write(rowId: string, columnId: string, value: string | null, typed: string, reopen?: (message: string) => void): void {
    const back = () => {
      const r = this.rows.findIndex((x) => x.id === rowId);
      const c = this.columns.findIndex((x) => x.id === columnId);
      return r >= 0 && c >= 0 ? { r, c } : null;
    };
    this.ws.writeCell(rowId, columnId, value, typed, {
      invalid: (message) => {
        const pos = back();
        if (!pos) return;
        this.setActive(pos, false);
        if (reopen) reopen(message);
        else {
          const original = this.rows[pos.r]!.cells[columnId]?.display ?? "";
          this.openEditor(rowId, columnId, typed, original, message);
        }
      },
      conflict: () => {
        const pos = back();
        if (pos) this.setActive(pos, true);
      },
    });
  }

  // ---- the Reference picker -----------------------------------------------------------------

  private openPicker(row: Row, col: Column, filter: string, message?: string): void {
    const el = this.cell(row.id, col.id);
    if (!el) return;
    this.picker = new Picker(this.ws, row.id, col, el, filter, {
      choose: (value, label, direction) => {
        this.picker = null;
        const current = row.cells[col.id];
        const from = { r: this.rows.findIndex((r) => r.id === row.id), c: this.columns.findIndex((c) => c.id === col.id) };
        if ((current?.kind === "reference" ? current.value : null) !== value || (value === null && current?.kind !== "blank")) {
          this.write(row.id, col.id, value, label, (msg) => {
            const fresh = this.rows.find((r) => r.id === row.id);
            if (fresh) this.openPicker(fresh, col, filter, msg);
          });
        } else this.paintCell(row.id, col.id);
        this.setActive(this.target(direction, from), true);
      },
      cancel: () => {
        this.picker = null;
        this.paintCell(row.id, col.id);
        this.focusActive();
      },
    }, message);
  }

  // ---- clearing, copying and pasting ranges ------------------------------------------------------

  private clear(): void {
    const rg = this.range();
    const row = this.rows[this.active.r];
    const col = this.columns[this.active.c];
    if (!this.ws.canEditTable) {
      this.ws.readOnlyAttempt();
      return;
    }
    if (!rg) {
      if (!row || !col || col.type === "formula") return;
      const cell = row.cells[col.id];
      if (!cell || cell.kind === "blank") return;
      this.write(row.id, col.id, null, "");
      return;
    }
    const writes = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        const rr = this.rows[r]!;
        const cc = this.columns[c]!;
        if (cc.type === "formula" || rr.cells[cc.id]?.kind === "blank") continue;
        writes.push({ rowId: rr.id, columnId: cc.id, value: null, typed: "" });
      }
    }
    this.ws.paste(writes);
  }

  private selectionText(): { text: string; count: number } {
    const rg = this.range() ?? { r1: this.active.r, r2: this.active.r, c1: this.active.c, c2: this.active.c };
    const lines: string[] = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const cells: string[] = [];
      for (let c = rg.c1; c <= rg.c2; c++) cells.push(this.rows[r]?.cells[this.columns[c]!.id]?.display ?? "");
      lines.push(cells.join("\t"));
    }
    return { text: lines.join("\r\n"), count: (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) };
  }

  private async copy(): Promise<void> {
    const { text, count } = this.selectionText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    announce(this.ws.live.workspace, COPY.copied(count));
  }

  private copyEvent(e: ClipboardEvent): void {
    if (this.editor || this.picker || !e.clipboardData) return;
    e.preventDefault();
    const { text, count } = this.selectionText();
    e.clipboardData.setData("text/plain", text);
    announce(this.ws.live.workspace, COPY.copied(count));
  }

  private pasteEvent(e: ClipboardEvent): void {
    if (this.editor || this.picker || isTextField(e.target as Element)) return;
    e.preventDefault();
    if (this.active.r < 0) return;
    if (!this.ws.canEditTable) {
      this.ws.readOnlyAttempt();
      return;
    }
    const raw = e.clipboardData?.getData("text/plain") ?? "";
    const lines = raw.replace(/(\r\n|\n)$/, "").split(/\r\n|\n/).map((l) => l.split("\t"));
    const noFit = () => announce(this.ws.live.alerts, COPY.noFit);
    const width = lines[0]!.length;
    if (lines.some((l) => l.length !== width)) return noFit();
    const rg = this.range();
    let block = lines;
    let top = this.active.r;
    let left = this.active.c;
    if (rg) {
      const height = rg.r2 - rg.r1 + 1;
      const wide = rg.c2 - rg.c1 + 1;
      if (lines.length === 1 && width === 1) block = Array.from({ length: height }, () => Array.from({ length: wide }, () => lines[0]![0]!));
      else if (lines.length !== height || width !== wide) return noFit();
      top = rg.r1;
      left = rg.c1;
    }
    if (top + block.length > this.rows.length || left + block[0]!.length > this.columns.length) return noFit();
    const writes = [];
    for (let i = 0; i < block.length; i++) {
      for (let j = 0; j < block[i]!.length; j++) {
        const col = this.columns[left + j]!;
        if (col.type === "reference" || col.type === "formula") return noFit();
        const text = block[i]![j]!;
        writes.push({ rowId: this.rows[top + i]!.id, columnId: col.id, value: text === "" ? null : text, typed: text });
      }
    }
    this.setActive({ r: top, c: left }, true, !!rg);
    this.ws.paste(writes, {
      invalid: (rowId, columnId, message) => this.showConflict(rowId, columnId, message),
    });
  }

  // ---- notices and tooltips ---------------------------------------------------------------

  showConflict(rowId: string, columnId: string, text: string | null): void {
    this.conflict?.el.remove();
    const prev = this.conflict;
    this.conflict = null;
    if (prev) this.describe(prev.key);
    if (!text) return;
    const key = `${rowId}|${columnId}`;
    const el = h("div", { id: `conflict-${key.replace(/[^A-Za-z0-9]/g, "-")}`, class: "notice conflict-notice", role: "note" }, icon("alert"), h("span", {}, text));
    overlay().append(el);
    this.conflict = { key, el };
    const cell = this.cells.get(key);
    if (cell) place(el, cell.getBoundingClientRect(), this.ws.statusBar.getBoundingClientRect().top);
    this.describe(key);
  }

  private describe(key: string): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    const ids = [this.tip?.key === key ? this.tip.el.id : null, this.conflict?.key === key ? this.conflict.el.id : null].filter(Boolean);
    if (ids.length) cell.setAttribute("aria-describedby", ids.join(" "));
    else cell.removeAttribute("aria-describedby");
  }

  // The error tooltip of the active or hovered error cell; Escape hides it without moving focus.
  private syncTip(): void {
    const activeEl = this.activeElement();
    const activeKey = activeEl?.getAttribute("data-key") ?? null;
    const wanted = [activeKey, this.hovered].find((k) => {
      if (!k) return false;
      const [rowId, colId] = k.split("|");
      return this.rows.find((r) => r.id === rowId)?.cells[colId!]?.kind === "error" && !this.pending.has(k);
    });
    if (this.tip && this.tip.key === wanted) return;
    this.hideTip();
    if (!wanted) return;
    const [rowId, colId] = wanted.split("|");
    const display = this.rows.find((r) => r.id === rowId)!.cells[colId!]!.display;
    const el = h("div", { role: "tooltip", id: `tip-${wanted.replace(/[^A-Za-z0-9]/g, "-")}`, class: "notice tooltip" }, COPY.tooltips[display] ?? display);
    overlay().append(el);
    this.tip = { key: wanted, el, hidden: false };
    const cell = this.cells.get(wanted);
    if (cell) place(el, cell.getBoundingClientRect(), this.ws.statusBar.getBoundingClientRect().top);
    this.describe(wanted);
  }

  private hideTip(): void {
    if (!this.tip) return;
    const key = this.tip.key;
    this.tip.el.remove();
    this.tip = null;
    this.describe(key);
  }

  // ---- the column options menu ---------------------------------------------------------------

  private openMenu(c: number): void {
    const col = this.columns[c];
    const anchor = this.headers[c];
    if (!col || !anchor) return;
    this.closeMenu(false);
    this.setActive({ r: -1, c }, false);
    const owner = this.ws.isOwner;
    const writer = this.ws.writer;
    const items: HTMLElement[] = [];
    const item = (role: string, label: string, enabled: boolean, act: () => void, checked?: boolean) => {
      const el = h("div", {
        role, tabindex: "-1", class: "menu-item", "aria-disabled": enabled ? null : "true",
        "aria-checked": checked === undefined ? null : String(checked),
      }, h("span", {}, label));
      el.addEventListener("click", () => {
        if (enabled) act();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (enabled) act();
        }
      });
      items.push(el);
    };
    if (["text", "decimal", "date", "bool"].includes(col.type)) {
      for (const [type, label] of [["text", "Text"], ["decimal", "Decimal"], ["date", "Date"], ["bool", "Bool"]] as const) {
        item("menuitemradio", label, owner, () => {
          this.closeMenu(true);
          if (type !== col.type) this.saveColumn(col, { type });
        }, col.type === type);
      }
    }
    if (col.type === "formula" && writer) {
      item("menuitem", "Edit formula", true, () => {
        this.closeMenu(false);
        const row = this.rows[0];
        void import("./dialogs.js").then((d) => d.editFormulaDialog(this.ws, col, this.rows[Math.max(0, this.active.r)]?.id ?? row?.id ?? null, this.headers[c]!, () => this.headers[c] ?? null));
      });
    }
    if (col.type === "text" && owner) {
      const isOwnerColumn = this.ws.table?.owner_column_id === col.id;
      item("menuitemcheckbox", "Use as row owner", true, () => {
        this.closeMenu(true);
        this.ws.commit("PUT", `${tablePath(this.ws.docId, this.ws.table!.id)}/access`, { owner_column_id: isOwnerColumn ? null : col.id }, { label: "access", reload: true });
      }, isOwnerColumn);
    }
    if (owner) {
      item("menuitem", "Rename column", true, () => {
        this.closeMenu(false);
        void import("./dialogs.js").then((d) => d.renameColumnDialog(this.ws, col, this.headers[c]!));
      });
      item("menuitem", "Delete column", true, () => {
        this.closeMenu(false);
        this.deleteColumn(col, c);
      });
    }
    if (items.length === 0) {
      const info = col.type === "reference" ? `Links to ${this.ws.tables.find((t) => t.id === col.target_table_id)?.name ?? "another table"}` : "Calculated column";
      item("menuitem", info, false, () => undefined);
    }
    const menu = h("div", { role: "menu", "aria-label": `Column options for ${col.name}`, class: "menu" }, ...items);
    menu.addEventListener("keydown", (e) => this.menuKey(e, items));
    overlay().append(menu);
    this.menu = menu;
    place(menu, anchor.getBoundingClientRect(), this.ws.statusBar.getBoundingClientRect().top);
    (items.find((i) => i.getAttribute("aria-disabled") !== "true") ?? items[0])!.focus();
    setTimeout(() => document.addEventListener("mousedown", this.outside, true));
  }

  private outside = (e: MouseEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(!(e.target as HTMLElement).closest?.("[role=gridcell], .header-button"));
  };

  private menuKey(e: KeyboardEvent, items: HTMLElement[]): void {
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]!.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      this.closeMenu(true);
    }
  }

  private closeMenu(focusHeader: boolean): void {
    document.removeEventListener("mousedown", this.outside, true);
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    if (focusHeader) {
      this.setActive({ r: -1, c: this.active.c }, true);
    }
  }

  private saveColumn(col: Column, change: Record<string, string>): void {
    this.ws.commit("PATCH", `${tablePath(this.ws.docId, this.ws.table!.id)}/columns/${col.id}`, { revision: col.revision, ...change }, {
      label: "column",
      reload: true,
      success: () => this.headers[this.columns.findIndex((x) => x.id === col.id)]?.focus(),
      refused: (status, error) => (status === 409 ? COPY.columnConflict : status === 422 ? Object.values(error?.fields ?? {})[0] ?? null : null),
    });
  }

  private deleteColumn(col: Column, c: number): void {
    this.ws.commit("DELETE", `${tablePath(this.ws.docId, this.ws.table!.id)}/columns/${col.id}`, undefined, {
      label: "column",
      reload: true,
      success: () => {
        queueMicrotask(() => {
          const next = Math.min(c, this.columns.length - 1);
          if (next < 0) this.ws.control("add-column")?.focus();
          else this.setActive({ r: -1, c: next }, true);
        });
      },
      refused: (_s, error) => error?.message ?? null,
    });
  }

  private deleteActiveRow(): void {
    const row = this.rows[this.active.r];
    if (!row) return;
    this.ws.deleteRow(row.id, this.columns[this.active.c]?.id ?? null);
  }

  activePosition(): { row: Row | undefined; column: Column | undefined } {
    return { row: this.rows[this.active.r], column: this.columns[this.active.c] };
  }

  focusHeader(columnId: string): void {
    const c = this.columns.findIndex((x) => x.id === columnId);
    if (c >= 0) this.setActive({ r: -1, c }, true);
  }
}

// The pinned formula bar at 1280: the active cell's raw content and its live preview.
class FormulaBar {
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly preview: Preview;
  private dirty = false;

  constructor(
    private readonly ws: Workspace,
    private readonly grid: GridView,
  ) {
    this.input = h("input", { type: "text", "aria-label": "Formula", class: "formula-input", spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
    this.status = h("div", { role: "status", "aria-label": "Formula preview", class: "formula-preview" });
    this.preview = new Preview(ws, this.status, () => ({ tableId: ws.table!.id, rowId: grid.activePosition().row?.id ?? null }));
    this.input.addEventListener("input", () => {
      this.dirty = true;
      this.preview.update(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => this.key(e));
  }

  mount(host: HTMLElement): void {
    if (this.input.parentNode !== host) host.replaceChildren(h("span", { class: "fx", "aria-hidden": "true" }, "fx"), this.input, this.status);
    this.refresh();
  }

  destroy(): void {
    this.preview.stop();
  }

  focus(): void {
    this.refresh(true);
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private raw(): string {
    const { row, column } = this.grid.activePosition();
    if (!column) return "";
    if (column.type === "formula" && this.ws.table?.kind === "table") return `=${column.formula ?? ""}`;
    const cell = row?.cells[column.id];
    return cell && cell.kind !== "blank" ? cell.display : "";
  }

  refresh(force = false): void {
    this.input.readOnly = !this.ws.canEditTable;
    if (!force && (this.dirty || document.activeElement === this.input)) return;
    this.dirty = false;
    this.input.value = this.raw();
    this.status.textContent = "";
  }

  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.dirty = false;
      this.preview.update("");
      this.refresh(true);
      this.grid.focusActive();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!this.ws.canEditTable) {
      this.ws.readOnlyAttempt();
      return;
    }
    const { row, column } = this.grid.activePosition();
    if (!column) return;
    const text = this.input.value;
    if (column.type === "formula") {
      this.ws.commit("PATCH", `${tablePath(this.ws.docId, this.ws.table!.id)}/columns/${column.id}`, { revision: column.revision, formula: text }, {
        label: "column",
        reload: true,
        success: () => {
          this.dirty = false;
          this.refresh(true);
        },
        refused: (status, error) => {
          if (status === 409 && error?.current?.column) {
            this.input.value = `=${error.current.column.formula ?? ""}`;
            column.revision = error.current.column.revision;
            column.formula = error.current.column.formula;
            return COPY.columnConflict;
          }
          return Object.values(error?.fields ?? {})[0] ?? null;
        },
      });
      return;
    }
    if (!row || column.type === "reference") return;
    this.dirty = false;
    if (text !== this.raw()) this.ws.writeCell(row.id, column.id, text, text);
    this.grid.focusActive();
  }
}
