import type { PreviewJson } from '../../shared/api.js';
import { errorTooltip, fieldMessages, isErrorValue } from '../../shared/copy.js';
import { runCommit, type Outcome } from '../commit.js';
import { newId } from '../db.js';
import { evaluateDocument, previewExpression } from '../evaluate.js';
import { invalid, notFound, staleTable } from '../errors.js';
import { applyFormulaRewrites, renameTable } from '../edits.js';
import { rewriteForTableRename } from '../formula/rename.js';
import { diagnosisMessage, readFormula } from '../formula/read.js';
import { asArray, asInteger, asObject, asString } from '../json.js';
import { documentAccess, loadDocument } from '../load.js';
import { rowIsVisible, summaryName, type DocData, type Viewer } from '../model.js';
import { tableJson } from '../present.js';
import { emptyClasses } from '../recalc.js';
import { stackCounts, type FormulaRewrite, type UndoTarget } from '../undo.js';
import { displayOf, kindOf } from '../value.js';
import { isValidTableName } from '../validate.js';
import { requireTable, tableNameTaken } from './helpers.js';
import type { Reply, RouteContext } from './types.js';

function formulaOf(doc: DocData, columnId: string): string {
  for (const table of doc.tables) {
    for (const column of table.columns) {
      if (column.id === columnId) return column.formula ?? '';
    }
  }
  return '';
}

export function rewriteEntries(doc: DocData, rewrites: Map<string, string>): FormulaRewrite[] {
  return [...rewrites].map(([columnId, after]) => ({
    columnId,
    before: formulaOf(doc, columnId),
    after,
  }));
}

async function viewerOf(context: RouteContext, documentId: string): Promise<Viewer> {
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  return {
    id: context.account.id,
    email: context.account.email,
    role: access.role,
    rowScope: access.rowScope,
  };
}

export async function readTable(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const viewer = await viewerOf(context, documentId);
  const doc = await loadDocument(context.client, documentId);
  if (doc === null) throw notFound();
  const table = requireTable(doc, context.params['table']);
  const snapshot = evaluateDocument(doc, viewer);
  const stacks = await stackCounts(context.client, documentId, context.account.id);
  return {
    status: 200,
    body: {
      table: tableJson(snapshot, table),
      access: { role: viewer.role, row_scope: viewer.rowScope },
      stacks,
      document_revision: doc.revision,
    },
  };
}

export async function createTable(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    apply: async ({ client, doc }): Promise<Outcome> => {
      const body = asObject(context.request.body) ?? {};
      const name = asString(body['name']);
      if (name === null || !isValidTableName(name)) {
        throw invalid({ name: fieldMessages.tableName });
      }
      if (tableNameTaken(doc, name, null)) throw invalid({ name: fieldMessages.tableNameTaken });
      const tableId = newId('tbl');
      await client.query(
        `insert into doc_tables (id, document_id, name, kind, revision)
         values ($1, $2, $3, 'table', 1)`,
        [tableId, documentId, name],
      );
      const classes = emptyClasses();
      classes.includeTables.push(tableId);
      return {
        kind: 'applied',
        status: 201,
        body: {
          table: {
            id: tableId,
            name,
            kind: 'table',
            revision: 1,
            owner_column_id: null,
            columns: [],
            rows: [],
          },
        },
        classes,
        historyKind: 'table_add',
        historyTableId: tableId,
        undo: null,
      };
    },
  });
}

export async function patchTable(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    resolve: ({ doc }) => {
      requireTable(doc, context.params['table']);
    },
    apply: async ({ client, doc }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      const body = asObject(context.request.body) ?? {};
      const revision = asInteger(body['revision']);
      if (revision === null) throw invalid({ revision: fieldMessages.tableRevision });
      if (revision !== table.revision) {
        throw staleTable({ id: table.id, name: table.name, revision: table.revision });
      }
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryRename });
      const name = asString(body['name']);
      if (name === null || !isValidTableName(name)) {
        throw invalid({ name: fieldMessages.tableName });
      }
      if (tableNameTaken(doc, name, table.id)) {
        throw invalid({ name: fieldMessages.tableNameTaken });
      }
      const oldName = table.name;
      const rewrites = rewriteForTableRename(doc, { tableId: table.id, oldName, newName: name });
      const entries = rewriteEntries(doc, rewrites);
      const tableRevision = await renameTable(client, table.id, name);
      const rewritten = await applyFormulaRewrites(client, rewrites);

      const classes = emptyClasses();
      classes.directColumns.push(...rewrites.keys());
      classes.nameResolutionDirect = true;

      const targets: UndoTarget[] = [
        { k: 'table', tableId: table.id, revision: tableRevision },
        ...rewritten.map(
          (entry): UndoTarget => ({
            k: 'column',
            columnId: entry.columnId,
            revision: entry.revision,
          }),
        ),
      ];
      return {
        kind: 'applied',
        status: 200,
        body: { table: { id: table.id, name, revision: tableRevision } },
        classes,
        historyKind: 'table_rename',
        historyTableId: table.id,
        undo: {
          payload: {
            k: 'table_rename',
            tableId: table.id,
            before: oldName,
            after: name,
            rewrites: entries,
          },
          targets,
        },
      };
    },
  });
}

export async function createSummary(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    apply: async ({ client, doc }): Promise<Outcome> => {
      const body = asObject(context.request.body) ?? {};
      const sourceTableId = asString(body['source_table_id']);
      const source = doc.tables.find(
        (table) => table.id === sourceTableId && table.kind === 'table',
      );
      if (source === undefined) throw invalid({ source_table_id: 'Choose a table.' });
      const groupBy = (asArray(body['group_by']) ?? []).map((value) => asString(value));
      if (
        groupBy.length < 1 ||
        groupBy.length > 3 ||
        new Set(groupBy).size !== groupBy.length ||
        groupBy.some((id) => id === null || !source.columns.some((column) => column.id === id))
      ) {
        throw invalid({ group_by: 'Choose 1 to 3 columns of the source table.' });
      }
      const sumColumns = (asArray(body['sum_columns']) ?? []).map((value) => asString(value));
      if (
        sumColumns.length > 5 ||
        new Set(sumColumns).size !== sumColumns.length ||
        sumColumns.some(
          (id) =>
            id === null ||
            !source.columns.some(
              (column) =>
                column.id === id && (column.type === 'decimal' || column.type === 'formula'),
            ),
        )
      ) {
        throw invalid({ sum_columns: 'Choose Decimal or Formula columns of the source table.' });
      }
      const groupIds = groupBy as string[];
      const sumIds = source.columns
        .filter((column) => sumColumns.includes(column.id))
        .map((column) => column.id);
      const name = summaryName(
        source.name,
        groupIds.map(
          (id) => source.columns.find((column) => column.id === id)?.name ?? '',
        ),
      );

      const summaryId = newId('tbl');
      await client.query(
        `insert into doc_tables
           (id, document_id, name, kind, revision, source_table_id, group_by, sum_columns)
         values ($1, $2, $3, 'summary', 1, $4, $5, $6)`,
        [
          summaryId,
          documentId,
          name,
          source.id,
          JSON.stringify(groupIds),
          JSON.stringify(sumIds),
        ],
      );
      const classes = emptyClasses();
      classes.directTables.push(summaryId);
      classes.includeTables.push(summaryId);
      return {
        kind: 'applied',
        status: 201,
        body: {},
        bodyFrom: (after, afterDoc) => ({
          table: tableJson(after, requireTable(afterDoc, summaryId)),
        }),
        classes,
        historyKind: 'summary_add',
        historyTableId: summaryId,
        undo: null,
      };
    },
  });
}

export async function setRowOwner(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'owner',
    resolve: ({ doc }) => {
      requireTable(doc, context.params['table']);
    },
    apply: async ({ client, doc }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      const body = asObject(context.request.body) ?? {};
      const raw = body['owner_column_id'];
      const ownerColumnId = raw === null ? null : asString(raw);
      if (raw !== null && ownerColumnId === null) {
        throw invalid({ owner_column_id: fieldMessages.ownerColumn });
      }
      if (ownerColumnId !== null) {
        const column = table.columns.find((candidate) => candidate.id === ownerColumnId);
        if (column === undefined || column.type !== 'text') {
          throw invalid({ owner_column_id: fieldMessages.ownerColumn });
        }
      }
      await client.query('update doc_tables set owner_column_id = $2 where id = $1', [
        table.id,
        ownerColumnId,
      ]);
      return {
        kind: 'applied',
        status: 200,
        body: { table: { id: table.id, owner_column_id: ownerColumnId } },
        classes: emptyClasses(),
        historyKind: 'access_update',
        historyTableId: table.id,
        undo: null,
      };
    },
  });
}

export async function formulaPreview(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const viewer = await viewerOf(context, documentId);
  const doc = await loadDocument(context.client, documentId);
  if (doc === null) throw notFound();
  const table = requireTable(doc, context.params['table']);
  const body = asObject(context.request.body) ?? {};
  const rowId = asString(body['row_id']);
  const row = table.rows.find((candidate) => candidate.id === rowId);
  if (rowId === null || row === undefined || !rowIsVisible(table, row, viewer)) {
    throw invalid({ row_id: fieldMessages.previewRow });
  }
  const read = readFormula(asString(body['formula']) ?? '');
  if (!read.ok) {
    const preview: PreviewJson = {
      display: null,
      kind: null,
      diagnosis: diagnosisMessage(read.diagnosis),
    };
    return { status: 200, body: preview };
  }
  const value = previewExpression(doc, viewer, table, row, read.expr);
  const display = displayOf(value);
  const preview: PreviewJson = {
    display,
    kind: kindOf(value),
    diagnosis: isErrorValue(display) ? errorTooltip(display) : null,
  };
  return { status: 200, body: preview };
}
