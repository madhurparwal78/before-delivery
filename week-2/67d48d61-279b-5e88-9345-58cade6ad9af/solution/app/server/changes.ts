// Every change runs inside one transaction holding the sequence row lock, so changes, pulls and
// rollovers from every process sharing the database are serialized. The change's task updates,
// activity, journal entry, event and next seq commit together, and its snapshot is computed from
// the graph read inside that transaction.

import { createHash } from "node:crypto";
import type pg from "pg";
import {
  type Attachment,
  type ChangeKind,
  type ChangeResult,
  type Freed,
  type Reblocked,
  type Snapshot,
} from "../shared/catalog.js";
import { calendar } from "./cycles.js";
import { currentSeq, loadGraph, pool, saveTask } from "./db.js";
import { snapshotOf, type Restorable, type TaskGraph, type TaskRow } from "./domain.js";
import { ApiError, errorReply, type ApiRequest, type Reply } from "./http.js";

export interface ActivityDraft {
  task: number;
  kind: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  actor: string | null;
}

interface Commit {
  kind: ChangeKind;
  actor: string | null;
  after: TaskGraph;
  saved: number[];
  inserted?: number[];
  linkAdded?: readonly [number, number];
  linkRemoved?: readonly [number, number];
  activity: ActivityDraft[];
  undoable: boolean;
  journal?: Journal;
  cascade?: Freed[];
  reblocked?: Reblocked[];
  listed?: number[];
  extra?: Record<string, unknown>;
  attachment?: Attachment;
}

export interface Journal {
  tasks: Array<{ number: number; version: number; before: Restorable }>;
  cascade: Freed[];
}

export type Work = {
  client: pg.PoolClient;
  graph: TaskGraph;
  idempotency(): Promise<void>;
  commit(change: Commit): Promise<ChangeResult>;
};

class Replay {
  constructor(readonly reply: Reply) {}
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const fingerprint = (req: ApiRequest): string =>
  createHash("sha256").update(`${req.method}\n${req.path}\n${canonical(req.json)}`).digest("hex");

export const bumped = (graph: TaskGraph, numbers: Iterable<number>, now: Date): TaskRow[] =>
  [...numbers].map((n) => ({ ...graph.row(n), version: graph.row(n).version + 1, updated_at: now }));

export const snapshotFor = (graph: TaskGraph, seq: number): Snapshot => {
  const { windows, current } = calendar();
  return snapshotOf(graph, seq, windows, current);
};

// Runs `work` under the change lock. A request (when given) gets its idempotency key replayed
// or stored; a thrown ApiError becomes the reply and undoes the work but not the stored key.
export const underLock = async (req: ApiRequest | null, work: (w: Work) => Promise<Reply>): Promise<Reply> => {
  const client = await pool.connect();
  let storeKey = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT seq FROM sequence WHERE id = 1 FOR UPDATE");
    const graph = await loadGraph(client);
    const w: Work = {
      client,
      graph,
      async idempotency() {
        if (!req?.idempotencyKey) return;
        const { rows } = await client.query<{ method: string; path: string; fingerprint: string; status: number; response: unknown }>(
          "SELECT method, path, fingerprint, status, response FROM idempotency WHERE key = $1",
          [req.idempotencyKey],
        );
        const stored = rows[0];
        if (!stored) {
          storeKey = true;
          return;
        }
        if (stored.method === req.method && stored.path === req.path && stored.fingerprint === fingerprint(req)) {
          throw new Replay({ status: stored.status, body: stored.response, headers: { "Idempotent-Replay": "true" } });
        }
        throw new ApiError(409, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.");
      },
      commit: (change) => commit(client, change),
    };
    await client.query("SAVEPOINT work");
    let reply: Reply;
    try {
      reply = await work(w);
    } catch (error) {
      if (error instanceof Replay) {
        await client.query("ROLLBACK");
        return error.reply;
      }
      if (!(error instanceof ApiError)) throw error;
      await client.query("ROLLBACK TO SAVEPOINT work");
      reply = errorReply(error);
    }
    if (storeKey && req && reply.status < 500) {
      await client.query(
        "INSERT INTO idempotency (key, method, path, fingerprint, status, response) VALUES ($1, $2, $3, $4, $5, $6)",
        [req.idempotencyKey, req.method, req.path, fingerprint(req), reply.status, JSON.stringify(reply.body)],
      );
    }
    await client.query("COMMIT");
    return reply;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const commit = async (client: pg.PoolClient, change: Commit): Promise<ChangeResult> => {
  const inserted = new Set(change.inserted ?? []);
  const order = [...change.saved].sort((a, b) => Number(inserted.has(b)) - Number(inserted.has(a)) || a - b);
  for (const n of order) await saveTask(client, change.after.row(n), inserted.has(n));
  if (change.linkAdded) await client.query("INSERT INTO links (blocker, blocked) VALUES ($1, $2)", [...change.linkAdded]);
  if (change.linkRemoved) {
    await client.query("DELETE FROM links WHERE blocker = $1 AND blocked = $2", [...change.linkRemoved]);
  }
  const { rows } = await client.query<{ seq: string }>("UPDATE sequence SET seq = seq + 1 WHERE id = 1 RETURNING seq");
  const seq = Number(rows[0].seq);
  for (const entry of change.activity) {
    await client.query("INSERT INTO activity (task, actor, kind, changes, change) VALUES ($1, $2, $3, $4, $5)", [
      entry.task,
      entry.actor,
      entry.kind,
      JSON.stringify(entry.changes),
      seq,
    ]);
  }
  const result: ChangeResult = {
    change: seq,
    undoable: change.undoable,
    tasks: (change.listed ?? change.saved).map((n) => change.after.task(n)),
    cascade: change.cascade ?? [],
    reblocked: change.reblocked ?? [],
    snapshot: snapshotFor(change.after, seq),
    ...change.extra,
  };
  const { tasks: _listed, ...withoutTasks } = result;
  const event = change.attachment
    ? { ...withoutTasks, attachment: change.attachment, kind: change.kind }
    : { ...result, kind: change.kind };
  await client.query(
    "INSERT INTO changes (seq, kind, actor, undoable, journal, event) VALUES ($1, $2, $3, $4, $5, $6)",
    [seq, change.kind, change.actor, change.undoable, change.journal ? JSON.stringify(change.journal) : null, JSON.stringify(event)],
  );
  await client.query("SELECT pg_notify('promptside_change', $1)", [String(seq)]);
  return result;
};

// A consistent read of the graph and the last committed seq.
export const readGraph = async (): Promise<{ graph: TaskGraph; seq: number }> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const graph = await loadGraph(client);
    const seq = await currentSeq(client);
    await client.query("COMMIT");
    return { graph, seq };
  } finally {
    client.release();
  }
};
