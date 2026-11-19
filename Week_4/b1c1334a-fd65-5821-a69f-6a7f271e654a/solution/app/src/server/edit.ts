// How every committing edit runs: one at a time per document, through the published
// error precedence, with its recalculation, history entry, undo entry and idempotency
// record in the same transaction.
import { createHash } from "node:crypto";
import type { Account } from "./auth.js";
import { config } from "./config.js";
import { type Db, transaction } from "./db.js";
import { Evaluation } from "./engine.js";
import { ApiError, type Reply, type Request, errorReply, forbidden, invalid, notFound } from "./http.js";
import type { Access, DocState, Role, RowScope } from "./model.js";
import { cloneState } from "./model.js";
import { Mutation, newId, unresolvedNames } from "./ops.js";
import { recalculationList } from "./recalc.js";
import { loadState, persistState } from "./store.js";

type HistoryKind =
  | "cell_write" | "cell_batch" | "row_add" | "row_delete" | "column_add" | "column_update" | "column_delete"
  | "table_add" | "table_rename" | "summary_add" | "access_update" | "undo" | "redo";

export type UndoKind =
  | "cell_write" | "cell_batch" | "row_add" | "row_delete" | "column_add" | "column_update" | "column_delete" | "table_rename";

export interface DocumentRow {
  id: string;
  name: string;
  owner_id: string;
  revision: number;
}

// The winner rule: a revision that was sent and differs from the current one is stale.
export function isStale(sent: number | null, current: number): boolean {
  return sent !== null && sent !== current;
}

interface Stacks {
  undo_count: number;
  redo_count: number;
}

const STACK_LIMIT = 50;

// Role and row scope, read from the share on every request and never cached.
export async function documentAccess(db: Db, docId: string, account: Account, lock: boolean): Promise<{ doc: DocumentRow; access: Access }> {
  const docs = await db.query<DocumentRow>(
    `SELECT id, name, owner_id, revision FROM documents WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [docId],
  );
  const doc = docs.rows[0];
  if (!doc) throw notFound();
  if (doc.owner_id === account.id) return { doc, access: { role: "owner", rowScope: "all", email: account.email } };
  const shares = await db.query<{ role: Role; row_scope: RowScope }>(
    "SELECT role, row_scope FROM shares WHERE document_id = $1 AND email = $2",
    [docId, account.email],
  );
  const share = shares.rows[0];
  if (!share) throw notFound();
  return { doc, access: { role: share.role, rowScope: share.row_scope, email: account.email } };
}

export async function stacksOf(db: Db, docId: string, accountId: string): Promise<Stacks> {
  const { rows } = await db.query<{ stack: string; n: number }>(
    "SELECT stack, count(*)::int AS n FROM undo_entries WHERE document_id = $1 AND account_id = $2 GROUP BY stack",
    [docId, accountId],
  );
  const count = (s: string) => rows.find((r) => r.stack === s)?.n ?? 0;
  return { undo_count: count("undo"), redo_count: count("redo") };
}

export async function pushEntry(
  db: Db,
  docId: string,
  accountId: string,
  stack: "undo" | "redo",
  entry: { id: string; kind: UndoKind; tableId: string | null; payload: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO undo_entries (id, document_id, account_id, stack, seq, kind, table_id, payload)
     VALUES ($1, $2, $3, $4,
       (SELECT coalesce(max(seq), 0) + 1 FROM undo_entries WHERE document_id = $2 AND account_id = $3), $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET stack = EXCLUDED.stack, seq = EXCLUDED.seq, payload = EXCLUDED.payload`,
    [entry.id, docId, accountId, stack, entry.kind, entry.tableId, JSON.stringify(entry.payload)],
  );
  await db.query(
    `DELETE FROM undo_entries WHERE id IN (
       SELECT id FROM undo_entries WHERE document_id = $1 AND account_id = $2 AND stack = $3
       ORDER BY seq DESC OFFSET $4)`,
    [docId, accountId, stack, STACK_LIMIT],
  );
}

export interface EditContext {
  db: Db;
  req: Request;
  account: Account;
  doc: DocumentRow;
  access: Access;
  state: DocState; // as stored before this edit
  ev: Evaluation; // the caller's view before this edit
  next: DocState; // the state this edit writes
  m: Mutation;
  changeId: string;
}

export interface Outcome {
  status: 200 | 201;
  kind: HistoryKind;
  tableId: string | null;
  seeds: Set<string>;
  direct: Set<string>;
  undo?: { kind: UndoKind; tableId: string; payload: unknown };
  stackMove?: (db: Db) => Promise<void>; // undo and redo move their own entry
  body: (after: Evaluation) => Record<string, unknown>;
}

export interface EditSpec {
  locate?: (c: EditContext) => void; // 404 step
  allowed: (c: EditContext) => boolean; // 403 step
  apply: (c: EditContext) => Promise<Outcome> | Outcome; // 409, 422 and the change itself
}

// An answer that is still committed: an undo conflict drops its entry and changes nothing else.
export class CommittedRefusal extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

const KEY_FORMAT = /^[A-Za-z0-9_-]{1,100}$/;

export async function runEdit(req: Request, account: Account, docId: string, spec: EditSpec): Promise<Reply> {
  const key = req.headers["idempotency-key"];
  const idempotencyKey = typeof key === "string" ? key : null;
  const requestHash = createHash("sha256")
    .update(`${req.method}\n${req.path}\n${req.search}\n`)
    .update(req.raw)
    .digest("hex");
  let refusal: ApiError | null = null;
  const reply = await transaction(async (db) => {
    if (idempotencyKey !== null && KEY_FORMAT.test(idempotencyKey)) {
      // A duplicate in flight waits here for the first to finish.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${account.id}|${docId}|${idempotencyKey}`]);
    }
    const { doc, access } = await documentAccess(db, docId, account, true);
    const state = await loadState(db, doc);
    const next = cloneState(state);
    const changeId = newId("e");
    const c: EditContext = {
      db, req, account, doc, access, state, ev: new Evaluation(state, access), next, m: new Mutation(next, changeId), changeId,
    };
    spec.locate?.(c);
    if (!spec.allowed(c)) throw forbidden();
    if (idempotencyKey !== null) {
      if (!KEY_FORMAT.test(idempotencyKey)) throw idempotencyError("Send a key of 1 to 100 letters, digits, hyphens or underscores.");
      const stored = await db.query<{ request_hash: string; status: number; body: string }>(
        `SELECT request_hash, status, body FROM idempotency_keys
         WHERE account_id = $1 AND document_id = $2 AND key = $3 AND created_at > now() - make_interval(secs => $4)`,
        [account.id, docId, idempotencyKey, config.idempotencyTtlSeconds],
      );
      const hit = stored.rows[0];
      if (hit && hit.request_hash !== requestHash) throw idempotencyError("This key was already used for a different change.");
      if (hit) return { status: hit.status, body: hit.body, headers: { "Idempotent-Replayed": "true" } } satisfies Reply;
    }
    if (req.malformed) throw invalid({ body: "Send the request body as a JSON object." });
    let outcome: Outcome;
    try {
      outcome = await spec.apply(c);
    } catch (error) {
      if (error instanceof CommittedRefusal) {
        refusal = error.error;
        return null;
      }
      throw error;
    }
    const after = new Evaluation(next, access);
    const direct = new Set(outcome.direct);
    const missingBefore = unresolvedNames(c.ev);
    for (const [columnId, missing] of unresolvedNames(after)) {
      const was = missingBefore.get(columnId);
      if (!was || ![...was].some((name) => !missing.has(name))) continue;
      const column = after.column(columnId)!;
      for (const row of after.visibleRows(column.tableId)) direct.add(`${row.id}|${columnId}`);
    }
    const list = recalculationList(c.ev, after, outcome.seeds, direct);
    await persistState(db, state, next);
    const revision = doc.revision + 1;
    await db.query("UPDATE documents SET revision = $2 WHERE id = $1", [docId, revision]);
    await db.query("INSERT INTO history (document_id, revision, kind, actor_id, table_id) VALUES ($1, $2, $3, $4, $5)", [
      docId, revision, outcome.kind, account.id, outcome.tableId,
    ]);
    if (outcome.stackMove) await outcome.stackMove(db);
    else await db.query("DELETE FROM undo_entries WHERE document_id = $1 AND account_id = $2 AND stack = 'redo'", [docId, account.id]);
    if (outcome.undo) await pushEntry(db, docId, account.id, "undo", { id: changeId, ...outcome.undo });
    const stacks = await stacksOf(db, docId, account.id);
    const recalc = {
      ...list,
      stacks,
      access: { role: access.role, row_scope: access.rowScope },
      document_revision: revision,
    };
    const body = JSON.stringify({ ...outcome.body(after), recalc });
    if (idempotencyKey !== null) {
      await db.query(
        `INSERT INTO idempotency_keys (account_id, document_id, key, request_hash, status, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (account_id, document_id, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, status = EXCLUDED.status, body = EXCLUDED.body, created_at = now()`,
        [account.id, docId, idempotencyKey, requestHash, outcome.status, body],
      );
    }
    return { status: outcome.status, body } satisfies Reply;
  });
  if (refusal) return errorReply(refusal);
  return reply!;
}

function idempotencyError(message: string): ApiError {
  return new ApiError(422, "idempotency_key", "The Idempotency-Key cannot be used.", { fields: { idempotency_key: message } });
}

