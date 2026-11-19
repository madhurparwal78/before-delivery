// The workspace: its regions, the document and shown table as last read, and the one
// place where commit, undo, redo and read responses are applied in send order.
import type { Access, ApiErrorBody, Cell, Column, DocumentRead, Recalc, Row, Stacks, TableData, TableInfo, TableRead } from "./api.js";
import { docPath, tablePath } from "./api.js";
import { COPY, rowDisplay } from "./copy.js";
import { Dialog, anyDialogOpen } from "./dialog.js";
import { type Layout, announce, button, h, icon, isTextField, layoutOf, overlay } from "./dom.js";
import { ExportsPanel } from "./exports.js";
import { Roll, type RollTarget } from "./roll.js";
import { type Sent, Sequencer } from "./sequencer.js";


// What a view of the shown table (grid or record cards) offers the workspace.
export interface View {
  readonly el: HTMLElement;
  render(): void;
  cell(rowId: string, columnId: string): HTMLElement | null;
  inView(el: HTMLElement): boolean;
  paintCell(rowId: string, columnId: string): void;
  setPending(rowId: string, columnId: string, text: string | null): void;
  showConflict(rowId: string, columnId: string, text: string | null): void;
  focusActive(): void;
  focusLanding(): void;
  afterReread(lostRow: boolean): void;
  rowAdded(rowId: string): void;
  rowRemoved(rowId: string, index: number): void;
  rowBack(rowId: string): void;
  restored(rowId: string, columnId: string | null): void;
  closeEditorsOn(rowIds: Set<string>): boolean;
  readOnlyChanged(): void;
  destroy(): void;
}

// What happens to one commit's own cells when its answer is applied.
// The status bar's resting line when the page opens, before any commit.
const IDLE = "All changes saved.";

interface CommitHandlers {
  label: "cell" | "paste" | "row-add" | "row-delete" | "undo" | "redo" | "column" | "table" | "create" | "access";
  success?: (data: never) => void;
  refused?: (status: number, error: ApiErrorBody | null) => string | null; // the alert copy, if any
  failed?: () => void;
  reload?: boolean; // the shown table is read again in place before the roll plays
}

type Tag =
  | { kind: "commit"; handlers: CommitHandlers }
  | { kind: "doc"; reread: boolean }
  | {
      kind: "table";
      tableId: string;
      reread: null | { cause: "access" | "gone"; rows: string[]; access: Access | null };
      roll: Recalc | null; // a commit's roll that plays once this read has put the table back on screen
    };

export interface Landing {
  focus: "landing" | "none";
  announce?: string;
}

export class Workspace {
  readonly main: HTMLElement;
  readonly live: { workspace: HTMLElement; recalc: HTMLElement; alerts: HTMLElement; formula: HTMLElement };
  private readonly topbar: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusText: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly seq: Sequencer<Tag>;
  readonly roll: Roll;
  readonly exports: ExportsPanel;

  docName = "";
  role: Access["role"] = "viewer";
  tables: TableInfo[] = [];
  table: TableData | null = null;
  tableId: string | null;
  access: Access | null = null;
  private rowsAccess: Access | null = null;
  readOnly = false;
  stacks: Stacks = { undo_count: 0, redo_count: 0 };
  layout: Layout = layoutOf();
  badges = new Map<string, number>();
  view: View | null = null;
  railOpen = false;
  private loaded = false;
  private landing: Landing;
  private undoButton: HTMLButtonElement | null = null;
  private redoButton: HTMLButtonElement | null = null;
  readonly deleted: DeletedStatus;
  private readonly makeView: (ws: Workspace) => View;
  private resizeHandler = () => this.relayout();
  private keyHandler = (e: KeyboardEvent) => this.shortcut(e);
  formulaBar: HTMLElement | null = null;

  constructor(
    readonly docId: string,
    tableId: string | null,
    landing: Landing,
    makeView: (ws: Workspace) => View,
    readonly navigate: (path: string, push: boolean) => void,
    readonly signOut: () => void,
  ) {
    this.tableId = tableId;
    this.landing = landing;
    this.makeView = makeView;
    const hidden = (role: string, name: string, live: string) => h("div", { role, "aria-label": name, "aria-live": live, class: "visually-hidden" });
    this.live = {
      workspace: hidden("status", "Workspace status", "polite"),
      recalc: hidden("status", "Recalculation announcements", "polite"),
      alerts: hidden("alert", "Grid alerts", "assertive"),
      formula: hidden("status", "Formula announcements", "polite"),
    };
    this.topbar = h("header", { class: "topbar" });
    this.bodyEl = h("div", { class: "ws-body" }, h("p", { class: "loading" }, "Loading…"));
    this.statusText = h("p", { class: "status-text" }, IDLE);
    this.statusBar = h("footer", { class: "statusbar" }, this.statusText, this.live.recalc, this.live.alerts);
    this.main = h(
      "main",
      { "aria-label": "Workspace", class: "workspace", "data-settled": "true", "data-doc-revision": "0" },
      this.topbar,
      this.bodyEl,
      this.statusBar,
      this.live.workspace,
      this.live.formula,
    );
    this.roll = new Roll((text) => (this.statusText.textContent = text), () => this.updateSettled());
    this.seq = new Sequencer<Tag>((batch) => this.applyBatch(batch));
    this.exports = new ExportsPanel(this);
    this.deleted = new DeletedStatus(this);
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("keydown", this.keyHandler);
  }

  destroy(): void {
    window.removeEventListener("resize", this.resizeHandler);
    document.removeEventListener("keydown", this.keyHandler);
    this.view?.destroy();
    this.deleted.close(false);
    this.roll.clear();
    overlay().replaceChildren();
  }

  // ---- loading ------------------------------------------------------------------------

  start(): void {
    this.read(false);
  }

  get writer(): boolean {
    return !this.readOnly && this.role !== "viewer";
  }

  get isOwner(): boolean {
    return this.role === "owner" && !this.readOnly;
  }

  get canEditTable(): boolean {
    return this.writer && this.table?.kind === "table";
  }

  get columns(): Column[] {
    return [...(this.table?.columns ?? [])].sort((a, b) => a.position - b.position);
  }

  get rows(): Row[] {
    return this.table?.rows ?? [];
  }

  // Reads the document and the shown table again, in send order.
  read(reread: boolean, cause: "access" | "gone" = "access"): void {
    this.seq.send("GET", docPath(this.docId), undefined, false, { kind: "doc", reread });
    if (this.tableId) this.sendTableRead(this.tableId, reread ? cause : null);
    this.updateSettled();
  }

  private sendTableRead(tableId: string, cause: "access" | "gone" | null, roll: Recalc | null = null): void {
    this.seq.send("GET", tablePath(this.docId, tableId), undefined, false, {
      kind: "table",
      tableId,
      reread: cause ? { cause, rows: this.table?.id === tableId ? this.rows.map((r) => r.id) : [], access: this.rowsAccess } : null,
      roll,
    });
  }

  // Opens another table of this document (rail, drawer or history).
  showTable(tableId: string, push: boolean, landing: Landing = { focus: "none" }): void {
    if (push) history.pushState(null, "", `/d/${this.docId}/t/${tableId}`);
    this.tableId = tableId;
    this.badges.delete(tableId);
    this.landing = landing;
    this.read(false);
  }

  // ---- commits ------------------------------------------------------------------------

  commit(method: string, url: string, body: unknown, handlers: CommitHandlers): Sent<Tag> {
    if (handlers.label !== "row-delete") this.deleted.close(true);
    this.view?.showConflict("", "", null);
    const sent = this.seq.send(method, url, body, true, { kind: "commit", handlers });
    this.statusText.textContent = COPY.saving;
    this.updateSettled();
    return sent;
  }

  cellOf(rowId: string, columnId: string): Cell | undefined {
    return this.rows.find((r) => r.id === rowId)?.cells[columnId];
  }

  private kindFor(column: Column | undefined, display: string): Cell["kind"] {
    if (display === "") return "blank";
    if (/^#(DIV\/0!|TYPE!|NAME\?|REF!|CIRC!)$/.test(display)) return "error";
    if (!column) return "text";
    return column.type === "formula" ? "text" : (column.type as Cell["kind"]);
  }

  // Writes one data cell: shown muted and busy until its own answer is applied.
  writeCell(
    rowId: string,
    columnId: string,
    value: string | null,
    typed: string,
    ui: { invalid?: (message: string) => void; conflict?: () => void; forbidden?: () => void } = {},
  ): void {
    const before = this.cellOf(rowId, columnId);
    if (!before || !this.table) return;
    this.view?.setPending(rowId, columnId, typed);
    const column = this.columns.find((c) => c.id === columnId);
    const revert = () => {
      this.view?.setPending(rowId, columnId, null);
      this.view?.paintCell(rowId, columnId);
    };
    this.commit("PUT", `${tablePath(this.docId, this.table.id)}/rows/${rowId}/cells/${columnId}`, { value, revision: before.revision }, {
      label: "cell",
      success: (data: { cell: Cell }) => {
        this.setCell(rowId, columnId, data.cell);
        this.view?.setPending(rowId, columnId, null);
        this.view?.paintCell(rowId, columnId);
      },
      refused: (status, error) => {
        if (status === 409 && error?.current) {
          const display = error.current.display ?? "";
          this.setCell(rowId, columnId, {
            value: error.current.value ?? null, display, kind: this.kindFor(column, display), revision: error.current.revision ?? before.revision,
          });
          this.view?.setPending(rowId, columnId, null);
          this.view?.paintCell(rowId, columnId);
          const copy = COPY.cellConflict(display);
          this.view?.showConflict(rowId, columnId, copy);
          ui.conflict?.();
          return copy;
        }
        revert();
        if (status === 422) {
          const message = Object.values(error?.fields ?? {})[0] ?? "";
          ui.invalid?.(message);
          return message;
        }
        if (status === 403) ui.forbidden?.();
        return null;
      },
      failed: revert,
    });
  }

  setCell(rowId: string, columnId: string, cell: Cell): void {
    const row = this.rows.find((r) => r.id === rowId);
    if (!row) return;
    row.cells[columnId] = cell;
  }

  // One request for a block of cells: all or none, one roll, one undo entry.
  paste(writes: { rowId: string; columnId: string; value: string | null; typed: string }[], ui: { invalid?: (rowId: string, columnId: string, message: string) => void } = {}): void {
    if (!this.table || writes.length === 0) return;
    for (const w of writes) this.view?.setPending(w.rowId, w.columnId, w.typed);
    const revert = () => {
      for (const w of writes) {
        this.view?.setPending(w.rowId, w.columnId, null);
        this.view?.paintCell(w.rowId, w.columnId);
      }
    };
    const body = {
      writes: writes.map((w) => ({ row_id: w.rowId, column_id: w.columnId, value: w.value, revision: this.cellOf(w.rowId, w.columnId)?.revision ?? 1 })),
    };
    this.commit("POST", `${tablePath(this.docId, this.table.id)}/cells`, body, {
      label: "paste",
      success: (data: { cells: { row_id: string; column_id: string; cell: Cell }[] }) => {
        for (const c of data.cells) this.setCell(c.row_id, c.column_id, c.cell);
        revert();
      },
      refused: (status, error) => {
        revert();
        if (status === 409 && error?.conflicts) {
          for (const c of error.conflicts) {
            const column = this.columns.find((x) => x.id === c.column_id);
            this.setCell(c.row_id, c.column_id, { value: c.current.value, display: c.current.display, kind: this.kindFor(column, c.current.display), revision: c.current.revision });
            this.view?.paintCell(c.row_id, c.column_id);
          }
          const first = error.conflicts[0]!;
          const copy = COPY.cellConflict(first.current.display);
          this.view?.showConflict(first.row_id, first.column_id, copy);
          return copy;
        }
        if (status === 422) {
          const [key, message] = Object.entries(error?.fields ?? {})[0] ?? ["", ""];
          const [rowId, columnId] = key.split(":");
          if (rowId && columnId) ui.invalid?.(rowId, columnId, message);
          return message;
        }
        return null;
      },
      failed: revert,
    });
  }

  addRow(focus: (rowId: string) => void): void {
    if (!this.table) return;
    const tableId = this.table.id;
    this.commit("POST", `${tablePath(this.docId, tableId)}/rows`, { cells: {} }, {
      label: "row-add",
      success: (data: { row: Row }) => {
        if (this.table?.id !== tableId) return;
        this.table.rows.push(data.row);
        this.view?.rowAdded(data.row.id);
        focus(data.row.id);
      },
    });
  }

  // Deletes a row at once; the answer confirms it, puts it back, or reports a conflict.
  deleteRow(rowId: string, activeColumn: string | null): void {
    if (!this.table) return;
    const table = this.table;
    const index = table.rows.findIndex((r) => r.id === rowId);
    const row = table.rows[index];
    if (!row) return;
    const name = rowDisplay(row.cells[this.columns[0]?.id ?? ""]?.display ?? "");
    table.rows.splice(index, 1);
    this.view?.rowRemoved(rowId, index);
    this.syncDeleteRow();
    const putBack = (current: Row) => {
      if (this.table !== table) return;
      table.rows.splice(Math.min(index, table.rows.length), 0, current);
      this.view?.rowBack(current.id);
    };
    this.commit("DELETE", `${tablePath(this.docId, table.id)}/rows/${rowId}?revision=${row.revision ?? 0}`, undefined, {
      label: "row-delete",
      success: () => this.deleted.show(name, rowId, activeColumn),
      refused: (status, error) => {
        if (status === 409 && error?.current?.row) {
          putBack(error.current.row);
          return COPY.rowConflict;
        }
        if (status !== 404) putBack(row);
        return null;
      },
      failed: () => putBack(row),
    });
  }

  undoRedo(direction: "undo" | "redo", after?: (ok: boolean) => void): void {
    this.commit("POST", `${docPath(this.docId)}/${direction}`, undefined, {
      label: direction,
      reload: true,
      success: () => after?.(true),
      refused: (_status, error) => {
        after?.(false);
        if (error?.code === "nothing_to_undo") return COPY.nothingToUndo;
        if (error?.code === "nothing_to_redo") return COPY.nothingToRedo;
        if (error?.code === "undo_conflict") return COPY.undoConflict;
        return null;
      },
      failed: () => after?.(false),
    });
  }

  // ---- applying answers in send order ---------------------------------------------------

  private async applyBatch(batch: Sent<Tag>[]): Promise<void> {
    let alert: string | null = null;
    let newest: { recalc: Recalc; handlers: CommitHandlers } | null = null;
    let reread: "access" | "gone" | null = null;
    for (const sent of batch) {
      const o = sent.outcome!;
      const tag = sent.tag;
      if (tag.kind === "doc") {
        if (o.kind === "success") reread = this.applyDocRead(o.data as DocumentRead, tag.reread) ?? reread;
        else if (o.kind === "refused" && o.status === 404) this.navigate("/", false);
        continue;
      }
      if (tag.kind === "table") {
        if (o.kind === "success") {
          const result = this.applyTableRead(o.data as TableRead, tag);
          if (result.alert) alert = result.alert;
          reread = result.reread ?? reread;
        }
        continue;
      }
      const handlers = tag.handlers;
      if (o.kind === "success") {
        const data = o.data as { recalc: Recalc };
        (handlers.success as ((d: unknown) => void) | undefined)?.(data);
        const recalc = data.recalc;
        this.stacks = recalc.stacks;
        this.main.setAttribute("data-doc-revision", String(recalc.document_revision));
        this.applyCounts(recalc);
        if (this.accessDiffers(recalc.access)) reread = "access";
        this.access = recalc.access;
        newest = { recalc, handlers };
        if (recalc.cells.some((c) => c.new_display === "#CIRC!" && c.old_display !== "#CIRC!")) alert = COPY.circular;
      } else if (o.kind === "refused") {
        if (o.error?.stacks) this.stacks = o.error.stacks;
        const copy = handlers.refused?.(o.status, o.error) ?? null;
        if (o.status === 403 && o.error?.code === "forbidden") {
          this.setReadOnly(true);
          if (this.accessDiffers({ role: "viewer", row_scope: this.access?.row_scope ?? "all" })) {
            this.access = { role: "viewer", row_scope: this.access?.row_scope ?? "all" };
          }
          reread = "access";
          alert = COPY.permissionLost;
        } else if (o.status === 404) {
          reread = "gone";
          alert = null;
        } else if (copy) alert = copy;
      } else {
        handlers.failed?.();
        alert = COPY.connection;
      }
      // A refused field leaves every saved change saved; any other miss retires the resting line.
      if (o.kind !== "success" && !(o.kind === "refused" && o.status === 422) && this.lastSentence === IDLE) this.lastSentence = "";
    }
    if (newest) {
      // After an undo, redo, rename or a change this page cannot place, the document and
      // the shown table are read again, in send order, and the roll plays on that read.
      if ((newest.handlers.reload || this.listNeedsReload(newest.recalc)) && this.tableId) {
        this.reloading = true;
        this.seq.send("GET", docPath(this.docId), undefined, false, { kind: "doc", reread: true });
        this.sendTableRead(this.tableId, null, newest.recalc);
      } else this.settleCommit(newest.recalc);
    } else if (!this.roll.playing && this.seq.pending === 0) {
      this.statusText.textContent = this.lastSentence;
    }
    this.renderUndoRedo();
    if (!this.reloading) for (const f of this.afterBatch.splice(0)) f();
    if (alert) announce(this.live.alerts, alert);
    if (reread) this.read(true, reread);
    this.updateSettled();
  }

  private lastSentence = IDLE;

  private accessDiffers(next: Access): boolean {
    return !!this.access && (this.access.role !== next.role || this.access.row_scope !== next.row_scope);
  }

  private applyCounts(recalc: Recalc): void {
    for (const t of this.tables) {
      if (recalc.row_counts[t.id] !== undefined) t.row_count = recalc.row_counts[t.id]!;
      if (recalc.column_counts[t.id] !== undefined) t.column_count = recalc.column_counts[t.id]!;
    }
  }

  // A list naming shown cells this page cannot place (new rows, data cells changed by rule)
  // is followed by a fresh read of the shown table.
  private listNeedsReload(recalc: Recalc): boolean {
    if (!this.table) return false;
    const formulas = new Set(this.columns.filter((c) => c.type === "formula").map((c) => c.id));
    return recalc.cells.some(
      (c) => c.table_id === this.table!.id && (!this.cellOf(c.row_id, c.column_id) || (this.table!.kind === "table" && !formulas.has(c.column_id))),
    ) || Object.keys(recalc.column_counts).length > 0;
  }

  private settleCommit(recalc: Recalc): void {
    this.playRoll(recalc);
    announce(this.live.recalc, recalc.sentence);
    void this.exports.refresh();
  }

  private applyDocRead(read: DocumentRead, reread: boolean): "access" | null {
    this.docName = read.document.name;
    this.role = read.document.role;
    this.tables = read.tables;
    this.stacks = { undo_count: read.document.undo_count, redo_count: read.document.redo_count };
    this.main.setAttribute("data-doc-revision", String(read.document.revision));
    const access: Access = { role: read.document.role, row_scope: read.document.row_scope };
    const changed = this.accessDiffers(access);
    this.access = access;
    this.setReadOnly(access.role === "viewer");
    if (!this.tableId) {
      const first = this.tables[0];
      if (first) {
        this.tableId = first.id;
        this.sendTableRead(first.id, null);
      } else {
        this.table = null;
        this.loaded = true;
        this.renderAll(true);
        this.land();
      }
    } else if (!this.tables.some((t) => t.id === this.tableId)) {
      this.navigate(`/d/${this.docId}`, false);
      return null;
    }
    this.renderAll(false);
    return changed && !reread ? "access" : null;
  }

  private applyTableRead(read: TableRead, tag: Extract<Tag, { kind: "table" }>): { alert: string | null; reread: "access" | null } {
    if (tag.tableId !== this.tableId) return { alert: null, reread: null };
    const sameTable = this.table?.id === read.table.id;
    const changed = this.accessDiffers(read.access);
    this.access = read.access;
    this.setReadOnly(read.access.role === "viewer");
    this.stacks = read.stacks;
    this.main.setAttribute("data-doc-revision", String(read.document_revision));
    const keep = new Set(read.table.rows.map((r) => r.id));
    let alert: string | null = null;
    let lost = false;
    if (tag.reread && sameTable) {
      const missing = tag.reread.rows.filter((id) => !keep.has(id));
      lost = this.view?.closeEditorsOn(new Set(missing)) ?? false;
      const narrower = tag.reread.access?.row_scope === "all" && read.access.row_scope === "own";
      if (narrower && missing.length >= 1) alert = COPY.rowsHidden(missing.length);
      else if (tag.reread.cause === "gone") alert = COPY.rowGone;
      lost = lost || missing.length > 0;
    }
    this.table = read.table;
    this.rowsAccess = read.access;
    this.roll.clear();
    this.loaded = true;
    const rebuild = !sameTable || !this.view;
    this.renderAll(rebuild);
    if (!rebuild) this.view?.render();
    if (tag.reread && sameTable) this.view?.afterReread(lost);
    else this.land();
    if (tag.roll) {
      this.reloading = false;
      this.settleCommit(tag.roll);
    } else void this.exports.refresh();
    return { alert, reread: changed && !tag.reread ? "access" : null };
  }

  private land(): void {
    const landing = this.landing;
    this.landing = { focus: "none" };
    if (landing.announce) announce(this.live.workspace, landing.announce);
    if (landing.focus === "landing") this.focusLanding();
  }

  focusLanding(): void {
    if (!this.table) {
      const create = this.bodyEl.querySelector<HTMLElement>("[data-create-first]");
      (create ?? this.topbar.querySelector<HTMLElement>("h1"))?.focus();
      return;
    }
    this.view?.focusLanding();
  }

  setReadOnly(value: boolean): void {
    if (this.readOnly === value) return;
    this.readOnly = value;
    if (this.loaded) {
      this.renderAll(false);
      this.view?.readOnlyChanged();
    }
  }

  readOnlyAttempt(): void {
    announce(this.live.alerts, COPY.readOnly);
  }

  // ---- the Settle roll and the settled marker ------------------------------------------

  private playRoll(recalc: Recalc): void {
    const shown = this.table?.id;
    const targets: RollTarget[] = [];
    this.badges.clear();
    for (const entry of recalc.cells) {
      if (entry.table_id !== shown) {
        this.badges.set(entry.table_id, (this.badges.get(entry.table_id) ?? 0) + 1);
        continue;
      }
      if (entry.new_display !== null) {
        const row = this.rows.find((r) => r.id === entry.row_id);
        const cell = row?.cells[entry.column_id];
        if (row && cell && cell.display !== entry.new_display) {
          row.cells[entry.column_id] = { ...cell, display: entry.new_display, kind: entry.new_kind ?? cell.kind, value: entry.new_kind === "error" || entry.new_kind === "decimal" ? entry.new_display : cell.value };
        }
      }
      const el = this.view?.cell(entry.row_id, entry.column_id);
      if (!el || entry.new_display === null) continue;
      targets.push({ el, old: entry.old_display, now: entry.new_display, kind: entry.new_kind, depth: entry.depth, visible: this.view!.inView(el) });
    }
    this.lastSentence = recalc.sentence;
    this.roll.play(recalc, targets);
    this.renderRail();
  }

  updateSettled(): void {
    const settled = this.seq.pending === 0 && !this.roll.playing;
    this.main.setAttribute("data-settled", settled ? "true" : "false");
    if (this.seq.pending === 0 && !this.roll.playing && this.statusText.textContent === COPY.saving) this.statusText.textContent = this.lastSentence;
  }

  // ---- rendering -------------------------------------------------------------------------

  private relayout(): void {
    const next = layoutOf();
    if (next === this.layout) return;
    this.layout = next;
    if (this.loaded) this.renderAll(true);
  }

  renderAll(rebuildView: boolean): void {
    this.renderTopBar();
    if (rebuildView || !this.view || !this.bodyEl.contains(this.view.el)) this.renderBody();
    else this.renderChrome();
    this.renderUndoRedo();
  }

  private renderTopBar(): void {
    const focused = document.activeElement;
    const keep = focused && this.topbar.contains(focused) ? (focused as HTMLElement).getAttribute("data-control") : null;
    const items: HTMLElement[] = [h("a", { href: "/", class: "home-link", "aria-label": "Documents", "data-control": "home", onclick: (e: Event) => {
      e.preventDefault();
      this.navigate("/", true);
    } }, icon("home"))];
    items.push(h("h1", { class: "doc-title", tabindex: "-1" }, this.docName));
    const actions = h("div", { class: "top-actions" });
    if (this.isOwner) actions.append(button("Share", { "data-control": "share", onclick: (e: Event) => this.openShare(e.currentTarget as HTMLElement) }, "share"));
    if (this.writer) {
      this.undoButton = button("Undo", { class: "btn compact-label", "data-control": "undo", onclick: () => this.pressUndoRedo("undo") }, "undo");
      this.redoButton = button("Redo", { class: "btn compact-label", "data-control": "redo", onclick: () => this.pressUndoRedo("redo") }, "redo");
      actions.append(this.undoButton, this.redoButton);
    } else {
      this.undoButton = this.redoButton = null;
    }
    actions.append(button("Sign out", { "data-control": "sign-out", onclick: () => this.signOut() }, "signOut"));
    items.push(actions);
    if (this.readOnly || this.role === "viewer") items.push(h("p", { role: "note", class: "read-only-note" }, COPY.readOnly));
    this.topbar.replaceChildren(...items);
    if (keep) this.topbar.querySelector<HTMLElement>(`[data-control="${keep}"]`)?.focus();
  }

  renderUndoRedo(): void {
    if (this.undoButton) this.undoButton.disabled = this.stacks.undo_count === 0;
    if (this.redoButton) this.redoButton.disabled = this.stacks.redo_count === 0;
    this.syncDeleteRow();
  }

  // Delete row is disabled exactly while the shown table has no rows.
  private syncDeleteRow(): void {
    const del = this.control("delete-row") as HTMLButtonElement | null;
    if (del) del.disabled = this.rows.length === 0;
  }

  // Focus stays on the pressed button unless that button is now disabled.
  private pressUndoRedo(direction: "undo" | "redo"): void {
    this.undoRedo(direction, () => {
      this.whenApplied(() => {
        const control = direction === "undo" ? this.undoButton : this.redoButton;
        if (control?.disabled && (document.activeElement === control || document.activeElement === document.body)) this.view?.focusActive();
      });
    });
  }

  private afterBatch: (() => void)[] = [];
  private reloading = false; // a commit's re-read is on its way; follow-ups wait for it

  // Runs once the answers being applied now, and the re-read they cause, are on the page.
  whenApplied(f: () => void): void {
    this.afterBatch.push(f);
  }

  private openShare(opener: HTMLElement): void {
    void import("./share.js").then(({ openShare }) => openShare(this, opener));
  }

  // The rail, toolbar and view region; the view itself is rebuilt only when asked.
  private renderBody(): void {
    this.view?.destroy();
    this.view = null;
    this.frame = null;
    this.formulaBar = null;
    this.bodyEl.className = `ws-body layout-${this.layout}`;
    if (!this.loaded) return;
    this.view = this.table ? this.makeView(this) : null;
    this.renderChrome();
    this.view?.render();
  }

  // Persistent hosts, so refreshing the rail or toolbar never detaches the grid or its focus.
  private frame: { toggle: HTMLButtonElement | null; rail: HTMLElement; tableBar: HTMLElement; toolbar: HTMLElement; formula: HTMLElement; area: HTMLElement } | null = null;

  private buildFrame(): void {
    const host = (cls: string) => h("div", { class: `host ${cls}` });
    const toggle = this.layout === "tablet"
      ? (h("button", {
          type: "button", class: "btn tables-toggle", "aria-expanded": "false", "data-control": "tables",
          onclick: () => {
            this.railOpen = !this.railOpen;
            this.renderChrome();
          },
        }, icon("panel"), h("span", {}, "Tables")) as HTMLButtonElement)
      : null;
    this.frame = {
      toggle, rail: host("rail-host"), tableBar: host("table-bar-host"), toolbar: host("toolbar-host"),
      formula: host("formula-host"), area: h("section", { class: "view-area" }),
    };
    const column = h("div", { class: "ws-main" }, this.frame.tableBar, this.frame.toolbar, this.frame.formula, this.frame.area);
    this.bodyEl.replaceChildren(...(toggle ? [toggle] : []), this.frame.rail, column);
  }

  private renderChrome(): void {
    const focused = document.activeElement as HTMLElement | null;
    const control = focused && this.bodyEl.contains(focused) ? focused.getAttribute("data-control") : null;
    if (!this.frame) this.buildFrame();
    const f = this.frame!;
    const phone = this.layout === "phone";
    this.bodyEl.className = `ws-body layout-${this.layout}${this.railOpen ? " rail-open" : ""}`;
    f.toggle?.setAttribute("aria-expanded", String(this.railOpen));
    f.rail.replaceChildren(...(this.layout === "desktop" || (this.layout === "tablet" && this.railOpen) ? [this.rail(false)] : []));
    f.tableBar.replaceChildren(...(phone ? [this.tableBar()] : []));
    f.toolbar.replaceChildren(this.toolbar());
    if (this.layout === "desktop" && this.table && this.view) {
      this.formulaBar ??= h("div", { class: "formula-bar" });
      if (this.formulaBar.parentNode !== f.formula) f.formula.replaceChildren(this.formulaBar);
    } else {
      this.formulaBar = null;
      f.formula.replaceChildren();
    }
    f.area.setAttribute("aria-label", this.table ? `${this.table.name} data` : "Tables");
    if (!this.table) {
      if (!f.area.querySelector(".empty")) f.area.replaceChildren(this.emptyDocument());
    } else if (this.view && this.view.el.parentNode !== f.area) f.area.replaceChildren(this.view.el);
    this.formulaRender?.();
    if (control) this.bodyEl.querySelector<HTMLElement>(`[data-control="${CSS.escape(control)}"]`)?.focus();
  }

  formulaRender: (() => void) | null = null;

  rail(inDrawer: boolean, onChoose?: () => void): HTMLElement {
    const nav = h("nav", { "aria-label": "Tables", class: "rail" });
    const list = h("ul", { class: "rail-list" });
    for (const t of this.tables) {
      const badge = this.badges.get(t.id);
      const name = COPY.railName(t.name, t.row_count, badge);
      const link = h(
        "a",
        {
          href: `/d/${this.docId}/t/${t.id}`,
          class: `rail-link${t.id === this.tableId ? " current" : ""}`,
          "aria-label": name,
          "aria-current": t.id === this.tableId ? "page" : null,
          "data-control": `rail-${t.id}${inDrawer ? "-drawer" : ""}`,
          onclick: (e: Event) => {
            e.preventDefault();
            onChoose?.();
            this.showTable(t.id, true, { focus: inDrawer ? "landing" : "none" });
          },
        },
        // The spaces keep the visible text "Customers 3 rows" inside the link's name "Customers, 3 rows".
        h("span", { class: "rail-name" }, t.kind === "summary" ? icon("sigma") : null, t.name),
        " ",
        h("span", { class: "rail-count" }, t.row_count === 1 ? "1 row" : `${t.row_count} rows`),
        badge ? " " : null,
        badge ? h("span", { class: "badge" }, `${badge} changed`) : null,
      );
      list.append(h("li", {}, link));
    }
    nav.append(list);
    const wrap = h("div", { class: "rail-wrap" }, nav);
    if (this.isOwner) {
      wrap.append(
        h("div", { class: "rail-actions" },
          button("New table", { "data-control": `new-table${inDrawer ? "-drawer" : ""}`, onclick: (e: Event) => this.openNewTable(e.currentTarget as HTMLElement) }, "plus"),
          button("New summary", { "data-control": `new-summary${inDrawer ? "-drawer" : ""}`, onclick: (e: Event) => this.openNewSummary(e.currentTarget as HTMLElement) }, "sigma"),
        ),
      );
    }
    return wrap;
  }

  renderRail(): void {
    if (!this.loaded || !this.frame) return;
    const focused = document.activeElement as HTMLElement | null;
    const control = focused && this.frame.rail.contains(focused) ? focused.getAttribute("data-control") : null;
    this.frame.rail.replaceChildren(...(this.layout === "desktop" || (this.layout === "tablet" && this.railOpen) ? [this.rail(false)] : []));
    if (control) this.frame.rail.querySelector<HTMLElement>(`[data-control="${CSS.escape(control)}"]`)?.focus();
  }

  private tableBar(): HTMLElement {
    return h("div", { class: "table-bar" },
      h("h2", { class: "table-title", tabindex: "-1" }, this.table?.name ?? this.docName),
      button("Switch table", { "data-control": "switch-table", onclick: (e: Event) => this.openDrawer(e.currentTarget as HTMLElement) }, "panel"),
    );
  }

  private toolbar(): HTMLElement {
    const phone = this.layout === "phone";
    const bar = h("div", { class: "toolbar" });
    if (!this.table) return bar;
    if (!phone) bar.append(h("h2", { class: "table-title", tabindex: "-1" }, this.table.name));
    const actions = h("div", { class: "toolbar-actions" });
    if (!phone && this.isOwner && this.table.kind === "table") {
      actions.append(button("Rename table", { "data-control": "rename-table", onclick: (e: Event) => this.openRenameTable(e.currentTarget as HTMLElement) }, "pencil"));
    }
    if (this.canEditTable) {
      actions.append(button("Add row", { "data-control": "add-row", onclick: () => this.pressAddRow() }, "plus"));
      if (!phone) {
        const del = button("Delete row", { "data-control": "delete-row", onclick: () => this.pressDeleteRow() }, "trash");
        del.disabled = this.rows.length === 0;
        actions.append(del);
      }
    }
    actions.append(button("Export CSV", { "data-control": "export", onclick: () => void this.exports.exportShown() }, "file"));
    if (phone) actions.append(button("Exports", { "data-control": "exports-sheet", onclick: (e: Event) => this.exports.openSheet(e.currentTarget as HTMLElement) }, "download"));
    if (this.isOwner && this.table.kind === "table") {
      actions.append(button("Add column", { "data-control": "add-column", onclick: (e: Event) => this.openAddColumn(e.currentTarget as HTMLElement) }, "plus"));
    }
    bar.append(actions, this.exports.region(phone));
    return bar;
  }

  private emptyDocument(): HTMLElement {
    const wrap = h("div", { class: "empty" }, icon("table"), h("p", { class: "empty-copy" }, COPY.emptyDocument));
    if (this.isOwner) {
      wrap.append(button("Create first table", { "data-create-first": "true", "data-control": "create-first", onclick: (e: Event) => this.openNewTable(e.currentTarget as HTMLElement) }, "plus"));
    }
    return wrap;
  }

  control(name: string): HTMLElement | null {
    return this.main.querySelector<HTMLElement>(`[data-control="${CSS.escape(name)}"]`);
  }

  focusAddRowOrHeading(): void {
    (this.control("add-row") ?? this.main.querySelector<HTMLElement>(".table-title"))?.focus();
  }

  pressAddRow(): void {
    this.addRow((rowId) => this.view?.restored(rowId, null));
  }

  pressDeleteRow(): void {
    this.deleteRowHook?.();
  }

  deleteRowHook: (() => void) | null = null;

  private openDrawer(opener: HTMLElement): void {
    let dialog: Dialog | null = null;
    dialog = new Dialog({ title: "Tables", drawer: true, returnTo: () => this.control("switch-table") ?? opener });
    dialog.body.append(this.rail(true, () => dialog?.close(false)));
    dialog.show();
  }

  private openNewTable(opener: HTMLElement): void {
    void import("./dialogs.js").then((d) => d.newTableDialog(this, opener));
  }

  private openNewSummary(opener: HTMLElement): void {
    void import("./dialogs.js").then((d) => d.newSummaryDialog(this, opener));
  }

  private openRenameTable(opener: HTMLElement): void {
    void import("./dialogs.js").then((d) => d.renameTableDialog(this, opener));
  }

  openAddColumn(opener: HTMLElement): void {
    void import("./dialogs.js").then((d) => d.addColumnDialog(this, opener));
  }

  // ---- shortcuts --------------------------------------------------------------------------

  private shortcut(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const redo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
    const undo = key === "z" && !e.shiftKey;
    if (!undo && !redo) return;
    const target = document.activeElement;
    if (isTextField(target) || anyDialogOpen() || overlay().querySelector("[role=menu], [role=listbox]")) return;
    if (!target || !(this.main.contains(target) || overlay().contains(target) || target === document.body)) return;
    e.preventDefault();
    if (!this.writer) {
      this.readOnlyAttempt();
      return;
    }
    this.undoRedo(redo ? "redo" : "undo");
  }
}

// The deleted-row strip: names the row, offers Undo delete for 8 s of unpaused time.
class DeletedStatus {
  private el: HTMLElement | null = null;
  private remaining = 0;
  private startedAt = 0;
  private timer = 0;
  private hovered = false;
  private focused = false;

  constructor(private readonly ws: Workspace) {}

  show(rowName: string, rowId: string, activeColumn: string | null): void {
    this.close(false);
    const undoButton = button("Undo delete", {
      onclick: () => {
        this.close(false);
        this.ws.undoRedo("undo", (ok) => {
          if (!ok) return;
          // The restored row is on the page once the shown table has been read again.
          this.ws.whenApplied(() => {
            this.ws.view?.restored(rowId, activeColumn);
            announce(this.ws.live.workspace, COPY.rowRestored(rowName));
          });
        });
      },
    }, "undo");
    const text = h("span", { class: "deleted-text" }, COPY.rowDeleted(rowName));
    const el = h("div", { role: "status", "aria-label": "Deleted row", class: "deleted-status" }, text, undoButton);
    el.addEventListener("pointerenter", () => this.pause("hover", true));
    el.addEventListener("pointerleave", () => this.pause("hover", false));
    el.addEventListener("focusin", () => this.pause("focus", true));
    el.addEventListener("focusout", (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) this.pause("focus", false);
    });
    this.el = el;
    this.hovered = false;
    this.focused = false;
    this.remaining = 8000;
    overlay().append(el);
    this.run();
  }

  private run(): void {
    clearTimeout(this.timer);
    if (this.hovered || this.focused || !this.el) return;
    this.startedAt = performance.now();
    this.timer = window.setTimeout(() => this.close(true), this.remaining);
  }

  private pause(kind: "hover" | "focus", on: boolean): void {
    if (!this.el) return;
    const wasPaused = this.hovered || this.focused;
    if (kind === "hover") this.hovered = on;
    else this.focused = on;
    const paused = this.hovered || this.focused;
    if (paused && !wasPaused) {
      clearTimeout(this.timer);
      this.remaining -= performance.now() - this.startedAt;
    } else if (!paused && wasPaused) this.run();
  }

  close(moveFocus: boolean): void {
    clearTimeout(this.timer);
    const el = this.el;
    if (!el) return;
    this.el = null;
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (hadFocus && moveFocus) this.ws.view?.focusActive();
  }
}

