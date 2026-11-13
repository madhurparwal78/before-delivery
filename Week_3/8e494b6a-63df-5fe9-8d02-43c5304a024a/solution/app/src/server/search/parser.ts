// Spoor Query (Business rules F): limits, then a recursive-descent parser that reports the earliest error.
import { ApiError, errors } from "../errors";
import { config } from "../config";
import { parseQueryDate } from "../../shared/time";
import type { FieldType } from "./fields";

export type Operator = ":" | ">" | ">=" | "<" | "<=";
/** A value as typed: literal text with `null` where an unescaped `*` stands. */
export type ValueParts = Array<string | null>;

export interface Leaf {
  kind: "leaf";
  field: string;
  op: Operator;
  exists: boolean;
  quoted: boolean;
  parts: ValueParts;
}

export type QueryNode =
  | Leaf
  | { kind: "and" | "or"; children: QueryNode[] }
  | { kind: "not"; child: QueryNode }
  | { kind: "scope"; path: string; child: QueryNode };

export interface QuerySchema {
  typesOf(field: string): FieldType[];
  hasPrefix(path: string): boolean;
}

const DEFAULT_FIELD = "message";
const ESCAPABLE = new Set([":", "(", ")", "{", "}", '"', "*", "\\"]);
const KEYWORDS = new Set(["AND", "OR", "NOT"]);

export function characters(text: string): string[] {
  return Array.from(text);
}

/** Length first, then nesting; both counted in characters, limits included. */
export function checkLimits(text: string): void {
  const chars = characters(text);
  const { queryMaxLen, queryMaxDepth } = config.settings;
  if (chars.length > queryMaxLen) throw errors.queryTooLong(queryMaxLen);
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\\") i++;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "(" || ch === "{")) {
      depth++;
      if (depth > queryMaxDepth) throw new ApiError(422, "query_too_deep", `Query nests deeper than ${queryMaxDepth} levels.`);
    } else if (!quoted && (ch === ")" || ch === "}")) depth = Math.max(0, depth - 1);
  }
}

class SyntaxProblem extends Error {
  constructor(readonly sentence: string, readonly position: number) {
    super(sentence);
  }
}

/** The earliest opening quote, parenthesis or brace that never closes. */
function firstUnclosed(chars: string[]): SyntaxProblem | null {
  const open: Array<{ ch: string; at: number }> = [];
  let quote = -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\\") i++;
    else if (quote >= 0) {
      if (ch === '"') quote = -1;
    } else if (ch === '"') quote = i;
    else if (ch === "(" || ch === "{") open.push({ ch, at: i });
    else if (ch === ")" || ch === "}") open.pop();
  }
  const candidates: SyntaxProblem[] = open.map((o) => new SyntaxProblem(`Unclosed parenthesis at position ${o.at + 1}.`, o.at + 1));
  if (quote >= 0) candidates.push(new SyntaxProblem(`Unclosed quote at position ${quote + 1}.`, quote + 1));
  return candidates.sort((a, b) => a.position - b.position)[0] ?? null;
}

class Parser {
  private i = 0;

  constructor(
    private readonly chars: string[],
    private readonly schema: QuerySchema,
    private readonly nowMs: number,
  ) {}

  parse(): QueryNode {
    const node = this.parseOr("");
    this.skipSpaces();
    if (this.i < this.chars.length) throw this.fail("Expected AND or OR", this.i);
    return node;
  }

  private fail(sentence: string, index: number): SyntaxProblem {
    return new SyntaxProblem(`${sentence} at position ${index + 1}.`, index + 1);
  }

  private skipSpaces(): void {
    while (this.i < this.chars.length && /\s/.test(this.chars[this.i] ?? "")) this.i++;
  }

  private peekKeyword(word: string): boolean {
    this.skipSpaces();
    const slice = this.chars.slice(this.i, this.i + word.length).join("");
    const after = this.chars[this.i + word.length];
    return slice === word && (after === undefined || /[\s(]/.test(after));
  }

  private atKeyword(): boolean {
    return [...KEYWORDS].some((word) => this.peekKeyword(word));
  }

  private parseOr(scope: string): QueryNode {
    const children = [this.parseAnd(scope)];
    while (this.peekKeyword("OR")) {
      this.i += 2;
      children.push(this.parseAnd(scope));
    }
    return children.length === 1 ? (children[0] as QueryNode) : { kind: "or", children };
  }

  private parseAnd(scope: string): QueryNode {
    const children = [this.parseNot(scope)];
    for (;;) {
      if (this.peekKeyword("AND")) {
        this.i += 3;
        children.push(this.parseNot(scope));
        continue;
      }
      this.skipSpaces();
      const next = this.chars[this.i];
      if (next === undefined || next === ")" || next === "}" || this.peekKeyword("OR")) break;
      throw this.fail("Expected AND or OR", this.i);
    }
    return children.length === 1 ? (children[0] as QueryNode) : { kind: "and", children };
  }

  private parseNot(scope: string): QueryNode {
    if (this.peekKeyword("NOT")) {
      this.i += 3;
      return { kind: "not", child: this.parseNot(scope) };
    }
    return this.parsePrimary(scope);
  }

  private parsePrimary(scope: string): QueryNode {
    this.skipSpaces();
    const ch = this.chars[this.i];
    if (ch === undefined || ch === ")" || ch === "}" || this.atKeyword()) throw this.fail("Expected a value", this.i);
    if (ch === "(") {
      const opened = this.i++;
      const inner = this.parseOr(scope);
      this.closing(")", opened);
      return inner;
    }
    if (ch === '"') {
      const start = this.i;
      const text = this.readQuoted();
      return this.leaf(DEFAULT_FIELD, ":", { parts: [text], quoted: true, exists: false }, start, start);
    }
    const start = this.i;
    const word = this.readWord(true);
    const next = this.chars[this.i];
    if (next === "{") {
      const path = scope ? `${scope}.${word.text}` : word.text;
      if (!this.schema.hasPrefix(path)) throw this.fail(`Unknown field ${path}`, start);
      const opened = this.i++;
      const inner = this.parseOr(path);
      this.closing("}", opened);
      return { kind: "scope", path, child: inner };
    }
    const opStart = this.i;
    const op = this.readOperator();
    if (op === null) {
      return this.leaf(DEFAULT_FIELD, ":", { parts: word.parts, quoted: false, exists: false }, start, start);
    }
    const field = scope ? `${scope}.${word.text}` : word.text;
    if (this.schema.typesOf(field).length === 0) throw this.fail(`Unknown field ${field}`, start);
    return this.fieldValue(field, op, opStart);
  }

  private closing(close: string, opened: number): void {
    this.skipSpaces();
    if (this.chars[this.i] !== close) throw new SyntaxProblem(`Unclosed parenthesis at position ${opened + 1}.`, opened + 1);
    this.i++;
  }

  private readOperator(): Operator | null {
    const ch = this.chars[this.i];
    if (ch === ":") {
      this.i++;
      return ":";
    }
    if (ch === ">" || ch === "<") {
      this.i++;
      if (this.chars[this.i] === "=") {
        this.i++;
        return `${ch}=` as Operator;
      }
      return ch;
    }
    return null;
  }

  /** A run of characters ended by whitespace, brackets, quotes or (when `stopAtOperator`) an operator. */
  private readWord(stopAtOperator: boolean): { text: string; parts: ValueParts } {
    const parts: ValueParts = [];
    let text = "";
    let literal = "";
    const flush = (): void => {
      if (literal) parts.push(literal);
      literal = "";
    };
    while (this.i < this.chars.length) {
      const ch = this.chars[this.i] as string;
      if (/\s/.test(ch) || "(){}\"".includes(ch)) break;
      if (stopAtOperator && (ch === ":" || ch === "<" || ch === ">")) break;
      if (ch === "\\") {
        const escaped = this.chars[this.i + 1];
        if (escaped !== undefined && ESCAPABLE.has(escaped)) {
          literal += escaped;
          text += escaped;
          this.i += 2;
          continue;
        }
      }
      if (ch === "*") {
        flush();
        parts.push(null);
        text += ch;
      } else {
        literal += ch;
        text += ch;
      }
      this.i++;
    }
    flush();
    return { text, parts };
  }

  private readQuoted(): string {
    const opened = this.i++;
    let text = "";
    while (this.i < this.chars.length) {
      const ch = this.chars[this.i] as string;
      if (ch === "\\" && this.chars[this.i + 1] !== undefined && ESCAPABLE.has(this.chars[this.i + 1] as string)) {
        text += this.chars[this.i + 1];
        this.i += 2;
        continue;
      }
      if (ch === '"') {
        this.i++;
        return text;
      }
      text += ch;
      this.i++;
    }
    throw new SyntaxProblem(`Unclosed quote at position ${opened + 1}.`, opened + 1);
  }

  private fieldValue(field: string, op: Operator, opStart: number): QueryNode {
    this.skipSpaces();
    const ch = this.chars[this.i];
    if (ch === undefined || ch === ")" || ch === "}" || this.atKeyword()) throw this.fail("Expected a value", ch === undefined ? this.chars.length : this.i);
    return this.valueAtom(field, op, opStart);
  }

  /** One value, or a parenthesised group of values joined by NOT, AND and OR. */
  private valueAtom(field: string, op: Operator, opStart: number): QueryNode {
    if (this.chars[this.i] !== "(") return this.valueLeaf(field, op, opStart);
    const opened = this.i++;
    const alternatives = [this.valueConjunction(field, op, opStart)];
    while (this.peekKeyword("OR")) {
      this.i += 2;
      alternatives.push(this.valueConjunction(field, op, opStart));
    }
    this.closing(")", opened);
    return alternatives.length === 1 ? (alternatives[0] as QueryNode) : { kind: "or", children: alternatives };
  }

  private valueConjunction(field: string, op: Operator, opStart: number): QueryNode {
    const terms = [this.valueTerm(field, op, opStart)];
    while (this.peekKeyword("AND")) {
      this.i += 3;
      terms.push(this.valueTerm(field, op, opStart));
    }
    this.skipSpaces();
    const next = this.chars[this.i];
    if (next !== undefined && next !== ")" && !this.peekKeyword("OR")) throw this.fail("Expected AND or OR", this.i);
    return terms.length === 1 ? (terms[0] as QueryNode) : { kind: "and", children: terms };
  }

  private valueTerm(field: string, op: Operator, opStart: number): QueryNode {
    if (this.peekKeyword("NOT")) {
      this.i += 3;
      return { kind: "not", child: this.valueTerm(field, op, opStart) };
    }
    this.skipSpaces();
    const ch = this.chars[this.i];
    if (ch === undefined || ch === ")" || this.atKeyword()) throw this.fail("Expected a value", ch === undefined ? this.chars.length : this.i);
    return this.valueAtom(field, op, opStart);
  }

  private valueLeaf(field: string, op: Operator, opStart: number): QueryNode {
    const valueStart = this.i;
    if (this.chars[this.i] === '"') {
      const text = this.readQuoted();
      return this.leaf(field, op, { parts: [text], quoted: true, exists: false }, valueStart, opStart);
    }
    const word = this.readWord(false);
    const exists = op === ":" && word.parts.length === 1 && word.parts[0] === null;
    return this.leaf(field, op, { parts: word.parts, quoted: false, exists }, valueStart, opStart);
  }

  /** Builds a leaf and applies the type rules: wildcard, range and number checks, each at its published position. */
  private leaf(field: string, op: Operator, value: { parts: ValueParts; quoted: boolean; exists: boolean }, valueStart: number, opStart: number): Leaf {
    const types = this.schema.typesOf(field);
    const type = types[0] ?? "text";
    const text = value.parts.map((part) => part ?? "*").join("");
    if (!value.exists) {
      if (value.parts.includes(null) && !types.some((t) => t === "text" || t === "keyword")) {
        throw this.fail(`Wildcard not allowed on ${type} field ${field}`, valueStart + this.wildcardOffset(valueStart));
      }
      if (op !== ":" && !types.some((t) => t === "number" || t === "date")) throw this.fail(`Range not allowed on ${type} field ${field}`, opStart);
      if (type === "number" && (op !== ":" || types.every((t) => t === "number")) && !/^-?\d+(\.\d+)?$/.test(text)) {
        throw this.fail("Expected a number", valueStart);
      }
      if (type === "date" && parseQueryDate(text, this.nowMs) === null) throw this.fail("Expected a value", valueStart);
      if (type === "boolean" && text !== "true" && text !== "false") throw this.fail("Expected a value", valueStart);
    }
    return { kind: "leaf", field, op, exists: value.exists, quoted: value.quoted, parts: value.parts };
  }

  private wildcardOffset(valueStart: number): number {
    let offset = 0;
    while (this.chars[valueStart + offset] !== "*" && valueStart + offset < this.chars.length) offset++;
    return offset;
  }
}

export function parseQuery(text: string, schema: QuerySchema, nowMs: number, positionOffset = 0): QueryNode {
  const chars = characters(text);
  const unclosed = firstUnclosed(chars);
  try {
    const node = new Parser(chars, schema, nowMs).parse();
    if (unclosed) throw unclosed;
    return node;
  } catch (error) {
    if (!(error instanceof SyntaxProblem)) throw error;
    const chosen = unclosed && unclosed.position <= error.position ? unclosed : error;
    const shifted = chosen.position + positionOffset;
    throw errors.querySyntax(chosen.sentence.replace(/position \d+\.$/, `position ${shifted}.`), shifted);
  }
}
