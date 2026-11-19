// The photo state machine: receive, validate in the published order, store, then commit.

import { Db, withTransaction } from "./db";
import { ApiError } from "./http";
import { Config } from "../shared/config";
import { Storage, ImageType, objectKeyFor } from "./storage";
import { creatureById, presentCreatures } from "../shared/creatures";
import { creaturesInFrame, scoreOf, Pose, Facing } from "../shared/frame";
import { isLand, Heading, HEADINGS } from "../shared/world";
import { newId, thousandsSep } from "../shared/ids";
import { WorldClock } from "./clock";
import { applyAlbumForPhoto, filmSatchel, filmSatchelIn, writeFilm } from "./players";
import { publishLive } from "./live";

export interface PhotoAnswer {
  photo: {
    id: string;
    creature: string;
    creature_name: string;
    island: number;
    tick: number;
    score: { size: number; centring: number; facing: number; sharpness: number; total: number };
    measures: { distance: number; best_distance: number; offset: number; focus_error: number; creature_facing: Facing };
    album: { page_filled: boolean; pages_filled: number; stamp_earned: boolean };
    film: number;
    image_url: string;
  };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return "image/png";
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_SIG)) return "image/jpeg";
  return null;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  image: Buffer | null;
}

export function parseMultipart(body: Buffer, contentType: string): ParsedMultipart {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new ApiError("bad_request");
  const boundary = "--" + (m[1] ?? m[2]);
  const parts: ParsedMultipart = { fields: {}, image: null };
  const sections = splitBoundary(body, boundary);
  for (const section of sections) {
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = section.subarray(0, headerEnd).toString("utf8");
    const content = section.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (name === "image") {
      parts.image = content;
    } else {
      parts.fields[name] = content.toString("utf8").replace(/\r\n$/, "");
    }
  }
  return parts;
}

function splitBoundary(body: Buffer, boundary: string): Buffer[] {
  const out: Buffer[] = [];
  const b = Buffer.from(boundary);
  let start = body.indexOf(b);
  while (start !== -1) {
    const next = body.indexOf(b, start + b.length);
    let end = next;
    if (next === -1) end = body.length;
    let chunk = body.subarray(start + b.length, end);
    if (chunk.subarray(0, 2).toString("utf8") === "\r\n") chunk = chunk.subarray(2);
    if (chunk.length > 0 && chunk.subarray(chunk.length - 2).toString("utf8") === "\r\n") chunk = chunk.subarray(0, chunk.length - 2);
    if (chunk.length > 0) out.push(chunk);
    start = next;
  }
  return out;
}

export interface PhotoRequest {
  playerId: string;
  worldId: string;
  shotKey: string | null;
  pose: Pose;
  image: Buffer;
}

export function parsePose(raw: string): Pose {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError("bad_pose"); }
  if (parsed === null || typeof parsed !== "object") throw new ApiError("bad_pose");
  const o = parsed as Record<string, unknown>;
  const island = o.island;
  const tile = o.tile;
  const camera = o.camera;
  const heading = o.heading;
  const zoom = o.zoom;
  const focus = o.focus;
  const tick = o.tick;
  if (typeof island !== "number" || !Number.isInteger(island) || island < 1 || island > 5) throw new ApiError("bad_pose");
  if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(n => Number.isInteger(n))) throw new ApiError("bad_pose");
  if (!Array.isArray(camera) || camera.length !== 2 || !camera.every(n => Number.isInteger(n))) throw new ApiError("bad_pose");
  if (typeof heading !== "string" || !HEADINGS.includes(heading as Heading)) throw new ApiError("bad_pose");
  if (typeof zoom !== "number" || ![1, 2, 4].includes(zoom)) throw new ApiError("bad_pose");
  if (typeof focus !== "number" || ![2, 4, 8, 16].includes(focus)) throw new ApiError("bad_pose");
  if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) throw new ApiError("bad_pose");
  return {
    island,
    tile: [tile[0], tile[1]],
    camera: [camera[0], camera[1]],
    heading: heading as Heading,
    zoom,
    focus,
    tick
  };
}

export async function handlePhoto(
  db: Db,
  config: Config,
  storage: Storage,
  clock: WorldClock,
  req: PhotoRequest
): Promise<PhotoAnswer> {
  // Replay of a shot key returns the stored answer, before any other check past 401.
  if (req.shotKey) {
    const existing = await db.query<{ photo_id: string | null; pose: string | null }>(
      "SELECT photo_id, pose FROM shot_keys WHERE player_id = $1 AND shot_key = $2", [req.playerId, req.shotKey]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.photo_id && row.pose === poseSignature(req.pose)) return storedAnswer(db, row.photo_id, req.playerId);
      throw new ApiError("shot_key_reused");
    }
  }

  const pose = req.pose;
  const serverTick = await clock.tickOf(req.worldId);

  // 422 order: bad_pose, tick_passed, tick_ahead, cannot_stand, camera_too_far, nothing_in_frame.
  const [cx, cy] = pose.camera;
  const [tx, ty] = pose.tile;
  if (cx < 0 || cy < 0 || tx < 0 || ty < 0) throw new ApiError("bad_pose");
  if (!isLand(pose.island, tx, ty)) throw new ApiError("cannot_stand");
  if (Math.abs(cx - tx) > 1 || Math.abs(cy - ty) > 1) throw new ApiError("camera_too_far");
  if (pose.tick + config.photoTickGrace < serverTick) throw new ApiError("tick_passed");
  if (pose.tick > serverTick) throw new ApiError("tick_ahead");

  const states = presentCreatures(pose.tick, config).filter(c => c.island === pose.island);
  const inFrame = creaturesInFrame(pose, states);
  if (inFrame.length === 0) throw new ApiError("nothing_in_frame");
  const subject = inFrame[0];
  const spec = creatureById(subject.id)!;
  const { score, measures } = scoreOf(pose, subject);

  const photoId = newId("photo");
  const type = sniffImageType(req.image);
  if (!type) throw new ApiError("not_an_image");
  if (req.image.length > config.photoMaxBytes) {
    throw new ApiError("photo_too_large", { limit: thousandsSep(config.photoMaxBytes) });
  }

  // Storage first: the object must be confirmed before anything commits.
  try {
    await storage.put(objectKeyFor(photoId, type), req.image, type);
  } catch {
    throw new ApiError("storage_unavailable_photo");
  }

  const filmBefore = await filmSatchel(db, req.playerId);
  if (filmBefore <= 0) throw new ApiError("out_of_film");

  const result = await withTransaction(db, async client => {
    const film = await filmSatchelIn(client, req.playerId);
    if (film <= 0) throw new ApiError("out_of_film");
    await client.query(
      `INSERT INTO photos (id, player_id, creature_id, island, tick, tile_x, tile_y, heading, zoom, focus,
        size, centring, facing, sharpness, total, stored, content_type, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,$16,$17)`,
      [photoId, req.playerId, spec.id, pose.island, pose.tick, tx, ty, pose.heading, pose.zoom, pose.focus,
        score.size, score.centring, score.facing, score.sharpness, score.total, type, req.image.length]);
    await writeFilm(client, req.playerId, -1, "photo");
    const album = await applyAlbumForPhoto(client, req.playerId, spec.id, pose.island, photoId, score.total, pose.tick);
    if (req.shotKey) {
      await client.query(
        "INSERT INTO shot_keys (player_id, shot_key, photo_id, pose) VALUES ($1,$2,$3,$4)",
        [req.playerId, req.shotKey, photoId, poseSignature(req.pose)]);
    }
    const filmAfter = await filmSatchelIn(client, req.playerId);
    return { album, filmAfter };
  });

  publishLive({
    world: req.worldId,
    kind: "photo",
    payload: { player_id: req.playerId, photo_id: photoId, creature: spec.id, creature_name: spec.name, total: score.total, island: pose.island, film: result.filmAfter, album: result.album }
  });

  return {
    photo: {
      id: photoId,
      creature: spec.id,
      creature_name: spec.name,
      island: pose.island,
      tick: pose.tick,
      score,
      measures,
      album: result.album,
      film: result.filmAfter,
      image_url: `/api/photos/${photoId}/image`
    }
  };
}

export async function storedAnswer(db: Db, photoId: string, playerId: string): Promise<PhotoAnswer> {
  const r = await db.query<{
    id: string; creature_id: string; island: number; tick: string; size: number; centring: number;
    facing: number; sharpness: number; total: number; tile_x: number; tile_y: number; heading: Heading; zoom: number; focus: number;
  }>("SELECT id, creature_id, island, tick, size, centring, facing, sharpness, total, tile_x, tile_y, heading, zoom, focus FROM photos WHERE id = $1", [photoId]);
  const row = r.rows[0];
  const spec = creatureById(row.creature_id)!;
  const states = presentCreatures(Number(row.tick), loadConfigForScore()).filter(c => c.island === row.island);
  const pose: Pose = { island: row.island, tile: [row.tile_x, row.tile_y], camera: [row.tile_x, row.tile_y], heading: row.heading, zoom: row.zoom, focus: row.focus, tick: Number(row.tick) };
  const inFrame = creaturesInFrame(pose, states);
  const subject = inFrame.find(c => c.id === row.creature_id) ?? inFrame[0];
  const { measures } = subject ? scoreOf(pose, subject) : { measures: { distance: 0, best_distance: 0, offset: 0, focus_error: 0, creature_facing: "toward" as Facing } };
  const film = await filmSatchel(db, playerId);
  const pages = 0;
  return {
    photo: {
      id: row.id,
      creature: row.creature_id,
      creature_name: spec.name,
      island: row.island,
      tick: Number(row.tick),
      score: { size: row.size, centring: row.centring, facing: row.facing, sharpness: row.sharpness, total: row.total },
      measures,
      album: { page_filled: false, pages_filled: pages, stamp_earned: false },
      film,
      image_url: `/api/photos/${row.id}/image`
    }
  };
}

/** The pose as the shot key remembers it, so a reused key with another pose answers shot_key_reused. */
function poseSignature(pose: Pose): string {
  return JSON.stringify({ island: pose.island, tile: pose.tile, camera: pose.camera, heading: pose.heading, zoom: pose.zoom, focus: pose.focus, tick: pose.tick });
}

let configRef: Config | null = null;
export function setPhotoConfig(config: Config): void {
  configRef = config;
}
function loadConfigForScore(): Config {
  return configRef!;
}

export function photoBody(row: {
  id: string; creature_id: string; island: number; tick: string | number; size: number; centring: number; facing: number; sharpness: number; total: number;
}): Record<string, unknown> {
  const spec = creatureById(row.creature_id);
  return {
    id: row.id,
    creature: row.creature_id,
    creature_name: spec?.name ?? row.creature_id,
    island: row.island,
    tick: Number(row.tick),
    score: { size: row.size, centring: row.centring, facing: row.facing, sharpness: row.sharpness, total: row.total },
    image_url: `/api/photos/${row.id}/image`
  };
}
