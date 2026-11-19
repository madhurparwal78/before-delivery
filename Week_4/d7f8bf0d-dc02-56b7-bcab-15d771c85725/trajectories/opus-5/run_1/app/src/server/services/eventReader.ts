import { readBlocking, type StreamEntry } from './valkey.js';

type Listener = (entry: StreamEntry) => void;

interface StreamCursor {
  lastSeq: number;
  listeners: Set<Listener>;
}

/** One XREAD cursor per stream for this instance, forwarded to its own browsers. */
class EventReader {
  private readonly streams = new Map<string, StreamCursor>();
  private running = false;

  subscribe(stream: string, fromSeq: number, listener: Listener): () => void {
    const existing = this.streams.get(stream);
    if (existing) {
      if (fromSeq < existing.lastSeq) existing.lastSeq = fromSeq;
      existing.listeners.add(listener);
    } else {
      this.streams.set(stream, { lastSeq: fromSeq, listeners: new Set([listener]) });
    }
    this.start();
    return () => {
      const cursor = this.streams.get(stream);
      if (!cursor) return;
      cursor.listeners.delete(listener);
      if (cursor.listeners.size === 0) this.streams.delete(stream);
    };
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.streams.size === 0) {
        this.running = false;
        return;
      }
      const cursors = [...this.streams.entries()].map(([stream, cursor]) => ({
        stream,
        lastSeq: cursor.lastSeq,
      }));
      try {
        const batches = await readBlocking(cursors, 1000);
        for (const batch of batches) {
          const cursor = this.streams.get(batch.stream);
          if (!cursor) continue;
          for (const entry of batch.entries) {
            if (entry.seq > cursor.lastSeq) cursor.lastSeq = entry.seq;
            for (const listener of cursor.listeners) listener(entry);
          }
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

export const eventReader = new EventReader();
