// One place for each domain rule: room owner, slot occurrence, household day,
// guest transitions, schedule versioning. Every caller goes through these.
import { pg } from './db.js';
import { addDays, dayOf, localParts, pad, wallToInstant } from '../domain/time.js';

export interface RoomRec { id: string; name: string; order: number }
export interface SceneRec { id: string; name: string; tint: string; brightness: number; setpoint_f: number | null }
export interface DeviceRec { id: string; name: string; room_id: string; kind: string; online: boolean; state: Record<string, unknown>; revision: number; updated_at: number }
export interface SlotRec { id: string; time: string; scene_id: string; room_ids: string[]; version_from: string }
export interface GuestRec { id: string; room_id: string; scene_id: string; starts_at: number; ends_at: number; state: string; ended_at: number | null; cancelled_at: number | null }

export async function rooms(): Promise<RoomRec[]> {
  const r = await pg.query('SELECT id, name, sort_order AS order FROM rooms ORDER BY sort_order');
  return r.rows as RoomRec[];
}

export async function scenes(): Promise<SceneRec[]> {
  const r = await pg.query('SELECT id, name, tint, brightness, setpoint_f, sort_order FROM scenes ORDER BY sort_order');
  return (r.rows as (SceneRec & { sort_order: number })[]).map((x) => ({ id: x.id, name: x.name, tint: x.tint, brightness: x.brightness, setpoint_f: x.setpoint_f }));
}

export async function devices(roomId?: string): Promise<DeviceRec[]> {
  const r = roomId
    ? await pg.query('SELECT id, name, room_id, kind, online, state, revision, updated_at FROM devices WHERE room_id = $1 ORDER BY id', [roomId])
    : await pg.query('SELECT id, name, room_id, kind, online, state, revision, updated_at FROM devices ORDER BY id');
  return (r.rows as (Omit<DeviceRec, 'updated_at'> & { updated_at: Date })[]).map((x) => ({ ...x, updated_at: x.updated_at.getTime() }));
}

export async function guestScenes(): Promise<GuestRec[]> {
  const r = await pg.query('SELECT id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at FROM guest_scenes ORDER BY starts_at DESC');
  return (r.rows as (Omit<GuestRec, 'starts_at' | 'ends_at' | 'ended_at' | 'cancelled_at'> & { starts_at: Date; ends_at: Date; ended_at: Date | null; cancelled_at: Date | null })[])
    .map((x) => ({ ...x, starts_at: x.starts_at.getTime(), ends_at: x.ends_at.getTime(), ended_at: x.ended_at ? x.ended_at.getTime() : null, cancelled_at: x.cancelled_at ? x.cancelled_at.getTime() : null }));
}

export interface SchedSlot { id: string; time: string; scene_id: string; room_ids: string[] }
export interface ScheduleRec { id: string; name: string; days: string; revision: number; versions: { from: string; slots: SchedSlot[] }[] }

export async function schedule(id: string): Promise<ScheduleRec | null> {
  const s = await pg.query('SELECT id, name, days, revision FROM schedules WHERE id = $1', [id]);
  if (!s.rowCount) return null;
  const v = await pg.query('SELECT from_day FROM schedule_versions WHERE schedule_id = $1 ORDER BY from_day', [id]);
  const versions: { from: string; slots: SchedSlot[] }[] = [];
  for (const vr of v.rows as { from_day: Date }[]) {
    const from = vr.from_day.toISOString().slice(0, 10);
    const sl = await pg.query('SELECT id, time_str, scene_id, room_ids FROM slots WHERE schedule_id = $1 AND from_day = $2 ORDER BY time_str, id', [id, from]);
    versions.push({ from, slots: (sl.rows as { id: string; time_str: string; scene_id: string; room_ids: string[] }[]).map((x) => ({ id: x.id, time: x.time_str, scene_id: x.scene_id, room_ids: x.room_ids })) });
  }
  const row = s.rows[0] as { id: string; name: string; days: string; revision: number };
  return { id: row.id, name: row.name, days: row.days, revision: row.revision, versions };
}

export async function schedules(): Promise<ScheduleRec[]> {
  const ids = await pg.query('SELECT id FROM schedules ORDER BY id');
  const out: ScheduleRec[] = [];
  for (const r of ids.rows as { id: string }[]) {
    const s = await schedule(r.id);
    if (s) out.push(s);
  }
  return out;
}

/** The schedule (weekday or weekend) that owns a household day. */
export function scheduleForDay(day: string, all: ScheduleRec[]): ScheduleRec {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const id = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
  return all.find((s) => s.id === id)!;
}

/** The version of a schedule in force on a household day. */
export function versionForDay(s: ScheduleRec, day: string): SchedSlot[] {
  let chosen = s.versions[0]!;
  for (const v of s.versions) {
    if (v.from <= day) chosen = v;
  }
  return chosen.slots;
}

export interface Occurrence { schedule_id: string; version_from: string; slot_id: string; slot_time: string; scene_id: string; room_ids: string[]; at: number }

/**
 * Every slot occurrence on a household day, resolved by the one rule for
 * daylight-saving changes. A slot in the repeated hour occurs at its first
 * pass; a slot in the skipped hour occurs at the day's 03:00 instant.
 */
export function occurrencesForDay(day: string, sched: ScheduleRec): Occurrence[] {
  const slots = versionForDay(sched, day);
  const out: Occurrence[] = [];
  for (const slot of slots) {
    const [hh, mm] = slot.time.split(':').map(Number);
    const at = wallToInstant(day, hh, mm);
    if (at === 'skipped') {
      const at3 = wallToInstant(day, 3, 0);
      out.push({ schedule_id: sched.id, version_from: versionFromOf(sched, day), slot_id: slot.id, slot_time: slot.time, scene_id: slot.scene_id, room_ids: slot.room_ids, at: at3 as number });
    } else {
      out.push({ schedule_id: sched.id, version_from: versionFromOf(sched, day), slot_id: slot.id, slot_time: slot.time, scene_id: slot.scene_id, room_ids: slot.room_ids, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function versionFromOf(s: ScheduleRec, day: string): string {
  let from = s.versions[0]!.from;
  for (const v of s.versions) {
    if (v.from <= day) from = v.from;
  }
  return from;
}

export interface Owner { scene_id: string | null; since: number; source: 'schedule' | 'guest' | 'none'; guest_scene_id: string | null }

/** The scene owning a room at instant t, and since when. */
export async function ownerOf(roomId: string, t: number): Promise<Owner> {
  // 1. Active guest scene.
  const g = await pg.query(`SELECT id, scene_id, starts_at FROM guest_scenes WHERE room_id = $1 AND state IN ('scheduled','active') AND starts_at <= $2 AND ends_at > $2 ORDER BY starts_at LIMIT 1`, [roomId, new Date(t)]);
  if (g.rowCount) {
    const row = g.rows[0] as { id: string; scene_id: string; starts_at: Date };
    return { scene_id: row.scene_id, since: row.starts_at.getTime(), source: 'guest', guest_scene_id: row.id };
  }
  // 2. Latest slot occurrence at or before t, looking back seven days.
  const lookback = t - 7 * 86_400_000;
  const all = await schedules();
  let best: { occ: Occurrence } | null = null;
  for (let d = dayOf(t); d >= dayOf(lookback) || !best; d = addDays(d, -1)) {
    const sched = scheduleForDay(d, all);
    const occs = occurrencesForDay(d, sched).filter((o) => o.at <= t && o.room_ids.includes(roomId));
    if (occs.length) {
      const last = occs[occs.length - 1]!;
      if (!best || last.at > best.occ.at) best = { occ: last };
    }
    if (d <= dayOf(lookback)) break;
  }
  if (best) {
    return { scene_id: best.occ.scene_id, since: best.occ.at, source: 'schedule', guest_scene_id: null };
  }
  return { scene_id: null, since: 0, source: 'none', guest_scene_id: null };
}

/** Like ownerOf but for every room at once, reusing one schedule read. */
export async function ownersAll(t: number): Promise<Map<string, Owner>> {
  const rs = await rooms();
  const all = await schedules();
  const guests = await pg.query(`SELECT id, room_id, scene_id, starts_at FROM guest_scenes WHERE state IN ('scheduled','active') AND starts_at <= $1 AND ends_at > $1 ORDER BY starts_at`, [new Date(t)]);
  const guestByRoom = new Map<string, { id: string; scene_id: string; starts_at: number }>();
  for (const g of guests.rows as { id: string; room_id: string; scene_id: string; starts_at: Date }[]) {
    const prev = guestByRoom.get(g.room_id);
    if (!prev || g.starts_at.getTime() > prev.starts_at) guestByRoom.set(g.room_id, { id: g.id, scene_id: g.scene_id, starts_at: g.starts_at.getTime() });
  }
  // Collect occurrences once per day for the lookback window.
  const occByRoom = new Map<string, { scene_id: string; at: number }>();
  const lookback = t - 7 * 86_400_000;
  for (let d = dayOf(t); d >= dayOf(lookback) || d === dayOf(t); d = addDays(d, -1)) {
    const sched = scheduleForDay(d, all);
    for (const o of occurrencesForDay(d, sched)) {
      if (o.at > t) continue;
      for (const r of o.room_ids) {
        const prev = occByRoom.get(r);
        if (!prev || o.at > prev.at) occByRoom.set(r, { scene_id: o.scene_id, at: o.at });
      }
    }
    if (d <= dayOf(lookback)) break;
  }
  const map = new Map<string, Owner>();
  for (const r of rs) {
    const g = guestByRoom.get(r.id);
    if (g) {
      map.set(r.id, { scene_id: g.scene_id, since: g.starts_at, source: 'guest', guest_scene_id: g.id });
      continue;
    }
    const occ = occByRoom.get(r.id);
    if (occ) map.set(r.id, { scene_id: occ.scene_id, since: occ.at, source: 'schedule', guest_scene_id: null });
    else map.set(r.id, { scene_id: null, since: 0, source: 'none', guest_scene_id: null });
  }
  return map;
}

/** The one place that decides a guest scene's state transitions. */
export async function guestTransition(id: string, event: 'start' | 'end' | 'cancel', at: number): Promise<GuestRec | null> {
  const cur = await pg.query('SELECT id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at FROM guest_scenes WHERE id = $1', [id]);
  if (!cur.rowCount) return null;
  const row = cur.rows[0] as { id: string; room_id: string; scene_id: string; starts_at: Date; ends_at: Date; state: string; ended_at: Date | null; cancelled_at: Date | null };
  if (event === 'cancel' && (row.state === 'ended' || row.state === 'cancelled')) return null;
  if (event === 'start' && row.state !== 'scheduled') return row as unknown as GuestRec;
  const set = event === 'start' ? `state='active'` : event === 'end' ? `state='ended', ended_at=$2` : `state='cancelled', cancelled_at=$2`;
  await pg.query(`UPDATE guest_scenes SET ${set} WHERE id = $1`, event === 'start' ? [id] : [id, new Date(at)]);
  return guestById(id);
}

export async function guestById(id: string): Promise<GuestRec | null> {
  const r = await pg.query('SELECT id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at FROM guest_scenes WHERE id = $1', [id]);
  if (!r.rowCount) return null;
  const x = r.rows[0] as { id: string; room_id: string; scene_id: string; starts_at: Date; ends_at: Date; state: string; ended_at: Date | null; cancelled_at: Date | null };
  return { id: x.id, room_id: x.room_id, scene_id: x.scene_id, starts_at: x.starts_at.getTime(), ends_at: x.ends_at.getTime(), state: x.state, ended_at: x.ended_at ? x.ended_at.getTime() : null, cancelled_at: x.cancelled_at ? x.cancelled_at.getTime() : null };
}

/** Guests needing a state advance at instant t (start or end). */
export async function guestsDue(t: number): Promise<{ id: string; event: 'start' | 'end' }[]> {
  const r = await pg.query(
    `SELECT id,
            (state = 'scheduled' AND starts_at <= $1::timestamptz) AS due_start,
            (state = 'active' AND ends_at <= $1::timestamptz) AS due_end
     FROM guest_scenes
     WHERE (state = 'scheduled' AND starts_at <= $1::timestamptz)
        OR (state = 'active' AND ends_at <= $1::timestamptz)`,
    [new Date(t)],
  );
  return (r.rows as { id: string; due_start: boolean; due_end: boolean }[]).map((x) => ({ id: x.id, event: x.due_start ? 'start' : 'end' }));
}

/** Scenes-drive-devices: apply a scene to a room's online lights and thermostats. */
export async function applySceneToRoom(roomId: string, scene: SceneRec, now: number): Promise<DeviceRec[]> {
  const changed: DeviceRec[] = [];
  const ds = await devices(roomId);
  for (const d of ds) {
    if (!d.online) continue;
    if (d.kind === 'light') {
      if (scene.brightness === 0) {
        if (d.state.on === true) {
          const upd = await pg.query(`UPDATE devices SET state = jsonb_set(state, '{on}', 'false'), revision = revision + 1, updated_at = $2 WHERE id = $1 RETURNING state, revision, updated_at`, [d.id, new Date(now)]);
          changed.push({ ...d, state: upd.rows[0]!.state, revision: upd.rows[0]!.revision, updated_at: upd.rows[0]!.updated_at.getTime() });
        }
      } else if (d.state.on !== true || d.state.brightness !== scene.brightness) {
        const upd = await pg.query(`UPDATE devices SET state = jsonb_set(jsonb_set(state, '{on}', 'true'), '{brightness}', $3::jsonb), revision = revision + 1, updated_at = $2 WHERE id = $1 RETURNING state, revision, updated_at`, [d.id, new Date(now), String(scene.brightness)]);
        changed.push({ ...d, state: upd.rows[0]!.state, revision: upd.rows[0]!.revision, updated_at: upd.rows[0]!.updated_at.getTime() });
      }
    } else if (d.kind === 'thermostat' && scene.setpoint_f !== null) {
      if (d.state.setpoint_f !== scene.setpoint_f) {
        const upd = await pg.query(`UPDATE devices SET state = jsonb_set(state, '{setpoint_f}', $3::jsonb), revision = revision + 1, updated_at = $2 WHERE id = $1 RETURNING state, revision, updated_at`, [d.id, new Date(now), String(scene.setpoint_f)]);
        changed.push({ ...d, state: upd.rows[0]!.state, revision: upd.rows[0]!.revision, updated_at: upd.rows[0]!.updated_at.getTime() });
      }
    }
  }
  return changed;
}

export function roomName(rs: RoomRec[], id: string): string {
  return rs.find((r) => r.id === id)?.name ?? id;
}

export function sceneName(ss: SceneRec[], id: string | null): string {
  if (id === null) return 'Unplanned';
  return ss.find((s) => s.id === id)?.name ?? 'Unplanned';
}

/** "HH:MM" of an instant. */
export function hhmm(t: number): string {
  const p = localParts(t);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function fmtBytes(n: number): string {
  return String(n);
}
