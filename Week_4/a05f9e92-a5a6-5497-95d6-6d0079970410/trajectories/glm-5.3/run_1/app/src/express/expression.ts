// The published expression language: tokenizer, parser, interpreter.
// Precedence (low to high): or < and < not < comparison < additive < multiplicative < unary minus < primary.

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'list'; items: Node[] }
  | { kind: 'path'; parts: string[]; column: number }
  | { kind: 'not'; arg: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'cmp'; op: CmpOp; left: Node; right: Node }
  | { kind: 'contains'; left: Node; right: Node }
  | { kind: 'startswith'; left: Node; right: Node }
  | { kind: 'in'; left: Node; right: Node }
  | { kind: 'add'; left: Node; right: Node }
  | { kind: 'sub'; left: Node; right: Node }
  | { kind: 'mul'; left: Node; right: Node }
  | { kind: 'div'; left: Node; right: Node }
  | { kind: 'neg'; arg: Node }
  | { kind: 'call'; name: string; args: Node[]; column: number };

type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export class ExpressionError extends Error {
  constructor(readonly column: number, readonly reason: string) {
    super(`Expression error at column ${column}: ${reason}.`);
    this.name = 'ExpressionError';
  }
}

interface Token { kind: 'num' | 'str' | 'ident' | 'op' | 'eof'; value: string; column: number }

const FUNCTIONS = new Set([
  'changes', 'changes_to', 'changes_from', 'is_empty', 'len', 'lower', 'upper',
  'now', 'me', 'has_role', 'business_days_since',
]);

const CMP_OPS: CmpOp[] = ['=', '!=', '<', '<=', '>', '>='];
const WORD_OPS = ['in', 'contains', 'startswith'];
const MULTI_OPS = ['<=', '>=', '!='];
const SINGLE_OPS = '=<>+-*/(),.[]';

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (isDigit(c)) {
      const start = i;
      while (i < n && (isDigit(text[i]) || text[i] === '.')) i++;
      out.push({ kind: 'num', value: text.slice(start, i), column: start + 1 });
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let value = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n && (text[i + 1] === '"'
                                               || text[i + 1] === '\\')) {
          value += text[i + 1];
          i += 2;
          continue;
        }
        value += text[i];
        i++;
      }
      if (i >= n) throw new ExpressionError(start + 1, 'unexpected "\\""');
      i++;
      out.push({ kind: 'str', value, column: start + 1 });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdent(text[i])) i++;
      out.push({ kind: 'ident', value: text.slice(start, i), column: start + 1 });
      continue;
    }
    const two = text.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      out.push({ kind: 'op', value: two, column: i + 1 });
      i += 2;
      continue;
    }
    if (SINGLE_OPS.includes(c)) {
      out.push({ kind: 'op', value: c, column: i + 1 });
      i++;
      continue;
    }
    throw new ExpressionError(i + 1, `unexpected "${c}"`);
  }
  out.push({ kind: 'eof', value: '', column: n + 1 });
  return out;
}

/** Parse an expression string into an AST. Throws ExpressionError. */
export function parse(text: string): Node {
  const tokens = tokenize(text);
  let pos = 0;

  const peek = (): Token => tokens[pos];
  const advance = (): Token => tokens[pos++];
  const isOp = (v: string): boolean => peek().kind === 'op' && peek().value === v;
  const isWord = (v: string): boolean => peek().kind === 'ident' && peek().value === v;
  const eat = (v: string): boolean => {
    if (isOp(v)) { pos++; return true; }
    return false;
  };
  const expect = (v: string): void => {
    if (!eat(v)) throw new ExpressionError(peek().column, `expected "${v}"`);
  };

  function primary(): Node {
    const t = peek();
    if (t.kind === 'eof') throw new ExpressionError(t.column, 'expected a value');
    if (eat('(')) {
      const inner = or();
      expect(')');
      return inner;
    }
    if (eat('[')) {
      const items: Node[] = [];
      if (!isOp(']')) {
        items.push(or());
        while (eat(',')) items.push(or());
      }
      expect(']');
      return { kind: 'list', items };
    }
    if (t.kind === 'num') {
      advance();
      const value = Number(t.value);
      if (!Number.isFinite(value)) throw new ExpressionError(t.column, `unexpected "${t.value}"`);
      return { kind: 'num', value };
    }
    if (t.kind === 'str') {
      advance();
      return { kind: 'str', value: t.value };
    }
    if (t.kind === 'op' && t.value === '-') {
      advance();
      return { kind: 'neg', arg: unary() };
    }
    if (t.kind === 'ident') {
      advance();
      if (t.value === 'true') return { kind: 'bool', value: true };
      if (t.value === 'false') return { kind: 'bool', value: false };
      if (t.value === 'null') return { kind: 'null' };
      if (isOp('(')) {
        if (!FUNCTIONS.has(t.value)) {
          throw new ExpressionError(t.column, `unknown function "${t.value}"`);
        }
        advance();
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(or());
          while (eat(',')) args.push(or());
        }
        expect(')');
        return { kind: 'call', name: t.value, args, column: t.column };
      }
      if (WORD_OPS.includes(t.value) || t.value === 'and' || t.value === 'or' || t.value === 'not') {
        throw new ExpressionError(t.column, `unexpected "${t.value}"`);
      }
      const parts = [t.value];
      while (isOp('.')) {
        advance();
        const p = advance();
        if (p.kind !== 'ident') throw new ExpressionError(p.column, 'expected a field name');
        parts.push(p.value);
      }
      return { kind: 'path', parts, column: t.column };
    }
    throw new ExpressionError(t.column, 'expected a value');
  }

  function unary(): Node { return primary(); }

  function mul(): Node {
    let node = unary();
    while (isOp('*') || isOp('/')) {
      const op = advance().value;
      node = op === '*' ? { kind: 'mul', left: node, right: unary() } : { kind: 'div', left: node, right: unary() };
    }
    return node;
  }

  function add(): Node {
    let node = mul();
    while (isOp('+') || isOp('-')) {
      const op = advance().value;
      node = op === '+' ? { kind: 'add', left: node, right: mul() } : { kind: 'sub', left: node, right: mul() };
    }
    return node;
  }

  function comparison(): Node {
    let node = add();
    for (;;) {
      const t = peek();
      if (t.kind === 'op' && CMP_OPS.includes(t.value as CmpOp)) {
        advance();
        node = { kind: 'cmp', op: t.value as CmpOp, left: node, right: add() };
        continue;
      }
      if (t.kind === 'ident' && WORD_OPS.includes(t.value)) {
        advance();
        const right = add();
        if (t.value === 'in') node = { kind: 'in', left: node, right };
        else if (t.value === 'contains') node = { kind: 'contains', left: node, right };
        else node = { kind: 'startswith', left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  function not(): Node {
    if (isWord('not')) {
      advance();
      return { kind: 'not', arg: not() };
    }
    return comparison();
  }

  function and(): Node {
    let node = not();
    while (isWord('and')) {
      advance();
      node = { kind: 'and', left: node, right: not() };
    }
    return node;
  }

  function or(): Node {
    let node = and();
    while (isWord('or')) {
      advance();
      node = { kind: 'or', left: node, right: and() };
    }
    return node;
  }

  const tree = or();
  const tail = peek();
  if (tail.kind !== 'eof') throw new ExpressionError(tail.column, `unexpected "${tail.value}"`);
  return tree;
}

/** Serialize an AST back to canonical text. */
export function print(node: Node): string {
  switch (node.kind) {
    case 'num': return String(node.value);
    case 'str': return `"${node.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    case 'bool': return node.value ? 'true' : 'false';
    case 'null': return 'null';
    case 'list': return `[${node.items.map(print).join(', ')}]`;
    case 'path': return node.parts.join('.');
    case 'not': return `not ${print(node.arg)}`;
    case 'and': return `(${print(node.left)} and ${print(node.right)})`;
    case 'or': return `(${print(node.left)} or ${print(node.right)})`;
    case 'cmp': return `(${print(node.left)} ${node.op} ${print(node.right)})`;
    case 'contains': return `(${print(node.left)} contains ${print(node.right)})`;
    case 'startswith': return `(${print(node.left)} startswith ${print(node.right)})`;
    case 'in': return `(${print(node.left)} in ${print(node.right)})`;
    case 'add': return `(${print(node.left)} + ${print(node.right)})`;
    case 'sub': return `(${print(node.left)} - ${print(node.right)})`;
    case 'mul': return `(${print(node.left)} * ${print(node.right)})`;
    case 'div': return `(${print(node.left)} / ${print(node.right)})`;
    case 'neg': return `-${print(node.arg)}`;
    case 'call': return `${node.name}(${node.args.map(print).join(', ')})`;
  }
}

/** Runtime context supplied by the caller for every evaluation. */
export interface Ctx {
  /** Current record fields. */
  rec: Record<string, unknown>;
  /** Record fields before the current save; absent on insert. */
  previous?: Record<string, unknown>;
  /** Server clock, epoch ms. */
  now: number;
  /** Signed-in username. */
  me: string;
  /** Roles of the signed-in user. */
  roles: Set<string>;
  /** Resolves dotted paths such as "caller.department.name" against the record. */
  resolve: (path: string) => unknown;
}

const TYPE_ERR = 'types do not match';
const MISSING = "unknown field";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const la = Array.isArray(a) ? a : [a];
    const lb = Array.isArray(b) ? b : [b];
    if (la.length !== lb.length) return false;
    return la.every((x, i) => eq(x, lb[i]));
  }
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) return false;
  if (ta === 'number' || ta === 'boolean') return a === b;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return null;
}

export function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return true;
}

/** Evaluate an AST against a context. Throws Error on type errors. */
export function evaluate(node: Node, ctx: Ctx): unknown {
  switch (node.kind) {
    case 'num':
    case 'str':
    case 'bool':
      return node.value;
    case 'null': return null;
    case 'list': return node.items.map(item => evaluate(item, ctx));
    case 'path': return ctx.resolve(node.parts.join('.'));
    case 'neg': {
      const v = evaluate(node.arg, ctx);
      if (typeof v !== 'number') throw new Error(TYPE_ERR);
      return -v;
    }
    case 'not': return !truthy(evaluate(node.arg, ctx));
    case 'and': {
      if (!truthy(evaluate(node.left, ctx))) return false;
      return truthy(evaluate(node.right, ctx));
    }
    case 'or': {
      if (truthy(evaluate(node.left, ctx))) return true;
      return truthy(evaluate(node.right, ctx));
    }
    case 'cmp': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (node.op === '=') return eq(l, r);
      if (node.op === '!=') return !eq(l, r);
      const c = compare(l, r);
      if (c === null) throw new Error(TYPE_ERR);
      if (node.op === '<') return c < 0;
      if (node.op === '<=') return c <= 0;
      if (node.op === '>') return c > 0;
      return c >= 0;
    }
    case 'contains': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'string' && typeof r === 'string') {
        return l.toLowerCase().includes(r.toLowerCase());
      }
      if (Array.isArray(l)) return l.some(x => eq(x, r));
      throw new Error(TYPE_ERR);
    }
    case 'startswith': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'string' && typeof r === 'string') {
        return l.toLowerCase().startsWith(r.toLowerCase());
      }
      throw new Error(TYPE_ERR);
    }
    case 'in': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (Array.isArray(r)) return r.some(x => eq(x, l));
      throw new Error(TYPE_ERR);
    }
    case 'add': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      throw new Error(TYPE_ERR);
    }
    case 'sub': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'number' && typeof r === 'number') return l - r;
      throw new Error(TYPE_ERR);
    }
    case 'mul': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'number' && typeof r === 'number') return l * r;
      throw new Error(TYPE_ERR);
    }
    case 'div': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) throw new Error('division by zero');
        return l / r;
      }
      throw new Error(TYPE_ERR);
    }
    case 'call': return callFn(node, ctx);
  }
}

function callFn(node: Extract<Node, { kind: 'call' }>, ctx: Ctx): unknown {
  const rawArgs = node.args.map(a => evaluate(a, ctx));
  const strArg = (i: number): string => {
    const v = rawArgs[i];
    if (typeof v !== 'string') throw new Error(TYPE_ERR);
    return v;
  };
  const numArg = (i: number): number => {
    const v = rawArgs[i];
    if (typeof v !== 'number') throw new Error(TYPE_ERR);
    return v;
  };
  const prev = (key: string): unknown =>
    ctx.previous && Object.prototype.hasOwnProperty.call(ctx.previous, key)
      ? ctx.previous[key]
      : undefined;

  switch (node.name) {
    case 'now': return ctx.now;
    case 'me': return ctx.me;
    case 'has_role': return ctx.roles.has(String(rawArgs[0] ?? ''));
    case 'is_empty': {
      const v = rawArgs[0];
      return v === null || v === undefined || v === '' ||
        (Array.isArray(v) && v.length === 0) ||
        (isPlainObject(v) && Object.keys(v).length === 0);
    }
    case 'len': {
      const v = rawArgs[0];
      if (typeof v === 'string') return v.length;
      if (Array.isArray(v)) return v.length;
      throw new Error(TYPE_ERR);
    }
    case 'lower': return strArg(0).toLowerCase();
    case 'upper': return strArg(0).toUpperCase();
    case 'changes': {
      const key = strArg(0);
      return !eq(ctx.resolve(key), prev(key));
    }
    case 'changes_to': {
      const key = strArg(0);
      const val = rawArgs[1];
      return !eq(ctx.resolve(key), prev(key)) && eq(ctx.resolve(key), val);
    }
    case 'changes_from': {
      const key = strArg(0);
      const val = rawArgs[1];
      return eq(prev(key), val) && !eq(ctx.resolve(key), val);
    }
    case 'business_days_since': {
      const then = numArg(0);
      return Math.max(0, Math.floor((ctx.now - then) / 86_400_000));
    }
    default:
      throw new Error(`unknown function "${node.name}"`);
  }
}

/** Evaluate an expression string as a boolean condition. */
export function condition(text: string, ctx: Ctx): boolean {
  return truthy(evaluate(parse(text), ctx));
}
