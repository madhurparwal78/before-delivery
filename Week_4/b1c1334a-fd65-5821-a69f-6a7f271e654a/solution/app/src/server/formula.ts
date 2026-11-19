// Reading formula text: tokens, grammar, the located reading diagnosis, and the
// byte-preserving rewrite of names on a column or table rename.
import { Dec } from "./decimal.js";

const FORMULA_MAX = 2000;

const READING = {
  tooLong: "Check the formula: use at most 2,000 characters.",
  endedEarly: "Check the formula: it ended too early.",
  at: (n: number) => `Check the formula: it could not be read at character ${n}.`,
} as const;

// Where a name token sits in the stored text, in code points.
export interface Span {
  start: number;
  end: number;
}

interface Link {
  name: string;
  span: Span; // the name inside the brackets
}

export type Expr =
  | { t: "num"; value: Dec }
  | { t: "str"; value: string }
  | { t: "bool"; value: boolean }
  | { t: "chain"; links: Link[] }
  | { t: "neg"; operand: Expr }
  | { t: "bin"; op: BinaryOp; left: Expr; right: Expr }
  | { t: "call"; name: string; args: Arg[] };

export type Arg =
  | Expr
  | { t: "table"; table: string; tableSpan: Span }
  | { t: "tablecol"; table: string; tableSpan: Span; column: Link };

type BinaryOp = "+" | "-" | "*" | "/" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

const COLUMN_ARG_FUNCTIONS = new Set(["SUM", "MIN", "MAX", "AVERAGE", "COUNTBY", "SUMBY"]);

type TokenKind = "num" | "str" | "bracket" | "name" | "op" | "(" | ")" | "," | ".";

interface Token {
  kind: TokenKind;
  text: string;
  start: number; // code point index in the text being read
  end: number;
}

class Problem extends Error {
  constructor(readonly position: number | null) {
    super("formula problem");
  }
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string | undefined) => c !== undefined && /^[A-Za-z]$/.test(c);
const isNameChar = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9_]$/.test(c);

class Reader {
  private at = 0;
  private lookahead: Token | null | undefined;

  constructor(
    private readonly chars: string[],
    private readonly offset: number,
  ) {}

  private problem(index: number): never {
    throw new Problem(index + this.offset + 1);
  }

  private scan(): Token | null {
    const c = this.chars;
    while (this.at < c.length && " \t\r\n".includes(c[this.at]!)) this.at++;
    if (this.at >= c.length) return null;
    const start = this.at;
    const ch = c[start]!;
    if (isDigit(ch)) {
      let i = start;
      while (isDigit(c[i])) i++;
      if (c[i] === "." && isDigit(c[i + 1])) {
        i++;
        while (isDigit(c[i])) i++;
      }
      this.at = i;
      return { kind: "num", text: c.slice(start, i).join(""), start, end: i };
    }
    if (ch === '"') {
      let i = start + 1;
      let value = "";
      for (;;) {
        if (i >= c.length) this.problem(start);
        if (c[i] === '"') {
          if (c[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          break;
        }
        value += c[i];
        i++;
      }
      this.at = i + 1;
      return { kind: "str", text: value, start, end: i + 1 };
    }
    if (ch === "[") {
      let i = start + 1;
      while (i < c.length && c[i] !== "]" && c[i] !== "[") i++;
      if (c[i] !== "]" || i === start + 1) this.problem(start);
      this.at = i + 1;
      return { kind: "bracket", text: c.slice(start + 1, i).join(""), start, end: i + 1 };
    }
    if (isLetter(ch)) {
      let i = start;
      while (isNameChar(c[i])) i++;
      this.at = i;
      return { kind: "name", text: c.slice(start, i).join(""), start, end: i };
    }
    if (ch === ".") {
      if (!isDigit(c[start + 1]) && c[start + 1] !== "[") this.problem(start);
      this.at = start + 1;
      return { kind: ".", text: ".", start, end: start + 1 };
    }
    for (const op of ["<>", "<=", ">="]) {
      if (ch === op[0] && c[start + 1] === op[1]) {
        this.at = start + 2;
        return { kind: "op", text: op, start, end: start + 2 };
      }
    }
    if ("+-*/&=<>".includes(ch)) {
      this.at = start + 1;
      return { kind: "op", text: ch, start, end: start + 1 };
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      this.at = start + 1;
      return { kind: ch, text: ch, start, end: start + 1 };
    }
    return this.problem(start);
  }

  peek(): Token | null {
    if (this.lookahead === undefined) this.lookahead = this.scan();
    return this.lookahead;
  }

  // The token after the next one, used only to tell a function name from a table name.
  peekSecond(): Token | null {
    this.peek();
    const saved = this.at;
    const second = this.scan();
    this.at = saved;
    return second;
  }

  // The next token, when the formula must go on.
  required(): Token {
    const token = this.peek();
    if (token === null) throw new Problem(null);
    return token;
  }

  next(): Token {
    const token = this.peek();
    if (token === null) throw new Problem(null);
    this.lookahead = undefined;
    return token;
  }

  reject(token: Token | null): never {
    if (token === null) throw new Problem(null);
    return this.problem(token.start);
  }

  span(token: Token, inner: boolean): Span {
    return inner ? { start: token.start + 1, end: token.end - 1 } : { start: token.start, end: token.end };
  }
}

function parseExpression(r: Reader): Expr {
  const comparison = new Set(["=", "<>", "<", ">", "<=", ">="]);
  const level = (ops: Set<string>, below: () => Expr): (() => Expr) => () => {
    let left = below();
    for (;;) {
      const token = r.peek();
      if (token?.kind !== "op" || !ops.has(token.text)) return left;
      r.next();
      left = { t: "bin", op: token.text as BinaryOp, left, right: below() };
    }
  };
  const unary = (): Expr => {
    const token = r.peek();
    if (token?.kind === "op" && token.text === "-") {
      r.next();
      return { t: "neg", operand: unary() };
    }
    return primary();
  };
  const mul = level(new Set(["*", "/"]), unary);
  const add = level(new Set(["+", "-"]), mul);
  const concat = level(new Set(["&"]), add);
  const expr = level(comparison, concat);

  const chain = (first: Token): Expr => {
    const links: Link[] = [{ name: first.text, span: r.span(first, true) }];
    while (r.peek()?.kind === ".") {
      r.next();
      const next = r.next();
      if (next.kind !== "bracket") r.reject(next);
      links.push({ name: next.text, span: r.span(next, true) });
    }
    return { t: "chain", links };
  };

  const argument = (fn: string): Arg => {
    const token = r.peek();
    const allowsColumn = COLUMN_ARG_FUNCTIONS.has(fn);
    const allowsTable = fn === "COUNT";
    if ((allowsColumn || allowsTable) && token?.kind === "name" && r.peekSecond()?.kind !== "(" && !isBoolName(token.text)) {
      r.next();
      const tableSpan = r.span(token, false);
      if (r.required().kind === ".") {
        r.next();
        const column = r.next();
        if (column.kind !== "bracket") r.reject(column);
        const end = r.required();
        if (!allowsColumn || (end.kind !== "," && end.kind !== ")")) r.reject(token);
        return { t: "tablecol", table: token.text, tableSpan, column: { name: column.text, span: r.span(column, true) } };
      }
      const end = r.required();
      if (!allowsTable || (end.kind !== "," && end.kind !== ")")) r.reject(token);
      return { t: "table", table: token.text, tableSpan };
    }
    return expr();
  };

  const primary = (): Expr => {
    const token = r.next();
    switch (token.kind) {
      case "num":
        return { t: "num", value: Dec.parse(token.text)! };
      case "str":
        return { t: "str", value: token.text };
      case "bracket":
        return chain(token);
      case "(": {
        const inner = expr();
        const close = r.next();
        if (close.kind !== ")") r.reject(close);
        return inner;
      }
      case "name": {
        if (r.peek()?.kind === "(") {
          r.next();
          const fn = token.text.toUpperCase();
          const args: Arg[] = [];
          if (r.peek()?.kind === ")") {
            r.next();
            return { t: "call", name: fn, args };
          }
          for (;;) {
            args.push(argument(fn));
            const sep = r.next();
            if (sep.kind === ")") return { t: "call", name: fn, args };
            if (sep.kind !== ",") r.reject(sep);
          }
        }
        if (isBoolName(token.text)) return { t: "bool", value: token.text.toUpperCase() === "TRUE" };
        return r.reject(token);
      }
      default:
        return r.reject(token);
    }
  };

  const result = expr();
  const rest = r.peek();
  if (rest !== null) r.reject(rest);
  return result;
}

function isBoolName(text: string): boolean {
  const upper = text.toUpperCase();
  return upper === "TRUE" || upper === "FALSE";
}

type Reading = { ok: true; text: string; expr: Expr } | { ok: false; diagnosis: string };

// Reads a formula as sent: one leading equals sign is removed, positions count it.
export function readFormula(sent: string): Reading {
  const offset = sent.startsWith("=") ? 1 : 0;
  const text = sent.slice(offset);
  const chars = Array.from(text);
  if (chars.length > FORMULA_MAX) return { ok: false, diagnosis: READING.tooLong };
  try {
    return { ok: true, text, expr: parseExpression(new Reader(chars, offset)) };
  } catch (error) {
    if (error instanceof Problem) {
      return { ok: false, diagnosis: error.position === null ? READING.endedEarly : READING.at(error.position) };
    }
    throw error;
  }
}

export function parseStored(text: string): Expr {
  const reading = readFormula(text.startsWith("=") ? `=${text}` : text);
  if (!reading.ok) throw new Error(`stored formula is unreadable: ${text}`);
  return reading.expr;
}

export function isTableArg(arg: Arg): arg is Extract<Arg, { t: "table" | "tablecol" }> {
  return arg.t === "table" || arg.t === "tablecol";
}

// Replaces the given spans of `text` (code point ranges) with new names.
export function replaceSpans(text: string, edits: { span: Span; name: string }[]): string {
  if (edits.length === 0) return text;
  const chars = Array.from(text);
  const sorted = [...edits].sort((a, b) => b.span.start - a.span.start);
  for (const edit of sorted) chars.splice(edit.span.start, edit.span.end - edit.span.start, edit.name);
  return chars.join("");
}

export function walk(expr: Expr, visit: (node: Expr | Arg) => void): void {
  visit(expr);
  switch (expr.t) {
    case "neg":
      walk(expr.operand, visit);
      break;
    case "bin":
      walk(expr.left, visit);
      walk(expr.right, visit);
      break;
    case "call":
      for (const arg of expr.args) {
        if (isTableArg(arg)) visit(arg);
        else walk(arg, visit);
      }
      break;
    default:
      break;
  }
}
