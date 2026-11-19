import { daysBetween } from './dates';

export type CellValue = number | string | boolean | null | string[];
export type EvalValue =
  | { kind: 'number'; n: number }
  | { kind: 'string'; s: string }
  | { kind: 'date'; d: string }
  | { kind: 'bool'; b: boolean }
  | { kind: 'blank' }
  | { kind: 'error'; e: string };

export function valueToCell(v: EvalValue): CellValue {
  switch (v.kind) {
    case 'number': return trimNumber(v.n);
    case 'string': return v.s;
    case 'date': return v.d;
    case 'bool': return v.b;
    case 'blank': return null;
    case 'error': return v.e;
  }
}

export function trimNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(n.toFixed(10));
}

export function fmtNumber(n: number): string {
  const t = trimNumber(n);
  if (Number.isInteger(t)) return String(t);
  let s = t.toFixed(10).replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

export function displayValue(v: EvalValue): string {
  switch (v.kind) {
    case 'blank': return '';
    case 'bool': return v.b ? 'true' : 'false';
    case 'date': return v.d;
    case 'number': return fmtNumber(v.n);
    case 'string': return v.s;
    case 'error': return v.e;
  }
}

export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x - 1e-9) : Math.round(x + 1e-9);
}

export function blankLike(v: EvalValue): boolean {
  if (v.kind === 'blank') return true;
  if (v.kind === 'string') return v.s === '';
  return false;
}

function coerceNum(v: EvalValue): number | null {
  if (v.kind === 'number') return v.n;
  if (v.kind === 'blank') return 0;
  return null;
}

export function toEval(v: CellValue): EvalValue {
  if (v === null || v === undefined) return { kind: 'blank' };
  if (typeof v === 'number') return { kind: 'number', n: v };
  if (typeof v === 'boolean') return { kind: 'bool', b: v };
  if (Array.isArray(v)) return { kind: 'string', s: v.join(', ') };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return { kind: 'date', d: v };
  if (typeof v === 'string' && v !== '') {
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return { kind: 'number', n: Number(v) };
  }
  if (typeof v === 'string') return { kind: 'string', s: v };
  return { kind: 'blank' };
}

function eqVal(a: EvalValue, b: EvalValue): boolean {
  if (a.kind === 'bool' && b.kind === 'bool') return a.b === b.b;
  if (a.kind === 'string' && b.kind === 'string') return a.s === b.s;
  if (a.kind === 'date' && b.kind === 'date') return a.d === b.d;
  const x = coerceNum(a), y = coerceNum(b);
  if (x !== null && y !== null) return x === y;
  return false;
}

export class Steps {
  used = 0;
  constructor(public budget: number) {}
  take(): boolean { this.used++; return this.used <= this.budget; }
}

export interface FieldRefValue { value: CellValue; type: string; }
export interface EvalEnv {
  get: (name: string) => FieldRefValue | undefined;
  steps: Steps;
  evalFormulaRef: (fieldId: string) => EvalValue;
}

export class FormulaError extends Error {
  override readonly message: string;
  constructor(message: string) { super(message); this.message = message; }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'date'; v: string; pos: number }
  | { t: 'ref'; v: string; pos: number }
  | { t: 'ident'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'cmp'; v: string; pos: number }
  | { t: 'punc'; v: string; pos: number };

function errAt(pos: number, msg: string): never { throw new FormulaError(`Formula error at character ${pos}: ${msg}`); }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '{') {
      const close = src.indexOf('}', i + 1);
      if (close === -1) errAt(i + 1, 'expected }');
      toks.push({ t: 'ref', v: src.slice(i + 1, close), pos: i + 1 });
      i = close + 1;
      continue;
    }
    if (/[A-Z]/.test(c)) {
      const m = /^[A-Z]+/.exec(src.slice(i))!;
      toks.push({ t: 'ident', v: m[0], pos: i + 1 });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') { s += src[j]; j++; }
      if (j >= src.length) errAt(src.length + 1, 'expected a value');
      toks.push({ t: 'str', v: s, pos: i + 1 });
      i = j + 1;
      continue;
    }
    if (c === '(') { toks.push({ t: 'punc', v: '(', pos: i + 1 }); i++; continue; }
    if (c === ')') { toks.push({ t: 'punc', v: ')', pos: i + 1 }); i++; continue; }
    if (c === ',') { toks.push({ t: 'punc', v: ',', pos: i + 1 }); i++; continue; }
    if (/[0-9]/.test(c)) {
      const dm = /^\d{4}-\d{2}-\d{2}/.exec(src.slice(i));
      if (dm) { toks.push({ t: 'date', v: dm[0], pos: i + 1 }); i += dm[0].length; continue; }
      const nm = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: Number(nm[0]), pos: i + 1 });
      i += nm[0].length;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') { toks.push({ t: 'op', v: c, pos: i + 1 }); i++; continue; }
    if (c === '>' || c === '<') {
      if (src[i + 1] === '=') { toks.push({ t: 'cmp', v: c + '=', pos: i + 1 }); i += 2; }
      else { toks.push({ t: 'cmp', v: c, pos: i + 1 }); i++; }
      continue;
    }
    if (c === '=') { toks.push({ t: 'cmp', v: '=', pos: i + 1 }); i++; continue; }
    if (c === '!' && src[i + 1] === '=') { toks.push({ t: 'cmp', v: '!=', pos: i + 1 }); i += 2; continue; }
    errAt(i + 1, `unexpected character ${c}`);
  }
  return toks;
}

export interface Node {
  k: 'num' | 'str' | 'date' | 'ref' | 'un' | 'bin' | 'cmp' | 'call';
  v?: number | string;
  name?: string;
  pos?: number;
  fn?: string;
  args?: Node[];
  op?: string;
  left?: Node;
  right?: Node;
}

const FUNCS: Record<string, number> = { ROUND: 2, IF: 3, ISBLANK: 1, DAYS: 2 };

function nodeChildren(n: Node): Node[] {
  const out: Node[] = [];
  if (n.left) out.push(n.left);
  if (n.right) out.push(n.right);
  if (n.args) out.push(...n.args);
  return out;
}

function collectRefs(n: Node, out: { name: string; pos: number }[]): void {
  if (n.k === 'ref') out.push({ name: n.name!, pos: n.pos! });
  for (const c of nodeChildren(n)) collectRefs(c, out);
}

export function formulaReferences(src: string): { name: string; pos: number }[] {
  try {
    const out: { name: string; pos: number }[] = [];
    collectRefs(parse(src), out);
    return out;
  } catch {
    return [];
  }
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const next = (): Tok | undefined => toks[p++];

  function expectValue(): Node {
    const t = peek();
    if (!t) errAt(src.length + 1, 'expected a value');
    switch (t.t) {
      case 'num': next(); return { k: 'num', v: t.v };
      case 'str': next(); return { k: 'str', v: t.v };
      case 'date': next(); return { k: 'date', v: t.v };
      case 'ref': next(); return { k: 'ref', name: t.v, pos: t.pos };
      case 'ident': {
        next();
        const open = peek();
        if (open && open.t === 'punc' && open.v === '(') {
          next();
          if (!(t.v in FUNCS) && t.v !== 'CONCAT') errAt(t.pos, `unknown function ${t.v}`);
          const args: Node[] = [];
          const closeT = peek();
          if (closeT && closeT.t === 'punc' && closeT.v === ')') {
            next();
          } else {
            for (;;) {
              args.push(expectCmp());
              const nt = next();
              if (!nt) errAt(src.length + 1, 'expected )');
              if (nt.t === 'punc' && nt.v === ')') {
                if (t.v !== 'CONCAT' && args.length !== FUNCS[t.v]) {
                  errAt(t.pos, `${t.v} needs ${FUNCS[t.v]} ${FUNCS[t.v] === 1 ? 'argument' : 'arguments'}`);
                }
                break;
              }
              if (!(nt.t === 'punc' && nt.v === ',')) {
                if (t.v !== 'CONCAT' && args.length >= FUNCS[t.v]) {
                  errAt(t.pos, `${t.v} needs ${FUNCS[t.v]} ${FUNCS[t.v] === 1 ? 'argument' : 'arguments'}`);
                }
                errAt(nt.pos, 'expected )');
              }
              if (t.v !== 'CONCAT' && args.length >= FUNCS[t.v]) {
                errAt(t.pos, `${t.v} needs ${FUNCS[t.v]} ${FUNCS[t.v] === 1 ? 'argument' : 'arguments'}`);
              }
            }
          }
          if (t.v === 'CONCAT') {
            if (args.length < 1) errAt(t.pos, 'CONCAT needs at least 1 argument');
          } else if (args.length !== FUNCS[t.v]) {
            errAt(t.pos, `${t.v} needs ${FUNCS[t.v]} ${FUNCS[t.v] === 1 ? 'argument' : 'arguments'}`);
          }
          return { k: 'call', fn: t.v, args };
        }
        errAt(t.pos, `unexpected character ${t.v.charAt(0)}`);
        break;
      }
      case 'punc':
        if (t.v === '(') {
          next();
          const e = expectValue();
          const nt = next();
          if (!nt) errAt(src.length + 1, 'expected )');
          if (!(nt.t === 'punc' && nt.v === ')')) errAt(nt.pos, 'expected )');
          return e;
        }
        errAt(t.pos, 'expected a value');
        break;
      case 'op':
        if (t.v === '-' || t.v === '+') {
          next();
          return { k: 'un', op: t.v, left: expectValue() };
        }
        errAt(t.pos, 'expected a value');
        break;
      default:
        errAt(t.pos, 'expected a value');
    }
  }

  function expectMul(): Node {
    let left = expectValue();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) {
        next();
        left = { k: 'bin', op: t.v, left, right: expectValue() };
      } else return left;
    }
  }

  function expectAdd(): Node {
    let left = expectMul();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        next();
        left = { k: 'bin', op: t.v, left, right: expectMul() };
      } else return left;
    }
  }

  function expectCmp(): Node {
    const left = expectAdd();
    const t = peek();
    if (t && t.t === 'cmp') {
      next();
      return { k: 'cmp', op: t.v, left, right: expectAdd() };
    }
    return left;
  }

  const node = expectCmp();
  if (p < toks.length) errAt(toks[p].pos, 'expected end of formula');
  return node;
}

function shift(d: string, n: number): string {
  const dt = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
  dt.setUTCDate(dt.getUTCDate() + Math.round(n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function cmpDiff(a: EvalValue, b: EvalValue): number | null {
  if (a.kind === 'date' && b.kind === 'date') return daysBetween(b.d, a.d);
  const x = coerceNum(a), y = coerceNum(b);
  if (x === null || y === null) return null;
  return x - y;
}

export function evalNode(n: Node, ctx: EvalEnv): EvalValue {
  if (!ctx.steps.take()) return { kind: 'error', e: '#BUDGET' };
  switch (n.k) {
    case 'num': return { kind: 'number', n: n.v as number };
    case 'str': return { kind: 'string', s: n.v as string };
    case 'date': return { kind: 'date', d: n.v as string };
    case 'ref': {
      const f = ctx.get(n.name!);
      if (!f) return { kind: 'error', e: '#REF' };
      return toEval(f.value);
    }
    case 'un': {
      const v = evalNode(n.left!, ctx);
      if (v.kind === 'error') return v;
      if (v.kind === 'blank') return { kind: 'number', n: 0 };
      if (v.kind === 'number') return { kind: 'number', n: n.op === '-' ? -v.n : v.n };
      return { kind: 'error', e: '#VALUE' };
    }
    case 'bin': {
      const a = evalNode(n.left!, ctx);
      if (a.kind === 'error') return a;
      const b = evalNode(n.right!, ctx);
      if (b.kind === 'error') return b;
      const op = n.op!;
      if (op === '*' || op === '/') {
        if (blankLike(a) || blankLike(b)) return { kind: 'blank' };
        const x = coerceNum(a), y = coerceNum(b);
        if (x === null || y === null) return { kind: 'error', e: '#VALUE' };
        if (op === '/') {
          if (y === 0) return { kind: 'error', e: '#DIV/0' };
          return { kind: 'number', n: x / y };
        }
        return { kind: 'number', n: x * y };
      }
      if (a.kind === 'date' && (b.kind === 'number' || b.kind === 'blank')) {
        return { kind: 'date', d: shift(a.d, b.kind === 'blank' ? 0 : b.n) };
      }
      if (op === '+' && b.kind === 'date' && (a.kind === 'number' || a.kind === 'blank')) {
        return { kind: 'date', d: shift(b.d, a.kind === 'blank' ? 0 : a.n) };
      }
      if (op === '-' && b.kind === 'date' && a.kind === 'date') {
        return { kind: 'number', n: daysBetween(a.d, b.d) };
      }
      if (blankLike(a) && b.kind === 'number') return { kind: 'number', n: op === '+' ? b.n : -b.n };
      if (blankLike(b) && a.kind === 'number') return { kind: 'number', n: a.n };
      if (blankLike(a) && blankLike(b)) return { kind: 'number', n: 0 };
      const x = coerceNum(a), y = coerceNum(b);
      if (x === null || y === null) return { kind: 'error', e: '#VALUE' };
      return { kind: 'number', n: op === '+' ? x + y : x - y };
    }
    case 'cmp': {
      const a = evalNode(n.left!, ctx);
      if (a.kind === 'error') return a;
      const b = evalNode(n.right!, ctx);
      if (b.kind === 'error') return b;
      const op = n.op!;
      if (blankLike(a) || blankLike(b)) return { kind: 'bool', b: false };
      if (op === '=') return { kind: 'bool', b: eqVal(a, b) };
      if (op === '!=') return { kind: 'bool', b: !eqVal(a, b) };
      const diff = cmpDiff(a, b);
      if (diff === null) return { kind: 'error', e: '#VALUE' };
      if (op === '>') return { kind: 'bool', b: diff > 0 };
      if (op === '<') return { kind: 'bool', b: diff < 0 };
      if (op === '>=') return { kind: 'bool', b: diff >= 0 };
      return { kind: 'bool', b: diff <= 0 };
    }
    case 'call': {
      const fn = n.fn!;
      if (fn === 'IF') {
        const test = evalNode(n.args![0], ctx);
        if (test.kind === 'error') return test;
        const truth = !(blankLike(test) || (test.kind === 'bool' && !test.b) || (test.kind === 'number' && test.n === 0));
        return truth ? evalNode(n.args![1], ctx) : evalNode(n.args![2], ctx);
      }
      const args = n.args!.map(a => evalNode(a, ctx));
      for (const a of args) if (a.kind === 'error') return a;
      if (fn === 'ISBLANK') return { kind: 'bool', b: blankLike(args[0]) };
      if (fn === 'ROUND') {
        const x = coerceNum(args[0]), nd = coerceNum(args[1]);
        if (x === null || nd === null) return { kind: 'error', e: '#VALUE' };
        const k = Math.max(0, Math.min(10, roundHalfAway(nd)));
        const m = Math.pow(10, k);
        return { kind: 'number', n: roundHalfAway(x * m) / m };
      }
      if (fn === 'DAYS') {
        if (blankLike(args[0]) || blankLike(args[1])) return { kind: 'blank' };
        if (args[0].kind !== 'date' || args[1].kind !== 'date') return { kind: 'error', e: '#VALUE' };
        return { kind: 'number', n: daysBetween(args[0].d, args[1].d) };
      }
      const s = args.map(a => blankLike(a) ? '' : displayValue(a)).join('');
      return { kind: 'string', s };
    }
  }
}

export interface ResolvedFieldLike { id: string; name: string; type: string; formula: string | null; }

/**
 * Validates a formula for save: length cap, syntax, unknown fields, and circular references.
 */
export function validateFormula(
  src: string,
  maxChars: number,
  selfId: string | null,
  resolveByName: (name: string) => ResolvedFieldLike | undefined,
): string | null {
  if (src.length > maxChars) {
    return `Formula error at character ${maxChars + 1}: formula is longer than ${maxChars} characters`;
  }
  let node: Node;
  try {
    node = parse(src);
  } catch (e) {
    if (e instanceof FormulaError) return e.message;
    return 'Formula error at character 1: expected a value';
  }
  const refs: { name: string; pos: number }[] = [];
  collectRefs(node, refs);
  for (const r of refs) {
    const target = resolveByName(r.name);
    if (!target) return `Formula error at character ${r.pos}: unknown field ${r.name}`;
    if (selfId) {
      if (target.id === selfId) return `Formula error at character ${r.pos}: circular reference to ${target.name}`;
      if (reaches(target, selfId, resolveByName, new Set())) {
        return `Formula error at character ${r.pos}: circular reference to ${target.name}`;
      }
    }
  }
  return null;
}

function reaches(from: ResolvedFieldLike, targetId: string, resolveByName: (name: string) => ResolvedFieldLike | undefined, seen: Set<string>): boolean {
  if (from.id === targetId) return true;
  if (seen.has(from.id)) return false;
  seen.add(from.id);
  if (!from.formula) return false;
  let refs: { name: string }[];
  try { refs = formulaReferences(from.formula); } catch { return false; }
  for (const r of refs) {
    const f = resolveByName(r.name);
    if (!f) continue;
    if (f.id === targetId) return true;
    const inner = new Set<string>();
    seen.forEach(v => inner.add(v));
    if (reaches(f, targetId, resolveByName, inner)) return true;
  }
  return false;
}
