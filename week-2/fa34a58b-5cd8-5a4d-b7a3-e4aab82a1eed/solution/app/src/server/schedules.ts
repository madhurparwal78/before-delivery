// Schedules and their effective-dated versions. The revision check is decided here and nowhere else.

import { randomUUID } from "node:crypto";
import { daysBetween, parseClock, parseDate } from "../shared/zone.ts";
import type { Schedule } from "../shared/types.ts";
import { pool, rows, transaction } from "./db.ts";
import { ApiError, FIELD, FieldErrors } from "./errors.ts";
import { hubNow } from "./clock.ts";
import { householdZone, loadSchedules, type ScheduleRow } from "./plan.ts";

const MAX_SLOTS = 48;
const MAX_FROM_DAYS = 366;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    days: row.weekdays.map((weekday) => DAY_NAMES[weekday] as string),
    revision: row.revision,
    versions: row.versions.map((version) => ({ from: version.from, slots: version.slots })),
  };
}

export async function listSchedules(): Promise<Schedule[]> {
  return (await loadSchedules()).map(toSchedule);
}

export async function scheduleById(id: string): Promise<Schedule | null> {
  const found = (await loadSchedules()).find((schedule) => schedule.id === id);
  return found ? toSchedule(found) : null;
}

interface SlotInput {
  time: string;
  scene_id: string;
  room_ids: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function validate(request: Record<string, unknown>, today: string, errors: FieldErrors): Promise<{ from: string; slots: SlotInput[] }> {
  const from = parseDate(request.from);
  if (!from) errors.add("from", FIELD.fromFormat);
  else if (from < today) errors.add("from", FIELD.fromPast);
  else if (daysBetween(today, from) > MAX_FROM_DAYS) errors.add("from", FIELD.fromFar);

  const sceneIds = new Set((await rows<{ id: string }>(pool, "SELECT id FROM scenes")).map((scene) => scene.id));
  const roomIds = new Set((await rows<{ id: string }>(pool, "SELECT id FROM rooms")).map((room) => room.id));
  const slots: SlotInput[] = [];
  if (!Array.isArray(request.slots) || request.slots.length < 1 || request.slots.length > MAX_SLOTS) {
    errors.add("slots", FIELD.slots);
  } else {
    const taken = new Map<string, Set<string>>();
    request.slots.forEach((raw: unknown, index: number) => {
      const slot = isObject(raw) ? raw : {};
      const time = parseClock(slot.time) ? (slot.time as string) : null;
      if (!time) errors.add(`slots.${index}.time`, FIELD.slotTime);
      const sceneId = typeof slot.scene_id === "string" && sceneIds.has(slot.scene_id) ? slot.scene_id : null;
      if (!sceneId) errors.add(`slots.${index}.scene_id`, FIELD.chooseScene);
      const rooms = Array.isArray(slot.room_ids) ? (slot.room_ids as unknown[]) : [];
      const valid = rooms.length > 0 && rooms.every((room) => typeof room === "string" && roomIds.has(room))
        && new Set(rooms).size === rooms.length;
      if (!valid) errors.add(`slots.${index}.room_ids`, FIELD.slotRooms);
      if (time && valid) {
        const atTime = taken.get(time) ?? new Set<string>();
        if ((rooms as string[]).some((room) => atTime.has(room))) errors.add(`slots.${index}.time`, FIELD.slotShared);
        for (const room of rooms as string[]) atTime.add(room);
        taken.set(time, atTime);
      }
      if (time && sceneId && valid) slots.push({ time, scene_id: sceneId, room_ids: rooms as string[] });
    });
  }
  errors.throwIfAny();
  return { from: from as string, slots: slots.sort((a, b) => a.time.localeCompare(b.time)) };
}

/**
 * PUT /api/schedules/{id}: creates or replaces the version for its from date, but only when the
 * revision the editor read is still current. The schedule row is locked, the revision compared and the
 * version written in one transaction, so of concurrent saves with the same revision exactly one wins.
 */
export async function saveSchedule(id: string, body: unknown): Promise<{ schedule: Schedule; from: string }> {
  const zone = await householdZone();
  const from = await transaction(async (client) => {
    const [current] = await rows<{ revision: number }>(client, "SELECT revision FROM schedules WHERE id = $1 FOR UPDATE", [id]);
    if (!current) throw ApiError.of("not_found");
    const request = isObject(body) ? body : {};
    const revision = request.revision;
    const revisionIsWhole = typeof revision === "number" && Number.isInteger(revision);
    if (revisionIsWhole && revision !== current.revision) throw ApiError.of("schedule_changed");
    const errors = new FieldErrors();
    if (!revisionIsWhole) errors.add("revision", FIELD.revision);
    const input = await validate(request, zone.day(hubNow()), errors);
    await client.query("UPDATE schedules SET revision = revision + 1 WHERE id = $1", [id]);
    await client.query("DELETE FROM schedule_versions WHERE schedule_id = $1 AND from_date = $2", [id, input.from]);
    await client.query("INSERT INTO schedule_versions (schedule_id, from_date, seeded) VALUES ($1, $2, false)", [id, input.from]);
    for (const [position, slot] of input.slots.entries()) {
      await client.query(
        "INSERT INTO slots (id, schedule_id, from_date, time, scene_id, room_ids, position) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [randomUUID(), id, input.from, slot.time, slot.scene_id, slot.room_ids, position + 1],
      );
    }
    return input.from;
  });
  const schedule = (await loadSchedules()).find((candidate) => candidate.id === id);
  if (!schedule) throw ApiError.of("not_found");
  return { schedule: toSchedule(schedule), from };
}
