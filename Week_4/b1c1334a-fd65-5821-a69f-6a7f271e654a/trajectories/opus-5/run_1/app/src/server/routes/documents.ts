import type { DocumentListEntry, HistoryEntryJson, Role, TableSummaryJson } from '../../shared/api.js';
import { fieldMessages } from '../../shared/copy.js';
import { newId } from '../db.js';
import { evaluateDocument } from '../evaluate.js';
import { invalid, notFound } from '../errors.js';
import { asObject, asString } from '../json.js';
import { documentAccess, loadDocument } from '../load.js';
import type { Viewer } from '../model.js';
import { stackCounts } from '../undo.js';
import { isValidDocumentName } from '../validate.js';
import type { Reply, RouteContext } from './types.js';

export async function listDocuments(context: RouteContext): Promise<Reply> {
  const result = await context.client.query<{ id: string; name: string; role: Role }>(
    `select d.id, d.name, 'owner'::text as role from documents d where d.owner_id = $1
     union all
     select d.id, d.name, s.role from documents d
       join shares s on s.document_id = d.id
       where lower(s.email) = lower($2) and d.owner_id <> $1
     order by name`,
    [context.account.id, context.account.email],
  );
  const documents: DocumentListEntry[] = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
  }));
  return { status: 200, body: { documents } };
}

export async function createDocument(context: RouteContext): Promise<Reply> {
  const body = asObject(context.request.body) ?? {};
  const name = asString(body['name']);
  if (name === null || !isValidDocumentName(name)) {
    throw invalid({ name: fieldMessages.documentName });
  }
  const id = newId('doc');
  await context.client.query(
    'insert into documents (id, name, owner_id, revision) values ($1, $2, $3, 0)',
    [id, name, context.account.id],
  );
  return { status: 201, body: { document: { id, name, role: 'owner' } } };
}

export async function readDocument(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  const doc = await loadDocument(context.client, documentId);
  if (doc === null) throw notFound();
  const viewer: Viewer = {
    id: context.account.id,
    email: context.account.email,
    role: access.role,
    rowScope: access.rowScope,
  };
  const snapshot = evaluateDocument(doc, viewer);
  const stacks = await stackCounts(context.client, documentId, context.account.id);
  const tables: TableSummaryJson[] = doc.tables.map((table) => ({
    id: table.id,
    name: table.name,
    kind: table.kind,
    revision: table.revision,
    row_count: snapshot.rowCounts.get(table.id) ?? 0,
    column_count: table.columns.length,
    source_table_id: table.summary?.sourceTableId ?? null,
  }));
  return {
    status: 200,
    body: {
      document: {
        id: doc.id,
        name: doc.name,
        role: access.role,
        row_scope: access.rowScope,
        revision: doc.revision,
        undo_count: stacks.undo_count,
        redo_count: stacks.redo_count,
      },
      tables,
    },
  };
}

export async function readHistory(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  const result = await context.client.query<{
    revision: number;
    kind: string;
    actor_id: string;
    table_id: string | null;
  }>(
    'select revision, kind, actor_id, table_id from history where document_id = $1 order by revision',
    [documentId],
  );
  const entries: HistoryEntryJson[] = result.rows.map((row) => ({
    revision: row.revision,
    kind: row.kind,
    actor_id: row.actor_id,
    table_id: row.table_id,
  }));
  return { status: 200, body: { entries } };
}
