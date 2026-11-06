// Readings ingestion. A batch is validated as a whole, then applied under the project lock in one
// commit with its revisions, the breaks it causes, their reversals and their queued alerts.

import { randomUUID } from "node:crypto";
import { findProject, visibleProject, type Person, type Project } from "../auth.js";
import { deliverQueuedAlerts, queueBrokenSealAlert } from "../alerts.js";
import { lockProject, transaction, type Db } from "../db.js";
import { canonicalFile, fingerprintOf, type Reading } from "../domain/derivation.js";
import { Rational } from "../domain/rational.js";
import { isHalfHour, nowSeconds, parseTimestamp } from "../domain/time.js";
import { FIGURE_COLUMNS, markBroken, readingsInScope, writeReversals, type StoredFigure } from "../figures.js";
import { HttpError, JsonNumber, notFound, validationError, type Context, type Reply, type Route } from "../http.js";
import { requirePerson } from "./common.js";

const MAX_READINGS = 5000;
const INGEST_BODY_LIMIT = 2_000_000;

/** A JSON number with at most four decimals inside [min, max], in units of 0.0001; null otherwise. */
function fourDecimals(value: unknown, min: number, max: number): number | null {
  if (!(value instanceof JsonNumber)) return null;
  const units = Rational.decimal(value.source).mul(Rational.of(10_000n));
  if (units.den !== 1n || units.num < BigInt(min) * 10_000n || units.num > BigInt(max) * 10_000n) return null;
  return Number(units.num);
}

function qualityCode(value: unknown): number | null {
  if (!(value instanceof JsonNumber)) return null;
  const code = Rational.decimal(value.source);
  return code.den === 1n && code.num >= 0n && code.num <= 3n ? Number(code.num) : null;
}

function validateBatch(project: Project, body: Context["body"]): Reading[] {
  const submittedReadings = body.readings;
  if (!Array.isArray(submittedReadings) || submittedReadings.length < 1 || submittedReadings.length > MAX_READINGS) {
    throw validationError({ readings: `must hold 1 to ${MAX_READINGS} readings` });
  }
  const sensors = new Set(project.sensors.map((s) => s.id));
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const readings: Reading[] = [];
  submittedReadings.forEach((submitted: unknown, i) => {
    const at = `readings[${i}]`;
    const reading = submitted !== null && typeof submitted === "object" && !Array.isArray(submitted) ? (submitted as Record<string, unknown>) : {};
    const sensorId = typeof reading.sensor_id === "string" && sensors.has(reading.sensor_id) ? reading.sensor_id : null;
    const start = parseTimestamp(reading.interval_start);
    const fcE4 = fourDecimals(reading.fc, -100, 100);
    const fch4E4 = fourDecimals(reading.fch4, -1000, 5000);
    const qc = qualityCode(reading.qc);
    if (sensorId === null) errors[`${at}.sensor_id`] = "must be a sensor of this project";
    if (start === null || !isHalfHour(start)) errors[`${at}.interval_start`] = "must be a UTC half-hour in the form YYYY-MM-DDTHH:MM:SSZ";
    if (fcE4 === null) errors[`${at}.fc`] = "must be a number from -100 to 100 with at most four decimals";
    if (fch4E4 === null) errors[`${at}.fch4`] = "must be a number from -1000 to 5000 with at most four decimals";
    if (qc === null) errors[`${at}.qc`] = "must be the integer 0, 1, 2 or 3";
    if (sensorId !== null && start !== null) {
      const identity = `${sensorId}@${start}`;
      if (seen.has(identity)) errors[at] = "repeats a sensor and interval already in this batch";
      seen.add(identity);
    }
    if (sensorId !== null && start !== null && fcE4 !== null && fch4E4 !== null && qc !== null) {
      readings.push({ sensorId, intervalStart: start, fcE4, fch4E4, qc });
    }
  });
  if (Object.keys(errors).length) throw validationError(errors);
  return readings;
}

/** Steward ingestion may target every project; anyone else sees their visible projects and gets 403. */
async function ingestionProject(person: Person, slug: string): Promise<Project> {
  if (person.org_role !== "steward") {
    await visibleProject(person, slug);
    throw new HttpError(403, { error: "forbidden" });
  }
  const project = await findProject(slug);
  if (!project) throw notFound();
  return project;
}

const COLUMNS = (rows: Reading[]) => [
  rows.map((r) => r.sensorId), rows.map((r) => r.intervalStart), rows.map((r) => r.fcE4), rows.map((r) => r.fch4E4), rows.map((r) => r.qc),
];

/** Inserts and revises readings; returns what changed with the values each replaced. */
async function applyReadings(db: Db, project: Project, batchId: string, incoming: Reading[], now: number) {
  const { rows: existing } = await db.query<{ sensor_id: string; t: number; fc_e4: number; fch4_e4: number; qc: number }>(
    `SELECT r.sensor_id, epoch(r.interval_start) AS t, r.fc_e4, r.fch4_e4, r.qc
       FROM readings r JOIN unnest($1::text[], $2::int8[]) AS u(s, t) ON r.sensor_id = u.s AND r.interval_start = to_timestamp(u.t)`,
    [incoming.map((r) => r.sensorId), incoming.map((r) => r.intervalStart)]);
  const stored = new Map(existing.map((r) => [`${r.sensor_id}@${r.t}`, r]));
  const inserted: Reading[] = [];
  const revised: { reading: Reading; old: { fc_e4: number; fch4_e4: number; qc: number } }[] = [];
  for (const reading of incoming) {
    const old = stored.get(`${reading.sensorId}@${reading.intervalStart}`);
    if (!old) inserted.push(reading);
    else if (old.fc_e4 !== reading.fcE4 || old.fch4_e4 !== reading.fch4E4 || old.qc !== reading.qc) revised.push({ reading, old });
  }
  if (inserted.length) {
    await db.query(
      `INSERT INTO readings (sensor_id, interval_start, project, fc_e4, fch4_e4, qc)
       SELECT s, to_timestamp(t), $6, f, m, q FROM unnest($1::text[], $2::int8[], $3::int[], $4::int[], $5::int[]) AS u(s, t, f, m, q)`,
      [...COLUMNS(inserted), project.slug]);
  }
  if (revised.length) {
    await db.query(
      `UPDATE readings r SET fc_e4 = u.f, fch4_e4 = u.m, qc = u.q
         FROM unnest($1::text[], $2::int8[], $3::int[], $4::int[], $5::int[]) AS u(s, t, f, m, q)
        WHERE r.sensor_id = u.s AND r.interval_start = to_timestamp(u.t)`, COLUMNS(revised.map((r) => r.reading)));
  }
  const changed = [...inserted.map((reading) => ({ reading, old: null })), ...revised];
  if (changed.length) {
    await db.query(
      `INSERT INTO revisions (project, sensor_id, interval_start, old_fc_e4, old_fch4_e4, old_qc, new_fc_e4, new_fch4_e4, new_qc, batch_id, revised_at)
       SELECT $9, s, to_timestamp(t), ofc, om, oq, f, m, q, $10, to_timestamp($11)
         FROM unnest($1::text[], $2::int8[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[])
           AS u(s, t, f, m, q, ofc, om, oq)`,
      [...COLUMNS(changed.map((c) => c.reading)), changed.map((c) => c.old?.fc_e4 ?? null),
        changed.map((c) => c.old?.fch4_e4 ?? null), changed.map((c) => c.old?.qc ?? null), project.slug, batchId, now]);
  }
  return { inserted: inserted.length, revised: revised.length, changed: changed.map((c) => c.reading) };
}

/** Breaks every sealed figure whose fingerprint the changed readings altered; returns their ids. */
async function breakAlteredFigures(db: Db, project: Project, changed: Reading[], now: number): Promise<string[]> {
  const { rows: sealed } = await db.query<StoredFigure>(
    `SELECT ${FIGURE_COLUMNS} FROM figures WHERE project = $1 AND status = 'sealed' ORDER BY id`, [project.slug]);
  const broken: string[] = [];
  for (const figure of sealed) {
    const moved = changed.filter((r) => figure.sensor_ids.includes(r.sensorId) && r.intervalStart >= figure.start && r.intervalStart < figure.end);
    if (moved.length === 0) continue;
    const current = fingerprintOf(canonicalFile(await readingsInScope(db, figure.sensor_ids, figure.start, figure.end)));
    if (current === figure.fingerprint) continue;
    await markBroken(db, figure.id);
    const reversed = await writeReversals(db, figure.id, now);
    await queueBrokenSealAlert(db, project, figure, moved.length, reversed, now);
    broken.push(figure.id);
  }
  return broken;
}

async function ingest(ctx: Context): Promise<Reply> {
  const person = await requirePerson(ctx);
  const project = await ingestionProject(person, ctx.params.slug!);
  const incoming = validateBatch(project, ctx.body);
  const result = await transaction(async (db) => {
    await lockProject(db, project.slug);
    const batchId = randomUUID();
    const now = nowSeconds();
    await db.query("INSERT INTO batches (id, project, received_at) VALUES ($1, $2, to_timestamp($3))", [batchId, project.slug, now]);
    const applied = await applyReadings(db, project, batchId, incoming, now);
    const brokenFigures = await breakAlteredFigures(db, project, applied.changed, now);
    return {
      batch_id: batchId, inserted: applied.inserted, revised: applied.revised,
      unchanged: incoming.length - applied.inserted - applied.revised, broken_figures: brokenFigures,
    };
  });
  if (result.broken_figures.length) void deliverQueuedAlerts();
  return { status: 200, json: result };
}

export const readingRoutes: Route[] = [
  { method: "POST", pattern: /^\/api\/projects\/(?<slug>[a-z0-9-]+)\/readings$/, bodyLimit: INGEST_BODY_LIMIT, handle: ingest },
];

