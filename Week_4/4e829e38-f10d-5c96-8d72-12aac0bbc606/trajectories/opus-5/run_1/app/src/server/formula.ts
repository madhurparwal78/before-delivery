import { addDays, diffDays } from './clock.js';
import { config } from './config.js';

export type ErrorResult = '#DIV/0' | '#VALUE' | '#REF' | '#BUDGET';

export type Val =
  | { k: 'num'; n: number }
  | { k: 'str'; s: string }
  | { k: 'date'; d: string }
  | { k: 'bool'; b: boolean }
  | { k: 'blank' }
  | { k: 'err'; e: ErrorResult };

export const BLANK: Val = { k: 'blank' };

export class FormulaError extends Error {
  constructor(
    readonly position: number,
    readonly detail: string,
  ) {
    super(`Formula error at character ${position}: ${detail}`);
  }
}

type Node =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'ref'; name: string; pos: number }
  | { t: 'neg'; a: Node; pos: number }
  | { t: 'bin'; op: BinOp; a: Node; b: Node; pos: number }
  | { t: 'call'; name: FnName; args: Node[]; pos: number };

type BinOp = '+' | '-' | '*' | '/' | '>' | '<' | '>=' | '<=' | '=' | '!=';

const FUNCTIONS = {
  ROUND: 2,
  IF: 3,
  ISBLANK: 1,
  DAYS: 2,
  CONCAT: -1,
} as const;
type FnName = keyof typeof FUNCTIONS;

interface Token {
  kind: 'num' | 'str' | 'ref' | 'ident' | 'op' | 'punct' | 'end';
  text: string;
  pos: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    const pos = i + 1;
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      if (src[j] === '.') {
        j += 1;
        while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      }
      tokens.push({ kind: 'num', text: src.slice(i, j), pos });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += 1;
      if (j >= src.length) throw new FormulaError(pos, 'unexpected character "');
      tokens.push({ kind: 'str', text: src.slice(i + 1, j), pos });
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      let j = i + 1;
      while (j < src.length && src[j] !== '}') j += 1;
      if (j >= src.length) throw new FormulaError(src.length + 1, 'expected }');
      tokens.push({ kind: 'ref', text: src.slice(i + 1, j), pos });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ kind: 'ident', text: src.slice(i, j), pos });
      i = j;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '!') {
      if (src[i + 1] === '=') {
        tokens.push({ kind: 'op', text: src.slice(i, i + 2), pos });
        i += 2;
        continue;
      }
      if (ch === '!') throw new FormulaError(pos, 'unexpected character !');
      tokens.push({ kind: 'op', text: ch, pos });
      i += 1;
      continue;
    }
    if ('+-*/='.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, pos });
      i += 1;
      continue;
    }
    if ('(),'.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, pos });
      i += 1;
      continue;
    }
    throw new FormulaError(pos, `unexpected character ${ch}`);
  }
  tokens.push({ kind: 'end', text: '', pos: src.length + 1 });
  return tokens;
}

export interface FieldInfo {
  id: string;
  name: string;
  type: string;
  formula: string | null;
}

const BUILT_IN_NAMES = ['Start', 'Due', 'Effort'] as const;

class Parser {
  private at = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly known: Set<string>,
  ) {}

  private peek(): Token {
    return this.tokens[this.at];
  }

  private next(): Token {
    return this.tokens[this.at++];
  }

  parse(): Node {
    const node = this.comparison();
    if (this.peek().kind !== 'end') {
      throw new FormulaError(this.peek().pos, 'expected end of formula');
    }
    return node;
  }

  private comparison(): Node {
    let left = this.additive();
    const t = this.peek();
    if (t.kind === 'op' && ['>', '<', '>=', '<=', '=', '!='].includes(t.text)) {
      this.next();
      const right = this.additive();
      left = { t: 'bin', op: t.text as BinOp, a: left, b: right, pos: t.pos };
    }
    return left;
  }

  private additive(): Node {
    let left = this.multiplicative();
    while (true) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.next();
        const right = this.multiplicative();
        left = { t: 'bin', op: t.text, a: left, b: right, pos: t.pos };
        continue;
      }
      return left;
    }
  }

  private multiplicative(): Node {
    let left = this.unary();
    while (true) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        this.next();
        const right = this.unary();
        left = { t: 'bin', op: t.text, a: left, b: right, pos: t.pos };
        continue;
      }
      return left;
    }
  }

  private unary(): Node {
    const t = this.peek();
    if (t.kind === 'op' && t.text === '-') {
      this.next();
      return { t: 'neg', a: this.unary(), pos: t.pos };
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.next();
    if (t.kind === 'num') return { t: 'num', v: Number(t.text), pos: t.pos };
    if (t.kind === 'str') return { t: 'str', v: t.text, pos: t.pos };
    if (t.kind === 'ref') {
      if (!this.known.has(t.text)) {
        throw new FormulaError(t.pos, `unknown field ${t.text}`);
      }
      return { t: 'ref', name: t.text, pos: t.pos };
    }
    if (t.kind === 'punct' && t.text === '(') {
      const inner = this.comparison();
      const close = this.peek();
      if (close.kind === 'punct' && close.text === ')') {
        this.next();
        return inner;
      }
      throw new FormulaError(close.pos, 'expected )');
    }
    if (t.kind === 'ident') {
      if (!(t.text in FUNCTIONS)) {
        throw new FormulaError(t.pos, `unknown function ${t.text}`);
      }
      const name = t.text as FnName;
      const open = this.peek();
      if (!(open.kind === 'punct' && open.text === '(')) {
        throw new FormulaError(open.pos, 'expected a value');
      }
      this.next();
      const args: Node[] = [];
      if (!(this.peek().kind === 'punct' && this.peek().text === ')')) {
        args.push(this.comparison());
        while (this.peek().kind === 'punct' && this.peek().text === ',') {
          this.next();
          args.push(this.comparison());
        }
      }
      const close = this.peek();
      if (!(close.kind === 'punct' && close.text === ')')) {
        throw new FormulaError(close.pos, 'expected )');
      }
      this.next();
      const arity = FUNCTIONS[name];
      if (arity === -1) {
        if (args.length < 1) {
          throw new FormulaError(t.pos, `${name} needs at least 1 argument`);
        }
      } else if (args.length !== arity) {
        throw new FormulaError(
          t.pos,
          `${name} needs ${arity} ${arity === 1 ? 'argument' : 'arguments'}`,
        );
      }
      return { t: 'call', name, args, pos: t.pos };
    }
    throw new FormulaError(t.pos, 'expected a value');
  }
}

function refsOf(node: Node, out: { name: string; pos: number }[]): void {
  if (node.t === 'ref') out.push({ name: node.name, pos: node.pos });
  else if (node.t === 'neg') refsOf(node.a, out);
  else if (node.t === 'bin') {
    refsOf(node.a, out);
    refsOf(node.b, out);
  } else if (node.t === 'call') for (const a of node.args) refsOf(a, out);
}

export interface CompiledFormula {
  source: string;
  root: Node;
}

/**
 * The one place a formula is checked. Refuses with the published message and
 * character position; the caller keeps the old formula on refusal.
 */
export function compileFormula(
  source: string,
  fields: FieldInfo[],
  selfName: string | null,
): CompiledFormula {
  if (source.length > config.formulaMaxChars) {
    throw new FormulaError(
      config.formulaMaxChars + 1,
      `formula is longer than ${config.formulaMaxChars} characters`,
    );
  }
  const known = new Set<string>(BUILT_IN_NAMES);
  for (const f of fields) known.add(f.name);
  const root = new Parser(tokenize(source), known).parse();

  if (selfName !== null) {
    const byName = new Map(fields.map((f) => [f.name, f]));
    const refs: { name: string; pos: number }[] = [];
    refsOf(root, refs);
    refs.sort((a, b) => a.pos - b.pos);
    for (const ref of refs) {
      if (leadsTo(ref.name, selfName, byName, new Set())) {
        throw new FormulaError(ref.pos, `circular reference to ${ref.name}`);
      }
    }
  }
  return { source, root };
}

function leadsTo(
  name: string,
  target: string,
  byName: Map<string, FieldInfo>,
  seen: Set<string>,
): boolean {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const field = byName.get(name);
  if (!field || field.type !== 'formula' || !field.formula) return false;
  let root: Node;
  try {
    const known = new Set<string>(BUILT_IN_NAMES);
    for (const f of byName.values()) known.add(f.name);
    root = new Parser(tokenize(field.formula), known).parse();
  } catch {
    return false;
  }
  const refs: { name: string; pos: number }[] = [];
  refsOf(root, refs);
  return refs.some((r) => leadsTo(r.name, target, byName, seen));
}

class BudgetExceeded extends Error {}

export interface EvalContext {
  start: string | null;
  due: string | null;
  effort: number | null;
  /** Raw stored values keyed by field name. */
  values: Map<string, unknown>;
  fields: FieldInfo[];
}

class Evaluator {
  private steps = 0;
  private readonly byName: Map<string, FieldInfo>;
  private readonly stack = new Set<string>();

  constructor(private readonly ctx: EvalContext) {
    this.byName = new Map(ctx.fields.map((f) => [f.name, f]));
  }

  private step(): void {
    this.steps += 1;
    if (this.steps > config.formulaMaxSteps) throw new BudgetExceeded();
  }

  run(root: Node): Val {
    try {
      return this.eval(root);
    } catch (err) {
      if (err instanceof BudgetExceeded) return { k: 'err', e: '#BUDGET' };
      throw err;
    }
  }

  private eval(node: Node): Val {
    this.step();
    switch (node.t) {
      case 'num':
        return { k: 'num', n: node.v };
      case 'str':
        return { k: 'str', s: node.v };
      case 'ref':
        return this.resolve(node.name);
      case 'neg': {
        const a = this.eval(node.a);
        if (a.k === 'err') return a;
        if (a.k === 'blank') return BLANK;
        if (a.k !== 'num') return { k: 'err', e: '#VALUE' };
        return { k: 'num', n: -a.n };
      }
      case 'bin':
        return this.binary(node);
      case 'call':
        return this.call(node);
    }
  }

  private resolve(name: string): Val {
    if (name === 'Start') return this.ctx.start ? { k: 'date', d: this.ctx.start } : BLANK;
    if (name === 'Due') return this.ctx.due ? { k: 'date', d: this.ctx.due } : BLANK;
    if (name === 'Effort')
      return this.ctx.effort === null ? BLANK : { k: 'num', n: this.ctx.effort };
    const field = this.byName.get(name);
    if (!field) return { k: 'err', e: '#REF' };
    if (field.type === 'formula') {
      if (!field.formula) return BLANK;
      if (this.stack.has(name)) return { k: 'err', e: '#REF' };
      this.stack.add(name);
      try {
        const known = new Set<string>(BUILT_IN_NAMES);
        for (const f of this.ctx.fields) known.add(f.name);
        const root = new Parser(tokenize(field.formula), known).parse();
        return this.eval(root);
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        return { k: 'err', e: '#REF' };
      } finally {
        this.stack.delete(name);
      }
    }
    const raw = this.ctx.values.get(name);
    return storedToVal(raw, field.type);
  }

  private binary(node: Extract<Node, { t: 'bin' }>): Val {
    const a = this.eval(node.a);
    const b = this.eval(node.b);
    if (a.k === 'err') return a;
    if (b.k === 'err') return b;
    const op = node.op;
    if (op === '+' || op === '-') {
      if (a.k === 'date' || b.k === 'date') {
        if (a.k === 'date' && (b.k === 'num' || b.k === 'blank')) {
          const days = b.k === 'num' ? b.n : 0;
          return { k: 'date', d: addDays(a.d, op === '+' ? days : -days) };
        }
        if (op === '+' && b.k === 'date' && (a.k === 'num' || a.k === 'blank')) {
          const days = a.k === 'num' ? a.n : 0;
          return { k: 'date', d: addDays(b.d, days) };
        }
        return { k: 'err', e: '#VALUE' };
      }
      const x = numericOrZero(a);
      const y = numericOrZero(b);
      if (x === null || y === null) return { k: 'err', e: '#VALUE' };
      return { k: 'num', n: op === '+' ? x + y : x - y };
    }
    if (op === '*' || op === '/') {
      if (a.k === 'blank' || b.k === 'blank') return BLANK;
      if (a.k !== 'num' || b.k !== 'num') return { k: 'err', e: '#VALUE' };
      if (op === '/' && b.n === 0) return { k: 'err', e: '#DIV/0' };
      return { k: 'num', n: op === '*' ? a.n * b.n : a.n / b.n };
    }
    if (a.k === 'blank' || b.k === 'blank') return { k: 'bool', b: false };
    const cmp = compare(a, b);
    if (cmp === null) return { k: 'err', e: '#VALUE' };
    switch (op) {
      case '>':
        return { k: 'bool', b: cmp > 0 };
      case '<':
        return { k: 'bool', b: cmp < 0 };
      case '>=':
        return { k: 'bool', b: cmp >= 0 };
      case '<=':
        return { k: 'bool', b: cmp <= 0 };
      case '=':
        return { k: 'bool', b: cmp === 0 };
      default:
        return { k: 'bool', b: cmp !== 0 };
    }
  }

  private call(node: Extract<Node, { t: 'call' }>): Val {
    if (node.name === 'IF') {
      const test = this.eval(node.args[0]);
      if (test.k === 'err') return test;
      return this.eval(truthy(test) ? node.args[1] : node.args[2]);
    }
    const args = node.args.map((a) => this.eval(a));
    const bad = args.find((a) => a.k === 'err');
    if (bad) return bad;
    switch (node.name) {
      case 'ROUND': {
        const [x, n] = args;
        if (x.k === 'blank') return BLANK;
        if (x.k !== 'num' || n.k !== 'num') return { k: 'err', e: '#VALUE' };
        return { k: 'num', n: roundHalfAway(x.n, n.n) };
      }
      case 'ISBLANK': {
        const [x] = args;
        return { k: 'bool', b: x.k === 'blank' || (x.k === 'str' && x.s === '') };
      }
      case 'DAYS': {
        const [from, to] = args;
        if (from.k === 'blank' || to.k === 'blank') return BLANK;
        if (from.k !== 'date' || to.k !== 'date') return { k: 'err', e: '#VALUE' };
        return { k: 'num', n: diffDays(from.d, to.d) };
      }
      case 'CONCAT':
        return { k: 'str', s: args.map((a) => textOf(a)).join('') };
    }
  }
}

function numericOrZero(v: Val): number | null {
  if (v.k === 'num') return v.n;
  if (v.k === 'blank') return 0;
  return null;
}

function compare(a: Val, b: Val): number | null {
  if (a.k === 'num' && b.k === 'num') return a.n === b.n ? 0 : a.n < b.n ? -1 : 1;
  if (a.k === 'date' && b.k === 'date') return a.d === b.d ? 0 : a.d < b.d ? -1 : 1;
  if (a.k === 'str' && b.k === 'str') return a.s === b.s ? 0 : a.s < b.s ? -1 : 1;
  if (a.k === 'bool' && b.k === 'bool') return a.b === b.b ? 0 : a.b ? 1 : -1;
  return null;
}

function truthy(v: Val): boolean {
  switch (v.k) {
    case 'bool':
      return v.b;
    case 'blank':
      return false;
    case 'num':
      return v.n !== 0;
    case 'str':
      return v.s !== '';
    case 'date':
      return true;
    case 'err':
      return false;
  }
}

export function roundHalfAway(x: number, digits: number): number {
  const factor = Math.pow(10, Math.trunc(digits));
  const scaled = x * factor;
  const nudged = Number(scaled.toPrecision(12));
  const rounded = nudged < 0 ? -Math.round(-nudged) : Math.round(nudged);
  return rounded / factor;
}

export function formatNumber(n: number): string {
  const rounded = Math.round(n * 1e10) / 1e10;
  if (Number.isInteger(rounded)) return String(rounded === 0 ? 0 : rounded);
  let text = rounded.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  return text;
}

function textOf(v: Val): string {
  switch (v.k) {
    case 'num':
      return formatNumber(v.n);
    case 'str':
      return v.s;
    case 'date':
      return v.d;
    case 'bool':
      return v.b ? 'true' : 'false';
    case 'blank':
      return '';
    case 'err':
      return v.e;
  }
}

export function storedToVal(raw: unknown, type: string): Val {
  if (raw === null || raw === undefined || raw === '') return BLANK;
  if (type === 'number') return typeof raw === 'number' ? { k: 'num', n: raw } : { k: 'err', e: '#VALUE' };
  if (type === 'date') return { k: 'date', d: String(raw) };
  if (type === 'multi_select') {
    const list = Array.isArray(raw) ? raw.map(String) : [];
    return list.length === 0 ? BLANK : { k: 'str', s: list.join(', ') };
  }
  if (typeof raw === 'boolean') return { k: 'bool', b: raw };
  return { k: 'str', s: String(raw) };
}

/** The JSON shape a formula result takes in a task's `values`. */
export function valToJson(v: Val): number | string | boolean | null {
  switch (v.k) {
    case 'num':
      return Math.round(v.n * 1e10) / 1e10;
    case 'str':
      return v.s;
    case 'date':
      return v.d;
    case 'bool':
      return v.b;
    case 'blank':
      return null;
    case 'err':
      return v.e;
  }
}

export function evaluateFormula(compiled: CompiledFormula, ctx: EvalContext): Val {
  return new Evaluator(ctx).run(compiled.root);
}

export function evaluateSource(
  source: string,
  ctx: EvalContext,
): number | string | boolean | null {
  let compiled: CompiledFormula;
  try {
    const known = new Set<string>(BUILT_IN_NAMES);
    for (const f of ctx.fields) known.add(f.name);
    compiled = { source, root: new Parser(tokenize(source), known).parse() };
  } catch {
    return '#REF';
  }
  return valToJson(evaluateFormula(compiled, ctx));
}
