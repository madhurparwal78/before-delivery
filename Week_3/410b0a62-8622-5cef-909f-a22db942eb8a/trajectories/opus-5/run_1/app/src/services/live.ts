import { pool } from '../db/pool.js';
import { acceptedCoachIds } from '../db/users.js';
import type { ChangeKind } from '../domain/types.js';

export interface LiveConnection {
  userId: string;
  send(event: 'change' | 'notice', data: unknown): void;
}

const connections = new Set<LiveConnection>();

export function addConnection(connection: LiveConnection): void {
  connections.add(connection);
}

export function removeConnection(connection: LiveConnection): void {
  connections.delete(connection);
}

function sendTo(userIds: readonly string[], event: 'change' | 'notice', data: unknown): void {
  const audience = new Set(userIds);
  for (const connection of connections) {
    if (audience.has(connection.userId)) connection.send(event, data);
  }
}

/** Streams a committed change to the athlete and their linked coaches. */
export async function publishChange(
  athleteId: string,
  what: ChangeKind,
  extras: { workoutId?: string; alsoNotify?: readonly string[] } = {},
): Promise<void> {
  const coaches = await acceptedCoachIds(pool, athleteId);
  const audience = [athleteId, ...coaches, ...(extras.alsoNotify ?? [])];
  const data = extras.workoutId
    ? { athlete_id: athleteId, what, workout_id: extras.workoutId }
    : { athlete_id: athleteId, what };
  sendTo(audience, 'change', data);
}

export function publishNotice(userIds: readonly string[], text: string): void {
  sendTo(userIds, 'notice', { text });
}
