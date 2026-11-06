// Which schedule version owns a day, when each slot occurs, and which scene owns each room.
// The room owner rule and slot occurrence are decided here and nowhere else; the daylight-saving
// arithmetic itself (first pass in a repeated hour, 03:00 in a skipped one) is HouseholdZone.occurrence.

import { addDays, HouseholdZone, parseClock, weekdayOf } from "../shared/zone.ts";
import type { DayPlan, PlanChange, PlanOwner, OwnerSource } from "../shared/types.ts";
import { pool, rows, type Queryable } from "./db.ts";

const DAY_MS = 24 * 3_600_000;
const LOOK_BACK_DAYS = 7;

interface SlotRow {
  id: string;
  time: string;
  scene_id: string;
  room_ids: string[];
}

export interface VersionRow {
  from: string;
  seeded: boolean;
  slots: SlotRow[];
}

export interface ScheduleRow {
  id: string;
  name: string;
  weekdays: number[];
  revision: number;
  versions: VersionRow[]; // ordered by from
}

export interface GuestRow {
  id: string;
  room_id: string;
  scene_id: string;
  starts: number;
  ends: number;
}

export interface RoomRow {
  id: string;
  name: string;
  position: number;
}

/** Everything the owner rule needs, read from PostgreSQL in one go. */
export interface Calendar {
  zone: HouseholdZone;
  rooms: RoomRow[];
  scenes: Map<string, string>;
  schedules: ScheduleRow[];
  guests: GuestRow[]; // scheduled and active guest scenes only
}

interface Occurrence {
  at: number;
  day: string;
  schedule: ScheduleRow;
  version: VersionRow;
  slot: SlotRow;
}

export interface Owner {
  source: OwnerSource;
  scene_id: string | null;
  since: number | null;
  guest_scene_id: string | null;
}

const NO_OWNER: Owner = { source: "none", scene_id: null, since: null, guest_scene_id: null };

let zoneCache: HouseholdZone | null = null;

export async function householdZone(db: Queryable = pool): Promise<HouseholdZone> {
  if (!zoneCache) {
    const [household] = await rows<{ zone: string }>(db, "SELECT zone FROM household");
    zoneCache = new HouseholdZone((household as { zone: string }).zone);
  }
  return zoneCache;
}

export async function loadSchedules(db: Queryable = pool): Promise<ScheduleRow[]> {
  const schedules = await rows<Omit<ScheduleRow, "versions">>(
    db, "SELECT id, name, weekdays, revision FROM schedules ORDER BY position",
  );
  const versions = await rows<{ schedule_id: string; from: string; seeded: boolean }>(
    db, "SELECT schedule_id, from_date AS from, seeded FROM schedule_versions ORDER BY from_date",
  );
  const slots = await rows<SlotRow & { schedule_id: string; from: string }>(
    db, "SELECT id, schedule_id, from_date AS from, time, scene_id, room_ids FROM slots ORDER BY time, position",
  );
  return schedules.map((schedule) => ({
    ...schedule,
    versions: versions
      .filter((version) => version.schedule_id === schedule.id)
      .map((version) => ({
        from: version.from,
        seeded: version.seeded,
        slots: slots
          .filter((slot) => slot.schedule_id === schedule.id && slot.from === version.from)
          .map(({ id, time, scene_id, room_ids }) => ({ id, time, scene_id, room_ids })),
      })),
  }));
}

export async function loadCalendar(db: Queryable = pool): Promise<Calendar> {
  const zone = await householdZone(db);
  const [rooms, scenes, schedules, guests] = await Promise.all([
    rows<RoomRow>(db, "SELECT id, name, position FROM rooms ORDER BY position"),
    rows<{ id: string; name: string }>(db, "SELECT id, name FROM scenes ORDER BY position"),
    loadSchedules(db),
    rows<{ id: string; room_id: string; scene_id: string; starts: Date; ends: Date }>(
      db,
      "SELECT id, room_id, scene_id, starts_at AS starts, ends_at AS ends FROM guest_scenes WHERE state IN ('scheduled', 'active')",
    ),
  ]);
  return {
    zone,
    rooms,
    scenes: new Map(scenes.map((scene) => [scene.id, scene.name])),
    schedules,
    guests: guests.map((guest) => ({ ...guest, starts: guest.starts.getTime(), ends: guest.ends.getTime() })),
  };
}

/** The schedule that runs on a household day (Weekday Monday to Friday, Weekend Saturday and Sunday). */
function scheduleForDay(calendar: Calendar, day: string): ScheduleRow {
  const weekday = weekdayOf(day);
  const schedule = calendar.schedules.find((candidate) => candidate.weekdays.includes(weekday));
  if (!schedule) throw new Error(`no schedule runs on weekday ${weekday}`);
  return schedule;
}

/** The version with the latest from date on or before the day. */
function versionForDay(schedule: ScheduleRow, day: string): VersionRow | null {
  let found: VersionRow | null = null;
  for (const version of schedule.versions) if (version.from <= day) found = version;
  return found;
}

/** When a slot's wall time happens on a day: first pass in a repeated hour, 03:00 in a skipped one. */
function slotInstant(zone: HouseholdZone, day: string, time: string): number {
  const [hour, minute] = parseClock(time) as [number, number];
  return zone.occurrence(day, hour, minute);
}

/** Each slot occurrence of a household day, in time order. */
function occurrencesOnDay(calendar: Calendar, day: string): Occurrence[] {
  const schedule = scheduleForDay(calendar, day);
  const version = versionForDay(schedule, day);
  if (!version) return [];
  return version.slots
    .map((slot) => ({ at: slotInstant(calendar.zone, day, slot.time), day, schedule, version, slot }))
    .sort((a, b) => a.at - b.at);
}

/** Slot occurrences with after < at <= upTo. */
export function occurrencesBetween(calendar: Calendar, after: number, upTo: number): Occurrence[] {
  const found: Occurrence[] = [];
  const last = calendar.zone.day(upTo);
  for (let day = calendar.zone.day(after); day <= last; day = addDays(day, 1)) {
    for (const occurrence of occurrencesOnDay(calendar, day)) {
      if (occurrence.at > after && occurrence.at <= upTo) found.push(occurrence);
    }
  }
  return found;
}

/** The guest scene holding a room at an instant: starts_at <= t < ends_at. */
function guestAt(calendar: Calendar, roomId: string, at: number): GuestRow | null {
  return calendar.guests.find((guest) => guest.room_id === roomId && guest.starts <= at && at < guest.ends) ?? null;
}

/** The scene each room's schedule gives it at an instant (latest occurrence at or before, up to seven days back). */
function scheduledOwners(calendar: Calendar, at: number): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  const today = calendar.zone.day(at);
  for (let back = LOOK_BACK_DAYS; back >= 0; back -= 1) {
    for (const occurrence of occurrencesOnDay(calendar, addDays(today, -back))) {
      if (occurrence.at > at || occurrence.at < at - LOOK_BACK_DAYS * DAY_MS) continue;
      for (const roomId of occurrence.slot.room_ids) {
        owners.set(roomId, {
          source: "schedule",
          scene_id: occurrence.slot.scene_id,
          since: occurrence.at,
          guest_scene_id: null,
        });
      }
    }
  }
  return owners;
}

/** The room owner rule: an active guest scene, else the latest slot occurrence, else Unplanned. */
export function ownersAt(calendar: Calendar, at: number): Map<string, Owner> {
  const scheduled = scheduledOwners(calendar, at);
  const owners = new Map<string, Owner>();
  for (const room of calendar.rooms) {
    const guest = guestAt(calendar, room.id, at);
    owners.set(
      room.id,
      guest
        ? { source: "guest", scene_id: guest.scene_id, since: guest.starts, guest_scene_id: guest.id }
        : (scheduled.get(room.id) ?? NO_OWNER),
    );
  }
  return owners;
}

/** The scene a room's schedule alone gives it at an instant (ignoring guest scenes). */
export function scheduledOwnerAt(calendar: Calendar, roomId: string, at: number): Owner {
  return scheduledOwners(calendar, at).get(roomId) ?? NO_OWNER;
}

function planOwner(zone: HouseholdZone, roomId: string, owner: Owner): PlanOwner {
  return {
    room_id: roomId,
    scene_id: owner.scene_id,
    since: owner.since === null ? null : zone.iso(owner.since),
    source: owner.source,
    guest_scene_id: owner.guest_scene_id,
  };
}

/** GET /api/plan: the household day's length, start owners and every change. */
export function dayPlan(calendar: Calendar, day: string): DayPlan {
  const { zone } = calendar;
  const start = zone.dayStart(day);
  const end = zone.dayEnd(day);
  const before = ownersAt(calendar, start - 1);
  const change = (at: number, fields: Omit<PlanChange, "at" | "local" | "offset">): PlanChange => ({
    at: zone.iso(at),
    local: zone.iso(at).slice(0, 19),
    offset: zone.offsetText(at),
    ...fields,
  });
  const timed: { at: number; change: PlanChange }[] = [];
  for (const occurrence of occurrencesOnDay(calendar, day)) {
    timed.push({
      at: occurrence.at,
      change: change(occurrence.at, {
        source: "schedule",
        schedule_id: occurrence.schedule.id,
        version_from: occurrence.version.from,
        slot_id: occurrence.slot.id,
        slot_time: occurrence.slot.time,
        guest_scene_id: null,
        scene_id: occurrence.slot.scene_id,
        room_ids: occurrence.slot.room_ids.filter((roomId) => !guestAt(calendar, roomId, occurrence.at)),
      }),
    });
  }
  for (const guest of calendar.guests) {
    const guestFields = { schedule_id: null, version_from: null, slot_id: null, slot_time: null, guest_scene_id: guest.id };
    if (guest.starts >= start && guest.starts < end) {
      timed.push({
        at: guest.starts,
        change: change(guest.starts, { ...guestFields, source: "guest", scene_id: guest.scene_id, room_ids: [guest.room_id] }),
      });
    }
    if (guest.ends >= start && guest.ends < end) {
      const after = ownersAt(calendar, guest.ends).get(guest.room_id) ?? NO_OWNER;
      timed.push({
        at: guest.ends,
        change: change(guest.ends, { ...guestFields, source: "guest_end", scene_id: after.scene_id, room_ids: [guest.room_id] }),
      });
    }
  }
  timed.sort((a, b) => a.at - b.at);
  return {
    day,
    schedule_id: scheduleForDay(calendar, day).id,
    hours: Math.round((end - start) / 3_600_000),
    start: zone.iso(start),
    end: zone.iso(end),
    hour_marks: zone.hourMarks(day).map((mark) => ({ at: zone.iso(mark.at), label: mark.label, abbr: mark.abbr })),
    rooms: calendar.rooms.map((room) => ({ room_id: room.id, name: room.name, order: room.position })),
    start_owners: calendar.rooms.map((room) => planOwner(zone, room.id, before.get(room.id) ?? NO_OWNER)),
    changes: timed.map((item) => item.change),
  };
}
