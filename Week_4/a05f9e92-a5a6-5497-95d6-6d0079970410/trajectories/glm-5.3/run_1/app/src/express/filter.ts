// Filter text: the published subset of the expression language used by lists,
// saved filters, drill-downs and exports. Round-trips exactly with the builder.

import { ExpressionError, Node, parse } from './expression.js';

export type Value = number | string | boolean | null | Value[] | MeValue;
export interface MeValue { kind: 'me' }
export interface Condition { path: string; op: string; value: Value }
export interface Group { connector: 'and' | 'or'; conditions: Condition[] }
export interface Builder { connector: 'and' | 'or'; groups: Group[] }

export class FilterTooComplex extends Error {
  constructor() {
    super('This filter cannot be shown in the builder.');
    this.name = 'FilterTooComplex';
  }
}

/** Parse filter text into a builder plus canonical text. */
export function parseFilter(text: string, known: (path: string) => boolean): { builder: Builder; filter: string } {
  let ast: Node;
  try {
    ast = parse(text);
  } catch (e) {
    if (e instanceof ExpressionError) throw e;
    throw new FilterTooComplex();
  }
  const builder: Builder = text.trim()
    ? fromAst(ast, known)
    : { connector: 'and', groups: [{ connector: 'and', conditions: [] }] };
  return { builder, filter: compose(builder) };
}

/** A filter AST is a top-level chain of groups joined by one connector.
 *  Each group is a chain of conditions joined by one connector. */
function fromAst(node: Node, known: (path: string) => boolean): Builder {
  const groups: Node[] = [];
  const topConnectors: Array<'and' | 'or'> = [];

  function scanTop(n: Node): void {
    if (n.kind === 'and' || n.kind === 'or') {
      scanTop(n.left);
      scanTop(n.right);
      topConnectors.push(n.kind);
      return;
    }
    groups.push(n);
  }
  scanTop(node);

  if (topConnectors.length > 0) {
    const first = topConnectors[0];
    if (topConnectors.some(c => c !== first)) throw new FilterTooComplex();
  }

  const builderGroups = groups.map(g => groupFrom(g, known));
  return { connector: topConnectors[0] ?? 'and', groups: builderGroups };
}

/** One group node: a chain of conditions joined by one connector. */
function groupFrom(node: Node, known: (path: string) => boolean): Group {
  const conditions: Node[] = [];
  const connectors: Array<'and' | 'or'> = [];

  function scan(n: Node): void {
    if (n.kind === 'and' || n.kind === 'or') {
      scan(n.left);
      scan(n.right);
      connectors.push(n.kind);
      return;
    }
    conditions.push(n);
  }
  scan(node);

  if (connectors.length > 0) {
    const first = connectors[0];
    if (connectors.some(c => c !== first)) throw new FilterTooComplex();
  }

  return {
    connector: connectors[0] ?? 'and',
    conditions: conditions.map(c => conditionFrom(c, known)),
  };
}

function conditionFrom(node: Node, known: (path: string) => boolean): Condition {
  if (node.kind === 'call' && node.name === 'is_empty' && node.args.length === 1 && node.args[0].kind === 'path') {
    const path = (node.args[0] as { parts: string[] }).parts.join('.');
    if (!known(path)) throw unknownField(path);
    return { path, op: 'is_empty', value: null };
  }
  if (node.kind === 'not') {
    const inner = node.arg;
    if (inner.kind === 'call' && inner.name === 'is_empty' && inner.args.length === 1 && inner.args[0].kind === 'path') {
      const path = (inner.args[0] as { parts: string[] }).parts.join('.');
      if (!known(path)) throw unknownField(path);
      return { path, op: 'not is_empty', value: null };
    }
    throw new FilterTooComplex();
  }

  if (node.kind === 'cmp') {
    if (node.left.kind !== 'path') throw new FilterTooComplex();
    const path = node.left.parts.join('.');
    if (!known(path)) throw unknownField(path);
    return { path, op: node.op, value: valueOf(node.right) };
  }

  if (node.kind === 'in' || node.kind === 'contains' || node.kind === 'startswith') {
    if (node.left.kind !== 'path') throw new FilterTooComplex();
    const path = node.left.parts.join('.');
    if (!known(path)) throw unknownField(path);
    return { path, op: node.kind, value: valueOf(node.right) };
  }

  throw new FilterTooComplex();
}

function unknownField(path: string): Error {
  return new ExpressionError(1, `unknown field "${path}"`);
}

function valueOf(node: Node): Value {
  switch (node.kind) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'bool': return node.value;
    case 'null': return null;
    case 'list': return node.items.map(valueOf);
    case 'call':
      if (node.name === 'me') return { kind: 'me' };
      throw new FilterTooComplex();
    default:
      throw new FilterTooComplex();
  }
}

/** Canonical text: two or more groups each sit in parentheses; operators and
 *  connectors have exactly one space on each side. */
export function compose(builder: Builder): string {
  const rendered = builder.groups.map(conditionsText);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return rendered.join(` ${builder.connector} `);
}

function conditionsText(group: Group): string {
  const parts = group.conditions.map(renderCondition);
  if (parts.length <= 1) return parts[0] ?? '';
  return `(${parts.join(` ${group.connector} `)})`;
}

export function renderCondition(c: Condition): string {
  if (c.op === 'is_empty' || c.op === 'not is_empty') {
    return c.op === 'is_empty' ? `is_empty(${c.path})` : `not is_empty(${c.path})`;
  }
  return `${c.path} ${c.op} ${renderValue(c.value)}`;
}

export function renderValue(v: Value): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(v)) return `[${v.map(renderValue).join(', ')}]`;
  return 'me()';
}

/** Numbers: no plus sign, no leading zeros, a decimal point only when fractional. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const text = String(n);
  if (text.includes('e') || text.includes('E')) {
    return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  return text;
}
