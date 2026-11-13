import { valkey } from './valkey.js';

type Sink = (event: string, data: unknown) => void;

/** Live streams on this instance, by channel; events arrive from Valkey, or straight from this process while Valkey is down. */
class Hub {
  private readonly sinks = new Map<string, Set<Sink>>();

  subscribe(channel: string, sink: Sink): () => void {
    const set = this.sinks.get(channel) ?? new Set<Sink>();
    set.add(sink);
    this.sinks.set(channel, set);
    return () => {
      set.delete(sink);
      if (set.size === 0) this.sinks.delete(channel);
    };
  }

  /** Delivers to this instance's streams. */
  deliver(channel: string, event: string, data: unknown): void {
    for (const sink of this.sinks.get(channel) ?? []) sink(event, data);
  }

  deliverAll(event: string, data: unknown): void {
    for (const set of this.sinks.values()) for (const sink of set) sink(event, data);
  }

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    if (valkey.available) {
      try {
        await valkey.publish(channel, event, data);
        return;
      } catch {
        // Valkey dropped between the check and the publish: fall through to local delivery.
      }
    }
    this.deliver(channel, event, data);
  }
}

export const hub = new Hub();

export const roomChannel = (roomId: string): string => `room:${roomId}`;
export const playtestChannel = (sessionId: string): string => `playtest:${sessionId}`;

/** Session, solve, hint and tester events reach both the room's editors and the session's testers. */
export async function publishPlaytest(roomId: string, sessionId: string, event: string, data: unknown): Promise<void> {
  await Promise.all([hub.publish(roomChannel(roomId), event, data), hub.publish(playtestChannel(sessionId), event, data)]);
}
