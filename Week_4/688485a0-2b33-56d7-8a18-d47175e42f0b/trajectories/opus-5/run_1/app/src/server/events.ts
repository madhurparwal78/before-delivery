type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Wakes this process's streams for a collection; other processes catch up by polling. */
export function publishChange(collectionId: string): void {
  const set = listeners.get(collectionId);
  if (!set) return;
  for (const listener of set) listener();
}

export function subscribeChanges(collectionId: string, listener: Listener): () => void {
  const set = listeners.get(collectionId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(collectionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(collectionId);
  };
}
