// The hub's running clock: records runs, moves guest scenes, queues schedule-change notices, and
// applies a room's scene to its devices whenever its live owner changes. All work is serialised.

import { randomUUID } from "node:crypto";
import type { Scene } from "../shared/types.ts";
import { pool, rows } from "./db.ts";
import { hubNow, setHubClock } from "./clock.ts";
import { loadCalendar, occurrencesBetween, ownersAt, type Calendar, type Owner } from "./plan.ts";
import { advanceGuestScenes } from "./guests.ts";
import { queueScheduleChangeSaved, queueScheduleChangesJumped, queueScheduleChangesReached } from "./notices.ts";
import { applyScene } from "./devices.ts";
import { broadcastStatus } from "./status.ts";

const TICK_MS = 250;

let lastTick = 0;
let liveOwners: Map<string, string> | null = null;
let queue: Promise<void> = Promise.resolve();

function serial(work: () => Promise<void>): Promise<void> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const ownerKey = (owner: Owner): string => `${owner.source}|${owner.scene_id}|${owner.since}|${owner.guest_scene_id}`;

/** Compares each room's live owner with the last one applied; changed rooms get their scene applied. */
async function applyOwnerChanges(now: number): Promise<void> {
  const calendar = await loadCalendar();
  const owners = ownersAt(calendar, now);
  const previous = liveOwners;
  liveOwners = new Map([...owners].map(([roomId, owner]) => [roomId, ownerKey(owner)]));
  if (previous === null) return;
  const changed = [...owners].filter(([roomId, owner]) => previous.get(roomId) !== ownerKey(owner));
  if (changed.length === 0) return;
  await broadcastStatus();
  const scenes = new Map(
    (await rows<Scene>(pool, "SELECT id, name, tint, brightness, setpoint_f FROM scenes")).map((scene) => [scene.id, scene]),
  );
  for (const [roomId, owner] of changed) {
    const scene = owner.scene_id === null ? undefined : scenes.get(owner.scene_id);
    if (scene) await applyScene(roomId, scene);
  }
}

async function recordRuns(calendar: Calendar, after: number, upTo: number, ranAt: number): Promise<void> {
  for (const occurrence of occurrencesBetween(calendar, after, upTo)) {
    await pool.query(
      `INSERT INTO runs (id, schedule_id, version_from, slot_id, slot_time, occurrence_day, ran_day, ran_at, scene_id, room_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (schedule_id, version_from, slot_id, occurrence_day) DO NOTHING`,
      [randomUUID(), occurrence.schedule.id, occurrence.version.from, occurrence.slot.id, occurrence.slot.time,
        occurrence.day, calendar.zone.day(ranAt), new Date(ranAt), occurrence.slot.scene_id, occurrence.slot.room_ids],
    );
  }
}

/** One step of the running clock from the last tick to now. */
async function tick(): Promise<void> {
  const now = hubNow();
  if (now <= lastTick) return;
  const after = lastTick;
  const calendar = await loadCalendar();
  await recordRuns(calendar, after, now, now);
  await advanceGuestScenes(now);
  await queueScheduleChangesReached(calendar, after, now);
  lastTick = now;
  await applyOwnerChanges(now);
}

/** PUT /api/sim/clock: the clock jumps; occurrences jumped over are not run. */
export function moveClock(target: number): Promise<void> {
  return serial(async () => {
    setHubClock(target);
    const now = hubNow();
    await advanceGuestScenes(now);
    await queueScheduleChangesJumped(await loadCalendar(), now);
    lastTick = now;
    await applyOwnerChanges(now);
    await broadcastStatus();
  });
}

/** After a guest scene or schedule change: apply any owner change right away. */
export function settle(): Promise<void> {
  return serial(() => applyOwnerChanges(hubNow()));
}

/** After a schedule save: a save on its from date at or after 05:00 queues its notice at once. */
export function scheduleSaved(scheduleId: string, from: string): Promise<void> {
  return serial(async () => {
    const now = hubNow();
    await queueScheduleChangeSaved(await loadCalendar(), scheduleId, from, now);
    await applyOwnerChanges(now);
  });
}

export async function startEngine(): Promise<void> {
  lastTick = hubNow();
  await serial(() => applyOwnerChanges(lastTick));
  setInterval(() => void serial(tick).catch(() => undefined), TICK_MS);
}
