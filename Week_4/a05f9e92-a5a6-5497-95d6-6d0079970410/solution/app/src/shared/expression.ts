/**
 * The published expression language: tokenised, parsed into a tree and interpreted from that tree.
 * Nothing here turns text into executable code.
 */

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

export type BinaryOperator = "or" | "and" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "contains" | "startswith" | "+" | "-" | "*" | "/";

export type Node = (
  | { kind: "literal"; value: Value; col: number }
  | { kind: "list"; items: Node[]; col: number }
  | { kind: "path"; parts: string[]; col: number }
  | { kind: "call"; name: string; args: Node[]; col: number }
  | { kind: "binary"; op: BinaryOperator; left: Node; right: Node; col: number }
  | { kind: "not"; operand: Node; col: number }
  | { kind: "negate"; operand: Node; col: number }
) & { paren?: boolean; parens?: number };

export class ExpressionError extends Error {
  constructor(
    readonly col: number,
    readonly reason: string,
  ) {
    super(`Expression error at column ${col}: ${reason}.`);
  }
}

const FUNCTIONS = [
  "changes",
  "changes_to",
  "changes_from",
  "is_empty",
  "len",
  "lower",
  "upper",
  "now",
  "me",
  "has_role",
  "business_days_since",
] as const;

const KEYWORDS = new Set(["or", "and", "not", "in", "contains", "startswith", "true", "false", "null"]);
const COMPARISONS = new Set(["=", "!=", "<", "<=", ">", ">=", "in", "contains", "startswith"]);

type Token =
  | { type: "number"; value: number; col: number; text: string }
  | { type: "string"; value: string; col: number; text: string }
  | { type: "word"; value: string; col: number; text: string }
  | { type: "symbol"; value: string; col: number; text: string }
  | { type: "end"; col: number; text: string };

function describe(token: Token): string {
  return token.text.replace(/"/g, '\\"');
}

class Lexer {
  private position = 0;
  private buffered: Token | null = null;

  constructor(private readonly source: string) {}

  peek(): Token {
    this.buffered ??= this.scan();
    return this.buffered;
  }

  next(): Token {
    const token = this.peek();
    this.buffered = null;
    return token;
  }

  endColumn(): number {
    return this.source.length + 1;
  }

  private scan(): Token {
    const text = this.source;
    while (this.position < text.length && /\s/.test(text[this.position]!)) this.position++;
    const start = this.position;
    const col = start + 1;
    if (start >= text.length) return { type: "end", col: this.endColumn(), text: "" };
    const ch = text[start]!;
    if (/[0-9]/.test(ch)) {
      let end = start;
      while (end < text.length && /[0-9]/.test(text[end]!)) end++;
      if (text[end] === "." && /[0-9]/.test(text[end + 1] ?? "")) {
        end++;
        while (end < text.length && /[0-9]/.test(text[end]!)) end++;
      }
      this.position = end;
      return { type: "number", value: Number(text.slice(start, end)), col, text: text.slice(start, end) };
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = start;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++;
      this.position = end;
      return { type: "word", value: text.slice(start, end), col, text: text.slice(start, end) };
    }
    if (ch === '"') {
      let end = start + 1;
      let value = "";
      while (end < text.length) {
        const c = text[end]!;
        if (c === "\\" && (text[end + 1] === '"' || text[end + 1] === "\\")) {
          value += text[end + 1];
          end += 2;
          continue;
        }
        if (c === '"') {
          this.position = end + 1;
          return { type: "string", value, col, text: text.slice(start, end + 1) };
        }
        value += c;
        end++;
      }
      throw new ExpressionError(col, 'unexpected "\\""');
    }
    const two = text.slice(start, start + 2);
    if (two === "!=" || two === "<=" || two === ">=") {
      this.position = start + 2;
      return { type: "symbol", value: two, col, text: two };
    }
    if ("=<>+-*/()[],.".includes(ch)) {
      this.position = start + 1;
      return { type: "symbol", value: ch, col, text: ch };
    }
    throw new ExpressionError(col, `unexpected "${ch === "\\" ? "\\\\" : ch}"`);
  }
}

class Parser {
  private readonly lexer: Lexer;

  constructor(source: string) {
    this.lexer = new Lexer(source);
  }

  parse(): Node {
    const node = this.parseOr();
    const rest = this.lexer.peek();
    if (rest.type !== "end") throw new ExpressionError(rest.col, `unexpected "${describe(rest)}"`);
    return node;
  }

  private isWord(token: Token, word: string): boolean {
    return token.type === "word" && token.value === word;
  }

  private isSymbol(token: Token, symbol: string): boolean {
    return token.type === "symbol" && token.value === symbol;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isWord(this.lexer.peek(), "or")) {
      const op = this.lexer.next();
      left = { kind: "binary", op: "or", left, right: this.parseAnd(), col: op.col };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isWord(this.lexer.peek(), "and")) {
      const op = this.lexer.next();
      left = { kind: "binary", op: "and", left, right: this.parseNot(), col: op.col };
    }
    return left;
  }

  private parseNot(): Node {
    const token = this.lexer.peek();
    if (this.isWord(token, "not")) {
      this.lexer.next();
      return { kind: "not", operand: this.parseNot(), col: token.col };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();
    const token = this.lexer.peek();
    if (!this.isComparison(token)) return left;
    this.lexer.next();
    const right = this.parseAdditive();
    const chained = this.lexer.peek();
    if (this.isComparison(chained)) throw new ExpressionError(chained.col, `unexpected "${describe(chained)}"`);
    return { kind: "binary", op: (token as { value: string }).value as BinaryOperator, left, right, col: token.col };
  }

  private isComparison(token: Token): boolean {
    return (token.type === "symbol" || token.type === "word") && COMPARISONS.has(token.value);
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.lexer.peek();
      if (!this.isSymbol(token, "+") && !this.isSymbol(token, "-")) return left;
      this.lexer.next();
      left = { kind: "binary", op: (token as { value: string }).value as BinaryOperator, left, right: this.parseMultiplicative(), col: token.col };
    }
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      const token = this.lexer.peek();
      if (!this.isSymbol(token, "*") && !this.isSymbol(token, "/")) return left;
      this.lexer.next();
      left = { kind: "binary", op: (token as { value: string }).value as BinaryOperator, left, right: this.parseUnary(), col: token.col };
    }
  }

  private parseUnary(): Node {
    const token = this.lexer.peek();
    if (this.isSymbol(token, "-")) {
      this.lexer.next();
      return { kind: "negate", operand: this.parseUnary(), col: token.col };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.lexer.next();
    if (token.type === "number") return { kind: "literal", value: token.value, col: token.col };
    if (token.type === "string") return { kind: "literal", value: token.value, col: token.col };
    if (this.isSymbol(token, "(")) {
      const inner = this.parseOr();
      this.expectClose(")");
      return { ...inner, paren: true, parens: (inner.parens ?? 0) + 1 };
    }
    if (this.isSymbol(token, "[")) return this.parseList(token.col);
    if (token.type === "word") {
      if (token.value === "true") return { kind: "literal", value: true, col: token.col };
      if (token.value === "false") return { kind: "literal", value: false, col: token.col };
      if (token.value === "null") return { kind: "literal", value: null, col: token.col };
      if (KEYWORDS.has(token.value)) throw new ExpressionError(token.col, "expected a value");
      if (this.isSymbol(this.lexer.peek(), "(")) return this.parseCall(token);
      return this.parsePath(token);
    }
    throw new ExpressionError(token.col, "expected a value");
  }

  private expectClose(symbol: string): void {
    const token = this.lexer.peek();
    if (!this.isSymbol(token, symbol)) throw new ExpressionError(token.col, `expected "${symbol}"`);
    this.lexer.next();
  }

  private parseList(col: number): Node {
    const items: Node[] = [];
    if (this.isSymbol(this.lexer.peek(), "]")) {
      this.lexer.next();
      return { kind: "list", items, col };
    }
    for (;;) {
      items.push(this.parseOr());
      const token = this.lexer.next();
      if (this.isSymbol(token, "]")) return { kind: "list", items, col };
      if (!this.isSymbol(token, ",")) throw new ExpressionError(token.col, token.type === "end" ? "expected a value" : `unexpected "${describe(token)}"`);
    }
  }

  private parseCall(name: Token): Node {
    this.lexer.next();
    const args: Node[] = [];
    if (this.isSymbol(this.lexer.peek(), ")")) {
      this.lexer.next();
      return { kind: "call", name: (name as { value: string }).value, args, col: name.col };
    }
    for (;;) {
      args.push(this.parseOr());
      const token = this.lexer.peek();
      if (this.isSymbol(token, ",")) {
        this.lexer.next();
        continue;
      }
      this.expectClose(")");
      return { kind: "call", name: (name as { value: string }).value, args, col: name.col };
    }
  }

  private parsePath(first: Token): Node {
    const parts = [(first as { value: string }).value];
    while (this.isSymbol(this.lexer.peek(), ".")) {
      this.lexer.next();
      const part = this.lexer.next();
      if (part.type !== "word" || KEYWORDS.has(part.value)) throw new ExpressionError(part.col, part.type === "end" ? "expected a value" : `unexpected "${describe(part)}"`);
      parts.push(part.value);
    }
    return { kind: "path", parts, col: first.col };
  }
}

export function parse(source: string): Node {
  return new Parser(source).parse();
}

interface Schema {
  hasPath(parts: string[]): boolean;
}

/** Checks paths and function names, reporting the leftmost problem as an ExpressionError. */
export function validate(node: Node, schema: Schema): void {
  const problems: ExpressionError[] = [];
  const visit = (current: Node): void => {
    switch (current.kind) {
      case "path":
        if (!schema.hasPath(current.parts)) problems.push(new ExpressionError(current.col, `unknown field "${current.parts.join(".")}"`));
        return;
      case "call":
        if (!(FUNCTIONS as readonly string[]).includes(current.name)) {
          problems.push(new ExpressionError(current.col, `unknown function "${current.name}"`));
          return;
        }
        for (const arg of current.args) visit(arg);
        return;
      case "list":
        current.items.forEach(visit);
        return;
      case "binary":
        visit(current.left);
        visit(current.right);
        return;
      case "not":
      case "negate":
        visit(current.operand);
        return;
      case "literal":
        return;
    }
  };
  visit(node);
  const first = problems.sort((a, b) => a.col - b.col)[0];
  if (first) throw first;
}

export interface Scope {
  path(parts: string[]): Value;
  /** The value of a path before the save in progress; undefined outside business rules. */
  previous?(parts: string[]): Value | undefined;
  inserting?: boolean;
  me(): string;
  hasRole(role: string): boolean;
  now(): number;
  businessDaysSince?(value: Value): number | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function instantOf(value: Value): number | null {
  if (typeof value !== "string" || !ISO.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function equals(left: Value, right: Value): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "object" || typeof right === "object") return JSON.stringify(left) === JSON.stringify(right);
  if (typeof left === "string" && typeof right === "string") {
    const a = instantOf(left);
    const b = instantOf(right);
    return a !== null && b !== null ? a === b : left === right;
  }
  return typeof left === typeof right && left === right;
}

function order(left: Value, right: Value): number | null {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    const a = instantOf(left);
    const b = instantOf(right);
    if (a !== null && b !== null) return a - b;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return null;
}

function isEmpty(value: Value): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function compare(op: BinaryOperator, left: Value, right: Value): boolean {
  switch (op) {
    case "=":
      return equals(left, right);
    case "!=":
      return !equals(left, right);
    case "in":
      return Array.isArray(right) && right.some((item) => equals(left, item));
    case "contains":
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      return Array.isArray(left) && left.some((item) => equals(item, right));
    case "startswith":
      return typeof left === "string" && typeof right === "string" && left.startsWith(right);
    default: {
      const diff = order(left, right);
      if (diff === null) return false;
      return op === "<" ? diff < 0 : op === "<=" ? diff <= 0 : op === ">" ? diff > 0 : diff >= 0;
    }
  }
}

function arithmetic(op: BinaryOperator, left: Value, right: Value): Value {
  if (op === "+" && typeof left === "string" && typeof right === "string") return left + right;
  if (typeof left !== "number" || typeof right !== "number") return null;
  if (op === "+") return left + right;
  if (op === "-") return left - right;
  if (op === "*") return left * right;
  return right === 0 ? null : left / right;
}

export function evaluate(node: Node, scope: Scope): Value {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "list":
      return node.items.map((item) => evaluate(item, scope));
    case "path":
      return scope.path(node.parts);
    case "not":
      return evaluate(node.operand, scope) !== true;
    case "negate": {
      const inner = evaluate(node.operand, scope);
      return typeof inner === "number" ? -inner : null;
    }
    case "call":
      return call(node, scope);
    case "binary": {
      if (node.op === "or") return evaluate(node.left, scope) === true || evaluate(node.right, scope) === true;
      if (node.op === "and") return evaluate(node.left, scope) === true && evaluate(node.right, scope) === true;
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      if (node.op === "+" || node.op === "-" || node.op === "*" || node.op === "/") return arithmetic(node.op, left, right);
      return compare(node.op, left, right);
    }
  }
}

export function holds(node: Node, scope: Scope): boolean {
  return evaluate(node, scope) === true;
}

function changeOf(arg: Node | undefined, scope: Scope): { changed: boolean; before: Value; after: Value } {
  if (!arg || arg.kind !== "path" || !scope.previous) return { changed: false, before: null, after: null };
  const after = scope.path(arg.parts);
  const before = scope.previous(arg.parts);
  if (scope.inserting || before === undefined) return { changed: !isEmpty(after), before: null, after };
  return { changed: !equals(before, after), before, after };
}

function call(node: Extract<Node, { kind: "call" }>, scope: Scope): Value {
  const [first, second] = node.args;
  switch (node.name) {
    case "changes":
      return changeOf(first, scope).changed;
    case "changes_to": {
      const change = changeOf(first, scope);
      return change.changed && second !== undefined && equals(change.after, evaluate(second, scope));
    }
    case "changes_from": {
      const change = changeOf(first, scope);
      return change.changed && second !== undefined && equals(change.before, evaluate(second, scope));
    }
    case "is_empty":
      return first === undefined ? true : isEmpty(evaluate(first, scope));
    case "len": {
      const value = first === undefined ? null : evaluate(first, scope);
      return typeof value === "string" || Array.isArray(value) ? value.length : 0;
    }
    case "lower": {
      const value = first === undefined ? null : evaluate(first, scope);
      return typeof value === "string" ? value.toLowerCase() : value;
    }
    case "upper": {
      const value = first === undefined ? null : evaluate(first, scope);
      return typeof value === "string" ? value.toUpperCase() : value;
    }
    case "now":
      return new Date(scope.now()).toISOString();
    case "me":
      return scope.me();
    case "has_role": {
      const role = first === undefined ? null : evaluate(first, scope);
      return typeof role === "string" && scope.hasRole(role);
    }
    case "business_days_since":
      return scope.businessDaysSince && first !== undefined ? scope.businessDaysSince(evaluate(first, scope)) : null;
    default:
      return null;
  }
}
