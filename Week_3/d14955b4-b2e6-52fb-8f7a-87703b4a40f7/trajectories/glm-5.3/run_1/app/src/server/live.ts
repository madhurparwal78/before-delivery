// The one live-update fan-out. Streams subscribe; the shared source publishes.
export interface LiveFrame {
  event: string;
  gameId: string;
  threadId: string | null;
  payload: Record<string, unknown>;
}

type Subscriber = (frame: LiveFrame) => void;

interface Subscription {
  gameId: string;
  staffId: string | null;
  playerId: string | null;
  permissionFilter: (frame: LiveFrame) => boolean;
  subscriber: Subscriber;
  stopped: () => void;
}

const subscriptions = new Set<Subscription>();

export function subscribe(options: {
  gameId: string;
  staffId: string | null;
  playerId: string | null;
  permissionFilter: (frame: LiveFrame) => boolean;
  subscriber: Subscriber;
  stopped: () => void;
}): () => void {
  const entry: Subscription = { ...options };
  subscriptions.add(entry);
  return () => {
    subscriptions.delete(entry);
  };
}

export function publish(frame: LiveFrame): void {
  for (const entry of subscriptions) {
    if (entry.gameId !== frame.gameId) continue;
    if (!entry.permissionFilter(frame)) continue;
    try {
      entry.subscriber(frame);
    } catch {
      subscriptions.delete(entry);
    }
  }
}

export function hasSubscribers(): boolean {
  return subscriptions.size > 0;
}
