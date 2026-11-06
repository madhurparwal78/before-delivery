import {
  formatInstant,
  householdDayOf,
  HOUSEHOLD_ZONE,
  offsetLabelAt,
} from './domain/time';
import { guestWindows, ownersAt, type OwnerContext } from './domain/owner';
import { loadGuestScenes, loadRooms, loadSchedules, loadScenes } from './repo';
import { hubNow } from './services/hubClock';
import { serviceHealth } from './services/health';
import type { StatusBody } from './shared/types';

export async function loadOwnerContext(): Promise<OwnerContext> {
  const [rooms, schedules, guests] = await Promise.all([
    loadRooms(),
    loadSchedules(),
    loadGuestScenes(),
  ]);
  return { rooms, schedules, guests: guestWindows(guests) };
}

export async function buildStatus(): Promise<StatusBody> {
  const now = hubNow();
  const [context, scenes] = await Promise.all([loadOwnerContext(), loadScenes()]);
  const owners = ownersAt(context, now);
  return {
    now: formatInstant(now),
    day: householdDayOf(now),
    zone: HOUSEHOLD_ZONE,
    offset: offsetLabelAt(now),
    rooms: context.rooms.map((room) => {
      const owner = owners.get(room.id);
      if (!owner) throw new Error(`No owner computed for ${room.id}`);
      const scene = scenes.find((candidate) => candidate.id === owner.scene_id);
      return {
        room_id: room.id,
        name: room.name,
        scene_id: owner.scene_id,
        scene_name: scene ? scene.name : null,
        since: owner.since ? formatInstant(owner.since) : null,
        source: owner.source,
        guest_scene_id: owner.guest_scene_id,
      };
    }),
    services: serviceHealth(),
  };
}
