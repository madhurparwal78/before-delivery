/** A set of listeners that can be added, removed and called with one argument. */
export class Listeners<T> {
  private readonly items = new Set<(value: T) => void>();

  add(listener: (value: T) => void): () => void {
    this.items.add(listener);
    return () => {
      this.items.delete(listener);
    };
  }

  get size(): number {
    return this.items.size;
  }

  emit(value: T): void {
    for (const listener of [...this.items]) listener(value);
  }

  clear(): void {
    this.items.clear();
  }
}
