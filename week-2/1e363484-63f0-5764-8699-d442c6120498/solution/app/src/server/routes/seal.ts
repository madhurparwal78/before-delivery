// Sealing a figure. One outcome: the figure row, its ledger entries, both evidence objects confirmed
// by the store and the notice accepted by the mail sink, or none of them.

import { createHash } from "node:crypto";
import { requireRole, visibleProject, type Person, type Project } from "../auth.js";
import { config } from "../config.js";
import { lockIdempotencyKey, lockProject, transaction, type Db } from "../db.js";
import { byteOrder, percent, type Derivation } from "../domain/derivation.js";
import { sealRefusal } from "../domain/sealRules.js";
import { nowSeconds } from "../domain/time.js";
import {
  deriveScope, evidenceKeys, figureBody, figureSequence, intactFigures, markSuperseded, writeIssuance, type StoredFigure,
} from "../figures.js";
import { HttpError, validationError, type Context, type JsonBody, type Reply, type Route } from "../http.js";
import { MailUnavailable, sendMail } from "../mail.js";
import { deleteObject, headObject, putObject, StorageUnavailable } from "../storage.js";
import { recordBounds, requirePerson, validateScope } from "./common.js";

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,100}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** Two seal requests are the same request when start, end, the set of sensor ids and the fingerprint match. */
function requestHash(body: JsonBody): string {
  const sensors = Array.isArray(body.sensor_ids)
    ? [...new Set(body.sensor_ids.map((id) => JSON.stringify(id)))].sort(byteOrder)
    : JSON.stringify(body.sensor_ids ?? null);
  return createHash("sha256")
    .update(JSON.stringify([body.start ?? null, body.end ?? null, sensors, body.preview_fingerprint ?? null]))
    .digest("hex");
}

async function storedReply(db: Db, person: Person, key: string, body: JsonBody): Promise<Reply | null> {
  const { rows } = await db.query<{ request_hash: string; status: number; body: string }>(
    `SELECT request_hash, status, body FROM idempotency_records
      WHERE person_id = $1 AND key = $2 AND created_at > to_timestamp($3)`,
    [person.id, key, nowSeconds() - config.idempotencyTtlSeconds]);
  const idempotencyRecord = rows[0];
  if (!idempotencyRecord) return null;
  if (idempotencyRecord.request_hash !== requestHash(body)) throw new HttpError(409, { error: "idempotency_key_conflict" });
  return { status: idempotencyRecord.status, rawJson: idempotencyRecord.body, headers: { "Idempotent-Replay": "true" } };
}

/** Writes both evidence objects and reads back their metadata; removes what it wrote when the store fails. */
async function storeEvidence(figureId: string, file: Buffer, fingerprint: string, derivationJson: string): Promise<void> {
  const keys = evidenceKeys(figureId);
  try {
    await putObject(keys.readings_key, file, "text/csv");
    await putObject(keys.derivation_key, Buffer.from(derivationJson, "utf8"), "application/json");
    const [readings, derivation] = await Promise.all([headObject(keys.readings_key), headObject(keys.derivation_key)]);
    if (readings.size !== file.length || readings.sha256 !== fingerprint || derivation.size !== Buffer.byteLength(derivationJson)) {
      throw new StorageUnavailable();
    }
  } catch (error) {
    await removeEvidence(figureId);
    throw error;
  }
}

async function removeEvidence(figureId: string): Promise<void> {
  const keys = evidenceKeys(figureId);
  await Promise.allSettled([deleteObject(keys.readings_key), deleteObject(keys.derivation_key)]);
}

function sealNotice(project: Project, leadEmail: string, figure: ReturnType<typeof figureBody>) {
  return {
    to: [leadEmail],
    subject: `Sealed ${figure.id}: ${figure.net_tco2e} tCO2e at ${figure.coverage_pct}% coverage`,
    lines: [
      `Figure: ${figure.id}`,
      `Project: ${project.name}`,
      `Interval: ${figure.start} to ${figure.end}`,
      `Net: ${figure.net_tco2e} tCO2e`,
      `Buffer: ${figure.buffer_tco2e} tCO2e`,
      `Credited: ${figure.credited_tco2e} tCO2e`,
      `Coverage: ${figure.coverage_pct}%`,
      `Fingerprint: ${figure.fingerprint.slice(0, 12)}`,
    ],
  };
}

function newFigureRow(id: string, project: Project, scope: { start: number; end: number; sensorIds: string[] },
  d: Derivation, person: Person, now: number, supersedes: string | null, watermark: number): StoredFigure {
  return {
    id, project: project.slug, start: scope.start, end: scope.end, sensor_ids: [...scope.sensorIds].sort(byteOrder),
    status: "sealed", supersedes, superseded_by: null,
    coverage_tenths: Number(d.coverageTenths), floor_tenths: project.floorTenths, buffer_tenths: project.bufferTenths,
    net_milli: Number(d.netMilli), co2_milli: Number(d.co2Milli), ch4_milli: Number(d.ch4Milli),
    buffer_milli: Number(d.bufferMilli), credited_milli: Number(d.creditedMilli),
    readings_count: d.readingsCount, fingerprint: d.fingerprint, contributions: d.contributions,
    sealed_at: now, sealed_by: person.id, checked_at: now, revision_watermark: watermark,
  };
}

async function seal(ctx: Context): Promise<Reply> {
  const person = await requirePerson(ctx);
  const { project, role } = await visibleProject(person, ctx.params.slug!);
  requireRole(role, "sealer");
  const keyHeader = ctx.headers["idempotency-key"];
  const key = typeof keyHeader === "string" && IDEMPOTENCY_KEY.test(keyHeader) ? keyHeader : null;

  return transaction(async (db) => {
    if (key) {
      await lockIdempotencyKey(db, person.id, key);
      const replay = await storedReply(db, person, key, ctx.body);
      if (replay) return replay;
    }

    const errors: Record<string, string> = {};
    if (!key) errors["Idempotency-Key"] = "must be 1 to 100 visible ASCII characters";
    const fingerprint = ctx.body.preview_fingerprint;
    if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) errors.preview_fingerprint = "must be 64 lowercase hex characters";
    const scope = validateScope(project, await recordBounds(db, project.slug), ctx.body, errors);
    if (!scope || !key) throw validationError(errors);

    await lockProject(db, project.slug);
    const derivation = await deriveScope(db, project, scope.start, scope.end, scope.sensorIds);
    const refusal = sealRefusal(fingerprint as string, derivation, scope.start, scope.end, await intactFigures(db, project.slug));
    if (refusal?.reason === "readings_changed") {
      throw new HttpError(409, { error: refusal.reason, fingerprint: derivation.fingerprint });
    }
    if (refusal?.reason === "below_coverage_floor") {
      throw new HttpError(409, { error: refusal.reason, coverage_pct: percent(derivation.coverageTenths), floor_pct: percent(project.floorTenths) });
    }
    if (refusal && "figureId" in refusal) throw new HttpError(409, { error: refusal.reason, figure_id: refusal.figureId });

    const { rows: [ids] } = await db.query<{ seq: number; watermark: number; lead_email: string; replaces: string | null }>(
      `SELECT nextval($1::regclass) AS seq,
              (SELECT coalesce(max(id), 0) FROM revisions) AS watermark,
              (SELECT email FROM people WHERE id = $2) AS lead_email,
              (SELECT id FROM figures WHERE project = $3 AND status = 'broken'
                  AND start_at = to_timestamp($4) AND end_at = to_timestamp($5)
                ORDER BY sealed_at DESC, id DESC LIMIT 1) AS replaces`,
      [figureSequence(project.code), project.leadPersonId, project.slug, scope.start, scope.end]);
    const now = nowSeconds();
    const figureId = `${project.code}-F${String(ids!.seq).padStart(4, "0")}`;
    const row = newFigureRow(figureId, project, scope, derivation, person, now, ids!.replaces, ids!.watermark);
    await db.query(
      `INSERT INTO figures (id, project, start_at, end_at, sensor_ids, status, supersedes, coverage_tenths, floor_tenths,
         buffer_tenths, net_milli, co2_milli, ch4_milli, buffer_milli, credited_milli, readings_count, fingerprint,
         contributions, sealed_at, sealed_by, checked_at, revision_watermark)
       VALUES ($1, $2, to_timestamp($3), to_timestamp($4), $5, 'sealed', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, to_timestamp($18), $19, to_timestamp($18), $20)`,
      [row.id, row.project, row.start, row.end, row.sensor_ids, row.supersedes, row.coverage_tenths, row.floor_tenths,
        row.buffer_tenths, row.net_milli, row.co2_milli, row.ch4_milli, row.buffer_milli, row.credited_milli,
        row.readings_count, row.fingerprint, JSON.stringify(row.contributions), now, row.sealed_by, row.revision_watermark]);
    if (row.supersedes) await markSuperseded(db, row.supersedes, row.id);
    await writeIssuance(db, project.slug, row, now);

    const figure = figureBody(row);
    const responseJson = JSON.stringify(figure);
    await storeEvidence(figureId, derivation.file, derivation.fingerprint, responseJson).catch((error: unknown) => {
      throw error instanceof StorageUnavailable ? new HttpError(503, { error: "storage_unavailable" }) : error;
    });
    await sendMail(sealNotice(project, ids!.lead_email, figure)).catch(async (error: unknown) => {
      await removeEvidence(figureId);
      throw error instanceof MailUnavailable ? new HttpError(503, { error: "mail_unavailable" }) : error;
    });
    await db.query(
      `INSERT INTO idempotency_records (person_id, key, request_hash, status, body, created_at)
       VALUES ($1, $2, $3, 201, $4, to_timestamp($5))
       ON CONFLICT (person_id, key) DO UPDATE SET request_hash = EXCLUDED.request_hash, status = 201,
         body = EXCLUDED.body, created_at = EXCLUDED.created_at`,
      [person.id, key, requestHash(ctx.body), responseJson, now]);
    return { status: 201, rawJson: responseJson };
  });
}

export const sealRoutes: Route[] = [
  { method: "POST", pattern: /^\/api\/projects\/(?<slug>[a-z0-9-]+)\/figures$/, handle: seal },
];

