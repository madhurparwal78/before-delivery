// The HTTP server: same-origin app routes, the API and the two consoles.

import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Buffer } from "node:buffer";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { db, withTransaction, query } from "./db.js";
import { applySchema } from "./schema.js";
import * as errors from "./errors.js";
import { ApiError, conflict, gone, notFound, readOnly, invalidJson, bodyTooLarge, unsupportedMediaType, outage, validation, methodNotAllowed } from "./errors.js";
import { parseStrictJson, type Json } from "../shared/strictJson.js";
import type { Json as JsonType } from "../shared/strictJson.js";
import {
  canonicalCaselessKey,
  codePointLength,
  hasForbiddenControl,
  normaliseText,
  CONTROL_CHARACTERS_MESSAGE,
} from "../shared/text.js";
import {
  DistanceUnit,
  SpeedUnit,
  PLAN_CATALOGUE,
  PlanId,
  epochMsToIso,
  formatBalance,
  formatMetLabel,
  formatMoney,
  formatSize,
  isIsoInstant,
  isoToEpochMs,
  planDefinition,
  planPriceText,
  type HermiteSample,
  computeFrame,
  frameGridMetMs,
  landmarkRangeM,
  snapSampleIndex,
} from "../shared/format.js";
import * as store from "./store.js";
import { recordChange, entryHash, type AuditEntry } from "./change.js";
import { sha256Hex, transitionSettled, transitionStored, transitionDeleted, rejectionReasonText } from "./passLifecycle.js";
import { CAPTURE_MAX_BYTES } from "./parse.js";
import { getCapture, putCapture, deleteCapture, probeStorage } from "./storage.js";
import { probeSearch, searchDocuments, ensureIndex } from "./search.js";
import { catchUpPendingWrites, recordPendingWrite, removePassDocuments, writeSearchDocuments } from "./searchWriter.js";
import { probeBroker } from "./broker.js";
import { probeCache, consumeRateLimitFailOpen, readerCount, registerReader, releaseReader, renewReader } from "./cache.js";
import * as billing from "./billing.js";
import { buildDossierHtml, buildEventCsv, dossierFilename, referenceLine } from "./dossier.js";
import { renderDossierPdf, probeRenderer } from "./renderer.js";
import * as shareLinks from "./shareLinks.js";
import { contentDisposition, percentDecodeFilename } from "./contentDisposition.js";
import { evaluateConditional } from "./httpConditional.js";
import { fetchVectors, UnknownTargetError } from "./ephemeris.js";
import { residualAt } from "./residuals.js";
import { ensureEventTypes, createEndpoint, deleteEndpoint, ensureApplication, probeWebhooks } from "./webhooks.js";
import { probePush } from "./push.js";
import { beginRequest, checkIdempotencyKey, keepRequestKey, releaseRequestKey } from "./requestKeys.js";
import { startWorkers, signalRelay } from "./workers.js";
import { seedIfNeeded, SEEDS, buildSeedCapture } from "./seed.js";
import { speakerSummaries, shareMissionBody } from "./missionData.js";
import { probeEphemeris } from "./ephemeris.js";

const JSON_BODY_LIMIT = 16384;
const CAPTURE_LIMIT = CAPTURE_MAX_BYTES;

const app = express();
app.disable("x-powered-by");
app.set("etag", false);

// Raw bodies are read manually so limit and content-type checks run in the
// brief's precedence order.
app.use((req, res, next) => {
  void readBody(req, res).then(next, next);
});

// ---- Error shape helpers ----

function sendError(res: Response, error: ApiError): void {
  const body = error.body();
  res.status(error.status);
  for (const [k, v] of Object.entries(error.headers)) {
    res.setHeader(k, v);
  }
  res.json(body);
}

function sendJson(res: Response, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.status(status);
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
  res.json(body);
}

interface BodyState {
  raw: Buffer | null;
  consumed: boolean;
}

async function readBody(req: Request, res: Response): Promise<void> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const isCapture = req.path.endsWith("/passes");
  const limit = isCapture ? CAPTURE_LIMIT : JSON_BODY_LIMIT;
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  await new Promise<void>((resolve) => {
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
        // Drain the rest of the request without keeping the bytes.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("close", () => resolve());
    req.on("error", () => resolve());
  });
  (req as unknown as { __body: Buffer | null; __tooLarge: boolean }).__body = tooLarge
    ? null
    : Buffer.concat(chunks);
  (req as unknown as { __tooLarge: boolean }).__tooLarge = tooLarge;
  void res;
}

function getRawBody(req: Request): Buffer | null {
  return (req as unknown as { __body?: Buffer | null }).__body ?? null;
}

function wasTooLarge(req: Request): boolean {
  return (req as unknown as { __tooLarge?: boolean }).__tooLarge === true;
}

function contentTypeOf(req: Request): string {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

function parseJsonBody(req: Request): Json | null {
  const raw = getRawBody(req);
  if (raw === null || raw.length === 0) return null;
  const parsed = parseStrictJson(raw.toString("utf8"));
  if (!parsed.ok) return null;
  return parsed.value;
}

// ---- Async route wrapper ----

type Handler = (req: Request, res: Response) => Promise<void>;

function route(handler: Handler): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// ---- Status probes ----

async function probeAll(): Promise<Record<string, string>> {
  const [storage, search, queue, cache, billingUp, webhooks] = await Promise.all([
    probeStorage(),
    probeSearch(),
    probeBroker(),
    probeCache(),
    billing.probeBilling(),
    probeWebhooks(),
  ]);
  return {
    storage: storage ? "up" : "down",
    search: search ? "up" : "down",
    queue: queue ? "up" : "down",
    cache: cache ? "up" : "down",
    billing: billingUp ? "up" : "down",
    webhooks: webhooks ? "up" : "down",
  };
}

// ---- Health and status ----

app.get("/api/health", (req, res) => {
  sendJson(res, 200, { status: "ok" });
});

app.get("/api/status", route(async (req, res) => {
  sendJson(res, 200, await probeAll());
}));

// ---- Plan ----

interface PlanStateRow {
  plan: PlanId;
}

async function storedPlan(): Promise<PlanId> {
  const result = await query<{ plan: string }>("SELECT plan FROM plan_state WHERE id = 1");
  if (result.rows.length === 0) return "archive-free";
  return result.rows[0].plan as PlanId;
}

async function ensurePlanState(): Promise<void> {
  const result = await query<{ plan: string }>("SELECT plan FROM plan_state WHERE id = 1");
  if (result.rows.length === 0) {
    await query(
      "INSERT INTO plan_state (id, plan, updated_at) VALUES (1, 'archive-free', $1) ON CONFLICT DO NOTHING",
      [epochMsToIso(Date.now())],
    );
  }
}

async function planBody(planId: PlanId): Promise<Record<string, unknown>> {
  const def = planDefinition(planId);
  let quota = def.quota_bytes;
  let nextBillingDate: string | null = null;
  let balanceCents: number | null = null;
  let usedBytes = 0;
  const usedResult = await query<{ n: string }>(
    "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM passes WHERE deleted = FALSE",
  );
  usedBytes = Number(usedResult.rows[0].n);
  let billingUp = true;
  try {
    await billing.ensureAccount();
    const accountId = await billing.ensureAccount();
    const state = await billing.readBillingState(accountId);
    if (state.subscription) {
      nextBillingDate = state.subscription.chargedThroughDate;
      if (planDefinition(planId).plan !== state.subscription.planName) {
        // Bring the stored plan in line with billing.
        const synced = PLAN_CATALOGUE.find((p) => p.plan === state.subscription?.planName);
        if (synced) {
          await query("UPDATE plan_state SET plan = $1, updated_at = $2 WHERE id = 1", [
            synced.plan,
            epochMsToIso(Date.now()),
          ]);
          planId = synced.plan;
        }
      }
    }
    balanceCents = state.balanceCents;
  } catch (err) {
    if (err instanceof errors.ApiError || (err as { dependency?: string }).dependency === "billing") {
      billingUp = false;
    } else {
      throw err;
    }
  }
  const def2 = planDefinition(planId);
  quota = def2.quota_bytes;
  void quota;
  return {
    plan: planId,
    label: def2.label,
    price_cents: def2.price_cents,
    period: def2.period,
    quota_bytes: def2.quota_bytes,
    used_bytes: usedBytes,
    next_billing_date: nextBillingDate,
    balance_cents: billingUp ? balanceCents : null,
    billing: billingUp ? "up" : "down",
  };
}

app.get("/api/plan", route(async (req, res) => {
  await ensurePlanState();
  const plan = await storedPlan();
  sendJson(res, 200, await planBody(plan));
}));

app.put("/api/plan", route(async (req, res) => {
  await ensurePlanState();
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ plan: "Choose archive-free, archive-1 or archive-10-annual." });
  }
  const plan = (body as Record<string, Json>).plan;
  if (plan !== "archive-free" && plan !== "archive-1" && plan !== "archive-10-annual") {
    throw validation({ plan: "Choose archive-free, archive-1 or archive-10-annual." });
  }
  const planId = plan as PlanId;
  const current = await storedPlan();
  const usedResult = await query<{ n: string }>(
    "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM passes WHERE deleted = FALSE",
  );
  const usedBytes = Number(usedResult.rows[0].n);
  if (planId === current) {
    sendJson(res, 200, await planBody(planId));
    return;
  }
  if (planDefinition(planId).quota_bytes < usedBytes) {
    throw new ApiError(409, "plan_too_small", {
      extra: { quota_bytes: planDefinition(planId).quota_bytes, used_bytes: usedBytes },
    });
  }
  try {
    await billing.ensureCatalogue();
    const accountId = await billing.ensureAccount();
    const subs = await billing.listSubscriptions(accountId);
    const active = subs.length > 0 ? subs[0] : null;
    if (!active) {
      await billing.createSubscription(accountId, planId);
    } else if (active.planName !== planId) {
      await billing.changeSubscriptionPlan(active.subscriptionId, planId);
    }
    // Confirm within 10 seconds.
    const deadline = Date.now() + 10000;
    let confirmed = false;
    while (Date.now() < deadline) {
      const subsNow = await billing.listSubscriptions(accountId);
      const sub = subsNow.find((s) => s.planName === planId && s.chargedThroughDate);
      if (sub) {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!confirmed) throw new Error("plan change not confirmed within 10 seconds");
    await query("UPDATE plan_state SET plan = $1, updated_at = $2 WHERE id = 1", [
      planId,
      epochMsToIso(Date.now()),
    ]);
    sendJson(res, 200, await planBody(planId));
  } catch (err) {
    console.error("plan change failed", err instanceof Error ? err.message : err, err instanceof Error ? err.stack : "");
    throw outage("billing");
  }
}));

// ---- Missions ----

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

app.get("/api/missions", route(async (req, res) => {
  const result = await query<{ id: string }>("SELECT id FROM missions ORDER BY created_at, id");
  const missions = [];
  for (const row of result.rows) {
    const client = await db().connect();
    try {
      const mission = await store.loadMission(client, row.id);
      if (!mission) continue;
      missions.push(await store.missionApiShape(client, mission, Date.now()));
    } finally {
      client.release();
    }
  }
  sendJson(res, 200, { missions });
}));

const MISSION_NAME_ERROR = "Enter a mission name of 1 to 80 characters.";
const EPOCH_ERROR = "Enter the epoch as YYYY-MM-DDTHH:MM:SSZ.";

app.post("/api/missions", route(async (req, res) => {
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body) || body === null) {
    throw validation({ name: MISSION_NAME_ERROR, epoch_utc: EPOCH_ERROR });
  }
  const record = body as Record<string, Json>;
  const fields: Record<string, string> = {};
  const name = record.name;
  if (typeof name !== "string" || hasForbiddenControl(name)) {
    fields.name = CONTROL_CHARACTERS_MESSAGE;
  } else {
    const normalised = normaliseText(name);
    const len = codePointLength(normalised);
    if (len < 1 || len > 80) fields.name = MISSION_NAME_ERROR;
  }
  const epoch = record.epoch_utc;
  if (!isIsoInstant(epoch)) fields.epoch_utc = EPOCH_ERROR;
  if (Object.keys(fields).length > 0) throw validation(fields);

  const normalisedName = normaliseText(name as string);
  const epochMs = isoToEpochMs(epoch as string) as number;
  const missionId = randomUUID();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO missions (id, name, epoch_utc, epoch_ms, distance_unit, speed_unit, created_at)
       VALUES ($1, $2, $3, $4, 'km', 'm_s', $5)`,
      [missionId, normalisedName, epoch, epochMs, epochMsToIso(Date.now())],
    );
    await recordChange(
      client,
      missionId,
      { kind: "mission.created", data: { name: normalisedName, epoch_utc: epoch as string } },
      { bumpVersion: false },
    );
  });
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, missionId);
    if (!mission) throw notFound();
    sendJson(res, 201, await store.missionApiShape(client, mission, Date.now()));
  } finally {
    client.release();
  }
}));

app.get("/api/missions/:id", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    sendJson(res, 200, await store.missionApiShape(client, mission, Date.now()));
  } finally {
    client.release();
  }
}));

app.patch("/api/missions/:id", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/merge-patch+json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ body: "Send a JSON object." });
  }
  const patch = body as Record<string, Json>;
  const fields: Record<string, string> = {};
  const updates: { name?: string; distance_unit?: DistanceUnit; speed_unit?: SpeedUnit; clearReference?: boolean } = {};

  if ("name" in patch) {
    const name = patch.name;
    if (typeof name !== "string" || hasForbiddenControl(name)) {
      fields.name = name === null ? MISSION_NAME_ERROR : CONTROL_CHARACTERS_MESSAGE;
    } else {
      const normalised = normaliseText(name);
      const len = codePointLength(normalised);
      if (len < 1 || len > 80) {
        fields.name = MISSION_NAME_ERROR;
      } else {
        updates.name = normalised;
      }
    }
  }
  if ("distance_unit" in patch) {
    const value = patch.distance_unit;
    if (value === "km" || value === "nmi") {
      updates.distance_unit = value;
    } else {
      fields.distance_unit = "Choose km or nmi.";
    }
  }
  if ("speed_unit" in patch) {
    const value = patch.speed_unit;
    if (value === "m_s" || value === "ft_s") {
      updates.speed_unit = value;
    } else {
      fields.speed_unit = "Choose m_s or ft_s.";
    }
  }
  if ("reference_target" in patch) {
    const value = patch.reference_target;
    if (value === null) {
      updates.clearReference = true;
    } else {
      fields.reference_target = "Only null clears the reference target here.";
    }
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const missionId = req.params.id;
  const result = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return null;
    const changed: Record<string, Json> = {};
    if (updates.name !== undefined && updates.name !== mission.name) changed.name = updates.name;
    if (updates.distance_unit !== undefined && updates.distance_unit !== mission.distance_unit) {
      changed.distance_unit = updates.distance_unit;
    }
    if (updates.speed_unit !== undefined && updates.speed_unit !== mission.speed_unit) {
      changed.speed_unit = updates.speed_unit;
    }
    const clearExisting = updates.clearReference === true && mission.reference_target !== null;
    if (clearExisting) changed.reference_target = null;
    const hasChange = Object.keys(changed).length > 0;
    if (hasChange) {
      if (updates.name !== undefined && updates.name !== mission.name) {
        await client.query("UPDATE missions SET name = $2 WHERE id = $1", [missionId, updates.name]);
      }
      if (updates.distance_unit !== undefined && updates.distance_unit !== mission.distance_unit) {
        await client.query("UPDATE missions SET distance_unit = $2 WHERE id = $1", [
          missionId,
          updates.distance_unit,
        ]);
      }
      if (updates.speed_unit !== undefined && updates.speed_unit !== mission.speed_unit) {
        await client.query("UPDATE missions SET speed_unit = $2 WHERE id = $1", [
          missionId,
          updates.speed_unit,
        ]);
      }
      if (clearExisting) {
        await client.query(
          `UPDATE missions SET reference_target = NULL, reference_state = NULL, reference_etag = NULL,
                                  reference_fetched_at = NULL, reference_vector_count = NULL
           WHERE id = $1`,
          [missionId],
        );
        await client.query("DELETE FROM reference_vectors WHERE mission_id = $1", [missionId]);
        await client.query("UPDATE samples SET residual_m = NULL WHERE mission_id = $1", [missionId]);
      }
      const bump = (updates.name !== undefined && updates.name !== mission.name) || clearExisting;
      await recordChange(client, missionId, { kind: "mission.updated", data: changed }, { bumpVersion: bump });
    }
    const updated = await store.loadMission(client, missionId);
    return updated ? { mission: updated } : null;
  });
  if (!result) throw notFound();
  const client = await db().connect();
  try {
    sendJson(res, 200, await store.missionApiShape(client, result.mission, Date.now()));
  } finally {
    client.release();
  }
}));

// ---- Track and frames ----

app.get("/api/missions/:id/track", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const track = await store.loadTrack(client, mission.id);
    sendJson(res, 200, { samples: track.map((s, i) => store.sampleApiShape(s, i)) });
  } finally {
    client.release();
  }
}));

const FPS_ERROR = "Choose fps 1, 5, 10 or 25.";
const FROM_ERROR = "Give from as whole MET seconds within the track.";
const TO_ERROR = "Give to as whole MET seconds from from to the end of the track.";

app.get("/api/missions/:id/frames", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const track = await store.loadTrack(client, mission.id);
    if (track.length === 0) throw conflict("mission_has_no_samples");
    const firstMet = track[0].met;
    const lastMet = track[track.length - 1].met;
    const fields: Record<string, string> = {};
    const fpsRaw = req.query.fps;
    const fps = Number(fpsRaw);
    if (fpsRaw === undefined || !["1", "5", "10", "25"].includes(String(fpsRaw))) {
      fields.fps = FPS_ERROR;
    }
    const fromRaw = req.query.from;
    const from = Number(fromRaw);
    if (
      fromRaw === undefined ||
      !/^-?\d+$/.test(String(fromRaw)) ||
      !Number.isInteger(from) ||
      from < firstMet ||
      from > lastMet
    ) {
      fields.from = FROM_ERROR;
    }
    const toRaw = req.query.to;
    const to = Number(toRaw);
    const toRangeOk =
      toRaw !== undefined &&
      /^-?\d+$/.test(String(toRaw)) &&
      Number.isInteger(to) &&
      to <= lastMet &&
      (fields.from !== undefined || (to >= from && to <= lastMet));
    if (!toRangeOk || to > lastMet || (fields.from === undefined && to < from)) {
      fields.to = TO_ERROR;
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    const fpsValue = fps as 1 | 5 | 10 | 25;
    const maxK = Math.floor(((to * 1000 - from * 1000) * fpsValue) / 1000);
    if (maxK + 1 > 3000) throw validation({ to: "Ask for at most 3000 frames." });
    const hermite: HermiteSample[] = track.map((s) => ({
      met: s.met,
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
    }));
    const frames = [];
    for (let k = 0; ; k++) {
      const metMs = frameGridMetMs(from, fpsValue, k);
      if (metMs > to * 1000) break;
      const frame = computeFrame(hermite, metMs);
      frames.push({ k, met_ms: metMs, altitude_m: frame.altitude_m, lat_deg: frame.lat_deg, lon_deg: frame.lon_deg, speed_m_s: frame.speed_m_s });
    }
    sendJson(res, 200, { fps: fpsValue, frames });
  } finally {
    client.release();
  }
}));

app.get("/api/missions/:id/transcript", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const lines = await store.loadLines(client, mission.id);
    sendJson(res, 200, {
      lines: lines.map((l) => ({
        id: l.id,
        pass_id: l.pass_id,
        met: l.met,
        met_label: l.met_label,
        speaker: l.speaker,
        text: l.text,
      })),
    });
  } finally {
    client.release();
  }
}));

app.get("/api/missions/:id/speakers", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const lines = await store.loadLines(client, mission.id);
    sendJson(res, 200, { speakers: speakerSummaries(lines) });
  } finally {
    client.release();
  }
}));

app.get("/api/missions/:id/events", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const events = await attachEventSamples(client, await store.loadEvents(client, mission.id));
    sendJson(res, 200, { events: events.map((e) => eventApiShape(e, true)) });
  } finally {
    client.release();
  }
}));

interface SampleShape {
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
}

function eventApiShape(
  event: store.EventRow & { sample?: SampleShape | null },
  includeNote: boolean,
): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    id: event.id,
    pass_id: event.pass_id,
    met: event.met,
    met_label: event.met_label,
    title: event.title,
    sample: event.sample ?? null,
  };
  if (includeNote) shape.note = event.note;
  return shape;
}

function sampleShapeFromRow(row: Record<string, unknown> | undefined): SampleShape | null {
  if (!row) return null;
  return {
    lat_deg: row.lat_deg as number,
    lon_deg: row.lon_deg as number,
    altitude_m: row.altitude_m as number,
    speed_m_s: row.speed_m_s as number,
    residual_m: (row.residual_m as number | null) ?? null,
  };
}

async function attachEventSamples(
  client: Parameters<typeof store.loadEvents>[0],
  events: Array<store.EventRow>,
): Promise<Array<store.EventRow & { sample: SampleShape | null }>> {
  const out = [];
  for (const event of events) {
    const result = await client.query(
      "SELECT lat_deg, lon_deg, altitude_m, speed_m_s, residual_m FROM samples WHERE pass_id = $1 AND met = $2 LIMIT 1",
      [event.pass_id, event.sample_met],
    );
    out.push({ ...event, sample: sampleShapeFromRow(result.rows[0]) });
  }
  return out;
}

const MET_ERROR = "Give MET as a whole number of seconds.";
const NO_SAMPLE_ERROR = "No sample at or before this time.";
const TITLE_ERROR = "Enter a title of 1 to 120 characters.";
const NOTE_ERROR = "Keep the private note to 2,000 characters or fewer.";

app.post("/api/missions/:id/events", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const key = checkIdempotencyKey(req.headers["idempotency-key"] as string | undefined);
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ met: MET_ERROR, title: TITLE_ERROR });
  }
  const record = body as Record<string, Json>;
  const fields: Record<string, string> = {};
  const metValue = record.met;
  let met: number | null = null;
  if (typeof metValue !== "number" || !Number.isInteger(metValue)) {
    fields.met = MET_ERROR;
  } else {
    met = metValue;
  }
  const title = record.title;
  let titleText: string | null = null;
  if (typeof title !== "string" || hasForbiddenControl(title)) {
    fields.title = CONTROL_CHARACTERS_MESSAGE;
  } else {
    const normalised = normaliseText(title);
    const len = codePointLength(normalised);
    if (len < 1 || len > 120) {
      fields.title = TITLE_ERROR;
    } else {
      titleText = normalised;
    }
  }
  let noteText = "";
  if ("note" in record && record.note !== undefined && record.note !== null) {
    const note = record.note;
    if (typeof note !== "string" || hasForbiddenControl(note)) {
      fields.note = CONTROL_CHARACTERS_MESSAGE;
    } else {
      const normalised = normaliseText(note);
      if (codePointLength(normalised) > 2000) {
        fields.note = NOTE_ERROR;
      } else {
        noteText = normalised;
      }
    }
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const missionId = req.params.id;
  const fingerprint = `${met}|${titleText}|${noteText}`;
  const result = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return { kind: "not_found" as const };
    const keyAnswer = await beginRequest(client, key, missionId, "event.pin", fingerprint);
    if (keyAnswer.kind === "in_progress") return { kind: "in_progress" as const };
    if (keyAnswer.kind === "reused") return { kind: "reused" as const };
    if (keyAnswer.kind === "replay" || keyAnswer.kind === "replay_deleted") {
      if (keyAnswer.kind === "replay_deleted") return { kind: "replay_deleted" as const };
      return { kind: "replay" as const, eventId: keyAnswer.eventId };
    }
    // Snap the event.
    const snap = await client.query<{ id: string; met: number }>(
      `SELECT s.pass_id AS id, s.met FROM samples s JOIN passes p ON p.id = s.pass_id
       WHERE s.mission_id = $1 AND p.deleted = FALSE AND s.met <= $2
       ORDER BY s.met DESC, p.upload_order DESC, s.seq DESC LIMIT 1`,
      [missionId, met as number],
    );
    if (snap.rows.length === 0) return { kind: "no_sample" as const };
    const sampleMet = Number(snap.rows[0].met);
    const passId = snap.rows[0].id;
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO events (id, mission_id, pass_id, met, title, note, sample_met, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, missionId, passId, sampleMet, titleText, noteText, sampleMet, epochMsToIso(Date.now())],
    );
    await recordChange(
      client,
      missionId,
      {
        kind: "event.pinned",
        data: { event_id: eventId, pass_id: passId, met: sampleMet, title: titleText as string },
        webhook: {
          event: "event.pinned",
          payloadData: {
            event: { id: eventId, pass_id: passId, met: sampleMet, met_label: formatMetLabel(sampleMet), title: titleText },
          },
        },
      },
      { bumpVersion: true },
    );
    // The search write: confirmed or pending.
    let searchConfirmed = false;
    try {
      const outcome = await writeSearchDocuments(
        client,
        [
          {
            id: `event-${eventId}`,
            mission_id: missionId,
            pass_id: passId,
            kind: "event" as const,
            met: sampleMet,
            speaker: null,
            text: titleText as string,
          },
        ],
        [],
      );
      searchConfirmed = outcome.confirmed;
    } catch {
      searchConfirmed = false;
    }
    if (!searchConfirmed) {
      await recordPendingWrite(client, missionId, "event", eventId, {
        pass_id: passId,
        met: sampleMet,
        text: titleText,
      });
    }
    await keepRequestKey(client, key, missionId, "event.pin", fingerprint, 201, null, eventId);
    return { kind: "created" as const, eventId, passId, sampleMet, version: 0 };
  });
  if (result.kind === "not_found") throw notFound();
  if (result.kind === "in_progress") throw conflict("idempotency_request_in_progress");
  if (result.kind === "reused") throw new ApiError(422, "idempotency_key_reused");
  if (result.kind === "replay_deleted") throw gone("pass_deleted");
  if (result.kind === "replay") {
    const client = await db().connect();
    try {
      const event = await loadEventById(client, result.eventId as string);
      res.setHeader("Idempotency-Replayed", "true");
      sendJson(res, 201, eventApiShape(event, true));
      return;
    } finally {
      client.release();
    }
  }
  if (result.kind === "no_sample") {
    await withTransaction(async (client) => releaseRequestKey(client, key, missionId, "event.pin"));
    throw validation({ met: NO_SAMPLE_ERROR });
  }
  const client = await db().connect();
  try {
    const event = await loadEventById(client, result.eventId);
    signalRelay();
    sendJson(res, 201, eventApiShape(event, true));
  } finally {
    client.release();
  }
}));

async function loadEventById(client: Parameters<typeof store.loadEvents>[0], eventId: string): Promise<store.EventRow & { sample: SampleShape | null }> {
  const result = await client.query(
    `SELECT e.id, e.pass_id, e.met, e.title, e.note, e.sample_met FROM events e WHERE e.id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  const sample = await client.query(
    `SELECT lat_deg, lon_deg, altitude_m, speed_m_s, residual_m FROM samples WHERE pass_id = $1 AND met = $2 LIMIT 1`,
    [row.pass_id, row.sample_met],
  );
  return {
    id: row.id,
    pass_id: row.pass_id,
    met: Number(row.met),
    met_label: formatMetLabel(Number(row.met)),
    title: row.title,
    note: row.note,
    sample_met: Number(row.sample_met),
    sample: sampleShapeFromRow(sample.rows[0]),
  };
}

// ---- Search ----

const SEARCH_ERROR = "Enter 1 to 200 characters to search for.";

app.get("/api/missions/:id/search", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, missionId);
    if (!mission) throw notFound();
  } finally {
    client.release();
  }
  const q = req.query.q;
  const queryText = typeof q === "string" ? q : "";
  const trimmed = queryText.trim();
  const len = codePointLength(trimmed);
  if (len < 1 || len > 200) throw validation({ q: SEARCH_ERROR });
  {
    const catchUpClient = await db().connect();
    try {
      await catchUpPendingWrites(catchUpClient);
    } catch {
      // The catch-up itself may fail while search is down.
    } finally {
      catchUpClient.release();
    }
  }
  let hits: Array<{ kind: "line" | "event"; met: number; met_label: string; speaker: string | null; text: string }> = [];
  try {
    const found = await searchDocuments({ missionId, query: trimmed, limit: 50 });
    hits = found.map((h) => {
      const kind = h.id.startsWith("event-") ? "event" : "line";
      return {
        kind: kind as "line" | "event",
        met: h.met,
        met_label: formatMetLabel(h.met),
        speaker: kind === "event" ? null : h.speaker,
        text: h.text,
      };
    });
  } catch {
    throw outage("search");
  }
  hits.sort((a, b) => {
    if (a.met !== b.met) return a.met - b.met;
    if (a.kind === "line" && b.kind === "event") return -1;
    if (a.kind === "event" && b.kind === "line") return 1;
    return 0;
  });
  sendJson(res, 200, { query: trimmed, count: hits.length, hits });
}));

// ---- Audit ----

app.get("/api/missions/:id/audit", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const result = await client.query(
      "SELECT seq, at, kind, data, prev, hash FROM audit_entries WHERE mission_id = $1 ORDER BY seq",
      [mission.id],
    );
    const entries = result.rows.map((row) => ({
      seq: Number(row.seq),
      at: row.at,
      kind: row.kind,
      data: row.data,
      prev: row.prev,
      hash: row.hash,
    }));
    sendJson(res, 200, { entries });
  } finally {
    client.release();
  }
}));

app.get("/api/missions/:id/audit/verify", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const result = await client.query(
      "SELECT seq, at, kind, data, prev, hash FROM audit_entries WHERE mission_id = $1 ORDER BY seq",
      [mission.id],
    );
    let prev = "0".repeat(64);
    let ok = true;
    let firstBad = 0;
    for (const row of result.rows) {
      const entry: AuditEntry = {
        seq: Number(row.seq),
        at: row.at,
        kind: row.kind,
        data: row.data,
        prev: row.prev,
        hash: row.hash,
      };
      if (entry.prev !== prev || entryHash(entry) !== entry.hash) {
        ok = false;
        firstBad = entry.seq;
        break;
      }
      prev = entry.hash;
    }
    if (ok) sendJson(res, 200, { ok: true, length: result.rows.length });
    else sendJson(res, 200, { ok: false, first_bad_seq: firstBad });
  } finally {
    client.release();
  }
}));

// ---- Author stream ----

app.get("/api/missions/:id/stream", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  let mission: store.MissionRow | null = null;
  try {
    mission = await store.loadMission(client, req.params.id);
  } finally {
    client.release();
  }
  if (!mission) throw notFound();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  let closed = false;
  let lastReaders: number | null | "unknown" = "unknown";
  let lastSent = 0;
  const tick = async () => {
    if (closed) return;
    try {
      const count = await readerCount(mission.id);
      const next = count === null ? null : count;
      if (next !== lastReaders) {
        lastReaders = next;
        res.write(`event: readers\ndata: ${JSON.stringify({ readers: next })}\n\n`);
        lastSent = Date.now();
      }
    } catch {
      if (lastReaders !== null) {
        lastReaders = null;
        res.write(`event: readers\ndata: ${JSON.stringify({ readers: null })}\n\n`);
        lastSent = Date.now();
      }
    }
    if (Date.now() - lastSent > 15000) {
      res.write(": keep-alive\n\n");
      lastSent = Date.now();
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  void tick();
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    res.end();
  });
}));

// ---- Subscribers ----

const SUBSCRIBER_URL_ERROR = "Enter an http or https URL of up to 2048 characters.";

function checkSubscriberUrl(value: Json): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    if (url.hash) return null;
  } catch {
    return null;
  }
  return trimmed;
}

app.get("/api/missions/:id/subscribers", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const subscribers = await store.loadSubscribers(client, mission.id);
    sendJson(res, 200, {
      subscribers: subscribers.map((s) => ({ id: s.id, url: s.url, created_at: s.created_at })),
    });
  } finally {
    client.release();
  }
}));

app.post("/api/missions/:id/subscribers", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ url: SUBSCRIBER_URL_ERROR });
  }
  const url = checkSubscriberUrl((body as Record<string, Json>).url);
  if (url === null) throw validation({ url: SUBSCRIBER_URL_ERROR });
  const missionId = req.params.id;
  let missionName = "";
  {
    const client = await db().connect();
    try {
      const mission = await store.loadMission(client, missionId);
      if (!mission) throw notFound();
      missionName = mission.name;
    } finally {
      client.release();
    }
  }
  const result = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return { kind: "not_found" as const };
    await client.query("SELECT id FROM missions WHERE id = $1 FOR UPDATE", [missionId]);
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM subscribers WHERE mission_id = $1",
      [missionId],
    );
    if (existing.rows.length >= 3) return { kind: "limit" as const };
    for (const row of existing.rows) {
      const stored = await client.query<{ url: string }>("SELECT url FROM subscribers WHERE id = $1", [
        row.id,
      ]);
      if (stored.rows[0].url === url) return { kind: "exists" as const };
    }
    // The endpoint must be confirmed by the webhook service.
    try {
      await ensureApplication(missionId, mission.name);
      const endpoint = await createEndpoint(missionId, url);
      const order = await store.nextOrder(client, "subscribers", missionId);
      await client.query(
        "INSERT INTO subscribers (id, mission_id, url, created_at, order_n) VALUES ($1, $2, $3, $4, $5)",
        [endpoint.id, missionId, url, epochMsToIso(Date.now()), order],
      );
      await recordChange(
        client,
        missionId,
        { kind: "subscriber.added", data: { subscriber_id: endpoint.id, url } },
        { bumpVersion: false },
      );
      return { kind: "created" as const, id: endpoint.id };
    } catch (err) {
      if ((err as { dependency?: string }).dependency === "webhooks") {
        return { kind: "webhooks_down" as const };
      }
      throw err;
    }
  });
  if (result.kind === "not_found") throw notFound();
  if (result.kind === "limit") throw conflict("subscriber_limit", { message: "A mission has at most 3 subscribers." });
  if (result.kind === "exists") throw conflict("subscriber_exists", { message: "This URL is already subscribed." });
  if (result.kind === "webhooks_down") throw outage("webhooks");
  const client = await db().connect();
  try {
    const subscribers = await store.loadSubscribers(client, missionId);
    const created = subscribers.find((s) => s.id === result.id);
    if (!created) throw notFound();
    sendJson(res, 201, { id: created.id, url: created.url, created_at: created.created_at });
  } finally {
    client.release();
  }
}));

app.delete("/api/missions/:id/subscribers/:subscriberId", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const subscriberId = req.params.subscriberId;
  const subscriber = await query<{ mission_id: string; url: string }>(
    "SELECT mission_id, url FROM subscribers WHERE id = $1",
    [subscriberId],
  );
  if (subscriber.rows.length === 0 || subscriber.rows[0].mission_id !== missionId) {
    throw notFound("subscriber_not_found");
  }
  try {
    const missionForName = await query<{ name: string }>("SELECT name FROM missions WHERE id = $1", [missionId]);
    await ensureApplication(missionId, missionForName.rows[0]?.name ?? missionId);
    await deleteEndpoint(missionId, subscriberId);
  } catch (err) {
    if ((err as { dependency?: string }).dependency === "webhooks") {
      throw outage("webhooks");
    }
    throw err;
  }
  await withTransaction(async (client) => {
    await client.query("DELETE FROM subscribers WHERE id = $1", [subscriberId]);
    await recordChange(
      client,
      missionId,
      { kind: "subscriber.removed", data: { subscriber_id: subscriberId } },
      { bumpVersion: false },
    );
  });
  res.status(204).end();
}));

// ---- Reference ----

const TARGET_ERROR = "Enter a target of 1 to 32 capital letters, digits or dashes.";
const UNKNOWN_TARGET_ERROR = "The ephemeris service does not know this target.";
const TARGET_RE = /^[A-Z0-9-]{1,32}$/;

app.put("/api/missions/:id/reference", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ target: TARGET_ERROR });
  }
  const target = (body as Record<string, Json>).target;
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw validation({ target: TARGET_ERROR });
  }
  const missionId = req.params.id;
  const client = await db().connect();
  let mission: store.MissionRow | null = null;
  try {
    mission = await store.loadMission(client, missionId);
  } finally {
    client.release();
  }
  if (!mission) throw notFound();
  const track = await withTransaction(async (txClient) => store.loadTrack(txClient, missionId));
  if (track.length === 0) throw conflict("mission_has_no_samples");

  const firstUnixS = Math.floor(track[0].utc_ms / 1000);
  const lastUnixS = Math.floor(track[track.length - 1].utc_ms / 1000);
  let outcome: "updated" | "unavailable";
  let vectors: Array<{ unix_ms: number; x_m: number; y_m: number; z_m: number; vx_m_s: number; vy_m_s: number; vz_m_s: number }> = [];
  try {
    const fetched = await fetchVectors(target, firstUnixS, lastUnixS, null, null);
    if (fetched.outcome === "fetched") {
      vectors = fetched.vectors;
      outcome = "updated";
    } else {
      outcome = "unavailable";
    }
  } catch (err) {
    if (err instanceof UnknownTargetError) {
      // An unknown target changes nothing.
      throw validation({ target: UNKNOWN_TARGET_ERROR });
    }
    outcome = "unavailable";
  }
  // The mission's reference is only written once the outcome is known, so a
  // refused target leaves the previous reference unchanged.
  await withTransaction(async (txClient) => {
    await txClient.query(
      `UPDATE missions SET reference_target = $2, reference_state = $3,
                           reference_fetched_at = NULL, reference_vector_count = NULL
       WHERE id = $1`,
      [missionId, target, outcome === "updated" ? "ready" : "unavailable"],
    );
  });
  if (outcome === "updated") {
    await withTransaction(async (txClient) => {
      await txClient.query("DELETE FROM reference_vectors WHERE mission_id = $1", [missionId]);
      for (const v of vectors) {
        await txClient.query(
          `INSERT INTO reference_vectors (mission_id, unix_ms, x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [missionId, v.unix_ms, v.x_m, v.y_m, v.z_m, v.vx_m_s, v.vy_m_s, v.vz_m_s],
        );
      }
      await txClient.query(
        `UPDATE missions SET reference_state = 'ready', reference_etag = $2,
                             reference_fetched_at = $3, reference_vector_count = $4
         WHERE id = $1`,
        [missionId, null, epochMsToIso(Date.now()), vectors.length],
      );
      await recomputeResiduals(txClient, missionId);
      await recordChange(
        txClient,
        missionId,
        {
          kind: "reference.set",
          data: { target, state: "ready", vector_count: vectors.length },
        },
        { bumpVersion: true },
      );
    });
  } else {
    await withTransaction(async (txClient) => {
      await txClient.query("DELETE FROM reference_vectors WHERE mission_id = $1", [missionId]);
      await txClient.query(
        `UPDATE missions SET reference_state = 'unavailable', reference_vector_count = NULL WHERE id = $1`,
        [missionId],
      );
      await recordChange(
        txClient,
        missionId,
        { kind: "reference.set", data: { target, state: "unavailable", vector_count: 0 } },
        { bumpVersion: true },
      );
    });
  }
  const after = await db().connect();
  try {
    const missionNow = await store.loadMission(after, missionId);
    if (!missionNow) throw notFound();
    sendJson(res, 200, { mission: await store.missionApiShape(after, missionNow, Date.now()), outcome });
  } finally {
    after.release();
  }
}));

app.post("/api/missions/:id/reference/refresh", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const client = await db().connect();
  let mission: store.MissionRow | null = null;
  try {
    mission = await store.loadMission(client, missionId);
  } finally {
    client.release();
  }
  if (!mission) throw notFound();
  if (!mission.reference_target) throw conflict("no_reference_target");
  const track = await withTransaction(async (txClient) => store.loadTrack(txClient, missionId));
  if (track.length === 0) throw conflict("mission_has_no_samples");
  const target = mission.reference_target;
  const firstUnixS = Math.floor(track[0].utc_ms / 1000);
  const lastUnixS = Math.floor(track[track.length - 1].utc_ms / 1000);
  let outcome: "updated" | "unchanged" | "unavailable";
  let vectors: Array<{ unix_ms: number; x_m: number; y_m: number; z_m: number; vx_m_s: number; vy_m_s: number; vz_m_s: number }> = [];
  try {
    const fetched = await fetchVectors(target, firstUnixS, lastUnixS, mission.reference_etag, null);
    if (fetched.outcome === "unchanged") {
      outcome = "unchanged";
    } else {
      vectors = fetched.vectors;
      outcome = "updated";
    }
  } catch {
    outcome = "unavailable";
  }
  const nextState = outcome === "unavailable" ? "unavailable" : "ready";
  const bump = outcome === "updated" || mission.reference_state !== nextState;
  if (outcome === "updated") {
    await withTransaction(async (txClient) => {
      await txClient.query("DELETE FROM reference_vectors WHERE mission_id = $1", [missionId]);
      for (const v of vectors) {
        await txClient.query(
          `INSERT INTO reference_vectors (mission_id, unix_ms, x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [missionId, v.unix_ms, v.x_m, v.y_m, v.z_m, v.vx_m_s, v.vy_m_s, v.vz_m_s],
        );
      }
      await txClient.query(
        `UPDATE missions SET reference_state = 'ready', reference_fetched_at = $2, reference_vector_count = $3 WHERE id = $1`,
        [missionId, epochMsToIso(Date.now()), vectors.length],
      );
      await recomputeResiduals(txClient, missionId);
      await recordChange(
        txClient,
        missionId,
        { kind: "reference.refreshed", data: { target, state: "ready", vector_count: vectors.length } },
        { bumpVersion: bump },
      );
    });
  } else if (outcome === "unchanged") {
    await withTransaction(async (txClient) => {
      await txClient.query(
        `UPDATE missions SET reference_state = 'ready', reference_fetched_at = $2 WHERE id = $1`,
        [missionId, epochMsToIso(Date.now())],
      );
      if (bump) {
        await recordChange(
          txClient,
          missionId,
          { kind: "reference.refreshed", data: { target, state: "ready", vector_count: mission.reference_vector_count ?? 0 } },
          { bumpVersion: false },
        );
      }
    });
  } else {
    await withTransaction(async (txClient) => {
      await txClient.query("DELETE FROM reference_vectors WHERE mission_id = $1", [missionId]);
      await txClient.query(
        `UPDATE missions SET reference_state = 'unavailable', reference_vector_count = NULL WHERE id = $1`,
        [missionId],
      );
      if (bump) {
        await recordChange(
          txClient,
          missionId,
          { kind: "reference.refreshed", data: { target, state: "unavailable", vector_count: 0 } },
          { bumpVersion: true },
        );
      }
    });
  }
  const after = await db().connect();
  try {
    const missionNow = await store.loadMission(after, missionId);
    if (!missionNow) throw notFound();
    sendJson(res, 200, { mission: await store.missionApiShape(after, missionNow, Date.now()), outcome });
  } finally {
    after.release();
  }
}));

async function recomputeResiduals(txClient: Parameters<typeof store.loadTrack>[0], missionId: string): Promise<void> {
  const track = await store.loadTrack(txClient, missionId);
  const vectors = await txClient.query(
    "SELECT unix_ms, x_m, y_m, z_m FROM reference_vectors WHERE mission_id = $1 ORDER BY unix_ms",
    [missionId],
  );
  const vec = vectors.rows.map((v) => ({
    unix_ms: Number(v.unix_ms),
    x_m: v.x_m,
    y_m: v.y_m,
    z_m: v.z_m,
  }));
  for (const sample of track) {
    const residual =
      vec.length === 0 ? null : residualAt(vec, sample.utc_ms, sample.x, sample.y, sample.z);
    await txClient.query("UPDATE samples SET residual_m = $2 WHERE pass_id = $1 AND met = $3", [
      sample.pass_id,
      residual,
      sample.met,
    ]);
  }
}

// ---- Landmarks ----

const LANDMARK_NAME_ERROR = "Enter a landmark name of 1 to 40 characters.";
const LAT_DEG_ERROR = "Give latitude in degrees from -90 to 90, with at most 6 decimals.";
const LON_DEG_ERROR = "Give longitude in degrees above -180 and up to 180, with at most 6 decimals.";

function checkDegrees(value: Json, lat: boolean): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) && !isFinite(value)) return null;
  if (Math.abs(value) >= 1e15) return null;
  const rounded = Math.round(value * 1e6) / 1e6;
  if (rounded !== value) return null;
  if (lat) {
    if (value < -90 || value > 90) return null;
  } else {
    if (value <= -180 || value > 180) return null;
  }
  return value;
}

app.post("/api/missions/:id/landmarks", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  if (wasTooLarge(req)) throw bodyTooLarge(JSON_BODY_LIMIT);
  if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
  const body = parseJsonBody(req);
  if (body === null) throw invalidJson();
  if (typeof body !== "object" || Array.isArray(body)) {
    throw validation({ name: LANDMARK_NAME_ERROR });
  }
  const record = body as Record<string, Json>;
  const fields: Record<string, string> = {};
  const name = record.name;
  let nameText: string | null = null;
  if (typeof name !== "string" || hasForbiddenControl(name)) {
    fields.name = CONTROL_CHARACTERS_MESSAGE;
  } else {
    const normalised = normaliseText(name);
    if (codePointLength(normalised) < 1 || codePointLength(normalised) > 40) {
      fields.name = LANDMARK_NAME_ERROR;
    } else {
      nameText = normalised;
    }
  }
  const lat = checkDegrees(record.lat_deg, true);
  if (lat === null) fields.lat_deg = LAT_DEG_ERROR;
  const lon = checkDegrees(record.lon_deg, false);
  if (lon === null) fields.lon_deg = LON_DEG_ERROR;
  if (Object.keys(fields).length > 0) throw validation(fields);

  const missionId = req.params.id;
  const result = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return { kind: "not_found" as const };
    await client.query("SELECT id FROM missions WHERE id = $1 FOR UPDATE", [missionId]);
    const existing = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM landmarks WHERE mission_id = $1",
      [missionId],
    );
    if (Number(existing.rows[0].count) >= 5) return { kind: "limit" as const };
    const key = canonicalCaselessKey(nameText as string);
    const taken = await client.query<{ id: string }>(
      "SELECT id FROM landmarks WHERE mission_id = $1 AND caseless_key = $2",
      [missionId, key],
    );
    if (taken.rows.length > 0) return { kind: "taken" as const };
    const id = randomUUID();
    const order = await store.nextOrder(client, "landmarks", missionId);
    await client.query(
      `INSERT INTO landmarks (id, mission_id, name, caseless_key, lat_deg, lon_deg, created_at, order_n)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, missionId, nameText, key, lat, lon, epochMsToIso(Date.now()), order],
    );
    await recordChange(
      client,
      missionId,
      {
        kind: "landmark.added",
        data: { landmark_id: id, name: nameText as string, lat_deg: lat as number, lon_deg: lon as number },
      },
      { bumpVersion: true },
    );
    return { kind: "created" as const, id };
  });
  if (result.kind === "not_found") throw notFound();
  if (result.kind === "limit") throw conflict("landmark_limit", { message: "A mission holds at most 5 landmarks." });
  if (result.kind === "taken") throw conflict("landmark_name_taken", { message: "A landmark with this name already exists." });
  sendJson(res, 201, {
    id: result.id,
    name: nameText,
    lat_deg: lat,
    lon_deg: lon,
    created_at: epochMsToIso(Date.now()),
  });
}));

app.delete("/api/missions/:id/landmarks/:landmarkId", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const landmarkId = req.params.landmarkId;
  const result = await withTransaction(async (client) => {
    const found = await client.query<{ mission_id: string; name: string }>(
      "SELECT mission_id, name FROM landmarks WHERE id = $1",
      [landmarkId],
    );
    if (found.rows.length === 0 || found.rows[0].mission_id !== missionId) return null;
    await client.query("DELETE FROM landmarks WHERE id = $1", [landmarkId]);
    await recordChange(
      client,
      missionId,
      { kind: "landmark.removed", data: { landmark_id: landmarkId } },
      { bumpVersion: true },
    );
    return found.rows[0];
  });
  if (!result) throw notFound("landmark_not_found");
  res.status(204).end();
}));

// ---- Passes ----

const FILENAME_ERROR =
  "Send the capture name percent-encoded as UTF-8: 1 to 120 characters, no control characters, slashes or backslashes.";
const SHA_ERROR = "Send the capture's SHA-256 as 64 lowercase hex characters.";

const SHA_RE = /^[0-9a-f]{64}$/;

app.post("/api/missions/:id/passes", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const key = checkIdempotencyKey(req.headers["idempotency-key"] as string | undefined);

  // Body limit check comes before content type for captures.
  if (wasTooLarge(req)) throw bodyTooLarge(CAPTURE_LIMIT, true);
  const contentType = contentTypeOf(req);
  if (contentType !== "application/octet-stream") throw unsupportedMediaType();
  const rawFilename = req.headers["x-capture-filename"];
  if (typeof rawFilename !== "string") throw validation({ filename: FILENAME_ERROR });
  const decoded = percentDecodeFilename(rawFilename);
  let filename: string | null = null;
  if (decoded === null) {
    throw validation({ filename: FILENAME_ERROR });
  } else {
    if (hasForbiddenControl(decoded)) throw validation({ filename: FILENAME_ERROR });
    const normalised = normaliseText(decoded).normalize("NFC");
    const len = codePointLength(normalised);
    if (len < 1 || len > 120) throw validation({ filename: FILENAME_ERROR });
    if (normalised.includes("/") || normalised.includes("\\")) throw validation({ filename: FILENAME_ERROR });
    filename = normalised;
  }
  const shaHeader = req.headers["x-capture-sha256"];
  if (typeof shaHeader !== "string" || !SHA_RE.test(shaHeader)) {
    throw validation({ sha256: SHA_ERROR });
  }
  const declaredSha = shaHeader;
  const bytes = getRawBody(req);
  if (bytes === null || bytes.length === 0) {
    throw validation({ body: "The capture is empty." });
  }
  const actualSha = sha256Hex(bytes);
  if (actualSha !== declaredSha) {
    throw validation({ sha256: "The SHA-256 does not match the bytes received." });
  }

  const fingerprint = `${declaredSha}:${filename}`;

  // Rung 10: request key.
  const keyCheck = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return { kind: "not_found" as const };
    const answer = await beginRequest(client, key, missionId, "pass.upload", fingerprint);
    if (answer.kind === "replay" || answer.kind === "replay_deleted") return answer;
    if (answer.kind !== "fresh") return answer;
    // Quota and duplicate checks, in order, after the replay check.
    const dup = await client.query<{ id: string }>(
      "SELECT id FROM passes WHERE mission_id = $1 AND sha256 = $2 AND deleted = FALSE",
      [missionId, declaredSha],
    );
    if (dup.rows.length > 0) {
      await releaseRequestKey(client, key, missionId, "pass.upload");
      return { kind: "duplicate" as const, passId: dup.rows[0].id };
    }
    const plan = await storedPlan();
    const quota = planDefinition(plan).quota_bytes;
    const used = await client.query<{ n: string }>(
      "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM passes WHERE deleted = FALSE",
    );
    const usedBytes = Number(used.rows[0].n);
    if (usedBytes + bytes.length > quota) {
      await releaseRequestKey(client, key, missionId, "pass.upload");
      return { kind: "quota" as const, quota, usedBytes };
    }
    // Admit the upload as uploading, holding the lock.
    const passId = randomUUID();
    const order = await store.nextOrder(client, "passes", missionId);
    await client.query(
      `INSERT INTO passes (id, mission_id, filename, state, size_bytes, sha256, upload_order, created_at)
       VALUES ($1, $2, $3, 'uploading', $4, $5, $6, $7)`,
      [passId, missionId, filename, bytes.length, declaredSha, order, epochMsToIso(Date.now())],
    );
    return { kind: "fresh" as const, passId };
  });
  if (keyCheck.kind === "not_found") throw notFound();
  if (keyCheck.kind === "in_progress") throw conflict("idempotency_request_in_progress");
  if (keyCheck.kind === "reused") throw new ApiError(422, "idempotency_key_reused");
  if (keyCheck.kind === "replay_deleted") throw gone("pass_deleted");
  if (keyCheck.kind === "replay") {
    // Replay the original answer: the pass as it is now, without writing.
    const replayClient = await db().connect();
    try {
      const pass = await store.loadPass(replayClient, keyCheck.passId as string);
      if (!pass) throw gone("pass_deleted");
      res.setHeader("Idempotency-Replayed", "true");
      sendJson(res, keyCheck.status, store.passApiShape(pass));
    } finally {
      replayClient.release();
    }
    return;
  }
  if (keyCheck.kind === "duplicate") throw conflict("duplicate_capture", { pass_id: keyCheck.passId });
  if (keyCheck.kind === "quota") {
    throw conflict("quota_exceeded", { quota_bytes: keyCheck.quota, used_bytes: keyCheck.usedBytes });
  }
  if (keyCheck.kind !== "fresh") throw notFound();
  const passId = keyCheck.passId;

  // Storage: uploading -> stored in one transaction that queues parsing.
  let storedOk = false;
  try {
    await putCapture(missionId, passId, bytes);
    const readBack = await getCapture(missionId, passId);
    if (sha256Hex(readBack) !== declaredSha || !readBack.equals(bytes)) {
      await deleteCapture(missionId, passId).catch(() => undefined);
      storedOk = false;
    } else {
      storedOk = true;
    }
  } catch {
    storedOk = false;
  }
  if (!storedOk) {
    await deleteCapture(missionId, passId).catch(() => undefined);
    await withTransaction(async (client) => {
      await client.query("DELETE FROM passes WHERE id = $1", [passId]);
      await releaseRequestKey(client, key, missionId, "pass.upload");
    });
    throw outage("storage");
  }
  const createdPass = await withTransaction(async (client) => {
    await client.query("UPDATE passes SET state = 'stored' WHERE id = $1", [passId]);
    await transitionStored(
      client,
      { id: passId, missionId, filename: filename as string, sizeBytes: bytes.length, sha256: declaredSha },
      bytes,
    );
    await keepRequestKey(client, key, missionId, "pass.upload", fingerprint, 202, passId, null);
    const pass = await store.loadPass(client, passId);
    return pass;
  });
  signalRelay();
  const status = await probeAll();
  const client = await db().connect();
  try {
    const pass = createdPass ?? (await store.loadPass(client, passId));
    if (!pass) throw notFound();
    sendJson(res, 202, {
      ...store.passApiShape(pass),
      queued: status.queue === "up",
    });
  } finally {
    client.release();
  }
}));

app.get("/api/passes/:id", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const row = await client.query<{ deleted: boolean }>(
      "SELECT deleted FROM passes WHERE id = $1",
      [req.params.id],
    );
    if (row.rows.length === 0) throw notFound();
    if (row.rows[0].deleted) throw gone("pass_deleted");
    const pass = await store.loadPass(client, req.params.id);
    if (!pass) throw notFound();
    sendJson(res, 200, store.passApiShape(pass));
  } finally {
    client.release();
  }
}));

app.delete("/api/passes/:id", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const passId = req.params.id;
  const deleted = await withTransaction(async (client) => {
    const passRow = await client.query(
      "SELECT id, mission_id, state FROM passes WHERE id = $1 AND deleted = FALSE",
      [passId],
    );
    if (passRow.rows.length === 0) return { kind: "not_found" as const };
    const pass = passRow.rows[0];
    if (pass.state === "uploading" || pass.state === "stored") {
      return { kind: "not_settled" as const, state: pass.state as string };
    }
    // Lock the pass so simultaneous deletions of one pass: exactly one wins.
    const locked = await client.query<{ state: string }>(
      "SELECT state FROM passes WHERE id = $1 FOR UPDATE",
      [passId],
    );
    if (locked.rows[0].state !== "parsed" && locked.rows[0].state !== "rejected") {
      return { kind: "gone" as const };
    }
    return { kind: "ready" as const, missionId: pass.mission_id };
  });
  if (deleted.kind === "not_found") throw gone("pass_deleted");
  if (deleted.kind === "not_settled") {
    throw conflict("pass_not_settled", { state: deleted.state });
  }
  if (deleted.kind === "gone") throw gone("pass_deleted");
  const missionId = deleted.missionId;

  // Storage is checked before search; each must be reachable and confirmed.
  try {
    await getCapture(missionId, passId);
  } catch {
    throw outage("storage");
  }
  try {
    const outcome = await removePassDocuments(db() as never, passId);
    if (!outcome.confirmed) throw new Error("unconfirmed");
  } catch (err) {
    if ((err as { dependency?: string }).dependency === "search" || (err as Error).message === "unconfirmed") {
      throw outage("search");
    }
    throw err;
  }
  await withTransaction(async (client) => {
    await client.query("DELETE FROM samples WHERE pass_id = $1", [passId]);
    await client.query("DELETE FROM transcript_lines WHERE pass_id = $1", [passId]);
    await client.query("DELETE FROM events WHERE pass_id = $1", [passId]);
    await client.query("DELETE FROM pending_search_writes WHERE entity_id = $1 AND kind IN ('line','event')", [passId]);
    await client.query(
      "DELETE FROM pending_search_writes WHERE kind = 'delete' AND payload->>'pass_id' = $1",
      [passId],
    );
    await client.query("DELETE FROM outbox WHERE kind = 'pass.parse' AND pass_id = $1", [passId]);
    await transitionDeleted(client, { id: passId, missionId });
  });
  try {
    await deleteCapture(missionId, passId);
  } catch {
    // The rows are already gone; storage removal is retried by the rule that
    // a refused deletion leaves everything untouched. Best effort here.
  }
  res.status(204).end();
}));

// ---- Capture download with conditional and range support ----

app.all("/api/passes/:id/capture", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
      throw readOnly("GET, HEAD");
    }
    throw methodNotAllowed("GET, HEAD");
  }
  if (!isUuid(req.params.id)) throw notFound();
  const passId = req.params.id;
  const passRow = await query<{ mission_id: string; state: string; sha256: string; filename: string; deleted: boolean }>(
    "SELECT mission_id, state, sha256, filename, deleted FROM passes WHERE id = $1",
    [passId],
  );
  if (passRow.rows.length === 0 || passRow.rows[0].deleted) throw gone("pass_deleted");
  const pass = passRow.rows[0];
  if (pass.state === "uploading") throw conflict("pass_not_settled");
  let bytes: Buffer;
  try {
    bytes = await getCapture(pass.mission_id, passId);
  } catch {
    throw outage("storage");
  }
  serveCaptureBytes(req, res, bytes, pass.sha256, pass.filename);
}));

function serveCaptureBytes(req: Request, res: Response, bytes: Buffer, sha256: string, filename: string): void {
  const etag = `"${sha256}"`;
  const digest = Buffer.from(sha256, "hex").toString("base64");
  const conditional = evaluateConditional(
    {
      ifMatch: headerOrNull(req, "if-match"),
      ifNoneMatch: headerOrNull(req, "if-none-match"),
      ifRange: headerOrNull(req, "if-range"),
      range: headerOrNull(req, "range"),
    },
    etag,
    bytes.length,
  );
  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Repr-Digest": `sha-256=:${digest}:`,
    "Content-Disposition": contentDisposition(filename),
  };
  if (conditional.status === "not_modified") {
    res.status(304);
    res.setHeader("ETag", etag);
    res.end();
    return;
  }
  if (conditional.status === "precondition_failed") {
    sendError(res, new ApiError(412, "precondition_failed"));
    return;
  }
  if (conditional.status === "range_not_satisfiable") {
    res.status(416);
    for (const [k, v] of Object.entries(commonHeaders)) res.setHeader(k, v);
    res.setHeader("Content-Range", `bytes */${bytes.length}`);
    res.json({ error: "range_not_satisfiable" });
    return;
  }
  if (conditional.status === "range" && conditional.range) {
    const { first, last } = conditional.range;
    const part = bytes.subarray(first, last + 1);
    res.status(206);
    for (const [k, v] of Object.entries(commonHeaders)) res.setHeader(k, v);
    res.setHeader("Content-Range", conditional.contentTypeRange as string);
    res.setHeader("Content-Length", String(part.length));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(part);
    return;
  }
  res.status(200);
  for (const [k, v] of Object.entries(commonHeaders)) res.setHeader(k, v);
  res.setHeader("Content-Length", String(bytes.length));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(bytes);
}

function headerOrNull(req: Request, name: string): string | null {
  const value = req.headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value[0] : value;
}

// ---- Share link management (author) ----

const EXPIRY_ERROR = "Send the expiry as YYYY-MM-DDTHH:MM:SSZ.";
const EXPIRY_RANGE_ERROR = "Choose an expiry after now and within 365 days.";

app.post("/api/missions/:id/share", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  let expiresUtc: string | null = null;
  const body = getRawBody(req);
  if (body !== null && body.length > 0) {
    if (contentTypeOf(req) !== "application/json") throw unsupportedMediaType();
    const parsed = parseJsonBody(req);
    if (parsed === null) throw invalidJson();
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw validation({ expires_utc: EXPIRY_ERROR });
    }
    const value = (parsed as Record<string, Json>).expires_utc;
    if (value === undefined || value === null) {
      expiresUtc = null;
    } else if (!isIsoInstant(value)) {
      throw validation({ expires_utc: EXPIRY_ERROR });
    } else {
      const ms = isoToEpochMs(value) as number;
      const now = Date.now();
      if (ms <= now || ms > now + 31536000 * 1000) {
        throw validation({ expires_utc: EXPIRY_RANGE_ERROR });
      }
      expiresUtc = value;
    }
  } else if (contentTypeOf(req) !== "" && contentTypeOf(req) !== "application/json") {
    throw unsupportedMediaType();
  }
  const nowMs = Date.now();
  const token = shareLinks.generateShareToken();
  const created = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return null;
    await client.query("SELECT id FROM missions WHERE id = $1 FOR UPDATE", [missionId]);
    const previous = await client.query<{ token: string }>(
      "SELECT token FROM share_links WHERE mission_id = $1 AND revoked = FALSE",
      [missionId],
    );
    if (previous.rows.length > 0) {
      await client.query("UPDATE share_links SET revoked = TRUE WHERE token = $1", [
        previous.rows[0].token,
      ]);
      await recordChange(
        client,
        missionId,
        {
          kind: "share.revoked",
          data: {},
          webhook: { event: "share.revoked", payloadData: {} },
        },
        { bumpVersion: true },
      );
    }
    const createdAt = epochMsToIso(nowMs);
    const finalExpiry =
      expiresUtc ?? epochMsToIso(nowMs + shareLinks.DEFAULT_EXPIRY_SECONDS * 1000);
    await client.query(
      `INSERT INTO share_links (token, mission_id, created_at, expires_utc, revoked) VALUES ($1, $2, $3, $4, FALSE)`,
      [token, missionId, createdAt, finalExpiry],
    );
    await recordChange(
      client,
      missionId,
      { kind: "share.created", data: { expires_utc: finalExpiry } },
      { bumpVersion: true },
    );
    return { token, createdAt, expiresUtc: finalExpiry };
  });
  if (!created) throw notFound();
  signalRelay();
  sendJson(res, 201, { token, url: `/s/${token}`, created_at: created.createdAt, expires_utc: created.expiresUtc });
}));

app.delete("/api/missions/:id/share", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const missionId = req.params.id;
  const revoked = await withTransaction(async (client) => {
    const mission = await store.loadMission(client, missionId);
    if (!mission) return null;
    await client.query("SELECT id FROM missions WHERE id = $1 FOR UPDATE", [missionId]);
    const nowMs = Date.now();
    const active = await store.activeShareLink(client, missionId, nowMs);
    if (!active) return { kind: "none" as const };
    await client.query("UPDATE share_links SET revoked = TRUE WHERE token = $1", [active.token]);
    await recordChange(
      client,
      missionId,
      {
        kind: "share.revoked",
        data: {},
        webhook: { event: "share.revoked", payloadData: {} },
      },
      { bumpVersion: true },
    );
    return { kind: "revoked" as const };
  });
  if (!revoked) throw notFound();
  if (revoked.kind === "none") throw notFound("no_active_link");
  signalRelay();
  res.status(204).end();
}));

// ---- Share (reader) ----

async function loadShare(token: string): Promise<
  { kind: "active"; link: shareLinks.ShareLinkRow; missionId: string; state: shareLinks.ShareState; limit: { remaining: number; reset: number } | null }
  | { kind: "not_found" }
  | { kind: "gone"; state: shareLinks.ShareState }
  | { kind: "limited"; retryAfter: number }
> {
  const result = await query(
    "SELECT token, mission_id, created_at, expires_utc, revoked FROM share_links WHERE token = $1",
    [token],
  );
  if (result.rows.length === 0) return { kind: "not_found" };
  const row = result.rows[0];
  const link: shareLinks.ShareLinkRow = {
    token: row.token,
    mission_id: row.mission_id,
    created_at: row.created_at,
    expires_utc: row.expires_utc,
    revoked: row.revoked,
  };
  const state = shareLinks.shareState(link, Date.now());
  if (state !== "active") return { kind: "gone", state };
  // The rate limit is shared across every instance; fail open when the cache
  // is unreachable, without the fields.
  const limit = await consumeRateLimitFailOpen(token);
  if (limit === null) {
    return { kind: "active", link, missionId: link.mission_id, state, limit: null };
  }
  if (!limit.allowed) {
    return { kind: "limited", retryAfter: limit.resetSeconds };
  }
  return {
    kind: "active",
    link,
    missionId: link.mission_id,
    state,
    limit: { remaining: limit.remaining, reset: limit.resetSeconds },
  };
}


function shareRateHeaders(res: Response, limit: { remaining: number; reset: number } | null): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("RateLimit-Policy", "120;w=60");
  if (limit !== null) {
    res.setHeader("RateLimit", `limit=120, remaining=${limit.remaining}, reset=${limit.reset}`);
  }
}

// The common share gate: it writes the shared headers and answers the failure
// states. It returns the active context, or null when the answer was sent.
async function shareGate(
  req: Request,
  res: Response,
): Promise<{ link: shareLinks.ShareLinkRow; missionId: string; limit: { remaining: number; reset: number } | null } | null> {
  const token = req.params.token;
  const gate = await loadShare(token);
  res.setHeader("Cache-Control", "no-store");
  if (gate.kind === "not_found") {
    res.setHeader("RateLimit-Policy", "120;w=60");
    if (req.path.startsWith("/s/")) {
      res.status(404).type("html").send(notFoundPage("No replay at this link", null));
    } else {
      sendJson(res, 404, { error: "not_found" });
    }
    return null;
  }
  if (gate.kind === "limited") {
    res.setHeader("RateLimit-Policy", "120;w=60");
    res.setHeader("Retry-After", String(gate.retryAfter));
    res.setHeader("RateLimit", "limit=120, remaining=0, reset=" + gate.retryAfter);
    if (req.path.startsWith("/s/")) {
      res
        .status(429)
        .type("html")
        .send(notFoundPage("Too many requests for this replay link", "Wait a minute, then reload."));
    } else {
      sendJson(res, 429, { error: "rate_limited" });
    }
    return null;
  }
  if (gate.kind === "gone") {
    res.setHeader("RateLimit-Policy", "120;w=60");
    if (req.path.startsWith("/s/")) {
      if (gate.state === "revoked") {
        res
          .status(410)
          .type("html")
          .send(
            notFoundPage(
              "This replay link has been withdrawn",
              "The author turned this link off. Ask them for a new one.",
            ),
          );
      } else {
        res.status(410).type("html").send(notFoundPage("This replay link has expired", "Ask the author for a new link."));
      }
    } else {
      sendJson(res, 410, { error: gate.state === "revoked" ? "link_revoked" : "link_expired" });
    }
    return null;
  }
  shareRateHeaders(res, gate.limit);
  return { link: gate.link, missionId: gate.missionId, limit: gate.limit };
}

// Share data and stream routes. Only GET and HEAD are allowed.

app.all("/api/share/:token", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const body = await shareMissionBody(client, mission, gate.link.expires_utc, Date.now());
    sendJson(res, 200, body);
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/track", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const track = await store.loadTrack(client, mission.id);
    sendJson(res, 200, { samples: track.map((s, i) => store.sampleApiShape(s, i)) });
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/transcript", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const lines = await store.loadLines(client, mission.id);
    sendJson(res, 200, { lines: lines.map((l) => ({ id: l.id, pass_id: l.pass_id, met: l.met, met_label: l.met_label, speaker: l.speaker, text: l.text })) });
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/speakers", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const lines = await store.loadLines(client, mission.id);
    sendJson(res, 200, { speakers: speakerSummaries(lines) });
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/events", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const events = await attachEventSamples(client, await store.loadEvents(client, mission.id));
    sendJson(res, 200, { events: events.map((e) => eventApiShape(e, false)) });
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/frames", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const track = await store.loadTrack(client, mission.id);
    if (track.length === 0) { sendJson(res, 409, { error: "mission_has_no_samples" }); return; }
    const firstMet = track[0].met;
    const lastMet = track[track.length - 1].met;
    const fields: Record<string, string> = {};
    const fpsRaw = req.query.fps;
    if (fpsRaw === undefined || !["1", "5", "10", "25"].includes(String(fpsRaw))) fields.fps = FPS_ERROR;
    const fromRaw = req.query.from;
    const from = Number(fromRaw);
    if (fromRaw === undefined || !/^-?\d+$/.test(String(fromRaw)) || !Number.isInteger(from) || from < firstMet || from > lastMet) fields.from = FROM_ERROR;
    const toRaw = req.query.to;
    const to = Number(toRaw);
    if (toRaw === undefined || !/^-?\d+$/.test(String(toRaw)) || !Number.isInteger(to) || to > lastMet || (fields.from === undefined && to < from)) fields.to = TO_ERROR;
    if (Object.keys(fields).length > 0) { sendError(res, validation(fields)); return; }
    const fps = Number(fpsRaw) as 1 | 5 | 10 | 25;
    const maxK = Math.floor(((to * 1000 - from * 1000) * fps) / 1000);
    if (maxK + 1 > 3000) { sendError(res, validation({ to: "Ask for at most 3000 frames." })); return; }
    const hermite: HermiteSample[] = track.map((s) => ({ met: s.met, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz }));
    const frames = [];
    for (let k = 0; ; k++) {
      const metMs = frameGridMetMs(from, fps, k);
      if (metMs > to * 1000) break;
      const frame = computeFrame(hermite, metMs);
      frames.push({ k, met_ms: metMs, altitude_m: frame.altitude_m, lat_deg: frame.lat_deg, lon_deg: frame.lon_deg, speed_m_s: frame.speed_m_s });
    }
    sendJson(res, 200, { fps, frames });
  } finally {
    client.release();
  }
}));

app.all("/api/share/:token/search", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const q = req.query.q;
  const queryText = typeof q === "string" ? q : "";
  const trimmed = queryText.trim();
  const len = codePointLength(trimmed);
  if (len < 1 || len > 200) { sendError(res, validation({ q: SEARCH_ERROR })); return; }
  {
    const catchUpClient = await db().connect();
    try {
      await catchUpPendingWrites(catchUpClient);
    } catch {
      // Search may be down; handled below.
    } finally {
      catchUpClient.release();
    }
  }
  let hits: Array<{ kind: "line" | "event"; met: number; met_label: string; speaker: string | null; text: string }> = [];
  try {
    const found = await searchDocuments({ missionId: gate.missionId, query: trimmed, limit: 50 });
    hits = found.map((h) => {
      const kind = h.id.startsWith("event-") ? "event" : "line";
      return { kind: kind as "line" | "event", met: h.met, met_label: formatMetLabel(h.met), speaker: kind === "event" ? null : h.speaker, text: h.text };
    });
  } catch {
    sendError(res, outage("search"));
    return;
  }
  hits.sort((a, b) => {
    if (a.met !== b.met) return a.met - b.met;
    if (a.kind === "line" && b.kind === "event") return -1;
    if (a.kind === "event" && b.kind === "line") return 1;
    return 0;
  });
  sendJson(res, 200, { query: trimmed, count: hits.length, hits });
}));

app.all("/api/share/:token/captures/:passId", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const passRow = await query<{ mission_id: string; state: string; sha256: string; filename: string; deleted: boolean }>(
    "SELECT mission_id, state, sha256, filename, deleted FROM passes WHERE id = $1",
    [req.params.passId],
  );
  void 0;
  if (passRow.rows.length === 0 || passRow.rows[0].deleted || passRow.rows[0].mission_id !== gate.missionId || passRow.rows[0].state !== "parsed") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const pass = passRow.rows[0];
  let bytes: Buffer;
  try {
    bytes = await getCapture(pass.mission_id, req.params.passId);
  } catch {
    sendError(res, outage("storage"));
    return;
  }
  serveCaptureBytes(req, res, bytes, pass.sha256, pass.filename);
}));

app.all("/api/share/:token/events.csv", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const distance = unitParam(req, "distance", mission.distance_unit, ["km", "nmi"], "Choose km or nmi.", res);
    if (distance === null) return;
    const speed = unitParam(req, "speed", mission.speed_unit, ["m_s", "ft_s"], "Choose m_s or ft_s.", res);
    if (speed === null) return;
    const events = await store.loadEvents(client, mission.id);
    const withSamples = [];
    for (const event of events) {
      const sample = await client.query(
        "SELECT lat_deg, lon_deg, altitude_m, speed_m_s, residual_m FROM samples WHERE pass_id = $1 AND met = $2 LIMIT 1",
        [event.pass_id, event.sample_met],
      );
      withSamples.push({
        met: event.met,
        title: event.title,
        sample: sampleShapeFromRow(sample.rows[0]) ?? { lat_deg: 0, lon_deg: 0, altitude_m: 0, speed_m_s: 0, residual_m: null },
      });
    }
    const csv = buildEventCsv(withSamples, distance as DistanceUnit, speed as SpeedUnit);
    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8; header=present");
    res.setHeader("Content-Disposition", 'attachment; filename="events.csv"');
    res.setHeader("ETag", `"${createHash("sha256").update(Buffer.from(csv, "utf8")).digest("hex")}"`);
    res.send(csv);
  } finally {
    client.release();
  }
}));

function unitParam(
  req: Request,
  name: string,
  fallback: DistanceUnit | SpeedUnit,
  allowed: string[],
  error: string,
  res: Response,
): DistanceUnit | SpeedUnit | null {
  const raw = req.query[name];
  if (raw === undefined || raw === "") return fallback;
  if (!allowed.includes(String(raw))) {
    sendError(res, validation({ [name]: error }));
    return null;
  }
  return raw as DistanceUnit | SpeedUnit;
}

app.all("/api/share/:token/dossier.pdf", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, gate.missionId);
    if (!mission) { sendJson(res, 404, { error: "not_found" }); return; }
    const distance = unitParam(req, "distance", mission.distance_unit, ["km", "nmi"], "Choose km or nmi.", res);
    if (distance === null) return;
    const speed = unitParam(req, "speed", mission.speed_unit, ["m_s", "ft_s"], "Choose m_s or ft_s.", res);
    if (speed === null) return;
    res.setHeader("Content-Disposition", contentDisposition(`${mission.name}-dossier.pdf`));
    res.setHeader("Content-Type", "application/pdf");
    if (req.method === "HEAD") {
      res.status(200);
      res.end();
      return;
    }
    const pdf = await renderShareDossier(client, mission, distance as DistanceUnit, speed as SpeedUnit);
    res.status(200);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } finally {
    client.release();
  }
}));

// ---- Share stream ----

app.all("/api/share/:token/stream", route(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") throw readOnly("GET, HEAD");
  const gate = await shareGate(req, res);
  if (!gate) return;
  const missionId = gate.missionId;
  const link = gate.link;
  const streamId = randomUUID();

  // The reader key is registered before the stream opens.
  try {
    await registerReader(missionId, streamId);
  } catch {
    // Fail open: the stream still opens.
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  let closed = false;
  let lastVersion = await currentVersion(missionId);
  let lastSent = 0;

  const writeVersion = (version: number) => {
    res.write(`event: mission-changed\nid: ${version}\ndata: ${JSON.stringify({ version })}\n\n`);
    lastSent = Date.now();
  };

  const lastEventHeader = req.headers["last-event-id"];
  if (typeof lastEventHeader === "string" && /^-?\d+$/.test(lastEventHeader)) {
    const n = Number(lastEventHeader);
    if (n >= lastVersion - 1000 && n <= lastVersion) {
      for (let v = n + 1; v <= lastVersion; v++) {
        writeVersion(v);
      }
    } else {
      writeVersion(lastVersion);
    }
  } else {
    writeVersion(lastVersion);
  }

  const renewTimer = setInterval(() => {
    void (async () => {
      try {
        await renewReader(missionId, streamId);
      } catch {
        // Fail open.
      }
    })();
  }, 10000);
  renewTimer.unref?.();

  const versionTimer = setInterval(() => {
    void (async () => {
      if (closed) return;
      const version = await currentVersion(missionId);
      if (version !== lastVersion) {
        lastVersion = version;
        writeVersion(version);
        return;
      }
      // The stream ends after the revocation and at the expiry.
      const row = await query<{ revoked: boolean; expires_utc: string }>(
        "SELECT revoked, expires_utc FROM share_links WHERE token = $1",
        [link.token],
      );
      if (row.rows.length === 0 || row.rows[0].revoked || Date.parse(row.rows[0].expires_utc) <= Date.now()) {
        cleanup();
        res.end();
        return;
      }
      if (Date.now() - lastSent > 15000) {
        res.write(": keep-alive\n\n");
        lastSent = Date.now();
      }
    })();
  }, 1000);
  versionTimer.unref?.();

  function cleanup(): void {
    closed = true;
    clearInterval(renewTimer);
    clearInterval(versionTimer);
    void releaseReader(missionId, streamId).catch(() => undefined);
  }

  req.on("close", () => {
    cleanup();
  });
}));

async function currentVersion(missionId: string): Promise<number> {
  const result = await query<{ change_version: string }>(
    "SELECT change_version FROM missions WHERE id = $1",
    [missionId],
  );
  return result.rows.length > 0 ? Number(result.rows[0].change_version) : 0;
}

// ---- Author dossier ----

app.get("/api/missions/:id/dossier.pdf", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    if (req.method === "HEAD") {
      res.status(200);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition(`${mission.name}-dossier.pdf`));
      res.end();
      return;
    }
    const pdf = await renderShareDossier(client, mission, mission.distance_unit, mission.speed_unit, true);
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDisposition(`${mission.name}-dossier.pdf`));
    res.end(pdf);
  } finally {
    client.release();
  }
}));

app.head("/api/missions/:id/dossier.pdf", route(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound();
  const client = await db().connect();
  try {
    const mission = await store.loadMission(client, req.params.id);
    if (!mission) throw notFound();
    const rendererUp = await probeRenderer();
    if (!rendererUp) throw outage("renderer");
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDisposition(`${mission.name}-dossier.pdf`));
    res.end();
  } finally {
    client.release();
  }
}));

async function renderShareDossier(
  client: Parameters<typeof store.loadTrack>[0],
  mission: store.MissionRow,
  distanceUnit: DistanceUnit,
  speedUnit: SpeedUnit,
  includeNotes = false,
): Promise<Buffer> {
  const track = await store.loadTrack(client, mission.id);
  const events = await store.loadEvents(client, mission.id);
  const landmarks = await store.loadLandmarks(client, mission.id);
  const perilune = await store.computePerilune(client, mission.id);
  let periluneSample: store.TrackSample | null = null;
  if (perilune) {
    const sample = await client.query(
      "SELECT pass_id, met, utc_ms, lat_deg, lon_deg, altitude_m, speed_m_s, residual_m FROM samples WHERE mission_id = $1 AND met = $2 LIMIT 1",
      [mission.id, perilune.met],
    );
    if (sample.rows.length > 0) {
      periluneSample = {
        pass_id: sample.rows[0].pass_id,
        met: Number(sample.rows[0].met),
        utc_ms: Number(sample.rows[0].utc_ms),
        lat_deg: sample.rows[0].lat_deg,
        lon_deg: sample.rows[0].lon_deg,
        altitude_m: sample.rows[0].altitude_m,
        speed_m_s: sample.rows[0].speed_m_s,
        residual_m: sample.rows[0].residual_m === null ? null : sample.rows[0].residual_m,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      };
    }
  }
  const eventsWithSamples = [];
  for (const event of events) {
    const sample = await client.query(
      "SELECT lat_deg, lon_deg, altitude_m, speed_m_s, residual_m FROM samples WHERE pass_id = $1 AND met = $2 LIMIT 1",
      [event.pass_id, event.sample_met],
    );
    eventsWithSamples.push({
      ...event,
      sample: sampleShapeFromRow(sample.rows[0]) ?? { lat_deg: 0, lon_deg: 0, altitude_m: 0, speed_m_s: 0, residual_m: null },
    });
  }
  const html = buildDossierHtml({
    mission,
    perilune,
    periluneSample,
    events: eventsWithSamples,
    landmarks,
    reference: null,
    distanceUnit,
    speedUnit,
    includeNotes,
    nowMs: Date.now(),
  });
  try {
    return await renderDossierPdf(html);
  } catch {
    throw outage("renderer");
  }
}

// ---- HTML pages ----

const htmlPages = {
  missions: "missions",
  console: "console",
  share: "share",
} as const;

app.get("/", (req, res) => {
  res.sendFile(pageAsset("missions"), { headers: { "Cache-Control": "no-store" } });
});

app.get("/missions/:id", (req, res) => {
  res.sendFile(pageAsset("console"), { headers: { "Cache-Control": "no-store" } });
});

app.get("/s/:token", (req, res) => {
  void (async () => {
    const gate = await shareGate(req, res);
    if (!gate) return;
    res.status(200).type("html").sendFile(pageAsset("share"));
  })();
});

function pageAsset(name: keyof typeof htmlPages): string {
  return pagesRoot(`${name}.html`);
}

function pagesRoot(name: string): string {
  return `${process.cwd()}/public/${name}`;
}

function notFoundPage(heading: string, line: string | null): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<link rel="stylesheet" href="/assets/styles.css"></head>
<body class="fixed-page"><main><h1>${heading}</h1>${line ? `<p>${line}</p>` : ""}</main></body></html>`;
}

// Static assets: built bundles and fonts only.
app.use("/assets", express.static(`${process.cwd()}/public/assets`, { index: false, fallthrough: false, maxAge: "1h" }));
app.use("/fonts", express.static(`${process.cwd()}/public/fonts`, { index: false, fallthrough: false, maxAge: "1h" }));

// 404 for unknown API and non-API paths.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    res.status(404).type("html").send(notFoundPage("Page not found", null));
    return;
  }
  sendJson(res, 404, { error: "not_found" });
});

// The single error handler.
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  console.error("unexpected error", err);
  sendError(res, new ApiError(500, "internal_error"));
});

export { app };

// ---- Entry ----

export async function startServer(): Promise<void> {
  await applySchema();
  await ensurePlanState();
  void seedIfNeeded().catch((err) => console.error("seed failed", err));
  try {
    await ensureIndex();
  } catch {
    // Search down at start; retried by the workers.
  }
  try {
    await ensureEventTypes();
  } catch {
    // Webhooks down at start; retried later.
  }
  await startWorkers();
  const port = Number(process.env.APP_PUBLIC_PORT ?? "4173");
  app.listen(port, "0.0.0.0", () => {
    console.log(`Perilune Ledger listening on port ${port}`);
  });
}

void startServer();
