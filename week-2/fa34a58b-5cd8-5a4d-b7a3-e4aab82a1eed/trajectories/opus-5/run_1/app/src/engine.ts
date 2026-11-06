import { randomUUID } from 'node:crypto';
import { query } from './db';
import { guestTransitionAt } from './domain/guest';
import {
  occurrencesBetween,
  ownerAt,
  ownersAt,
  type OwnerContext,
  type RoomOwner,
} from './domain/owner';
import {
  guestSceneEndedMessage,
  motionMessage,
  scheduleChangeMessage,
  scheduleChangeNoticeIsDue,
} from './domain/notices';
import {
  loadDevices,
  loadGuestScenes,
  loadRoomOwners,
  loadSchedules,
  loadScenes,
  recordRun,
  saveRoomOwner,
  toDevice,
  toGuestScene,
  writeDeviceState,
  type ClipRow,
  type DeviceRow,
  type GuestSceneRow,
  type SceneRow,
} from './repo';
import { broadcast, publishStatus } from './services/broadcast';
import { hubNow, onClockMove } from './services/hubClock';
import { queueNotice } from './services/outbox';
import { loadOwnerContext } from './status';
import type { LightState, ThermostatState } from './shared/types';

const TICK_INTERVAL_MS = 400;

let lastTickAt = hubNow();
let ticking = false;

/** Applies a scene to a room's online lights and thermostats. Plugs and cameras are untouched. */
async function applySceneToRoom(
  roomId: string,
  scene: SceneRow,
  at: Date,
): Promise<DeviceRow[]> {
  const devices = await loadDevices(roomId);
  const changed: DeviceRow[] = [];
  for (const device of devices) {
    if (!device.online) continue;
    if (device.kind === 'light') {
      const current = device.state as LightState;
      const next: LightState =
        scene.brightness === 0
          ? { on: false, brightness: current.brightness }
          : { on: true, brightness: scene.brightness };
      if (current.on === next.on && current.brightness === next.brightness) continue;
      changed.push(await writeDeviceState(device.id, { state: next }, at));
    } else if (device.kind === 'thermostat' && scene.setpoint_f !== null) {
      const current = device.state as ThermostatState;
      if (current.setpoint_f === scene.setpoint_f) continue;
      const next: ThermostatState = {
        setpoint_f: scene.setpoint_f,
        current_f: current.current_f,
      };
      changed.push(await writeDeviceState(device.id, { state: next }, at));
    }
  }
  return changed;
}

function sameOwner(stored: RoomOwner | undefined, computed: RoomOwner): boolean {
  if (!stored) return false;
  return (
    stored.scene_id === computed.scene_id &&
    stored.source === computed.source &&
    stored.guest_scene_id === computed.guest_scene_id &&
    (stored.since?.getTime() ?? null) === (computed.since?.getTime() ?? null)
  );
}

/**
 * Brings the recorded live owners up to the hub clock, applying each new scene
 * to its room's devices. Returns true when any room changed hands.
 */
export async function reconcileOwners(context?: OwnerContext): Promise<boolean> {
  const at = hubNow();
  const ownerContext = context ?? (await loadOwnerContext());
  const [stored, scenes] = await Promise.all([loadRoomOwners(), loadScenes()]);
  const computed = ownersAt(ownerContext, at);
  let anyChanged = false;

  for (const room of ownerContext.rooms) {
    const next = computed.get(room.id);
    if (!next) continue;
    const previous = stored.find((row) => row.room_id === room.id);
    if (
      sameOwner(
        previous
          ? {
              scene_id: previous.scene_id,
              since: previous.since,
              source: previous.source,
              guest_scene_id: previous.guest_scene_id,
            }
          : undefined,
        next,
      )
    ) {
      continue;
    }
    anyChanged = true;
    await saveRoomOwner(null, {
      room_id: room.id,
      scene_id: next.scene_id,
      source: next.source,
      since: next.since,
      guest_scene_id: next.guest_scene_id,
    });
    const scene = scenes.find((candidate) => candidate.id === next.scene_id);
    if (scene) {
      for (const device of await applySceneToRoom(room.id, scene, at)) {
        broadcast({ type: 'device', device: toDevice(device) });
      }
    }
  }

  if (anyChanged) await publishStatus();
  return anyChanged;
}

/** One run per slot occurrence the running clock passes, never a second one. */
async function recordRunsPassed(previous: Date, now: Date): Promise<void> {
  if (now.getTime() <= previous.getTime()) return;
  const schedules = await loadSchedules();
  for (const occurrence of occurrencesBetween(schedules, previous, now)) {
    await recordRun({
      id: randomUUID(),
      schedule_id: occurrence.schedule_id,
      version_from: occurrence.version_from,
      slot_id: occurrence.slot_id,
      slot_time: occurrence.slot_time,
      ran_at: occurrence.at,
      scene_id: occurrence.scene_id,
      room_ids: occurrence.room_ids,
    });
  }
}

async function scheduledSceneNameFor(
  context: OwnerContext,
  scenes: readonly SceneRow[],
  guest: GuestSceneRow,
): Promise<string> {
  const withoutThisGuest: OwnerContext = {
    ...context,
    guests: context.guests.filter((window) => window.id !== guest.id),
  };
  const owner = ownerAt(withoutThisGuest, guest.room_id, guest.ends_at);
  const scene = scenes.find((candidate) => candidate.id === owner.scene_id);
  return scene ? scene.name : 'Unplanned';
}

async function advanceGuestScenes(now: Date): Promise<void> {
  const rows = await loadGuestScenes();
  const pending = rows.filter((row) => guestTransitionAt(row, now) !== null);
  if (pending.length === 0) return;
  const [context, scenes] = await Promise.all([loadOwnerContext(), loadScenes()]);

  for (const row of pending) {
    const next = guestTransitionAt(row, now);
    if (next === 'active') {
      const updated = await query<GuestSceneRow>(
        `update guest_scenes set state = 'active' where id = $1 and state = 'scheduled'
         returning id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at`,
        [row.id],
      );
      const after = updated[0];
      if (after) broadcast({ type: 'guest_scene', guest_scene: toGuestScene(after) });
      continue;
    }
    const updated = await query<GuestSceneRow>(
      `update guest_scenes set state = 'ended', ended_at = $2
       where id = $1 and state in ('scheduled', 'active')
       returning id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at`,
      [row.id, now],
    );
    const after = updated[0];
    if (!after) continue;
    broadcast({ type: 'guest_scene', guest_scene: toGuestScene(after) });
    const room = context.rooms.find((candidate) => candidate.id === row.room_id);
    const scene = scenes.find((candidate) => candidate.id === row.scene_id);
    if (!room || !scene) continue;
    const message = guestSceneEndedMessage({
      roomName: room.name,
      sceneName: scene.name,
      endsAt: row.ends_at,
      scheduledSceneName: await scheduledSceneNameFor(context, scenes, row),
    });
    await queueNotice({ kind: 'guest_scene_ended', ...message });
  }
}

/** Queues the schedule-change notice of every saved version the hub clock has reached. */
export async function queueDueScheduleNotices(now: Date): Promise<void> {
  const [schedules, scenes, context] = await Promise.all([
    loadSchedules(),
    loadScenes(),
    loadOwnerContext(),
  ]);
  const due: { scheduleId: string; scheduleName: string; from: string }[] = [];
  for (const schedule of schedules) {
    for (const version of schedule.versions) {
      if (version.seeded) continue;
      if (!scheduleChangeNoticeIsDue(version.from_date, now)) continue;
      due.push({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        from: version.from_date,
      });
    }
  }
  due.sort((a, b) => a.from.localeCompare(b.from));

  for (const entry of due) {
    const schedule = schedules.find((candidate) => candidate.id === entry.scheduleId);
    const version = schedule?.versions.find((candidate) => candidate.from_date === entry.from);
    if (!schedule || !version) continue;
    const message = scheduleChangeMessage({
      scheduleName: schedule.name,
      from: entry.from,
      slots: version.slots.map((slot) => ({
        time: slot.slot_time,
        sceneName: scenes.find((scene) => scene.id === slot.scene_id)?.name ?? slot.scene_id,
        roomNames: slot.room_ids.map(
          (roomId) => context.rooms.find((room) => room.id === roomId)?.name ?? roomId,
        ),
      })),
    });
    await queueNotice({
      kind: 'schedule_change',
      ...message,
      scheduleId: schedule.id,
      fromDate: entry.from,
    });
  }
}

export async function queueMotionNotice(clip: ClipRow): Promise<void> {
  if (clip.stored_size === null) return;
  await queueNotice({
    kind: 'motion',
    ...motionMessage({
      cameraName: clip.camera_name,
      recordedAt: clip.recorded_at,
      storedSize: Number(clip.stored_size),
    }),
  });
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = hubNow();
    await recordRunsPassed(lastTickAt, now);
    lastTickAt = now;
    await advanceGuestScenes(now);
    await queueDueScheduleNotices(now);
    await reconcileOwners();
  } finally {
    ticking = false;
  }
}

export async function startEngine(): Promise<void> {
  lastTickAt = hubNow();
  await reconcileOwners();
  onClockMove((_previous, next) => {
    lastTickAt = next;
    void (async () => {
      await advanceGuestScenes(next);
      await queueDueScheduleNotices(next);
      await reconcileOwners();
      await publishStatus();
    })();
  });
  setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS).unref();
}
