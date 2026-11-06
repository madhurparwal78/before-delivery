import { documentBlocks, materialise } from '../domain/materialise.ts';
import { textOf } from '../domain/blocks.ts';
import type { Op } from '../domain/types.ts';
import { query } from './db.ts';

type ChangeRow = {
  seq: string;
  op_id: string;
  device_id: string;
  entity: string;
  entity_id: string;
  document_id: string | null;
  field: string;
  value: unknown;
  parents: string[] | null;
  at: Date;
  seed: boolean;
  slot: boolean;
  content: boolean;
};

function toOp(row: ChangeRow): Op {
  const op: Op = {
    id: row.op_id,
    deviceId: row.device_id,
    entity: row.entity as Op['entity'],
    entityId: row.entity_id,
    field: row.field,
    value: row.value,
    at: new Date(row.at).toISOString(),
    seq: Number(row.seq),
  };
  if (row.parents) op.parents = row.parents;
  if (row.seed) op.seed = true;
  if (row.slot) op.slot = true;
  if (row.content) op.content = true;
  return op;
}

export async function accountOps(accountId: string, since = 0): Promise<Op[]> {
  const result = await query<ChangeRow>(
    'select * from changes where account_id = $1 and seq > $2 order by seq',
    [accountId, since],
  );
  return result.rows.map(toOp);
}

export async function accountTombstones(accountId: string): Promise<string[]> {
  const result = await query<{ document_id: string }>('select document_id from tombstones where account_id = $1', [
    accountId,
  ]);
  return result.rows.map((row) => row.document_id);
}

export async function latestSeq(accountId: string): Promise<number> {
  const result = await query<{ seq: string | null }>('select max(seq) as seq from changes where account_id = $1', [
    accountId,
  ]);
  return Number(result.rows[0]?.seq ?? 0);
}

export async function accountHoldsDocument(accountId: string, documentId: string): Promise<boolean> {
  const tombstone = await query('select 1 from tombstones where account_id = $1 and document_id = $2', [
    accountId,
    documentId,
  ]);
  if (tombstone.rowCount) return false;
  const result = await query(
    `select 1 from changes
      where account_id = $1 and entity = 'document' and entity_id = $2 and field = 'create' limit 1`,
    [accountId, documentId],
  );
  return result.rowCount === 1;
}

export type SharedDocument = {
  title: string;
  blocks: { id: string; type: string; text: string; indent: number; checked: boolean }[];
  attachments: { id: string; name: string; contentType: string }[];
};

/** The account's latest synced content of one document. */
export async function sharedDocument(accountId: string, documentId: string): Promise<SharedDocument | null> {
  const result = await query<ChangeRow>(
    'select * from changes where account_id = $1 and document_id = $2 order by seq',
    [accountId, documentId],
  );
  const workspace = materialise(result.rows.map(toOp));
  const document = workspace.documents.get(documentId);
  if (!document || document.trashed) return null;

  const attachments = await query<{ id: string; name: string; content_type: string }>(
    'select id, name, content_type from attachments where account_id = $1 and document_id = $2',
    [accountId, documentId],
  );

  return {
    title: textOf(document.title),
    blocks: documentBlocks(workspace, documentId).map((block) => ({
      id: block.id,
      type: block.type,
      text: textOf(block.text),
      indent: block.indent,
      checked: block.checked,
    })),
    attachments: attachments.rows.map((row) => ({ id: row.id, name: row.name, contentType: row.content_type })),
  };
}
