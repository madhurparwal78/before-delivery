import type { PoolClient } from "pg";
import { CONCENTRATION_CLASSES } from "../shared/messages";
import { derive, TRAINS } from "../shared/optics";
import { hasTwoDecimals } from "../shared/projection";
import { markCount, parseStrokeFile, STROKE_LIMIT } from "../shared/stroke";
import { eveningDate, localClock, offsetAt, parseUtc, withinSession } from "../shared/time";
import type { Change, ChangeKind, ChangeResult, Conflict, ConflictField, Derived, Optics, TrainId } from "../shared/types";
import { editedSince, resolveFieldEdits, type Incoming } from "./conflicts";
import { isUuid, lockAccount, transaction } from "./db";
import { ApiError, conflict, Fields, notFound, StorageUnavailable } from "./errors";
import type { Reply } from "./http";
import { returnCitingToDraft } from "./packets";
import { deleteObject, digest, listKeys, pdfPrefix, putObject, rasterKey, rasterPrefix, strokeKey, strokePrefix } from "./storage";
import {
  SESSION_SELECT,
  observationRow,
  observationView,
  sessionView,
  type FieldMeta,
  type ObservationRow,
  type SessionRow,
} from "./views";

interface Outcome {
  status: number;
  body: Record<string, unknown>;
  conflicts: Conflict[];
}

interface Actor {
  accountId: string;
  device: string;
}

const KINDS: readonly ChangeKind[] = ["session.create", "session.optics", "observation.create", "observation.update", "sketch.put", "observation.delete"];
const FUTURE_TOLERANCE_MS = 60_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const ok = (status: number, body: Record<string, unknown>, conflicts: Conflict[] = []): Outcome => ({ status, body, conflicts });

/* ---------- shared checks ---------- */

async function ownedSession(client: PoolClient, accountId: string, id: unknown): Promise<SessionRow> {
  if (!isUuid(id)) throw notFound();
  const row = (await client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1 AND s.account_id = $2`, [id, accountId])).rows[0];
  if (!row) throw notFound();
  return row;
}

interface OpticsLookup {
  optics: Optics;
  derived: Derived;
}

/** Ownership first (404), then the shape of the optics object (422). */
async function lookupOptics(client: PoolClient, accountId: string, raw: unknown, fields: Fields): Promise<OpticsLookup | null> {
  const input = asRecord(raw);
  const owned = async (table: "telescopes" | "eyepieces" | "barlows", id: unknown) => {
    if (typeof id !== "string") return null;
    if (!isUuid(id)) throw notFound();
    const columns = table === "telescopes" ? "aperture_mm, focal_length_mm" : table === "eyepieces" ? "focal_length_mm, apparent_field_deg" : "factor";
    const row = (await client.query(`SELECT ${columns} FROM ${table} WHERE id = $1 AND account_id = $2`, [id, accountId])).rows[0];
    if (!row) throw notFound();
    return row as Record<string, number>;
  };
  const telescope = await owned("telescopes", input.telescope_id);
  const eyepiece = await owned("eyepieces", input.eyepiece_id);
  const barlow = await owned("barlows", input.barlow_id);
  if (!telescope || !eyepiece || (input.barlow_id !== undefined && input.barlow_id !== null && typeof input.barlow_id !== "string")) {
    fields.add("optics");
  }
  const trainOk = (TRAINS as readonly { id: string }[]).some((t) => t.id === input.train);
  if (!trainOk) fields.add("train");
  if (fields.any) return null;
  const train = input.train as TrainId;
  const derived = derive({
    telescope: telescope as { aperture_mm: number; focal_length_mm: number },
    eyepiece: eyepiece as { focal_length_mm: number; apparent_field_deg: number },
    barlow: barlow as { factor: number } | null,
    train,
  });
  return {
    optics: { telescope_id: input.telescope_id as string, eyepiece_id: input.eyepiece_id as string, barlow_id: (input.barlow_id as string | null | undefined) ?? null, train },
    derived,
  };
}

/* ---------- observation fields ---------- */

const FIELD_KEYS = ["observed_at", "seeing", "transparency_nelm", "concentration_class", "pair", "description", "optics"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

interface Subject {
  kind: string;
  started_at: Date;
}

function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && hasTwoDecimals(n));
}

/** Validates the fields a change carries; optics are resolved separately (they need the kit). */
function checkFields(raw: Record<string, unknown>, subject: Subject, fields: Fields): Incoming[] {
  const values: Incoming[] = [];
  const push = (field: FieldKey, value: unknown) => values.push({ field: field as ConflictField, value });
  for (const key of FIELD_KEYS) {
    if (!(key in raw) || raw[key] === undefined || key === "optics") continue;
    const value = raw[key];
    switch (key) {
      case "observed_at": {
        if (value === null) push(key, null);
        else {
          const at = parseUtc(value);
          if (at && withinSession(subject.started_at, at)) push(key, at);
          else fields.add(key);
        }
        break;
      }
      case "seeing":
        if (value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10)) push(key, value);
        else fields.add(key);
        break;
      case "transparency_nelm":
        if (value === null || (typeof value === "number" && value >= 1 && value <= 8 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9)) push(key, value);
        else fields.add(key);
        break;
      case "concentration_class":
        if (value === null || (subject.kind === "globular" && typeof value === "string" && (CONCENTRATION_CLASSES as readonly string[]).includes(value))) push(key, value);
        else fields.add(key);
        break;
      case "pair": {
        const p = asRecord(value);
        const same = validPoint(p.primary) && validPoint(p.secondary) && p.primary[0] === p.secondary[0] && p.primary[1] === p.secondary[1];
        if (value === null || (subject.kind === "double_star" && validPoint(p.primary) && validPoint(p.secondary) && !same)) {
          push(key, value === null ? null : { primary: p.primary, secondary: p.secondary });
        } else fields.add(key);
        break;
      }
      case "description":
        if (value === null) push(key, "");
        else if (typeof value === "string" && value.trim().length <= 4000) push(key, value);
        else fields.add(key);
        break;
    }
  }
  return values;
}

const COLUMN: Record<string, string> = {
  observed_at: "observed_at",
  seeing: "seeing",
  transparency_nelm: "transparency_nelm",
  concentration_class: "concentration_class",
  pair: "pair",
  description: "description",
};

async function writeFields(client: PoolClient, id: string, applied: Incoming[], optics: OpticsLookup | null, meta: FieldMeta, version: number): Promise<void> {
  const sets: string[] = ["version = $2", "field_meta = $3"];
  const args: unknown[] = [id, version, JSON.stringify(meta)];
  for (const { field, value } of applied) {
    if (field === "optics") {
      if (!optics) throw new Error("optics resolved before writing");
      args.push(JSON.stringify(optics.optics), JSON.stringify(optics.derived));
      sets.push(`optics = $${args.length - 1}`, `derived = $${args.length}`);
      continue;
    }
    const column = COLUMN[field];
    if (!column) continue;
    args.push(field === "pair" && value !== null ? JSON.stringify(value) : value);
    sets.push(`${column} = $${args.length}`);
  }
  await client.query(`UPDATE observations SET ${sets.join(", ")} WHERE id = $1`, args);
}

/* ---------- handlers ---------- */

async function sessionCreate(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const existing = isUuid(b.session_id)
    ? (await client.query<{ account_id: string }>("SELECT account_id FROM obs_sessions WHERE id = $1", [b.session_id])).rows[0]
    : undefined;
  if (existing && existing.account_id !== actor.accountId) throw notFound();
  let site: { id: string; time_zone: string } | undefined;
  if (typeof b.site_id === "string") {
    if (!isUuid(b.site_id)) throw notFound();
    site = (await client.query<{ id: string; time_zone: string }>("SELECT id, time_zone FROM sites WHERE id = $1 AND account_id = $2", [b.site_id, actor.accountId])).rows[0];
    if (!site) throw notFound();
  }
  const fields = new Fields();
  const picked = await lookupOptics(client, actor.accountId, b.optics, fields);
  if (existing) throw conflict("id_conflict");
  if (!isUuid(b.session_id)) fields.add("session_id");
  if (!site) fields.add("site_id");
  const started = parseUtc(b.started_at);
  if (!started || started.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fields.add("started_at");
  fields.check();
  if (!picked || !site || !started) throw new Error("validated above");
  await client.query(
    `INSERT INTO obs_sessions (id, account_id, site_id, started_at, evening_date, local_start, local_start_offset, optics, derived)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [b.session_id, actor.accountId, site.id, started, eveningDate(started, site.time_zone), localClock(started, site.time_zone), offsetAt(started, site.time_zone), JSON.stringify(picked.optics), JSON.stringify(picked.derived)],
  );
  return ok(201, await sessionBody(client, actor.accountId, String(b.session_id)));
}

async function sessionBody(client: PoolClient, accountId: string, id: string): Promise<Record<string, unknown>> {
  return { ...sessionView(await ownedSession(client, accountId, id)) };
}

async function sessionOptics(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const session = await ownedSession(client, actor.accountId, b.session_id);
  const fields = new Fields();
  const picked = await lookupOptics(client, actor.accountId, b.optics, fields);
  fields.check();
  if (!picked) throw new Error("validated above");
  await client.query("UPDATE obs_sessions SET optics = $2, derived = $3 WHERE id = $1", [session.id, JSON.stringify(picked.optics), JSON.stringify(picked.derived)]);
  return ok(200, await sessionBody(client, actor.accountId, session.id));
}

async function observationBody(client: PoolClient, accountId: string, id: string): Promise<Record<string, unknown>> {
  const row = await observationRow(client, id, accountId);
  if (!row) throw new Error("observation vanished inside its transaction");
  return { ...observationView(row) };
}

async function observationCreate(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const id = b.observation_id;
  const other = isUuid(id) ? (await client.query<{ account_id: string; deleted: boolean }>("SELECT account_id, deleted FROM observations WHERE id = $1", [id])).rows[0] : undefined;
  if (other && other.account_id !== actor.accountId) throw notFound();
  const session = await ownedSession(client, actor.accountId, b.session_id);
  const raw = asRecord(b.fields);
  const fields = new Fields();
  const picked = raw.optics !== undefined && raw.optics !== null ? await lookupOptics(client, actor.accountId, raw.optics, fields) : null;
  if (other?.deleted) throw conflict("observation_deleted");
  if (other) throw conflict("id_conflict");
  if (!isUuid(id)) fields.add("observation_id");
  const object = typeof b.object_id === "string" ? (await client.query<{ kind: string }>("SELECT kind FROM catalogue_objects WHERE id = $1", [b.object_id])).rows[0] : undefined;
  if (!object) fields.add("object_id");
  const at = parseUtc(b.edited_at);
  if (!at || at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fields.add("edited_at");
  const values = checkFields(raw, { kind: object?.kind ?? "", started_at: session.started_at }, fields);
  fields.check();
  if (!object || !at) throw new Error("validated above");
  const { applied, meta } = resolveFieldEdits({}, [...values, ...(picked ? [{ field: "optics" as ConflictField, value: null }] : [])], { at, device: actor.device, baseVersion: 0 }, 1);
  const get = (field: string) => applied.find((a) => a.field === field)?.value;
  const optics = picked ?? { optics: session.optics, derived: session.derived };
  await client.query(
    `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, seeing, transparency_nelm, concentration_class, pair, description, optics, derived, field_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      actor.accountId,
      session.id,
      b.object_id,
      get("observed_at") ?? null,
      get("seeing") ?? null,
      get("transparency_nelm") ?? null,
      get("concentration_class") ?? null,
      get("pair") ? JSON.stringify(get("pair")) : null,
      get("description") ?? "",
      JSON.stringify(optics.optics),
      JSON.stringify(optics.derived),
      JSON.stringify(meta),
    ],
  );
  return ok(201, await observationBody(client, actor.accountId, String(id)));
}

async function ownedObservationForChange(client: PoolClient, accountId: string, id: unknown): Promise<ObservationRow> {
  if (!isUuid(id)) throw notFound();
  const row = await observationRow(client, id, accountId, true);
  if (!row) throw notFound();
  return row;
}

function baseVersionOf(b: Record<string, unknown>, fields: Fields): number {
  if (typeof b.base_version !== "number" || !Number.isInteger(b.base_version) || b.base_version < 0) {
    fields.add("base_version");
    return 0;
  }
  return b.base_version;
}

async function observationUpdate(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const row = await ownedObservationForChange(client, actor.accountId, b.observation_id);
  const raw = asRecord(b.fields);
  const fields = new Fields();
  const picked = raw.optics !== undefined ? await lookupOptics(client, actor.accountId, raw.optics, fields) : null;
  if (row.deleted) throw conflict("observation_deleted");
  const baseVersion = baseVersionOf(b, fields);
  const at = parseUtc(b.edited_at);
  if (!at || at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fields.add("edited_at");
  const values = checkFields(raw, row, fields);
  fields.check();
  if (!at) throw new Error("validated above");
  const incoming: Incoming[] = [...values, ...(picked ? [{ field: "optics" as ConflictField, value: null }] : [])];
  const resolved = resolveFieldEdits(row.field_meta, incoming, { at, device: actor.device, baseVersion }, row.version + 1);
  if (resolved.applied.length > 0) {
    await writeFields(client, row.id, resolved.applied, picked, resolved.meta, row.version + 1);
    await returnCitingToDraft(client, actor.accountId, row.id, false);
  }
  return ok(200, await observationBody(client, actor.accountId, row.id), resolved.conflicts);
}

function decodeRaster(value: unknown): Buffer | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return "invalid";
  const data = Buffer.from(value, "base64");
  const isPng = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return isPng && data.length <= STROKE_LIMIT ? data : "invalid";
}

async function sketchPut(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const row = await ownedObservationForChange(client, actor.accountId, b.observation_id);
  if (row.deleted) throw conflict("observation_deleted");
  const fields = new Fields();
  const baseVersion = baseVersionOf(b, fields);
  const at = parseUtc(b.edited_at);
  if (!at || at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) fields.add("edited_at");
  const text = typeof b.strokes === "string" ? b.strokes : "";
  const file = parseStrokeFile(text);
  if (!file) fields.add("strokes");
  const raster = decodeRaster(b.raster_png_base64);
  if (raster === "invalid") fields.add("raster");
  fields.check();
  if (!at || !file || raster === "invalid") throw new Error("validated above");
  const resolved = resolveFieldEdits(row.field_meta, [{ field: "sketch", value: null }], { at, device: actor.device, baseVersion }, row.version + 1);
  if (resolved.applied.length === 0) return ok(200, await observationBody(client, actor.accountId, row.id), resolved.conflicts);
  const bytes = Buffer.from(text, "utf8");
  const strokesSha = digest(bytes);
  const rasterSha = raster ? digest(raster) : null;
  const unchanged = row.sketch?.strokes_sha256 === strokesSha && (row.raster_sha ?? null) === rasterSha;
  if (unchanged) return ok(200, await observationBody(client, actor.accountId, row.id), resolved.conflicts);
  await putObject(strokeKey(actor.accountId, row.id, strokesSha), bytes, "application/json");
  if (raster && rasterSha) await putObject(rasterKey(actor.accountId, row.id, rasterSha), raster, "image/png");
  await client.query(
    "UPDATE observations SET sketch = $2, sketch_marks = $3, raster_sha = $4, version = $5, field_meta = $6 WHERE id = $1",
    [row.id, JSON.stringify({ strokes_sha256: strokesSha, strokes_size: bytes.length, has_raster: raster !== null }), markCount(file), rasterSha, row.version + 1, JSON.stringify(resolved.meta)],
  );
  await returnCitingToDraft(client, actor.accountId, row.id, false);
  return ok(200, await observationBody(client, actor.accountId, row.id), resolved.conflicts);
}

async function observationDelete(client: PoolClient, actor: Actor, b: Record<string, unknown>): Promise<Outcome> {
  const row = await ownedObservationForChange(client, actor.accountId, b.observation_id);
  if (row.deleted) return ok(200, { id: row.id, deleted: true });
  const fields = new Fields();
  const baseVersion = baseVersionOf(b, fields);
  const refuse = (code: string) => ok(409, { error: code, observation: observationView(row) });
  const citing = (await client.query<{ id: string; state: string; observation_ids: string[] }>(
    "SELECT id, state, observation_ids FROM packets WHERE account_id = $1 AND observation_ids @> ARRAY[$2]::uuid[]",
    [actor.accountId, row.id],
  )).rows;
  if (citing.some((p) => p.state === "sending" || p.state === "sent")) return refuse("cited_by_sent_packet");
  if (citing.some((p) => p.observation_ids.length === 1)) return refuse("only_row_of_packet");
  if (!fields.any && editedSince(row.field_meta, actor.device, baseVersion)) return refuse("edited_since");
  fields.check();
  const keys = [
    ...(await listKeys(strokePrefix(actor.accountId, row.id))),
    ...(await listKeys(rasterPrefix(actor.accountId, row.id))),
    ...(await Promise.all(citing.map((p) => listKeys(pdfPrefix(actor.accountId, p.id))))).flat(),
  ];
  await client.query("UPDATE observations SET deleted = true, sketch = NULL, sketch_marks = 0 WHERE id = $1", [row.id]);
  await returnCitingToDraft(client, actor.accountId, row.id, true);
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch {
      await client.query("INSERT INTO pending_removals (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
    }
  }
  return ok(200, { id: row.id, deleted: true });
}

/* ---------- the journal ---------- */

async function dispatch(client: PoolClient, actor: Actor, kind: ChangeKind, body: Record<string, unknown>): Promise<Outcome> {
  switch (kind) {
    case "session.create":
      return sessionCreate(client, actor, body);
    case "session.optics":
      return sessionOptics(client, actor, body);
    case "observation.create":
      return observationCreate(client, actor, body);
    case "observation.update":
      return observationUpdate(client, actor, body);
    case "sketch.put":
      return sketchPut(client, actor, body);
    case "observation.delete":
      return observationDelete(client, actor, body);
  }
}

function shapeError(change: unknown): Outcome | null {
  const c = asRecord(change);
  const fields = new Fields();
  if (typeof c.client_op_id !== "string" || c.client_op_id.length === 0 || c.client_op_id.length > 100) fields.add("client_op_id");
  if (typeof c.kind !== "string" || !(KINDS as readonly string[]).includes(c.kind)) fields.add("kind");
  return fields.any ? ok(422, fields.toError().body, []) : null;
}

async function applyChange(actor: Actor, change: unknown): Promise<ChangeResult> {
  const c = asRecord(change) as Partial<Change>;
  const opId = typeof c.client_op_id === "string" ? c.client_op_id : "";
  const bad = shapeError(change);
  if (bad) return { client_op_id: opId, status: bad.status, replayed: false, body: bad.body, conflicts: [] };
  const kind = c.kind as ChangeKind;
  const body = asRecord(c.body);
  const payload = canonical({ kind, body });
  try {
    return await transaction(async (client) => {
      await lockAccount(client, actor.accountId);
      const stored = (await client.query<{ payload: string; status: number; body: Record<string, unknown>; conflicts: Conflict[] }>(
        "SELECT payload, status, body, conflicts FROM sync_results WHERE account_id = $1 AND client_op_id = $2",
        [actor.accountId, opId],
      )).rows[0];
      if (stored) {
        if (stored.payload === payload) return { client_op_id: opId, status: stored.status, replayed: true, body: stored.body, conflicts: stored.conflicts };
        return { client_op_id: opId, status: 409, replayed: false, body: { error: "op_conflict" }, conflicts: [] };
      }
      let outcome: Outcome;
      try {
        await client.query("SAVEPOINT change");
        outcome = await dispatch(client, actor, kind, body);
        if (outcome.status >= 400) await client.query("ROLLBACK TO SAVEPOINT change");
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await client.query("ROLLBACK TO SAVEPOINT change");
        outcome = ok(error.status, error.body);
      }
      await client.query(
        "INSERT INTO sync_results (account_id, client_op_id, payload, status, body, conflicts) VALUES ($1,$2,$3,$4,$5,$6)",
        [actor.accountId, opId, payload, outcome.status, JSON.stringify(outcome.body), JSON.stringify(outcome.conflicts)],
      );
      return { client_op_id: opId, status: outcome.status, replayed: false, body: outcome.body, conflicts: outcome.conflicts };
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      return { client_op_id: opId, status: 503, replayed: false, body: { error: "storage_unavailable" }, conflicts: [] };
    }
    throw error;
  }
}

export async function sync(accountId: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  const fields = new Fields();
  if (typeof input.device !== "string" || input.device.length < 1 || input.device.length > 40) fields.add("device");
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 200) fields.add("changes");
  fields.check();
  const actor: Actor = { accountId, device: input.device as string };
  const results: ChangeResult[] = [];
  for (const change of input.changes as unknown[]) results.push(await applyChange(actor, change));
  return { status: 200, body: { results } };
}

