// The engine ticks once a second: it records runs, advances guest scenes,
// queues and sends notices, and broadcasts changes. All server-decided time
// flows through here; the browser never decides any of it.
import { pg } from './db.js';
import { hubNow, moveClock } from './hubclock.js';
import { SocketHub } from './sockethub.js';
import { dayOf, addDays, isoOf, longDate, offsetAt, localParts, pad, fmtOffset, wallToInstant } from '../domain/time.js';
import * as dom from './domain.js';
import { queueNotice } from './notices.js';
import { storage, mailer } from './services.js';

export interface StatusPayload {
  now: string;
  day: string;
  zone: string;
  offset: string;
  rooms: { room_id: string; name: string; scene_id: string | null; scene_name: string | null; since: string | null; source: 'schedule' | 'guest' | 'none'; guest_scene_id: string | null }[];
  services: { storage: 'up' | 'down'; mail: 'up' | 'down' };
}

export async function statusPayload(): Promise<StatusPayload> {
  const t = hubNow();
  const owners = await dom.ownersAll(t);
  const rs = await dom.rooms();
  const ss = await dom.scenes();
  return {
    now: isoOf(t),
    day: dayOf(t),
    zone: 'America/Chicago',
    offset: fmtOffset(offsetAt(t)),
    rooms: rs.map((r) => {
      const o = owners.get(r.id)!;
      return {
        room_id: r.id,
        name: r.name,
        scene_id: o.scene_id,
        scene_name: o.scene_id === null ? null : dom.sceneName(ss, o.scene_id),
        since: o.source === 'none' ? null : isoOf(o.since),
        source: o.source,
        guest_scene_id: o.guest_scene_id,
      };
    }),
    services: { storage: storage.status(), mail: mailer.status() },
  };
}

export const sockets = new SocketHub();

export async function broadcastStatus(): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'status', ...(await statusPayload()) }));
}

export async function broadcastDevice(device: dom.DeviceRec): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'device', device: serializeDevice(device) }));
}

export function serializeDevice(d: dom.DeviceRec): Record<string, unknown> {
  return { id: d.id, name: d.name, room_id: d.room_id, kind: d.kind, online: d.online, state: d.state, revision: d.revision, updated_at: isoOf(d.updated_at) };
}

export async function broadcastGuestScene(g: dom.GuestRec): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'guest_scene', guest_scene: serializeGuest(g) }));
}

export function serializeGuest(g: dom.GuestRec): Record<string, unknown> {
  return { id: g.id, room_id: g.room_id, scene_id: g.scene_id, starts_at: isoOf(g.starts_at), ends_at: isoOf(g.ends_at), state: g.state, ended_at: g.ended_at === null ? null : isoOf(g.ended_at), cancelled_at: g.cancelled_at === null ? null : isoOf(g.cancelled_at) };
}

export async function broadcastSchedule(id: string, revision: number): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'schedule', schedule_id: id, revision }));
}

export async function broadcastScene(scene: Record<string, unknown>): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'scene', scene }));
}

export async function broadcastClip(clip: Record<string, unknown>): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'clip', clip }));
}

export async function broadcastNotice(notice: Record<string, unknown>): Promise<void> {
  sockets.broadcast(JSON.stringify({ type: 'notice', notice }));
}

/**
 * The tick engine. It records runs, advances guest scenes, queues
 * schedule-change notices, and applies scenes to devices. One tick decides
 * everything; nothing here depends on a browser being open.
 */
export async function tick(): Promise<void> {
  const t = hubNow();
  const prev = lastTick;
  lastTick = t;

  // 1. Advance guest scenes (starts and ends), inclusive.
  const due = await dom.guestsDue(t);
  for (const d of due) {
    const g = await dom.guestById(d.id);
    if (!g) continue;
    if (d.event === 'start' && g.state === 'scheduled') {
      const updated = await dom.guestTransition(d.id, 'start', t);
      if (updated) {
        await broadcastGuestScene(updated);
        await applySceneAndAnnounce(g.room_id, g.scene_id, t);
      }
    } else if (d.event === 'end' && g.state === 'active') {
      const updated = await dom.guestTransition(d.id, 'end', t);
      if (updated) {
        await broadcastGuestScene(updated);
        await queueGuestEndedNotice(updated, t);
        await applySceneAndAnnounce(g.room_id, null, t);
      }
    }
  }

  // 2. Record runs for occurrences crossed since the last tick.
  if (prev !== null) {
    await recordRuns(prev, t);
  }

  // 3. Queue schedule-change notices for effect instants passed.
  if (prev !== null) {
    await queueScheduleNotices(prev, t);
  }

  // 4. Push status when a minute boundary passed, or at least every 15 seconds.
  const realNow = Date.now();
  if (lastMinute !== localParts(t).mi || realNow - lastStatusPushReal >= 15_000) {
    lastMinute = localParts(t).mi;
    lastStatusPushReal = realNow;
    await broadcastStatus();
  }
}

let lastTick: number | null = null;
let lastStatusPushReal = 0;
let lastMinute = -1;

/** Move the hub clock and run one pass of the engine. */
export async function clockMoved(to: number): Promise<void> {
  const from = hubNow();
  moveClock(to);
  lastTick = to;
  // Guests jumped over.
  const due = await dom.guestsDue(to);
  for (const d of due) {
    const g = await dom.guestById(d.id);
    if (!g) continue;
    if (d.event === 'start') {
      const updated = await dom.guestTransition(d.id, 'start', to);
      if (updated) {
        await broadcastGuestScene(updated);
        await applySceneAndAnnounce(g.room_id, g.scene_id, to);
      }
    } else if (d.event === 'end') {
      const updated = await dom.guestTransition(d.id, 'end', to);
      if (updated) {
        await broadcastGuestScene(updated);
        await queueGuestEndedNotice(updated, to);
        await applySceneAndAnnounce(g.room_id, null, to);
      }
    }
  }
  // No runs are recorded for occurrences between the old and new time.
  await queueScheduleNotices(from, to);
  await broadcastStatus();
}

/** Apply the scene owning a room at t, announcing any device change. */
export async function applySceneAndAnnounce(roomId: string, sceneId: string | null, t: number): Promise<void> {
  if (sceneId === null) {
    const owner = await dom.ownerOf(roomId, t);
    sceneId = owner.scene_id;
    if (sceneId === null) return;
  }
  const ss = await dom.scenes();
  const scene = ss.find((s) => s.id === sceneId);
  if (!scene) return;
  const changed = await dom.applySceneToRoom(roomId, scene, t);
  for (const d of changed) await broadcastDevice(d);
}

/** Record one run per occurrence crossed between prev (exclusive) and t (inclusive). */
export async function recordRuns(prev: number, t: number): Promise<void> {
  const crossed = await occurrencesBetween(prev, t);
  for (const occ of crossed) {
    await pg.query(
      `INSERT INTO runs (id, schedule_id, version_from, slot_id, slot_time, ran_at, ran_day, scene_id, room_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (schedule_id, version_from, slot_id, ran_day) DO NOTHING`,
      [`${occ.schedule_id}:${occ.version_from}:${occ.slot_id}:${dayOf(occ.at)}`, occ.schedule_id, occ.version_from, occ.slot_id, occ.slot_time, new Date(occ.at), dayOf(occ.at), occ.scene_id, JSON.stringify(occ.room_ids)],
    );
  }
}

export async function occurrencesBetween(prev: number, t: number): Promise<dom.Occurrence[]> {
  const out: dom.Occurrence[] = [];
  const all = await dom.schedules();
  // Walk each household day touched by the window.
  for (let d = dayOf(prev); d <= dayOf(t); d = addDays(d, 1)) {
    const sched = dom.scheduleForDay(d, all);
    for (const o of dom.occurrencesForDay(d, sched)) {
      if (o.at > prev && o.at <= t) out.push(o);
    }
  }
  return out;
}

/**
 * The one place for schedule-change notice timing. A notice is queued when the
 * running clock reaches the effect instant (05:00 household on the from
 * date), or when a save/clock move lands at or after it. One notice per
 * schedule and from date.
 */
export async function queueScheduleNotices(fromTime: number, toTime: number): Promise<void> {
  if (toTime <= fromTime) return;
  const scheds = await dom.schedules();
  for (const s of scheds) {
    for (const v of s.versions) {
      const effect = effectInstant(v.from);
      if (effect >= fromTime && effect < toTime) {
        await queueScheduleNoticeIfMissing(s, v);
      }
    }
  }
}

export function effectInstant(from: string): number {
  return wallToInstant(from, 5, 0) as number;
}

/**
 * A save whose effect instant (05:00 on its from date) the hub clock has
 * already reached queues its notice at the save itself.
 */
export async function queueScheduleNoticeForSave(scheduleId: string, from: string, now: number): Promise<void> {
  if (now < effectInstant(from)) return;
  const s = await dom.schedule(scheduleId);
  if (!s) return;
  const v = s.versions.find((x) => x.from === from);
  if (v) await queueScheduleNoticeIfMissing(s, v);
}

async function queueScheduleNoticeIfMissing(s: dom.ScheduleRec, v: { from: string; slots: dom.SchedSlot[] }): Promise<void> {
  const key = `schedule_change:${s.id}:${v.from}`;
  const exists = await pg.query('SELECT 1 FROM notice_keys WHERE key = $1', [key]);
  if (exists.rowCount) return;
  const ss = await dom.scenes();
  const rs = await dom.rooms();
  const lines = v.slots.map((slot) => {
    const scene = dom.sceneName(ss, slot.scene_id);
    const names = slot.room_ids.map((r) => dom.roomName(rs, r)).join(', ');
    return `${slot.time} ${scene} — ${names}`;
  }).join('\n');
  const subject = `Schedule change takes effect: ${s.name}`;
  const body = `From ${longDate(v.from)}, the ${s.name} schedule runs these slots:\n${lines}`;
  await queueNotice(key, 'schedule_change', subject, body);
}

/** Queue the guest-ended notice. */
export async function queueGuestEndedNotice(g: dom.GuestRec, t: number): Promise<void> {
  const rs = await dom.rooms();
  const ss = await dom.scenes();
  const owner = await dom.ownerOf(g.room_id, t);
  const subject = `Guest scene ended: ${dom.roomName(rs, g.room_id)}`;
  const body = `The guest scene ${dom.sceneName(ss, g.scene_id)} in ${dom.roomName(rs, g.room_id)} ended at ${hhmm(g.ends_at)} on ${longDate(dayOf(g.ends_at))}. ${dom.roomName(rs, g.room_id)} is back on ${dom.sceneName(ss, owner.scene_id)}.`;
  await queueNotice(`guest_scene_ended:${g.id}`, 'guest_scene_ended', subject, body);
}

function hhmm(t: number): string {
  const p = localParts(t);
  return `${pad(p.h)}:${pad(p.mi)}`;
}
