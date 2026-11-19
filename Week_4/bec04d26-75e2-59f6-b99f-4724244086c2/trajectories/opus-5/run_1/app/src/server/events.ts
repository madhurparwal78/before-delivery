import { ServerResponse } from 'node:http';
import { Role } from '../shared/types';

/**
 * Announcement priorities, highest first, from the published order. The browser
 * writes a batch in descending number so the highest-priority line stays.
 */
export const PRIORITY = {
  conflict: 1,
  field_error: 2,
  extension_refused: 3,
  status_saved: 4,
  amounts_saved: 5,
  extension_granted: 6,
  band_opened: 7,
  own_action: 8,
  approval_seen: 9,
  went_overdue: 10,
  packet_ready: 11,
  reminder_sent: 12,
  banner: 13,
} as const;

export interface LiveLine {
  text: string;
  priority: number;
  /** Which roles hear the line. */
  roles: readonly Role[];
  /** When set, only that client's owner hears the owner part of the line. */
  clientId: string | null;
  /** Keeps per-return ordering stable inside one priority. */
  order?: number;
}

export interface LiveEvent {
  lines: LiveLine[];
  services?: { mail: boolean; pdf: boolean };
}

interface Subscriber {
  practiceId: string;
  userId: string;
  role: Role;
  clientId: string | null;
  res: ServerResponse;
}

const subscribers = new Set<Subscriber>();

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function linesFor(subscriber: Subscriber, lines: readonly LiveLine[]): LiveLine[] {
  return lines.filter((line) => {
    if (!line.roles.includes(subscriber.role)) return false;
    if (subscriber.role === 'owner') {
      return line.clientId !== null && line.clientId === subscriber.clientId;
    }
    return true;
  });
}

function write(subscriber: Subscriber, payload: unknown): void {
  try {
    subscriber.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    subscribers.delete(subscriber);
  }
}

/** Pushes a change to every open screen allowed to see it. */
export function publish(practiceId: string, event: LiveEvent): void {
  for (const subscriber of subscribers) {
    if (subscriber.practiceId !== practiceId) continue;
    write(subscriber, {
      type: 'change',
      lines: linesFor(subscriber, event.lines),
      services: event.services,
    });
  }
}

/** Pushes the service reachability of the whole instance. */
export function publishServices(services: { mail: boolean; pdf: boolean }): void {
  for (const subscriber of subscribers) {
    write(subscriber, { type: 'change', lines: [], services });
  }
}

export function heartbeat(): void {
  for (const subscriber of subscribers) {
    try {
      subscriber.res.write(': ping\n\n');
    } catch {
      subscribers.delete(subscriber);
    }
  }
}
