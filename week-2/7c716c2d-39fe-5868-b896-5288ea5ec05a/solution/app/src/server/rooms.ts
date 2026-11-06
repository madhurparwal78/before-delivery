// The office floor: rooms, occupancy and knocks.
import { randomUUID } from "node:crypto";
import type { Viewer } from "./access.js";
import { config } from "./config.js";
import { tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { emit } from "./events.js";
import { knockStatus, liveBefore, type KnockStatus } from "./expiry.js";
import { route } from "./router.js";
import { isoInstant, nowMs } from "./time.js";
import { zoneOf } from "./workspace.js";

interface RoomRow {
  id: string;
  name: string;
  kind: "open" | "private";
  x: number;
  y: number;
  w: number;
  h: number;
  workspace_id: string;
}

interface KnockRow {
  id: string;
  room_id: string;
  person_id: string;
  status: KnockStatus;
  created_at: number;
  expires_at: number;
  workspace_id: string;
}

async function occupantsOf(db: Db, roomId: string): Promise<{ person_id: string; name: string; status: string }[]> {
  const { rows } = await db.query<{ person_id: string; name: string; status: string }>(
    "SELECT o.person_id, p.name, p.presence AS status FROM room_occupants o JOIN people p ON p.id = o.person_id WHERE o.room_id = $1 ORDER BY o.joined_at, p.name",
    [roomId],
  );
  return rows;
}

export async function roomJson(db: Db, roomId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<RoomRow>("SELECT id, name, kind, x, y, w, h, workspace_id FROM rooms WHERE id = $1", [roomId]);
  const room = rows[0] as RoomRow;
  return { id: room.id, name: room.name, kind: room.kind, x: room.x, y: room.y, w: room.w, h: room.h, occupants: await occupantsOf(db, roomId) };
}

async function floorJson(db: Db, viewer: Viewer): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM rooms WHERE workspace_id = $1 ORDER BY position", [viewer.workspaceId]);
  const rooms = [];
  for (const row of rows) rooms.push(await roomJson(db, row.id));
  const me = await db.query<{ room_id: string | null; status: string }>(
    "SELECT o.room_id, p.presence AS status FROM people p LEFT JOIN room_occupants o ON o.person_id = p.id WHERE p.id = $1",
    [viewer.id],
  );
  return { rooms, me: { room_id: me.rows[0]?.room_id ?? null, status: me.rows[0]?.status ?? "active" } };
}

async function findRoom(db: Db, viewer: Viewer, roomId: string): Promise<RoomRow> {
  const { rows } = await db.query<RoomRow>("SELECT id, name, kind, x, y, w, h, workspace_id FROM rooms WHERE id::text = $1 AND workspace_id = $2", [roomId, viewer.workspaceId]);
  if (!rows[0]) throw new ApiError("not_found");
  return rows[0];
}

function knockJson(knock: KnockRow, zone: string, now: number): Record<string, unknown> {
  return {
    id: knock.id,
    room_id: knock.room_id,
    person_id: knock.person_id,
    status: knockStatus(knock.status, knock.expires_at, now),
    created_at: isoInstant(knock.created_at, zone),
    expires_at: isoInstant(knock.expires_at, zone),
  };
}

async function knockAudience(db: Db, knock: KnockRow): Promise<string[]> {
  const occupants = await occupantsOf(db, knock.room_id);
  return [knock.person_id, ...occupants.map((o) => o.person_id).filter((id) => id !== knock.person_id)];
}

async function emitKnock(db: Db, knock: KnockRow, now: number): Promise<void> {
  await emit(db, knock.workspace_id, "knock", knockJson(knock, await zoneOf(db, knock.workspace_id), now), { recipients: await knockAudience(db, knock) });
}

const KNOCK_COLUMNS = "id, room_id, person_id, status, created_at, expires_at, workspace_id";

/** Expires the waiting knocks picked by `where` and tells the knocker and the occupants. */
async function expireWhere(db: Db, where: string, value: unknown): Promise<void> {
  const now = nowMs();
  const { rows } = await db.query<KnockRow>(`UPDATE knocks SET status = 'expired' WHERE status = 'waiting' AND ${where} RETURNING ${KNOCK_COLUMNS}`, [value]);
  for (const knock of rows) await emitKnock(db, knock, now);
}

/** Sends the room event for a person leaving; a private room left empty expires its waiting knocks. */
export async function roomLeft(db: Db, workspaceId: string, roomId: string): Promise<void> {
  await db.query("SELECT 1 FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
  const room = await roomJson(db, roomId);
  await emit(db, workspaceId, "room", room);
  if (room.kind === "private" && (room.occupants as unknown[]).length === 0) await expireWhere(db, "room_id = $1", roomId);
}

/** A removed person's waiting knocks end with them. */
export async function expireKnocksOf(db: Db, personId: string): Promise<void> {
  await expireWhere(db, "person_id = $1", personId);
}

/** Moves a person into a room (out of any other), sending room events for both. */
async function enterRoom(db: Db, workspaceId: string, personId: string, roomId: string): Promise<void> {
  const { rows } = await db.query<{ room_id: string }>("DELETE FROM room_occupants WHERE person_id = $1 RETURNING room_id", [personId]);
  await db.query("INSERT INTO room_occupants (person_id, room_id, joined_at) VALUES ($1, $2, $3)", [personId, roomId, nowMs()]);
  await db.query("UPDATE people SET streams_closed_at = NULL, presence = 'active', last_active_at = $2 WHERE id = $1", [personId, nowMs()]);
  const left = rows[0]?.room_id;
  if (left && left !== roomId) await roomLeft(db, workspaceId, left);
  await emit(db, workspaceId, "room", await roomJson(db, roomId));
}

export async function leaveRoom(db: Db, workspaceId: string, personId: string): Promise<void> {
  const { rows } = await db.query<{ room_id: string }>("DELETE FROM room_occupants WHERE person_id = $1 RETURNING room_id", [personId]);
  if (rows[0]) await roomLeft(db, workspaceId, rows[0].room_id);
}

async function isInside(db: Db, personId: string, roomId: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM room_occupants WHERE person_id = $1 AND room_id = $2", [personId, roomId]);
  return rows.length > 0;
}

async function findKnock(db: Db, viewer: Viewer, knockId: string, lock = false): Promise<KnockRow> {
  const { rows } = await db.query<KnockRow>(
    `SELECT ${KNOCK_COLUMNS} FROM knocks WHERE id::text = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`,
    [knockId, viewer.workspaceId],
  );
  if (!rows[0]) throw new ApiError("not_found");
  return rows[0];
}

/** Marks knocks that reached their edge as expired and tells the knocker and the occupants. */
export async function expireKnocks(): Promise<void> {
  await tx((db) => expireWhere(db, `NOT (${liveBefore("expires_at", "$1")})`, nowMs()));
}

route("GET", "/api/floor", { access: "workspace" }, async (ctx) => ({ status: 200, body: await tx((db) => floorJson(db, ctx.viewer)) }));

route("POST", "/api/rooms/:id/join", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const room = await findRoom(db, viewer, ctx.params.id ?? "");
      await db.query("SELECT 1 FROM rooms WHERE id = $1 FOR UPDATE", [room.id]);
      if (!(await isInside(db, viewer.id, room.id))) {
        const others = (await occupantsOf(db, room.id)).filter((o) => o.person_id !== viewer.id);
        if (room.kind === "private" && others.length > 0) {
          const { rows } = await db.query(
            `SELECT 1 FROM knocks WHERE room_id = $1 AND person_id = $2 AND status = 'let_in' AND ${liveBefore("expires_at", "$3")}`,
            [room.id, viewer.id, nowMs()],
          );
          if (rows.length === 0) throw new ApiError("knock_required");
        }
        await enterRoom(db, viewer.workspaceId, viewer.id, room.id);
      }
      return floorJson(db, viewer);
    }),
  };
});

route("POST", "/api/rooms/leave", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx((db) => leaveRoom(db, viewer.workspaceId, viewer.id));
  return { status: 204 };
});

route("POST", "/api/presence/heartbeat", { access: "workspace" }, async () => ({ status: 204 }));

route("POST", "/api/rooms/:id/knocks", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const room = await findRoom(db, viewer, ctx.params.id ?? "");
    await db.query("SELECT 1 FROM rooms WHERE id = $1 FOR UPDATE", [room.id]);
    if (await isInside(db, viewer.id, room.id)) throw new ApiError("already_inside");
    if (room.kind === "open") throw new ApiError("room_open");
    if ((await occupantsOf(db, room.id)).length === 0) throw new ApiError("room_empty");
    const now = nowMs();
    const zone = await zoneOf(db, viewer.workspaceId);
    const { rows } = await db.query<KnockRow>(
      `SELECT ${KNOCK_COLUMNS} FROM knocks
       WHERE room_id = $1 AND person_id = $2 AND status = 'waiting' AND ${liveBefore("expires_at", "$3")} ORDER BY created_at DESC LIMIT 1`,
      [room.id, viewer.id, now],
    );
    if (rows[0]) return { status: 200, body: knockJson(rows[0], zone, now) };
    const knock: KnockRow = {
      id: randomUUID(),
      room_id: room.id,
      person_id: viewer.id,
      status: "waiting",
      created_at: now,
      expires_at: now + config.timers.knockTtl * 1000,
      workspace_id: viewer.workspaceId,
    };
    await db.query("INSERT INTO knocks (id, workspace_id, room_id, person_id, status, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      knock.id,
      knock.workspace_id,
      knock.room_id,
      knock.person_id,
      knock.status,
      knock.created_at,
      knock.expires_at,
    ]);
    await emitKnock(db, knock, now);
    return { status: 201, body: knockJson(knock, zone, now) };
  });
});

route("GET", "/api/rooms/:id/knocks/mine", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const room = await findRoom(db, viewer, ctx.params.id ?? "");
    const { rows } = await db.query<KnockRow>(
      `SELECT ${KNOCK_COLUMNS} FROM knocks WHERE room_id = $1 AND person_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [room.id, viewer.id],
    );
    if (!rows[0]) throw new ApiError("not_found");
    return { status: 200, body: knockJson(rows[0], await zoneOf(db, viewer.workspaceId), nowMs()) };
  });
});

route("GET", "/api/rooms/:id/knocks", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const room = await findRoom(db, viewer, ctx.params.id ?? "");
    if (!(await isInside(db, viewer.id, room.id))) throw new ApiError("not_in_room");
    const now = nowMs();
    const { rows } = await db.query<KnockRow>(
      `SELECT ${KNOCK_COLUMNS} FROM knocks
       WHERE room_id = $1 AND status = 'waiting' AND ${liveBefore("expires_at", "$2")} ORDER BY created_at, id`,
      [room.id, now],
    );
    const zone = await zoneOf(db, viewer.workspaceId);
    return { status: 200, body: { knocks: rows.map((k) => knockJson(k, zone, now)) } };
  });
});

route("GET", "/api/knocks/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const knock = await findKnock(db, viewer, ctx.params.id ?? "");
    if (knock.person_id !== viewer.id && !(await isInside(db, viewer.id, knock.room_id))) throw new ApiError("not_found");
    return { status: 200, body: knockJson(knock, await zoneOf(db, viewer.workspaceId), nowMs()) };
  });
});

route("POST", "/api/knocks/:id/answer", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const knock = await findKnock(db, viewer, ctx.params.id ?? "", true);
    if (!(await isInside(db, viewer.id, knock.room_id))) throw new ApiError("not_in_room");
    const answer = ctx.body.answer;
    if (answer !== "let_in" && answer !== "not_now") throw invalid({ answer: "Answer let_in or not_now." });
    const now = nowMs();
    const status = knockStatus(knock.status, knock.expires_at, now);
    if (status === "expired") throw new ApiError("knock_expired");
    if (status !== "waiting") throw new ApiError("knock_answered");
    await db.query("UPDATE knocks SET status = $2 WHERE id = $1", [knock.id, answer]);
    const decided: KnockRow = { ...knock, status: answer };
    await emitKnock(db, decided, now);
    if (answer === "let_in") await enterRoom(db, viewer.workspaceId, knock.person_id, knock.room_id);
    return { status: 200, body: knockJson(decided, await zoneOf(db, viewer.workspaceId), now) };
  });
});
