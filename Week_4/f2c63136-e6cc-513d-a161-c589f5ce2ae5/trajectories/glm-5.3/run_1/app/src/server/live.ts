import type { ServerResponse } from 'node:http';

export interface LiveEvent {
  repoId: number;
  kind: string;
  payload: unknown;
}

interface Subscriber {
  repoIds: Set<number>;
  send: (event: LiveEvent) => void;
}

/**
 * Pushed live updates. The server pushes; pages never poll. Events are
 * delivered as soon as they happen, within the live update delay.
 */
export class LiveHub {
  private subscribers = new Map<ServerResponse, Subscriber>();

  attach(res: ServerResponse, repoIds: Set<number>): void {
    const sub: Subscriber = {
      repoIds,
      send: (event) => {
        if (res.writable) res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      },
    };
    this.subscribers.set(res, sub);
    res.on('close', () => this.subscribers.delete(res));
  }

  /** Immediate push of an event to every viewer of the repository. */
  publish(event: LiveEvent): void {
    for (const sub of this.subscribers.values()) {
      if (sub.repoIds.has(event.repoId)) sub.send(event);
    }
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }
}
