import { api } from './api.js';
import { onStreamEvent } from './stream.js';
import type { Floor, Room } from '../shared/types.js';

type Listener = (floor: Floor) => void;

let floor: Floor | null = null;
const listeners = new Set<Listener>();
let started = false;

export function currentFloor(): Floor | null {
  return floor;
}

export function onFloorChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(): void {
  if (floor === null) return;
  for (const listener of [...listeners]) listener(floor);
}

export function setFloor(next: Floor): void {
  floor = next;
  publish();
}

export async function loadFloor(): Promise<void> {
  const next = await api<Floor>('GET', '/api/floor').catch(() => null);
  if (next !== null) setFloor(next);
}

/** One shared floor, kept current by room and presence events. */
export function startFloorWatch(personId: string): void {
  if (started) return;
  started = true;
  void loadFloor();
  onStreamEvent((event) => {
    if (event.name === 'room') {
      const room = event.data as unknown as Room;
      if (floor === null) {
        void loadFloor();
        return;
      }
      const rooms = floor.rooms.map((entry) => (entry.id === room.id ? room : entry));
      const inside = rooms.find((entry) => entry.occupants.some((person) => person.person_id === personId));
      floor = { rooms, me: { room_id: inside?.id ?? null, status: floor.me.status } };
      publish();
      return;
    }
    if (event.name === 'presence') {
      if (floor === null) return;
      const changed = String(event.data.person_id);
      const status: 'active' | 'away' = event.data.status === 'away' ? 'away' : 'active';
      const rooms = floor.rooms.map((room) => ({
        ...room,
        occupants: room.occupants.map((person) =>
          person.person_id === changed ? { ...person, status } : person,
        ),
      }));
      floor = {
        rooms,
        me: { room_id: floor.me.room_id, status: changed === personId ? status : floor.me.status },
      };
      publish();
      return;
    }
    if (event.name === 'reset') void loadFloor();
  });
}
