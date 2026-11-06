// GET /api/status and the socket's status message: hub time, each room's live scene, service health.

import type { Status } from "../shared/types.ts";
import { hubNow } from "./clock.ts";
import { loadCalendar, ownersAt, type Calendar, type Owner } from "./plan.ts";
import { broadcast } from "./socket.ts";

const services: Status["services"] = { storage: "down", mail: "down" };

function statusAt(calendar: Calendar, now: number): Status {
  const { zone } = calendar;
  const owners = ownersAt(calendar, now);
  return {
    now: zone.iso(now),
    day: zone.day(now),
    zone: zone.name,
    offset: zone.offsetText(now),
    rooms: calendar.rooms.map((room) => {
      const owner = owners.get(room.id) as Owner;
      return {
        room_id: room.id,
        name: room.name,
        scene_id: owner.scene_id,
        scene_name: owner.scene_id === null ? null : (calendar.scenes.get(owner.scene_id) ?? null),
        since: owner.since === null ? null : zone.iso(owner.since),
        source: owner.source,
        guest_scene_id: owner.guest_scene_id,
      };
    }),
    services: { ...services },
  };
}

export async function currentStatus(): Promise<Status> {
  return statusAt(await loadCalendar(), hubNow());
}

export async function broadcastStatus(): Promise<void> {
  broadcast({ type: "status", ...(await currentStatus()) });
}

/** Records a service's health and pushes status when it changed. */
export function reportService(name: keyof Status["services"], up: boolean): void {
  const next = up ? "up" : "down";
  if (services[name] === next) return;
  services[name] = next;
  void broadcastStatus().catch(() => undefined);
}
