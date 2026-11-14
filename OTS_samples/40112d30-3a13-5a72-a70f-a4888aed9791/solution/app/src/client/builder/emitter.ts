// A tiny typed event source: the store, the sync and the trial tell the panes what changed.

export class Emitter<T = void> {
  private readonly listeners: ((value: T) => void)[] = [];

  /** Returns the function that stops listening (for dialogs, which come and go). */
  listen(listener: (value: T) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners.splice(this.listeners.indexOf(listener), 1); };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}
