import type { AccessJson, RecalcJson } from '../shared/api.js';
import { fieldMessages } from '../shared/copy.js';
import { config } from './config.js';
import { withTransaction, type Client } from './db.js';
import { evaluateDocument, type Snapshot } from './evaluate.js';
import { ApiError, forbidden, idempotencyKeyError, notFound } from './errors.js';
import type { RequestContext } from './http.js';
import { documentAccess, loadDocument, type DocumentAccess } from './load.js';
import type { DocData, Viewer } from './model.js';
import { buildRecalc, type CellClasses } from './recalc.js';
import type { Account } from './session.js';
import {
  clearStack,
  pushEntry,
  stackCounts,
  type UndoPayload,
  type UndoTarget,
} from './undo.js';
import { isValidIdempotencyKey } from './validate.js';

export type ResolveContext = {
  client: Client;
  account: Account;
  documentId: string;
  access: DocumentAccess;
  viewer: Viewer;
  doc: DocData;
};

export type EditContext = ResolveContext & { before: Snapshot };

export type AppliedOutcome = {
  kind: 'applied';
  status: 200 | 201;
  body: Record<string, unknown>;
  /** Parts of the body that are read from the document as the edit left it. */
  bodyFrom?: (after: Snapshot, afterDoc: DocData) => Record<string, unknown>;
  classes: CellClasses;
  historyKind: string;
  historyTableId: string | null;
  undo: { payload: UndoPayload; targets: UndoTarget[] } | null;
  /** Undo and redo manage their own stacks, so they skip the redo clear. */
  keepRedoStack?: boolean;
};

/** A refused undo or redo drops its entry and commits nothing else. */
export type RefusedOutcome = { kind: 'refused'; error: ApiError };

export type Outcome = AppliedOutcome | RefusedOutcome;

export type CommitResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};

export async function runCommit(
  client: Client,
  request: RequestContext,
  account: Account,
  documentId: string,
  options: {
    requires: 'owner' | 'editor';
    resolve?: (context: ResolveContext) => void;
    apply: (context: EditContext) => Promise<Outcome>;
  },
): Promise<CommitResponse> {
  return withTransaction(client, async () => {
      const locked = await client.query<{ revision: number }>(
        'select revision from documents where id = $1 for update',
        [documentId],
      );
      if (locked.rowCount === 0) throw notFound();
      const access = await documentAccess(client, documentId, account);
      if (access === null) throw notFound();
      const doc = await loadDocument(client, documentId);
      if (doc === null) throw notFound();
      const viewer: Viewer = {
        id: account.id,
        email: account.email,
        role: access.role,
        rowScope: access.rowScope,
      };
      const resolveContext: ResolveContext = {
        client,
        account,
        documentId,
        access,
        viewer,
        doc,
      };
      options.resolve?.(resolveContext);
      if (options.requires === 'owner' && access.role !== 'owner') throw forbidden();
      if (access.role === 'viewer') throw forbidden();

      const replay = await checkIdempotency(client, request, documentId, account.id);
      if (replay !== null) return replay;

      const before = evaluateDocument(doc, viewer);
      const outcome = await options.apply({ ...resolveContext, before });
      if (outcome.kind === 'refused') {
        return {
          status: outcome.error.status,
          body: outcome.error.body(),
          headers: {},
        };
      }

      const afterDoc = await loadDocument(client, documentId);
      if (afterDoc === null) throw notFound();
      const after = evaluateDocument(afterDoc, viewer);

      const revision = doc.revision + 1;
      await client.query('update documents set revision = $2 where id = $1', [
        documentId,
        revision,
      ]);
      await client.query(
        `insert into history (document_id, revision, kind, actor_id, table_id)
         values ($1, $2, $3, $4, $5)`,
        [documentId, revision, outcome.historyKind, account.id, outcome.historyTableId],
      );
      if (outcome.undo !== null) {
        await pushEntry(client, documentId, account.id, 'undo', outcome.undo);
      }
      if (outcome.keepRedoStack !== true) {
        await clearStack(client, documentId, account.id, 'redo');
      }

      const stacks = await stackCounts(client, documentId, account.id);
      const accessJson: AccessJson = { role: access.role, row_scope: access.rowScope };
      const recalc: RecalcJson = buildRecalc(before, after, outcome.classes, {
        stacks,
        access: accessJson,
        documentRevision: revision,
      });
      const body = {
        ...outcome.body,
        ...(outcome.bodyFrom?.(after, afterDoc) ?? {}),
        recalc,
      };

      if (request.idempotencyKey !== null) {
        await storeIdempotency(client, request, documentId, account.id, outcome.status, body);
      }
      return { status: outcome.status, body, headers: {} };
  });
}

async function checkIdempotency(
  client: Client,
  request: RequestContext,
  documentId: string,
  actorId: string,
): Promise<CommitResponse | null> {
  const key = request.idempotencyKey;
  if (key === null) return null;
  if (!isValidIdempotencyKey(key)) {
    throw idempotencyKeyError(fieldMessages.idempotencyKeyMalformed);
  }
  await client.query(
    `delete from idempotency_keys
     where created_at < now() - ($1 || ' seconds')::interval`,
    [String(config.idempotencyTtlSeconds)],
  );
  const stored = await client.query<{
    method: string;
    path: string;
    query: string;
    body: string;
    status: number;
    response: string;
  }>(
    `select method, path, query, body, status, response from idempotency_keys
     where document_id = $1 and actor_id = $2 and key = $3`,
    [documentId, actorId, key],
  );
  const record = stored.rows[0];
  if (record === undefined) return null;
  const same =
    record.method === request.method &&
    record.path === request.path &&
    record.query === request.rawQuery &&
    record.body === request.bodyText;
  if (!same) throw idempotencyKeyError(fieldMessages.idempotencyKeyReused);
  return {
    status: record.status,
    body: JSON.parse(record.response) as unknown,
    headers: { 'idempotent-replayed': 'true' },
  };
}

async function storeIdempotency(
  client: Client,
  request: RequestContext,
  documentId: string,
  actorId: string,
  status: number,
  body: unknown,
): Promise<void> {
  await client.query(
    `insert into idempotency_keys
       (document_id, actor_id, key, method, path, query, body, status, response)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      documentId,
      actorId,
      request.idempotencyKey,
      request.method,
      request.path,
      request.rawQuery,
      request.bodyText,
      status,
      JSON.stringify(body),
    ],
  );
}
