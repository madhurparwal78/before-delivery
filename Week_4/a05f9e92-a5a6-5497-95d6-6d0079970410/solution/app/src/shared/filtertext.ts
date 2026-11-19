import { ExpressionError, parse, type Node, type Value } from "./expression.js";

export type FilterOperator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "startswith" | "in" | "is_empty" | "not_is_empty";
export type FilterValue = Value | { call: "me" };

interface Condition {
  path: string;
  op: FilterOperator;
  value: FilterValue;
}

export interface Group {
  connector: "and" | "or";
  conditions: Condition[];
}

export interface Builder {
  connector: "and" | "or";
  groups: Group[];
}

export class FilterError extends Error {
  constructor(
    readonly code: "filter_too_complex" | "expression_error",
    message: string,
  ) {
    super(message);
  }
}

const TOO_COMPLEX = "This filter cannot be shown in the builder.";
const OPERATORS = new Set(["=", "!=", "<", "<=", ">", ">=", "contains", "startswith", "in"]);

function tooComplex(): never {
  throw new FilterError("filter_too_complex", TOO_COMPLEX);
}

function valueOf(node: Node): FilterValue {
  if (node.kind === "literal") return node.value;
  if (node.kind === "negate" && node.operand.kind === "literal" && typeof node.operand.value === "number") return -node.operand.value;
  if (node.kind === "list") return node.items.map((item) => valueOf(item) as Value);
  if (node.kind === "call" && node.name === "me" && node.args.length === 0) return { call: "me" };
  return tooComplex();
}

function conditionOf(node: Node, parenthesised = false): Condition {
  // The published grammar puts parentheses around groups only, never around a condition inside one.
  if (node.paren && !parenthesised) return tooComplex();
  if (node.kind === "call" && node.name === "is_empty" && node.args.length === 1 && node.args[0]!.kind === "path") {
    return { path: (node.args[0] as { parts: string[] }).parts.join("."), op: "is_empty", value: null };
  }
  if (node.kind === "not" && node.operand.kind === "call" && node.operand.name === "is_empty" && node.operand.args.length === 1 && node.operand.args[0]!.kind === "path") {
    return { path: (node.operand.args[0] as { parts: string[] }).parts.join("."), op: "not_is_empty", value: null };
  }
  if (node.kind === "binary" && OPERATORS.has(node.op) && node.left.kind === "path") {
    return { path: node.left.parts.join("."), op: node.op as FilterOperator, value: valueOf(node.right) };
  }
  return tooComplex();
}

function chain(node: Node, op: "and" | "or"): Node[] {
  if (node.kind === "binary" && node.op === op && !node.paren) return [...chain(node.left, op), ...chain(node.right, op)];
  return [node];
}

function groupOf(node: Node): Group {
  // `((a = 1))` is not a group of one condition: the grammar allows one pair of parentheses per group.
  if ((node.parens ?? 0) > 1) tooComplex();
  if (node.kind === "binary" && (node.op === "and" || node.op === "or")) {
    if (!node.paren) tooComplex();
    const connector = node.op;
    const parts = chain({ ...node, paren: false }, connector);
    if (parts.some((part) => part.kind === "binary" && (part.op === "and" || part.op === "or"))) tooComplex();
    return { connector, conditions: parts.map((part) => conditionOf(part)) };
  }
  return { connector: "and", conditions: [conditionOf(node, true)] };
}

/** Reads filter text (the published subset of the expression language) into a builder. */
export function parseFilter(text: string): Builder {
  if (text.trim() === "") return { connector: "and", groups: [] };
  let root: Node;
  try {
    root = parse(text);
  } catch (error) {
    if (error instanceof ExpressionError) throw new FilterError("expression_error", error.message);
    throw error;
  }
  if (root.kind === "binary" && (root.op === "and" || root.op === "or") && !root.paren) {
    const connector = root.op;
    const operands = chain(root, connector);
    return { connector, groups: operands.map(groupOf) };
  }
  return { connector: "and", groups: [groupOf(root)] };
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function valueText(value: FilterValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${value.map((v) => valueText(v)).join(", ")}]`;
  return "me()";
}

function conditionText(c: Condition): string {
  if (c.op === "is_empty") return `is_empty(${c.path})`;
  if (c.op === "not_is_empty") return `not is_empty(${c.path})`;
  return `${c.path} ${c.op} ${valueText(c.value)}`;
}

function groupText(group: Group): string {
  return group.conditions.map(conditionText).join(` ${group.connector} `);
}

/** Canonical filter text for a builder. */
export function composeFilter(builder: Builder): string {
  const groups = builder.groups.filter((g) => g.conditions.length > 0);
  if (groups.length === 0) return "";
  if (groups.length === 1) return groupText(groups[0]!);
  return groups.map((g) => `(${groupText(g)})`).join(` ${builder.connector} `);
}

/** The filter as an expression tree the interpreter can run; groups are combined with the builder's connectors. */
export function filterNode(builder: Builder): Node | null {
  const conditionNode = (c: Condition): Node => {
    const path: Node = { kind: "path", parts: c.path.split("."), col: 1 };
    if (c.op === "is_empty") return { kind: "call", name: "is_empty", args: [path], col: 1 };
    if (c.op === "not_is_empty") return { kind: "not", operand: { kind: "call", name: "is_empty", args: [path], col: 1 }, col: 1 };
    const right: Node = isCall(c.value) ? { kind: "call", name: "me", args: [], col: 1 } : literalNode(c.value);
    return { kind: "binary", op: c.op, left: path, right, col: 1 };
  };
  const join = (nodes: Node[], op: "and" | "or"): Node => nodes.slice(1).reduce<Node>((left, right) => ({ kind: "binary", op, left, right, col: 1 }), nodes[0]!);
  const groups = builder.groups.filter((g) => g.conditions.length > 0).map((g) => join(g.conditions.map(conditionNode), g.connector));
  return groups.length === 0 ? null : join(groups, builder.connector);
}

function isCall(value: FilterValue): value is { call: "me" } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function literalNode(value: Value): Node {
  return Array.isArray(value) ? { kind: "list", items: value.map(literalNode), col: 1 } : { kind: "literal", value, col: 1 };
}
