/**
 * The room owner rule, the schedule-for-a-day rule and the plan projection
 * are decided here and nowhere else.
 */

import type { GuestSceneRow, RoomRow, ScheduleRow, VersionRow } from '../repo';
import type { OwnerSource, PlanChange, PlanChangeSource } from '../shared/types';
import {
  addDays,
  dayEnd,
  dayStart,
  formatInstant,
  formatLocalWall,
  householdDayOf,
  offsetLabelAt,
  slotOccurrence,
  weekdayIndexOf,
  type HouseholdDay,
} from './time';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** How far back the owner rule looks for the last slot occurrence covering a room. */
const LOOKBACK_DAYS = 7;

export interface GuestWindow {
  id: string;
  room_id: string;
  scene_id: string;
  start: Date;
  end: Date;
}

/**
 * A guest scene holds its room over [start, effective end). The effective end is its
 * end instant, brought forward if it was cancelled before then.
 */
export function guestWindows(rows: readonly GuestSceneRow[]): GuestWindow[] {
  return rows.map((row) => {
    const cancelled = row.cancelled_at;
    const end =
      cancelled && cancelled.getTime() < row.ends_at.getTime() ? cancelled : row.ends_at;
    return {
      id: row.id,
      room_id: row.room_id,
      scene_id: row.scene_id,
      start: row.starts_at,
      end,
    };
  });
}

export interface OwnerContext {
  rooms: readonly RoomRow[];
  schedules: readonly ScheduleRow[];
  guests: readonly GuestWindow[];
}

export function scheduleForDay(
  schedules: readonly ScheduleRow[],
  day: HouseholdDay,
): ScheduleRow {
  const key = WEEKDAY_KEYS[weekdayIndexOf(day)] as string;
  const schedule = schedules.find((candidate) => candidate.days.includes(key));
  if (!schedule) throw new Error(`No schedule owns ${day}`);
  return schedule;
}

/** The version with the latest from date on or before the day. */
export function versionForDay(schedule: ScheduleRow, day: HouseholdDay): VersionRow | null {
  let chosen: VersionRow | null = null;
  for (const version of schedule.versions) {
    if (version.from_date <= day && (!chosen || version.from_date > chosen.from_date)) {
      chosen = version;
    }
  }
  return chosen;
}

export interface Occurrence {
  at: Date;
  schedule_id: string;
  version_from: HouseholdDay;
  slot_id: string;
  slot_time: string;
  scene_id: string;
  room_ids: string[];
}

/** Every slot occurrence of the household day, in the order they happen. */
export function occurrencesOnDay(
  schedules: readonly ScheduleRow[],
  day: HouseholdDay,
): Occurrence[] {
  const schedule = scheduleForDay(schedules, day);
  const version = versionForDay(schedule, day);
  if (!version) return [];
  return version.slots
    .map((slot) => {
      const occurrence = slotOccurrence(day, slot.slot_time);
      return {
        at: occurrence.at,
        schedule_id: schedule.id,
        version_from: version.from_date,
        slot_id: slot.id,
        slot_time: occurrence.slotTime,
        scene_id: slot.scene_id,
        room_ids: slot.room_ids,
      };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.slot_id.localeCompare(b.slot_id));
}

export interface RoomOwner {
  scene_id: string | null;
  since: Date | null;
  source: OwnerSource;
  guest_scene_id: string | null;
}

export const UNPLANNED: RoomOwner = {
  scene_id: null,
  since: null,
  source: 'none',
  guest_scene_id: null,
};

function guestHolding(
  guests: readonly GuestWindow[],
  roomId: string,
  at: Date,
): GuestWindow | null {
  const time = at.getTime();
  let found: GuestWindow | null = null;
  for (const window of guests) {
    if (
      window.room_id === roomId &&
      window.start.getTime() <= time &&
      time < window.end.getTime() &&
      (!found || window.start.getTime() > found.start.getTime())
    ) {
      found = window;
    }
  }
  return found;
}

/** The scene that owns a room at an instant. */
export function ownerAt(context: OwnerContext, roomId: string, at: Date): RoomOwner {
  const guest = guestHolding(context.guests, roomId, at);
  if (guest) {
    return {
      scene_id: guest.scene_id,
      since: guest.start,
      source: 'guest',
      guest_scene_id: guest.id,
    };
  }
  let day = householdDayOf(at);
  for (let back = 0; back <= LOOKBACK_DAYS; back += 1) {
    const occurrences = occurrencesOnDay(context.schedules, day).filter(
      (occurrence) =>
        occurrence.at.getTime() <= at.getTime() && occurrence.room_ids.includes(roomId),
    );
    const latest = occurrences[occurrences.length - 1];
    if (latest) {
      return {
        scene_id: latest.scene_id,
        since: latest.at,
        source: 'schedule',
        guest_scene_id: null,
      };
    }
    day = addDays(day, -1);
  }
  return UNPLANNED;
}

export function ownersAt(
  context: OwnerContext,
  at: Date,
): Map<string, RoomOwner> {
  const owners = new Map<string, RoomOwner>();
  for (const room of context.rooms) {
    owners.set(room.id, ownerAt(context, room.id, at));
  }
  return owners;
}

const SOURCE_RANK: Record<PlanChangeSource, number> = {
  guest_end: 0,
  schedule: 1,
  guest: 2,
};

/** The day's changes, in the order the house applies them. */
export function planChanges(context: OwnerContext, day: HouseholdDay): PlanChange[] {
  const start = dayStart(day).getTime();
  const end = dayEnd(day).getTime();
  const changes: PlanChange[] = [];

  for (const occurrence of occurrencesOnDay(context.schedules, day)) {
    const roomIds = occurrence.room_ids.filter(
      (roomId) => guestHolding(context.guests, roomId, occurrence.at) === null,
    );
    changes.push({
      at: formatInstant(occurrence.at),
      local: formatLocalWall(occurrence.at),
      offset: offsetLabelAt(occurrence.at),
      source: 'schedule',
      schedule_id: occurrence.schedule_id,
      version_from: occurrence.version_from,
      slot_id: occurrence.slot_id,
      slot_time: occurrence.slot_time,
      guest_scene_id: null,
      scene_id: occurrence.scene_id,
      room_ids: roomIds,
    });
  }

  for (const window of context.guests) {
    const startsIn = window.start.getTime() >= start && window.start.getTime() < end;
    if (startsIn) {
      changes.push({
        at: formatInstant(window.start),
        local: formatLocalWall(window.start),
        offset: offsetLabelAt(window.start),
        source: 'guest',
        schedule_id: null,
        version_from: null,
        slot_id: null,
        slot_time: null,
        guest_scene_id: window.id,
        scene_id: window.scene_id,
        room_ids: [window.room_id],
      });
    }
    const endsIn = window.end.getTime() >= start && window.end.getTime() < end;
    if (endsIn) {
      const owner = ownerAt(context, window.room_id, window.end);
      changes.push({
        at: formatInstant(window.end),
        local: formatLocalWall(window.end),
        offset: offsetLabelAt(window.end),
        source: 'guest_end',
        schedule_id: null,
        version_from: null,
        slot_id: null,
        slot_time: null,
        guest_scene_id: window.id,
        scene_id: owner.scene_id,
        room_ids: [window.room_id],
      });
    }
  }

  return changes.sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at);
    if (byTime !== 0) return byTime;
    return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  });
}

/**
 * The slot occurrences the running hub clock passed in (after, upTo].
 * A clock move is not a pass, so callers only use this for real elapsed time.
 */
export function occurrencesBetween(
  schedules: readonly ScheduleRow[],
  after: Date,
  upTo: Date,
): Occurrence[] {
  const found: Occurrence[] = [];
  let day = householdDayOf(after);
  const lastDay = householdDayOf(upTo);
  for (let guard = 0; guard <= LOOKBACK_DAYS; guard += 1) {
    for (const occurrence of occurrencesOnDay(schedules, day)) {
      if (occurrence.at.getTime() > after.getTime() && occurrence.at.getTime() <= upTo.getTime()) {
        found.push(occurrence);
      }
    }
    if (day === lastDay) break;
    day = addDays(day, 1);
  }
  return found.sort((a, b) => a.at.getTime() - b.at.getTime());
}
