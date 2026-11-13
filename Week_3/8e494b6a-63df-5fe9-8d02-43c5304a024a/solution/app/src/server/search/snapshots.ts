// Snapshots (Business rules H): a frozen, ordered result list paged by cursor, expiring after its last use.
import { randomBytes } from "node:crypto";
import { config } from "../config";
import { now } from "../clock";
import { pool, tx } from "../db";
import { ApiError, errors } from "../errors";
import { loadStreamContext, type StreamContext } from "./context";
import type { ApiEvent } from "./events";
import { runQuery, shape, sortMatched, parseSort, type QueryRequest } from "./run";
import type { StreamRef, Lifecycle } from "../access";

interface SnapshotRequest extends QueryRequest {
  sort: string | null;
}

const INSERT_BATCH = 1000;

export async function createSnapshot(ctx: StreamContext, spaceId: number, request: SnapshotRequest) {
  const outcome = await runQuery(ctx, request);
  const sort = parseSort(request.sort);
  const ordered = sortMatched(ctx, outcome.matched, sort === "invalid" ? null : sort, request, outcome.scored);
  const events = ordered.map((item) => JSON.stringify(shape(item, outcome.scored, false)));
  const id = randomBytes(16).toString("hex");
  const at = now();
  const { rows: marks } = await pool.query<{ mark: number }>("SELECT coalesce(max(ordinal), 0) AS mark FROM events WHERE stream_id = $1", [ctx.id]);
  await tx(async (client) => {
    await client.query(
      `INSERT INTO snapshots (id, space_id, stream_id, request, total, partial, skipped, ordinal_mark, last_used_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, spaceId, ctx.id, JSON.stringify(request), events.length, outcome.universe.partial, outcome.universe.skipped, (marks[0] as { mark: number }).mark, at],
    );
    for (let start = 0; start < events.length; start += INSERT_BATCH) {
      const chunk = events.slice(start, start + INSERT_BATCH);
      await client.query(
        "INSERT INTO snapshot_events (snapshot_id, pos, event) SELECT $1, $2 + o - 1, e::jsonb FROM unnest($3::text[]) WITH ORDINALITY AS u(e, o)",
        [id, start, chunk],
      );
    }
  });
  return { id, total: events.length, partial: outcome.universe.partial, skipped_generations: outcome.universe.skipped };
}

interface SnapshotRow {
  stream_id: number;
  request: SnapshotRequest;
  total: number;
  ordinal_mark: number;
  last_used_ms: number;
}

async function newEvents(stream: StreamRef, spaceId: number, request: SnapshotRequest, mark: number): Promise<number> {
  try {
    const outcome = await runQuery(await loadStreamContext(stream, spaceId), request);
    return outcome.matched.filter((item) => item.event.ordinal !== null && item.event.ordinal > mark).length;
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return 0;
    throw error;
  }
}

export async function readSnapshot(spaceId: number, id: string, after: string | null) {
  const { rows } = await pool.query<SnapshotRow>(
    "SELECT stream_id, request, total, ordinal_mark, last_used_ms FROM snapshots WHERE id = $1 AND space_id = $2", [id, spaceId],
  );
  const snapshot = rows[0];
  if (!snapshot) throw errors.notFound();
  const at = now();
  if (at >= snapshot.last_used_ms + config.settings.snapshotTtlMs) {
    await pool.query("DELETE FROM snapshots WHERE id = $1", [id]);
    throw errors.snapshotExpired();
  }
  await pool.query("UPDATE snapshots SET last_used_ms = $2 WHERE id = $1", [id, at]);
  const offset = after === null ? 0 : Number(after);
  if (!Number.isInteger(offset) || offset < 0) throw errors.invalid({ after: "Use a cursor from a previous page." });
  const size = config.settings.pageSize;
  const { rows: page } = await pool.query<{ event: ApiEvent }>(
    "SELECT event FROM snapshot_events WHERE snapshot_id = $1 AND pos >= $2 AND pos < $3 ORDER BY pos", [id, offset, offset + size],
  );
  const { rows: streams } = await pool.query<{ id: number; name: string; write_generation: number; lifecycle: Lifecycle }>(
    "SELECT id, name, write_generation, lifecycle FROM streams WHERE id = $1", [snapshot.stream_id],
  );
  const row = streams[0];
  const stream: StreamRef | null = row ? { id: row.id, name: row.name, writeGeneration: row.write_generation, lifecycle: row.lifecycle } : null;
  return {
    events: page.map((row) => row.event),
    next: offset + size < snapshot.total ? String(offset + size) : null,
    total: snapshot.total,
    new_events: stream ? await newEvents(stream, spaceId, snapshot.request, snapshot.ordinal_mark) : 0,
  };
}
