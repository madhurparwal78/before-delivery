// The browser side of a workbook: the server snapshot, the member's pending edits (kept in this
// browser per member and per workbook), the local view computed with the shared engine, and sync.
import { type Chart, type ClosureCell, type WorkbookContent, WorkbookEngine } from "../../shared/engine.js";
import { LIMITS } from "../../shared/limits.js";
import { type Op, applyOp } from "../../shared/ops.js";
import { type Area, areaText, parseArea, qualifiedArea, qualifiedCell, splitQualified } from "../../shared/refs.js";
import { canAddSheet, chartArea, sheetNameAllowed } from "../../shared/sheets.js";
import { type CellFormat } from "../../shared/values.js";
import { ApiFailure, NetworkFailure, api, uuid } from "../api.js";
import { REASON_TEXT, rolledBack } from "../copy.js";
import { type Conflict, type Snapshot } from "../types.js";
import { notify } from "../ui/notices.js";

interface PendingOp {
  op: Op;
  /** The head sequence the member was looking at when they made the edit. */
  base: number;
}

interface Batch {
  key: string;
  body: string;
  opIds: string[];
}

interface Stored {
  pending: PendingOp[];
  batch: Batch | null;
}

type Result =
  | { opId: string; status: "applied"; seq: number }
  | { opId: string; status: "conflict"; conflictId: string; current: { input: string; author: { id: string; name: string } | null } }
  | { opId: string; status: "rejected"; reason: string; conflictId: string | null };

export type SyncPhase = "idle" | "syncing" | "failed";

export interface CellChange {
  sheetId: string;
  cell: string;
  depth: number;
  ref: string;
  before: { value: unknown; display: string };
  after: { value: unknown; display: string };
}

export interface ChartChange {
  chartId: string;
  before: ReturnType<WorkbookEngine["chartData"]>;
  after: ReturnType<WorkbookEngine["chartData"]>;
  /** Wave depth of each point's source cell, keyed "series:index"; 0 is the edited cell itself. */
  depths: Map<string, number>;
}

export interface CommitEffect {
  ref: string;
  changes: CellChange[];
  charts: ChartChange[];
}

const deviceKey = "furrowbook:device";

function deviceId(): string {
  let id = localStorage.getItem(deviceKey);
  if (!id) {
    id = uuid();
    localStorage.setItem(deviceKey, id);
  }
  return id;
}

function contentOf(s: Snapshot): WorkbookContent {
  return {
    sheets: [...s.sheets]
      .sort((a, b) => a.position - b.position)
      .map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        cells: Object.fromEntries(Object.entries(sheet.cells).map(([cell, c]) => [cell, { input: c.input, format: c.format }])),
      })),
    charts: s.charts.map((c) => ({ id: c.id, sheetId: c.sheetId, type: c.type, title: c.title, range: splitQualified(c.range).area })),
  };
}

function cellKeysOf(op: Op): string[] {
  if (op.type === "setCell") return [`${op.sheetId}!${op.cell}`];
  if (op.type !== "setFormat") return [];
  const area = parseArea(op.range) as Area;
  const keys: string[] = [];
  for (let row = area.top; row <= area.bottom; row++) for (let col = area.left; col <= area.right; col++) keys.push(`${op.sheetId}!${String.fromCharCode(64 + col)}${row}`);
  return keys;
}

export class WorkbookSession {
  snapshot: Snapshot | null = null;
  missing = false;
  engine: WorkbookEngine | null = null;
  conflicts: Conflict[] = [];
  phase: SyncPhase = "idle";
  online = navigator.onLine;
  rollbacks = new Set<string>();
  private stored: Stored;
  private listeners = new Set<() => void>();
  private version = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sending = false;
  private disposed = false;
  /** Set when an acknowledgement removed pending edits, so the next read rebuilds the local view. */
  private stale = false;

  constructor(
    readonly workbookId: string,
    readonly memberId: string,
  ) {
    this.stored = this.readStore();
  }

  // ---- store ----

  private get storageKey(): string {
    return `furrowbook:pending:${this.memberId}:${this.workbookId}`;
  }

  private readStore(): Stored {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw) as Stored;
    } catch {
      localStorage.removeItem(this.storageKey);
    }
    return { pending: [], batch: null };
  }

  private writeStore(): void {
    if (this.stored.pending.length === 0 && !this.stored.batch) localStorage.removeItem(this.storageKey);
    else localStorage.setItem(this.storageKey, JSON.stringify(this.stored));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ---- lifecycle ----

  start(): void {
    const online = (): void => {
      this.online = true;
      this.changed();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      void this.refresh().then(() => this.sync());
    };
    const offline = (): void => {
      this.online = false;
      this.changed();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    this.stop = () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      if (this.pollTimer) clearInterval(this.pollTimer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.disposed = true;
    };
    this.pollTimer = setInterval(() => {
      if (this.online && !this.sending) void this.refresh();
    }, 10_000);
    void this.refresh().then(() => this.sync());
  }

  stop: () => void = () => undefined;

  /** Re-reads the workbook and the member's tray. */
  async refresh(): Promise<void> {
    try {
      const [snap, tray] = await Promise.all([
        api.get<{ workbook: Snapshot }>(`/api/workbooks/${this.workbookId}`),
        api.get<{ conflicts: Conflict[] }>(`/api/workbooks/${this.workbookId}/conflicts`),
      ]);
      if (this.disposed) return;
      const before = this.snapshot;
      this.snapshot = snap.workbook;
      this.conflicts = tray.conflicts;
      const same = before && before.headSeq === snap.workbook.headSeq && before.timeZone === snap.workbook.timeZone && this.engine && !this.stale;
      if (!same) this.rebuild();
      this.stale = false;
      this.changed();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        this.missing = true;
        this.changed();
      }
    }
  }

  /** The local view: the server snapshot with every pending edit applied in order. */
  private rebuild(): void {
    const snap = this.snapshot as Snapshot;
    const engine = new WorkbookEngine(contentOf(snap), { zone: snap.timeZone, nowMs: () => Date.now() });
    for (const p of this.stored.pending) if (this.locallyValid(engine, p.op)) applyOp(engine, p.op);
    this.engine = engine;
  }

  private locallyValid(engine: WorkbookEngine, op: Op): boolean {
    switch (op.type) {
      case "addSheet":
        return !engine.sheetById(op.sheetId) && canAddSheet(engine) && sheetNameAllowed(engine, op.name, null);
      case "renameSheet":
        return engine.sheetById(op.sheetId) !== undefined && sheetNameAllowed(engine, op.name, op.sheetId);
      case "addChart":
        return chartArea(engine, op.sheetId, op.range, false) !== null;
      case "removeChart":
        return engine.chartById(op.chartId) !== undefined;
      default:
        return engine.sheetById(op.sheetId) !== undefined;
    }
  }

  // ---- pending edits ----

  get pendingCount(): number {
    return this.stored.pending.length;
  }

  get inFlightCount(): number {
    return this.sending && this.stored.batch ? this.stored.batch.opIds.length : 0;
  }

  /** Cells holding an edit the server has not acknowledged. */
  pendingCells(): Set<string> {
    const out = new Set<string>();
    for (const p of this.stored.pending) for (const k of cellKeysOf(p.op)) out.add(k);
    return out;
  }

  private queue(op: Op): void {
    const engine = this.engine as WorkbookEngine;
    applyOp(engine, op);
    this.stored.pending.push({ op, base: this.snapshot?.headSeq ?? 0 });
    this.writeStore();
    this.changed();
    void this.sync();
  }

  /** Commits a cell input; returns what changed so the recalc furrow can play it. */
  commitCell(sheetId: string, cell: string, input: string): CommitEffect {
    const engine = this.engine as WorkbookEngine;
    const sheetName = engine.sheetById(sheetId)?.name ?? "";
    const closure: ClosureCell[] = engine.closure(sheetId, cell);
    const before = closure.map((c) => engine.result(c.sheetId, c.cell));
    const bound = engine.charts.filter((chart) => this.chartTouched(chart, sheetId, cell, closure));
    const chartsBefore = bound.map((chart) => engine.chartData(chart));
    this.queue({ opId: uuid(), type: "setCell", sheetId, cell, input });
    const changes: CellChange[] = closure.map((c, i) => ({
      ...c,
      ref: qualifiedCell(engine.sheetById(c.sheetId)?.name ?? "", c.cell),
      before: before[i],
      after: engine.result(c.sheetId, c.cell),
    }));
    const charts = bound.map((chart, i) => ({ chartId: chart.id, before: chartsBefore[i], after: engine.chartData(chart), depths: this.pointDepths(chart, sheetId, cell, closure) }));
    return { ref: qualifiedCell(sheetName, cell), changes, charts };
  }

  private chartTouched(chart: Chart, sheetId: string, cell: string, closure: ClosureCell[]): boolean {
    const inside = (s: string, c: string): boolean => {
      const a = parseArea(c) as Area;
      return s === chart.sheetId && a.top >= chart.area.top && a.top <= chart.area.bottom && a.left >= chart.area.left && a.left <= chart.area.right;
    };
    return inside(sheetId, cell) || closure.some((c) => inside(c.sheetId, c.cell));
  }

  private pointDepths(chart: Chart, sheetId: string, cell: string, closure: ClosureCell[]): Map<string, number> {
    const depthOf = new Map(closure.map((c) => [`${c.sheetId}!${c.cell}`, c.depth]));
    depthOf.set(`${sheetId}!${cell}`, 0);
    const out = new Map<string, number>();
    const { area } = chart;
    for (let col = area.left + 1; col <= area.right; col++) {
      for (let row = area.top + 1; row <= area.bottom; row++) {
        const d = depthOf.get(`${chart.sheetId}!${String.fromCharCode(64 + col)}${row}`);
        if (d !== undefined) out.set(`${col - area.left - 1}:${row - area.top - 1}`, d);
      }
    }
    return out;
  }

  commitFormat(sheetId: string, area: Area, format: Partial<CellFormat>): void {
    this.queue({ opId: uuid(), type: "setFormat", sheetId, range: areaText(area), format });
  }

  addSheet(name: string): string {
    const sheetId = uuid();
    this.queue({ opId: uuid(), type: "addSheet", sheetId, name });
    return sheetId;
  }

  renameSheet(sheetId: string, name: string): void {
    this.queue({ opId: uuid(), type: "renameSheet", sheetId, name });
  }

  addChart(sheetId: string, area: Area, chartType: "bar" | "line", title: string): void {
    const engine = this.engine as WorkbookEngine;
    const name = engine.sheetById(sheetId)?.name ?? "";
    this.queue({ opId: uuid(), type: "addChart", chartId: uuid(), sheetId, chartType, title, range: qualifiedArea(name, area) });
  }

  removeChart(chartId: string): void {
    this.queue({ opId: uuid(), type: "removeChart", chartId });
  }

  // ---- sync ----

  /** Forms a batch from the oldest pending edits made against one base, then sends it with its fixed key. */
  async sync(): Promise<void> {
    if (this.sending || !this.online || this.disposed) return;
    if (!this.stored.batch) {
      const first = this.stored.pending[0];
      if (!first) return;
      const ops: Op[] = [];
      for (const p of this.stored.pending) {
        if (p.base !== first.base || ops.length >= LIMITS.maxOpsPerBatch) break;
        ops.push(p.op);
      }
      this.stored.batch = {
        key: uuid(),
        opIds: ops.map((o) => o.opId),
        body: JSON.stringify({ deviceId: deviceId(), baseSeq: first.base, ops }),
      };
      this.writeStore();
    }
    const batch = this.stored.batch;
    this.sending = true;
    this.phase = "syncing";
    this.changed();
    let results: Result[] | null = null;
    try {
      const res = await fetch(`/api/workbooks/${this.workbookId}/sync`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": batch.key },
        body: batch.body,
      });
      if (res.ok) results = ((await res.json()) as { results: Result[] }).results;
      else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
        results = batch.opIds.map((opId) => ({ opId, status: "rejected" as const, reason: "invalid_op", conflictId: null }));
      }
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof NetworkFailure)) throw error;
    }
    this.sending = false;
    if (this.disposed) return;
    if (!results) {
      this.phase = "failed";
      this.changed();
      this.retryTimer = setTimeout(() => void this.sync(), 5000);
      return;
    }
    this.acknowledge(batch, results);
    this.phase = "idle";
    await this.refresh();
    if (this.stored.pending.length) void this.sync();
  }

  private targetOf(op: Op): string {
    const engine = this.engine as WorkbookEngine;
    const sheetName = (id: string): string => engine.sheetById(id)?.name ?? this.snapshot?.sheets.find((s) => s.id === id)?.name ?? "";
    switch (op.type) {
      case "setCell":
        return qualifiedCell(sheetName(op.sheetId), op.cell);
      case "setFormat":
        return qualifiedArea(sheetName(op.sheetId), parseArea(op.range) as Area);
      case "addSheet":
      case "renameSheet":
        return op.name;
      case "addChart":
        return op.title;
      case "removeChart":
        return engine.chartById(op.chartId)?.title ?? this.snapshot?.charts.find((c) => c.id === op.chartId)?.title ?? "the chart";
    }
  }

  private acknowledge(batch: Batch, results: Result[]): void {
    const byId = new Map(this.stored.pending.map((p) => [p.op.opId, p.op]));
    const rolled = new Set<string>();
    for (const r of results) {
      const op = byId.get(r.opId);
      if (!op) continue;
      if (r.status === "conflict" && op.type === "setCell") {
        notify(`${this.targetOf(op)} conflicted with ${r.current.author?.name ?? "another member"}'s edit. Your value is in the conflict tray.`);
        for (const k of cellKeysOf(op)) rolled.add(k);
      } else if (r.status === "rejected") {
        notify(rolledBack(this.targetOf(op), r.reason in REASON_TEXT ? r.reason : "invalid_op"));
        for (const k of cellKeysOf(op)) rolled.add(k);
      }
    }
    const done = new Set(batch.opIds);
    this.stored.pending = this.stored.pending.filter((p) => !done.has(p.op.opId));
    this.stored.batch = null;
    this.writeStore();
    this.stale = true;
    if (rolled.size) {
      this.rollbacks = rolled;
      setTimeout(() => {
        this.rollbacks = new Set();
        this.changed();
      }, 500);
    }
  }

  // ---- conflict tray ----

  async resolve(conflict: Conflict, choice: "reapply" | "keep_current"): Promise<void> {
    await api.post(`/api/workbooks/${this.workbookId}/conflicts/${conflict.id}/resolve`, { choice });
    await this.refresh();
  }
}
