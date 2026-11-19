import {
  columnByName,
  tableByName,
  type ColumnData,
  type DocData,
  type TableData,
} from '../model.js';
import { readFormula, type Argument, type Expr, type NamePart } from './read.js';

type Replacement = { start: number; end: number; text: string };

function splice(text: string, replacements: Replacement[]): string {
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let out = text;
  for (const replacement of ordered) {
    out = `${out.slice(0, replacement.start)}${replacement.text}${out.slice(replacement.end)}`;
  }
  return out;
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Follows a traversal chain statically, so each link knows the table it reads. */
function walkFieldPath(
  path: NamePart[],
  table: TableData,
  doc: DocData,
  visit: (part: NamePart, inTable: TableData) => void,
): void {
  let current: TableData | undefined = table;
  for (const [index, part] of path.entries()) {
    if (current === undefined) return;
    visit(part, current);
    const column: ColumnData | undefined = columnByName(current, part.name);
    if (column === undefined) return;
    if (index === path.length - 1) return;
    if (column.type !== 'reference' || column.targetTableId === null) return;
    current = doc.tables.find((candidate) => candidate.id === column.targetTableId);
  }
}

type Visitor = {
  field: (part: NamePart, inTable: TableData) => void;
  aggregateTable: (part: NamePart, target: TableData) => void;
  aggregateColumn: (part: NamePart, target: TableData) => void;
};

function walkExpr(expr: Expr, table: TableData, doc: DocData, visitor: Visitor): void {
  switch (expr.k) {
    case 'number':
    case 'string':
    case 'bool':
      return;
    case 'unary':
      walkExpr(expr.expr, table, doc, visitor);
      return;
    case 'binary':
      walkExpr(expr.left, table, doc, visitor);
      walkExpr(expr.right, table, doc, visitor);
      return;
    case 'field':
      walkFieldPath(expr.path, table, doc, visitor.field);
      return;
    case 'call':
      for (const arg of expr.args) walkArgument(arg, table, doc, visitor);
      return;
  }
}

function walkArgument(arg: Argument, table: TableData, doc: DocData, visitor: Visitor): void {
  if (arg.k === 'expr') {
    walkExpr(arg.expr, table, doc, visitor);
    return;
  }
  const target = tableByName(doc, arg.table.name);
  if (target === undefined) return;
  visitor.aggregateTable(arg.table, target);
  if (arg.k === 'tableColumn') visitor.aggregateColumn(arg.column, target);
}

function rewriteFormulas(
  doc: DocData,
  collect: (
    table: TableData,
    expr: Expr,
    push: (part: NamePart, text: string) => void,
  ) => void,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const table of doc.tables) {
    if (table.kind === 'summary') continue;
    for (const column of table.columns) {
      if (column.type !== 'formula' || column.formula === null) continue;
      const read = readFormula(column.formula);
      if (!read.ok) continue;
      const replacements: Replacement[] = [];
      collect(table, read.expr, (part, text) => {
        replacements.push({ start: part.start, end: part.end, text });
      });
      if (replacements.length === 0) continue;
      const rewritten = splice(column.formula, replacements);
      if (rewritten !== column.formula) out.set(column.id, rewritten);
    }
  }
  return out;
}

export function rewriteForColumnRename(
  doc: DocData,
  renamed: { tableId: string; oldName: string; newName: string },
): Map<string, string> {
  return rewriteFormulas(doc, (table, expr, push) => {
    walkExpr(expr, table, doc, {
      field: (part, inTable) => {
        if (inTable.id === renamed.tableId && sameName(part.name, renamed.oldName)) {
          push(part, renamed.newName);
        }
      },
      aggregateTable: () => undefined,
      aggregateColumn: (part, target) => {
        if (target.id === renamed.tableId && sameName(part.name, renamed.oldName)) {
          push(part, renamed.newName);
        }
      },
    });
  });
}

export function rewriteForTableRename(
  doc: DocData,
  renamed: { tableId: string; oldName: string; newName: string },
): Map<string, string> {
  return rewriteFormulas(doc, (table, expr, push) => {
    walkExpr(expr, table, doc, {
      field: () => undefined,
      aggregateTable: (part, target) => {
        if (target.id === renamed.tableId && sameName(part.name, renamed.oldName)) {
          push(part, renamed.newName);
        }
      },
      aggregateColumn: () => undefined,
    });
  });
}
