import { config } from './config.js';
import { publishSprite } from './live.js';

export interface PresencePerson {
  personId: number;
  name: string;
  joinedAt: number;
  connections: number;
  lastActivity: number;
  cursor: { x: number; y: number; frame: number } | null;
}

const rooms = new Map<number, Map<number, PresencePerson>>();
let order = 0;

function room(spriteId: number): Map<number, PresencePerson> {
  const existing = rooms.get(spriteId);
  if (existing !== undefined) return existing;
  const made = new Map<number, PresencePerson>();
  rooms.set(spriteId, made);
  return made;
}

export function presenceList(spriteId: number, businessNow: number): {
  people: { name: string; idle: boolean; cursor: PresencePerson['cursor'] }[];
  visible: number;
} {
  const entries = [...room(spriteId).values()].sort((l, r) => l.joinedAt - r.joinedAt);
  return {
    people: entries.map((entry) => ({
      name: entry.name,
      idle: businessNow - entry.lastActivity >= config.idleSeconds * 1000,
      cursor: entry.cursor,
    })),
    visible: config.presenceVisible,
  };
}

function broadcast(spriteId: number, businessNow: number): void {
  publishSprite(spriteId, { type: 'presence', ...presenceList(spriteId, businessNow) });
}

export function join(
  spriteId: number,
  personId: number,
  name: string,
  businessNow: number,
): { joined: boolean } {
  const people = room(spriteId);
  const existing = people.get(personId);
  if (existing !== undefined) {
    existing.connections += 1;
    existing.lastActivity = businessNow;
    broadcast(spriteId, businessNow);
    return { joined: false };
  }
  order += 1;
  people.set(personId, {
    personId,
    name,
    joinedAt: order,
    connections: 1,
    lastActivity: businessNow,
    cursor: null,
  });
  publishSprite(spriteId, { type: 'team', text: `${name} joined` });
  broadcast(spriteId, businessNow);
  return { joined: true };
}

export function leave(spriteId: number, personId: number, businessNow: number): void {
  const people = room(spriteId);
  const existing = people.get(personId);
  if (existing === undefined) return;
  existing.connections -= 1;
  if (existing.connections > 0) {
    broadcast(spriteId, businessNow);
    return;
  }
  people.delete(personId);
  publishSprite(spriteId, { type: 'team', text: `${existing.name} left` });
  broadcast(spriteId, businessNow);
}

export function noteActivity(
  spriteId: number,
  personId: number,
  businessNow: number,
  cursor?: { x: number; y: number; frame: number },
): void {
  const existing = room(spriteId).get(personId);
  if (existing === undefined) return;
  existing.lastActivity = businessNow;
  if (cursor !== undefined) existing.cursor = cursor;
}

export function cursorOf(spriteId: number, personId: number): { x: number; y: number } {
  const existing = room(spriteId).get(personId);
  return existing?.cursor === null || existing === undefined ? { x: 0, y: 0 } : existing.cursor;
}

export function publishPresence(spriteId: number, businessNow: number): void {
  broadcast(spriteId, businessNow);
}

export function activeRooms(): number[] {
  return [...rooms.entries()].filter(([, people]) => people.size > 0).map(([spriteId]) => spriteId);
}
