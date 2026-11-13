/** Everything under `/api/missions`. */

import { isDistanceUnit, isSpeedUnit } from "../../shared/units.js";
import type { JsonValue } from "../../shared/canonical.js";
import { pool } from "../db/pool.js";
import {
  ApiError,
  captureTooLarge,
  conflict,
  DependencyDown,
  notFound,
  unsupportedMediaType,
  validation,
  webhooksUnavailable,
} from "../errors.js";
import {
  header,
  readBody,
  readJsonBody,
  sendJson,
  type Context,
} from "../http/context.js";
import {
  findMissionRow,
  findPassRow,
  listMissionRows,
  loadEvents,
  loadMission,
  loadReference,
  loadSpeakers,
  loadSubscribers,
  loadTrack,
  loadTranscript,
  toPass,
  type MissionRow,
} from "../domain/missionRead.js";
import { listAuditEntries, verifyChain } from "../domain/audit.js";
import { createMission, patchMission } from "../domain/missions.js";
import { pinEvent, snapSample } from "../domain/events.js";
import { addLandmark, removeLandmark } from "../domain/landmarks.js";
import { addSubscriber, removeSubscriber } from "../domain/subscribers.js";
import { refreshReference, setReference, TARGET_PATTERN } from "../domain/reference.js";
import { loadReferenceVectors } from "../domain/residuals.js";
import { createShareLink, revokeShareLink } from "../domain/shareOps.js";
import { DEFAULT_EXPIRY_SECONDS, MAX_EXPIRY_SECONDS } from "../domain/share.js";
import { CAPTURE_LIMIT_BYTES } from "../domain/captureFormat.js";
import { admitUpload, discardAdmitted, finishUpload, sha256Hex } from "../domain/passes.js";
import { decodeCaptureFilename } from "../domain/filenames.js";
import {
  beginRequestKey,
  pinFingerprint,
  releaseRequestKey,
  REQUEST_KEY_PATTERN,
  uploadFingerprint,
} from "../domain/requestKeys.js";
import { isObject, readIsoInstant, readSubscriberUrl, readTextField } from "../domain/validation.js";
import {
  methods,
  sendDossier,
  sendFrames,
  sendSearch,
  type Handler,
} from "./common.js";
import { authorStream } from "./streams.js";

const NAME_RULE = { min: 1, max: 80, lengthMessage: "Enter a mission name of 1 to 80 characters." };

export async function missionsCollection(context: Context): Promise<void> {
  await methods(context, {
    GET: async (ctx) => {
      const rows = await listMissionRows(pool);
      const nowMs = Date.now();
      const missions = [];
      for (const row of rows) {
        missions.push(await loadMission(row, nowMs));
      }
      sendJson(ctx, 200, { missions });
    },
    POST: async (ctx) => {
      const body = await readJsonBody(ctx, ["application/json"]);
      if (!isObject(body)) {
        throw validation({ name: NAME_RULE.lengthMessage });
      }
      const errors: Record<string, string> = {};
      const name = readTextField(body.name, NAME_RULE);
      if (!name.ok) {
        errors.name = name.message;
      }
      const epochMs = readIsoInstant(body.epoch_utc);
      if (epochMs === null) {
        errors.epoch_utc = "Enter the epoch as YYYY-MM-DDTHH:MM:SSZ.";
      }
      if (Object.keys(errors).length > 0) {
        throw validation(errors);
      }
      const row = await createMission(
        (name as { ok: true; value: string }).value,
        epochMs as number,
      );
      sendJson(ctx, 201, await loadMission(row, Date.now()));
    },
  });
}

export async function missionApi(
  context: Context,
  missionId: string,
  rest: string[],
): Promise<void> {
  const mission = await findMissionRow(pool, missionId);
  if (!mission) {
    throw notFound();
  }
  const route = rest.join("/");
  const handlers: Record<string, Partial<Record<string, Handler>>> = {
    "": {
      GET: async (ctx) => sendJson(ctx, 200, await loadMission(mission, Date.now())),
      PATCH: async (ctx) => patchHandler(ctx, mission),
    },
    track: {
      GET: async (ctx) => sendJson(ctx, 200, { samples: await loadTrack(pool, mission.id) }),
    },
    frames: { GET: async (ctx) => sendFrames(ctx, mission) },
    transcript: {
      GET: async (ctx) => sendJson(ctx, 200, { lines: await loadTranscript(pool, mission.id) }),
    },
    speakers: {
      GET: async (ctx) => sendJson(ctx, 200, { speakers: await loadSpeakers(pool, mission.id) }),
    },
    events: {
      GET: async (ctx) => {
        sendJson(ctx, 200, { events: await loadEvents(pool, mission.id, true) });
      },
      POST: async (ctx) => pinHandler(ctx, mission),
    },
    search: { GET: async (ctx) => sendSearch(ctx, mission) },
    audit: {
      GET: async (ctx) => sendJson(ctx, 200, { entries: await listAuditEntries(pool, mission.id) }),
    },
    "audit/verify": {
      GET: async (ctx) =>
        sendJson(ctx, 200, verifyChain(await listAuditEntries(pool, mission.id))),
    },
    stream: { GET: async (ctx) => authorStream(ctx, mission) },
    "dossier.pdf": {
      GET: async (ctx) =>
        sendDossier(
          ctx,
          mission,
          { distanceUnit: mission.distance_unit, speedUnit: mission.speed_unit },
          true,
        ),
    },
    subscribers: {
      GET: async (ctx) =>
        sendJson(ctx, 200, { subscribers: await loadSubscribers(pool, mission.id) }),
      POST: async (ctx) => addSubscriberHandler(ctx, mission),
    },
    landmarks: { POST: async (ctx) => addLandmarkHandler(ctx, mission) },
    reference: {
      GET: async (ctx) => referenceHandler(ctx, mission),
      PUT: async (ctx) => setReferenceHandler(ctx, mission),
    },
    "reference/refresh": { POST: async (ctx) => refreshReferenceHandler(ctx, mission) },
    passes: { POST: async (ctx) => uploadHandler(ctx, mission) },
    share: {
      POST: async (ctx) => createShareHandler(ctx, mission),
      DELETE: async (ctx) => revokeShareHandler(ctx, mission),
    },
  };
  const map = handlers[route];
  if (map) {
    await methods(context, map);
    return;
  }
  if (rest.length === 2 && rest[0] === "landmarks") {
    await methods(context, {
      DELETE: async (ctx) => {
        await removeLandmark(mission, rest[1]);
        ctx.response.writeHead(204).end();
      },
    });
    return;
  }
  if (rest.length === 2 && rest[0] === "subscribers") {
    await methods(context, {
      DELETE: async (ctx) => {
        try {
          await removeSubscriber(mission, rest[1]);
        } catch (error) {
          throw asWebhookError(error);
        }
        ctx.response.writeHead(204).end();
      },
    });
    return;
  }
  throw notFound();
}

function asWebhookError(error: unknown): unknown {
  return error instanceof DependencyDown ? webhooksUnavailable() : error;
}

async function patchHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/merge-patch+json"]);
  if (!isObject(body)) {
    throw validation({ body: "Send a JSON object." });
  }
  const errors: Record<string, string> = {};
  const patch: {
    name?: string;
    distance_unit?: "km" | "nmi";
    speed_unit?: "m_s" | "ft_s";
    clearReference?: boolean;
  } = {};
  if ("name" in body) {
    const name = readTextField(body.name, NAME_RULE);
    if (name.ok) {
      patch.name = name.value;
    } else {
      errors.name = name.message;
    }
  }
  if ("distance_unit" in body) {
    if (isDistanceUnit(body.distance_unit)) {
      patch.distance_unit = body.distance_unit;
    } else {
      errors.distance_unit = "Choose km or nmi.";
    }
  }
  if ("speed_unit" in body) {
    if (isSpeedUnit(body.speed_unit)) {
      patch.speed_unit = body.speed_unit;
    } else {
      errors.speed_unit = "Choose m_s or ft_s.";
    }
  }
  if ("reference_target" in body) {
    if (body.reference_target === null) {
      patch.clearReference = true;
    } else {
      errors.reference_target = "Only null clears the reference target here.";
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation(errors);
  }
  const updated = await patchMission(mission, patch);
  sendJson(context, 200, await loadMission(updated, Date.now()));
}

async function pinHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/json"]);
  const key = header(context, "idempotency-key") ?? "";
  if (!REQUEST_KEY_PATTERN.test(key)) {
    throw validation({
      idempotency_key: "Send an Idempotency-Key of 1 to 64 letters, digits or dashes.",
    });
  }
  const fields = isObject(body) ? body : ({} as Record<string, JsonValue>);
  const fingerprint = pinFingerprint(fields.met, fields.title, fields.note);
  const claim = await beginRequestKey(mission.id, "pin", key, fingerprint);
  if (claim.kind === "in_progress") {
    throw conflict("idempotency_request_in_progress");
  }
  if (claim.kind === "reused") {
    throw new ApiError(422, "idempotency_key_reused");
  }
  if (claim.kind === "replay") {
    const existing = claim.eventId ? (await loadEvents(pool, mission.id, true, claim.eventId))[0] : null;
    if (!existing) {
      throw notFound();
    }
    sendJson(context, claim.status, existing, { "Idempotency-Replayed": "true" });
    return;
  }
  try {
    const errors: Record<string, string> = {};
    const met = fields.met;
    const metValid = typeof met === "number" && Number.isInteger(met);
    if (!metValid) {
      errors.met = "Give MET as a whole number of seconds.";
    }
    const title = readTextField(fields.title, {
      min: 1,
      max: 120,
      lengthMessage: "Enter a title of 1 to 120 characters.",
    });
    if (!title.ok) {
      errors.title = title.message;
    }
    let note: string | null = null;
    if (fields.note !== undefined && fields.note !== null) {
      const checked = readTextField(fields.note, {
        min: 0,
        max: 2000,
        lengthMessage: "Keep the private note to 2,000 characters or fewer.",
      });
      if (checked.ok) {
        note = checked.value;
      } else {
        errors.note = checked.message;
      }
    }
    let sample = null;
    if (metValid && Object.keys(errors).length === 0) {
      sample = await snapSample(mission.id, met as number);
      if (!sample) {
        errors.met = "No sample at or before this time.";
      }
    }
    if (Object.keys(errors).length > 0 || !sample || !title.ok) {
      throw validation(errors);
    }
    const event = await pinEvent(mission, key, sample, title.value, note);
    sendJson(context, 201, event);
  } catch (error) {
    await releaseRequestKey(mission.id, "pin", key);
    throw error;
  }
}

async function addLandmarkHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/json"]);
  const fields = isObject(body) ? body : ({} as Record<string, JsonValue>);
  const landmark = await addLandmark(mission, fields);
  sendJson(context, 201, landmark);
}

async function addSubscriberHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/json"]);
  const fields = isObject(body) ? body : ({} as Record<string, JsonValue>);
  const url = readSubscriberUrl(fields.url);
  if (url === null) {
    throw validation({ url: "Enter an http or https URL of up to 2048 characters." });
  }
  try {
    const subscriber = await addSubscriber(mission, url);
    sendJson(context, 201, subscriber);
  } catch (error) {
    throw asWebhookError(error);
  }
}

async function referenceHandler(context: Context, mission: MissionRow): Promise<void> {
  const [reference, vectors] = await Promise.all([
    loadReference(pool, mission),
    loadReferenceVectors(pool, mission.id),
  ]);
  sendJson(context, 200, { reference, vectors });
}

async function hasSamples(mission: MissionRow): Promise<boolean> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from samples where mission_id = $1",
    [mission.id],
  );
  return result.rows[0].count > 0;
}

async function setReferenceHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/json"]);
  if (!(await hasSamples(mission))) {
    throw conflict("mission_has_no_samples");
  }
  const fields = isObject(body) ? body : ({} as Record<string, JsonValue>);
  const target = fields.target;
  if (typeof target !== "string" || !TARGET_PATTERN.test(target)) {
    throw validation({
      target: "Enter a target of 1 to 32 capital letters, digits or dashes.",
    });
  }
  const result = await setReference(mission, target);
  sendJson(context, 200, {
    mission: await loadMission(result.mission, Date.now()),
    outcome: result.outcome,
  });
}

async function refreshReferenceHandler(context: Context, mission: MissionRow): Promise<void> {
  if (!mission.reference_target) {
    throw conflict("no_reference_target");
  }
  if (!(await hasSamples(mission))) {
    throw conflict("mission_has_no_samples");
  }
  const result = await refreshReference(mission);
  sendJson(context, 200, {
    mission: await loadMission(result.mission, Date.now()),
    outcome: result.outcome,
  });
}

async function createShareHandler(context: Context, mission: MissionRow): Promise<void> {
  const body = await readJsonBody(context, ["application/json"], { allowEmpty: true });
  const nowMs = Date.now();
  let expiresMs = Math.floor(nowMs / 1000) * 1000 + DEFAULT_EXPIRY_SECONDS * 1000;
  if (body !== undefined) {
    if (!isObject(body)) {
      throw validation({ expires_utc: "Send the expiry as YYYY-MM-DDTHH:MM:SSZ." });
    }
    if (body.expires_utc !== undefined) {
      const parsed = readIsoInstant(body.expires_utc);
      if (parsed === null) {
        throw validation({ expires_utc: "Send the expiry as YYYY-MM-DDTHH:MM:SSZ." });
      }
      if (parsed <= nowMs || parsed > nowMs + MAX_EXPIRY_SECONDS * 1000) {
        throw validation({
          expires_utc: "Choose an expiry after now and within 365 days.",
        });
      }
      expiresMs = parsed;
    }
  }
  const created = await createShareLink(mission, expiresMs, nowMs);
  sendJson(context, 201, created.link);
}

async function revokeShareHandler(context: Context, mission: MissionRow): Promise<void> {
  await revokeShareLink(mission, Date.now());
  context.response.writeHead(204).end();
}

async function uploadHandler(context: Context, mission: MissionRow): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readBody(context, CAPTURE_LIMIT_BYTES);
  } catch (error) {
    if (error instanceof ApiError && error.status === 413) {
      throw captureTooLarge();
    }
    throw error;
  }
  const type = (header(context, "content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/octet-stream") {
    throw unsupportedMediaType();
  }
  const key = header(context, "idempotency-key") ?? "";
  if (!REQUEST_KEY_PATTERN.test(key)) {
    throw validation({
      idempotency_key: "Send an Idempotency-Key of 1 to 64 letters, digits or dashes.",
    });
  }
  const errors: Record<string, string> = {};
  const filename = decodeCaptureFilename(header(context, "x-capture-filename") ?? "");
  if (filename === null) {
    errors.filename =
      "Send the capture name percent-encoded as UTF-8: 1 to 120 characters, no control characters, slashes or backslashes.";
  }
  const declared = header(context, "x-capture-sha256") ?? "";
  if (!/^[0-9a-f]{64}$/.test(declared)) {
    errors.sha256 = "Send the capture's SHA-256 as 64 lowercase hex characters.";
  }
  if (Object.keys(errors).length > 0 || filename === null) {
    throw validation(errors);
  }
  const claim = await beginRequestKey(
    mission.id,
    "upload",
    key,
    uploadFingerprint(declared, filename),
  );
  if (claim.kind === "in_progress") {
    throw conflict("idempotency_request_in_progress");
  }
  if (claim.kind === "reused") {
    throw new ApiError(422, "idempotency_key_reused");
  }
  if (claim.kind === "replay") {
    const existing = claim.passId ? await findPassRow(pool, claim.passId) : null;
    if (!existing) {
      throw notFound();
    }
    if (existing.state === "deleted") {
      throw new ApiError(410, "pass_deleted");
    }
    sendJson(context, claim.status, toPass(existing), { "Idempotency-Replayed": "true" });
    return;
  }

  const request = {
    mission,
    filename,
    declaredSha256: declared,
    bytes,
    requestKey: key,
  };
  let passId: string;
  try {
    passId = await admitUpload(request);
  } catch (error) {
    await releaseRequestKey(mission.id, "upload", key);
    throw error;
  }
  if (bytes.length === 0 || sha256Hex(bytes) !== declared) {
    await discardAdmitted(mission.id, passId);
    await releaseRequestKey(mission.id, "upload", key);
    throw validation(
      bytes.length === 0
        ? { body: "The capture is empty." }
        : { sha256: "The SHA-256 does not match the bytes received." },
    );
  }
  try {
    const pass = await finishUpload(request, passId);
    sendJson(context, 202, pass);
  } catch (error) {
    await releaseRequestKey(mission.id, "upload", key);
    throw error;
  }
}
