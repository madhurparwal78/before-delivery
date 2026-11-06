import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import type { ChangeMode, FieldState, RecordChange, RecordKind, RecordState, SyncRequest, SyncResponse } from "../shared/sync.ts";
import { removeDocumentAttachments } from "./attachments.ts";
import { requireSession } from "./accounts.ts";
import { transaction } from "./db.ts";
import { ApiError, readJson, sendJson } from "./http.ts";
import type { JsonObject } from "./http.ts";
import { mergeRecord } from "./merge.ts";

const PAGE_RECORDS = 1000;

async function nextSeq(client: PoolClient, accountId: string): Promise<number> {
  const bumped = await client.query<{ last_seq: string }>("UPDATE accounts SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq", [accountId]);
  return Number(bumped.rows[0]?.last_seq);
}

const documentOf = (change: RecordChange): string | null =>
  change.kind === "document" ? change.id : change.kind === "row" || change.kind === "table" ? null : change.parentId;

async function deletedDocuments(client: PoolClient, accountId: string, ids: string[]): Promise<Set<string>> {
  const found = await client.query<{ document_id: string }>(
    "SELECT document_id FROM deleted_documents WHERE account_id = $1 AND document_id = ANY($2)",
    [accountId, ids],
  );
  return new Set(found.rows.map((row) => row.document_id));
}

async function applyChanges(client: PoolClient, accountId: string, deviceId: string, changes: RecordChange[]): Promise<string[]> {
  const documentIds = [...new Set(changes.flatMap((change) => documentOf(change) ?? []))];
  const gone = await deletedDocuments(client, accountId, documentIds);
  for (const change of changes) {
    const documentId = documentOf(change);
    if (documentId !== null && gone.has(documentId)) continue;
    const found = await client.query<{ fields: Record<string, FieldState> }>(
      "SELECT fields FROM change_log WHERE account_id = $1 AND kind = $2 AND record_id = $3",
      [accountId, change.kind, change.id],
    );
    const stored = found.rows[0]?.fields;
    const merged = mergeRecord(change.kind, stored ?? {}, change.fields, deviceId);
    if (stored && !merged.changed) continue;
    await client.query(
      `INSERT INTO change_log (account_id, kind, record_id, parent_id, seq, fields)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, kind, record_id) DO UPDATE SET seq = EXCLUDED.seq, fields = EXCLUDED.fields`,
      [accountId, change.kind, change.id, change.parentId, await nextSeq(client, accountId), JSON.stringify(merged.fields)],
    );
  }
  return [...gone];
}

async function deleteForever(client: PoolClient, accountId: string, documentId: string): Promise<void> {
  await client.query(
    `DELETE FROM change_log WHERE account_id = $1 AND (parent_id = $2 OR (kind = 'document' AND record_id = $2))`,
    [accountId, documentId],
  );
  await client.query("DELETE FROM share_links WHERE account_id = $1 AND document_id = $2", [accountId, documentId]);
  await removeDocumentAttachments(client, accountId, documentId);
  await client.query(
    `INSERT INTO deleted_documents (account_id, document_id, seq) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [accountId, documentId, await nextSeq(client, accountId)],
  );
}

async function changesSince(client: PoolClient, accountId: string, since: number): Promise<SyncResponse> {
  const found = await client.query<{ kind: RecordKind; record_id: string; seq: string; fields: Record<string, FieldState> }>(
    "SELECT kind, record_id, seq, fields FROM change_log WHERE account_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
    [accountId, since, PAGE_RECORDS + 1],
  );
  const more = found.rows.length > PAGE_RECORDS;
  const rows = found.rows.slice(0, PAGE_RECORDS);
  const last = rows.at(-1);
  const head = await client.query<{ last_seq: string }>("SELECT last_seq FROM accounts WHERE id = $1", [accountId]);
  const cursor = more && last ? Number(last.seq) : Number(head.rows[0]?.last_seq);
  const deleted = await client.query<{ document_id: string }>(
    "SELECT document_id FROM deleted_documents WHERE account_id = $1 AND seq > $2 AND seq <= $3",
    [accountId, since, cursor],
  );
  const records: RecordState[] = rows.map((row) => ({ kind: row.kind, id: row.record_id, fields: row.fields }));
  return { cursor, records, deletedForever: deleted.rows.map((row) => row.document_id), more };
}

const RECORD_KINDS: ReadonlySet<unknown> = new Set<RecordKind>(["document", "block", "note", "connector", "table", "row", "attachment"]);

const CHANGE_MODES: ReadonlySet<unknown> = new Set<ChangeMode>(["edit", "create", "slot", "pick"]);
const MAX_ID_LENGTH = 512;
const MAX_VALUE_DEPTH = 8;
const UNSTORABLE_TEXT = /\0|\p{Cs}/u;

/** Postgres text and jsonb refuse a NUL or a lone surrogate, anywhere in a value or a key. */
function storable(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return !UNSTORABLE_TEXT.test(value);
  if (typeof value !== "object" || value === null) return true;
  return depth < MAX_VALUE_DEPTH && Object.entries(value).every(([key, item]) => storable(key) && storable(item, depth + 1));
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_ID_LENGTH;

const isFieldChange = (value: unknown): boolean =>
  typeof value === "object" && value !== null &&
  "value" in value && "base" in value && Number.isSafeInteger(value.base) &&
  "mode" in value && CHANGE_MODES.has(value.mode);

const isChange = (value: unknown): value is RecordChange =>
  typeof value === "object" && value !== null &&
  "id" in value && isId(value.id) &&
  "kind" in value && RECORD_KINDS.has(value.kind) &&
  (!("parentId" in value) || value.parentId === null || isId(value.parentId)) &&
  "fields" in value && typeof value.fields === "object" && value.fields !== null &&
  Object.values(value.fields).every(isFieldChange);

function syncRequest(body: JsonObject): SyncRequest {
  const { since, changes, deletedForever } = body;
  if (
    !Number.isSafeInteger(since) || !Array.isArray(changes) || !changes.every(isChange) || !storable(changes) ||
    !Array.isArray(deletedForever) || !storable(deletedForever)
  ) {
    throw new ApiError(422, { form: "That request is not valid." });
  }
  return { since: since as number, changes, deletedForever: deletedForever.filter(isId) };
}

/** Takes a device's changes and answers everything the account has since that device's cursor. */
export async function exchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await requireSession(req);
  const request = syncRequest(await readJson(req));
  const answer = await transaction(async (client) => {
    await client.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [session.accountId]);
    const dropped = await applyChanges(client, session.accountId, session.deviceId, request.changes);
    for (const documentId of request.deletedForever) await deleteForever(client, session.accountId, documentId);
    const response = await changesSince(client, session.accountId, request.since);
    return { ...response, deletedForever: [...new Set([...response.deletedForever, ...dropped])] };
  });
  sendJson(res, 200, answer);
}
