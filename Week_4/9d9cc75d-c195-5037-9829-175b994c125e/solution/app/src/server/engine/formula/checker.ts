// Checks 1 to 8 of the published error order, and the resolved formula when they pass. Within one check the error
// nearest the start of the text is reported. A calculation named in a formula counts in place: its type, its
// aggregation and the expressions inside it are those of its own formula.
import { formatCount } from '../../../shared/display.ts';
import type { Agg, CalculationDef, ParameterDef, SetDef, ValueType } from '../../../shared/model.ts';
import type { DatasetField, FormulaLimits, SheetScope } from '../contract.ts';
import { errorAt, type FormulaError, type Node } from './ast.ts';
import { AGGREGATES, FUNCTIONS, TABLE_CALC_FUNCTIONS, type ArgRule, type StaticType } from './functions.ts';
import type { Pos } from './lexer.ts';
import { parseFormula, type Parsed } from './parser.ts';
import { children, forEachNode, type Analysis, type Level, type LodDim, type RNode } from './resolved.ts';

type Checked = { ok: true; analysis: Analysis } | { ok: false; error: FormulaError };

const PARSE_CACHE_MAX = 500;
const parseCache = new Map<string, Parsed>();

function parseCached(text: string, maxDepth: number): Parsed {
  const key = `${maxDepth}:${text}`;
  const hit = parseCache.get(key);
  if (hit) return hit;
  const parsed = parseFormula(text, maxDepth);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(key, parsed);
  return parsed;
}

const LEVEL_RANK: Record<Level, number> = { const: 0, row: 1, agg: 2 };

interface Walked {
  r: RNode;
  level: Level;
  /** the first row-level field outside every aggregate */
  firstRow: Pos | null;
}

interface Where {
  inAgg: boolean;
  inLod: boolean;
}

interface Problem {
  check: number;
  pos: Pos;
  text: string;
}

function fits(rule: ArgRule, type: StaticType): boolean {
  if (type === null || rule === 'any') return true;
  if (rule === 'orderable') return type !== 'boolean';
  return rule === type;
}

const ruleName = (rule: ArgRule): string => (rule === 'orderable' || rule === 'any' ? 'number' : rule);

/** Resolves the names a sheet's formulas may use, and analyses calculations once each. */
export class Resolver {
  private readonly calcs = new Map<string, CalculationDef>();
  private readonly sets = new Map<string, SetDef>();
  private readonly params = new Map<string, ParameterDef>();
  private readonly analyses = new Map<string, Analysis | null>();
  private readonly visiting = new Set<string>();

  constructor(
    readonly scope: SheetScope,
    readonly limits: FormulaLimits,
  ) {
    for (const calc of scope.calculations) this.calcs.set(calc.name, calc);
    for (const set of scope.sets) this.sets.set(set.name, set);
    for (const param of scope.parameters) this.params.set(param.name, param);
  }

  field(name: string): DatasetField | undefined {
    return this.scope.dataset.byName.get(name);
  }

  calc(name: string): CalculationDef | undefined {
    return this.field(name) ? undefined : this.calcs.get(name);
  }

  set(name: string): SetDef | undefined {
    return this.field(name) || this.calcs.has(name) ? undefined : this.sets.get(name);
  }

  param(name: string): ParameterDef | undefined {
    return this.params.get(name);
  }

  /** A calculation's analysis; null when its formula has an error or it names itself through others. */
  calcAnalysis(name: string): Analysis | null {
    const known = this.analyses.get(name);
    if (known !== undefined) return known;
    const calc = this.calcs.get(name);
    if (!calc || this.visiting.has(name)) return null;
    this.visiting.add(name);
    const checked = this.check(calc.formula);
    this.visiting.delete(name);
    const analysis = checked.ok ? checked.analysis : null;
    this.analyses.set(name, analysis);
    return analysis;
  }

  check(text: string): Checked {
    const max = this.limits.formulaMaxChars;
    if (text.length > max) {
      return {
        ok: false,
        error: { message: `Formula is ${formatCount(text.length)} characters. The limit is ${formatCount(max)}.`, line: null, column: null },
      };
    }
    const parsed = parseCached(text, this.limits.formulaMaxDepth);
    if (!parsed.ok) return parsed;
    return new Checker(this).run(parsed.node);
  }
}

class Checker {
  private readonly problems: Problem[] = [];

  constructor(private readonly names: Resolver) {}

  run(node: Node): Checked {
    const top = this.walk(node, { inAgg: false, inLod: false });
    this.context(top, true);
    if (this.problems.length > 0) {
      const first = this.problems.reduce((best, p) =>
        p.check < best.check ||
        (p.check === best.check && (p.pos.line < best.pos.line || (p.pos.line === best.pos.line && p.pos.column < best.pos.column)))
          ? p
          : best,
      );
      return { ok: false, error: errorAt(first.pos, first.text) };
    }
    let hasLod = false;
    let hasTableCalc = false;
    forEachNode(top.r, (n) => {
      if (n.k === 'lod') hasLod = true;
      if (n.k === 'tablecalc') hasTableCalc = true;
    });
    return { ok: true, analysis: { root: top.r, level: top.level, hasLod, hasTableCalc } };
  }

  private report(check: number, pos: Pos, text: string): void {
    this.problems.push({ check, pos, text });
  }

  /**
   * A formula that has an aggregate may not hold a row value outside it. A level-of-detail body (`rowAllowed` false)
   * must aggregate whatever row values it reads.
   */
  private context(walked: Walked, rowAllowed: boolean): void {
    if (walked.firstRow && (walked.level === 'agg' || !rowAllowed)) this.mixed(walked.firstRow);
  }

  private mixed(pos: Pos): void {
    this.report(7, pos, 'cannot mix aggregate and row values.');
  }

  private argType(fn: string, index: number, rule: ArgRule, arg: Node, type: StaticType): void {
    if (!fits(rule, type) && type !== null) {
      this.report(6, arg.start, `${fn} argument ${index + 1} must be ${ruleName(rule)}, found ${type}.`);
    }
  }

  private walk(node: Node, where: Where): Walked {
    switch (node.type) {
      case 'number':
      case 'string':
      case 'boolean': {
        const type = node.type === 'string' ? 'text' : node.type;
        return { r: { k: 'const', value: node.value, type }, level: 'const', firstRow: null };
      }
      case 'null':
        return { r: { k: 'const', value: null, type: null }, level: 'const', firstRow: null };
      case 'field':
        return this.name(node.name, node.pos, where);
      case 'param': {
        const param = this.names.param(node.name);
        if (!param) this.report(4, node.pos, `unknown parameter "${node.name}".`);
        const type = param?.type === 'number' ? 'number' : 'text';
        return { r: { k: 'param', name: node.name, type: param ? type : null }, level: 'const', firstRow: null };
      }
      case 'unary': {
        const arg = this.walk(node.arg, where);
        const rule = node.op === '-' ? 'number' : 'boolean';
        this.argType(node.op, 0, rule, node.arg, arg.r.type);
        return { r: { k: 'unary', op: node.op, arg: arg.r, type: rule }, level: arg.level, firstRow: arg.firstRow };
      }
      case 'binary': {
        const left = this.walk(node.left, where);
        const right = this.walk(node.right, where);
        const [lt, rt] = [left.r.type, right.r.type];
        let type: ValueType;
        switch (node.op) {
          case 'OR':
          case 'AND':
            type = 'boolean';
            this.argType(node.op, 0, 'boolean', node.left, lt);
            this.argType(node.op, 1, 'boolean', node.right, rt);
            break;
          case '=':
          case '<>':
          case '<':
          case '<=':
          case '>':
          case '>=':
            type = 'boolean';
            if (lt !== null && rt !== null && lt !== rt) this.report(6, node.pos, `cannot compare ${lt} with ${rt}.`);
            break;
          case '&':
            type = 'text';
            this.argType(node.op, 0, 'text', node.left, lt);
            this.argType(node.op, 1, 'text', node.right, rt);
            break;
          default:
            type = 'number';
            this.argType(node.op, 0, 'number', node.left, lt);
            this.argType(node.op, 1, 'number', node.right, rt);
        }
        return {
          r: { k: 'binary', op: node.op, left: left.r, right: right.r, type },
          level: LEVEL_RANK[left.level] >= LEVEL_RANK[right.level] ? left.level : right.level,
          firstRow: left.firstRow ?? right.firstRow,
        };
      }
      case 'call':
        return this.call(node, where);
      case 'lod':
        return this.lod(node, where);
    }
  }

  private name(name: string, pos: Pos, where: Where): Walked {
    const field = this.names.field(name);
    if (field) return { r: { k: 'field', field, type: field.type }, level: 'row', firstRow: pos };
    if (this.names.calc(name)) {
      const analysis = this.names.calcAnalysis(name);
      if (!analysis) return { r: { k: 'const', value: null, type: null }, level: 'const', firstRow: null };
      if (where.inAgg && analysis.level === 'agg') this.mixed(pos);
      if (where.inLod && analysis.hasLod) this.report(8, pos, 'a level-of-detail expression cannot contain another.');
      if (where.inLod && analysis.hasTableCalc) {
        this.report(8, pos, 'a table calculation cannot appear inside a level-of-detail expression.');
      }
      return { r: analysis.root, level: analysis.level, firstRow: analysis.level === 'row' ? pos : null };
    }
    const set = this.names.set(name);
    if (set) return { r: { k: 'set', set, type: 'boolean' }, level: 'row', firstRow: pos };
    this.report(4, pos, `unknown field "${name}".`);
    return { r: { k: 'const', value: null, type: null }, level: 'const', firstRow: null };
  }

  private call(node: Extract<Node, { type: 'call' }>, where: Where): Walked {
    const spec = FUNCTIONS[node.name];
    const aggregate = AGGREGATES.has(node.name);
    const tableCalc = TABLE_CALC_FUNCTIONS[node.name];
    const inner: Where = aggregate ? { inAgg: true, inLod: where.inLod } : tableCalc ? { inAgg: false, inLod: where.inLod } : where;
    const args = node.args.map((arg) => this.walk(arg, inner));
    if (!spec) {
      this.report(4, node.pos, `unknown function "${node.name}".`);
      return { r: { k: 'const', value: null, type: null }, level: 'const', firstRow: null };
    }
    if (args.length !== spec.args.length) {
      this.report(5, node.pos, `${node.name} expects ${spec.args.length} arguments, found ${args.length}.`);
    }
    spec.args.forEach((rule, i) => {
      const arg = node.args[i];
      const walked = args[i];
      if (arg && walked) this.argType(node.name, i, rule, arg, walked.r.type);
    });
    const first = args[0];
    const firstArg = node.args[0];
    if (aggregate || tableCalc) {
      if (where.inAgg) this.mixed(node.pos);
      if (tableCalc && where.inLod) {
        this.report(8, node.pos, 'a table calculation cannot appear inside a level-of-detail expression.');
      }
      if (tableCalc && first && firstArg) {
        if (first.level !== 'agg') this.mixed(firstArg.start);
        else this.context(first, true);
      }
      const argNode: RNode = first?.r ?? { k: 'const', value: null, type: null };
      const r: RNode = tableCalc
        ? { k: 'tablecalc', kind: tableCalc, arg: argNode, using: null, type: 'number' }
        : { k: 'agg', fn: node.name as Agg, arg: argNode, type: spec.result === 'arg' ? (first?.r.type ?? null) : spec.result };
      return { r, level: 'agg', firstRow: null };
    }
    let type: StaticType = spec.result === 'arg' ? null : spec.result;
    if (node.name === 'IF' || node.name === 'IFNULL') {
      const from = node.name === 'IF' ? 1 : 0;
      const a = args[from]?.r.type ?? null;
      const b = args[from + 1]?.r.type ?? null;
      const bNode = node.args[from + 1];
      if (a !== null && b !== null && a !== b && bNode) {
        this.report(6, bNode.start, `${node.name} argument ${from + 2} must be ${a}, found ${b}.`);
      }
      type = a ?? b;
    }
    let level: Level = 'const';
    let firstRow: Pos | null = null;
    for (const arg of args) {
      if (LEVEL_RANK[arg.level] > LEVEL_RANK[level]) level = arg.level;
      firstRow ??= arg.firstRow;
    }
    return { r: { k: 'fn', name: node.name, args: args.map((a) => a.r), type }, level, firstRow };
  }

  private lod(node: Extract<Node, { type: 'lod' }>, where: Where): Walked {
    if (where.inLod) this.report(8, node.pos, 'a level-of-detail expression cannot contain another.');
    const dims: LodDim[] = [];
    node.dims.forEach((dim, i) => {
      const walked = this.name(dim.name, dim.pos, { inAgg: false, inLod: true });
      const field = this.names.field(dim.name);
      const measure = field ? field.kind === 'measure' : walked.level === 'agg';
      if (measure) this.report(6, dim.pos, `${node.form} argument ${i + 1} must be dimension, found measure.`);
      dims.push({ name: dim.name, node: walked.r });
    });
    const body = this.walk(node.body, { inAgg: false, inLod: true });
    this.context(body, false);
    return {
      r: { k: 'lod', form: node.form, dims, body: body.r, type: body.r.type },
      level: 'row',
      firstRow: node.pos,
    };
  }
}

/** The nodes a formula costs per row: all of them without an aggregate, else those inside aggregate arguments. */
export function rowNodes(root: RNode): number {
  let all = 0;
  let insideAggregates = 0;
  let hasAggregate = false;
  const pending: { node: RNode; inside: boolean }[] = [{ node: root, inside: false }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, inside } = next;
    if (node.k !== 'lod') {
      all++;
      if (inside) insideAggregates++;
    }
    if (node.k === 'agg') hasAggregate = true;
    for (const child of children(node)) pending.push({ node: child, inside: inside || node.k === 'agg' });
  }
  return hasAggregate ? insideAggregates : all;
}
