import type { Response } from 'express';

export type LiveTopic =
  | 'calendar'
  | 'queue'
  | 'ward'
  | 'beacons'
  | 'note'
  | 'stock'
  | 'staff'
  | 'invoices'
  | 'patients';

export type LiveEvent =
  | { kind: 'changed'; topics: LiveTopic[]; noteAppointmentId?: string }
  | { kind: 'announce'; text: string; audience: 'all' | 'manager' }
  | { kind: 'role'; role: string }
  | { kind: 'revoked' };

type Subscriber = {
  id: string;
  clinicId: string;
  userId: string;
  response: Response;
};

const subscribers = new Map<string, Subscriber>();

export function addSubscriber(clinicId: string, userId: string, response: Response): () => void {
  const id = crypto.randomUUID();
  subscribers.set(id, { id, clinicId, userId, response });
  return () => subscribers.delete(id);
}

function send(subscriber: Subscriber, event: LiveEvent): void {
  try {
    subscriber.response.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    subscribers.delete(subscriber.id);
  }
}

/** The one publisher every state change goes through. */
export function publish(clinicId: string, event: LiveEvent): void {
  for (const subscriber of subscribers.values()) {
    if (subscriber.clinicId === clinicId) send(subscriber, event);
  }
}

/**
 * Server-started announcements land just after the acting window's own
 * response, so its two children keep the published order.
 */
export function announce(clinicId: string, text: string, audience: 'all' | 'manager'): void {
  setTimeout(() => publish(clinicId, { kind: 'announce', text, audience }), 30);
}

export function publishToUser(userId: string, event: LiveEvent): void {
  for (const subscriber of subscribers.values()) {
    if (subscriber.userId === userId) send(subscriber, event);
  }
}

export function closeUserStreams(userId: string): void {
  for (const subscriber of [...subscribers.values()]) {
    if (subscriber.userId === userId) {
      send(subscriber, { kind: 'revoked' });
      subscribers.delete(subscriber.id);
      try {
        subscriber.response.end();
      } catch {
        /* the socket is gone already */
      }
    }
  }
}

export function heartbeat(): void {
  for (const subscriber of subscribers.values()) {
    try {
      subscriber.response.write(': ping\n\n');
    } catch {
      subscribers.delete(subscriber.id);
    }
  }
}
