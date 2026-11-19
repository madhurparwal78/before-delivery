import type { Response } from 'express';

export interface LiveEvent {
  kind: string;
  [key: string]: unknown;
}

interface Subscriber {
  practiceId: string;
  clientId: string | null;
  send: (event: LiveEvent) => void;
}

const subscribers = new Set<Subscriber>();

export function subscribe(
  practiceId: string,
  clientId: string | null,
  send: (event: LiveEvent) => void,
): () => void {
  const subscriber: Subscriber = { practiceId, clientId, send };
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/** Push one event to every open screen allowed to see it. */
export function emitEvent(practiceId: string, event: LiveEvent): void {
  for (const subscriber of subscribers) {
    if (subscriber.practiceId !== practiceId) continue;
    if (subscriber.clientId !== null) {
      const returnClientId = event.client_id;
      if (typeof returnClientId !== 'string' || returnClientId !== subscriber.clientId) continue;
    }
    subscriber.send(event);
  }
}

export function sseHandler(practiceId: string, clientId: string | null, res: Response): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');
  const unsubscribe = subscribe(practiceId, clientId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return unsubscribe;
}
