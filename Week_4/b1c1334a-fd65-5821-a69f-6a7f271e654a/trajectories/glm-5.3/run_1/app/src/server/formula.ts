/**
 * The formula language: tokens, reading with located diagnosis, and the AST.
 * One place decides whether a formula reads, and where the first problem is.
 */

export const MAX_FORMULA = 2000;

export type TokType =
  | 'number'
  | 'string'
  | 'bracket'
  | 'name'
  | 'func'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma';

export interface Token {
  type: TokType;
  text: string;
  /** 1-based code-point position in the text as sent */
  at: number;
  /** UTF-16 index span in the source text (after the equals sign) */
  start: number;
  end: number;
}

export type Diag =
  | { kind: 'too_long' }
  | { kind: 'too_early' }
  | { kind: 'unreadable'; at: number };

export const diagText = (d: Diag): string =>
  d.kind === 'too_long'
    ? 'Check the formula: use at most 2,000 characters.'
    : d.kind === 'too_early'
      ? 'Check the formula: it ended too early.'
      : `Check the formula: it could not be read at character ${d.at}.`;

/** Strip exactly one leading equals sign, as saves and previews do. */
export function stripEquals(text: string): string {
  return text.startsWith('=') ? text.slice(1) : text;
}

const cpLen = (text: string): number => {
  let n = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    n++;
  }
  return n;
};

/** 1-based code-point position of a UTF-16 index, plus the equals offset. */
const pos = (src: string, index: number, offset: number): number => {
  let n = 0;
  for (let i = 0; i < index && i < src.length; ) {
    const cp = src.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    n++;
  }
  return n + 1 + offset;
};

const isLetter = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
const isNameChar = (c: string) => isLetter(c) || (c >= '0' && c <= '9') || c === '_';
const isDigit = (c: string) => c >= '0' && c <= '9';

export interface TokenizeResult {
  tokens: Token[] | null;
  diag: Diag | null;
}

export function tokenize(src: string, offset: number): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  const push = (type: TokType, start: number, text: string) => {
    tokens.push({ type, text, at: pos(src, start, offset), start, end: i });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (isDigit(c)) {
      const start = i;
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === '.') {
        const pointAt = i;
        i++;
        if (!isDigit(src[i])) return { tokens: null, diag: { kind: 'unreadable', at: pos(src, pointAt, offset) } };
        while (i < src.length && isDigit(src[i])) i++;
      }
      push('number', start, src.slice(start, i));
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let closed = false;
      let out = '';
      while (i < src.length) {
        const ch = src[i];
        if (ch === '"') {
          if (src[i + 1] === '"') {
            out += '"';
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else {
          out += ch;
          i++;
        }
      }
      if (!closed) return { tokens: null, diag: { kind: 'unreadable', at: pos(src, start, offset) } };
      tokens.push({ type: 'string', text: out, at: pos(src, start, offset), start, end: i });
      continue;
    }
    if (c === '[') {
      const start = i;
      i++;
      let closed = false;
      while (i < src.length) {
        if (src[i] === ']') {
          closed = true;
          i++;
          break;
        }
        if (src[i] === '[') break;
        i++;
      }
      if (!closed) return { tokens: null, diag: { kind: 'unreadable', at: pos(src, start, offset) } };
      const inner = src.slice(start + 1, i - 1);
      if (inner.length === 0) return { tokens: null, diag: { kind: 'unreadable', at: pos(src, start, offset) } };
      tokens.push({ type: 'bracket', text: inner, at: pos(src, start, offset), start, end: i });
      continue;
    }
    if (isLetter(c)) {
      const start = i;
      while (i < src.length && isNameChar(src[i])) i++;
      const word = src.slice(start, i);
      if (src[i] === '(') {
        push('func', start, word);
        i++;
      } else {
        push('name', start, word);
      }
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      push('op', i, two);
      i += 2;
      continue;
    }
    if ('+-*/&=<>'.includes(c)) {
      push('op', i, c);
      i++;
      continue;
    }
    if (c === '(') {
      push('lparen', i, c);
      i++;
      continue;
    }
    if (c === ')') {
      push('rparen', i, c);
      i++;
      continue;
    }
    if (c === ',') {
      push('comma', i, c);
      i++;
      continue;
    }
    if (c === '.') {
      // a point joining a name or bracket to a following bracket, spaces allowed
      const before = tokens[tokens.length - 1];
      let k = i + 1;
      while (k < src.length && ' \t\r\n'.includes(src[k])) k++;
      if (before && (before.type === 'name' || before.type === 'bracket') && src[k] === '[') {
        push('op', i, '.');
        i++;
        continue;
      }
      return { tokens: null, diag: { kind: 'unreadable', at: pos(src, i, offset) } };
    }
    return { tokens: null, diag: { kind: 'unreadable', at: pos(src, i, offset) } };
  }
  return { tokens, diag: null };
}

export type AstNode =
  | { t: 'num'; text: string }
  | { t: 'str'; text: string }
  | { t: 'bool'; value: boolean }
  | { t: 'cell'; name: string }
  | { t: 'trav'; ref: string; chain: string[] }
  | { t: 'tablecol'; table: string; column: string }
  | { t: 'table'; table: string }
  | { t: 'call'; name: string; args: AstNode[] }
  | { t: 'un'; op: string; operand: AstNode }
  | { t: 'bin'; op: string; left: AstNode; right: AstNode };

export interface ReadResult {
  ast: AstNode | null;
  diag: Diag | null;
}

const AGG_COLUMN_FUNCS = new Set(['SUM', 'MIN', 'MAX', 'AVERAGE', 'COUNTBY']);

/**
 * Read a formula as sent: one optional leading equals sign is removed first,
 * and diagnosis positions count code points of the text as sent.
 */
export function readFormula(asSent: string): ReadResult {
  const stripped = stripEquals(asSent);
  const offset = asSent.startsWith('=') ? 1 : 0;
  if (cpLen(stripped) > MAX_FORMULA) return { ast: null, diag: { kind: 'too_long' } };
  const { tokens: rawTokens, diag } = tokenize(stripped, offset);
  if (diag || rawTokens === null) return { ast: null, diag: diag ?? { kind: 'too_early' } };
  const t: Token[] = rawTokens;

  let p = 0;
  let failAt: number | null = null;
  const fail = (at: number | null) => {
    if (failAt === null && at !== null) failAt = at;
  };
  const peek = (): Token | undefined => t[p];

  function parseCompare(): AstNode | null {
    let left = parseConcat();
    if (!left) return null;
    while (peek()?.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek()!.text)) {
      const op = peek()!.text;
      p++;
      const right = parseConcat();
      if (!right) return null;
      left = { t: 'bin', op, left, right };
    }
    return left;
  }

  function parseConcat(): AstNode | null {
    let left = parseAdd();
    if (!left) return null;
    while (peek()?.type === 'op' && peek()!.text === '&') {
      p++;
      const right = parseAdd();
      if (!right) return null;
      left = { t: 'bin', op: '&', left, right };
    }
    return left;
  }

  function parseAdd(): AstNode | null {
    let left = parseMul();
    if (!left) return null;
    while (peek()?.type === 'op' && (peek()!.text === '+' || peek()!.text === '-')) {
      const op = peek()!.text;
      p++;
      const right = parseMul();
      if (!right) return null;
      left = { t: 'bin', op, left, right };
    }
    return left;
  }

  function parseMul(): AstNode | null {
    let left = parseUnary();
    if (!left) return null;
    while (peek()?.type === 'op' && (peek()!.text === '*' || peek()!.text === '/')) {
      const op = peek()!.text;
      p++;
      const right = parseUnary();
      if (!right) return null;
      left = { t: 'bin', op, left, right };
    }
    return left;
  }

  function parseUnary(): AstNode | null {
    const tok = peek();
    if (tok?.type === 'op' && tok.text === '-') {
      p++;
      const operand = parsePrimary();
      if (!operand) return null;
      return { t: 'un', op: '-', operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): AstNode | null {
    const tok = peek();
    if (!tok) return null;
    switch (tok.type) {
      case 'number':
        p++;
        return { t: 'num', text: tok.text };
      case 'string':
        p++;
        return { t: 'str', text: tok.text };
      case 'bracket': {
        p++;
        const chain: string[] = [];
        while (peek()?.type === 'op' && peek()!.text === '.' && t[p + 1]?.type === 'bracket') {
          p += 2;
          chain.push(t[p - 1].text);
        }
        if (chain.length > 0) return { t: 'trav', ref: tok.text, chain };
        return { t: 'cell', name: tok.text };
      }
      case 'func': {
        p++;
        const name = tok.text.toUpperCase();
        const args: AstNode[] = [];
        let tableArgAt: number | null = null;
        if (peek()?.type === 'rparen') {
          p++;
          return { t: 'call', name, args };
        }
        for (;;) {
          const arg = parseArg(name);
          if (!arg) return null;
          if (arg.tableAt !== null) tableArgAt = arg.tableAt;
          args.push(arg.node);
          const next = peek();
          if (next?.type === 'comma') {
            p++;
            continue;
          }
          if (next?.type === 'rparen') {
            p++;
            return { t: 'call', name, args };
          }
          fail(next ? (tableArgAt ?? next.at) : null);
          return null;
        }
      }
      case 'lparen': {
        p++;
        const inner = parseCompare();
        if (!inner) return null;
        if (peek()?.type === 'rparen') {
          p++;
          return inner;
        }
        return null;
      }
      case 'name': {
        const upper = tok.text.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          p++;
          return { t: 'bool', value: upper === 'TRUE' };
        }
        // a table name outside its two allowed places
        fail(tok.at);
        return null;
      }
      default:
        fail(tok.at);
        return null;
    }
  }

  /** One argument of a call: table-name forms allowed for the aggregate funcs. */
  function parseArg(funcName: string): { node: AstNode; tableAt: number | null } | null {
    const tok = peek();
    if (!tok) return null;
    if (tok.type === 'name') {
      const upper = tok.text.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        p++;
        return { node: { t: 'bool', value: upper === 'TRUE' }, tableAt: null };
      }
      p++;
      const next = peek();
      const dot = next?.type === 'op' && next.text === '.';
      if (dot) p++;
      const afterDot = peek();
      if (dot && afterDot?.type === 'bracket') {
        p++;
        if (!(funcName === 'SUMBY' || AGG_COLUMN_FUNCS.has(funcName))) {
          fail(tok.at);
          return null;
        }
        return { node: { t: 'tablecol', table: tok.text, column: afterDot.text }, tableAt: tok.at };
      }
      if (dot) {
        fail(next!.at);
        return null;
      }
      if (funcName === 'COUNT') {
        return { node: { t: 'table', table: tok.text }, tableAt: tok.at };
      }
      fail(tok.at);
      return null;
    }
    const node = parseCompare();
    if (!node) return null;
    return { node, tableAt: null };
  }

  const ast = parseCompare();
  if (ast && p === t.length) return { ast, diag: null };
  if (ast && p < t.length) fail(t[p].at);
  if (failAt === null) return { ast: null, diag: { kind: 'too_early' } };
  return { ast: null, diag: { kind: 'unreadable', at: failAt } };
}

export { cpLen };
