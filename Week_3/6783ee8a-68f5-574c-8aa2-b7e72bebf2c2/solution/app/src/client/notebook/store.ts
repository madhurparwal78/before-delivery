import type { AppConfig, Cell, CellType, Checkpoint, CompareResult, KernelStatus, LiveEvent, Notebook, Present } from "../../shared/api";
import { ApiFailure, del, download, get, post } from "../api";
import { Kernel } from "./kernel";
import type { Batch } from "./kernel";
import { shownSource, shownType } from "./model";
import type { CellModel, Dialog, NotebookState } from "./model";

const RETRY_MS = 5000;

type Announce = NotebookState["status"];

const quiet: Announce = { text: "", n: 0 };

/** All of one open notebook's page state and everything the page does to it. Components only read `state` and call methods. */
export class NotebookStore {
  state: NotebookState = {
    phase: "loading",
    meta: null,
    cells: [],
    cursor: null,
    anchor: null,
    mode: "command",
    kernel: "idle",
    reconnecting: false,
    present: [],
    status: quiet,
    saveStatus: "All changes saved",
    outage: false,
    dialog: null,
    panelOpen: false,
    checkpoints: [],
    comparison: null,
    locks: new Set(),
    focusToken: 0,
    moved: null,
  };

  readonly tabId = crypto.randomUUID();
  /** Set when the server says the person is not signed in. */
  signedOut = false;

  private config: AppConfig | null = null;
  private readonly listeners = new Set<() => void>();
  private kernel: Kernel | null = null;
  private source: EventSource | null = null;
  private autosave = 0;
  private retry = 0;
  private beatTimer = 0;
  private clipboard: { cell_type: CellType; source: string }[] = [];
  private lastDeletion: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private lockChain: Promise<void> = Promise.resolve();
  private flushChain: Promise<boolean> = Promise.resolve(true);
  private disposed = false;

  constructor(private readonly id: string) {}

  // ---- subscription ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NotebookState => this.state;

  private set(patch: Partial<NotebookState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private url = (suffix: string): string => `/api/notebooks/${this.id}/${suffix}`;

  /** Runs one command after the ones before it, so keys pressed quickly act in order. */
  command(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch((error: unknown) => this.fail(error));
  }

  private fail(error: unknown): void {
    if (error instanceof ApiFailure && error.status === 404) this.set({ phase: "notfound" });
    else if (!(error instanceof ApiFailure)) console.error(error);
  }

  announce(text: string): void {
    this.set({ status: { text, n: this.state.status.n + 1 } });
  }

  private setSave(text: string): void {
    this.set({ saveStatus: text });
  }

  // ---- reading the model ----

  get limits(): AppConfig {
    return this.config as AppConfig;
  }

  get canEdit(): boolean {
    return this.state.meta?.role !== "viewer";
  }

  indexOf(id: string | null): number {
    return this.state.cells.findIndex((cell) => cell.server.id === id);
  }

  numberOf(id: string): number {
    return this.indexOf(id) + 1;
  }

  selectedIds(): string[] {
    const from = this.indexOf(this.state.anchor);
    const to = this.indexOf(this.state.cursor);
    if (from < 0 || to < 0) return this.state.cursor ? [this.state.cursor] : [];
    return this.state.cells.slice(Math.min(from, to), Math.max(from, to) + 1).map((cell) => cell.server.id);
  }

  private modelOf(id: string | null): CellModel | undefined {
    return this.state.cells.find((cell) => cell.server.id === id);
  }

  private lockedByOther(model: CellModel): string | null {
    return model.server.locked_by && !this.state.locks.has(model.server.id) ? model.server.locked_by : null;
  }

  private unsaved(): boolean {
    return this.state.cells.some((cell) => cell.draft);
  }

  // ---- loading and the live connection ----

  async load(): Promise<void> {
    this.config = await get<AppConfig>("/api/config");
    try {
      const { notebook } = await get<{ notebook: Notebook }>(`/api/notebooks/${this.id}`);
      this.adopt(notebook);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) this.signedOut = true;
      this.set({ phase: error instanceof ApiFailure && error.status === 404 ? "notfound" : "failed" });
      return;
    }
    if (this.disposed) return;
    this.connect();
    void this.beat();
    this.beatTimer = window.setInterval(() => void this.beat(), Math.floor(this.config.presence_timeout_ms / 3));
    if (this.canEdit) {
      this.kernel = new Kernel({ notebookId: this.id, tabId: this.tabId, limitMs: this.config.exec_limit_ms, onCell: (cell) => this.applyCells([cell]) });
      void this.kernel.start();
    }
    window.addEventListener("beforeunload", this.leaving);
  }

  private adopt(notebook: Notebook): void {
    const { cells, kernel_status, ...meta } = notebook;
    const models = cells.map((server) => ({ server, draft: this.modelOf(server.id)?.draft ?? null }));
    const first = models[0]?.server.id ?? null;
    const keep = this.indexOf(this.state.cursor) >= 0 && models.some((model) => model.server.id === this.state.cursor);
    this.set({
      phase: "ready",
      meta: { id: meta.id, title: meta.title, role: meta.role, owner_display_name: meta.owner_display_name, imported: meta.imported, execution_counter: meta.execution_counter },
      cells: models,
      kernel: kernel_status,
      cursor: keep ? this.state.cursor : first,
      anchor: keep ? this.state.anchor : first,
    });
  }

  async refetch(): Promise<void> {
    try {
      const { notebook } = await get<{ notebook: Notebook }>(`/api/notebooks/${this.id}`);
      this.adopt(notebook);
    } catch (error) {
      this.fail(error);
    }
  }

  private leaving = (event: BeforeUnloadEvent): void => {
    if (!this.unsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  private connect(): void {
    const source = new EventSource(`/api/notebooks/${this.id}/events?tab_id=${this.tabId}`);
    this.source = source;
    const on = <T>(name: string, handler: (data: T) => void): void => {
      source.addEventListener(name, (event) => handler(JSON.parse((event as MessageEvent<string>).data) as T));
    };
    source.addEventListener("ready", () => {
      if (!this.state.reconnecting) return;
      this.set({ reconnecting: false });
      this.announce("Live again");
      void this.refetch();
      void this.beat();
      this.state.locks.forEach((id) => this.claim(id));
    });
    source.onerror = () => {
      if (this.state.reconnecting || this.disposed) return;
      this.set({ reconnecting: true });
      this.announce("Reconnecting…");
    };
    on<Extract<LiveEvent, { type: "cells" }>>("cells", (event) => this.applyCells(event.cells, event.order));
    on<Extract<LiveEvent, { type: "result" }>>("result", (event) => this.heardResult(event));
    on<Extract<LiveEvent, { type: "kernel" }>>("kernel", (event) => this.heardKernel(event.kernel_status));
    on<{ present: Present[] }>("presence", (event) => this.set({ present: event.present }));
    on<unknown>("checkpoints", () => this.state.panelOpen && void this.loadCheckpoints());
    on<unknown>("access_revoked", () => {
      this.set({ phase: "notfound" });
      this.dispose();
    });
  }

  private heardResult(event: Extract<LiveEvent, { type: "result" }>): void {
    const n = this.numberOf(event.cell_id);
    if (n === 0) return;
    if (event.status === "finished") this.announce(`Cell ${n} ran as [${event.execution_count}]`);
    else if (event.status === "failed") this.announce(`Cell ${n} failed with ${event.ename ?? "Error"}`);
    else if (event.status === "interrupted") this.announce(`Cell ${n} interrupted`);
    else if (event.status === "not_run") this.announce(`Cell ${n} not run`);
  }

  private heardKernel(status: KernelStatus): void {
    if (status === this.state.kernel) return;
    this.set({ kernel: status });
    this.announce(`Kernel ${status}`);
  }

  private async beat(): Promise<void> {
    try {
      const { present } = await post<{ present: Present[] }>(this.url("presence"), { tab_id: this.tabId, cell_id: this.state.cursor });
      this.set({ present });
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) this.set({ phase: "notfound" });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.source?.close();
    this.kernel?.stop();
    window.clearTimeout(this.autosave);
    window.clearInterval(this.retry);
    window.clearInterval(this.beatTimer);
    window.removeEventListener("beforeunload", this.leaving);
  }

  // ---- merging server cells into the page ----

  /** Takes cells from the server. With `order`, that is the notebook's whole sequence; otherwise cells are updated in place. */
  applyCells(incoming: Cell[], order?: string[], select?: { id: string; moved?: boolean }): void {
    const known = new Map(this.state.cells.map((model) => [model.server.id, model]));
    const fresh = new Map(incoming.map((cell) => [cell.id, cell]));
    const merge = (id: string): CellModel | null => {
      const model = known.get(id);
      const cell = fresh.get(id);
      if (!cell) return model ?? null;
      if (!model) return { server: cell, draft: null };
      return cell.revision < model.server.revision ? model : { ...model, server: cell };
    };
    const ids = order ?? this.state.cells.map((model) => model.server.id);
    const cells = ids.flatMap((id) => merge(id) ?? []);
    if (cells.length !== ids.length) void this.refetch();
    let { cursor, anchor } = this.state;
    if (select && cells.some((model) => model.server.id === select.id)) {
      cursor = anchor = select.id;
    } else if (!cells.some((model) => model.server.id === cursor)) {
      const at = Math.min(Math.max(this.indexOf(cursor), 0), cells.length - 1);
      cursor = anchor = cells[at]?.server.id ?? null;
    }
    this.set({ cells, cursor, anchor, ...(select ? { focusToken: this.state.focusToken + 1, moved: select.moved ? select.id : this.state.moved } : {}) });
    if (select) void this.beat();
  }

  // ---- selection and mode ----

  select(id: string, extend = false): void {
    this.set({ cursor: id, anchor: extend ? this.state.anchor : id, focusToken: this.state.focusToken + 1 });
    void this.beat();
  }

  step(delta: number, extend: boolean): void {
    const at = this.indexOf(this.state.cursor);
    const next = this.state.cells[Math.min(Math.max(at + delta, 0), this.state.cells.length - 1)];
    if (next) this.select(next.server.id, extend);
  }

  enterEdit(): void {
    const model = this.modelOf(this.state.cursor);
    if (!model || !this.canEdit || this.state.mode === "edit") return;
    const holder = this.lockedByOther(model);
    if (holder) {
      this.announce(`Cell ${this.numberOf(model.server.id)} is being edited by ${holder}`);
      return;
    }
    this.set({ mode: "edit", focusToken: this.state.focusToken + 1 });
    this.announce("Edit mode");
    this.claim(model.server.id);
  }

  /** Leaves edit mode; `refocus` is false when the person has already moved focus elsewhere. */
  leaveEdit(refocus = true): void {
    if (this.state.mode !== "edit") return;
    const id = this.state.cursor;
    this.set({ mode: "command", ...(refocus ? { focusToken: this.state.focusToken + 1 } : {}) });
    this.announce("Command mode");
    if (id) this.release(id);
  }

  private claim(id: string): void {
    // The lock is assumed at once so the live echo of our own claim never reads as someone else's.
    this.set({ locks: new Set(this.state.locks).add(id) });
    this.lockChain = this.lockChain.then(async () => {
      try {
        await post(this.url(`cells/${id}/lock`), { tab_id: this.tabId });
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 409) return;
        const next = new Set(this.state.locks);
        next.delete(id);
        this.set({ locks: next, mode: "command" });
        this.announce(`Cell ${this.numberOf(id)} is being edited by ${error.body.holder ?? "someone"}`);
      }
    });
  }

  private release(id: string): void {
    if (!this.state.locks.has(id)) return;
    const next = new Set(this.state.locks);
    next.delete(id);
    this.set({ locks: next });
    this.lockChain = this.lockChain.then(() => del(this.url(`cells/${id}/lock`), { tab_id: this.tabId }).catch(() => undefined));
  }

  goToCell(id: string): void {
    this.leaveEdit(false);
    this.set({ cursor: id, anchor: id, dialog: this.state.dialog?.kind === "drawer" ? null : this.state.dialog, focusToken: this.state.focusToken + 1 });
    void this.beat();
  }

  // ---- editing and autosave ----

  edit(id: string, text: string): void {
    const model = this.modelOf(id);
    if (!model || !this.canEdit) return;
    const type = shownType(model);
    const draft = text === model.server.source && type === model.server.cell_type ? null : { source: text, cell_type: type, base: model.draft?.base ?? model.server.revision };
    this.patchDraft(id, draft);
  }

  private patchDraft(id: string, draft: CellModel["draft"]): void {
    this.set({ cells: this.state.cells.map((model) => (model.server.id === id ? { ...model, draft } : model)) });
    this.setSave("Unsaved changes");
    this.arm();
  }

  private arm(): void {
    window.clearTimeout(this.autosave);
    this.autosave = window.setTimeout(() => void this.flush(), this.limits.autosave_ms);
  }

  /** Sends every unsaved edit in one save. Resolves true when nothing unsaved remains. */
  flush(): Promise<boolean> {
    this.flushChain = this.flushChain.then(() => this.saveDrafts());
    return this.flushChain;
  }

  private async saveDrafts(): Promise<boolean> {
    window.clearTimeout(this.autosave);
    const dirty = this.state.cells.filter((model) => model.draft);
    if (dirty.length === 0 || this.state.dialog?.kind === "conflict") return dirty.length === 0;
    this.setSave("Saving…");
    const sent = new Map(dirty.map((model) => [model.server.id, model.draft as NonNullable<CellModel["draft"]>]));
    try {
      const { cells } = await post<{ cells: Cell[] }>(this.url("save"), {
        tab_id: this.tabId,
        cells: dirty.map((model) => ({ id: model.server.id, base_revision: (model.draft as NonNullable<CellModel["draft"]>).base, source: (model.draft as NonNullable<CellModel["draft"]>).source, cell_type: (model.draft as NonNullable<CellModel["draft"]>).cell_type })),
      });
      const saved = new Map(cells.map((cell) => [cell.id, cell]));
      this.set({
        cells: this.state.cells.map((model) => {
          const cell = saved.get(model.server.id);
          const draft = sent.get(model.server.id);
          if (!cell || !draft || !model.draft) return model;
          const same = model.draft.source === draft.source && model.draft.cell_type === draft.cell_type;
          return { server: cell, draft: same ? null : { ...model.draft, base: cell.revision } };
        }),
        outage: false,
      });
      window.clearInterval(this.retry);
      this.retry = 0;
      if (this.unsaved()) {
        this.setSave("Unsaved changes");
        this.arm();
        return false;
      }
      this.setSave("All changes saved");
      return true;
    } catch (error) {
      this.saveFailed(error, dirty[0]?.server.id ?? "");
      return false;
    }
  }

  private saveFailed(error: unknown, firstId: string): void {
    if (error instanceof ApiFailure && error.status === 409 && error.body.error === "stale_revision") {
      this.setSave("Unsaved changes");
      this.set({ dialog: { kind: "conflict", stale: error.body.cells ?? [], cellId: firstId } });
      return;
    }
    if (error instanceof ApiFailure && error.status === 409) {
      this.setSave("Unsaved changes");
    } else if (error instanceof ApiFailure && error.status === 404) {
      this.setSave("Unsaved changes");
      void this.refetch();
      return;
    } else {
      this.set({ outage: true });
      this.setSave("Saving paused: storage unavailable");
    }
    if (!this.retry) {
      this.retry = window.setInterval(() => {
        if (this.unsaved()) void this.flush();
        else {
          window.clearInterval(this.retry);
          this.retry = 0;
        }
      }, RETRY_MS);
    }
  }

  /** "Reload latest": drop this page's unsaved edits to the stale cells and show the server's cells. */
  reloadLatest(): void {
    const dialog = this.state.dialog;
    if (dialog?.kind !== "conflict") return;
    const latest = new Map(dialog.stale.map((cell) => [cell.id, cell]));
    this.set({
      dialog: null,
      cells: this.state.cells.map((model) => {
        const cell = latest.get(model.server.id);
        return cell ? { server: cell, draft: null } : model;
      }),
      focusToken: this.state.focusToken + 1,
      cursor: dialog.cellId,
      anchor: dialog.cellId,
    });
    this.setSave(this.unsaved() ? "Unsaved changes" : "All changes saved");
    if (this.unsaved()) this.arm();
  }

  /** "Keep my version": save this page's text again against the current revisions. */
  keepMine(): void {
    const dialog = this.state.dialog;
    if (dialog?.kind !== "conflict") return;
    const latest = new Map(dialog.stale.map((cell) => [cell.id, cell]));
    this.set({
      dialog: null,
      cells: this.state.cells.map((model) => {
        const cell = latest.get(model.server.id);
        return cell && model.draft ? { server: cell, draft: { ...model.draft, base: cell.revision } } : model;
      }),
      focusToken: this.state.focusToken + 1,
    });
    void this.flush();
  }

  retype(type: CellType): void {
    if (!this.canEdit) return;
    const ids = new Set(this.selectedIds());
    this.set({
      cells: this.state.cells.map((model) => {
        if (!ids.has(model.server.id) || shownType(model) === type) return model;
        const draft = { source: shownSource(model), cell_type: type, base: model.draft?.base ?? model.server.revision };
        const same = draft.source === model.server.source && type === model.server.cell_type;
        return { ...model, draft: same ? null : draft };
      }),
    });
    this.setSave("Unsaved changes");
    this.arm();
  }

  // ---- structure: insert, delete, restore, clipboard, merge, split, move ----

  private takeOrder(cells: Cell[], select?: { id: string; moved?: boolean }): void {
    this.applyCells(cells, cells.map((cell) => cell.id), select);
  }

  async insert(where: "above" | "below", cellType: CellType = "code"): Promise<string | null> {
    if (!this.canEdit) return null;
    const ids = this.selectedIds();
    const at = where === "above" ? this.indexOf(ids[0] ?? null) : this.indexOf(ids[ids.length - 1] ?? null) + 1;
    const made = await post<{ cells: Cell[]; new_ids: string[] }>(this.url("cells"), { position: Math.max(at, 0), cell_type: cellType, source: "" });
    const id = made.new_ids[0] ?? null;
    this.takeOrder(made.cells, id ? { id, moved: true } : undefined);
    return id;
  }

  async remove(): Promise<void> {
    if (!this.canEdit) return;
    const ids = this.selectedIds();
    const at = this.indexOf(ids[0] ?? null);
    try {
      const done = await post<{ cells: Cell[] }>(this.url("cells/delete"), { tab_id: this.tabId, ids });
      this.lastDeletion = ids;
      const next = done.cells[Math.min(at, done.cells.length - 1)];
      this.takeOrder(done.cells, next ? { id: next.id } : undefined);
    } catch (error) {
      this.refused(error);
    }
  }

  async undoDelete(): Promise<void> {
    if (!this.canEdit || this.lastDeletion.length === 0) return;
    const ids = this.lastDeletion;
    this.lastDeletion = [];
    const done = await post<{ cells: Cell[] }>(this.url("cells/restore"), { ids });
    const first = ids.find((id) => done.cells.some((cell) => cell.id === id));
    this.takeOrder(done.cells, first ? { id: first } : undefined);
  }

  copy(): void {
    this.clipboard = this.selectedIds().flatMap((id) => {
      const model = this.modelOf(id);
      return model ? [{ cell_type: shownType(model), source: shownSource(model) }] : [];
    });
  }

  async cut(): Promise<void> {
    this.copy();
    await this.remove();
  }

  async paste(): Promise<void> {
    if (!this.canEdit || this.clipboard.length === 0) return;
    const ids = this.selectedIds();
    const made = await post<{ cells: Cell[]; new_ids: string[] }>(this.url("cells/paste"), { position: this.indexOf(ids[ids.length - 1] ?? null) + 1, cells: this.clipboard });
    const id = made.new_ids[0];
    this.takeOrder(made.cells, id ? { id, moved: true } : undefined);
  }

  async merge(): Promise<void> {
    if (!this.canEdit) return;
    let ids = this.selectedIds();
    if (ids.length === 1) {
      const next = this.state.cells[this.indexOf(ids[0] ?? null) + 1];
      if (!next) return;
      ids = [...ids, next.server.id];
    }
    const types = new Set(ids.map((id) => shownType(this.modelOf(id) as CellModel)));
    if (types.size > 1) {
      this.announce("Cannot merge code and markdown cells");
      return;
    }
    if (!(await this.flush())) return;
    try {
      const done = await post<{ cells: Cell[] }>(this.url("cells/merge"), {
        tab_id: this.tabId,
        ids,
        base_revisions: Object.fromEntries(ids.map((id) => [id, (this.modelOf(id) as CellModel).server.revision])),
      });
      this.takeOrder(done.cells, { id: ids[0] as string });
    } catch (error) {
      this.refused(error);
    }
  }

  /** Splits the cell being edited at the start of the cursor's line; the lower half keeps edit mode. */
  async split(line: number): Promise<void> {
    const id = this.state.cursor;
    const model = this.modelOf(id);
    if (!id || !model || line < 2 || this.state.mode !== "edit") return;
    if (!(await this.flush())) return;
    try {
      const done = await post<{ cells: Cell[]; new_ids: string[] }>(this.url(`cells/${id}/split`), {
        tab_id: this.tabId,
        base_revision: (this.modelOf(id) as CellModel).server.revision,
        line,
      });
      const lower = done.new_ids[0] as string;
      this.release(id);
      this.takeOrder(done.cells, { id: lower, moved: true });
      this.claim(lower);
    } catch (error) {
      this.refused(error);
    }
  }

  async move(id: string, position: number): Promise<void> {
    if (!this.canEdit || position === this.indexOf(id)) return;
    try {
      const done = await post<{ cells: Cell[] }>(this.url(`cells/${id}/move`), { tab_id: this.tabId, position });
      this.set({ moved: id });
      this.takeOrder(done.cells);
    } catch (error) {
      this.refused(error);
    }
  }

  async shift(delta: number, id = this.state.cursor): Promise<void> {
    if (!id) return;
    const to = this.indexOf(id) + delta;
    if (to < 0 || to >= this.state.cells.length) return;
    await this.move(id, to);
  }

  private refused(error: unknown): void {
    if (error instanceof ApiFailure && error.status === 409 && error.body.error === "cell_locked") {
      this.announce(`Cell ${this.numberOf(error.body.cell_id ?? "")} is being edited by ${error.body.holder ?? "someone"}`);
      return;
    }
    throw error;
  }

  // ---- running ----

  /** Runs the cell under the cursor. `then` says what happens to the selection afterwards. */
  async run(then: "advance" | "stay" | "insert"): Promise<void> {
    const model = this.modelOf(this.state.cursor);
    if (!model || !this.canEdit) return;
    const id = model.server.id;
    if (shownType(model) === "code") {
      if (!(await this.flush())) return;
      const current = this.modelOf(id) as CellModel;
      await this.kernel?.submit(id, shownSource(current), null);
    }
    const wasEditing = this.state.mode === "edit";
    if (then === "insert") {
      const made = await this.insert("below");
      if (made && !wasEditing) this.enterEdit();
      else if (made) this.afterInsertEdit(id, made);
      return;
    }
    if (wasEditing) this.leaveEdit();
    if (then === "advance") {
      const next = this.state.cells[this.indexOf(id) + 1];
      if (next) this.select(next.server.id);
      else await this.insert("below");
    }
  }

  private afterInsertEdit(from: string, to: string): void {
    this.release(from);
    this.set({ mode: "edit" });
    this.claim(to);
  }

  async runAll(): Promise<void> {
    if (!this.canEdit) return;
    if (!(await this.flush())) return;
    const batch: Batch = { failed: false };
    for (const model of this.state.cells) {
      if (model.server.cell_type === "code") await this.kernel?.submit(model.server.id, shownSource(model), batch);
    }
  }

  interrupt(): void {
    this.kernel?.interrupt();
  }

  async restart(): Promise<void> {
    this.set({ dialog: null });
    await this.kernel?.restart();
  }

  // ---- dialogs ----

  open(dialog: Dialog): void {
    this.set({ dialog });
  }

  close(): void {
    this.set({ dialog: null });
  }

  // ---- checkpoints ----

  async loadCheckpoints(): Promise<void> {
    try {
      const { checkpoints } = await get<{ checkpoints: Checkpoint[] }>(this.url("checkpoints"));
      this.set({ checkpoints });
    } catch (error) {
      this.fail(error);
    }
  }

  async togglePanel(): Promise<void> {
    if (this.state.panelOpen) {
      this.set({ panelOpen: false, comparison: null });
      return;
    }
    this.set({ panelOpen: true });
    await this.loadCheckpoints();
  }

  async saveCheckpoint(): Promise<void> {
    if (!this.canEdit) return;
    if (!(await this.flush())) return;
    this.setSave("Saving checkpoint…");
    try {
      await post(this.url("checkpoints"), {});
      this.set({ outage: false });
      this.setSave("Checkpoint saved");
      if (this.state.panelOpen) await this.loadCheckpoints();
    } catch (error) {
      if (error instanceof ApiFailure && error.status !== 503 && error.status !== 0) throw error;
      this.set({ outage: true });
      this.setSave("Checkpoint not saved: storage unavailable");
    }
  }

  async compare(checkpoint: Checkpoint): Promise<void> {
    try {
      const result = await get<CompareResult>(this.url(`checkpoints/${checkpoint.id}/compare`));
      this.set({ comparison: { checkpoint, result }, outage: false });
    } catch (error) {
      if (error instanceof ApiFailure && error.status !== 503 && error.status !== 0) throw error;
      this.set({ outage: true });
      this.setSave("Compare failed: storage unavailable");
    }
  }

  closeComparison(): void {
    this.set({ comparison: null });
  }

  async revert(checkpoint: Checkpoint, cellId: string | null): Promise<void> {
    this.set({ dialog: null });
    try {
      const done = await post<{ cells: Cell[] }>(this.url(`checkpoints/${checkpoint.id}/revert`), cellId ? { cell_id: cellId } : {});
      this.set({ comparison: null, outage: false });
      this.applyCells(done.cells, done.cells.map((cell) => cell.id));
      this.setSave(`Reverted to ${checkpoint.label}`);
      await this.loadCheckpoints();
    } catch (error) {
      if (error instanceof ApiFailure && error.status !== 503 && error.status !== 0) throw error;
      this.set({ outage: true });
      this.setSave("Revert failed: storage unavailable");
    }
  }

  // ---- files ----

  async exportFile(): Promise<void> {
    const title = this.state.meta?.title ?? "notebook";
    try {
      await download(this.url("export"), `${title}.ipynb`);
      this.set({ outage: false });
      this.setSave(`Exported ${title}.ipynb`);
    } catch (error) {
      if (error instanceof ApiFailure && error.status !== 503 && error.status !== 0) throw error;
      this.set({ outage: true });
      this.setSave("Export failed: storage unavailable");
    }
  }

  async downloadOriginal(): Promise<void> {
    try {
      await download(this.url("original"), `${this.state.meta?.title ?? "notebook"}.ipynb`);
      this.set({ outage: false });
    } catch (error) {
      if (error instanceof ApiFailure && error.status !== 503 && error.status !== 0) throw error;
      this.set({ outage: true });
      this.setSave("Download failed: storage unavailable");
    }
  }
}
