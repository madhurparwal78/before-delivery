/** Pieces both consoles' routes share: method checks, downloads, search and frames. */

import { createHash } from "node:crypto";
import { buildFrames, isFrameRate, MAX_FRAMES, frameCount } from "../../shared/frames.js";
import { formatMetLabel } from "../../shared/met.js";
import { isDistanceUnit, isSpeedUnit, type DistanceUnit, type SpeedUnit } from "../../shared/units.js";
import {
  conflict,
  DependencyDown,
  methodNotAllowed,
  readOnly,
  rendererUnavailable,
  searchUnavailable,
  storageUnavailable,
  validation,
} from "../errors.js";
import { pool } from "../db/pool.js";
import { sendJson, type Context } from "../http/context.js";
import { sendRepresentation } from "../http/representation.js";
import { getCapture } from "../services/storage.js";
import { searchMission } from "../services/search.js";
import { probeRenderer, renderDossier } from "../services/renderer.js";
import { runSearchCatchUp } from "../domain/searchWrites.js";
import { contentDisposition } from "../domain/filenames.js";
import { dossierHtml } from "../dossier.js";
import {
  loadEvents,
  loadFrameSamples,
  loadLandmarks,
  loadPerilunePlate,
  loadReference,
  loadTrack,
  type MissionRow,
  type PassRow,
} from "../domain/missionRead.js";

export type Handler = (context: Context) => Promise<void>;

export async function methods(
  context: Context,
  map: Partial<Record<string, Handler>>,
  options: { shareRoute?: boolean } = {},
): Promise<void> {
  const handler = map[context.method] ?? (context.method === "HEAD" ? map.GET : undefined);
  if (handler) {
    await handler(context);
    return;
  }
  if (options.shareRoute === true) {
    throw readOnly();
  }
  const allowed = Object.keys(map);
  if (allowed.includes("GET") && !allowed.includes("HEAD")) {
    allowed.push("HEAD");
  }
  throw methodNotAllowed(allowed.join(", "));
}

export function reprDigest(sha256Hex: string): string {
  return `sha-256=:${Buffer.from(sha256Hex, "hex").toString("base64")}:`;
}

export async function sendCapture(
  context: Context,
  mission: MissionRow,
  pass: PassRow,
): Promise<void> {
  if (pass.state === "uploading") {
    throw conflict("pass_not_settled", { state: pass.state });
  }
  let bytes: Buffer | null;
  try {
    bytes = await getCapture(mission.id, pass.id);
  } catch (error) {
    if (error instanceof DependencyDown) {
      throw storageUnavailable();
    }
    throw error;
  }
  if (!bytes) {
    throw storageUnavailable();
  }
  sendRepresentation(context, {
    bytes,
    etag: `"${pass.sha256}"`,
    contentType: "application/octet-stream",
    disposition: contentDisposition(pass.filename),
    reprDigest: reprDigest(pass.sha256),
  });
}

export function readUnits(
  context: Context,
  mission: MissionRow,
  options: { strict: boolean },
): { distanceUnit: DistanceUnit; speedUnit: SpeedUnit } {
  const errors: Record<string, string> = {};
  const distanceParameter = context.query.get("distance");
  const speedParameter = context.query.get("speed");
  let distanceUnit = mission.distance_unit;
  let speedUnit = mission.speed_unit;
  if (distanceParameter !== null) {
    if (isDistanceUnit(distanceParameter)) {
      distanceUnit = distanceParameter;
    } else if (options.strict) {
      errors.distance = "Choose km or nmi.";
    }
  }
  if (speedParameter !== null) {
    if (isSpeedUnit(speedParameter)) {
      speedUnit = speedParameter;
    } else if (options.strict) {
      errors.speed = "Choose m_s or ft_s.";
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation(errors);
  }
  return { distanceUnit, speedUnit };
}

export async function sendDossier(
  context: Context,
  mission: MissionRow,
  units: { distanceUnit: DistanceUnit; speedUnit: SpeedUnit },
  withNote: boolean,
): Promise<void> {
  const filename = `${mission.name}-dossier.pdf`;
  const disposition = contentDisposition(filename);
  if (context.method === "HEAD") {
    if (!(await probeRenderer())) {
      throw rendererUnavailable();
    }
    context.response.writeHead(200, {
      ...context.extraHeaders,
      "content-type": "application/pdf",
      "content-disposition": disposition,
    });
    context.response.end();
    return;
  }
  const samples = await loadTrack(pool, mission.id);
  const [perilune, events, landmarks, reference] = await Promise.all([
    loadPerilunePlate(pool, mission.id),
    loadEvents(pool, mission.id, samples, withNote),
    loadLandmarks(pool, mission.id),
    loadReference(pool, mission),
  ]);
  const html = dossierHtml({
    missionName: mission.name,
    epochMs: mission.epoch_ms,
    perilune,
    events,
    landmarks,
    reference,
    distanceUnit: units.distanceUnit,
    speedUnit: units.speedUnit,
    withNote,
    nowMs: Date.now(),
  });
  let pdf: Buffer;
  try {
    pdf = await renderDossier(html, mission.name);
  } catch (error) {
    if (error instanceof DependencyDown) {
      throw rendererUnavailable();
    }
    throw error;
  }
  context.response.writeHead(200, {
    ...context.extraHeaders,
    "content-type": "application/pdf",
    "content-length": pdf.length,
    "content-disposition": disposition,
  });
  context.response.end(pdf);
}

export async function sendSearch(context: Context, mission: MissionRow): Promise<void> {
  const raw = context.query.get("q") ?? "";
  const query = raw.trim();
  if (query.length < 1 || query.length > 200) {
    throw validation({ q: "Enter 1 to 200 characters to search for." });
  }
  await runSearchCatchUp();
  let hits;
  try {
    hits = await searchMission(mission.id, query);
  } catch (error) {
    if (error instanceof DependencyDown) {
      throw searchUnavailable();
    }
    throw error;
  }
  const live = await pool.query<{ id: string }>(
    "select id from passes where mission_id = $1 and state <> 'deleted'",
    [mission.id],
  );
  const livePasses = new Set(live.rows.map((row) => row.id));
  const kept = hits
    .filter((hit) => livePasses.has(hit.pass_id))
    .map((hit) => ({
      kind: hit.kind,
      met: hit.met,
      met_label: formatMetLabel(hit.met),
      speaker: hit.speaker,
      text: hit.text,
    }));
  sendJson(context, 200, { query, count: kept.length, hits: kept });
}

export async function sendFrames(context: Context, mission: MissionRow): Promise<void> {
  const samples = await loadFrameSamples(pool, mission.id);
  if (samples.length === 0) {
    throw conflict("mission_has_no_samples");
  }
  const firstMet = samples[0].met;
  const lastMet = samples[samples.length - 1].met;
  const errors: Record<string, string> = {};
  const fpsRaw = context.query.get("fps") ?? "";
  const fps = Number(fpsRaw);
  const fpsValid = /^\d+$/.test(fpsRaw) && isFrameRate(fps);
  if (!fpsValid) {
    errors.fps = "Choose fps 1, 5, 10 or 25.";
  }
  const fromRaw = context.query.get("from") ?? "";
  const from = Number(fromRaw);
  const fromValid =
    /^-?\d+$/.test(fromRaw) && Number.isInteger(from) && from >= firstMet && from <= lastMet;
  if (!fromValid) {
    errors.from = "Give from as whole MET seconds within the track.";
  }
  const toRaw = context.query.get("to") ?? "";
  const to = Number(toRaw);
  const toInteger = /^-?\d+$/.test(toRaw) && Number.isInteger(to);
  const toValid = fromValid
    ? toInteger && to >= from && to <= lastMet
    : toInteger && to >= firstMet && to <= lastMet;
  if (!toValid) {
    errors.to = "Give to as whole MET seconds from from to the end of the track.";
  }
  if (Object.keys(errors).length === 0 && isFrameRate(fps)) {
    if (frameCount(from, to, fps) > MAX_FRAMES) {
      errors.to = `Ask for at most ${MAX_FRAMES} frames.`;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation(errors);
  }
  if (!isFrameRate(fps)) {
    throw validation({ fps: "Choose fps 1, 5, 10 or 25." });
  }
  sendJson(context, 200, { fps, frames: buildFrames(samples, from, to, fps) });
}

export function etagOf(body: Buffer): string {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}
