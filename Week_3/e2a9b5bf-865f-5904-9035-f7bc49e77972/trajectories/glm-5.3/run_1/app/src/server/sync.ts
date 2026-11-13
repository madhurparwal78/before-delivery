// The sync journal (DP-20, DP-21, DP-22, DP-65, DP-87). Changes are applied
// one at a time, in array order, and each change's result is decided in the
// published order inside one transaction.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { Observation, SyncChange, SyncResult } from "#shared/api.js";
import { incomingWins, type ConflictReport, type FieldEdit, type ResolvableField } from "#shared/conflicts.js";
import { fieldMessages } from "#shared/messages.js";
import { canonicalUtc, EDIT_FUTURE_TOLERANCE_SECONDS, eveningDateFor, localHHMM, observedAtWithinSession, parseInputTime, utcOffset } from "#shared/time.js";
import { deriveOptics, type OpticsChoice, type TrainId } from "#shared/optics.js";
import { isPngBytes, parseStrokeFileText, RASTER_LIMIT_BYTES, STROKE_FILE_LIMIT_BYTES, strokeFileHasMarks } from "#shared/strokes.js";
import { makePair } from "#shared/pair.js";
import { ApiError } from "./errors.js";
import { observationLockKey, withTransaction } from "./db.js";
import { OBSERVATION_SELECT, SESSION_SELECT, observationFromRow, sessionFromRow, type ObservationRow, type SessionRow } from "./rows.js";
import { concentrationClasses, validConcentrationClass, validDeviceName, validSeeing, validTimeZone, validTransparency } from "./validate.js";
import { catalogue } from "#shared/catalogue.js";
import { packetReturnToDraftForObservation } from "./packets.js";
import { sha256Hex, type StorageClient } from "./services/storage.js";
import { applyFieldsToRow, loadFieldEdits, loadObservationRow, resolveFields, type AppliedField, type IncomingField } from "./observationOps.js";

export interface SyncOutcome {
  readonly result: SyncResult;
}

export interface ChangeOutcome {
  readonly status: number;
  readonly body: unknown;
  readonly conflicts: readonly ConflictReport[];
}

export async function applySyncBatch(
  pool: Pool,
  storage: StorageClient,
  accountId: string,
  device: string,
  changes: readonly SyncChange[],
): Promise<readonly SyncResult[]> {
  const results: SyncResult[] = [];
  for (const change of changes) {
    const result = await applyOneChange(pool, storage, accountId, device, change);
    results.push(result);
  }
  return results;
}

async function applyOneChange(
  pool: Pool,
  storage: StorageClient,
  accountId: string,
  device: string,
  change: SyncChange,
): Promise<SyncResult> {
  // 1. Replay of a stored op id, before any other check (DP-21).
  const stored = await pool.query<{ status: number; body: unknown; conflicts: ConflictReport[] }>(
    "SELECT status, body, conflicts FROM sync_ops WHERE account_id = $1 AND client_op_id = $2",
    [accountId, change.client_op_id],
  );
  if (stored.rows[0]) {
    const row = stored.rows[0];
    const payloadEqual = await payloadMatches(pool, accountId, change);
    if (payloadEqual) {
      return { client_op_id: change.client_op_id, status: row.status, replayed: true, body: row.body, conflicts: row.conflicts ?? [] };
    }
    return { client_op_id: change.client_op_id, status: 409, replayed: false, body: { error: "op_conflict" }, conflicts: [] };
  }

  // A failed change does not stop later ones: its status and body become
  // that change's own result (DP-20).
  let outcome: ChangeOutcome;
  try {
    outcome = await decideChange(pool, storage, accountId, device, change);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      // Nothing stored, so a retry with the same op id runs as new (DP-87).
      throw error;
    }
    if (error instanceof ApiError) {
      outcome = { status: error.status, body: error.body(), conflicts: [] };
    } else {
      console.error("internal", error);
      outcome = { status: 500, body: { error: "internal" }, conflicts: [] };
    }
  }

  if (outcome.status < 500) {
    await storeResult(pool, accountId, change, outcome);
  }
  return { client_op_id: change.client_op_id, status: outcome.status, replayed: false, body: outcome.body, conflicts: outcome.conflicts };
}

// Payloads are compared as JSON values, so key order never matters (DP-21).
async function payloadMatches(pool: Pool, accountId: string, change: SyncChange): Promise<boolean> {
  const row = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM sync_ops WHERE account_id = $1 AND client_op_id = $2",
    [accountId, change.client_op_id],
  );
  const storedPayload = row.rows[0]?.payload;
  return canonicalJson(storedPayload) === canonicalJson(change);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

async function storeResult(pool: Pool, accountId: string, change: SyncChange, outcome: ChangeOutcome): Promise<void> {
  await pool.query(
    `INSERT INTO sync_ops (account_id, client_op_id, kind, status, body, conflicts, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (account_id, client_op_id) DO NOTHING`,
    [accountId, change.client_op_id, change.kind, outcome.status, JSON.stringify(outcome.body), JSON.stringify(outcome.conflicts), JSON.stringify(change)],
  );
}

async function decideChange(
  pool: Pool,
  storage: StorageClient,
  accountId: string,
  device: string,
  change: SyncChange,
): Promise<ChangeOutcome> {
  switch (change.kind) {
    case "session.create":
      return applySessionCreate(pool, accountId, change);
    case "session.optics":
      return applySessionOptics(pool, accountId, change);
    case "observation.create":
      return applyObservationCreate(pool, accountId, device, change);
    case "observation.update":
      return applyObservationUpdate(pool, accountId, device, change, storage);
    case "sketch.put":
      return applySketchPut(pool, storage, accountId, device, change);
    case "observation.delete":
      return applyObservationDelete(pool, storage, accountId, device, change);
    default:
      return { status: 422, body: { error: "validation", fields: { kind: "Unknown change kind." } }, conflicts: [] };
  }
}

// ---- sessions -----------------------------------------------------------

async function loadSessionRow(client: PoolClient, accountId: string, sessionId: string): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `${SESSION_SELECT} WHERE s.id = $1 AND s.account_id = $2`,
    [sessionId, accountId],
  );
  return result.rows[0] ?? null;
}

function parseOpticsPayload(value: unknown): OpticsChoice | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const telescopeId = typeof obj["telescope_id"] === "string" ? obj["telescope_id"] : null;
  const eyepieceId = typeof obj["eyepiece_id"] === "string" ? obj["eyepiece_id"] : null;
  const barlowId = typeof obj["barlow_id"] === "string" ? obj["barlow_id"] : null;
  const train = obj["train"];
  if (!telescopeId || !eyepieceId) return null;
  if (train !== "straight" && train !== "mirror_diagonal" && train !== "erecting_prism") return null;
  return { telescope_id: telescopeId, eyepiece_id: eyepieceId, barlow_id: barlowId, train };
}

interface KitSpec {
  readonly telescopes: Map<string, { aperture_mm: number; focal_length_mm: number }>;
  readonly eyepieces: Map<string, { focal_length_mm: number; apparent_field_deg: number }>;
  readonly barlows: Map<string, { factor: number }>;
}

async function loadKit(client: PoolClient, accountId: string): Promise<KitSpec> {
  const telescopes = await client.query<{ id: string; aperture_mm: string; focal_length_mm: string }>(
    "SELECT id, aperture_mm, focal_length_mm FROM telescopes WHERE account_id = $1",
    [accountId],
  );
  const eyepieces = await client.query<{ id: string; focal_length_mm: string; apparent_field_deg: string }>(
    "SELECT id, focal_length_mm, apparent_field_deg FROM eyepieces WHERE account_id = $1",
    [accountId],
  );
  const barlows = await client.query<{ id: string; factor: string }>("SELECT id, factor FROM barlows WHERE account_id = $1", [accountId]);
  return {
    telescopes: new Map(telescopes.rows.map((r) => [r.id, { aperture_mm: Number(r.aperture_mm), focal_length_mm: Number(r.focal_length_mm) }])),
    eyepieces: new Map(eyepieces.rows.map((r) => [r.id, { focal_length_mm: Number(r.focal_length_mm), apparent_field_deg: Number(r.apparent_field_deg) }])),
    barlows: new Map(barlows.rows.map((r) => [r.id, { factor: Number(r.factor) }])),
  };
}

function deriveForOptics(kit: KitSpec, optics: OpticsChoice) {
  const telescope = kit.telescopes.get(optics.telescope_id);
  const eyepiece = kit.eyepieces.get(optics.eyepiece_id);
  if (!telescope || !eyepiece) return null;
  const barlow = optics.barlow_id ? kit.barlows.get(optics.barlow_id) : null;
  if (optics.barlow_id && !barlow) return null;
  const factor = barlow?.factor ?? 1;
  return { derived: deriveOptics(telescope, eyepiece, factor, optics.train), valid: true };
}

async function applySessionCreate(pool: Pool, accountId: string, change: SyncChange): Promise<ChangeOutcome> {
  const sessionId = typeof change.session_id === "string" ? change.session_id : null;
  const siteId = typeof change.site_id === "string" ? change.site_id : null;
  const startedAt = typeof change.started_at === "string" ? change.started_at : null;
  if (!sessionId || !siteId || !startedAt) {
    return { status: 422, body: { error: "validation", fields: { session_id: fieldMessages.object_id } }, conflicts: [] };
  }
  return withTransaction(pool, async (client) => {
    const idConflict = await client.query<{ id: string; account_id: string }>(
      "SELECT id, account_id FROM observing_sessions WHERE id = $1",
      [sessionId],
    );
    const conflictingSession = idConflict.rows[0];
    if (conflictingSession) {
      if (conflictingSession.account_id !== accountId) {
        throw new ApiError(404, "not_found");
      }
      // Same account but a different op id: id_conflict. A stored op id was
      // answered earlier, so this is a new change.
      throw new ApiError(409, "id_conflict");
    }
    const site = await client.query<{ id: string; time_zone: string }>(
      "SELECT id, time_zone FROM sites WHERE id = $1 AND account_id = $2",
      [siteId, accountId],
    );
    if (!site.rows[0]) throw new ApiError(404, "not_found");
    const timeZone = site.rows[0].time_zone;
    const parsedStart = parseInputTime(startedAt);
    if (!parsedStart) {
      return { status: 422, body: { error: "validation", fields: { started_at: fieldMessages.started_at } }, conflicts: [] as ConflictReport[] };
    }
    if (parsedStart.epochMs > Date.now() + START_FUTURE_SECONDS * 1000) {
      return { status: 422, body: { error: "validation", fields: { started_at: fieldMessages.started_at } }, conflicts: [] as ConflictReport[] };
    }
    const optics = parseOpticsPayload(change.optics);
    if (!optics) {
      return { status: 422, body: { error: "validation", fields: { optics: fieldMessages.optics } }, conflicts: [] as ConflictReport[] };
    }
    const kit = await loadKit(client, accountId);
    const derivedResult = deriveForOptics(kit, optics);
    if (!derivedResult) {
      return { status: 422, body: { error: "validation", fields: { optics: fieldMessages.optics } }, conflicts: [] as ConflictReport[] };
    }
    await client.query(
      `INSERT INTO observing_sessions (id, account_id, site_id, started_at, started_at_text, evening_date, local_start, local_start_offset, telescope_id, eyepiece_id, barlow_id, train, derived)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        sessionId, accountId, siteId, new Date(parsedStart.epochMs), parsedStart.text,
        eveningDateFor(parsedStart.epochMs, timeZone), localHHMM(parsedStart.epochMs, timeZone), utcOffset(parsedStart.epochMs, timeZone),
        optics.telescope_id, optics.eyepiece_id, optics.barlow_id, optics.train, JSON.stringify(derivedResult.derived),
      ],
    );
    const row = await loadSessionRow(client, accountId, sessionId);
    if (!row) throw new ApiError(404, "not_found");
    return { status: 201, body: sessionFromRow(row), conflicts: [] };
  });
}

const START_FUTURE_SECONDS = 60;

async function applySessionOptics(pool: Pool, accountId: string, change: SyncChange): Promise<ChangeOutcome> {
  const sessionId = typeof change.session_id === "string" ? change.session_id : null;
  if (!sessionId) return { status: 422, body: { error: "validation", fields: { session_id: fieldMessages.object_id } }, conflicts: [] };
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(sessionId)]);
    const existing = await client.query<{ account_id: string }>("SELECT account_id FROM observing_sessions WHERE id = $1", [sessionId]);
    const sessionRecord = existing.rows[0];
    if (!sessionRecord) throw new ApiError(404, "not_found");
    if (sessionRecord.account_id !== accountId) throw new ApiError(404, "not_found");
    const optics = parseOpticsPayload(change.optics);
    if (!optics) {
      return { status: 422, body: { error: "validation", fields: { optics: fieldMessages.optics } }, conflicts: [] as ConflictReport[] };
    }
    const kit = await loadKit(client, accountId);
    const derivedResult = deriveForOptics(kit, optics);
    if (!derivedResult) {
      return { status: 422, body: { error: "validation", fields: { optics: fieldMessages.optics } }, conflicts: [] as ConflictReport[] };
    }
    await client.query(
      "UPDATE observing_sessions SET telescope_id = $1, eyepiece_id = $2, barlow_id = $3, train = $4, derived = $5 WHERE id = $6",
      [optics.telescope_id, optics.eyepiece_id, optics.barlow_id, optics.train, JSON.stringify(derivedResult.derived), sessionId],
    );
    const row = await loadSessionRow(client, accountId, sessionId);
    if (!row) throw new ApiError(404, "not_found");
    return { status: 200, body: sessionFromRow(row), conflicts: [] };
  });
}

function packetLockNumber(id: string): string {
  const bytes = Buffer.from(id.replace(/-/g, "").padEnd(32, "0").slice(0, 32), "hex");
  return bytes.readBigInt64BE(8).toString();
}

// ---- observations -------------------------------------------------------

function parseEditedAt(value: unknown): { edit: FieldEdit | null; error?: string } {
  if (typeof value !== "string") return { edit: null, error: fieldMessages.edited_at };
  const parsed = parseInputTime(value);
  if (!parsed) return { edit: null, error: fieldMessages.edited_at };
  if (parsed.epochMs > Date.now() + EDIT_FUTURE_TOLERANCE_SECONDS * 1000) {
    return { edit: null, error: fieldMessages.edited_at };
  }
  return { edit: { edited_at: parsed.text, edited_epoch_ms: parsed.epochMs, device: "" } };
}

type FieldErrors = Record<string, string>;

interface PayloadFields {
  readonly fields: IncomingField[];
  readonly errors: FieldErrors;
}

function collectFields(payload: unknown, kind: "double_star" | "globular" | "other"): PayloadFields {
  const fields: IncomingField[] = [];
  const errors: FieldErrors = {};
  if (typeof payload !== "object" || payload === null) return { fields, errors };
  const obj = payload as Record<string, unknown>;
  if ("observed_at" in obj) {
    const value = obj["observed_at"];
    if (value === null) fields.push({ field: "observed_at", value: null });
    else if (typeof value === "string" && parseInputTime(value)) fields.push({ field: "observed_at", value });
    else errors["observed_at"] = fieldMessages.observed_at;
  }
  if ("seeing" in obj) {
    const result = validSeeing(obj["seeing"]);
    if (result.error) errors["seeing"] = result.error;
    else fields.push({ field: "seeing", value: result.seeing });
  }
  if ("transparency_nelm" in obj) {
    const result = validTransparency(obj["transparency_nelm"]);
    if (result.error) errors["transparency_nelm"] = result.error;
    else fields.push({ field: "transparency_nelm", value: result.nelm });
  }
  if ("concentration_class" in obj) {
    const value = obj["concentration_class"];
    if (value === null) fields.push({ field: "concentration_class", value: null });
    else {
      const result = validConcentrationClass(value);
      if (result.error || (result.value !== null && kind !== "globular")) errors["concentration_class"] = fieldMessages.concentration_class;
      else fields.push({ field: "concentration_class", value: result.value });
    }
  }
  if ("pair" in obj) {
    const value = obj["pair"];
    if (value === null) fields.push({ field: "pair", value: null });
    else if (validPairValue(value, kind)) fields.push({ field: "pair", value });
    else errors["pair"] = fieldMessages.pair;
  }
  if ("description" in obj) {
    const value = obj["description"];
    if (typeof value === "string") {
      if (value.trim().length > 4000) errors["description"] = fieldMessages.description;
      else fields.push({ field: "description", value });
    } else if (value === null) fields.push({ field: "description", value: "" });
    else errors["description"] = fieldMessages.description;
  }
  return { fields, errors };
}

function validPairValue(value: unknown, kind: "double_star" | "globular" | "other"): boolean {
  if (kind !== "double_star") return false;
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  const primary = obj["primary"];
  const secondary = obj["secondary"];
  if (!Array.isArray(primary) || primary.length !== 2 || !Array.isArray(secondary) || secondary.length !== 2) return false;
  for (const point of [primary, secondary]) {
    for (const coordinate of point) {
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) return false;
      if (Math.round(coordinate * 100) / 100 !== coordinate) return false;
    }
  }
  return primary[0] !== secondary[0] || primary[1] !== secondary[1];
}

function validOpticsField(value: unknown, kit: KitSpec): OpticsChoice | null {
  const parsed = parseOpticsPayload(value);
  if (!parsed) return null;
  return deriveForOptics(kit, parsed) ? parsed : null;
}

async function applyObservationCreate(
  pool: Pool,
  accountId: string,
  device: string,
  change: SyncChange,
): Promise<ChangeOutcome> {
  const observationId = typeof change.observation_id === "string" ? change.observation_id : null;
  const sessionId = typeof change.session_id === "string" ? change.session_id : null;
  const objectId = typeof change.object_id === "string" ? change.object_id : null;
  const edited = parseEditedAt(change.edited_at);
  const empty: ConflictReport[] = [];
  if (!observationId || !sessionId) {
    return { status: 422, body: { error: "validation", fields: { observation_id: fieldMessages.object_id } }, conflicts: empty };
  }
  if (!objectId || !catalogue.some((o) => o.id === objectId)) {
    return { status: 422, body: { error: "validation", fields: { object_id: fieldMessages.object_id } }, conflicts: empty };
  }
  if (edited.error) {
    return { status: 422, body: { error: "validation", fields: { edited_at: edited.error } }, conflicts: empty };
  }
  const object = catalogue.find((o) => o.id === objectId)!;
  const kindBucket = object.kind === "double_star" ? "double_star" : object.kind === "globular" ? "globular" : "other";
  const { fields, errors } = collectFields(change.fields, kindBucket);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ account_id: string; deleted: boolean }>(
      "SELECT account_id, deleted FROM observations WHERE id = $1",
      [observationId],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      if (existingRow.account_id !== accountId) throw new ApiError(404, "not_found");
      if (existingRow.deleted) throw new ApiError(409, "observation_deleted");
      throw new ApiError(409, "id_conflict");
    }
    const session = await client.query<{ account_id: string; started_at_text: string; evening_date: string; time_zone: string; telescope_id: string | null; eyepiece_id: string | null; barlow_id: string | null; train: string }>(
      `SELECT s.account_id, s.started_at_text, s.evening_date, si.time_zone, s.telescope_id, s.eyepiece_id, s.barlow_id, s.train
       FROM observing_sessions s JOIN sites si ON si.id = s.site_id WHERE s.id = $1`,
      [sessionId],
    );
    const sessionRow = session.rows[0];
    if (!sessionRow) throw new ApiError(404, "not_found");
    if (sessionRow.account_id !== accountId) throw new ApiError(404, "not_found");

    const kit = await loadKit(client, accountId);
    let optics: OpticsChoice | null = null;
    let derived: ReturnType<typeof deriveForOptics> = null;
    const payloadFields = (change.fields ?? {}) as Record<string, unknown>;
    if ("optics" in payloadFields) {
      optics = validOpticsField(payloadFields["optics"], kit);
      if (!optics) return { status: 422, body: { error: "validation", fields: { optics: fieldMessages.optics } }, conflicts: empty };
      derived = deriveForOptics(kit, optics);
    } else {
      const sessionOptics: OpticsChoice = {
        telescope_id: sessionRow.telescope_id ?? "",
        eyepiece_id: sessionRow.eyepiece_id ?? "",
        barlow_id: sessionRow.barlow_id,
        train: sessionRow.train as TrainId,
      };
      derived = deriveForOptics(kit, sessionOptics);
    }
    if (Object.keys(errors).length > 0) {
      return { status: 422, body: { error: "validation", fields: errors }, conflicts: empty };
    }

    const start = parseInputTime(sessionRow.started_at_text)!;
    let observedAtText: string | null = null;
    let observedEpochMs: number | null = null;
    const observedField = fields.find((f) => f.field === "observed_at");
    if (observedField && typeof observedField.value === "string") {
      const parsed = parseInputTime(observedField.value);
      if (parsed && !observedAtWithinSession(parsed.epochMs, start.epochMs)) {
        return { status: 422, body: { error: "validation", fields: { observed_at: fieldMessages.observed_at } }, conflicts: empty };
      }
      if (parsed) {
        observedAtText = parsed.text;
        observedEpochMs = parsed.epochMs;
      }
    }
    const edit = edited.edit!;
    const chosenOptics = optics ?? {
      telescope_id: sessionRow.telescope_id ?? "",
      eyepiece_id: sessionRow.eyepiece_id ?? "",
      barlow_id: sessionRow.barlow_id,
      train: sessionRow.train as TrainId,
    };
    await client.query(
      `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, observed_at_text, local_time, local_offset, evening_date,
         seeing, transparency_nelm, concentration_class, description, telescope_id, eyepiece_id, barlow_id, train, derived, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1)`,
      [
        observationId, accountId, sessionId, objectId,
        observedEpochMs !== null ? new Date(observedEpochMs) : null,
        observedAtText,
        observedEpochMs !== null ? localHHMM(observedEpochMs, sessionRow.time_zone) : null,
        observedEpochMs !== null ? utcOffset(observedEpochMs, sessionRow.time_zone) : null,
        sessionRow.evening_date,
        null, null, null, "",
        chosenOptics.telescope_id, chosenOptics.eyepiece_id, chosenOptics.barlow_id, chosenOptics.train,
        JSON.stringify(derived!.derived),
      ],
    );
    // The per-field values for the created observation.
    const applied: AppliedField[] = [];
    for (const field of fields) {
      if (field.field === "observed_at") continue;
      applied.push({ field: field.field, value: field.value, editedEpochMs: edit.edited_epoch_ms, editedText: edit.edited_at });
    }
    if (optics) {
      applied.push({ field: "optics", value: optics, editedEpochMs: edit.edited_epoch_ms, editedText: edit.edited_at });
    }
    await applyFieldsToRow(client, observationId, applied, { ...edit, device });
    for (const field of ["observed_at", "seeing", "transparency_nelm", "concentration_class", "description", "optics"] as const) {
      await client.query(
        `INSERT INTO observation_field_edits (observation_id, field, edited_at_text, edited_epoch_ms, device)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (observation_id, field) DO UPDATE SET edited_at_text = EXCLUDED.edited_at_text, edited_epoch_ms = EXCLUDED.edited_epoch_ms, device = EXCLUDED.device`,
        [observationId, field, edit.edited_at, edit.edited_epoch_ms, device],
      );
    }
    const row = await loadObservationRow(client, accountId, observationId);
    if (!row) throw new ApiError(404, "not_found");
    return { status: 201, body: observationFromRow(row), conflicts: [] };
  });
}

async function applyObservationUpdate(
  pool: Pool,
  accountId: string,
  device: string,
  change: SyncChange,
  storage: StorageClient,
): Promise<ChangeOutcome> {
  const observationId = typeof change.observation_id === "string" ? change.observation_id : null;
  if (!observationId) return { status: 422, body: { error: "validation", fields: { observation_id: fieldMessages.object_id } }, conflicts: [] };
  const edited = parseEditedAt(change.edited_at);
  if (edited.error) return { status: 422, body: { error: "validation", fields: { edited_at: edited.error } }, conflicts: [] };
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [observationLockNumber(observationId)]);
    const existing = await client.query<{ account_id: string; deleted: boolean; object_id: string; version: number }>(
      "SELECT account_id, deleted, object_id, version FROM observations WHERE id = $1",
      [observationId],
    );
    const record = existing.rows[0];
    if (!record) throw new ApiError(404, "not_found");
    if (record.account_id !== accountId) throw new ApiError(404, "not_found");
    if (record.deleted) throw new ApiError(409, "observation_deleted");
    const object = catalogue.find((o) => o.id === record.object_id)!;
    const kindBucket = object.kind === "double_star" ? "double_star" : object.kind === "globular" ? "globular" : "other";
    const { fields, errors } = collectFields(change.fields, kindBucket);
    const kit = await loadKit(client, accountId);
    const payloadFields = (change.fields ?? {}) as Record<string, unknown>;
    if ("optics" in payloadFields) {
      const optics = validOpticsField(payloadFields["optics"], kit);
      if (!optics) errors["optics"] = fieldMessages.optics;
      else fields.push({ field: "optics", value: optics });
    }
    if (Object.keys(errors).length > 0) {
      return { status: 422, body: { error: "validation", fields: errors }, conflicts: [] };
    }
    const storedEdits = await loadFieldEdits(client, observationId);
    const edit: FieldEdit = { edited_at: edited.edit!.edited_at, edited_epoch_ms: edited.edit!.edited_epoch_ms, device };
    const resolution = resolveFields(fields, storedEdits, edit, record.version, change.base_version);
    if (Object.keys(resolution.errors).length > 0) {
      return { status: 422, body: { error: "validation", fields: resolution.errors }, conflicts: [] };
    }
    if (!resolution.anyApplied) {
      const row = await loadObservationRow(client, accountId, observationId);
      if (!row) throw new ApiError(404, "not_found");
      return { status: 200, body: observationFromRow(row), conflicts: resolution.reports };
    }
    await applyFieldsToRow(client, observationId, resolution.appliedFields, edit);
    // Any optics field also refreshes the stored derived values.
    const opticsApplied = resolution.appliedFields.find((f) => f.field === "optics");
    if (opticsApplied) {
      const optics = opticsApplied.value as OpticsChoice;
      const derived = deriveForOptics(kit, optics);
      if (derived) {
        await client.query("UPDATE observations SET derived = $1 WHERE id = $2", [JSON.stringify(derived.derived), observationId]);
      }
    }
    await client.query("UPDATE observations SET version = version + 1 WHERE id = $1", [observationId]);
    await packetReturnToDraftForObservation(client, accountId, observationId);
    const row = await loadObservationRow(client, accountId, observationId);
    if (!row) throw new ApiError(404, "not_found");
    return { status: 200, body: observationFromRow(row), conflicts: resolution.reports };
  });
}

async function applySketchPut(
  pool: Pool,
  storage: StorageClient,
  accountId: string,
  device: string,
  change: SyncChange,
): Promise<ChangeOutcome> {
  const observationId = typeof change.observation_id === "string" ? change.observation_id : null;
  if (!observationId) return { status: 422, body: { error: "validation", fields: { observation_id: fieldMessages.object_id } }, conflicts: [] };
  const edited = parseEditedAt(change.edited_at);
  if (edited.error) return { status: 422, body: { error: "validation", fields: { edited_at: edited.error } }, conflicts: [] };
  const strokesText = typeof change.strokes === "string" ? change.strokes : null;
  if (strokesText === null) return { status: 422, body: { error: "validation", fields: { strokes: fieldMessages.strokes } }, conflicts: [] };
  const byteLength = Buffer.byteLength(strokesText, "utf8");
  if (byteLength > STROKE_FILE_LIMIT_BYTES) {
    return { status: 422, body: { error: "validation", fields: { strokes: fieldMessages.strokes } }, conflicts: [] };
  }
  const strokes = parseStrokeFileText(strokesText);
  if (!strokes) return { status: 422, body: { error: "validation", fields: { strokes: fieldMessages.strokes } }, conflicts: [] };
  let rasterBytes: Uint8Array | null = null;
  if (typeof change.raster_png_base64 === "string") {
    try {
      rasterBytes = new Uint8Array(Buffer.from(change.raster_png_base64, "base64"));
    } catch {
      return { status: 422, body: { error: "validation", fields: { raster: fieldMessages.raster } }, conflicts: [] };
    }
    if (!isPngBytes(rasterBytes) || rasterBytes.length > RASTER_LIMIT_BYTES) {
      return { status: 422, body: { error: "validation", fields: { raster: fieldMessages.raster } }, conflicts: [] };
    }
  } else if (change.raster_png_base64 !== undefined && change.raster_png_base64 !== null) {
    return { status: 422, body: { error: "validation", fields: { raster: fieldMessages.raster } }, conflicts: [] };
  }

  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [observationLockNumber(observationId)]);
    const existing = await client.query<{ account_id: string; deleted: boolean; strokes_sha256: string | null; version: number }>(
      "SELECT account_id, deleted, strokes_sha256, version FROM observations WHERE id = $1",
      [observationId],
    );
    const record = existing.rows[0];
    // 2. 404
    if (!record) throw new ApiError(404, "not_found");
    if (record.account_id !== accountId) throw new ApiError(404, "not_found");
    // 3. 409
    if (record.deleted) throw new ApiError(409, "observation_deleted");
    // 5. field resolution
    const storedEdits = await loadFieldEdits(client, observationId);
    const edit: FieldEdit = { edited_at: edited.edit!.edited_at, edited_epoch_ms: edited.edit!.edited_epoch_ms, device };
    const resolution = resolveFields([{ field: "sketch", value: strokes }], storedEdits, edit, record.version, change.base_version);
    if (!resolution.anyApplied) {
      const row = await loadObservationRow(client, accountId, observationId);
      if (!row) throw new ApiError(404, "not_found");
      return { status: 200, body: observationFromRow(row), conflicts: resolution.reports };
    }
    // 6. storage write; a 503 leaves everything unchanged.
    const strokesBytes = Buffer.from(strokesText, "utf8");
    const strokesSha = sha256Hex(strokesBytes);
    let rasterSha: string | null = null;
    try {
      await storage.put(`observers/${accountId}/strokes/${observationId}/${strokesSha}.json`, strokesBytes, "application/json");
      if (rasterBytes) {
        rasterSha = sha256Hex(rasterBytes);
        await storage.put(`observers/${accountId}/rasters/${observationId}/${rasterSha}.png`, rasterBytes, "image/png");
      }
    } catch {
      throw new ApiError(503, "storage_unavailable");
    }
    await client.query(
      "UPDATE observations SET strokes_sha256 = $1, strokes_size = $2, raster_sha256 = $3, version = version + 1 WHERE id = $4",
      [strokesSha, strokesBytes.length, rasterSha, observationId],
    );
    await client.query(
      `INSERT INTO observation_field_edits (observation_id, field, edited_at_text, edited_epoch_ms, device)
       VALUES ($1,'sketch',$2,$3,$4)
       ON CONFLICT (observation_id, field) DO UPDATE SET edited_at_text = EXCLUDED.edited_at_text, edited_epoch_ms = EXCLUDED.edited_epoch_ms, device = EXCLUDED.device`,
      [observationId, edit.edited_at, edit.edited_epoch_ms, device],
    );
    await packetReturnToDraftForObservation(client, accountId, observationId);
    const row = await loadObservationRow(client, accountId, observationId);
    if (!row) throw new ApiError(404, "not_found");
    return { status: 200, body: observationFromRow(row), conflicts: resolution.reports };
  });
}

async function applyObservationDelete(
  pool: Pool,
  storage: StorageClient,
  accountId: string,
  device: string,
  change: SyncChange,
): Promise<ChangeOutcome> {
  const observationId = typeof change.observation_id === "string" ? change.observation_id : null;
  if (!observationId) return { status: 422, body: { error: "validation", fields: { observation_id: fieldMessages.object_id } }, conflicts: [] };
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [observationLockNumber(observationId)]);
    const existing = await client.query<{ account_id: string; deleted: boolean; object_id: string }>(
      "SELECT account_id, deleted, object_id FROM observations WHERE id = $1",
      [observationId],
    );
    const record = existing.rows[0];
    // 2. 404
    if (!record) throw new ApiError(404, "not_found");
    if (record.account_id !== accountId) throw new ApiError(404, "not_found");
    // 3. already deleted by this account: 200 with the success body.
    if (record.deleted) {
      return { status: 200, body: { id: observationId, deleted: true }, conflicts: [] };
    }
    const object = catalogue.find((o) => o.id === record.object_id)!;
    const designation = object.designation;
    // 4. cited by a packet in sending or sent.
    const cited = await client.query<{ state: string }>(
      `SELECT p.state FROM packets p
       WHERE p.account_id = $1 AND p.observation_ids @> $2::jsonb AND p.state IN ('sending','sent')`,
      [accountId, JSON.stringify([observationId])],
    );
    if (cited.rows.length > 0) {
      const row = await loadObservationRow(client, accountId, observationId);
      throw new ApiError(409, "cited_by_sent_packet", undefined, { observation: row ? observationFromRow(row) : null });
    }
    // 5. only row of another citing packet.
    const onlyRow = await client.query<{ id: string; state: string }>(
      `SELECT p.id, p.state FROM packets p
       WHERE p.account_id = $1 AND p.observation_ids @> $2::jsonb AND jsonb_array_length(p.observation_ids) = 1`,
      [accountId, JSON.stringify([observationId])],
    );
    if (onlyRow.rows.length > 0) {
      const row = await loadObservationRow(client, accountId, observationId);
      throw new ApiError(409, "only_row_of_packet", undefined, { observation: row ? observationFromRow(row) : null });
    }
    // 6. edited_since: another device set a field at a version after base_version.
    if (change.base_version !== undefined) {
      const edits = await client.query<{ device: string; field: string }>(
        "SELECT device, field FROM observation_field_edits WHERE observation_id = $1 AND device <> $2",
        [observationId, device],
      );
      const row = await client.query<{ version: number }>("SELECT version FROM observations WHERE id = $1", [observationId]);
      const currentVersion = row.rows[0]?.version ?? 0;
      if (edits.rows.length > 0 && currentVersion > change.base_version) {
        const obsRow = await loadObservationRow(client, accountId, observationId);
        throw new ApiError(409, "edited_since", undefined, { observation: obsRow ? observationFromRow(obsRow) : null });
      }
    }
    // 7. storage listing of its objects; a 503 changes and stores nothing.
    let strokeKeys: string[] = [];
    let rasterKeys: string[] = [];
    let packetPdfPrefixes: string[] = [];
    try {
      strokeKeys = [...(await storage.list(`observers/${accountId}/strokes/${observationId}/`))];
      rasterKeys = [...(await storage.list(`observers/${accountId}/rasters/${observationId}/`))];
      const citingPackets = await client.query<{ id: string }>(
        `SELECT id FROM packets WHERE account_id = $1 AND observation_ids @> $2::jsonb`,
        [accountId, JSON.stringify([observationId])],
      );
      for (const packet of citingPackets.rows) {
        packetPdfPrefixes.push(`observers/${accountId}/packets/${packet.id}/`);
      }
    } catch {
      throw new ApiError(503, "storage_unavailable");
    }
    // 8. tombstone, in one revision step per citing packet.
    await client.query("UPDATE observations SET deleted = true WHERE id = $1", [observationId]);
    await client.query("DELETE FROM observation_field_edits WHERE observation_id = $1", [observationId]);
    const citing = await client.query<{ id: string; state: string }>(
      `SELECT id, state FROM packets WHERE account_id = $1 AND observation_ids @> $2::jsonb`,
      [accountId, JSON.stringify([observationId])],
    );
    for (const packet of citing.rows) {
      const remaining = await client.query<{ observation_ids: string[] }>(
        "SELECT observation_ids FROM packets WHERE id = $1",
        [packet.id],
      );
      const currentIds = remaining.rows[0]?.observation_ids ?? [];
      const kept = currentIds.filter((id) => id !== observationId);
      const affected = packet.state !== "draft" && packet.state !== "sending" && packet.state !== "sent";
      await client.query(
        `UPDATE packets SET observation_ids = $1, revision = revision + 1,
           state = CASE WHEN $2 THEN 'draft' ELSE state END,
           rows = CASE WHEN $2 THEN '[]'::jsonb ELSE rows END,
           pdf = CASE WHEN $2 THEN NULL ELSE pdf END,
           returned_to_draft = CASE WHEN $2 THEN true ELSE returned_to_draft END
         WHERE id = $3`,
        [JSON.stringify(kept), affected, packet.id],
      );
    }
    try {
      const toRemove = [...strokeKeys, ...rasterKeys];
      for (const prefix of packetPdfPrefixes) {
        toRemove.push(...(await storage.list(prefix)));
      }
      await storage.remove(toRemove);
    } catch {
      // A removal storage refuses is retried until storage confirms it.
      for (const prefix of [`observers/${accountId}/strokes/${observationId}/`, `observers/${accountId}/rasters/${observationId}/`, ...packetPdfPrefixes]) {
        await client.query("INSERT INTO storage_cleanup (account_id, prefix, kind) VALUES ($1,$2,'pending')", [accountId, prefix]);
      }
    }
    return { status: 200, body: { id: observationId, deleted: true }, conflicts: [] };
  });
}

export { observationLockNumber };

function observationLockNumber(id: string): string {
  const bytes = Buffer.from(id.replace(/-/g, "").padEnd(32, "0").slice(0, 32), "hex");
  return bytes.readBigInt64BE(0).toString();
}
