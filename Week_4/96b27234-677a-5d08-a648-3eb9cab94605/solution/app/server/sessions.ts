import { DIRECTIONS, VISIBILITIES, type Direction, type SessionDetail, type SessionSummary, type Visibility } from "../shared/protocol.js";
import { worldNow } from "./clock.js";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { conflict, invalid, notFound, reply, Router, slowDown, text, whole, type Context, type Reply } from "./http.js";
import { currentVersion, enterSession, leaveSession, nearbyNotes } from "./membership.js";
import { notifySession } from "./notify.js";
import { newId, type Person } from "./people.js";
import { roomState } from "./live.js";
import { layoutOf, readRoom } from "./projection.js";
import { planSit, planStand, planStep, stanceRecord, tileKey, type Stance } from "./room.js";
import { accessFor, hostNameFor, loadSession, mayJoin, openSessions, type SessionRow } from "./sessiondata.js";
import { live, moveTile, positionsKey, run } from "./valkey.js";

async function detailFor(session: SessionRow, person: Person): Promise<SessionDetail & Record<string, unknown>> {
  const access = await accessFor(person);
  const base = {
    id: session.id,
    roomId: session.roomId,
    roomName: session.roomName,
    hostId: session.hostId,
    hostName: hostNameFor(session, person, access),
    visibility: session.visibility,
    capacity: session.capacity,
    count: session.count,
    status: "open" as const,
    communityId: session.communityId,
  };
  if (!access.inside.has(session.id)) return { ...base, roomVersion: await currentVersion(session.roomId) };
  const state = await roomState(session, person.id);
  if (!state) return { ...base, roomVersion: await currentVersion(session.roomId) };
  const { type: _type, ...inside } = state;
  return { ...base, ...inside };
}

async function openable(ctx: Context, person: Person): Promise<SessionRow> {
  const session = await loadSession(ctx.params.id ?? "", person.worldId);
  if (!session || !mayJoin(person, session, await accessFor(person))) throw notFound();
  return session;
}

interface Acting {
  session: SessionRow;
  stance: Stance;
  layout: Awaited<ReturnType<typeof layoutOf>>;
  others: Map<string, Stance>;
  occupied: (x: number, y: number) => boolean;
}

/** The caller's place in a room they are inside: their stance, their version's layout and who holds each tile. */
async function acting(ctx: Context, person: Person, beforeLive?: () => void): Promise<Acting> {
  const session = await loadSession(ctx.params.id ?? "", person.worldId);
  const mine = session
    ? await one<{ room_version: number }>("SELECT room_version FROM session_members WHERE session_id = $1 AND person_id = $2 AND NOT gone", [session.id, person.id])
    : null;
  if (!session || !mine) throw notFound();
  beforeLive?.();
  live();
  const room = await readRoom(session.id);
  const stance = room.stances.get(person.id);
  if (!stance) throw notFound();
  const layout = await layoutOf(session.roomId, mine.room_version);
  return {
    session,
    stance,
    layout,
    others: room.stances,
    occupied: (x, y) => {
      const holder = room.tiles.get(tileKey(x, y));
      return holder !== undefined && holder !== person.id;
    },
  };
}

async function settle(a: Acting, person: Person, next: Stance, to: { x: number; y: number }): Promise<boolean> {
  const moved = await moveTile(a.session.id, person.id, tileKey(a.stance.x, a.stance.y), tileKey(to.x, to.y), stanceRecord(next));
  if (!moved) return false;
  await notifySession(a.session.id, { kind: "state", notes: nearbyNotes(person.id, a.stance, next, a.others) });
  return true;
}

export function sessionRoutes(router: Router<Person>): void {
  router.add("GET", "/api/sessions", async (ctx, person): Promise<Reply> => {
    const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
    const access = await accessFor(person);
    const sessions: SessionSummary[] = (await openSessions(person.worldId))
      .filter((session) => mayJoin(person, session, access))
      .map((session) => ({
        id: session.id,
        roomName: session.roomName,
        hostName: hostNameFor(session, person, access),
        visibility: session.visibility,
        capacity: session.capacity,
        count: session.count,
        status: "open" as const,
      }))
      .filter((summary) => q === "" || summary.roomName.toLowerCase().includes(q) || summary.hostName.toLowerCase().includes(q));
    return reply(200, { sessions, total: sessions.length });
  });

  router.add("POST", "/api/sessions", async (ctx, person): Promise<Reply> => {
    const body = ctx.json();
    const roomId = text(body.roomId) ?? "";
    const room = await one<{ id: string }>(
      "SELECT id FROM assets WHERE id = $1 AND world_id = $2 AND kind = 'room' AND NOT removed AND current_version IS NOT NULL",
      [roomId, person.worldId],
    );
    if (!room) throw notFound();
    const visibility = body.visibility as Visibility;
    const communityId = visibility === "community" ? text(body.communityId) : null;
    if (communityId) {
      const role = await one<{ role: string }>(
        "SELECT m.role FROM community_members m JOIN communities c ON c.id = m.community_id WHERE m.community_id = $1 AND m.person_id = $2 AND c.world_id = $3",
        [communityId, person.id, person.worldId],
      );
      if (!role || role.role === "member") throw notFound();
    }
    const capacity = whole(body.capacity);
    if (capacity === null || capacity < 1 || capacity > config.sessionCapacityMax) {
      throw invalid(`Capacity must be between 1 and ${config.sessionCapacityMax}.`);
    }
    if (!(VISIBILITIES as readonly unknown[]).includes(visibility)) throw invalid("Choose public, friends, community or invite.");
    if (visibility === "community" && !communityId) throw invalid("Choose a community for this session.");
    live();
    const id = newId();
    await query("INSERT INTO sessions (id, world_id, room_id, host_id, visibility, capacity, community_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      person.worldId,
      room.id,
      person.id,
      visibility,
      capacity,
      communityId,
    ]);
    const session = await loadSession(id, person.worldId);
    try {
      await enterSession(person, session as SessionRow);
    } catch (error) {
      await query("DELETE FROM sessions WHERE id = $1", [id]);
      throw error;
    }
    return reply(201, await detailFor((await loadSession(id, person.worldId)) as SessionRow, person));
  });

  router.add("GET", "/api/sessions/:id", async (ctx, person): Promise<Reply> => reply(200, await detailFor(await openable(ctx, person), person)));

  router.add("POST", "/api/sessions/:id/join", async (ctx, person): Promise<Reply> => {
    const session = await openable(ctx, person);
    await enterSession(person, session);
    const fresh = await loadSession(session.id, person.worldId);
    return reply(200, await detailFor(fresh ?? session, person));
  });

  router.add("POST", "/api/sessions/:id/leave", async (ctx, person): Promise<Reply> => {
    const session = await openable(ctx, person);
    live();
    await leaveSession(session.id, person.id);
    return reply(200, { status: "left" });
  });

  router.add("POST", "/api/sessions/:id/invitees", async (ctx, person): Promise<Reply> => {
    const session = await openable(ctx, person);
    if (session.hostId !== person.id) throw notFound();
    const invitee = await one<{ id: string }>("SELECT id FROM people WHERE id = $1 AND world_id = $2", [text(ctx.json().personId) ?? "", person.worldId]);
    if (!invitee) throw notFound();
    await query("INSERT INTO session_invitees (session_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [session.id, invitee.id]);
    return reply(201, { personId: invitee.id });
  });

  router.add("POST", "/api/sessions/:id/step", async (ctx, person): Promise<Reply> => {
    const a = await acting(ctx, person, () => {
      if (!(DIRECTIONS as readonly unknown[]).includes(ctx.json().direction)) throw invalid("Choose north, east, south or west.");
    });
    const direction = ctx.json().direction as Direction;
    const plan = planStep(a.layout, a.stance, direction, a.occupied);
    if (plan.kind === "refused") throw conflict(plan.text);
    const now = (await worldNow(person.worldId)).getTime();
    if (config.stepMinIntervalMs > 0 && a.stance.at > 0 && now - a.stance.at < config.stepMinIntervalMs) throw slowDown();
    if (plan.kind === "exit") {
      await leaveSession(a.session.id, person.id);
      return reply(200, { result: "left", x: plan.x, y: plan.y, facing: direction });
    }
    if (plan.kind === "turn") {
      const next: Stance = { ...a.stance, facing: direction, at: now };
      await run((client) => client.hset(positionsKey(a.session.id), person.id, stanceRecord(next)));
      await notifySession(a.session.id, { kind: "state", notes: [] });
      return reply(200, { result: "turned", x: next.x, y: next.y, facing: next.facing });
    }
    const next: Stance = { ...a.stance, x: plan.x, y: plan.y, at: now };
    if (!(await settle(a, person, next, plan))) throw conflict("Someone is standing there.");
    return reply(200, { result: "moved", x: next.x, y: next.y, facing: next.facing });
  });

  router.add("POST", "/api/sessions/:id/sit", async (ctx, person): Promise<Reply> => {
    const a = await acting(ctx, person);
    const plan = planSit(a.layout, a.stance, a.occupied);
    if (plan.kind === "refused") throw conflict(plan.text);
    const next: Stance = { ...a.stance, x: plan.x, y: plan.y, seated: true, from: { x: a.stance.x, y: a.stance.y } };
    if (!(await settle(a, person, next, plan))) throw conflict("That seat is taken.");
    return reply(200, { result: "seated", x: next.x, y: next.y, facing: next.facing });
  });

  router.add("POST", "/api/sessions/:id/stand", async (ctx, person): Promise<Reply> => {
    const a = await acting(ctx, person);
    const plan = planStand(a.layout, a.stance, a.occupied);
    if (plan.kind === "refused") throw conflict(plan.text);
    const next: Stance = { ...a.stance, x: plan.x, y: plan.y, seated: false, from: null };
    if (!(await settle(a, person, next, plan))) throw conflict("No space to stand.");
    return reply(200, { result: "stood", x: next.x, y: next.y, facing: next.facing });
  });
}

