// Storing events line by line (Business rules B): parse, pipeline, timestamp, duplicate, type and size checks, then store.
import { randomUUID } from "node:crypto";
import { now } from "../clock";
import { locked } from "../db";
import { parseIsoInstant } from "../../shared/time";
import { apiEvent, storedEvent } from "../search/events";
import { collectLeaves, inferType, isPlainObject, fitsType, type Doc, type FieldType } from "../search/fields";
import { indexEvent, persistIndex } from "../search/index";
import { publishStored } from "../tail";
import { runPipeline, type StoredPipeline } from "./pipelines";

const STREAM_CAPACITY = 100_000;
export const BULK_BATCH_LINES = 500;

type LineStatus = "created" | "duplicate" | "dropped" | "failed";

interface LineResult {
  line: number;
  status: LineStatus;
  id?: string;
  error?: string;
}

export interface Totals {
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
}

interface StreamTarget {
  id: number;
  name: string;
}

/** Splits a body or file into lines: a final newline starts no extra line. */
export function splitLines(text: string): string[] {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Checks a document against a generation's mapping; returns the first problem, or the field types to add. */
export function checkTypes(doc: Doc, mapping: Map<string, FieldType>): { error: string } | { additions: Map<string, FieldType> } {
  const additions = new Map<string, FieldType>();
  const leaves = collectLeaves(doc);
  for (const [path, values] of leaves.paths) {
    if (leaves.mixed.has(path)) return { error: `field ${path} mixes types in one array.` };
    const first = values[0];
    if (first === undefined) continue;
    const type = mapping.get(path) ?? additions.get(path) ?? inferType(first);
    for (const value of values) {
      if (!fitsType(type, value)) return { error: `field ${path} expects ${type}, got ${inferType(value)}.` };
    }
    if (!mapping.has(path)) additions.set(path, type);
  }
  return { additions };
}

interface Prepared {
  line: number;
  raw: string;
  doc: Doc | null;
  failure: string | null;
}

function prepare(raw: string, line: number): Prepared {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { line, raw, doc: null, failure: `Line ${line}: not valid JSON.` };
  }
  return isPlainObject(parsed) ? { line, raw, doc: parsed, failure: null } : { line, raw, doc: null, failure: `Line ${line}: not an object.` };
}

function timestampProblem(doc: Doc, line: number): string | null {
  const stamp = doc["@timestamp"];
  if (stamp === undefined || stamp === null) return `Line ${line}: @timestamp is missing.`;
  return typeof stamp === "string" && parseIsoInstant(stamp) !== null ? null : `Line ${line}: @timestamp is not a date.`;
}

/** Processes one batch of numbered lines under the stream's lock; blank lines are skipped but keep their number. */
async function storeBatch(target: StreamTarget, batch: Array<{ raw: string; line: number }>, pipeline: StoredPipeline | null): Promise<{ results: LineResult[] }> {
  const stored: Array<{ event: ReturnType<typeof storedEvent>; indexed: ReturnType<typeof indexEvent> }> = [];
  const results = await locked("stream", target.id, async (client) => {
    const at = now();
    const { rows: streamRows } = await client.query<{ write_generation: number }>("SELECT write_generation FROM streams WHERE id = $1", [target.id]);
    const generation = (streamRows[0] as { write_generation: number }).write_generation;
    const { rows: mappingRows } = await client.query<{ field: string; type: FieldType }>(
      "SELECT field, type FROM mappings WHERE stream_id = $1 AND generation = $2", [target.id, generation],
    );
    const mapping = new Map(mappingRows.map((row) => [row.field, row.type]));
    const prepared = batch.filter((item) => item.raw.trim() !== "").map((item) => prepare(item.raw, item.line));
    const clientIds = prepared.flatMap((item) => (item.doc && item.doc._id !== undefined && item.doc._id !== "" ? [String(item.doc._id)] : []));
    const { rows: known } = await client.query<{ ext_id: string }>(
      "SELECT ext_id FROM event_keys WHERE stream_id = $1 AND ext_id = ANY($2)", [target.id, clientIds],
    );
    const taken = new Set(known.map((row) => row.ext_id));
    const { rows: countRows } = await client.query<{ n: number }>("SELECT count(*) AS n FROM event_keys WHERE stream_id = $1", [target.id]);
    let count = (countRows[0] as { n: number }).n;
    const failures: Array<{ reason: string; raw: string }> = [];
    const additions = new Map<string, FieldType>();
    const out: LineResult[] = [];
    let minTs = Infinity;
    let maxTs = -Infinity;
    const fail = (item: Prepared, error: string): void => {
      failures.push({ reason: error, raw: item.raw });
      out.push({ line: item.line, status: "failed", error });
    };

    for (const item of prepared) {
      if (item.failure || !item.doc) {
        fail(item, item.failure ?? "");
        continue;
      }
      let doc = item.doc;
      if (pipeline) {
        const run = runPipeline(pipeline, doc, false);
        if (run.outcome === "failed") {
          fail(item, run.error);
          continue;
        }
        if (run.outcome === "dropped") {
          out.push({ line: item.line, status: "dropped" });
          continue;
        }
        doc = run.doc;
      }
      const problem = timestampProblem(doc, item.line);
      if (problem) {
        fail(item, problem);
        continue;
      }
      const clientId = doc._id !== undefined && doc._id !== "" ? String(doc._id) : null;
      if (clientId !== null && taken.has(clientId)) {
        out.push({ line: item.line, status: "duplicate", id: clientId });
        continue;
      }
      const { _id, "@timestamp": stamp, ...fields } = doc;
      const checked = checkTypes(fields, new Map([...mapping, ...additions]));
      if ("error" in checked) {
        fail(item, `Line ${item.line}: ${checked.error}`);
        continue;
      }
      if (count >= STREAM_CAPACITY) {
        fail(item, `Line ${item.line}: stream ${target.name} is full at ${STREAM_CAPACITY} events.`);
        continue;
      }
      for (const [field, type] of checked.additions) additions.set(field, type);
      const id = clientId ?? randomUUID();
      taken.add(id);
      count++;
      const ts = parseIsoInstant(String(stamp)) as number;
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
      const event = storedEvent({ id, generation, phase: "hot", ts, doc: fields, pipeline: pipeline ? `${pipeline.name}@${pipeline.version}` : null, ordinal: null });
      const types = new Map([...mapping, ...additions]);
      stored.push({ event, indexed: indexEvent(event.flat, (field) => types.get(field)) });
      out.push({ line: item.line, status: "created", id });
    }

    if (additions.size > 0) {
      await client.query(
        `INSERT INTO mappings (stream_id, generation, field, type, explicit)
         SELECT $1, $2, f, t, false FROM unnest($3::text[], $4::text[]) AS u(f, t) ON CONFLICT DO NOTHING`,
        [target.id, generation, [...additions.keys()], [...additions.values()]],
      );
    }
    if (stored.length > 0) {
      await client.query(
        "INSERT INTO event_keys (stream_id, ext_id, generation) SELECT $1, i, $2 FROM unnest($3::text[]) AS u(i)",
        [target.id, generation, stored.map((s) => s.event.id)],
      );
      await client.query(
        `INSERT INTO events (stream_id, ext_id, generation, ts, doc, pipeline)
         SELECT $1, i, $2, t, d::jsonb, p FROM unnest($3::text[], $4::bigint[], $5::text[], $6::text[]) AS u(i, t, d, p)`,
        [target.id, generation, stored.map((s) => s.event.id), stored.map((s) => s.event.ts), stored.map((s) => JSON.stringify(s.event.doc)), stored.map((s) => s.event.pipeline)],
      );
      await persistIndex(client, target.id, stored.map((s) => ({ id: s.event.id, generation, ts: s.event.ts, indexed: s.indexed })));
      await client.query(
        `UPDATE generations SET min_ts = LEAST(COALESCE(min_ts, $3), $3), max_ts = GREATEST(COALESCE(max_ts, $4), $4)
         WHERE stream_id = $1 AND number = $2`,
        [target.id, generation, minTs, maxTs],
      );
    }
    if (failures.length > 0) {
      await client.query(
        "INSERT INTO failures (stream_id, reason, raw, at_ms) SELECT $1, r, w, $4 FROM unnest($2::text[], $3::text[]) AS u(r, w)",
        [target.id, failures.map((f) => f.reason), failures.map((f) => f.raw), at],
      );
    }
    return out;
  });
  publishStored(target.id, stored.map(({ event }) => apiEvent(event, null, [])));
  return { results };
}

function addTotals(totals: Totals, results: LineResult[]): void {
  for (const result of results) {
    if (result.status === "created") totals.created++;
    else if (result.status === "duplicate") totals.duplicates++;
    else if (result.status === "dropped") totals.dropped++;
    else totals.failed++;
  }
}

/** Stores numbered lines in batches; `after` runs once per batch with the lines done so far. */
export async function ingestLines(
  target: StreamTarget,
  lines: string[],
  pipeline: StoredPipeline | null,
  batchSize: number,
  after?: (done: number, totals: Totals) => Promise<void>,
): Promise<{ totals: Totals; results: LineResult[] }> {
  const totals: Totals = { created: 0, duplicates: 0, dropped: 0, failed: 0 };
  const results: LineResult[] = [];
  for (let start = 0; start < lines.length; start += batchSize) {
    const batch = lines.slice(start, start + batchSize).map((raw, offset) => ({ raw, line: start + offset + 1 }));
    const stored = await storeBatch(target, batch, pipeline);
    addTotals(totals, stored.results);
    results.push(...stored.results);
    if (after) await after(Math.min(start + batchSize, lines.length), totals);
  }
  return { totals, results };
}
