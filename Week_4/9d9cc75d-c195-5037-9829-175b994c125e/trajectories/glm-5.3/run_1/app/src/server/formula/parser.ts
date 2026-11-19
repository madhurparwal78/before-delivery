import type { Token } from "./lexer.js";
import { lexFormula } from "./lexer.js";

export type FormulaType = "number" | "text" | "date" | "boolean";

export interface FieldInfo {
  id: string;
  name: string;
  type: "number" | "text" | "date" | "boolean";
  kind: "dimension" | "measure";
}

export interface CalcInfo {
  id: string;
  name: string;
  formula: string;
}

export interface ParameterInfo {
  name: string;
  type: "number" | "text" | "list";
  value: string | number;
  values: string[];
}

export interface SetInfo {
  name: string;
  field: string;
  members: string[] | null;
  top: { n: number | string; by: { field: string; agg: string } | null } | null;
}

export interface CheckContext {
  fields: FieldInfo[];
  calcs: CalcInfo[];
  parameters: ParameterInfo[];
  sets: SetInfo[];
  formulaMaxDepth: number;
}

export interface FormulaError {
  message: string;
  line: number | null;
  column: number | null;
}

export type Node =
  | { kind: "number"; value: number; line: number; column: number }
  | { kind: "text"; value: string; line: number; column: number }
  | { kind: "boolean"; value: boolean; line: number; column: number }
  | { kind: "null"; line: number; column: number }
  | { kind: "field"; id: string; name: string; line: number; column: number }
  | { kind: "parameter"; name: string; line: number; column: number }
  | { kind: "set"; name: string; line: number; column: number }
  | { kind: "call"; fn: string; word: string; args: Node[]; line: number; column: number }
  | { kind: "binary"; op: string; left: Node; right: Node; line: number; column: number }
  | { kind: "unary"; op: string; operand: Node; line: number; column: number }
  | { kind: "lod"; form: "at" | "plus" | "minus" | "whole"; dims: Node[]; body: Node; line: number; column: number };

export interface ParsedFormula {
  node: Node | null;
  error: FormulaError | null;
}

const AGG_FUNCTIONS = new Set(["SUM", "AVG", "MEDIAN", "MIN", "MAX", "COUNT", "COUNT_UNIQUE"]);
const TABLE_CALC_FUNCTIONS = new Set(["RUN_TOTAL", "PREV_DIFF", "SHARE", "RANK_OF"]);
const FUNCTION_ARITY: Record<string, number> = {
  SUM: 1, AVG: 1, MEDIAN: 1, MIN: 1, MAX: 1, COUNT: 1, COUNT_UNIQUE: 1,
  IF: 3, IFNULL: 2, ISNULL: 1,
  ABS: 1, ROUND: 2,
  UPPER: 1, LOWER: 1, LEN: 1, LEFT: 2, RIGHT: 2, CONTAINS: 2,
  PART_OF: 2, TRUNC_TO: 2, DAYS_BETWEEN: 2,
  NUM: 1, TEXT: 1,
  RUN_TOTAL: 1, PREV_DIFF: 1, SHARE: 1, RANK_OF: 1,
};

export function isAggregateName(fn: string): boolean {
  return AGG_FUNCTIONS.has(fn);
}

export function isTableCalcName(fn: string): boolean {
  return TABLE_CALC_FUNCTIONS.has(fn);
}

interface ParserState {
  tokens: Token[];
  pos: number;
  ctx: CheckContext;
  depth: number;
  maxDepth: number;
  inAggregate: number;
  inLod: boolean;
  inTableCalc: boolean;
}

function peek(s: ParserState): Token {
  return s.tokens[s.pos] ?? s.tokens[s.tokens.length - 1];
}
function next(s: ParserState): Token {
  return s.tokens[s.pos++] ?? s.tokens[s.tokens.length - 1];
}

function depthError(s: ParserState, t: Token): FormulaError {
  return {
    message: `Line ${t.line}, column ${t.column}: nested deeper than ${s.ctx.formulaMaxDepth} levels.`,
    line: t.line,
    column: t.column,
  };
}

/**
 * Grammar, precedence lowest first: OR; AND; NOT; comparisons;
 * + - &; * / %; unary -.
 */
export function parseFormula(source: string, ctx: CheckContext): ParsedFormula {
  const lexed = lexFormula(source);
  if (lexed.error) return { node: null, error: lexed.error };
  const s: ParserState = {
    tokens: lexed.tokens,
    pos: 0,
    ctx,
    depth: 0,
    maxDepth: ctx.formulaMaxDepth,
    inAggregate: 0,
    inLod: false,
    inTableCalc: false,
  };
  const node = parseOr(s, 0);
  if (node.error) return node;
  if (s.pos < s.tokens.length - 1) {
    const t = peek(s);
    return { node: null, error: { message: `Line ${t.line}, column ${t.column}: unexpected "${t.text}".`, line: t.line, column: t.column } };
  }
  return { node: node.node, error: null };
}

interface ParseResult {
  node: Node | null;
  error: FormulaError | null;
}

function parseOr(s: ParserState, depth: number): ParseResult {
  let left = parseAnd(s, depth);
  if (left.error) return left;
  while (peek(s).type === "keyword" && peek(s).upper === "OR") {
    const t = next(s);
    const right = parseAnd(s, depth);
    if (right.error) return right;
    if (left.node && right.node) {
      left = { node: { kind: "binary", op: "OR", left: left.node, right: right.node, line: t.line, column: t.column }, error: null };
    } else return { node: null, error: null };
  }
  return left;
}

function parseAnd(s: ParserState, depth: number): ParseResult {
  let left = parseNot(s, depth);
  if (left.error) return left;
  while (peek(s).type === "keyword" && peek(s).upper === "AND") {
    const t = next(s);
    const right = parseNot(s, depth);
    if (right.error) return right;
    if (left.node && right.node) {
      left = { node: { kind: "binary", op: "AND", left: left.node, right: right.node, line: t.line, column: t.column }, error: null };
    } else return { node: null, error: null };
  }
  return left;
}

function parseNot(s: ParserState, depth: number): ParseResult {
  if (peek(s).type === "keyword" && peek(s).upper === "NOT") {
    const t = next(s);
    const operand = parseNot(s, depth);
    if (operand.error) return operand;
    return { node: { kind: "unary", op: "NOT", operand: operand.node!, line: t.line, column: t.column }, error: null };
  }
  return parseComparison(s, depth);
}

function parseComparison(s: ParserState, depth: number): ParseResult {
  const left = parseAdditive(s, depth);
  if (left.error) return left;
  const t = peek(s);
  if (t.type === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(t.text)) {
    next(s);
    const right = parseAdditive(s, depth);
    if (right.error) return right;
    return {
      node: { kind: "binary", op: t.text, left: left.node!, right: right.node!, line: t.line, column: t.column },
      error: null,
    };
  }
  return left;
}

function parseAdditive(s: ParserState, depth: number): ParseResult {
  let left = parseMultiplicative(s, depth);
  if (left.error) return left;
  while (peek(s).type === "op" && ["+", "-", "&"].includes(peek(s).text)) {
    const t = next(s);
    const right = parseMultiplicative(s, depth);
    if (right.error) return right;
    if (left.node && right.node) {
      left = { node: { kind: "binary", op: t.text, left: left.node, right: right.node, line: t.line, column: t.column }, error: null };
    }
  }
  return left;
}

function parseMultiplicative(s: ParserState, depth: number): ParseResult {
  let left = parseUnary(s, depth);
  if (left.error) return left;
  while (peek(s).type === "op" && ["*", "/", "%"].includes(peek(s).text)) {
    const t = next(s);
    const right = parseUnary(s, depth);
    if (right.error) return right;
    if (left.node && right.node) {
      left = { node: { kind: "binary", op: t.text, left: left.node, right: right.node, line: t.line, column: t.column }, error: null };
    }
  }
  return left;
}

function parseUnary(s: ParserState, depth: number): ParseResult {
  if (peek(s).type === "op" && peek(s).text === "-") {
    const t = next(s);
    if (depth + 1 > s.ctx.formulaMaxDepth) return { node: null, error: depthError(s, t) };
    const operand = parseUnary(s, depth + 1);
    if (operand.error) return operand;
    return { node: { kind: "unary", op: "-", operand: operand.node!, line: t.line, column: t.column }, error: null };
  }
  return parsePrimary(s, depth);
}

function parsePrimary(s: ParserState, depth: number): ParseResult {
  const t = peek(s);
  if (t.type === "end") {
    return { node: null, error: { message: `Line ${t.line}, column ${t.column}: formula ended early.`, line: t.line, column: t.column } };
  }
  if (t.type === "lparen") {
    // A parenthesis group opens one level; the error points at the token
    // opening level maxDepth + 1.
    if (depth + 1 > s.ctx.formulaMaxDepth) return { node: null, error: depthError(s, t) };
    next(s);
    const inner = parseOr(s, depth + 1);
    if (inner.error) return inner;
    const rt = peek(s);
    if (rt.type !== "rparen") {
      return {
        node: null,
        error: { message: `Line ${rt.line}, column ${rt.column}: unexpected "${rt.text}".`, line: rt.line, column: rt.column },
      };
    }
    next(s);
    return { node: inner.node, error: null };
  }
  if (t.type === "number") {
    next(s);
    return { node: { kind: "number", value: Number(t.text), line: t.line, column: t.column }, error: null };
  }
  if (t.type === "text") {
    next(s);
    return { node: { kind: "text", value: t.text, line: t.line, column: t.column }, error: null };
  }
  if (t.type === "boolean") {
    next(s);
    return { node: { kind: "boolean", value: t.text === "TRUE", line: t.line, column: t.column }, error: null };
  }
  if (t.type === "null") {
    next(s);
    return { node: { kind: "null", line: t.line, column: t.column }, error: null };
  }
  if (t.type === "parameter") {
    next(s);
    return { node: { kind: "parameter", name: t.text, line: t.line, column: t.column }, error: null };
  }
  if (t.type === "field") {
    next(s);
    return { node: { kind: "field", id: "", name: t.text, line: t.line, column: t.column }, error: null };
  }
  if (t.type === "lbrace") {
    return parseLod(s, depth);
  }
  if (t.type === "unknown") {
    // function name or error
    if (s.tokens[s.pos + 1]?.type === "lparen") {
      next(s);
      const lparen = next(s);
      if (depth + 1 > s.ctx.formulaMaxDepth) return { node: null, error: depthError(s, lparen) };
      const fn = t.upper;
      const args: Node[] = [];
      if (peek(s).type === "rparen") {
        next(s);
        return { node: { kind: "call", fn, word: t.text, args, line: t.line, column: t.column }, error: null };
      }
      if (TABLE_CALC_FUNCTIONS.has(fn)) {
        const wasTable = s.inTableCalc;
        s.inTableCalc = true;
        const arg = parseOr(s, depth + 1);
        s.inTableCalc = wasTable;
        if (arg.error) return arg;
        args.push(arg.node!);
      } else {
        const wasIn = s.inAggregate;
        if (AGG_FUNCTIONS.has(fn)) s.inAggregate++;
        const arg = parseOr(s, depth + 1);
        if (AGG_FUNCTIONS.has(fn)) s.inAggregate = wasIn;
        if (arg.error) return arg;
        args.push(arg.node!);
      }
      while (peek(s).type === "comma") {
        next(s);
        const arg = parseOr(s, depth + 1);
        if (arg.error) return arg;
        args.push(arg.node!);
      }
      const rt = peek(s);
      if (rt.type !== "rparen") {
        return {
          node: null,
          error: { message: `Line ${rt.line}, column ${rt.column}: unexpected "${rt.text}".`, line: rt.line, column: rt.column },
        };
      }
      next(s);
      return { node: { kind: "call", fn, word: t.text, args, line: t.line, column: t.column }, error: null };
    }
    return {
      node: null,
      error: { message: `Line ${t.line}, column ${t.column}: unexpected "${t.text}".`, line: t.line, column: t.column },
    };
  }
  return {
    node: null,
    error: { message: `Line ${t.line}, column ${t.column}: unexpected "${t.text}".`, line: t.line, column: t.column },
  };
}

function parseLod(s: ParserState, depth: number): ParseResult {
  const lb = next(s); // {
  if (depth + 1 > s.ctx.formulaMaxDepth) return { node: null, error: depthError(s, lb) };
  const start = peek(s);
  let form: "at" | "plus" | "minus" | "whole" = "whole";
  const dims: Node[] = [];
  if (start.type === "unknown" && ["AT", "PLUS", "MINUS"].includes(start.upper) && s.tokens[s.pos + 1]?.type === "field") {
    form = start.upper === "AT" ? "at" : start.upper === "PLUS" ? "plus" : "minus";
    next(s);
    let dimTok = next(s);
    if (dimTok.type !== "field") {
      return {
        node: null,
        error: { message: `Line ${dimTok.line}, column ${dimTok.column}: unexpected "${dimTok.text}".`, line: dimTok.line, column: dimTok.column },
      };
    }
    dims.push({ kind: "field", id: "", name: dimTok.text, line: dimTok.line, column: dimTok.column });
    while (peek(s).type === "comma") {
      next(s);
      dimTok = next(s);
      if (dimTok.type !== "field") {
        return {
          node: null,
          error: { message: `Line ${dimTok.line}, column ${dimTok.column}: unexpected "${dimTok.text}".`, line: dimTok.line, column: dimTok.column },
        };
      }
      dims.push({ kind: "field", id: "", name: dimTok.text, line: dimTok.line, column: dimTok.column });
    }
    const colon = next(s);
    if (colon.type !== "colon") {
      return {
        node: null,
        error: { message: `Line ${colon.line}, column ${colon.column}: unexpected "${colon.text}".`, line: colon.line, column: colon.column },
      };
    }
  }
  const wasLod = s.inLod;
  s.inLod = true;
  const body = parseOr(s, depth + 1);
  s.inLod = wasLod;
  if (body.error) return body;
  const rb = peek(s);
  if (rb.type !== "rbrace") {
    return {
      node: null,
      error: { message: `Line ${rb.line}, column ${rb.column}: unexpected "${rb.text}".`, line: rb.line, column: rb.column },
    };
  }
  next(s);
  return {
    node: { kind: "lod", form, dims, body: body.node!, line: lb.line, column: lb.column },
    error: null,
  };
}

/** Count nodes: every field, parameter, set, literal, operator and function call is one node. */
export function countNodes(node: Node | null): number {
  if (!node) return 0;
  switch (node.kind) {
    case "number":
    case "text":
    case "boolean":
    case "null":
    case "field":
    case "parameter":
    case "set":
      return 1;
    case "call":
      return 1 + node.args.reduce((acc, a) => acc + countNodes(a), 0);
    case "binary":
      return 1 + countNodes(node.left) + countNodes(node.right);
    case "unary":
      return 1 + countNodes(node.operand);
    case "lod":
      return 1 + node.dims.reduce((acc, d) => acc + countNodes(d), 0) + countNodes(node.body);
  }
}

/** The row-level part: the whole formula when no aggregate, else the nodes inside aggregate arguments. */
export function rowCountNodes(node: Node | null, inAgg: boolean): number {
  if (!node) return 0;
  switch (node.kind) {
    case "number":
    case "text":
    case "boolean":
    case "null":
    case "field":
    case "parameter":
    case "set":
      return inAgg ? 1 : 1;
    case "call":
      if (isAggregateName(node.fn)) {
        return node.args.reduce((acc, a) => acc + rowCountNodes(a, true), 0);
      }
      if (isTableCalcName(node.fn)) {
        return node.args.reduce((acc, a) => acc + rowCountNodes(a, true), 0);
      }
      return 1 + node.args.reduce((acc, a) => acc + rowCountNodes(a, inAgg), 0);
    case "binary":
      return 1 + rowCountNodes(node.left, inAgg) + rowCountNodes(node.right, inAgg);
    case "unary":
      return 1 + rowCountNodes(node.operand, inAgg);
    case "lod":
      return (
        1 +
        node.dims.reduce((acc, d) => acc + countNodes(d), 0) +
        rowCountNodes(node.body, inAgg)
      );
  }
}

/** Work nodes: the nodes of the row-level part of a formula. */
export function workNodes(node: Node | null): number {
  if (!node) return 0;
  const hasAgg = nodeHasAggregate(node);
  if (!hasAgg) return countNodes(node);
  return rowAggNodes(node, false);
}

function nodeHasAggregate(node: Node): boolean {
  switch (node.kind) {
    case "call":
      if (isAggregateName(node.fn)) return true;
      return node.args.some(nodeHasAggregate);
    case "binary":
      return nodeHasAggregate(node.left) || nodeHasAggregate(node.right);
    case "unary":
      return nodeHasAggregate(node.operand);
    case "lod":
      return nodeHasAggregate(node.body);
    default:
      return false;
  }
}

/** Nodes inside aggregate arguments only. */
function rowAggNodes(node: Node | null, inAgg: boolean): number {
  if (!node) return 0;
  switch (node.kind) {
    case "number":
    case "text":
    case "boolean":
    case "null":
    case "field":
    case "parameter":
    case "set":
      return inAgg ? 1 : 0;
    case "call":
      if (isAggregateName(node.fn)) {
        return node.args.reduce((acc, a) => acc + rowAggNodes(a, true), 0);
      }
      if (isTableCalcName(node.fn)) {
        return node.args.reduce((acc, a) => acc + rowAggNodes(a, true), 0);
      }
      if (!inAgg) return node.args.reduce((acc, a) => acc + rowAggNodes(a, false), 0);
      return 1 + node.args.reduce((acc, a) => acc + rowAggNodes(a, true), 0);
    case "binary":
      return rowAggNodes(node.left, inAgg) + rowAggNodes(node.right, inAgg) + (inAgg ? 1 : 0);
    case "unary":
      return rowAggNodes(node.operand, inAgg) + (inAgg ? 1 : 0);
    case "lod":
      return rowAggNodes(node.body, inAgg) + (inAgg ? 1 : 0);
  }
}

export const FUNCTION_NAMES = Object.keys(FUNCTION_ARITY);
export { FUNCTION_ARITY };
