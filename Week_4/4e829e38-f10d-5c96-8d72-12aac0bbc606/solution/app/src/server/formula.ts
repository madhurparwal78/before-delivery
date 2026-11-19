/**
 * The formula language: lexer, parser, validation and evaluation. This file is the only place
 * that decides what a formula means.
 */
import { addDays, daysBetween, isIsoDate } from "./dates.js";

export class FormulaError extends Error {
  constructor(public position: number, reason: string) {
    super(`Formula error at character ${position}: ${reason}`);
  }
}

type Token =
  | { kind: "number"; value: number; at: number }
  | { kind: "string"; value: string; at: number }
  | { kind: "ref"; name: string; at: number }
  | { kind: "name"; name: string; at: number }
  | { kind: "op"; value: string; at: number }
  | { kind: "end"; at: number };

type Node =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "ref"; name: string; at: number }
  | { type: "negate"; operand: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[]; at: number };

const ARITY: Record<string, { min: number; max: number }> = {
  ROUND: { min: 2, max: 2 },
  IF: { min: 3, max: 3 },
  ISBLANK: { min: 1, max: 1 },
  DAYS: { min: 2, max: 2 },
  CONCAT: { min: 1, max: Infinity },
};

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const at = i + 1;
    if (/\s/.test(char)) {
      i += 1;
    } else if (/\d/.test(char) || (char === "." && /\d/.test(text[i + 1] ?? ""))) {
      const match = /^\d*\.?\d+/.exec(text.slice(i))!;
      tokens.push({ kind: "number", value: Number(match[0]), at });
      i += match[0].length;
    } else if (char === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) throw new FormulaError(text.length + 1, 'expected "');
      tokens.push({ kind: "string", value: text.slice(i + 1, close), at });
      i = close + 1;
    } else if (char === "{") {
      const close = text.indexOf("}", i + 1);
      if (close < 0) throw new FormulaError(text.length + 1, "expected }");
      tokens.push({ kind: "ref", name: text.slice(i + 1, close), at });
      i = close + 1;
    } else if (/[A-Za-z]/.test(char)) {
      const match = /^[A-Za-z]+/.exec(text.slice(i))!;
      tokens.push({ kind: "name", name: match[0], at });
      i += match[0].length;
    } else if (["<=", ">=", "!="].includes(text.slice(i, i + 2))) {
      tokens.push({ kind: "op", value: text.slice(i, i + 2), at });
      i += 2;
    } else if ("+-*/()<>=,".includes(char)) {
      tokens.push({ kind: "op", value: char, at });
      i += 1;
    } else {
      throw new FormulaError(at, `unexpected character ${char}`);
    }
  }
  tokens.push({ kind: "end", at: text.length + 1 });
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  parse(): Node {
    const node = this.comparison();
    if (this.peek().kind !== "end") throw new FormulaError(this.peek().at, "expected end of formula");
    return node;
  }

  private comparison(): Node {
    let left = this.additive();
    for (;;) {
      const token = this.peek();
      if (token.kind === "op" && [">", "<", ">=", "<=", "=", "!="].includes(token.value)) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.additive() };
      } else return left;
    }
  }

  private additive(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token.kind === "op" && (token.value === "+" || token.value === "-")) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.term() };
      } else return left;
    }
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.kind === "op" && (token.value === "*" || token.value === "/")) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.unary() };
      } else return left;
    }
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.index += 1;
      return { type: "negate", operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();
    if (token.kind === "number") {
      this.index += 1;
      return { type: "number", value: token.value };
    }
    if (token.kind === "string") {
      this.index += 1;
      return { type: "string", value: token.value };
    }
    if (token.kind === "ref") {
      this.index += 1;
      return { type: "ref", name: token.name, at: token.at };
    }
    if (token.kind === "name") {
      this.index += 1;
      if (!this.isOp("(")) throw new FormulaError(token.at, `unexpected character ${token.name[0]}`);
      if (!(token.name in ARITY)) throw new FormulaError(token.at, `unknown function ${token.name}`);
      this.index += 1;
      const args: Node[] = [];
      if (!this.isOp(")")) {
        for (;;) {
          args.push(this.comparison());
          if (this.isOp(",")) this.index += 1;
          else break;
        }
      }
      if (!this.isOp(")")) throw new FormulaError(this.peek().at, "expected )");
      this.index += 1;
      this.checkArity(token.name, args.length, token.at);
      return { type: "call", name: token.name, args, at: token.at };
    }
    if (this.isOp("(")) {
      this.index += 1;
      const inner = this.comparison();
      if (!this.isOp(")")) throw new FormulaError(this.peek().at, "expected )");
      this.index += 1;
      return inner;
    }
    throw new FormulaError(token.at, "expected a value");
  }

  private checkArity(name: string, count: number, at: number): void {
    const { min, max } = ARITY[name];
    if (count >= min && count <= max) return;
    const noun = (n: number) => `${n} argument${n === 1 ? "" : "s"}`;
    throw new FormulaError(at, max === Infinity ? `${name} needs at least ${noun(min)}` : `${name} needs ${noun(min)}`);
  }
}

function parseFormula(text: string, maxChars: number): Node {
  if (text.length > maxChars) {
    throw new FormulaError(maxChars + 1, `formula is longer than ${maxChars} characters`);
  }
  return new Parser(tokenize(text)).parse();
}

function references(node: Node): Array<{ name: string; at: number }> {
  switch (node.type) {
    case "ref":
      return [{ name: node.name, at: node.at }];
    case "negate":
      return references(node.operand);
    case "binary":
      return [...references(node.left), ...references(node.right)];
    case "call":
      return node.args.flatMap(references);
    default:
      return [];
  }
}

export interface FormulaField {
  id: string;
  name: string;
  type: string;
  formula: string | null;
}

export const BUILT_IN_FIELDS = ["Start", "Due", "Effort"];

/** Rewrites `{Old}` references to `{New}` when a field is renamed. */
export function renameReference(formula: string, from: string, to: string): string {
  return formula.split(`{${from}}`).join(`{${to}}`);
}

/** Parse and check a formula for saving: unknown fields and circular references are refused. */
export function validateFormula(text: string, ownName: string, fields: FormulaField[], maxChars: number): void {
  const root = parseFormula(text, maxChars);
  const refs = references(root);
  for (const ref of refs) {
    if (!BUILT_IN_FIELDS.includes(ref.name) && !fields.some((f) => f.name === ref.name)) {
      throw new FormulaError(ref.at, `unknown field ${ref.name}`);
    }
  }
  const leadsBack = (name: string, seen: Set<string>): boolean => {
    if (name === ownName) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const field = fields.find((f) => f.name === name && f.type === "formula" && f.formula);
    if (!field) return false;
    try {
      return references(parseFormula(field.formula!, Infinity)).some((r) => leadsBack(r.name, seen));
    } catch {
      return false;
    }
  };
  for (const ref of refs) {
    if (leadsBack(ref.name, new Set())) throw new FormulaError(ref.at, `circular reference to ${ref.name}`);
  }
}

type FormulaErrorCode = "#DIV/0" | "#VALUE" | "#REF" | "#BUDGET";
type Value = number | string | boolean | null | { date: string } | { error: FormulaErrorCode } | string[];

const fail = (error: FormulaErrorCode): Value => ({ error });
const isError = (v: Value): v is { error: FormulaErrorCode } => typeof v === "object" && v !== null && "error" in v;
const isDate = (v: Value): v is { date: string } => typeof v === "object" && v !== null && "date" in v;
const isBlank = (v: Value) => v === null;

class BudgetExceeded extends Error {}

interface TaskInputs {
  start: string | null;
  due: string | null;
  effort: number | null;
  values: Record<string, unknown>;
}

function inputValue(field: FormulaField & { options?: unknown }, task: TaskInputs): Value {
  const raw = task.values[field.id];
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.type === "number") return typeof raw === "number" ? raw : fail("#VALUE");
  if (field.type === "date") return typeof raw === "string" && isIsoDate(raw) ? { date: raw } : fail("#VALUE");
  if (field.type === "multi_select") return Array.isArray(raw) ? (raw.length ? (raw as string[]) : null) : fail("#VALUE");
  return String(raw);
}

function numberText(n: number): string {
  return String(roundTo(n, 10));
}

function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(value)}e${places}`));
  const result = Number(`${shifted}e${-places}`);
  return Number.isNaN(result) ? sign * Math.round(Math.abs(value)) : sign * result;
}

function format(value: Value): string {
  if (value === null) return "";
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (isDate(value)) return value.date;
  if (isError(value)) return value.error;
  return value;
}

class Evaluation {
  private steps = 0;
  private cache = new Map<string, { value: Value; steps: number }>();
  constructor(private task: TaskInputs, private fields: FormulaField[], private maxSteps: number) {}

  run(field: FormulaField): Value {
    try {
      return this.field(field, []);
    } catch (error) {
      if (error instanceof BudgetExceeded) return fail("#BUDGET");
      throw error;
    }
  }

  private spend(count = 1): void {
    this.steps += count;
    if (this.steps > this.maxSteps) throw new BudgetExceeded();
  }

  private field(field: FormulaField, path: string[]): Value {
    const cached = this.cache.get(field.id);
    if (cached) {
      this.spend(cached.steps);
      return cached.value;
    }
    if (path.includes(field.id) || !field.formula) return fail("#REF");
    let root: Node;
    try {
      root = parseFormula(field.formula, Infinity);
    } catch {
      return fail("#VALUE");
    }
    const before = this.steps;
    const value = this.node(root, [...path, field.id]);
    this.cache.set(field.id, { value, steps: this.steps - before });
    return value;
  }

  private reference(name: string, path: string[]): Value {
    if (name === "Start") return this.task.start ? { date: this.task.start } : null;
    if (name === "Due") return this.task.due ? { date: this.task.due } : null;
    if (name === "Effort") return this.task.effort;
    const field = this.fields.find((f) => f.name === name);
    if (!field) return fail("#REF");
    return field.type === "formula" ? this.field(field, path) : inputValue(field, this.task);
  }

  private node(node: Node, path: string[]): Value {
    switch (node.type) {
      case "number":
        this.spend();
        return node.value;
      case "string":
        this.spend();
        return node.value;
      case "ref":
        this.spend();
        return this.reference(node.name, path);
      case "negate": {
        this.spend();
        const operand = this.node(node.operand, path);
        if (isError(operand)) return operand;
        if (isBlank(operand)) return 0;
        return typeof operand === "number" ? 0 - operand : fail("#VALUE");
      }
      case "binary": {
        this.spend();
        const left = this.node(node.left, path);
        const right = this.node(node.right, path);
        return this.binary(node.op, left, right);
      }
      case "call":
        this.spend();
        return this.call(node, path);
    }
  }

  private binary(op: string, left: Value, right: Value): Value {
    if (isError(left)) return left;
    if (isError(right)) return right;
    if (["+", "-"].includes(op)) return this.sum(op, left, right);
    if (["*", "/"].includes(op)) {
      if (isBlank(left) || isBlank(right)) return null;
      if (typeof left !== "number" || typeof right !== "number") return fail("#VALUE");
      if (op === "*") return left * right;
      return right === 0 ? fail("#DIV/0") : left / right;
    }
    return this.compare(op, left, right);
  }

  private sum(op: string, left: Value, right: Value): Value {
    const sign = op === "+" ? 1 : -1;
    const l = isBlank(left) ? 0 : left;
    const r = isBlank(right) ? 0 : right;
    if (typeof l === "number" && typeof r === "number") return l + sign * r;
    if (isDate(l) && typeof r === "number") return { date: addDays(l.date, sign * r) };
    if (op === "+" && typeof l === "number" && isDate(r)) return { date: addDays(r.date, l) };
    return fail("#VALUE");
  }

  private compare(op: string, left: Value, right: Value): Value {
    if (isBlank(left) || isBlank(right)) return false;
    const a = isDate(left) ? left.date : left;
    const b = isDate(right) ? right.date : right;
    if (typeof a !== typeof b || Array.isArray(a) || Array.isArray(b)) {
      if (op === "=") return false;
      if (op === "!=") return true;
      return fail("#VALUE");
    }
    const x = a as number | string | boolean;
    const y = b as number | string | boolean;
    switch (op) {
      case "=":
        return x === y;
      case "!=":
        return x !== y;
      case ">":
        return x > y;
      case "<":
        return x < y;
      case ">=":
        return x >= y;
      default:
        return x <= y;
    }
  }

  private call(node: Extract<Node, { type: "call" }>, path: string[]): Value {
    if (node.name === "IF") {
      const test = this.node(node.args[0], path);
      if (isError(test)) return test;
      if (test !== null && typeof test !== "boolean") return fail("#VALUE");
      return this.node(node.args[test === true ? 1 : 2], path);
    }
    const args = node.args.map((arg) => this.node(arg, path));
    const failed = args.find(isError);
    if (failed) return failed;
    switch (node.name) {
      case "ROUND": {
        const [x, places] = args;
        if (isBlank(x)) return null;
        if (typeof x !== "number" || (!isBlank(places) && typeof places !== "number")) return fail("#VALUE");
        return roundTo(x, Math.trunc((places as number | null) ?? 0));
      }
      case "ISBLANK":
        return isBlank(args[0]) || args[0] === "";
      case "DAYS": {
        const [from, to] = args;
        if (isBlank(from) || isBlank(to)) return null;
        if (!isDate(from) || !isDate(to)) return fail("#VALUE");
        return daysBetween(from.date, to.date);
      }
      default:
        return args.map(format).join("");
    }
  }
}

/** Compute every formula field of one task, as JSON values keyed by field id. */
export function evaluateFormulas(
  task: TaskInputs,
  fields: FormulaField[],
  maxSteps: number,
): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  for (const field of fields.filter((f) => f.type === "formula")) {
    const value = new Evaluation(task, fields, maxSteps).run(field);
    out[field.id] = toJson(value);
  }
  return out;
}

function toJson(value: Value): number | string | boolean | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundTo(value, 10) : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.join(", ");
  if (isDate(value)) return value.date;
  return value.error;
}
