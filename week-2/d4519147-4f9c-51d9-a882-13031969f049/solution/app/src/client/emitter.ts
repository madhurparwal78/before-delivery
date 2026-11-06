/** A minimal change signal for stores read through useSyncExternalStore. */
export class Emitter {
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  emit(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}
