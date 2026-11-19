// Per-player serialisation: every change to one player's balance, stages or
// championship standing goes through this queue, one at a time.
type Task<T> = () => Promise<T>;

export class PlayerLocks {
  private queues = new Map<string, Promise<unknown>>();

  async run<T>(playerId: string, task: Task<T>): Promise<T> {
    const prev = this.queues.get(playerId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(playerId, next.catch(() => undefined));
    try {
      return await next;
    } finally {
      if (this.queues.get(playerId) === (next as Promise<unknown>)) {
        // Keep the chain moving; delete when it is the tail.
        void next.catch(() => undefined);
      }
    }
  }
}
