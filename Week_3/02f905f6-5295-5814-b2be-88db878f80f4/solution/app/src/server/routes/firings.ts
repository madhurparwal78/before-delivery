// Kilns, profiles, the queue, firings, placements, start and unload.
import pg from "pg";
import type { DamageReport, Segment, User } from "../../shared/api";
import { checkPlacement, footprintOf, gridHalves, isRotation, type Cone, type Neighbour, type Rotation } from "../../shared/rules";
import { allow } from "../auth";
import { firingStatus, schedule, timeFields } from "../clock";
import { pool, tx } from "../db";
import { fieldsOf, HttpError, invalidFields, notFound, type Route } from "../http";
import { readyNotice } from "../mail";
import {
  fillPercent,
  firingOut,
  firingRow,
  footprintOfRow,
  kilnOf,
  kilnRow,
  kilnsOut,
  layerHeight,
  lockedFiring,
  placedRows,
  profileOut,
  shelfOf,
  type FiringRow,
  type KilnRow,
  type ProfileRow,
} from "../load";
import { formatHalves } from "../measure";
import { drainOutbox, enqueue } from "../outbox";
import { addHistory, ownerEmail, ownerName, parsePieceNumber, pieceNumberText, pieceRows, piecesOut, sidesHalves } from "../pieces";
import { trackingUrl } from "./intake";

const firingLocked = () => new HttpError(409, "firing_locked", "Placements can change only while the load is being built.");
const invalidTransition = (message: string) => new HttpError(409, "invalid_transition", message);

/** The firing if it exists, for staff only (404 before 403). */
async function staffFiring(user: User, rawId: string): Promise<FiringRow> {
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;
  const firing = id === null ? undefined : await firingRow(pool, id);
  if (!firing) throw notFound();
  allow(user, "owner", "tech");
  return firing;
}

interface Spot {
  layer: number;
  x: number;
  y: number;
  rotation: Rotation;
}

function readSpot(body: Record<string, unknown>, kiln: KilnRow, base: Spot | null, fields: Record<string, string>): Spot | null {
  const pick = <T>(key: string, parse: (v: unknown) => T | null, current: T | undefined, message: string): T | undefined => {
    if (!(key in body) && current !== undefined) return current;
    const parsed = parse(body[key]);
    if (parsed === null) fields[key] = message;
    return parsed ?? undefined;
  };
  const layer = pick(
    "layer",
    (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= kiln.layers ? v : null),
    base?.layer,
    `Choose a layer from 1 to ${kiln.layers}`,
  );
  const x = pick("x", gridHalves, base?.x, "Use half-inch steps from 0 to 23");
  const y = pick("y", gridHalves, base?.y, "Use half-inch steps from 0 to 23");
  const rotation = pick("rotation", (v) => (isRotation(v) ? v : null), base?.rotation, "Use 0, 90, 180 or 270");
  if (layer === undefined || x === undefined || y === undefined || rotation === undefined) return null;
  return { layer, x, y, rotation };
}

interface PlacementTarget {
  firing: FiringRow;
  kiln: KilnRow;
  number: number;
}

/** Runs the placement checks for a piece at a spot, against the other footprints on that layer. */
async function refuseOrAccept(client: pg.PoolClient, target: PlacementTarget, spot: Spot): Promise<void> {
  const [piece] = await pieceRows(client, "p.number = $1", [target.number]);
  const clay = (await client.query<{ max_cone: Cone }>("SELECT max_cone FROM clays WHERE id = $1", [piece.clay_id])).rows[0];
  const neighbours: Neighbour[] = (await placedRows(client, target.firing.id))
    .filter((row) => row.layer === spot.layer && row.piece_number !== target.number)
    .map((row) => ({ pieceNumber: pieceNumberText(row.piece_number), footprint: footprintOfRow(row) }));
  const refusal = checkPlacement(
    { stage: piece.stage, cone: piece.cone, clayMaxCone: clay.max_cone, height: piece.height_halves },
    { stage: target.firing.stage, cone: target.firing.cone },
    shelfOf(target.kiln),
    footprintOf(piece.shape, sidesHalves(piece), spot.rotation, spot.x, spot.y),
    neighbours,
  );
  if (refusal) throw new HttpError(409, "placement_refused", refusal.message, { reason: refusal.reason });
}

async function placementReply(client: pg.PoolClient, target: PlacementTarget, spot: Spot, status: number) {
  const placed = await placedRows(client, target.firing.id);
  return {
    status,
    body: {
      placement: { firing_id: target.firing.id, layer: spot.layer, x: formatHalves(spot.x), y: formatHalves(spot.y), rotation: spot.rotation },
      fill_percent: fillPercent(placed, target.kiln.usable_cubic_inches),
      layer_height_in: layerHeight(placed, spot.layer),
    },
  };
}

const SEGMENT_LIMITS = {
  rate_f_per_hour: [1, 1000, "Enter a rate from 1 to 1000 °F per hour"],
  target_f: [100, 2400, "Enter a target from 100 to 2400 °F"],
  hold_minutes: [0, 600, "Enter a hold from 0 to 600 minutes"],
} as const;

function readProfile(body: Record<string, unknown>): { segments: Segment[]; coolDown: number } {
  const fields: Record<string, string> = {};
  const raw = Array.isArray(body.segments) ? body.segments : null;
  if (!raw || raw.length < 1 || raw.length > 8) fields.segments = "Use 1 to 8 segments";
  const segments: Segment[] = (raw ?? []).slice(0, 8).map((entry, index) => {
    const item = fieldsOf(entry);
    const value = (key: keyof typeof SEGMENT_LIMITS) => {
      const [min, max, message] = SEGMENT_LIMITS[key];
      const n = item[key];
      if (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max) return n;
      fields[`segments.${index}.${key}`] = message;
      return min;
    };
    return { rate_f_per_hour: value("rate_f_per_hour"), target_f: value("target_f"), hold_minutes: value("hold_minutes") };
  });
  const coolDown = body.cool_down_hours;
  if (!(typeof coolDown === "number" && Number.isInteger(coolDown) && coolDown >= 1 && coolDown <= 72)) {
    fields.cool_down_hours = "Enter a cool-down from 1 to 72 hours";
  }
  if (Object.keys(fields).length > 0 || typeof coolDown !== "number") throw invalidFields(fields);
  return { segments, coolDown };
}

const SHELF_CODE = /^[A-Z0-9]{1,8}$/;

interface DamageEntry {
  pieceNumber: number;
  kind: DamageReport["kind"];
  photoId: string;
  note: string;
}

async function readUnload(client: pg.PoolClient, user: User, body: Record<string, unknown>, placedNumbers: number[], becomesReady: boolean) {
  const fields: Record<string, string> = {};
  const shelf = typeof body.pickup_shelf === "string" ? body.pickup_shelf.trim() : "";
  if (shelf === "" && becomesReady) fields.pickup_shelf = "Enter a pickup shelf";
  else if (shelf !== "" && !SHELF_CODE.test(shelf)) fields.pickup_shelf = "Use 1 to 8 capital letters or digits";
  const entries: DamageEntry[] = [];
  const raw = body.damage === undefined || body.damage === null ? [] : body.damage;
  if (!Array.isArray(raw)) fields.damage = "List damage as entries";
  const usedPhotos = new Set<string>();
  for (const [index, value] of (Array.isArray(raw) ? raw : []).entries()) {
    const item = fieldsOf(value);
    const key = (name: string) => `damage.${index}.${name}`;
    const number = parsePieceNumber(item.piece_number);
    if (number === null || !placedNumbers.includes(number)) fields[key("piece_number")] = "Choose a piece from this firing";
    const kind = item.kind === "glaze_run" || item.kind === "crack" ? item.kind : null;
    if (!kind) fields[key("kind")] = "Choose Glaze run or Crack";
    const note = item.note === undefined || item.note === null ? "" : item.note;
    if (typeof note !== "string" || note.length > 500) fields[key("note")] = "Keep the note to 500 characters";
    const photoId = typeof item.photo_id === "string" ? item.photo_id : "";
    const photo = photoId
      ? (await client.query<{ uploader_id: number; attached: boolean }>("SELECT uploader_id, attached FROM photos WHERE id = $1 FOR UPDATE", [photoId])).rows[0]
      : undefined;
    if (!photo) fields[key("photo_id")] = "Add a photo of the damage";
    else if (photo.attached || photo.uploader_id !== user.id || usedPhotos.has(photoId)) fields[key("photo_id")] = "Photo already used or not yours";
    usedPhotos.add(photoId);
    if (number !== null && kind && typeof note === "string") entries.push({ pieceNumber: number, kind, photoId, note });
  }
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  return { shelf, entries };
}

export const firingRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/kilns",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner", "tech");
      return { status: 200, body: await kilnsOut(pool) };
    },
  },
  {
    method: "PUT",
    path: "/api/kilns/:kiln_id/profiles/:profile_id",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const found = await pool.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1 AND kiln_id = $2", [ctx.params.profile_id, ctx.params.kiln_id]);
      if (!found.rows[0]) throw notFound();
      allow(ctx.user, "owner");
      const { segments, coolDown } = readProfile(fieldsOf(ctx.body));
      const saved = await pool.query<ProfileRow>("UPDATE profiles SET segments = $2, cool_down_hours = $3 WHERE id = $1 RETURNING *", [
        ctx.params.profile_id,
        JSON.stringify(segments),
        coolDown,
      ]);
      return { status: 200, body: profileOut(saved.rows[0]) };
    },
  },
  {
    method: "GET",
    path: "/api/queue",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner", "tech");
      return { status: 200, body: await piecesOut(pool, await pieceRows(pool, "p.status = 'queued'", [])) };
    },
  },
  {
    method: "POST",
    path: "/api/firings",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      allow(ctx.user, "owner", "tech");
      const body = fieldsOf(ctx.body);
      const kiln = typeof body.kiln_id === "string" ? await kilnRow(pool, body.kiln_id) : undefined;
      const profile = kiln && typeof body.profile_id === "string"
        ? (await pool.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1 AND kiln_id = $2", [body.profile_id, kiln.id])).rows[0]
        : undefined;
      const fields: Record<string, string> = {};
      if (!kiln) fields.kiln_id = "Choose a kiln";
      if (!profile) fields.profile_id = "Choose a profile for this kiln";
      if (!kiln || !profile) throw invalidFields(fields);
      let created: FiringRow;
      try {
        created = (
          await pool.query<FiringRow>(
            `INSERT INTO firings (kiln_id, profile_id, stage, cone, status, created_at) VALUES ($1, $2, $3, $4, 'building', now()) RETURNING *`,
            [kiln.id, profile.id, profile.stage, profile.cone],
          )
        ).rows[0];
      } catch (error) {
        if (error instanceof pg.DatabaseError && error.code === "23505") {
          throw new HttpError(409, "kiln_busy", "This kiln already has a firing in progress.");
        }
        throw error;
      }
      return { status: 201, body: await firingOut(pool, created) };
    },
  },
  {
    method: "GET",
    path: "/api/firings/:id",
    auth: true,
    body: "none",
    handler: async (ctx) => ({ status: 200, body: await firingOut(pool, await staffFiring(ctx.user, ctx.params.id)) }),
  },
  {
    method: "POST",
    path: "/api/firings/:id/placements",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const found = await staffFiring(ctx.user, ctx.params.id);
      return tx(async (client) => {
        const firing = await lockedFiring(client, found.id);
        if (firingStatus(firing, new Date()) !== "building") throw firingLocked();
        const kiln = await kilnOf(client, firing);
        const body = fieldsOf(ctx.body);
        const fields: Record<string, string> = {};
        const number = parsePieceNumber(body.piece_number);
        const [piece] = number === null ? [] : await pieceRows(client, "p.number = $1", [number], true);
        if (!piece) fields.piece_number = "Choose a piece from the queue";
        const spot = readSpot(body, kiln, null, fields);
        if (!piece || !spot) throw invalidFields(fields);
        if (piece.status !== "queued") throw new HttpError(409, "piece_not_queued", `Piece ${pieceNumberText(piece.number)} is not waiting for the kiln.`);
        const target = { firing, kiln, number: piece.number };
        await refuseOrAccept(client, target, spot);
        await client.query(
          "INSERT INTO placements (firing_id, piece_number, layer, x_halves, y_halves, rotation) VALUES ($1, $2, $3, $4, $5, $6)",
          [firing.id, piece.number, spot.layer, spot.x, spot.y, spot.rotation],
        );
        await client.query("UPDATE pieces SET status = 'loaded' WHERE number = $1", [piece.number]);
        await addHistory(client, piece.number, ctx.user.name, "placed");
        return placementReply(client, target, spot, 201);
      });
    },
  },
  {
    method: "PATCH",
    path: "/api/firings/:id/placements/:piece_number",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const found = await staffFiring(ctx.user, ctx.params.id);
      const number = parsePieceNumber(ctx.params.piece_number);
      return tx(async (client) => {
        const firing = await lockedFiring(client, found.id);
        const current = (await placedRows(client, firing.id)).find((row) => row.piece_number === number);
        if (!current || number === null) throw notFound();
        if (firingStatus(firing, new Date()) !== "building") throw firingLocked();
        const kiln = await kilnOf(client, firing);
        const fields: Record<string, string> = {};
        const base: Spot = { layer: current.layer, x: current.x_halves, y: current.y_halves, rotation: current.rotation };
        const spot = readSpot(fieldsOf(ctx.body), kiln, base, fields);
        if (!spot) throw invalidFields(fields);
        const target = { firing, kiln, number };
        await refuseOrAccept(client, target, spot);
        await client.query(
          "UPDATE placements SET layer = $3, x_halves = $4, y_halves = $5, rotation = $6 WHERE firing_id = $1 AND piece_number = $2",
          [firing.id, number, spot.layer, spot.x, spot.y, spot.rotation],
        );
        await addHistory(client, number, ctx.user.name, "moved");
        return placementReply(client, target, spot, 200);
      });
    },
  },
  {
    method: "DELETE",
    path: "/api/firings/:id/placements/:piece_number",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      const found = await staffFiring(ctx.user, ctx.params.id);
      const number = parsePieceNumber(ctx.params.piece_number);
      return tx(async (client) => {
        const firing = await lockedFiring(client, found.id);
        const current = (await placedRows(client, firing.id)).find((row) => row.piece_number === number);
        if (!current || number === null) throw notFound();
        if (firingStatus(firing, new Date()) !== "building") throw firingLocked();
        const kiln = await kilnOf(client, firing);
        await client.query("DELETE FROM placements WHERE firing_id = $1 AND piece_number = $2", [firing.id, number]);
        await client.query("UPDATE pieces SET status = 'queued' WHERE number = $1", [number]);
        await addHistory(client, number, ctx.user.name, "removed");
        return { status: 200, body: { fill_percent: fillPercent(await placedRows(client, firing.id), kiln.usable_cubic_inches) } };
      });
    },
  },
  {
    method: "POST",
    path: "/api/firings/:id/start",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const found = await staffFiring(ctx.user, ctx.params.id);
      const started = await tx(async (client) => {
        const firing = await lockedFiring(client, found.id);
        if (firingStatus(firing, new Date()) !== "building") throw invalidTransition("Only a load that is being built can start firing.");
        const placed = await placedRows(client, firing.id);
        if (placed.length === 0) throw new HttpError(409, "empty_load", "Place at least one piece before starting.");
        const profile = (await client.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1", [firing.profile_id])).rows[0];
        const now = new Date();
        const times = schedule(now, profile.segments, profile.cool_down_hours);
        const row = (
          await client.query<FiringRow>(
            `UPDATE firings SET status = 'started', profile_snapshot = $2, started_at = $3, firing_ends_at = $4, cool_until = $5
             WHERE id = $1 RETURNING *`,
            [firing.id, JSON.stringify(profile), now, times.firingEndsAt, times.coolUntil],
          )
        ).rows[0];
        for (const piece of placed) await addHistory(client, piece.piece_number, ctx.user.name, "fired", now);
        return row;
      });
      return { status: 200, body: await firingOut(pool, started) };
    },
  },
  {
    method: "POST",
    path: "/api/firings/:id/unload",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const found = await staffFiring(ctx.user, ctx.params.id);
      const unloaded = await tx(async (client) => {
        const firing = await lockedFiring(client, found.id);
        const now = new Date();
        const status = firingStatus(firing, now);
        if (status === "building" || status === "unloaded") throw invalidTransition("Only a cooled firing can be unloaded.");
        if (status === "firing" || status === "cooling") {
          throw new HttpError(409, "kiln_not_cool", status === "firing" ? "Kiln still firing" : "Kiln still cooling", timeFields("cool_until", firing.cool_until));
        }
        const placed = await placedRows(client, firing.id);
        const pieces = await pieceRows(client, "p.number = ANY($1::int[])", [placed.map((p) => p.piece_number)], true);
        const backToGlaze = (plan: string) => plan === "bisque_and_glaze" && firing.stage === "bisque";
        const { shelf, entries } = await readUnload(
          client,
          ctx.user,
          fieldsOf(ctx.body),
          placed.map((p) => p.piece_number),
          pieces.some((p) => !backToGlaze(p.plan)),
        );
        await client.query("UPDATE firings SET status = 'unloaded' WHERE id = $1", [firing.id]);
        for (const piece of pieces) {
          if (backToGlaze(piece.plan)) {
            await client.query("UPDATE pieces SET status = 'queued', stage = 'glaze' WHERE number = $1", [piece.number]);
          } else {
            await client.query("UPDATE pieces SET status = 'ready', stage = NULL, pickup_shelf = $2, ready_at = $3 WHERE number = $1", [
              piece.number,
              shelf,
              now,
            ]);
            const link = piece.member_id === null
              ? (await client.query<{ token: string }>("SELECT token FROM tracking_links WHERE piece_number = $1 AND active", [piece.number])).rows[0]
              : undefined;
            await enqueue(client, readyNotice(ownerEmail(piece), ownerName(piece), pieceNumberText(piece.number), shelf, link ? trackingUrl(link.token) : null));
          }
          await addHistory(client, piece.number, ctx.user.name, "unloaded", now);
        }
        for (const entry of entries) {
          await client.query(
            `INSERT INTO damage_reports (piece_number, firing_id, kind, note, status, unload_photo_id, reported_by, reported_at)
             VALUES ($1, $2, $3, $4, 'reported', $5, $6, $7)`,
            [entry.pieceNumber, firing.id, entry.kind, entry.note, entry.photoId, ctx.user.name, now],
          );
          await client.query("UPDATE photos SET attached = true WHERE id = $1", [entry.photoId]);
          await addHistory(client, entry.pieceNumber, ctx.user.name, "damage reported", now);
        }
        return lockedFiring(client, firing.id);
      });
      void drainOutbox().catch((error: Error) => console.error("outbox failed:", error.message));
      return { status: 200, body: await firingOut(pool, unloaded) };
    },
  },
];
