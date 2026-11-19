import { type Ast, FUNCTIONS, hasAggregate, parseFormula, rowLevelNodes, walk } from '../../shared/formula.js';
import type { DrawnChart } from '../../shared/chart.js';
import { isMeasurePill } from '../../shared/chart.js';
import { calcRound, displayNumber } from '../../shared/display.js';
import { normalizeDim, type PlanDim, type PlanMeasure, viewPlan } from '../../shared/viewplan.js';
import type {
  Agg,
  DateLevel,
  FilterSpec,
  MeasurePill,
  ParameterDoc,
  Pill,
  SetDoc,
  SheetSpec,
  TableCalcSpec,
} from '../../shared/types.js';
import { config } from '../config.js';
import type { CellData } from './csv.js';
import {
  aggregateValues,
  compareDescending,
  compareValues,
  type DataRow,
  dateMs,
  evalAggregate,
  evalRow,
  type EvalEnv,
  isoDate,
  keyOf,
  mondayOf,
} from './evaluate.js';
import { entitledRows, fieldByName, isRightField, type LoadedSource } from './source.js';

export class ViewRefused extends Error {
  constructor(public readonly notice: string) {
    super(notice);
  }
}

export interface QueryInput {
  source: LoadedSource;
  sheet: SheetSpec;
  calcs: { name: string; formula: string }[];
  parameters: ParameterDoc[];
  paramOverrides: Record<string, unknown>;
  sets: SetDoc[];
  setOverrides: Record<string, unknown[]>;
  username: string | null;
  extraFilters: FilterSpec[];
  highlight?: { field: string; values: unknown[] } | null;
}

export interface MarkRecord {
  dims: CellData[];
  measures: CellData[];
  rows: DataRow[];
}

interface ServerDim extends PlanDim {
  value: (row: DataRow) => CellData;
  sortValue: (row: DataRow) => CellData;
  sortMode: 'asc' | 'desc' | 'measure';
}

export interface QueryOutput {
  chart: DrawnChart;
  dims: PlanDim[];
  measures: PlanMeasure[];
  marks: MarkRecord[];
  total: (CellData | 'n/a')[] | null;
  referenceLines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
  notices: string[];
  primary: number;
  highlighted: boolean[];
}

function formatDate(v: CellData, level: DateLevel): CellData {
  const ms = dateMs(v);
  if (ms === null) return null;
  const d = new Date(ms);
  switch (level) {
    case 'year':
      return String(d.getUTCFullYear());
    case 'month':
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'week':
      return isoDate(mondayOf(ms));
    default:
      return isoDate(ms);
  }
}

export function dimensionValue(
  source: LoadedSource,
  field: string,
  level: DateLevel | null,
  row: DataRow,
): CellData {
  const raw = field in row ? row[field] : null;
  const f = fieldByName(source, field);
  if (f !== undefined && f.type === 'date') return formatDate(raw, level ?? 'month');
  return raw;
}

export function fieldLookup(
  source: LoadedSource,
  calcs: { name: string; formula: string }[],
  sets: { name: string }[] = [],
): (name: string) => { name: string; type: 'number' | 'text' | 'date' | 'boolean'; kind: 'dimension' | 'measure'; continuous: boolean } | undefined {
  return (name: string) => {
    const f = fieldByName(source, name);
    if (f !== undefined) return { name: f.name, type: f.type, kind: f.kind, continuous: f.continuous };
    if (sets.some((s) => s.name === name)) {
      return { name, type: 'text', kind: 'dimension', continuous: false };
    }
    if (calcs.some((c) => c.name === name)) {
      return { name, type: 'number', kind: 'measure', continuous: true };
    }
    return undefined;
  };
}

export function applyTableCalc(kind: TableCalcSpec['kind'], values: (number | null)[]): (number | null)[] {
  switch (kind) {
    case 'run_total': {
      let acc = 0;
      return values.map((v) => {
        if (v === null) return null;
        acc = calcRound(acc + v);
        return acc;
      });
    }
    case 'prev_diff':
      return values.map((v, i) => {
        if (i === 0) return null;
        const prev = values[i - 1];
        if (v === null || prev === null) return null;
        return calcRound(v - prev);
      });
    case 'share': {
      const sum = values.reduce<number>((a, b) => a + (b ?? 0), 0);
      return values.map((v) => (v === null || sum === 0 ? null : calcRound(v / sum)));
    }
    default: {
      const present = values
        .map((v, i) => ({ v, i }))
        .filter((e): e is { v: number; i: number } => e.v !== null)
        .sort((a, b) => b.v - a.v);
      const ranks = new Array<number | null>(values.length).fill(null);
      let rank = 0;
      let seen = 0;
      let lastValue: number | null = null;
      for (const entry of present) {
        seen += 1;
        if (lastValue === null || entry.v !== lastValue) {
          rank = seen;
          lastValue = entry.v;
        }
        ranks[entry.i] = rank;
      }
      return ranks;
    }
  }
}

function tableCalcNodes(ast: Ast): (Ast & { k: 'call' })[] {
  const out: (Ast & { k: 'call' })[] = [];
  walk(ast, (n) => {
    if (n.k === 'call' && FUNCTIONS[n.name]?.tableCalc === true) out.push(n);
  });
  return out;
}

function lodNodes(ast: Ast): (Ast & { k: 'lod' })[] {
  const out: (Ast & { k: 'lod' })[] = [];
  walk(ast, (n) => {
    if (n.k === 'lod') out.push(n);
  });
  return out;
}

function resolveParameters(parameters: ParameterDoc[], overrides: Record<string, unknown>): Record<string, CellData> {
  const out: Record<string, CellData> = {};
  for (const p of parameters) {
    const given = Object.prototype.hasOwnProperty.call(overrides, p.name) ? overrides[p.name] : p.value;
    out[p.name] = (given ?? null) as CellData;
  }
  return out;
}

export function runQuery(input: QueryInput): QueryOutput {
  const { source, sheet } = input;
  const deadline = Date.now() + config.queryBudgetMs;
  let ticks = 0;
  /** The query time budget: heavy loops stop with the published notice once it passes. */
  const tick = (): void => {
    ticks += 1;
    if ((ticks & 255) === 0 && Date.now() > deadline) {
      throw new ViewRefused(`This view took too long. The limit is ${displayNumber(config.queryBudgetMs / 1000)} seconds.`);
    }
  };
  const notices: string[] = [];
  const filters = [...sheet.filters, ...input.extraFilters];
  const plan = viewPlan(sheet, fieldLookup(source, input.calcs, input.sets));

  const usedFieldNames = new Set<string>();
  const collectPill = (p: Pill | null): void => {
    if (p === null) return;
    usedFieldNames.add(isMeasurePill(p) ? p.field : normalizeDim(p).field);
  };
  sheet.rows.forEach(collectPill);
  sheet.columns.forEach(collectPill);
  sheet.label.forEach(collectPill);
  sheet.detail.forEach(collectPill);
  collectPill(sheet.color);
  collectPill(sheet.size);
  filters.forEach((f) => usedFieldNames.add(f.field));

  const hidden = [...usedFieldNames].find((name) => fieldByName(source, name)?.hidden === true);
  if (hidden !== undefined) notices.push(`${hidden} is hidden.`);

  if (plan.refusal !== null) throw new ViewRefused(plan.refusal);
  const chart = plan.chart;

  const calcAsts = new Map<string, Ast>();
  for (const calc of input.calcs) {
    const parsed = parseFormula(calc.formula, config.formulaMaxDepth);
    if (parsed.ast !== null) calcAsts.set(calc.name, parsed.ast);
  }

  const usedAsts: Ast[] = [];
  const addUsedAst = (name: string): void => {
    const ast = calcAsts.get(name);
    if (ast === undefined || usedAsts.includes(ast)) return;
    usedAsts.push(ast);
    walk(ast, (n) => {
      if (n.k === 'ref' && calcAsts.has(n.name)) addUsedAst(n.name);
    });
  };
  usedFieldNames.forEach(addUsedAst);

  const work = source.rows.length * usedAsts.reduce((sum, ast) => sum + rowLevelNodes(ast), 0);
  if (work > config.queryWorkMax) {
    throw new ViewRefused(`This view needs too much work. The limit is ${config.queryWorkMax} steps.`);
  }

  const parameters = resolveParameters(input.parameters, input.paramOverrides);
  const env: EvalEnv = {
    parameters,
    setMembers: new Map(),
    calcs: calcAsts,
    lodValues: new Map(),
    tableCalcValues: new Map(),
    dedupe: (rows, node) => dedupeForNode(source, rows, node),
  };

  /** A dimension value: a source field, a calculation evaluated per row, or a set's In and Out. */
  const dimAccessor = (field: string, level: DateLevel | null): ((row: DataRow) => CellData) => {
    const ast = calcAsts.get(field);
    if (ast !== undefined) return (row) => evalRow(ast, row, env);
    const set = input.sets.find((s) => s.name === field);
    if (set !== undefined) {
      return (row) => (env.setMembers.get(field)?.keys.has(keyOf(row[set.field] ?? null)) === true ? 'In' : 'Out');
    }
    return (row) => dimensionValue(source, field, level, row);
  };

  const dims: ServerDim[] = plan.dims.map((d) => {
    const f = fieldByName(source, d.field);
    const sortKey = f?.sortKeyColumn ?? null;
    const value = dimAccessor(d.field, d.level);
    return {
      ...d,
      value,
      sortValue: sortKey === null ? value : (row: DataRow) => (sortKey in row ? row[sortKey] : null),
      sortMode: sheet.sort[d.field] ?? 'asc',
    };
  });

  const filterPasses = (filter: FilterSpec, row: DataRow): boolean => {
    tick();
    const keys = new Set((filter.values ?? []).map((x) => keyOf(x as CellData)));
    return keys.has(keyOf(dimAccessor(filter.field, filter.level ?? null)(row)));
  };

  // Step 1: row-level security.
  const secured = entitledRows(source, input.username);
  let rows = secured.rows;
  if (secured.secured && rows.length === 0) notices.push('No rows for your account.');

  // Step 2: data source filters.
  const sourceFilters = filters.filter((f) => f.step === 'source');
  rows = rows.filter((row) => sourceFilters.every((f) => filterPasses(f, row)));
  // Step 3: context filters.
  const contextFilters = filters.filter((f) => f.step === 'context');
  rows = rows.filter((row) => contextFilters.every((f) => filterPasses(f, row)));
  const contextRows = rows;

  for (const set of input.sets) {
    const override = input.setOverrides[set.name];
    if (override !== undefined) {
      env.setMembers.set(set.name, { field: set.field, keys: new Set(override.map((v) => keyOf(v as CellData))) });
      continue;
    }
    if (set.top !== null && set.top !== undefined) {
      const n = resolveCount(set.top.n, parameters);
      const members = topMembers(source, contextRows, set.field, set.top.by, n, env);
      env.setMembers.set(set.name, { field: set.field, keys: new Set(members.map(keyOf)) });
    } else {
      env.setMembers.set(set.name, {
        field: set.field,
        keys: new Set((set.members ?? []).map((v) => keyOf(v as CellData))),
      });
    }
  }

  // Step 4: AT expressions and whole-table expressions.
  for (const ast of usedAsts) {
    for (const node of lodNodes(ast)) {
      if (node.scope !== 'AT') continue;
      const dimFields = node.dims.map((d) => (d.k === 'ref' ? d.name : ''));
      env.lodValues.set(
        node,
        groupedLod(contextRows, (row) => dimFields.map((f) => keyOf(row[f] ?? null)).join('\u0001'), node.agg, env, tick),
      );
    }
  }

  // Step 5: dimension filters and top N (one step).
  const dimensionFilters = filters.filter((f) => f.step === 'dimension');
  const topKeep = filters
    .filter((f) => f.step === 'top')
    .map((f) => {
      const n = resolveCount(f.n ?? null, parameters);
      const by = f.by ?? { field: '', agg: 'SUM' as Agg, table_calc: null };
      const members = topMembers(source, contextRows, f.field, by, n, env, dimAccessor(f.field, f.level ?? null));
      return { field: f.field, level: f.level ?? null, keys: new Set(members.map(keyOf)) };
    });
  rows = rows.filter(
    (row) =>
      dimensionFilters.every((f) => filterPasses(f, row)) &&
      topKeep.every((t) => t.keys.has(keyOf(dimAccessor(t.field, t.level)(row)))),
  );

  // Step 6: PLUS and MINUS expressions.
  for (const ast of usedAsts) {
    for (const node of lodNodes(ast)) {
      if (node.scope === 'AT') continue;
      const nodeFields = node.dims.map((d) => (d.k === 'ref' ? d.name : ''));
      const viewDims = node.scope === 'PLUS' ? dims : dims.filter((d) => !nodeFields.includes(d.field));
      const extra = node.scope === 'PLUS' ? nodeFields : [];
      env.lodValues.set(
        node,
        groupedLod(
          rows,
          (row) =>
            [...viewDims.map((d) => keyOf(d.value(row))), ...extra.map((f) => keyOf(row[f] ?? null))].join('\u0001'),
          node.agg,
          env,
          tick,
        ),
      );
    }
  }

  if (chart === 'none') {
    return {
      chart,
      dims: plan.dims,
      measures: plan.measures,
      marks: [],
      total: null,
      referenceLines: [],
      trend: null,
      notices,
      primary: plan.primary,
      highlighted: [],
    };
  }

  // Step 7: aggregation.
  const groups = new Map<string, { dims: CellData[]; sortVals: CellData[]; rows: DataRow[] }>();
  for (const row of rows) {
    tick();
    const values = dims.map((d) => d.value(row));
    const key = values.map(keyOf).join('\u0001');
    let group = groups.get(key);
    if (group === undefined) {
      group = { dims: values, sortVals: dims.map((d) => d.sortValue(row)), rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const measureOrderValues = measureSortValues(source, dims, rows, plan.measures, env, calcAsts);
  const grouped = [...groups.values()].sort((a, b) => {
    for (const index of plan.sortOrder) {
      const dim = dims[index];
      let cmp: number;
      if (dim.sortMode === 'measure') {
        const order = measureOrderValues.get(index);
        cmp = compareDescending(order?.get(keyOf(a.dims[index])) ?? null, order?.get(keyOf(b.dims[index])) ?? null);
        if (cmp === 0) cmp = compareValues(a.sortVals[index], b.sortVals[index]);
      } else {
        cmp = compareValues(a.sortVals[index], b.sortVals[index]);
        if (dim.sortMode === 'desc') cmp = -cmp;
      }
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  let marks: MarkRecord[] = grouped.map((g) => ({ dims: g.dims, measures: [], rows: g.rows }));

  if (marks.length > config.markMax) {
    throw new ViewRefused(
      `This view would draw ${marks.length} marks. The limit is ${config.markMax}. Add a filter or remove a field.`,
    );
  }

  const computeMeasure = (pill: MeasurePill, markRows: DataRow[]): CellData =>
    measureValue(source, pill, markRows, env, calcAsts);

  marks.forEach((mark) => {
    tick();
    mark.measures = plan.measures.map((m) => computeMeasure(m.pill, mark.rows));
  });

  // Step 8: measure filters.
  const measureFilters = filters.filter((f) => f.step === 'measure');
  if (measureFilters.length > 0) {
    marks = marks.filter((mark) =>
      measureFilters.every((f) =>
        inRange(
          computeMeasure({ field: f.field, agg: (f.agg ?? 'SUM') as Agg, table_calc: null }, mark.rows),
          f.min ?? null,
          f.max ?? null,
        ),
      ),
    );
  }

  // Step 9: table calculations.
  plan.measures.forEach((m, index) => {
    const spec = m.pill.table_calc;
    const ast = calcAsts.get(m.pill.field);
    const formulaCalcs = ast === undefined ? [] : tableCalcNodes(ast);
    if (formulaCalcs.length > 0) {
      for (const node of formulaCalcs) {
        const inner = marks.map((mark) => {
          const v = evalAggregate(node.args[0], mark.rows, env);
          return typeof v === 'number' ? v : null;
        });
        const transformed = transformByPartition(
          marks,
          dims,
          spec?.using ?? 'table_across',
          spec?.fields ?? [],
          inner,
          nodeCalcKind(node),
        );
        marks.forEach((mark, i) => markTableCalcValue(mark, node, transformed[i]));
      }
      marks.forEach((mark) => {
        env.tableCalcValues = tableCalcValuesOf(mark);
        mark.measures[index] = computeMeasure(m.pill, mark.rows);
      });
      env.tableCalcValues = new Map();
      return;
    }
    if (spec === null) return;
    const base = marks.map((mark) =>
      typeof mark.measures[index] === 'number' ? (mark.measures[index] as number) : null,
    );
    const transformed = transformByPartition(marks, dims, spec.using, spec.fields, base, spec.kind);
    marks.forEach((mark, i) => {
      mark.measures[index] = transformed[i];
    });
  });

  // Step 10: table calculation filters.
  const calcFilters = filters.filter((f) => f.step === 'table_calc');
  if (calcFilters.length > 0) {
    const keep = marks.map(() => true);
    for (const f of calcFilters) {
      const spec = f.table_calc ?? { kind: 'rank' as const, using: 'table_down' as const, fields: [] };
      const base = marks.map((mark) => {
        const v = computeMeasure({ field: f.field, agg: (f.agg ?? 'SUM') as Agg, table_calc: null }, mark.rows);
        return typeof v === 'number' ? v : null;
      });
      transformByPartition(marks, dims, spec.using, spec.fields, base, spec.kind).forEach((v, i) => {
        if (!inRange(v, f.min ?? null, f.max ?? null)) keep[i] = false;
      });
    }
    marks = marks.filter((_, i) => keep[i]);
  }

  // Step 11: totals and reference lines.
  const allRows = marks.flatMap((m) => m.rows);
  let total: (CellData | 'n/a')[] | null = null;
  if (sheet.totals) {
    total = [
      ...dims.map((_, i) => (i === 0 ? ('Grand total' as CellData) : null)),
      ...plan.measures.map((m) => {
        const ast = calcAsts.get(m.pill.field);
        const hasCalc = m.pill.table_calc !== null || (ast !== undefined && tableCalcNodes(ast).length > 0);
        return hasCalc ? ('n/a' as const) : computeMeasure({ ...m.pill, table_calc: null }, allRows);
      }),
    ];
  }

  const primaryValues = marks.map((mark) =>
    plan.primary >= 0 && typeof mark.measures[plan.primary] === 'number'
      ? (mark.measures[plan.primary] as number)
      : null,
  );
  const referenceLines = sheet.reference_lines.map((line) => ({
    type: line.type === 'average' ? 'Average' : line.type === 'median' ? 'Median' : 'Constant',
    value: referenceValue(line, primaryValues, parameters),
  }));

  const trend = sheet.trend ? trendLine(chart, marks, plan.measures, plan.primary) : null;

  const highlighted = marks.map((mark) => {
    const h = input.highlight;
    if (h === null || h === undefined) return false;
    const index = dims.findIndex((d) => d.field === h.field);
    if (index < 0) return false;
    return h.values.some((v) => keyOf(v as CellData) === keyOf(mark.dims[index]));
  });

  return {
    chart,
    dims: plan.dims,
    measures: plan.measures,
    marks,
    total,
    referenceLines,
    trend,
    notices,
    primary: plan.primary,
    highlighted,
  };
}

const markCalcValues = new WeakMap<MarkRecord, Map<Ast, CellData>>();

function markTableCalcValue(mark: MarkRecord, node: Ast, value: CellData): void {
  let map = markCalcValues.get(mark);
  if (map === undefined) {
    map = new Map();
    markCalcValues.set(mark, map);
  }
  map.set(node, value);
}

function tableCalcValuesOf(mark: MarkRecord): Map<Ast, CellData> {
  return markCalcValues.get(mark) ?? new Map();
}

function nodeCalcKind(node: Ast & { k: 'call' }): TableCalcSpec['kind'] {
  switch (node.name) {
    case 'RUN_TOTAL':
      return 'run_total';
    case 'PREV_DIFF':
      return 'prev_diff';
    case 'SHARE':
      return 'share';
    default:
      return 'rank';
  }
}

function addressedDims(dims: ServerDim[], using: TableCalcSpec['using'], chosen: string[]): number[] {
  const indexesOf = (shelf: string): number[] =>
    dims.map((d, i) => ({ d, i })).filter((e) => e.d.shelf === shelf).map((e) => e.i);
  switch (using) {
    case 'table_across':
      return indexesOf('columns');
    case 'table_down':
      return indexesOf('rows');
    case 'pane_down': {
      const rowsIdx = indexesOf('rows');
      return rowsIdx.length === 0 ? [] : [rowsIdx[rowsIdx.length - 1]];
    }
    default:
      return dims.map((d, i) => ({ d, i })).filter((e) => chosen.includes(e.d.field)).map((e) => e.i);
  }
}

function transformByPartition(
  marks: MarkRecord[],
  dims: ServerDim[],
  using: TableCalcSpec['using'],
  chosen: string[],
  values: (number | null)[],
  kind: TableCalcSpec['kind'],
): (number | null)[] {
  const addressed = addressedDims(dims, using, chosen);
  const partitionIndexes = dims.map((_, i) => i).filter((i) => !addressed.includes(i));
  const partitions = new Map<string, number[]>();
  marks.forEach((mark, i) => {
    const key = partitionIndexes.map((p) => keyOf(mark.dims[p])).join('\u0001');
    const list = partitions.get(key);
    if (list === undefined) partitions.set(key, [i]);
    else list.push(i);
  });
  const out = new Array<number | null>(values.length).fill(null);
  for (const indexes of partitions.values()) {
    const result = applyTableCalc(kind, indexes.map((i) => values[i]));
    indexes.forEach((markIndex, j) => {
      out[markIndex] = result[j];
    });
  }
  return out;
}

function measureSortValues(
  source: LoadedSource,
  dims: ServerDim[],
  rows: DataRow[],
  measures: PlanMeasure[],
  env: EvalEnv,
  calcAsts: Map<string, Ast>,
): Map<number, Map<string, CellData>> {
  const out = new Map<number, Map<string, CellData>>();
  if (measures.length === 0) return out;
  dims.forEach((d, index) => {
    if (d.sortMode !== 'measure') return;
    const byMember = new Map<string, DataRow[]>();
    for (const row of rows) {
      const key = keyOf(d.value(row));
      const list = byMember.get(key);
      if (list === undefined) byMember.set(key, [row]);
      else list.push(row);
    }
    const values = new Map<string, CellData>();
    for (const [key, memberRows] of byMember) {
      values.set(key, measureValue(source, measures[0].pill, memberRows, env, calcAsts));
    }
    out.set(index, values);
  });
  return out;
}

function referenceValue(
  line: { type: string; value: number | null; parameter: string | null },
  values: (number | null)[],
  parameters: Record<string, CellData>,
): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (line.type === 'average') {
    if (present.length === 0) return null;
    return calcRound(present.reduce((a, b) => a + b, 0) / present.length);
  }
  if (line.type === 'median') {
    if (present.length === 0) return null;
    const sorted = [...present].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return calcRound(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  if (line.parameter !== null) {
    const v = parameters[line.parameter];
    return typeof v === 'number' ? v : null;
  }
  return line.value;
}

function trendLine(
  chart: DrawnChart,
  marks: MarkRecord[],
  measures: PlanMeasure[],
  primary: number,
): { slope: number; intercept: number } | null {
  if (primary < 0) return null;
  const columnsMeasure = measures.findIndex((m) => m.shelf === 'columns');
  const points: { x: number; y: number }[] = [];
  marks.forEach((mark, i) => {
    const y = mark.measures[primary];
    if (typeof y !== 'number') return;
    let x: number | null = i;
    if (chart === 'scatter' && columnsMeasure >= 0) {
      const xv = mark.measures[columnsMeasure];
      x = typeof xv === 'number' ? xv : null;
    }
    if (x === null) return;
    points.push({ x, y });
  });
  if (points.length < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const numerator = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const denominator = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (denominator === 0) return null;
  const slope = calcRound(numerator / denominator);
  return { slope, intercept: calcRound(my - slope * mx) };
}

function inRange(v: CellData, min: number | null, max: number | null): boolean {
  if (typeof v !== 'number') return false;
  if (min !== null && v < min) return false;
  if (max !== null && v > max) return false;
  return true;
}

function resolveCount(n: number | string | null, parameters: Record<string, CellData>): number {
  if (typeof n === 'number') return Math.trunc(n);
  if (typeof n === 'string' && n.startsWith('@')) {
    const v = parameters[n.slice(1)];
    return typeof v === 'number' ? Math.trunc(v) : 0;
  }
  return 0;
}

export function measureValue(
  source: LoadedSource,
  pill: MeasurePill,
  rows: DataRow[],
  env: EvalEnv,
  calcAsts: Map<string, Ast>,
): CellData {
  const ast = calcAsts.get(pill.field);
  if (ast !== undefined) {
    if (astIsAggregate(ast, calcAsts)) return evalAggregate(ast, rows, env);
    return aggregateValues(pill.agg, rows.map((r) => evalRow(ast, r, env)));
  }
  const used = isRightField(source, pill.field) ? dedupeByRightKey(rows) : rows;
  return aggregateValues(pill.agg, used.map((r) => (pill.field in r ? r[pill.field] : null)));
}

function astIsAggregate(ast: Ast, calcAsts: Map<string, Ast>, seen = new Set<string>()): boolean {
  if (hasAggregate(ast)) return true;
  let found = false;
  walk(ast, (n) => {
    if (found || n.k !== 'ref') return;
    const inner = calcAsts.get(n.name);
    if (inner === undefined || seen.has(n.name)) return;
    seen.add(n.name);
    if (astIsAggregate(inner, calcAsts, seen)) found = true;
  });
  return found;
}

function dedupeByRightKey(rows: DataRow[]): DataRow[] {
  const seen = new Set<string>();
  const out: DataRow[] = [];
  for (const row of rows) {
    const key = keyOf((row.__rk ?? null) as CellData);
    if (key === '\u0000null') {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function dedupeForNode(source: LoadedSource, rows: DataRow[], node: Ast): DataRow[] {
  const refs: string[] = [];
  walk(node, (n) => {
    if (n.k === 'ref') refs.push(n.name);
  });
  const known = refs.filter((r) => fieldByName(source, r) !== undefined);
  if (known.length === 0) return rows;
  return known.every((r) => isRightField(source, r)) ? dedupeByRightKey(rows) : rows;
}

function groupedLod(
  rows: DataRow[],
  keyFn: (row: DataRow) => string,
  agg: Ast,
  env: EvalEnv,
  onRow?: () => void,
): Map<number, CellData> {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    onRow?.();
    const key = keyFn(row);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [row]);
    else list.push(row);
  }
  const out = new Map<number, CellData>();
  for (const groupRows of groups.values()) {
    const value = evalAggregate(agg, groupRows, env);
    for (const row of groupRows) out.set(row.__i, value);
  }
  return out;
}

function topMembers(
  source: LoadedSource,
  rows: DataRow[],
  field: string,
  by: MeasurePill,
  n: number,
  env: EvalEnv,
  accessor?: (row: DataRow) => CellData,
): CellData[] {
  const read = accessor ?? ((row: DataRow) => dimensionValue(source, field, null, row));
  const groups = new Map<string, { value: CellData; rows: DataRow[] }>();
  for (const row of rows) {
    const v = read(row);
    const key = keyOf(v);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { value: v, rows: [row] });
    else group.rows.push(row);
  }
  const scored = [...groups.values()].map((g) => ({
    member: g.value,
    score: measureValue(source, by, g.rows, env, env.calcs),
  }));
  scored.sort((a, b) => {
    const cmp = compareDescending(a.score, b.score);
    return cmp !== 0 ? cmp : compareValues(a.member, b.member);
  });
  return scored.slice(0, Math.max(0, n)).map((s) => s.member);
}

export function passesValueFilter(source: LoadedSource, filter: FilterSpec, row: DataRow): boolean {
  const keys = new Set((filter.values ?? []).map((x) => keyOf(x as CellData)));
  return keys.has(keyOf(dimensionValue(source, filter.field, filter.level ?? null, row)));
}

export function memberList(input: QueryInput, field: string, step: FilterSpec['step']): CellData[] {
  const { source, sheet } = input;
  const calcAsts = new Map<string, Ast>();
  for (const calc of input.calcs) {
    const parsed = parseFormula(calc.formula, config.formulaMaxDepth);
    if (parsed.ast !== null) calcAsts.set(calc.name, parsed.ast);
  }
  const env: EvalEnv = {
    parameters: resolveParameters(input.parameters, input.paramOverrides),
    setMembers: new Map(),
    calcs: calcAsts,
    lodValues: new Map(),
    tableCalcValues: new Map(),
    dedupe: (rows) => rows,
  };
  const read = (row: DataRow): CellData => {
    const ast = calcAsts.get(field);
    if (ast !== undefined) return evalRow(ast, row, env);
    return dimensionValue(source, field, null, row);
  };
  const filters = [...sheet.filters, ...input.extraFilters];
  const order: Record<FilterSpec['step'], number> = {
    source: 1,
    context: 2,
    dimension: 3,
    top: 3,
    measure: 4,
    table_calc: 5,
  };
  const limit = order[step];
  let rows = entitledRows(source, input.username).rows;
  if (limit > 1) {
    rows = rows.filter((row) =>
      filters.filter((f) => f.step === 'source').every((f) => passesValueFilter(source, f, row)),
    );
  }
  if (limit > 2) {
    rows = rows.filter((row) =>
      filters.filter((f) => f.step === 'context').every((f) => passesValueFilter(source, f, row)),
    );
  }
  if (limit > 3) {
    rows = rows.filter((row) =>
      filters.filter((f) => f.step === 'dimension').every((f) => passesValueFilter(source, f, row)),
    );
  }
  const seen = new Map<string, CellData>();
  for (const row of rows) {
    const v = read(row);
    seen.set(keyOf(v), v);
  }
  return [...seen.values()].sort(compareValues);
}
