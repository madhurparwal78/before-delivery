import type { FieldKind, FieldType } from './types.js';
import {
  type Ast,
  type Pos,
  type ValueType,
  FUNCTIONS,
  hasAggregate,
  parseFormula,
} from './formula.js';

export interface CheckEnv {
  fields: { name: string; type: FieldType; kind: FieldKind }[];
  calcs: { name: string; formula: string }[];
  parameters: { name: string; type: 'number' | 'text' | 'list' }[];
  sets: { name: string }[];
  maxChars: number;
  maxDepth: number;
}

export type CheckResult =
  | { valid: true; type: FieldType; aggregate: boolean; ast: Ast }
  | { valid: false; message: string; line: number | null; column: number | null };

interface Issue {
  phase: number;
  pos: Pos | null;
  message: string;
}

interface Ctx {
  insideAggregate: boolean;
  insideLod: boolean;
  contextHasAggregate: boolean;
}

interface Typed {
  type: ValueType;
  aggregate: boolean;
}

function typeWord(t: ValueType): string {
  return t === 'null' || t === 'unknown' ? 'null' : t;
}

class Analyzer {
  issues: Issue[] = [];

  constructor(
    private readonly env: CheckEnv,
    private readonly stack: string[] = [],
  ) {}

  private add(phase: number, pos: Pos | null, message: string): void {
    const text = pos === null ? message : `Line ${pos.line}, column ${pos.column}: ${message}`;
    this.issues.push({ phase, pos, message: text });
  }

  private field(name: string): { name: string; type: FieldType; kind: FieldKind } | undefined {
    return this.env.fields.find((f) => f.name === name);
  }

  private calc(name: string): { name: string; formula: string } | undefined {
    return this.env.calcs.find((c) => c.name === name);
  }

  calcType(name: string): Typed {
    if (this.stack.includes(name)) return { type: 'unknown', aggregate: false };
    const calc = this.calc(name);
    if (calc === undefined) return { type: 'unknown', aggregate: false };
    const parsed = parseFormula(calc.formula, this.env.maxDepth);
    if (parsed.ast === null) return { type: 'unknown', aggregate: false };
    const sub = new Analyzer(this.env, [...this.stack, name]);
    return sub.infer(parsed.ast, {
      insideAggregate: false,
      insideLod: false,
      contextHasAggregate: sub.formulaAggregate(parsed.ast),
    });
  }

  /** Whether an expression is aggregate-valued, following calculation references in place. */
  formulaAggregate(ast: Ast): boolean {
    if (hasAggregate(ast)) return true;
    let found = false;
    const visit = (n: Ast): void => {
      if (found) return;
      if (n.k === 'ref' && this.field(n.name) === undefined && this.calc(n.name) !== undefined) {
        if (this.calcType(n.name).aggregate) found = true;
      }
      switch (n.k) {
        case 'unary':
          visit(n.arg);
          break;
        case 'bin':
          visit(n.l);
          visit(n.r);
          break;
        case 'call':
          n.args.forEach(visit);
          break;
        case 'lod':
          break;
        default:
          break;
      }
    };
    visit(ast);
    return found;
  }

  infer(node: Ast, ctx: Ctx): Typed {
    switch (node.k) {
      case 'num':
        return { type: 'number', aggregate: false };
      case 'str':
        return { type: 'text', aggregate: false };
      case 'bool':
        return { type: 'boolean', aggregate: false };
      case 'null':
        return { type: 'null', aggregate: false };
      case 'param': {
        const p = this.env.parameters.find((x) => x.name === node.name);
        if (p === undefined) {
          this.add(4, node.pos, `unknown parameter "${node.name}".`);
          return { type: 'unknown', aggregate: false };
        }
        return { type: p.type === 'number' ? 'number' : 'text', aggregate: false };
      }
      case 'ref': {
        const f = this.field(node.name);
        if (f !== undefined) {
          if (ctx.contextHasAggregate && !ctx.insideAggregate) {
            this.add(7, node.pos, 'cannot mix aggregate and row values.');
          }
          return { type: f.type, aggregate: false };
        }
        const c = this.calc(node.name);
        if (c !== undefined) {
          const inner = this.calcType(node.name);
          if (inner.aggregate && ctx.insideAggregate) {
            this.add(7, node.pos, 'cannot mix aggregate and row values.');
          } else if (!inner.aggregate && ctx.contextHasAggregate && !ctx.insideAggregate) {
            this.add(7, node.pos, 'cannot mix aggregate and row values.');
          }
          return inner;
        }
        if (this.env.sets.some((s) => s.name === node.name)) {
          if (ctx.contextHasAggregate && !ctx.insideAggregate) {
            this.add(7, node.pos, 'cannot mix aggregate and row values.');
          }
          return { type: 'boolean', aggregate: false };
        }
        this.add(4, node.pos, `unknown field "${node.name}".`);
        return { type: 'unknown', aggregate: false };
      }
      case 'unary': {
        const arg = this.infer(node.arg, ctx);
        const want: ValueType = node.op === '-' ? 'number' : 'boolean';
        this.expect(node.op, 1, want, arg.type, node.arg.pos);
        return { type: want, aggregate: arg.aggregate };
      }
      case 'bin': {
        const l = this.infer(node.l, ctx);
        const r = this.infer(node.r, ctx);
        const aggregate = l.aggregate || r.aggregate;
        if (['OR', 'AND'].includes(node.op)) {
          this.expect(node.op, 1, 'boolean', l.type, node.l.pos);
          this.expect(node.op, 2, 'boolean', r.type, node.r.pos);
          return { type: 'boolean', aggregate };
        }
        if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) {
          const lt = l.type;
          const rt = r.type;
          if (lt !== 'null' && lt !== 'unknown' && rt !== 'null' && rt !== 'unknown' && lt !== rt) {
            this.add(6, node.r.pos, `cannot compare ${lt} with ${rt}.`);
          }
          return { type: 'boolean', aggregate };
        }
        if (node.op === '&') {
          this.expect('&', 1, 'text', l.type, node.l.pos);
          this.expect('&', 2, 'text', r.type, node.r.pos);
          return { type: 'text', aggregate };
        }
        this.expect(node.op, 1, 'number', l.type, node.l.pos);
        this.expect(node.op, 2, 'number', r.type, node.r.pos);
        return { type: 'number', aggregate };
      }
      case 'call': {
        const sig = FUNCTIONS[node.name];
        if (sig === undefined) {
          this.add(4, node.pos, `unknown function "${node.name}".`);
          node.args.forEach((a) => this.infer(a, ctx));
          return { type: 'unknown', aggregate: false };
        }
        if (sig.aggregate === true && ctx.insideAggregate) {
          this.add(7, node.pos, 'cannot mix aggregate and row values.');
        }
        if (sig.tableCalc === true && ctx.insideLod) {
          this.add(8, node.pos, 'a table calculation cannot appear inside a level-of-detail expression.');
        }
        const argCtx: Ctx = {
          ...ctx,
          insideAggregate: ctx.insideAggregate || sig.aggregate === true,
        };
        const types = node.args.map((a) => this.infer(a, argCtx));
        if (node.args.length !== sig.args.length) {
          this.add(5, node.pos, `${node.name} expects ${sig.args.length} arguments, found ${node.args.length}.`);
          return { type: sig.result === 'unknown' ? 'unknown' : sig.result, aggregate: sig.aggregate === true };
        }
        sig.args.forEach((want, i) => {
          if (want !== 'unknown') this.expect(node.name, i + 1, want, types[i].type, node.args[i].pos);
        });
        if (sig.tableCalc === true && !types[0].aggregate) {
          this.add(7, node.args[0].pos, 'cannot mix aggregate and row values.');
        }
        let result: ValueType = sig.result;
        if (sig.matchArgs !== undefined) {
          const [a, b] = sig.matchArgs;
          const ta = types[a].type;
          const tb = types[b].type;
          if (ta !== 'null' && ta !== 'unknown' && tb !== 'null' && tb !== 'unknown' && ta !== tb) {
            this.add(6, node.args[b].pos, `${node.name} argument ${b + 1} must be ${ta}, found ${tb}.`);
          }
          result = ta !== 'null' && ta !== 'unknown' ? ta : tb;
        }
        const aggregate =
          sig.aggregate === true || sig.tableCalc === true || types.some((t) => t.aggregate);
        return { type: result, aggregate };
      }
      case 'lod': {
        if (ctx.insideLod) {
          this.add(8, node.pos, 'a level-of-detail expression cannot contain another.');
        }
        node.dims.forEach((dim, i) => {
          const t = this.infer(dim, { ...ctx, insideAggregate: true, insideLod: true });
          const ok = dim.k === 'ref' && this.field(dim.name)?.kind === 'dimension';
          if (!ok) {
            this.add(6, dim.pos, `${node.scope} argument ${i + 1} must be dimension, found ${typeWord(t.type)}.`);
          }
        });
        const bodyAggregate = this.formulaAggregate(node.agg);
        const body = this.infer(node.agg, {
          insideAggregate: false,
          insideLod: true,
          contextHasAggregate: bodyAggregate,
        });
        if (!bodyAggregate) {
          this.add(7, node.agg.pos, 'cannot mix aggregate and row values.');
        }
        return { type: body.type, aggregate: false };
      }
      default:
        return { type: 'unknown', aggregate: false };
    }
  }

  private expect(fn: string, index: number, want: ValueType, got: ValueType, pos: Pos): void {
    if (got === 'null' || got === 'unknown' || got === want) return;
    this.add(6, pos, `${fn} argument ${index} must be ${want}, found ${got}.`);
  }

  first(): Issue | null {
    if (this.issues.length === 0) return null;
    return [...this.issues].sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      const al = a.pos?.line ?? 0;
      const bl = b.pos?.line ?? 0;
      if (al !== bl) return al - bl;
      return (a.pos?.column ?? 0) - (b.pos?.column ?? 0);
    })[0];
  }
}

export function checkFormula(formula: string, env: CheckEnv): CheckResult {
  if (formula.length > env.maxChars) {
    return {
      valid: false,
      message: `Formula is ${formula.length} characters. The limit is ${env.maxChars}.`,
      line: null,
      column: null,
    };
  }
  const parsed = parseFormula(formula, env.maxDepth);
  if (parsed.error !== null) {
    return { valid: false, message: parsed.error.message, line: parsed.error.line, column: parsed.error.column };
  }
  if (parsed.depthError !== null) {
    return {
      valid: false,
      message: parsed.depthError.message,
      line: parsed.depthError.line,
      column: parsed.depthError.column,
    };
  }
  const ast = parsed.ast as Ast;
  const analyzer = new Analyzer(env);
  const top = analyzer.infer(ast, {
    insideAggregate: false,
    insideLod: false,
    contextHasAggregate: analyzer.formulaAggregate(ast),
  });
  const issue = analyzer.first();
  if (issue !== null) {
    return {
      valid: false,
      message: issue.message,
      line: issue.pos?.line ?? null,
      column: issue.pos?.column ?? null,
    };
  }
  const type: FieldType = top.type === 'null' || top.type === 'unknown' ? 'number' : top.type;
  return { valid: true, type, aggregate: top.aggregate, ast };
}

/** Finds a cycle starting and ending at `name`, following calculation references. */
export function findCycle(name: string, formula: string, env: CheckEnv): string[] | null {
  const byName = new Map(env.calcs.map((c) => [c.name, c.formula]));
  byName.set(name, formula);
  const refs = (src: string): string[] => {
    const parsed = parseFormula(src, env.maxDepth);
    if (parsed.ast === null) return [];
    const out: string[] = [];
    const visit = (n: Ast): void => {
      if (n.k === 'ref' && byName.has(n.name)) out.push(n.name);
      switch (n.k) {
        case 'unary':
          visit(n.arg);
          break;
        case 'bin':
          visit(n.l);
          visit(n.r);
          break;
        case 'call':
          n.args.forEach(visit);
          break;
        case 'lod':
          n.dims.forEach(visit);
          visit(n.agg);
          break;
        default:
          break;
      }
    };
    visit(parsed.ast);
    return out;
  };
  const path: string[] = [];
  const seen = new Set<string>();
  const walkName = (current: string): string[] | null => {
    path.push(current);
    for (const next of refs(byName.get(current) ?? '')) {
      if (next === name) return [...path, name];
      if (!seen.has(next)) {
        seen.add(next);
        const found = walkName(next);
        if (found !== null) return found;
      }
    }
    path.pop();
    return null;
  };
  return walkName(name);
}
