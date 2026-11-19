/**
 * Rename rewriting: one place rewrites every formula token and summary name
 * that names a renamed column or table, byte for byte everywhere else.
 */
import { DocState, Column } from './docstate.js';
import { tokenize, Token } from './formula.js';

export interface Rewrite {
  columnId: string;
  before: string;
  after: string;
}

const columnOf = (state: DocState, tableId: string, name: string) => {
  const lower = name.toLowerCase();
  return state.tableColumns(tableId).find((c) => c.name.toLowerCase() === lower);
};

const tableNamed = (state: DocState, name: string) => {
  const lower = name.toLowerCase();
  return state.tables.find((t) => t.name.toLowerCase() === lower);
};

/**
 * Rewrite every formula that names `oldName` in the document for a column
 * rename. Returns the changed formula texts with their column ids.
 */
export function rewriteColumnRename(
  state: DocState,
  tableId: string,
  oldName: string,
  newName: string,
): Rewrite[] {
  const out: Rewrite[] = [];
  for (const table of state.tables) {
    if (table.kind === 'summary') continue;
    for (const column of state.tableColumns(table.id)) {
      if (column.type !== 'formula' || !column.formula) continue;
      const after = rewriteColumnInFormula(state, column.formula, table.id, tableId, oldName, newName);
      if (after !== column.formula) {
        out.push({ columnId: column.id, before: column.formula, after });
      }
    }
  }
  return out;
}

function rewriteColumnInFormula(
  state: DocState,
  formula: string,
  ownTableId: string,
  renamedTableId: string,
  oldName: string,
  newName: string,
): string {
  const stripped = formula.startsWith('=') ? formula.slice(1) : formula;
  const { tokens } = tokenize(stripped, 0);
  if (!tokens) return formula;
  const t = tokens;
  const edits: { start: number; end: number; text: string }[] = [];

  const isOld = (name: string): boolean => name.toLowerCase() === oldName.toLowerCase();

  const rewriteBracket = (tok: Token): void => {
    if (isOld(tok.text)) {
      edits.push({ start: tok.start + 1, end: tok.end - 1, text: newName });
    }
  };

  for (let i = 0; i < t.length; i++) {
    const tok = t[i]!;
    if (tok.type === 'string' || tok.type === 'name' || tok.type === 'func' || tok.type === 'rparen' ||
        tok.type === 'lparen' || tok.type === 'comma' || tok.type === 'number' || tok.type === 'op' && tok.text !== '.') {
      continue;
    }
    if (tok.type === 'bracket') {
      // aggregate argument `T.[C]`: bracket preceded by name + point
      const prevName = i >= 2 && t[i - 1]!.type === 'op' && t[i - 1]!.text === '.' ? t[i - 2] : undefined;
      if (prevName?.type === 'name') {
        const table = tableNamed(state, prevName.text);
        if (table && table.id === renamedTableId) {
          rewriteBracket(tok);
          continue;
        }
        continue;
      }
      // traversal chain: [Ref].[A].[B]...
      const chainFollows = t[i + 1]?.type === 'op' && t[i + 1]!.text === '.';
      if (chainFollows) {
        // walk the chain resolving each reference's target table
        let contextTableId: string | null = ownTableId;
        let j = i;
        while (true) {
          const link = t[j]!;
          if (link.type !== 'bracket') break;
          if (contextTableId === renamedTableId) rewriteBracket(link);
          const nextIsDot = t[j + 1]?.type === 'op' && t[j + 1]!.text === '.';
          if (!nextIsDot) break;
          const nextBracket = t[j + 2];
          if (nextBracket?.type !== 'bracket') break;
          // resolve the current link's column in the context table
          const col: Column | undefined = contextTableId ? columnOf(state, contextTableId, link.text) : undefined;
          if (col?.type === 'reference' && col.targetTableId) {
            contextTableId = col.targetTableId;
          } else {
            contextTableId = null;
          }
          j += 2;
        }
        // the whole chain has been processed; skip past it
        const chainEnd = j + (t[j + 1] ? 2 : 0);
        i = Math.max(chainEnd - 1, i);
        continue;
      }
      // bare same-row read in the formula's own table
      if (ownTableId === renamedTableId) {
        rewriteBracket(tok);
      }
      continue;
    }
    // a point joining name to bracket is handled above
  }
  if (edits.length === 0) return formula;
  let result = '';
  let cursor = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    result += stripped.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  result += stripped.slice(cursor);
  return formula.startsWith('=') ? '=' + result : result;
}

/**
 * Rewrite every formula that names a table for a table rename, and return
 * the changed texts. Summary names follow their source at read time.
 */
export function rewriteTableRename(
  state: DocState,
  oldName: string,
  newName: string,
): Rewrite[] {
  const out: Rewrite[] = [];
  const isOld = (name: string): boolean => name.toLowerCase() === oldName.toLowerCase();
  for (const table of state.tables) {
    if (table.kind === 'summary') continue;
    for (const column of state.tableColumns(table.id)) {
      if (column.type !== 'formula' || !column.formula) continue;
      const stripped = column.formula.startsWith('=') ? column.formula.slice(1) : column.formula;
      const { tokens } = tokenize(stripped, 0);
      if (!tokens) continue;
      const t = tokens;
      const edits: { start: number; end: number; text: string }[] = [];
      for (let i = 0; i < t.length; i++) {
        const tok = t[i]!;
        if (tok.type !== 'name') continue;
        if (!isOld(tok.text)) continue;
        const next = t[i + 1];
        const prev = t[i - 1];
        const isAggregateColumn = next?.type === 'op' && next.text === '.';
        const isCountArg = prev?.type === 'func' && prev.text.toUpperCase() === 'COUNT' && next?.type === 'rparen';
        if (isAggregateColumn || isCountArg) {
          edits.push({ start: tok.start, end: tok.end, text: newName });
        }
      }
      if (edits.length === 0) continue;
      let result = '';
      let cursor = 0;
      for (const edit of edits) {
        result += stripped.slice(cursor, edit.start) + edit.text;
        cursor = edit.end;
      }
      result += stripped.slice(cursor);
      const after = column.formula.startsWith('=') ? '=' + result : result;
      out.push({ columnId: column.id, before: column.formula, after });
    }
  }
  return out;
}
