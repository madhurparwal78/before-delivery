import { config } from "../config.js";
import { Decimal } from "./decimal.js";

export type CompareOp = "=" | "<>" | "<" | "<=" | ">" | ">=";
export type ArithOp = "+" | "-" | "*" | "/" | "%" | "^";

export type Node =
  | { k: "num"; v: Decimal; col: number }
  | { k: "text"; v: string; col: number }
  | { k: "bool"; v: boolean; col: number }
  | { k: "ref"; key: string; row: string | null; col: number }
  | { k: "call"; name: FunctionName; args: Node[]; col: number }
  | { k: "neg"; arg: Node; col: number }
  | { k: "not"; arg: Node; col: number }
  | { k: "arith"; op: ArithOp; left: Node; right: Node; col: number }
  | { k: "join"; left: Node; right: Node; col: number }
  | { k: "compare"; op: CompareOp; left: Node; right: Node; col: number }
  | { k: "and" | "or"; left: Node; right: Node; col: number };

type Arity = { min: number; max: number };

export const FUNCTIONS = {
  SUM: { min: 1, max: Infinity },
  MIN: { min: 1, max: Infinity },
  MAX: { min: 1, max: Infinity },
  AVG: { min: 1, max: Infinity },
  COUNT: { min: 1, max: Infinity },
  ROUND: { min: 2, max: 2 },
  FLOOR: { min: 1, max: 1 },
  CEIL: { min: 1, max: 1 },
  ABS: { min: 1, max: 1 },
  IF: { min: 3, max: 3 },
  BLANK: { min: 1, max: 1 },
  LEN: { min: 1, max: 1 },
  UPPER: { min: 1, max: 1 },
  LOWER: { min: 1, max: 1 },
  TRIM: { min: 1, max: 1 },
  DATE: { min: 1, max: 1 },
  DAYS: { min: 2, max: 2 },
  ADD_DAYS: { min: 2, max: 2 },
  TODAY: { min: 0, max: 0 },
  HAS: { min: 2, max: 2 },
  TICKED: { min: 1, max: 1 },
} satisfies Record<string, Arity>;

export type FunctionName = keyof typeof FUNCTIONS;

function isFunctionName(name: string): name is FunctionName {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

/** A save-time refusal; `message` is the full published text. */
export class FormulaRefusal extends Error {}

function refuse(col: number, text: string): never {
  throw new FormulaRefusal(`Column ${col}: ${text}`);
}

type Token =
  | { t: "num"; raw: string; col: number }
  | { t: "text"; raw: string; v: string; col: number }
  | { t: "ref"; raw: string; key: string; row: string | null; col: number }
  | { t: "ident"; raw: string; col: number }
  | { t: "op"; raw: string; col: number }
  | { t: "("; raw: string; col: number }
  | { t: ")"; raw: string; col: number }
  | { t: ","; raw: string; col: number }
  | { t: "eof"; raw: string; col: number };

const REF_BODY = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.([^{}."]+))?$/;

function lex(chars: string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
  const isIdentStart = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z_]$/.test(c);
  const isIdent = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c);
  while (i < chars.length) {
    const c = chars[i];
    const col = i + 1;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (isDigit(c)) {
      let j = i;
      while (isDigit(chars[j])) j++;
      if (chars[j] === "." && isDigit(chars[j + 1])) {
        j++;
        while (isDigit(chars[j])) j++;
      }
      tokens.push({ t: "num", raw: chars.slice(i, j).join(""), col });
      i = j;
    } else if (c === '"') {
      const end = chars.indexOf('"', i + 1);
      if (end < 0) refuse(col, "this text has no closing quote.");
      tokens.push({ t: "text", raw: chars.slice(i, end + 1).join(""), v: chars.slice(i + 1, end).join(""), col });
      i = end + 1;
    } else if (c === "{") {
      const end = chars.indexOf("}", i + 1);
      const body = end < 0 ? null : REF_BODY.exec(chars.slice(i + 1, end).join(""));
      if (!body) refuse(col, "unexpected character {.");
      tokens.push({ t: "ref", raw: chars.slice(i, end + 1).join(""), key: body[1], row: body[2] ?? null, col });
      i = end + 1;
    } else if (isIdentStart(c)) {
      let j = i;
      while (isIdent(chars[j])) j++;
      tokens.push({ t: "ident", raw: chars.slice(i, j).join(""), col });
      i = j;
    } else if ((c === "<" || c === ">") && (chars[i + 1] === "=" || (c === "<" && chars[i + 1] === ">"))) {
      tokens.push({ t: "op", raw: c + chars[i + 1], col });
      i += 2;
    } else if ("+-*/%^&=<>".includes(c)) {
      tokens.push({ t: "op", raw: c, col });
      i++;
    } else if (c === "(" || c === ")" || c === ",") {
      tokens.push({ t: c, raw: c, col });
      i++;
    } else {
      refuse(col, `unexpected character ${c}.`);
    }
  }
  tokens.push({ t: "eof", raw: "", col: chars.length + 1 });
  return tokens;
}

const COMPARE_OPS: readonly string[] = ["=", "<>", "<", "<=", ">", ">="];

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private isWord(token: Token, word: string): boolean {
    return token.t === "ident" && token.raw.toUpperCase() === word;
  }

  private isOp(token: Token, ...ops: string[]): boolean {
    return token.t === "op" && ops.includes(token.raw);
  }

  private unexpected(token: Token): never {
    if (token.t === "eof") refuse(token.col, "the formula ends too early.");
    refuse(token.col, `unexpected ${token.raw}.`);
  }

  parseFormula(): Node {
    const node = this.parseOr();
    const token = this.peek();
    if (token.t !== "eof") this.unexpected(token);
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isWord(this.peek(), "OR")) {
      const col = this.next().col;
      left = { k: "or", left, right: this.parseAnd(), col };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isWord(this.peek(), "AND")) {
      const col = this.next().col;
      left = { k: "and", left, right: this.parseNot(), col };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.isWord(this.peek(), "NOT")) {
      const col = this.next().col;
      return { k: "not", arg: this.parseNot(), col };
    }
    return this.parseCompare();
  }

  private parseCompare(): Node {
    const left = this.parseJoin();
    const token = this.peek();
    if (token.t === "op" && COMPARE_OPS.includes(token.raw)) {
      this.next();
      return { k: "compare", op: token.raw as CompareOp, left, right: this.parseJoin(), col: token.col };
    }
    return left;
  }

  private parseJoin(): Node {
    let left = this.parseAdd();
    while (this.isOp(this.peek(), "&")) {
      const col = this.next().col;
      left = { k: "join", left, right: this.parseAdd(), col };
    }
    return left;
  }

  private parseAdd(): Node {
    let left = this.parseMul();
    while (this.isOp(this.peek(), "+", "-")) {
      const token = this.next();
      left = { k: "arith", op: token.raw as ArithOp, left, right: this.parseMul(), col: token.col };
    }
    return left;
  }

  private parseMul(): Node {
    let left = this.parseUnary();
    while (this.isOp(this.peek(), "*", "/", "%")) {
      const token = this.next();
      left = { k: "arith", op: token.raw as ArithOp, left, right: this.parseUnary(), col: token.col };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.isOp(this.peek(), "-")) {
      const col = this.next().col;
      return { k: "neg", arg: this.parseUnary(), col };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    if (this.isOp(this.peek(), "^")) {
      const col = this.next().col;
      return { k: "arith", op: "^", left: base, right: this.parseUnary(), col };
    }
    return base;
  }

  private expectClose(): void {
    const token = this.next();
    if (token.t === ")") return;
    if (token.t === "eof") refuse(token.col, "a closing bracket is missing.");
    refuse(token.col, `unexpected ${token.raw}.`);
  }

  private parsePrimary(): Node {
    const token = this.next();
    switch (token.t) {
      case "num":
        return { k: "num", v: Decimal.parse(token.raw) ?? Decimal.ZERO, col: token.col };
      case "text":
        return { k: "text", v: token.v, col: token.col };
      case "ref":
        return { k: "ref", key: token.key, row: token.row, col: token.col };
      case "(": {
        const inner = this.parseOr();
        this.expectClose();
        return inner;
      }
      case "ident": {
        const upper = token.raw.toUpperCase();
        if (upper === "TRUE" || upper === "FALSE") return { k: "bool", v: upper === "TRUE", col: token.col };
        if (this.peek().t !== "(" || ["AND", "OR", "NOT"].includes(upper)) this.unexpected(token);
        if (!isFunctionName(upper)) refuse(token.col, `there is no function called ${token.raw}.`);
        this.next();
        const args: Node[] = [];
        if (this.peek().t !== ")") {
          args.push(this.parseOr());
          while (this.peek().t === ",") {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expectClose();
        const arity: Arity = FUNCTIONS[upper];
        if (args.length < arity.min || args.length > arity.max) {
          const n = arity.min;
          if (arity.max === Infinity) refuse(token.col, `${upper} takes at least ${n} value${n === 1 ? "" : "s"}.`);
          refuse(token.col, `${upper} takes ${n} value${n === 1 ? "" : "s"}.`);
        }
        return { k: "call", name: upper, args, col: token.col };
      }
      default:
        this.unexpected(token);
    }
  }
}

/** Reads a formula, refusing it with the published save-time text. */
export function parseFormula(source: string): Node {
  const chars = Array.from(source);
  if (chars.length > config.formulaMaxChars)
    throw new FormulaRefusal(`The formula is longer than ${config.formulaMaxChars} characters.`);
  if (source.trim() === "") refuse(1, "the formula is empty.");
  const tokens = lex(chars);
  let depth = 0;
  for (const token of tokens) {
    if (token.t === "(") depth++;
    if (token.t === ")") depth--;
    if (depth > config.formulaMaxDepth)
      throw new FormulaRefusal(`The formula has more than ${config.formulaMaxDepth} levels of brackets.`);
  }
  return new Parser(tokens).parseFormula();
}

export interface RefVisit {
  key: string;
  row: string | null;
  col: number;
  /** The function this reference is a direct argument of, if any. */
  parentCall: FunctionName | null;
}

/** Visits every reference in source order. */
export function visitRefs(node: Node, visit: (ref: RefVisit) => void, parentCall: FunctionName | null = null): void {
  switch (node.k) {
    case "ref":
      visit({ key: node.key, row: node.row, col: node.col, parentCall });
      return;
    case "call":
      for (const arg of node.args) visitRefs(arg, visit, node.name);
      return;
    case "neg":
    case "not":
      visitRefs(node.arg, visit);
      return;
    case "arith":
    case "join":
    case "compare":
    case "and":
    case "or":
      visitRefs(node.left, visit);
      visitRefs(node.right, visit);
      return;
    default:
      return;
  }
}
