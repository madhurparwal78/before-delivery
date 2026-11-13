// Streams, mappings, bulk and file uploads, the failure store, event edits and lifecycle policy.
import { createHash } from "node:crypto";
import { now } from "../clock";
import { pool, tx, locked, isUniqueViolation } from "../db";
import { errors } from "../errors";
import { authorize, streamAllowed, type Lifecycle } from "../access";
import { ok, reply, route } from "../http";
import { currentSeq, emit } from "../live";
import { findPipeline, type StoredPipeline } from "../ingest/pipelines";
import { BULK_BATCH_LINES, checkTypes, ingestLines, splitLines, type Totals } from "../ingest/store";
import { ingestTotals } from "../ingest/totals";
import { getObject, objectSize, putObject } from "../storage";
import { loadGenerations, loadTypes, generationViews } from "../streams";
import { Check, STREAM_NAME } from "../validate";
import { config } from "../config";
import { formatIso } from "../../shared/time";
import { apiEvent, parseSegment, storedEvent, type StoredEvent } from "../search/events";
import { FIELD_TYPES, isPlainObject, type Doc, type FieldType } from "../search/fields";
import { indexEvent, persistIndex } from "../search/index";

/** The sentence announced when an upload or bulk request ends. */
function uploadSentence(totals: Totals): string {
  const duplicates = `${totals.duplicates} ${totals.duplicates === 1 ? "duplicate" : "duplicates"}`;
  return `Upload done: ${totals.created} created, ${duplicates}, ${totals.failed} failed${totals.dropped > 0 ? `, ${totals.dropped} dropped` : ""}`;
}

route("GET", "/api/streams", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read" });
  const { rows } = await pool.query<{ name: string; write_generation: number; events: number; failures: number }>(
    `SELECT s.name, s.write_generation,
            (SELECT count(*) FROM event_keys k WHERE k.stream_id = s.id) AS events,
            (SELECT count(*) FROM failures f WHERE f.stream_id = s.id) AS failures
     FROM streams s WHERE s.space_id = $1 ORDER BY s.name`,
    [access.space.id],
  );
  return ok({ streams: rows.filter((row) => streamAllowed(access, row.name)) });
});

route("POST", "/api/streams", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "admin", keyAction: "manage" });
  const body = ctx.json();
  const name = typeof body.name === "string" ? body.name : "";
  if (!streamAllowed(access, name)) throw errors.keyScope("manage", name);
  const { rows: taken } = await pool.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [access.space.id, name]);
  if (taken.length > 0) throw errors.nameTaken({ name: "That name is already used." });
  const check = new Check();
  if (!STREAM_NAME.test(name)) check.fail("name", "Use 1 to 40 characters: a-z, 0-9 or -.");
  check.done();
  try {
    await tx(async (client) => {
      const { rows } = await client.query<{ id: number }>("INSERT INTO streams (space_id, name) VALUES ($1, $2) RETURNING id", [access.space.id, name]);
      await client.query("INSERT INTO generations (stream_id, number, phase, created_ms) VALUES ($1, 1, 'hot', $2)", [(rows[0] as { id: number }).id, now()]);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.nameTaken({ name: "That name is already used." });
    throw error;
  }
  return reply(201, { name, write_generation: 1, seq: await currentSeq(access.space.id) });
});

route("GET", "/api/streams/:stream", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const { rows } = await pool.query<{ field: string; type: FieldType; generation: number; explicit: boolean }>(
    "SELECT field, type, generation, explicit FROM mappings WHERE stream_id = $1 ORDER BY field, generation", [stream.id],
  );
  return ok({ name: stream.name, mapping: rows, policy: stream.lifecycle, generations: await generationViews(stream.id, stream.lifecycle, stream.writeGeneration) });
});

route("POST", "/api/streams/:stream/mappings", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "admin", keyAction: "manage", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const body = ctx.json();
  const field = typeof body.field === "string" ? body.field : "";
  const { rows: existing } = await pool.query("SELECT 1 FROM mappings WHERE stream_id = $1 AND generation = $2 AND field = $3", [stream.id, stream.writeGeneration, field]);
  if (existing.length > 0) throw errors.mappingExists(field, stream.writeGeneration);
  const check = new Check();
  if (field.trim() === "" || Array.from(field).length > 200 || field === "@timestamp" || field === "_id") check.fail("field", "Enter a field name.");
  if (!FIELD_TYPES.includes(body.type as FieldType)) check.fail("type", "Choose number, date, boolean, text or keyword.");
  check.done();
  await pool.query("INSERT INTO mappings (stream_id, generation, field, type, explicit) VALUES ($1, $2, $3, $4, true)", [stream.id, stream.writeGeneration, field, body.type]);
  return reply(201, { field, type: body.type, generation: stream.writeGeneration, seq: await currentSeq(access.space.id) });
});

async function pipelineNamed(spaceId: number, name: string | null): Promise<StoredPipeline | null> {
  if (name === null || name === "" || name === "None") return null;
  const found = await findPipeline(spaceId, name);
  if (!found) throw errors.unknownPipeline(name);
  return found;
}

route("POST", "/api/streams/:stream/bulk", "ndjson", async (ctx) => {
  const access = await authorize(ctx, { role: "editor", keyAction: "upload", stream: ctx.params.stream, rate: "upload" });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const pipeline = await pipelineNamed(access.space.id, ctx.query.get("pipeline"));
  const { totals, results } = await ingestLines(stream, splitLines(ctx.body.toString("utf8")), pipeline, BULK_BATCH_LINES);
  const seq = await emit(access.space.id, [
    { type: "upload", data: { stream: stream.name, upload: null, ...totals, ...(await ingestTotals(access.space.id)), announcements: [uploadSentence(totals)] } },
  ]);
  return ok({ ...totals, lines: results, seq });
});

interface UploadRow {
  id: number;
  file: string;
  bytes: number;
  sha256: string;
  status: string;
  total_lines: number;
  done_lines: number;
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
}

const uploadView = (row: UploadRow) => ({
  id: row.id, file: row.file, bytes: row.bytes, sha256: row.sha256, status: row.status, done_lines: row.done_lines, total_lines: row.total_lines,
  created: row.created, duplicates: row.duplicates, dropped: row.dropped, failed: row.failed,
});

async function parseUpload(spaceId: number, stream: { id: number; name: string }, upload: UploadRow, text: string, pipeline: StoredPipeline | null): Promise<void> {
  const publish = async (announce: boolean, totals: Totals): Promise<void> => {
    const { rows } = await pool.query<UploadRow>("SELECT * FROM uploads WHERE id = $1", [upload.id]);
    await emit(spaceId, [{ type: "upload", data: { stream: stream.name, upload: uploadView(rows[0] as UploadRow), ...(await ingestTotals(spaceId)), announcements: announce ? [uploadSentence(totals)] : [] } }]);
  };
  const save = (status: string, done: number, totals: Totals): Promise<unknown> =>
    pool.query(
      "UPDATE uploads SET status = $2, done_lines = $3, created = $4, duplicates = $5, dropped = $6, failed = $7 WHERE id = $1",
      [upload.id, status, done, totals.created, totals.duplicates, totals.dropped, totals.failed],
    );
  const zero: Totals = { created: 0, duplicates: 0, dropped: 0, failed: 0 };
  await save("parsing", 0, zero);
  await publish(false, zero);
  const { totals } = await ingestLines(stream, splitLines(text), pipeline, config.settings.uploadProgressLines, async (done, running) => {
    if (done < upload.total_lines) {
      await save("parsing", done, running);
      await publish(false, running);
    }
  });
  await save("done", upload.total_lines, totals);
  await publish(true, totals);
}

route("POST", "/api/streams/:stream/uploads", "multipart", async (ctx) => {
  const access = await authorize(ctx, { role: "editor", keyAction: "upload", stream: ctx.params.stream, rate: "upload" });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const pipeline = await pipelineNamed(access.space.id, ctx.fields.pipeline ?? null);
  if (!ctx.file) throw errors.invalid({ file: "Choose an .ndjson file." });
  const { name, content } = ctx.file;
  const sha256 = createHash("sha256").update(content).digest("hex");
  const key = `uploads/${access.space.slug}/${sha256}.ndjson`;
  await putObject(key, content);
  if ((await objectSize(key)) !== content.length) throw errors.storageUnavailable();
  const text = content.toString("utf8");
  const { rows } = await pool.query<UploadRow>(
    `INSERT INTO uploads (stream_id, file, bytes, sha256, status, total_lines, created_ms) VALUES ($1, $2, $3, $4, 'kept', $5, $6) RETURNING *`,
    [stream.id, name, content.length, sha256, splitLines(text).length, now()],
  );
  const upload = rows[0] as UploadRow;
  const seq = await emit(access.space.id, [{ type: "upload", data: { stream: stream.name, upload: uploadView(upload), ...(await ingestTotals(access.space.id)), announcements: [] } }]);
  setImmediate(() => {
    parseUpload(access.space.id, stream, upload, text, pipeline).catch((error: unknown) => {
      console.error(error);
      void pool.query("UPDATE uploads SET status = 'failed' WHERE id = $1", [upload.id]);
    });
  });
  return reply(202, { id: upload.id, file: name, bytes: content.length, sha256, status: "kept", seq });
});

route("GET", "/api/streams/:stream/uploads", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: ctx.params.stream });
  const { rows } = await pool.query<UploadRow>("SELECT * FROM uploads WHERE stream_id = $1 ORDER BY id DESC", [(access.stream as { id: number }).id]);
  return ok({ uploads: rows.map(uploadView) });
});

route("GET", "/api/streams/:stream/failures", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: ctx.params.stream });
  const { rows } = await pool.query<{ id: number; reason: string; raw: string; at_ms: number }>(
    "SELECT id, reason, raw, at_ms FROM failures WHERE stream_id = $1 ORDER BY at_ms DESC, id DESC", [(access.stream as { id: number }).id],
  );
  return ok({ failures: rows.map((row) => ({ id: row.id, reason: row.reason, raw: row.raw, at: formatIso(row.at_ms) })) });
});

route("GET", "/api/streams/:stream/generations", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  return ok({ generations: await generationViews(stream.id, stream.lifecycle, stream.writeGeneration) });
});

const POLICY_KEYS = ["rollover_max_age_ms", "rollover_max_events", "warm_after_ms", "archive_after_ms", "delete_after_ms"] as const;

route("PUT", "/api/streams/:stream/lifecycle", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "admin", keyAction: "manage", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const body = ctx.json();
  const check = new Check();
  const policy: Lifecycle = {};
  for (const key of POLICY_KEYS) {
    const value = body[key] ?? null;
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < (key === "rollover_max_events" ? 1 : 0))) {
      check.fail(key, key === "rollover_max_events" ? "Enter a whole number of events, or leave it empty." : "Enter whole milliseconds, or leave it empty.");
    }
    policy[key] = value as number | null;
  }
  check.done();
  await pool.query("UPDATE streams SET lifecycle = $2 WHERE id = $1", [stream.id, JSON.stringify(policy)]);
  return ok({ policy, message: "Policy saved. It applies from the next step, and no generation moves backward.", seq: await currentSeq(access.space.id) });
});

/** Finds an event wherever it lives: a live row, or inside the segment of an archived generation. */
async function findEvent(streamId: number, id: string): Promise<{ event: StoredEvent; phase: string } | null> {
  const { rows: keys } = await pool.query<{ generation: number }>("SELECT generation FROM event_keys WHERE stream_id = $1 AND ext_id = $2", [streamId, id]);
  const key = keys[0];
  if (!key) return null;
  const generation = (await loadGenerations(pool, streamId)).find((g) => g.number === key.generation);
  if (!generation) return null;
  if (generation.phase === "archive" && generation.segmentKey) {
    const events = parseSegment((await getObject(generation.segmentKey)).toString("utf8"), generation.number);
    const event = events.find((e) => e.id === id);
    return event ? { event, phase: "archive" } : null;
  }
  const { rows } = await pool.query<{ ts: number; doc: Doc; pipeline: string | null; ordinal: number }>(
    "SELECT ts, doc, pipeline, ordinal FROM events WHERE stream_id = $1 AND ext_id = $2", [streamId, id],
  );
  const row = rows[0];
  if (!row) return null;
  return { event: storedEvent({ id, generation: generation.number, phase: generation.phase === "warm" ? "warm" : "hot", ts: row.ts, doc: row.doc, pipeline: row.pipeline, ordinal: row.ordinal }), phase: generation.phase };
}

route("PATCH", "/api/streams/:stream/events/:id", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const found = await findEvent(stream.id, ctx.params.id as string);
  if (!found) throw errors.notFound();
  if (found.phase === "warm" || found.phase === "archive") throw errors.generationReadOnly(found.event.generation, found.phase);
  const body = ctx.json();
  if (!isPlainObject(body.fields)) throw errors.invalid({ fields: "Send the fields to change as an object." });
  const edited = await locked("stream", stream.id, async (client) => {
    const doc: Doc = structuredClone(found.event.doc);
    for (const [path, value] of Object.entries(body.fields as Doc)) {
      if (path === "@timestamp" || path === "_id") throw errors.invalid({ fields: `${path} can't be edited.` });
      const segments = path.split(".");
      let holder = doc;
      for (const segment of segments.slice(0, -1)) {
        const next = holder[segment];
        holder = isPlainObject(next) ? next : (holder[segment] = {});
      }
      if (value === null) delete holder[segments[segments.length - 1] as string];
      else holder[segments[segments.length - 1] as string] = value;
    }
    const types = (await loadTypes(client, stream.id)).get(found.event.generation) ?? new Map();
    const checked = checkTypes(doc, types);
    if ("error" in checked) throw errors.invalid({ fields: `Field ${checked.error.replace(/^field /, "")}` });
    const merged = new Map([...types, ...checked.additions]);
    for (const [field, type] of checked.additions) {
      await client.query("INSERT INTO mappings (stream_id, generation, field, type, explicit) VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING", [stream.id, found.event.generation, field, type]);
    }
    const event = storedEvent({ ...found.event, doc });
    await client.query("UPDATE events SET doc = $3 WHERE stream_id = $1 AND ext_id = $2", [stream.id, event.id, JSON.stringify(doc)]);
    for (const table of ["postings", "field_lengths"]) await client.query(`DELETE FROM ${table} WHERE stream_id = $1 AND ext_id = $2`, [stream.id, event.id]);
    await persistIndex(client, stream.id, [{ id: event.id, generation: event.generation, ts: event.ts, indexed: indexEvent(event.flat, (field) => merged.get(field)) }]);
    return event;
  });
  return ok({ ...apiEvent(edited, null, []), seq: await currentSeq(access.space.id) });
});

route("GET", "/api/streams/:stream/events/:id/surrounding", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: ctx.params.stream });
  const stream = access.stream as NonNullable<typeof access.stream>;
  const found = await findEvent(stream.id, ctx.params.id as string);
  if (!found) throw errors.notFound();
  const chosen = found.event;
  const generations = await loadGenerations(pool, stream.id);
  const phases = new Map(generations.map((g) => [g.number, g.phase]));
  const archived: StoredEvent[] = [];
  for (const generation of generations.filter((g) => g.phase === "archive" && g.segmentKey)) {
    try {
      archived.push(...parseSegment((await getObject(generation.segmentKey as string)).toString("utf8"), generation.number));
    } catch (error) {
      if (generation.number === chosen.generation) throw error;
    }
  }
  const neighbours = async (direction: "before" | "after"): Promise<StoredEvent[]> => {
    const before = direction === "before";
    const { rows } = await pool.query<{ ext_id: string; generation: number; ts: number; doc: Doc; pipeline: string | null; ordinal: number }>(
      `SELECT ext_id, generation, ts, doc, pipeline, ordinal FROM events WHERE stream_id = $1 AND (ts, ext_id) ${before ? "<" : ">"} ($2, $3)
       ORDER BY ts ${before ? "DESC" : "ASC"}, ext_id ${before ? "DESC" : "ASC"} LIMIT 5`,
      [stream.id, chosen.ts, chosen.id],
    );
    const live = rows.map((row) => storedEvent({ id: row.ext_id, generation: row.generation, phase: phases.get(row.generation) === "warm" ? "warm" : "hot", ts: row.ts, doc: row.doc, pipeline: row.pipeline, ordinal: row.ordinal }));
    const old = archived.filter((e) => (before ? e.ts < chosen.ts || (e.ts === chosen.ts && e.id < chosen.id) : e.ts > chosen.ts || (e.ts === chosen.ts && e.id > chosen.id)));
    const merged = [...live, ...old].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return before ? merged.slice(-5) : merged.slice(0, 5);
  };
  return ok({ before: (await neighbours("before")).map((e) => apiEvent(e, null, [])), event: apiEvent(chosen, null, []), after: (await neighbours("after")).map((e) => apiEvent(e, null, [])) });
});

