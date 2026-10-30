// The workbook engine: sheets, cell inputs, formats and charts, with values, budgets and closures
// derived from them. The server folds the op record through it; the browser runs the same code.
import { formatNumber, displayOf } from "./format.js";
import { evaluateFormula, type EvalContext } from "./formula/evaluate.js";
import { renameSheetInFormula } from "./formula/lexer.js";
import { parseFormula, type Parsed, type RefNode } from "./formula/parser.js";
import { LIMITS } from "./limits.js";
import { type Area, areaText, cellName, inArea, parseArea, parseCell } from "./refs.js";
import { stationNow, stationToday } from "./time.js";
import {
  type CellFormat,
  type CellValue,
  type Scalar,
  DEFAULT_FORMAT,
  classifyInput,
  errorValue,
  formatForInput,
} from "./values.js";

export type ChartType = "bar" | "line";

export interface StoredCell {
  input: string;
  format: CellFormat;
}

/** The serialisable state of a workbook: genesis, version snapshots and restore ops use this form. */
export interface WorkbookContent {
  sheets: Array<{ id: string; name: string; cells: Record<string, StoredCell> }>;
  charts: Array<{ id: string; sheetId: string; type: ChartType; title: string; range: string }>;
}

export interface Sheet {
  id: string;
  name: string;
  cells: Map<string, StoredCell>;
}

export interface Chart {
  id: string;
  sheetId: string;
  type: ChartType;
  title: string;
  area: Area;
}

interface CellResult {
  value: CellValue;
  display: string;
}

export interface ClosureCell {
  sheetId: string;
  cell: string;
  depth: number;
}

export interface ChartData {
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

export interface StationClock {
  zone: string;
  nowMs(): number;
}

interface Formula {
  parsed: Parsed;
  /** Each reference resolved to a sheet id; null when the named sheet does not exist. */
  targets: Array<{ sheetId: string | null; ref: RefNode }>;
}

interface Analysis {
  cyclic: boolean;
  chain: number;
}

const key = (sheetId: string, cell: string): string => `${sheetId}!${cell}`;

function splitKey(k: string): { sheetId: string; cell: string } {
  const i = k.indexOf("!");
  return { sheetId: k.slice(0, i), cell: k.slice(i + 1) };
}

function sameFormat(a: CellFormat, b: CellFormat): boolean {
  return a.numberFormat === b.numberFormat && a.bold === b.bold;
}

const parseCache = new Map<string, Parsed>();

function parseCached(source: string): Parsed {
  let p = parseCache.get(source);
  if (!p) {
    p = parseFormula(source);
    if (parseCache.size > 50_000) parseCache.clear();
    parseCache.set(source, p);
  }
  return p;
}

export class WorkbookEngine {
  private sheetList: Sheet[] = [];
  private chartList: Chart[] = [];
  private formulas = new Map<string, Formula>();
  private formulasBySheet = new Map<string, Set<string>>();
  private cellDependents = new Map<string, Set<string>>();
  private areaDependents = new Map<string, Array<{ area: Area; dependent: string }>>();
  private values = new Map<string, CellValue>();
  private analyses = new Map<string, Analysis>();
  private precedentCache = new Map<string, string[]>();

  constructor(
    content: WorkbookContent,
    private readonly clock: StationClock,
  ) {
    this.load(content);
  }

  // ---- reading ----

  get sheets(): readonly Sheet[] {
    return this.sheetList;
  }

  get charts(): readonly Chart[] {
    return this.chartList;
  }

  sheetById(id: string): Sheet | undefined {
    return this.sheetList.find((s) => s.id === id);
  }

  sheetByName(name: string): Sheet | undefined {
    const lower = name.toLowerCase();
    return this.sheetList.find((s) => s.name.toLowerCase() === lower);
  }

  chartById(id: string): Chart | undefined {
    return this.chartList.find((c) => c.id === id);
  }

  stored(sheetId: string, cell: string): StoredCell | undefined {
    return this.sheetById(sheetId)?.cells.get(cell);
  }

  input(sheetId: string, cell: string): string {
    return this.stored(sheetId, cell)?.input ?? "";
  }

  format(sheetId: string, cell: string): CellFormat {
    return this.stored(sheetId, cell)?.format ?? DEFAULT_FORMAT;
  }

  result(sheetId: string, cell: string): CellResult {
    const value = this.valueOf(key(sheetId, cell));
    return { value, display: displayOf(value, this.format(sheetId, cell).numberFormat) };
  }

  /** Text of a number in this cell's format, used while a value counts between two numbers. */
  formatIn(sheetId: string, cell: string, value: number): string {
    return formatNumber(value, this.format(sheetId, cell).numberFormat);
  }

  content(): WorkbookContent {
    return {
      sheets: this.sheetList.map((s) => ({ id: s.id, name: s.name, cells: Object.fromEntries(s.cells) })),
      charts: this.chartList.map((c) => ({ id: c.id, sheetId: c.sheetId, type: c.type, title: c.title, range: areaText(c.area) })),
    };
  }

  // ---- ops ----

  /** Sets a cell input; a date input also gives the cell the date format. */
  setCell(sheetId: string, cell: string, input: string): void {
    const sheet = this.sheetById(sheetId);
    if (!sheet) return;
    const k = key(sheetId, cell);
    const before = sheet.cells.get(cell);
    const format = formatForInput(input, before?.format ?? DEFAULT_FORMAT);
    this.unindex(k);
    if (input === "" && sameFormat(format, DEFAULT_FORMAT)) sheet.cells.delete(cell);
    else sheet.cells.set(cell, { input, format });
    this.index(k, input);
    this.invalidate(k);
  }

  setFormat(sheetId: string, area: Area, change: Partial<CellFormat>): void {
    const sheet = this.sheetById(sheetId);
    if (!sheet) return;
    for (let row = area.top; row <= area.bottom; row++) {
      for (let col = area.left; col <= area.right; col++) {
        const name = cellName(row, col);
        const before = sheet.cells.get(name);
        const format = { ...(before?.format ?? DEFAULT_FORMAT), ...change };
        const input = before?.input ?? "";
        if (input === "" && sameFormat(format, DEFAULT_FORMAT)) sheet.cells.delete(name);
        else sheet.cells.set(name, { input, format });
      }
    }
  }

  addSheet(id: string, name: string): void {
    this.sheetList.push({ id, name, cells: new Map() });
    this.reindex();
  }

  renameSheet(id: string, name: string): void {
    const sheet = this.sheetById(id);
    if (!sheet) return;
    const old = sheet.name;
    sheet.name = name;
    for (const s of this.sheetList) {
      for (const [cell, stored] of s.cells) {
        if (!stored.input.startsWith("=")) continue;
        const rewritten = `=${renameSheetInFormula(stored.input.slice(1), old, name)}`;
        if (rewritten !== stored.input) s.cells.set(cell, { ...stored, input: rewritten });
      }
    }
    this.reindex();
  }

  addChart(chart: Chart): void {
    this.chartList.push(chart);
  }

  removeChart(id: string): void {
    this.chartList = this.chartList.filter((c) => c.id !== id);
  }

  /** Replaces the whole state (a restore). Returns the keys of every cell whose input changed. */
  replaceContent(content: WorkbookContent): Array<{ sheetId: string; cell: string }> {
    const before = new Map<string, string>();
    for (const s of this.sheetList) for (const [cell, c] of s.cells) before.set(key(s.id, cell), c.input);
    this.load(content);
    const changed: Array<{ sheetId: string; cell: string }> = [];
    const after = new Map<string, string>();
    for (const s of this.sheetList) for (const [cell, c] of s.cells) after.set(key(s.id, cell), c.input);
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      if ((before.get(k) ?? "") !== (after.get(k) ?? "")) changed.push(splitKey(k));
    }
    return changed;
  }

  // ---- closure ----

  /** Every cell that depends on the given cell, directly or transitively, on any sheet, with its depth. */
  closure(sheetId: string, cell: string): ClosureCell[] {
    const origin = key(sheetId, cell);
    const members = new Set<string>();
    const queue = [origin];
    while (queue.length) {
      const k = queue.shift() as string;
      for (const d of this.dependentsOf(k)) {
        if (d === origin || members.has(d)) continue;
        members.add(d);
        queue.push(d);
      }
    }
    // Longest chain from the origin: Kahn's order over the closure; cells on a cycle keep their first-reached depth.
    const indegree = new Map<string, number>();
    for (const m of members) indegree.set(m, 0);
    const edges = new Map<string, string[]>();
    for (const from of [origin, ...members]) {
      const out = [...this.dependentsOf(from)].filter((d) => members.has(d));
      edges.set(from, out);
      for (const d of out) indegree.set(d, (indegree.get(d) ?? 0) + 1);
    }
    const depth = new Map<string, number>();
    const ready = [origin];
    depth.set(origin, 0);
    while (ready.length) {
      const from = ready.shift() as string;
      for (const d of edges.get(from) ?? []) {
        depth.set(d, Math.max(depth.get(d) ?? 0, (depth.get(from) ?? 0) + 1));
        const left = (indegree.get(d) ?? 0) - 1;
        indegree.set(d, left);
        if (left === 0) ready.push(d);
      }
    }
    return [...members].map((m) => ({ ...splitKey(m), depth: depth.get(m) ?? 1 }));
  }

  // ---- charts ----

  chartData(chart: Chart): ChartData {
    const { area, sheetId } = chart;
    const categories: string[] = [];
    for (let row = area.top + 1; row <= area.bottom; row++) categories.push(this.result(sheetId, cellName(row, area.left)).display);
    const series: ChartData["series"] = [];
    for (let col = area.left + 1; col <= area.right; col++) {
      const values: Array<number | null> = [];
      for (let row = area.top + 1; row <= area.bottom; row++) {
        const v = this.result(sheetId, cellName(row, col)).value;
        values.push(typeof v === "number" ? v : null);
      }
      series.push({ name: this.result(sheetId, cellName(area.top, col)).display, values });
    }
    return { categories, series };
  }

  // ---- internals ----

  private load(content: WorkbookContent): void {
    this.sheetList = content.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      cells: new Map(Object.entries(s.cells).map(([cell, c]) => [cell, { input: c.input, format: { ...c.format } }])),
    }));
    this.chartList = content.charts.flatMap((c) => {
      const area = parseArea(c.range);
      return area ? [{ id: c.id, sheetId: c.sheetId, type: c.type, title: c.title, area }] : [];
    });
    this.reindex();
  }

  private reindex(): void {
    this.formulas.clear();
    this.formulasBySheet.clear();
    this.cellDependents.clear();
    this.areaDependents.clear();
    this.values.clear();
    this.analyses.clear();
    this.precedentCache.clear();
    for (const s of this.sheetList) for (const [cell, c] of s.cells) this.index(key(s.id, cell), c.input);
  }

  private resolveSheet(ref: RefNode, ownSheetId: string): string | null {
    if (ref.sheet === null) return ownSheetId;
    return this.sheetByName(ref.sheet)?.id ?? null;
  }

  private index(k: string, input: string): void {
    if (!input.startsWith("=")) return;
    const { sheetId } = splitKey(k);
    const parsed = parseCached(input.slice(1));
    const targets = parsed.refs.map((ref) => ({ sheetId: this.resolveSheet(ref, sheetId), ref }));
    this.formulas.set(k, { parsed, targets });
    let own = this.formulasBySheet.get(sheetId);
    if (!own) this.formulasBySheet.set(sheetId, (own = new Set()));
    own.add(k);
    for (const { sheetId: target, ref } of targets) {
      if (target === null || !ref.inGrid) continue;
      if (ref.kind === "cell") {
        const t = key(target, cellName(ref.area.top, ref.area.left));
        let set = this.cellDependents.get(t);
        if (!set) this.cellDependents.set(t, (set = new Set()));
        set.add(k);
      } else {
        let list = this.areaDependents.get(target);
        if (!list) this.areaDependents.set(target, (list = []));
        list.push({ area: ref.area, dependent: k });
      }
    }
  }

  private unindex(k: string): void {
    const f = this.formulas.get(k);
    if (!f) return;
    this.formulas.delete(k);
    this.formulasBySheet.get(splitKey(k).sheetId)?.delete(k);
    for (const { sheetId: target, ref } of f.targets) {
      if (target === null || !ref.inGrid) continue;
      if (ref.kind === "cell") this.cellDependents.get(key(target, cellName(ref.area.top, ref.area.left)))?.delete(k);
      else {
        const list = this.areaDependents.get(target);
        if (list) this.areaDependents.set(target, list.filter((e) => e.dependent !== k));
      }
    }
  }

  private invalidate(k: string): void {
    const affected = [k, ...this.closure(splitKey(k).sheetId, splitKey(k).cell).map((c) => key(c.sheetId, c.cell))];
    for (const a of affected) {
      this.values.delete(a);
      this.analyses.delete(a);
      this.precedentCache.delete(a);
    }
  }

  private dependentsOf(k: string): Set<string> {
    const out = new Set(this.cellDependents.get(k) ?? []);
    const { sheetId, cell } = splitKey(k);
    const at = parseCell(cell);
    if (at) for (const e of this.areaDependents.get(sheetId) ?? []) if (inArea(e.area, at.row, at.col)) out.add(e.dependent);
    return out;
  }

  /** Formula cells a formula reads, statically (whatever an IF selects). */
  private precedents(k: string): string[] {
    const cached = this.precedentCache.get(k);
    if (cached) return cached;
    const f = this.formulas.get(k);
    if (!f) return [];
    const out = new Set<string>();
    for (const { sheetId, ref } of f.targets) {
      if (sheetId === null || !ref.inGrid) continue;
      const pool = this.formulasBySheet.get(sheetId);
      if (!pool || pool.size === 0) continue;
      const a = ref.area;
      const size = (a.bottom - a.top + 1) * (a.right - a.left + 1);
      if (size <= pool.size) {
        for (let row = a.top; row <= a.bottom; row++) {
          for (let col = a.left; col <= a.right; col++) {
            const t = key(sheetId, cellName(row, col));
            if (pool.has(t)) out.add(t);
          }
        }
      } else {
        for (const t of pool) {
          const at = parseCell(splitKey(t).cell);
          if (at && inArea(a, at.row, at.col)) out.add(t);
        }
      }
    }
    const list = [...out];
    this.precedentCache.set(k, list);
    return list;
  }

  /** Cycle membership and chain length for every formula reachable from `root` (iterative Tarjan). */
  private analyze(root: string): void {
    if (this.analyses.has(root)) return;
    const order = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const frames: Array<{ node: string; next: string[]; i: number }> = [];
    let counter = 0;
    const open = (node: string): void => {
      order.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      frames.push({ node, next: this.precedents(node), i: 0 });
    };
    open(root);
    while (frames.length) {
      const frame = frames[frames.length - 1];
      if (frame.i < frame.next.length) {
        const w = frame.next[frame.i++];
        if (this.analyses.has(w)) continue;
        if (!order.has(w)) open(w);
        else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node) as number, order.get(w) as number));
        continue;
      }
      frames.pop();
      const v = frame.node;
      if (frames.length) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent) as number, low.get(v) as number));
      }
      if (low.get(v) !== order.get(v)) continue;
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const members = new Set(component);
      const selfLoop = component.length === 1 && frame.next.includes(v);
      const outside = component.flatMap((c) => this.precedents(c).filter((p) => !members.has(p)));
      const cyclic = component.length > 1 || selfLoop || outside.some((p) => this.analyses.get(p)?.cyclic === true);
      for (const c of component) {
        const f = this.formulas.get(c) as Formula;
        const chain = f.parsed.refs.length === 0 ? 0 : 1 + Math.max(0, ...this.precedents(c).map((p) => this.analyses.get(p)?.chain ?? 0));
        this.analyses.set(c, { cyclic, chain });
      }
    }
  }

  private constant(k: string): CellValue {
    const { sheetId, cell } = splitKey(k);
    const input = this.input(sheetId, cell);
    const kind = classifyInput(input);
    switch (kind.kind) {
      case "empty":
        return null;
      case "formula":
        return this.values.get(k) ?? null;
      default:
        return kind.value as Scalar;
    }
  }

  private context(own: string): EvalContext {
    const ownSheet = splitKey(own).sheetId;
    return {
      sheetOf: (ref) => this.resolveSheet(ref, ownSheet),
      valueAt: (sheetId, row, col) => this.constant(key(sheetId, cellName(row, col))),
      today: () => stationToday(this.clock.nowMs(), this.clock.zone),
      now: () => stationNow(this.clock.nowMs(), this.clock.zone),
    };
  }

  private valueOf(root: string): CellValue {
    if (!this.formulas.has(root)) return this.constant(root);
    const work = [root];
    while (work.length) {
      const k = work[work.length - 1];
      if (this.values.has(k)) {
        work.pop();
        continue;
      }
      this.analyze(k);
      const a = this.analyses.get(k) as Analysis;
      const f = this.formulas.get(k) as Formula;
      if (a.cyclic) this.values.set(k, errorValue("#CYCLE"));
      else if (a.chain > LIMITS.maxDependencyDepth) this.values.set(k, errorValue("#LIMIT"));
      else if (!f.parsed.ok) this.values.set(k, errorValue("#ERROR!"));
      else if (f.parsed.nodes > LIMITS.maxFormulaNodes || f.parsed.cover > LIMITS.maxFormulaCells) this.values.set(k, errorValue("#LIMIT"));
      else {
        const waiting = this.precedents(k).filter((p) => !this.values.has(p));
        if (waiting.length) {
          work.push(...waiting);
          continue;
        }
        this.values.set(k, evaluateFormula(f.parsed.ast, this.context(k)));
      }
      work.pop();
    }
    return this.values.get(root) ?? null;
  }
}

