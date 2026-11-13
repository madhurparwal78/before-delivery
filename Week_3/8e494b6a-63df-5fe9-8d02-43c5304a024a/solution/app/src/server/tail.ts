// Fan-out of newly stored events to the open live tails of a stream.
import type { ApiEvent } from "./search/events";

type Listener = (events: ApiEvent[]) => void;
const listeners = new Map<number, Set<Listener>>();

export function publishStored(streamId: number, events: ApiEvent[]): void {
  if (events.length === 0) return;
  for (const listener of listeners.get(streamId) ?? []) listener(events);
}

export function subscribeTail(streamId: number, listener: Listener): () => void {
  const set = listeners.get(streamId) ?? new Set();
  set.add(listener);
  listeners.set(streamId, set);
  return () => {
    set.delete(listener);
  };
}
