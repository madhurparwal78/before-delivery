import type { ColumnType } from '../../shared/api.js';
import { fieldMessages } from '../../shared/copy.js';
import { runCommit, type Outcome } from '../commit.js';
import {
  applyFormulaRewrites,
  convertColumnValues,
  insertColumn,
  setColumnDeleted,
  updateColumnFields,
} from '../edits.js';
import { cellKey } from '../evaluate.js';
import { columnInSummary, columnIsRowOwner, invalid, staleColumn } from '../errors.js';
import { diagnosisMessage, readFormula } from '../formula/read.js';
import { rewriteForColumnRename } from '../formula/rename.js';
import { asInteger, asObject, asString } from '../json.js';
import { columnJson } from '../present.js';
import { emptyClasses } from '../recalc.js';
import type { ColumnState, FormulaRewrite, UndoTarget } from '../undo.js';
import { isValidColumnName } from '../validate.js';
import { columnNameTaken, requireColumn, requireTable, summaryUsesColumn } from './helpers.js';
import { rewriteEntries } from './tables.js';
import type { Reply, RouteContext } from './types.js';

const DATA_TYPES: ColumnType[] = ['text', 'decimal', 'date', 'bool'];
const ALL_TYPES: ColumnType[] = [...DATA_TYPES, 'reference', 'formula'];

export async function createColumn(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    resolve: ({ doc }) => {
      requireTable(doc, context.params['table']);
    },
    apply: async ({ client, doc, before }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });
      const body = asObject(context.request.body) ?? {};
      const name = asString(body['name']);
      if (name === null || !isValidColumnName(name)) {
        throw invalid({ name: fieldMessages.columnName });
      }
      if (columnNameTaken(table, name, null)) {
        throw invalid({ name: fieldMessages.columnNameTaken });
      }
      const type = asString(body['type']) as ColumnType | null;
      if (type === null || !ALL_TYPES.includes(type)) {
        throw invalid({ type: 'Choose a column type.' });
      }
      let targetTableId: string | null = null;
      if (type === 'reference') {
        targetTableId = asString(body['target_table_id']);
        const target = doc.tables.find(
          (candidate) => candidate.id === targetTableId && candidate.kind === 'table',
        );
        if (target === undefined) {
          throw invalid({ target_table_id: 'Choose a table to point at.' });
        }
      }
      const formulaSent = body['formula'] === undefined ? null : asString(body['formula']);
      let formula: string | null = null;
      if (type === 'formula') {
        const read = readFormula(formulaSent ?? '');
        if (!read.ok) throw invalid({ formula: diagnosisMessage(read.diagnosis) });
        formula = read.text;
      } else if (formulaSent !== null) {
        throw invalid({ formula: 'Only Formula columns take a formula.' });
      }

      const columnId = await insertColumn(client, table, { name, type, formula, targetTableId });
      const classes = emptyClasses();
      classes.nameResolutionDirect = true;
      if (type === 'formula') {
        classes.directColumns.push(columnId);
      } else {
        for (const row of before.visible.get(table.id) ?? []) {
          classes.seeds.add(cellKey(row.id, columnId));
        }
      }
      classes.includeTables.push(table.id);

      return {
        kind: 'applied',
        status: 201,
        body: {},
        bodyFrom: (_after, afterDoc) => ({
          column: columnJson(requireColumn(requireTable(afterDoc, table.id), columnId)),
        }),
        classes,
        historyKind: 'column_add',
        historyTableId: table.id,
        undo: {
          payload: { k: 'column_add', tableId: table.id, columnId },
          targets: [{ k: 'column', columnId, revision: 1 }],
        },
      };
    },
  });
}

export async function patchColumn(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const body = asObject(context.request.body) ?? {};
  const changesSchema = body['name'] !== undefined || body['type'] !== undefined;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: changesSchema ? 'owner' : 'editor',
    resolve: ({ doc }) => {
      requireColumn(requireTable(doc, context.params['table']), context.params['column']);
    },
    apply: async ({ client, doc, access }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      const column = requireColumn(table, context.params['column']);
      const revision = asInteger(body['revision']);
      if (revision === null) throw invalid({ revision: fieldMessages.columnRevision });
      if (revision !== column.revision) throw staleColumn(columnJson(column));
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });

      const beforeState: ColumnState = {
        name: column.name,
        type: column.type,
        formula: column.formula,
      };
      const classes = emptyClasses();
      const targets: UndoTarget[] = [];
      let rewriteList: FormulaRewrite[] = [];
      let cellsBefore: Array<{ rowId: string; raw: string | null }> = [];

      const name = body['name'] === undefined ? null : asString(body['name']);
      if (body['name'] !== undefined) {
        if (name === null || !isValidColumnName(name)) {
          throw invalid({ name: fieldMessages.columnName });
        }
        if (columnNameTaken(table, name, column.id)) {
          throw invalid({ name: fieldMessages.columnNameTaken });
        }
      }

      const type = body['type'] === undefined ? null : (asString(body['type']) as ColumnType);
      if (body['type'] !== undefined) {
        if (
          type === null ||
          !DATA_TYPES.includes(type) ||
          !DATA_TYPES.includes(column.type)
        ) {
          throw invalid({ type: fieldMessages.columnTypeFixed });
        }
      }

      const formulaSent = body['formula'] === undefined ? null : asString(body['formula']);
      let formula: string | null = null;
      if (body['formula'] !== undefined) {
        if (column.type !== 'formula') {
          throw invalid({ formula: 'Only Formula columns take a formula.' });
        }
        const read = readFormula(formulaSent ?? '');
        if (!read.ok) throw invalid({ formula: diagnosisMessage(read.diagnosis) });
        formula = read.text;
      }

      if (name !== null && name !== column.name) {
        const rewrites = rewriteForColumnRename(doc, {
          tableId: table.id,
          oldName: column.name,
          newName: name,
        });
        rewriteList = rewriteEntries(doc, rewrites);
        const rewritten = await applyFormulaRewrites(client, rewrites);
        for (const entry of rewritten) {
          targets.push({ k: 'column', columnId: entry.columnId, revision: entry.revision });
          classes.directColumns.push(entry.columnId);
        }
        classes.nameResolutionDirect = true;
      }

      if (type !== null && type !== column.type) {
        const conversion = await convertColumnValues(client, table, column, type);
        cellsBefore = conversion.before;
        for (const converted of conversion.converted) {
          classes.directs.add(cellKey(converted.rowId, converted.columnId));
        }
      }

      if (formula !== null) classes.directColumns.push(column.id);

      const columnRevision = await updateColumnFields(client, column.id, {
        ...(name !== null ? { name } : {}),
        ...(type !== null ? { type } : {}),
        ...(formula !== null ? { formula } : {}),
      });
      targets.push({ k: 'column', columnId: column.id, revision: columnRevision });

      const afterState: ColumnState = {
        name: name ?? column.name,
        type: type ?? column.type,
        formula: formula ?? column.formula,
      };
      return {
        kind: 'applied',
        status: 200,
        body: {},
        bodyFrom: (_after, afterDoc) => ({
          column: columnJson(requireColumn(requireTable(afterDoc, table.id), column.id)),
        }),
        classes,
        historyKind: 'column_update',
        historyTableId: table.id,
        undo: {
          payload: {
            k: 'column_update',
            tableId: table.id,
            columnId: column.id,
            before: beforeState,
            after: afterState,
            rewrites: rewriteList,
            cellsBefore,
          },
          targets,
        },
      };
    },
  });
}

export async function deleteColumn(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    resolve: ({ doc }) => {
      requireColumn(requireTable(doc, context.params['table']), context.params['column']);
    },
    apply: async ({ client, doc, before }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      const column = requireColumn(table, context.params['column']);
      if (summaryUsesColumn(doc, column.id)) throw columnInSummary();
      if (table.ownerColumnId === column.id) throw columnIsRowOwner();

      const revision = await setColumnDeleted(client, column.id, true);
      const classes = emptyClasses();
      for (const row of before.visible.get(table.id) ?? []) {
        classes.seeds.add(cellKey(row.id, column.id));
      }
      classes.includeTables.push(table.id);
      return {
        kind: 'applied',
        status: 200,
        body: {},
        classes,
        historyKind: 'column_delete',
        historyTableId: table.id,
        undo: {
          payload: { k: 'column_delete', tableId: table.id, columnId: column.id },
          targets: [{ k: 'column', columnId: column.id, revision }],
        },
      };
    },
  });
}
