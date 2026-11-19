// The query order. Every query for every surface runs these eleven steps, in this order, and only here:
//  1 row-level security, 2 data source filter, 3 context filter, 4 AT expressions and {agg}, 5 dimension filter and
//  top N, 6 PLUS and MINUS expressions, 7 aggregation, 8 measure filter, 9 table calculation, 10 table calculation
//  filter, 11 totals and reference lines.
// A filter's member list comes from the rows that pass every step before the filter's step (`members`).
import { measureCaption } from '../../shared/display.ts';
import type {
  Agg,
  Cell,
  DateLevel,
  Filter,
  FilterStep,
  MeasurePill,
  Pill,
  QueryResult,
  ReferenceValue,
  SetDef,
  SheetShape,
  TableCalc,
} from '../../shared/model.ts';
import { isMeasurePill } from '../../shared/twin.ts';
import { hiddenNotice, markNotice, NO_ROWS_NOTICE, timeNotice, workNotice, workOf } from './bounds.ts';
import type { QueryInput, QueryOutcome } from './contract.ts';
import { memberMatcher, inRange, topMembers } from './filters.ts';
import { Resolver } from './formula/checker.ts';
import { CHUNK, compileRow, evalGroups, type EvalRuntime, type LodNode, type RowFn, type Rows, type TableCalcRunner } from './formula/evaluate.ts';
import type { StaticType } from './formula/functions.ts';
import { forEachNode, type RNode } from './formula/resolved.ts';
import { computeLod, type LevelDim } from './lod.ts';
import { IN, OUT, setMembership } from './sets.ts';
import { applyTableCalc, partitions, type Shelf } from './tablecalc.ts';
import { cellKey, compareCells, dateAtLevel, outputCell } from './values.ts';
import { chooseChart, type DateKind } from './view.ts';
import { OverBudget, runNow, runTimed, type Work } from './work.ts';

type Result = Omit<QueryResult, 'gen'>;

const NOTHING: RNode = { k: 'const', value: null, type: null };

/** A dimension of the view: what each row shows under it and how it sorts. */
interface Dimension {
  name: string;
  shelf: Shelf;
  value: RowFn;
  sortKey: RowFn;
  type: StaticType;
}

interface Measure {
  caption: string;
  pill: MeasurePill;
  node: RNode;
  hasTableCalc: boolean;
}

interface Mark {
  rows: number[];
  values: Cell[];
  keys: string[];
  sortKeys: Cell[];
}

/** A source of per-row values named by a pill or a filter: a field, a row-level calculation or a set. */
interface Source {
  node: RNode;
  set: boolean;
}

function dimensionName(pill: Pill): string {
  return typeof pill === 'string' ? pill : pill.field;
}

function aggType(fn: Agg, arg: StaticType): StaticType {
  return fn === 'MIN' || fn === 'MAX' ? arg : 'number';
}

function hasTableCalc(node: RNode): boolean {
  let found = false;
  forEachNode(node, (n) => {
    if (n.k === 'tablecalc') found = true;
  });
  return found;
}

/** Thrown inside a step when a limit refuses the view. */
class Refused extends Error {
  constructor(readonly notice: string) {
    super(notice);
  }
}

class Query implements EvalRuntime {
  readonly compiled = new Map<RNode, RowFn>();
  private readonly lods = new Map<LodNode, Cell[]>();
  private readonly memberships = new Map<string, (row: number) => boolean>();
  private readonly params = new Map<string, Cell>();
  private readonly names: Resolver;
  private readonly filters: Filter[];
  private readonly rowCount: number;
  /** the rows passing the steps run so far */
  private rows: Rows;
  private dims: Dimension[] = [];
  /** the first View notice that applies so far: a hidden field, then no rows */
  notice: string | null = null;
  private readonly sheet: SheetShape;

  constructor(private readonly input: QueryInput) {
    this.names = new Resolver(input, input.limits);
    this.filters = [...input.sheet.filters, ...input.request.filters];
    this.rowCount = input.dataset.rowCount;
    this.rows = Array.from({ length: this.rowCount }, (_, i) => i);
    for (const param of input.parameters) {
      const raw = input.request.parameters[param.name] ?? param.value;
      const number = Number(raw);
      this.params.set(param.name, param.type === 'number' ? (Number.isFinite(number) ? number : null) : String(raw));
    }
    this.sheet = this.withoutHidden(input.sheet);
  }

  // ---- the runtime the formula evaluator reads

  param(name: string): Cell {
    return this.params.get(name) ?? null;
  }

  setMember(set: SetDef): RowFn {
    return (row) => this.memberships.get(set.name)?.(row) ?? false;
  }

  lodValues(node: LodNode): readonly Cell[] {
    return this.lods.get(node) ?? [];
  }

  // ---- names

  private source(name: string): Source {
    const field = this.names.field(name);
    if (field) return { node: { k: 'field', field, type: field.type }, set: false };
    if (this.names.calc(name)) {
      const analysis = this.names.calcAnalysis(name);
      return { node: analysis && analysis.level !== 'agg' ? analysis.root : NOTHING, set: false };
    }
    const set = this.names.set(name);
    if (set) return { node: { k: 'set', set, type: 'boolean' }, set: true };
    return { node: NOTHING, set: false };
  }

  /** Each row's value under a name: a set shows In and Out, a date pill its level. */
  private rowValue(source: Source, level: DateLevel | null): { value: RowFn; type: StaticType } {
    const base = compileRow(source.node, this);
    if (source.set) return { value: (row) => (base(row) === true ? IN : OUT), type: 'text' };
    if (level !== null && source.node.type === 'date') {
      return {
        value: (row) => {
          const v = base(row);
          return typeof v === 'number' ? dateAtLevel(v, level) : null;
        },
        type: 'text',
      };
    }
    return { value: base, type: source.node.type };
  }

  private measureNode(pill: MeasurePill): RNode {
    const field = this.names.field(pill.field);
    let base: RNode;
    if (field) {
      base = { k: 'agg', fn: pill.agg, arg: { k: 'field', field, type: field.type }, type: aggType(pill.agg, field.type) };
    } else if (this.names.calc(pill.field)) {
      const analysis = this.names.calcAnalysis(pill.field);
      const root = analysis?.root ?? NOTHING;
      base = analysis?.level === 'agg' ? root : { k: 'agg', fn: pill.agg, arg: root, type: aggType(pill.agg, root.type) };
    } else {
      const set = this.names.set(pill.field);
      const arg: RNode = set ? { k: 'set', set, type: 'boolean' } : NOTHING;
      base = { k: 'agg', fn: pill.agg, arg, type: aggType(pill.agg, arg.type) };
    }
    return pill.table_calc ? { k: 'tablecalc', kind: pill.table_calc.kind, arg: base, using: pill.table_calc, type: 'number' } : base;
  }

  private count(n: number | string | null): number {
    const value = typeof n === 'string' && n.startsWith('@') ? this.param(n.slice(1)) : n;
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : 0;
  }

  /** A filter value `@name` stands for the parameter's value. */
  private filterValues(values: readonly Cell[]): Cell[] {
    return values.map((v) => (typeof v === 'string' && v.startsWith('@') && this.params.has(v.slice(1)) ? this.param(v.slice(1)) : v));
  }

  // ---- readiness: sets and level-of-detail values a formula needs, computed from the rows passing so far

  private *ready(root: RNode): Work<void> {
    const sets: SetDef[] = [];
    const lods: LodNode[] = [];
    forEachNode(root, (n) => {
      if (n.k === 'set') sets.push(n.set);
      if (n.k === 'lod') lods.push(n);
    });
    for (const set of sets) yield* this.ensureSet(set);
    for (const lod of lods) yield* this.ensureLod(lod);
  }

  private *ensureSet(set: SetDef): Work<void> {
    if (this.memberships.has(set.name)) return;
    this.memberships.set(set.name, () => false);
    const source = this.source(set.field);
    yield* this.ready(source.node);
    const top = set.top ? { n: this.count(set.top.n), by: this.measureNode(set.top.by) } : null;
    if (top) yield* this.ready(top.by);
    const membership = yield* setMembership(set, {
      member: compileRow(source.node, this),
      type: source.node.type,
      replaced: this.input.request.sets[set.name],
      top,
      rows: this.rows,
      rt: this,
    });
    this.memberships.set(set.name, membership);
  }

  private *ensureLod(node: LodNode): Work<void> {
    if (this.lods.has(node)) return;
    this.lods.set(node, []);
    yield* this.ready(node.body);
    for (const dim of node.dims) yield* this.ready(dim.node);
    const level: LevelDim[] = this.dims.map((d) => ({ name: d.name, key: (row) => cellKey(d.value(row), d.type) }));
    this.lods.set(node, yield* computeLod(node, this.rows, this.rowCount, level, this));
  }

  // ---- the view

  private hiddenIn(name: string): string | null {
    const field = this.names.field(name);
    if (field) return field.hidden ? field.name : null;
    if (this.names.calc(name)) {
      let hidden: string | null = null;
      const root = this.names.calcAnalysis(name)?.root;
      if (root) {
        forEachNode(root, (n) => {
          if (n.k === 'field' && n.field.hidden) hidden ??= n.field.name;
        });
      }
      return hidden;
    }
    const set = this.names.set(name);
    return set ? this.hiddenIn(set.field) : null;
  }

  /** The sheet without pills that use a hidden field; the first such field gives the hidden-field notice. */
  private withoutHidden(sheet: SheetShape): SheetShape {
    const keep = (pill: Pill): boolean => {
      const hidden = this.hiddenIn(dimensionName(pill));
      if (hidden) this.notice ??= hiddenNotice(hidden);
      return hidden === null;
    };
    const kept: SheetShape = {
      ...sheet,
      rows: sheet.rows.filter(keep),
      columns: sheet.columns.filter(keep),
      color: sheet.color && keep(sheet.color) ? sheet.color : null,
      size: sheet.size && keep(sheet.size) ? sheet.size : null,
      label: sheet.label.filter(keep),
      detail: sheet.detail.filter(keep),
    };
    for (const filter of this.filters) {
      const hidden = this.hiddenIn(filter.field) ?? (filter.by ? this.hiddenIn(filter.by.field) : null);
      if (hidden) this.notice ??= hiddenNotice(hidden);
    }
    return kept;
  }

  private dateKind(pill: Pill): DateKind {
    if (isMeasurePill(pill)) return null;
    const field = this.names.field(dimensionName(pill));
    if (field) return field.type === 'date' ? (field.continuous ? 'continuous' : 'discrete') : null;
    return this.source(dimensionName(pill)).node.type === 'date' ? 'discrete' : null;
  }

  /** Dimensions in Rows, Columns, Detail, Color order. */
  private dimensionPills(): { pill: Exclude<Pill, MeasurePill>; shelf: Shelf }[] {
    const sheet = this.sheet;
    const on = (pills: readonly Pill[], shelf: Shelf) =>
      pills.filter((p): p is Exclude<Pill, MeasurePill> => !isMeasurePill(p)).map((pill) => ({ pill, shelf }));
    return [...on(sheet.rows, 'rows'), ...on(sheet.columns, 'columns'), ...on(sheet.detail, 'detail'), ...on(sheet.color ? [sheet.color] : [], 'color')];
  }

  /** Measures in Rows, Columns, Color, Size, Label, Detail order. */
  private measurePills(): MeasurePill[] {
    const sheet = this.sheet;
    const all = [...sheet.rows, ...sheet.columns, sheet.color, sheet.size, ...sheet.label, ...sheet.detail];
    return all.filter((p): p is MeasurePill => p !== null && isMeasurePill(p));
  }

  /** Builds no values yet: sets and level-of-detail expressions are computed at their steps. */
  private resolveDimensions(): void {
    const dims: Dimension[] = [];
    for (const { pill, shelf } of this.dimensionPills()) {
      const name = dimensionName(pill);
      const source = this.source(name);
      const level = typeof pill === 'string' ? 'day' : pill.level;
      const { value, type } = this.rowValue(source, level);
      const order = source.node.k === 'field' ? source.node.field.order : null;
      dims.push({ name, shelf, value, type, sortKey: order ? (row) => order[row] ?? null : value });
    }
    this.dims = dims;
  }

  /** The formulas the view uses, for the work count: each calculation once. */
  private viewFormulas(): RNode[] {
    const names = new Set<string>();
    const sheet = this.sheet;
    for (const pill of [...sheet.rows, ...sheet.columns, sheet.color, sheet.size, ...sheet.label, ...sheet.detail]) {
      if (pill) names.add(dimensionName(pill));
    }
    for (const filter of this.filters) {
      names.add(filter.field);
      if (filter.by) names.add(filter.by.field);
    }
    for (const set of this.input.sets) if (names.has(set.name) && set.top) names.add(set.top.by.field);
    const roots: RNode[] = [];
    for (const name of names) {
      const root = this.names.calc(name) ? this.names.calcAnalysis(name)?.root : undefined;
      if (root) roots.push(root);
    }
    return roots;
  }

  /** Every formula node the view's pills and filters reach. */
  private viewNodes(): RNode[] {
    const nodes = this.dimensionPills().map(({ pill }) => this.source(dimensionName(pill)).node);
    nodes.push(...this.measurePills().map((p) => this.measureNode(p)));
    for (const filter of this.filters) {
      nodes.push(this.source(filter.field).node);
      if (filter.by) nodes.push(this.measureNode(filter.by));
      if (filter.agg) nodes.push(this.measureNode({ field: filter.field, agg: filter.agg, table_calc: filter.table_calc }));
    }
    return nodes;
  }

  private lodsOf(forms: ReadonlySet<string>): LodNode[] {
    const found: LodNode[] = [];
    for (const root of this.viewNodes()) {
      forEachNode(root, (n) => {
        if (n.k === 'lod' && forms.has(n.form) && !found.includes(n)) found.push(n);
      });
    }
    return found;
  }

  private filtersAt(step: FilterStep): Filter[] {
    return this.filters.filter((f) => f.step === step);
  }

  // ---- row steps

  private *keep(predicates: ((row: number) => boolean)[]): Work<void> {
    if (predicates.length === 0) return;
    const kept: number[] = [];
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? 0;
      if (predicates.every((p) => p(row))) kept.push(row);
      if ((i + 1) % CHUNK === 0) yield;
    }
    this.rows = kept;
  }

  /** A data source, context or dimension filter on one row: a member list, or a range when it has one. */
  private *rowFilter(filter: Filter): Work<(row: number) => boolean> {
    const source = this.source(filter.field);
    yield* this.ready(source.node);
    const { value, type } = this.rowValue(source, null);
    if (filter.min !== null || filter.max !== null) return (row) => inRange(value(row), filter.min, filter.max);
    const matches = memberMatcher(this.filterValues(filter.values), type);
    return (row) => matches(value(row));
  }

  /** Step 1. */
  private *security(): Work<void> {
    const security = this.input.security;
    if (security === null) return;
    const field = this.names.field(security.field);
    const allowed = new Set(security.allowed.map((v) => cellKey(v, null)));
    if (!field) {
      this.rows = [];
    } else {
      const values = field.values;
      yield* this.keep([
        (row) => {
          const v = values[row] ?? null;
          return v !== null && allowed.has(cellKey(v, field.type));
        },
      ]);
    }
    if (this.rows.length === 0) this.notice ??= NO_ROWS_NOTICE;
  }

  /** Steps 2 and 3. */
  private *filterStep(step: 'source' | 'context'): Work<void> {
    const predicates = [];
    for (const filter of this.filtersAt(step)) predicates.push(yield* this.rowFilter(filter));
    yield* this.keep(predicates);
  }

  /** Steps 4 and 6. */
  private *levelOfDetail(forms: ReadonlySet<string>): Work<void> {
    for (const node of this.lodsOf(forms)) yield* this.ensureLod(node);
  }

  /** Step 5: dimension filters and top N see the same rows, and a row stays when it passes both. Top N sets too. */
  private *dimensionAndTop(): Work<void> {
    for (const root of this.viewNodes()) {
      const sets: SetDef[] = [];
      forEachNode(root, (n) => {
        if (n.k === 'set') sets.push(n.set);
      });
      for (const set of sets) yield* this.ensureSet(set);
    }
    const predicates = [];
    for (const filter of this.filtersAt('dimension')) predicates.push(yield* this.rowFilter(filter));
    for (const filter of this.filtersAt('top')) {
      const source = this.source(filter.field);
      yield* this.ready(source.node);
      const { value, type } = this.rowValue(source, null);
      const by = this.measureNode(filter.by ?? { field: filter.field, agg: 'COUNT', table_calc: null });
      yield* this.ready(by);
      const keys = yield* topMembers(value, type, this.rows, this.count(filter.n), by, this);
      predicates.push((row: number) => keys.has(cellKey(value(row), type)));
    }
    yield* this.keep(predicates);
  }

  // ---- mark steps

  /** Step 7: one mark per combination of dimension values that exists in the rows, in the view's sort. */
  private *aggregation(measures: Measure[]): Work<{ marks: Mark[]; values: Cell[][] }> {
    const byKey = new Map<string, Mark>();
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? 0;
      const values = this.dims.map((d) => d.value(row));
      const keys = values.map((v, d) => cellKey(v, this.dims[d]?.type ?? null));
      const key = keys.join('\u0001');
      const mark = byKey.get(key);
      if (mark) mark.rows.push(row);
      else byKey.set(key, { rows: [row], values, keys, sortKeys: this.dims.map((d) => d.sortKey(row)) });
      if ((i + 1) % CHUNK === 0) yield;
    }
    const marks = yield* this.sorted([...byKey.values()], measures[0] ?? null);
    const values: Cell[][] = [];
    for (const measure of measures) {
      values.push(measure.hasTableCalc ? [] : yield* evalGroups(measure.node, marks.map((m) => m.rows), this, null));
    }
    return { marks, values };
  }

  /** Ascending by default; `measure` sorts members by the first measure descending; ties by the dimension. */
  private *sorted(marks: Mark[], first: Measure | null): Work<Mark[]> {
    const byMeasure = new Map<number, Map<string, Cell>>();
    for (let d = 0; d < this.dims.length; d++) {
      const dim = this.dims[d];
      if (!dim || this.sheet.sort[dim.name] !== 'measure' || first === null) continue;
      const groups = new Map<string, number[]>();
      for (const mark of marks) {
        const key = mark.keys[d] ?? '';
        groups.set(key, [...(groups.get(key) ?? []), ...mark.rows]);
      }
      const node = first.node.k === 'tablecalc' ? first.node.arg : first.node;
      const values = yield* evalGroups(node, [...groups.values()], this, null);
      byMeasure.set(d, new Map([...groups.keys()].map((key, i) => [key, values[i] ?? null])));
    }
    return marks.slice().sort((a, b) => {
      for (let d = 0; d < this.dims.length; d++) {
        const mode = this.sheet.sort[this.dims[d]?.name ?? ''] ?? 'asc';
        const measure = byMeasure.get(d);
        const order =
          (measure ? compareCells(measure.get(a.keys[d] ?? '') ?? null, measure.get(b.keys[d] ?? '') ?? null, true) : 0) ||
          compareCells(a.sortKeys[d] ?? null, b.sortKeys[d] ?? null, mode === 'desc');
        if (order !== 0) return order;
      }
      return 0;
    });
  }

  private tableCalcs(marks: Mark[], fallback: TableCalc | null): TableCalcRunner {
    const dims = this.dims.map((d) => ({ name: d.name, shelf: d.shelf }));
    const keys = marks.map((m) => m.keys);
    return (kind, values, using) => applyTableCalc(kind, values, partitions(dims, keys, using ?? fallback));
  }

  private *markValues(node: RNode, marks: Mark[], fallback: TableCalc | null): Work<Cell[]> {
    yield* this.ready(node);
    return yield* evalGroups(node, marks.map((m) => m.rows), this, this.tableCalcs(marks, fallback));
  }

  // ---- the query

  /** Runs the row steps before `step` (all of them for a view): steps 1 to 6. */
  private *rowSteps(before: FilterStep | null): Work<void> {
    this.resolveDimensions();
    yield* this.security();
    if (before === 'source') return;
    yield* this.filterStep('source');
    if (before === 'context') return;
    yield* this.filterStep('context');
    yield* this.levelOfDetail(new Set(['AT', 'ALL']));
    if (before === 'dimension' || before === 'top') return;
    yield* this.dimensionAndTop();
    yield* this.levelOfDetail(new Set(['PLUS', 'MINUS']));
  }

  /** A refused view answers with the first View notice that applies: hidden field, no rows, then the refusal. */
  *run(): Work<QueryOutcome> {
    const limits = this.input.limits;
    const choice = chooseChart(this.sheet, (pill) => this.dateKind(pill));
    const overWork = workOf(this.rowCount, this.viewFormulas()) > limits.queryWorkMax;
    if (!choice.ok || overWork) {
      if (this.notice === null) yield* this.security();
      return { ok: false, message: this.notice ?? (choice.ok ? workNotice(limits.queryWorkMax) : choice.message) };
    }
    try {
      return { ok: true, result: yield* this.view(choice.chart) };
    } catch (error) {
      if (error instanceof Refused) return { ok: false, message: this.notice ?? error.notice };
      throw error;
    }
  }

  private *view(chart: Result['chart']): Work<Result> {
    const measures: Measure[] = this.measurePills().map((pill) => {
      const node = this.measureNode(pill);
      return { caption: measureCaption(pill), pill, node, hasTableCalc: hasTableCalc(node) };
    });
    yield* this.rowSteps(null);
    for (const measure of measures) yield* this.ready(measure.node);

    // 7. aggregation
    let { marks, values } = yield* this.aggregation(measures);
    const keepMarks = (keep: boolean[]): void => {
      marks = marks.filter((_, i) => keep[i]);
      values = values.map((column) => column.filter((_, i) => keep[i]));
    };

    // 8. measure filter
    for (const filter of this.filtersAt('measure')) {
      const node = this.measureNode({ field: filter.field, agg: filter.agg ?? 'SUM', table_calc: null });
      const filtered = yield* this.markValues(node, marks, null);
      keepMarks(filtered.map((v) => inRange(v, filter.min, filter.max)));
    }

    // 9. table calculation
    for (const [i, measure] of measures.entries()) {
      if (measure.hasTableCalc) values[i] = yield* this.markValues(measure.node, marks, measure.pill.table_calc);
    }
    const calcFilters: { filter: Filter; values: Cell[] }[] = [];
    for (const filter of this.filtersAt('table_calc')) {
      const pill = { field: filter.field, agg: filter.agg ?? 'SUM', table_calc: filter.table_calc };
      calcFilters.push({ filter, values: yield* this.markValues(this.measureNode(pill), marks, filter.table_calc) });
    }

    // 10. table calculation filter
    const keepCalc = calcFilters.length === 0 ? null : marks.map((_, i) =>
      calcFilters.every(({ filter, values: calculated }) => inRange(calculated[i] ?? null, filter.min, filter.max)),
    );
    if (keepCalc) keepMarks(keepCalc);
    if (marks.length > this.input.limits.markMax) throw new Refused(markNotice(marks.length, this.input.limits.markMax));

    // 11. totals and reference lines
    const types = measures.map((m) => m.node.type);
    const rows = marks.map((mark, i) => [
      ...mark.values.map((v, d) => outputCell(v, this.dims[d]?.type ?? null)),
      ...values.map((column, m) => outputCell(column[i] ?? null, types[m] ?? null)),
    ]);
    const firstValues = (values[0] ?? []).map((v) => (typeof v === 'number' ? v : null));
    return {
      chart,
      columns: [
        ...this.dims.map((d) => ({ name: d.name, role: 'dimension' as const })),
        ...measures.map((m) => ({
          name: m.caption,
          role: 'measure' as const,
          ...(m.node.k === 'tablecalc' && m.node.kind === 'share' ? { share: true as const } : {}),
        })),
      ],
      rows,
      total: this.sheet.totals ? yield* this.totals(marks, measures) : null,
      reference_lines: this.referenceLines(firstValues),
      trend: this.trend(chart, values),
      notices: this.notice === null ? [] : [this.notice],
    };
  }

  private *totals(marks: Mark[], measures: Measure[]): Work<(number | string | null)[]> {
    const rows = marks.flatMap((m) => m.rows);
    const out: (number | string | null)[] = this.dims.map(() => null);
    for (const measure of measures) {
      if (measure.hasTableCalc) {
        out.push('n/a');
        continue;
      }
      const [value] = yield* evalGroups(measure.node, [rows], this, null);
      const cell = outputCell(value ?? null, measure.node.type);
      out.push(typeof cell === 'boolean' ? String(cell) : cell);
    }
    return out;
  }

  private referenceLines(markValues: (number | null)[]): ReferenceValue[] {
    const present = markValues.filter((v): v is number => v !== null);
    const sorted = present.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return this.sheet.reference_lines.map((line): ReferenceValue => {
      let value: Cell = null;
      if (line.type === 'average') value = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
      if (line.type === 'median' && sorted.length > 0) {
        value = sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
      }
      if (line.type === 'constant') value = line.value ?? (line.parameter === null ? null : this.param(line.parameter));
      const cell = typeof value === 'number' ? outputCell(value, 'number') : null;
      return { type: line.type, value: typeof cell === 'number' ? cell : null };
    });
  }

  /** Least squares: on a line x is the mark index, on a scatter the Columns measure; y is the Rows measure. */
  private trend(chart: Result['chart'], values: Cell[][]): Result['trend'] {
    if (!this.sheet.trend || (chart !== 'line' && chart !== 'scatter')) return null;
    const ys = values[0] ?? [];
    const xs = chart === 'scatter' ? (values[1] ?? []) : ys.map((_, i) => i);
    const points = ys.flatMap((y, i) => {
      const x = xs[i];
      return typeof x === 'number' && typeof y === 'number' ? [{ x, y }] : [];
    });
    if (points.length === 0) return null;
    const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const my = points.reduce((s, p) => s + p.y, 0) / points.length;
    const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (sxx === 0) return null;
    const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
    return { slope: Number(outputCell(slope, 'number')), intercept: Number(outputCell(my - slope * mx, 'number')) };
  }

  *members(field: string, step: FilterStep): Work<Cell[]> {
    yield* this.rowSteps(step);
    const source = this.source(field);
    yield* this.ready(source.node);
    const { value, type } = this.rowValue(source, null);
    const seen = new Map<string, Cell>();
    for (let i = 0; i < this.rows.length; i++) {
      const v = value(this.rows[i] ?? 0);
      const key = cellKey(v, type);
      if (!seen.has(key)) seen.set(key, v);
    }
    return [...seen.values()].sort((a, b) => compareCells(a, b)).map((v) => outputCell(v, type));
  }
}

export async function runQuery(input: QueryInput): Promise<QueryOutcome> {
  const query = new Query(input);
  try {
    return await runTimed(query.run(), input.limits.queryBudgetMs);
  } catch (error) {
    if (error instanceof OverBudget) return { ok: false, message: query.notice ?? timeNotice(input.limits.queryBudgetMs) };
    throw error;
  }
}

/** A query run to the end at once, without the time budget: only for the bundled sample. */
export function runQueryNow(input: QueryInput): QueryOutcome {
  return runNow(new Query(input).run());
}

/** The field's members from rows that pass every step before `step`, the request's filters included. */
export async function listMembers(input: QueryInput, field: string, step: FilterStep): Promise<Cell[]> {
  try {
    return await runTimed(new Query(input).members(field, step), input.limits.queryBudgetMs);
  } catch (error) {
    if (error instanceof OverBudget) return [];
    throw error;
  }
}
