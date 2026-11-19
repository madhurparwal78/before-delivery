// Record cards at 375: one card per row, labelled fields with their own Edit buttons,
// the row actions sheet on a long press, and folding cards on delete.
import type { Column, Row } from "./api.js";
import { COPY, rowDisplay } from "./copy.js";
import { Dialog } from "./dialog.js";
import { button, h, icon, overlay, place, reducedMotion } from "./dom.js";
import { Picker } from "./picker.js";
import { paint } from "./roll.js";
import type { View, Workspace } from "./workspace.js";

const LONG_PRESS_MS = 500;
const FOLD_MS = 200;

export class CardsView implements View {
  readonly el: HTMLElement;
  private values = new Map<string, HTMLElement>();
  private fields = new Map<string, HTMLElement>();
  private editing: { rowId: string; columnId: string; text: string; message: string | null } | null = null;
  private picker: Picker | null = null;
  private pending = new Map<string, string>();
  private tip: HTMLElement | null = null;
  private lastCard: string | null = null;

  constructor(private readonly ws: Workspace) {
    this.el = h("div", { class: "cards" });
  }

  destroy(): void {
    this.picker?.close(false);
    this.tip?.remove();
  }

  private get columns(): Column[] {
    return this.ws.columns;
  }

  private get rows(): Row[] {
    return this.ws.rows;
  }

  render(): void {
    // Whatever had focus in the list keeps it, or its card's heading does when it is gone.
    const focused = document.activeElement as HTMLElement | null;
    const inside = !!focused && this.el.contains(focused);
    const editKey = inside ? focused!.getAttribute("data-edit") : null;
    const cardRow = inside ? focused!.closest("li.card")?.getAttribute("data-row") ?? null : null;
    this.values.clear();
    this.fields.clear();
    if (this.rows.length === 0) {
      this.el.replaceChildren(h("div", { class: "empty empty-table" }, icon("table"), h("p", { class: "empty-copy" }, COPY.emptyTable)));
      return;
    }
    const list = h("ul", { role: "list", "aria-label": "Records", class: "card-list" });
    for (const row of this.rows) list.append(this.card(row));
    this.el.replaceChildren(list);
    if (this.editing) this.focusEditor();
    else if (inside && !this.el.contains(document.activeElement)) {
      const edit = editKey ? this.el.querySelector<HTMLElement>(`[data-edit="${CSS.escape(editKey)}"]`) : null;
      (edit ?? (cardRow ? this.headingOf(cardRow) : null))?.focus();
    }
  }

  private heading(row: Row): string {
    const first = this.columns[0];
    return rowDisplay(first ? (row.cells[first.id]?.display ?? "") : "");
  }

  private card(row: Row): HTMLElement {
    const writer = this.ws.canEditTable;
    const title = h("h3", { class: "card-title", tabindex: "-1", "data-row": row.id }, this.heading(row));
    this.longPress(title, row);
    const item = h("li", { class: "card", "data-row": row.id }, title);
    for (const col of this.columns) item.append(this.field(row, col, writer));
    if (writer) item.append(h("div", { class: "card-actions" }, button("Delete row", { onclick: () => this.deleteRow(row.id) }, "trash")));
    return item;
  }

  private field(row: Row, col: Column, writer: boolean): HTMLElement {
    const key = `${row.id}|${col.id}`;
    const value = h("span", { class: `field-value type-${col.type}`, "data-key": key });
    const wrap = h("div", { class: "card-field", "data-key": key }, h("span", { class: "field-label" }, col.name));
    this.values.set(key, value);
    this.fields.set(key, wrap);
    if (this.editing && this.editing.rowId === row.id && this.editing.columnId === col.id && col.type !== "reference") {
      wrap.append(this.editorFor(row, col));
      return wrap;
    }
    wrap.append(value);
    this.paintValue(row, col);
    value.addEventListener("click", () => this.toggleTip(row, col, value));
    if (writer && col.type === "formula") {
      // Shows "Edit", which its name "Edit <column> formula" contains; the sigma marks it as the formula's.
      wrap.append(button("Edit", {
        class: "btn field-edit", "data-edit": key, "aria-label": `Edit ${col.name} formula`,
        onclick: (e: Event) => {
          const opener = e.currentTarget as HTMLElement;
          void import("./dialogs.js").then((d) => d.editFormulaDialog(this.ws, col, row.id, opener, () => this.el.querySelector<HTMLElement>(`[data-edit="${CSS.escape(key)}"]`)));
        },
      }, "sigma"));
    } else if (writer) {
      wrap.append(button("Edit", { class: "btn field-edit", "data-edit": key, "aria-label": `Edit ${col.name}`, onclick: () => this.edit(row, col) }, "pencil"));
    }
    return wrap;
  }

  private paintValue(row: Row, col: Column): void {
    const key = `${row.id}|${col.id}`;
    const el = this.values.get(key);
    const wrap = this.fields.get(key);
    if (!el || !wrap) return;
    const pending = this.pending.get(key);
    wrap.classList.toggle("pending", pending !== undefined);
    if (pending !== undefined) {
      wrap.setAttribute("aria-busy", "true");
      el.textContent = pending;
      return;
    }
    wrap.removeAttribute("aria-busy");
    const cell = row.cells[col.id];
    el.classList.toggle("kind-error", cell?.kind === "error");
    el.classList.toggle("kind-number", cell?.kind === "decimal");
    paint(el, cell?.display ?? "", cell?.kind ?? "blank");
  }

  private toggleTip(row: Row, col: Column, el: HTMLElement): void {
    this.tip?.remove();
    this.tip = null;
    el.removeAttribute("aria-describedby");
    const cell = row.cells[col.id];
    if (cell?.kind !== "error") return;
    const tip = h("div", { role: "tooltip", id: `tip-${row.id}-${col.id}`, class: "notice tooltip" }, COPY.tooltips[cell.display] ?? cell.display);
    overlay().append(tip);
    place(tip, el.getBoundingClientRect(), this.ws.statusBar.getBoundingClientRect().top);
    el.setAttribute("aria-describedby", tip.id);
    this.tip = tip;
  }

  // ---- editing a field ----------------------------------------------------------------------

  private edit(row: Row, col: Column, text?: string, message?: string): void {
    if (!this.ws.canEditTable) return;
    if (col.type === "reference") {
      const wrap = this.fields.get(`${row.id}|${col.id}`);
      const value = this.values.get(`${row.id}|${col.id}`);
      if (!wrap || !value) return;
      wrap.querySelector(".field-edit")?.remove();
      this.picker = new Picker(this.ws, row.id, col, value, text ?? "", {
        choose: (choice, label) => {
          this.picker = null;
          const current = row.cells[col.id];
          if ((current?.kind === "reference" ? current.value : null) !== choice || (choice === null && current?.kind !== "blank")) {
            this.save(row.id, col, choice, label);
          }
          this.render();
          this.focusEdit(row.id, col.id);
        },
        cancel: () => {
          this.picker = null;
          this.render();
          this.focusEdit(row.id, col.id);
        },
      }, message);
      return;
    }
    const cell = row.cells[col.id];
    this.editing = { rowId: row.id, columnId: col.id, text: text ?? (cell && cell.kind !== "blank" ? cell.display : ""), message: message ?? null };
    this.render();
  }

  private editorFor(row: Row, col: Column): HTMLElement {
    const state = this.editing!;
    const input = h("input", { type: "text", "aria-label": col.name, class: `field-input type-${col.type}`, spellcheck: "false" }) as HTMLInputElement;
    input.value = state.text;
    const message = h("p", { class: "field-message", id: `msg-${row.id}-${col.id}` });
    if (state.message) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", message.id);
      message.append(state.message);
    }
    const save = () => {
      const typed = input.value;
      const original = row.cells[col.id]?.kind === "blank" ? "" : (row.cells[col.id]?.display ?? "");
      this.editing = null;
      if (typed !== original) this.save(row.id, col, typed, typed);
      this.render();
      this.focusEdit(row.id, col.id);
    };
    const cancel = () => {
      this.editing = null;
      this.render();
      this.focusEdit(row.id, col.id);
    };
    input.addEventListener("input", () => {
      state.text = input.value;
      input.removeAttribute("aria-invalid");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    const wrap = h("div", { class: "field-editor" }, h("div", { class: "field-control" }, input, icon("alert")), message,
      h("div", { class: "field-buttons" }, button("Save", { onclick: save }), button("Cancel", { onclick: cancel })));
    wrap.addEventListener("keydown", (e) => e.stopPropagation());
    return wrap;
  }

  private save(rowId: string, col: Column, value: string | null, typed: string): void {
    this.ws.writeCell(rowId, col.id, value, typed, {
      invalid: (message) => {
        const row = this.rows.find((r) => r.id === rowId);
        if (row) this.edit(row, col, typed, message);
      },
      forbidden: () => {
        this.lastCard = rowId;
      },
    });
  }

  private focusEditor(): void {
    const input = this.el.querySelector<HTMLInputElement>(".field-input");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  private focusEdit(rowId: string, columnId: string): void {
    const target = this.el.querySelector<HTMLElement>(`[data-edit="${CSS.escape(`${rowId}|${columnId}`)}"]`);
    (target ?? this.headingOf(rowId))?.focus();
  }

  private headingOf(rowId: string): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`h3[data-row="${CSS.escape(rowId)}"]`);
  }

  // ---- rows --------------------------------------------------------------------------------

  private longPress(title: HTMLElement, row: Row): void {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    title.addEventListener("pointerdown", (e) => {
      if (!this.ws.canEditTable) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        start = null;
        this.rowActions(row, title);
      }, LONG_PRESS_MS);
    });
    title.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    });
    title.addEventListener("pointerup", cancel);
    title.addEventListener("pointercancel", cancel);
    title.addEventListener("pointerleave", cancel);
    title.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private rowActions(row: Row, title: HTMLElement): void {
    const name = this.heading(row);
    const dialog = new Dialog({ title: `Row actions for ${name}`, returnTo: () => this.headingOf(row.id) ?? title });
    dialog.body.append(
      h("div", { class: "dialog-buttons" },
        button("Delete row", { onclick: () => {
          dialog.close(false);
          this.deleteRow(row.id);
        } }, "trash"),
        button("Cancel", { onclick: () => dialog.close() }),
      ),
    );
    dialog.show();
  }

  private deleteRow(rowId: string): void {
    this.ws.deleteRow(rowId, null);
  }

  rowRemoved(rowId: string, index: number): void {
    const card = this.el.querySelector<HTMLElement>(`li.card[data-row="${CSS.escape(rowId)}"]`);
    const next = this.rows[index]?.id;
    const focusNext = () => (next ? this.headingOf(next) : null)?.focus() ?? this.ws.focusAddRowOrHeading();
    if (!card || reducedMotion.matches) {
      this.render();
      focusNext();
      return;
    }
    card.setAttribute("data-leaving", "true");
    const done = () => {
      reducedMotion.removeEventListener("change", done);
      clearTimeout(timer);
      if (card.isConnected) this.render();
    };
    const timer = window.setTimeout(done, FOLD_MS);
    reducedMotion.addEventListener("change", done);
    focusNext();
  }

  rowAdded(rowId: string): void {
    this.render();
    const first = this.el.querySelector<HTMLElement>(`li.card[data-row="${CSS.escape(rowId)}"] .field-edit`);
    first?.focus();
  }

  rowBack(rowId: string): void {
    this.render();
    this.headingOf(rowId)?.focus();
  }

  restored(rowId: string, _columnId: string | null): void {
    const target = this.headingOf(rowId);
    if (target) target.focus();
  }

  // ---- the View contract ---------------------------------------------------------------------

  cell(rowId: string, columnId: string): HTMLElement | null {
    return this.values.get(`${rowId}|${columnId}`) ?? null;
  }

  inView(el: HTMLElement): boolean {
    const box = el.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }

  paintCell(rowId: string, columnId: string): void {
    const row = this.rows.find((r) => r.id === rowId);
    const col = this.columns.find((c) => c.id === columnId);
    if (row && col) this.paintValue(row, col);
  }

  setPending(rowId: string, columnId: string, text: string | null): void {
    const key = `${rowId}|${columnId}`;
    if (text === null) this.pending.delete(key);
    else this.pending.set(key, text);
    this.paintCell(rowId, columnId);
  }

  showConflict(rowId: string, columnId: string, text: string | null): void {
    this.el.querySelectorAll(".card-notice").forEach((n) => n.remove());
    if (!text) return;
    const field = this.fields.get(`${rowId}|${columnId}`);
    const note = h("p", { class: "card-notice", id: `card-conflict-${rowId}-${columnId}` }, icon("alert"), text);
    field?.append(note);
    this.values.get(`${rowId}|${columnId}`)?.setAttribute("aria-describedby", note.id);
  }

  focusActive(): void {
    (this.el.querySelector<HTMLElement>("h3.card-title") ?? null)?.focus() ?? this.ws.focusAddRowOrHeading();
  }

  focusLanding(): void {
    const first = this.el.querySelector<HTMLElement>("h3.card-title");
    if (first) first.focus();
    else this.ws.focusAddRowOrHeading();
  }

  afterReread(lost: boolean): void {
    if (lost) this.focusLanding();
  }

  closeEditorsOn(rowIds: Set<string>): boolean {
    let closed = false;
    if (this.editing && rowIds.has(this.editing.rowId)) {
      this.editing = null;
      closed = true;
    }
    if (this.picker && rowIds.has(this.picker.rowId)) {
      this.picker.close(false);
      this.picker = null;
      closed = true;
    }
    return closed;
  }

  readOnlyChanged(): void {
    const focusedCard = this.lastCard ?? (document.activeElement?.closest?.("li.card") as HTMLElement | null)?.getAttribute("data-row") ?? null;
    this.editing = null;
    this.picker?.close(false);
    this.picker = null;
    this.render();
    if (this.ws.readOnly && focusedCard) this.headingOf(focusedCard)?.focus();
    this.lastCard = null;
  }
}
