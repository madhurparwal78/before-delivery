import type { Op } from '../domain/types.ts';
import type { Session } from './accounts.ts';
import { query } from './db.ts';
import { attachmentKey, storage } from './s3.ts';
import { accountOps, accountTombstones, latestSeq } from './workspace.ts';

const DOCUMENT_ENTITIES = new Set(['document', 'block', 'note', 'connector', 'attachment']);

function isOp(value: unknown): value is Op {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  return (
    typeof op.id === 'string' &&
    typeof op.entity === 'string' &&
    typeof op.entityId === 'string' &&
    typeof op.field === 'string' &&
    typeof op.at === 'string'
  );
}

async function documentIds(accountId: string, ops: Op[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  const unknown: string[] = [];
  for (const op of ops) {
    const key = `${op.entity}:${op.entityId}`;
    if (found.has(key)) continue;
    if (op.documentId) {
      found.set(key, op.documentId);
      continue;
    }
    if (op.entity === 'document') {
      found.set(key, op.entityId);
      continue;
    }
    if (!DOCUMENT_ENTITIES.has(op.entity)) {
      found.set(key, null);
      continue;
    }
    if (op.field === 'create') {
      const value = op.value as { documentId?: string } | null;
      found.set(key, value?.documentId ?? null);
      continue;
    }
    unknown.push(key);
  }
  if (unknown.length) {
    const result = await query<{ entity: string; entity_id: string; document_id: string | null }>(
      `select entity, entity_id, document_id from changes
        where account_id = $1 and field = 'create' and (entity || ':' || entity_id) = any($2)`,
      [accountId, unknown],
    );
    for (const row of result.rows) found.set(`${row.entity}:${row.entity_id}`, row.document_id);
    for (const key of unknown) if (!found.has(key)) found.set(key, null);
  }
  return found;
}

const COLUMNS = 13;

async function insertOps(accountId: string, ops: Op[], documents: Map<string, string | null>): Promise<void> {
  for (let start = 0; start < ops.length; start += 40) {
    const batch = ops.slice(start, start + 40);
    const values: unknown[] = [];
    const rows = batch.map((op, index) => {
      const base = index * COLUMNS;
      values.push(
        op.id,
        accountId,
        op.deviceId ?? 'device',
        op.entity,
        op.entityId,
        documents.get(`${op.entity}:${op.entityId}`) ?? null,
        op.field,
        JSON.stringify(op.value ?? null),
        op.parents ? JSON.stringify(op.parents) : null,
        op.at,
        op.seed === true,
        op.slot === true,
        op.content === true,
      );
      const placeholders = Array.from({ length: COLUMNS }, (_, column) => `$${base + column + 1}`);
      return `(${placeholders.slice(0, 7).join(', ')}, ${placeholders[7]}::jsonb, ${placeholders[8]}::jsonb, ${
        placeholders[9]
      }::timestamptz, ${placeholders.slice(10).join(', ')})`;
    });
    await query(
      `insert into changes (op_id, account_id, device_id, entity, entity_id, document_id, field, value, parents, at, seed, slot, content)
       values ${rows.join(', ')}
       on conflict (account_id, op_id) do nothing`,
      values,
    );
  }
}

export type PushResult = {
  accepted: { id: string; seq: number }[];
  droppedDocuments: string[];
  tombstones: string[];
  storedAttachments: string[];
  ops: Op[];
  seq: number;
};

/** Delete forever beats any offline edit: the document's text leaves the account for good. */
export async function deleteForever(session: Session, documentIds: string[]): Promise<void> {
  for (const documentId of documentIds) {
    await query(
      'insert into tombstones (account_id, document_id) values ($1, $2) on conflict do nothing',
      [session.accountId, documentId],
    );
    await query('delete from changes where account_id = $1 and document_id = $2', [session.accountId, documentId]);
    const attachments = await query<{ id: string }>(
      'select id from attachments where account_id = $1 and document_id = $2',
      [session.accountId, documentId],
    );
    for (const row of attachments.rows) {
      await storage.remove(attachmentKey(session.accountId, row.id)).catch(() => undefined);
    }
    await query('delete from attachments where account_id = $1 and document_id = $2', [
      session.accountId,
      documentId,
    ]);
    await query('update share_links set revoked = true where account_id = $1 and document_id = $2', [
      session.accountId,
      documentId,
    ]);
  }
}

export async function push(
  session: Session,
  body: Record<string, unknown>,
): Promise<PushResult> {
  const incoming = Array.isArray(body.ops) ? body.ops.filter(isOp) : [];
  const since = Number(body.since ?? 0);
  const removals = Array.isArray(body.deletedForever) ? body.deletedForever.filter((id) => typeof id === 'string') : [];

  if (removals.length) await deleteForever(session, removals as string[]);

  const tombstones = await accountTombstones(session.accountId);
  const buried = new Set(tombstones);
  const documents = await documentIds(session.accountId, incoming);
  const droppedDocuments = new Set<string>();
  const keep = incoming.filter((op) => {
    const documentId = documents.get(`${op.entity}:${op.entityId}`);
    if (documentId && buried.has(documentId)) {
      droppedDocuments.add(documentId);
      return false;
    }
    return true;
  });

  if (keep.length) await insertOps(session.accountId, keep, documents);

  const seqs = keep.length
    ? await query<{ op_id: string; seq: string }>(
        'select op_id, seq from changes where account_id = $1 and op_id = any($2)',
        [session.accountId, keep.map((op) => op.id)],
      )
    : { rows: [] as { op_id: string; seq: string }[] };

  const ops = await accountOps(session.accountId, since);
  const stored = await query<{ id: string }>('select id from attachments where account_id = $1', [session.accountId]);

  return {
    accepted: seqs.rows.map((row) => ({ id: row.op_id, seq: Number(row.seq) })),
    droppedDocuments: [...droppedDocuments],
    tombstones,
    storedAttachments: stored.rows.map((row) => row.id),
    ops,
    seq: await latestSeq(session.accountId),
  };
}

export async function pull(session: Session, since: number): Promise<Omit<PushResult, 'accepted'>> {
  const ops = await accountOps(session.accountId, since);
  const tombstones = await accountTombstones(session.accountId);
  const stored = await query<{ id: string }>('select id from attachments where account_id = $1', [session.accountId]);
  return {
    droppedDocuments: [],
    tombstones,
    storedAttachments: stored.rows.map((row) => row.id),
    ops,
    seq: await latestSeq(session.accountId),
  };
}
