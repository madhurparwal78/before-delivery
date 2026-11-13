// One lifecycle step (Business rules J): rollover, then each generation to the furthest phase its age allows.
import { now } from "./clock";
import { locked, pool } from "./db";
import { deleteObject, objectSize, putObject, StorageUnavailable } from "./storage";
import { ingestTotals } from "./ingest/totals";
import { emit } from "./live";
import { generationViews, loadGenerations, phaseForAge, type GenerationRow } from "./streams";
import { segmentLine } from "./search/events";
import type { Doc } from "./search/fields";
import type { Lifecycle } from "./access";
import type { PoolClient } from "pg";

interface StreamRow {
  id: number;
  name: string;
  space_id: number;
  slug: string;
  write_generation: number;
  lifecycle: Lifecycle;
}

async function removeRows(client: PoolClient, streamId: number, generation: number): Promise<void> {
  for (const table of ["events", "postings", "field_lengths"]) {
    await client.query(`DELETE FROM ${table} WHERE stream_id = $1 AND generation = $2`, [streamId, generation]);
  }
}

async function rollOver(client: PoolClient, stream: StreamRow, generations: GenerationRow[], at: number): Promise<void> {
  const write = generations.find((g) => g.number === stream.write_generation) as GenerationRow;
  const policy = stream.lifecycle;
  const { rows } = await client.query<{ n: number }>("SELECT count(*) AS n FROM events WHERE stream_id = $1 AND generation = $2", [stream.id, write.number]);
  const count = (rows[0] as { n: number }).n;
  const aged = typeof policy.rollover_max_age_ms === "number" && at - write.createdMs >= policy.rollover_max_age_ms;
  const full = typeof policy.rollover_max_events === "number" && count >= policy.rollover_max_events;
  if (count === 0 || !(aged || full)) return;
  const next = write.number + 1;
  await client.query("UPDATE generations SET rolled_over_ms = $3 WHERE stream_id = $1 AND number = $2", [stream.id, write.number, at]);
  await client.query("INSERT INTO generations (stream_id, number, phase, created_ms) VALUES ($1, $2, 'hot', $3)", [stream.id, next, at]);
  await client.query(
    "INSERT INTO mappings (stream_id, generation, field, type, explicit) SELECT stream_id, $3, field, type, true FROM mappings WHERE stream_id = $1 AND generation = $2 AND explicit",
    [stream.id, write.number, next],
  );
  await client.query("UPDATE streams SET write_generation = $2 WHERE id = $1", [stream.id, next]);
  stream.write_generation = next;
}

async function archive(client: PoolClient, stream: StreamRow, generation: GenerationRow): Promise<boolean> {
  const { rows } = await client.query<{ ext_id: string; ts: number; doc: Doc; pipeline: string | null }>(
    "SELECT ext_id, ts, doc, pipeline FROM events WHERE stream_id = $1 AND generation = $2 ORDER BY ts, ext_id", [stream.id, generation.number],
  );
  const body = Buffer.from(rows.map((row) => `${segmentLine({ id: row.ext_id, ts: row.ts, doc: row.doc, pipeline: row.pipeline })}\n`).join(""));
  const key = `segments/${stream.slug}/${stream.name}/${generation.number}.ndjson`;
  try {
    await putObject(key, body);
    if ((await objectSize(key)) !== body.length) throw new StorageUnavailable("segment size mismatch");
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await client.query("UPDATE generations SET phase = 'warm', archive_failed = true WHERE stream_id = $1 AND number = $2", [stream.id, generation.number]);
    return false;
  }
  await client.query(
    `UPDATE generations SET phase = 'archive', segment_key = $3, segment_bytes = $4, archived_events = $5, archive_failed = false
     WHERE stream_id = $1 AND number = $2`,
    [stream.id, generation.number, key, body.length, rows.length],
  );
  await removeRows(client, stream.id, generation.number);
  return true;
}

async function remove(client: PoolClient, stream: StreamRow, generation: GenerationRow): Promise<void> {
  if (generation.segmentKey) {
    try {
      await deleteObject(generation.segmentKey);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      await client.query("UPDATE generations SET delete_failed = true WHERE stream_id = $1 AND number = $2", [stream.id, generation.number]);
      return;
    }
  }
  await removeRows(client, stream.id, generation.number);
  await client.query("DELETE FROM event_keys WHERE stream_id = $1 AND generation = $2", [stream.id, generation.number]);
  await client.query(
    "UPDATE generations SET phase = 'delete', segment_key = NULL, segment_bytes = NULL, archived_events = 0, delete_failed = false WHERE stream_id = $1 AND number = $2",
    [stream.id, generation.number],
  );
}

export async function lifecycleStep(streamId: number): Promise<void> {
  const at = now();
  const spaceId = await locked("stream", streamId, async (client) => {
    const { rows } = await client.query<StreamRow>(
      "SELECT s.id, s.name, s.space_id, sp.slug, s.write_generation, s.lifecycle FROM streams s JOIN spaces sp ON sp.id = s.space_id WHERE s.id = $1",
      [streamId],
    );
    const stream = rows[0] as StreamRow;
    await rollOver(client, stream, await loadGenerations(client, streamId), at);
    for (const generation of await loadGenerations(client, streamId)) {
      const target = phaseForAge(generation, stream.lifecycle, at);
      if (target === generation.phase) continue;
      if (target === "warm") await client.query("UPDATE generations SET phase = 'warm' WHERE stream_id = $1 AND number = $2", [streamId, generation.number]);
      else if (target === "archive") await archive(client, stream, generation);
      else if (target === "delete") await remove(client, stream, generation);
    }
    return stream.space_id;
  });
  await announce(streamId, spaceId);
}

async function announce(streamId: number, spaceId: number): Promise<void> {
  const { rows } = await pool.query<{ name: string; write_generation: number; lifecycle: Lifecycle }>("SELECT name, write_generation, lifecycle FROM streams WHERE id = $1", [streamId]);
  const stream = rows[0];
  if (!stream) return;
  await emit(spaceId, [{ type: "lifecycle", data: { stream: stream.name, generations: await generationViews(streamId, stream.lifecycle, stream.write_generation), ...(await ingestTotals(spaceId)) } }]);
}

