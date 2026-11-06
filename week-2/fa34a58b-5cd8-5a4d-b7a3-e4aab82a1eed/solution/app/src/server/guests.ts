// Guest scenes: creation (with idempotent replay), cancelling, and the scheduled → active → ended moves.
// Guest scene transitions are decided here and nowhere else.

import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { addDays, parseWallDateTime } from "../shared/zone.ts";
import type { GuestScene, GuestSceneState } from "../shared/types.ts";
import { pool, rows, transaction } from "./db.ts";
import { ApiError, errorBody, FIELD, FieldErrors } from "./errors.ts";
import { hubNow } from "./clock.ts";
import { householdZone, loadCalendar, scheduledOwnerAt } from "./plan.ts";
import { announce, writeGuestEnded, type Queued } from "./notices.ts";
import { broadcast } from "./socket.ts";

const MINUTE = 60_000;
const MAX_DAYS = 14;
const KEY_RE = /^[\x21-\x7e]{1,100}$/;
const KEY_LIFETIME = "24 hours";

interface GuestSceneRow {
  id: string;
  room_id: string;
  scene_id: string;
  starts_at: Date;
  ends_at: Date;
  state: GuestSceneState;
  ended_at: Date | null;
  cancelled_at: Date | null;
}

const COLUMNS = "id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at";

async function toGuestScene(row: GuestSceneRow): Promise<GuestScene> {
  const zone = await householdZone();
  const iso = (value: Date | null) => (value ? zone.iso(value.getTime()) : null);
  return {
    id: row.id,
    room_id: row.room_id,
    scene_id: row.scene_id,
    starts_at: zone.iso(row.starts_at.getTime()),
    ends_at: zone.iso(row.ends_at.getTime()),
    state: row.state,
    ended_at: iso(row.ended_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

export async function listGuestScenes(): Promise<GuestScene[]> {
  return Promise.all(
    (await rows<GuestSceneRow>(pool, `SELECT ${COLUMNS} FROM guest_scenes ORDER BY position DESC`)).map(toGuestScene),
  );
}

interface Answer {
  status: number;
  body: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates and creates one guest scene inside the caller's transaction. */
async function create(client: pg.PoolClient, body: unknown, keyError: boolean): Promise<GuestScene> {
  const zone = await householdZone(client);
  const now = hubNow();
  const request = isObject(body) ? body : {};
  const errors = new FieldErrors();
  if (keyError) errors.add("Idempotency-Key", FIELD.idempotencyKey);

  const [room] = typeof request.room_id === "string"
    ? await rows<{ id: string; name: string }>(client, "SELECT id, name FROM rooms WHERE id = $1 FOR UPDATE", [request.room_id])
    : [];
  if (!room) errors.add("room_id", FIELD.chooseRoom);
  const [scene] = typeof request.scene_id === "string"
    ? await rows<{ id: string }>(client, "SELECT id FROM scenes WHERE id = $1", [request.scene_id])
    : [];
  if (!scene) errors.add("scene_id", FIELD.chooseScene);

  const thisMinute = Math.floor(now / MINUTE) * MINUTE;
  let starts: number | null = null;
  let startWall: { date: string; hour: number; minute: number } | null = null;
  if (request.starts_at === null || request.starts_at === undefined) {
    starts = thisMinute;
    const wall = zone.wall(thisMinute);
    startWall = { date: wall.date, hour: wall.hour, minute: wall.minute };
  } else {
    startWall = parseWallDateTime(request.starts_at);
    if (!startWall) errors.add("starts_at", FIELD.wallFormat);
    else {
      starts = zone.firstOccurrence(startWall.date, startWall.hour, startWall.minute);
      if (starts === null) errors.add("starts_at", FIELD.skipped);
      else if (starts < thisMinute) errors.add("starts_at", FIELD.startPast);
    }
  }
  const endWall = parseWallDateTime(request.ends_at);
  let ends: number | null = null;
  if (!endWall) errors.add("ends_at", FIELD.wallFormat);
  else {
    ends = zone.firstOccurrence(endWall.date, endWall.hour, endWall.minute);
    if (ends === null) errors.add("ends_at", FIELD.skipped);
    else if (starts !== null && startWall) {
      const latest = zone.occurrence(addDays(startWall.date, MAX_DAYS), startWall.hour, startWall.minute);
      if (ends <= starts) errors.add("ends_at", FIELD.endOrder);
      else if (ends > latest) errors.add("ends_at", FIELD.endLong);
    }
  }
  errors.throwIfAny();
  if (!room || !scene || starts === null || ends === null) throw ApiError.invalid({});
  const roomId = room.id;
  const [overlap] = await rows<{ id: string }>(
    client,
    `SELECT id FROM guest_scenes WHERE room_id = $1 AND state IN ('scheduled', 'active')
     AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [roomId, new Date(starts), new Date(ends)],
  );
  if (overlap) throw ApiError.of("guest_overlap", room.name);
  const [created] = await rows<GuestSceneRow>(
    client,
    `INSERT INTO guest_scenes (id, room_id, scene_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [randomUUID(), roomId, scene.id, new Date(starts), new Date(ends), starts <= now ? "active" : "scheduled"],
  );
  return toGuestScene(created as GuestSceneRow);
}

/** Canonical JSON (keys sorted at every depth), so key order never changes a fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function answerOf(work: () => Promise<GuestScene>): Promise<Answer> {
  try {
    return { status: 201, body: { guest_scene: await work() } };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: errorBody(error) };
    throw error;
  }
}

/** POST /api/guest-scenes, with optional Idempotency-Key replay. Returns the answer and whether a guest scene was made. */
export async function createGuestScene(key: string | undefined, body: unknown): Promise<Answer & { created: GuestScene | null }> {
  const usable = key !== undefined && KEY_RE.test(key);
  const answer = await transaction(async (client) => {
    if (!usable) return { ...(await answerOf(() => create(client, body, key !== undefined))), replay: false };
    const fingerprint = createHash("sha256").update(canonical(body)).digest("hex");
    await client.query(`DELETE FROM idempotency_keys WHERE key = $1 AND created_at < now() - interval '${KEY_LIFETIME}'`, [key]);
    const inserted = await client.query(
      "INSERT INTO idempotency_keys (key, fingerprint, status, body) VALUES ($1, $2, 0, 'null') ON CONFLICT (key) DO NOTHING",
      [key, fingerprint],
    );
    if (inserted.rowCount === 0) {
      const [stored] = await rows<{ fingerprint: string; status: number; body: unknown }>(
        client, "SELECT fingerprint, status, body FROM idempotency_keys WHERE key = $1 FOR UPDATE", [key],
      );
      if (stored && stored.fingerprint === fingerprint) return { status: stored.status, body: stored.body, replay: true };
      const conflict = ApiError.of("idempotency_conflict");
      return { status: conflict.status, body: errorBody(conflict), replay: true };
    }
    const fresh = await answerOf(() => create(client, body, false));
    await client.query("UPDATE idempotency_keys SET status = $2, body = $3 WHERE key = $1", [key, fresh.status, JSON.stringify(fresh.body)]);
    return { ...fresh, replay: false };
  });
  const created = !answer.replay && answer.status === 201 ? (answer.body as { guest_scene: GuestScene }).guest_scene : null;
  if (created) broadcast({ type: "guest_scene", guest_scene: created });
  return { status: answer.status, body: answer.body, created };
}

/** POST /api/guest-scenes/{id}/cancel */
export async function cancelGuestScene(id: string): Promise<GuestScene> {
  const guest = await transaction(async (client) => {
    const [row] = await rows<GuestSceneRow>(client, `SELECT ${COLUMNS} FROM guest_scenes WHERE id = $1 FOR UPDATE`, [id]);
    if (!row) throw ApiError.of("not_found");
    if (row.state === "ended" || row.state === "cancelled") throw ApiError.of("guest_scene_closed");
    const [cancelled] = await rows<GuestSceneRow>(
      client, `UPDATE guest_scenes SET state = 'cancelled', cancelled_at = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, new Date(hubNow())],
    );
    return toGuestScene(cancelled as GuestSceneRow);
  });
  broadcast({ type: "guest_scene", guest_scene: guest });
  return guest;
}

/**
 * Moves guest scenes to where the hub clock now is: scheduled ones whose start has come become
 * active, and any whose end instant has come (inclusive) end now, queueing the guest-ended notice in
 * the same transaction.
 */
export async function advanceGuestScenes(now: number): Promise<void> {
  const at = new Date(now);
  const { changed, queued } = await transaction(async (client) => {
    const activated = await rows<GuestSceneRow>(
      client,
      `UPDATE guest_scenes SET state = 'active' WHERE state = 'scheduled' AND starts_at <= $1 AND ends_at > $1 RETURNING ${COLUMNS}`,
      [at],
    );
    const ended = await rows<GuestSceneRow>(
      client,
      `UPDATE guest_scenes SET state = 'ended', ended_at = $1 WHERE state IN ('scheduled', 'active') AND ends_at <= $1 RETURNING ${COLUMNS}`,
      [at],
    );
    const notices: (Queued | null)[] = [];
    if (ended.length > 0) {
      const calendar = await loadCalendar(client);
      const roomName = new Map(calendar.rooms.map((room) => [room.id, room.name]));
      for (const guest of ended) {
        const back = scheduledOwnerAt(calendar, guest.room_id, guest.ends_at.getTime());
        notices.push(await writeGuestEnded(
          client, guest.id, roomName.get(guest.room_id) ?? guest.room_id, calendar.scenes.get(guest.scene_id) ?? guest.scene_id,
          guest.ends_at.getTime(), back.scene_id === null ? "Unplanned" : (calendar.scenes.get(back.scene_id) ?? back.scene_id),
        ));
      }
    }
    return { changed: [...activated, ...ended], queued: notices };
  });
  await announce(queued);
  for (const row of changed) broadcast({ type: "guest_scene", guest_scene: await toGuestScene(row) });
}
