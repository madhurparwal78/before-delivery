import type { ServerResponse } from 'node:http';

interface Connection {
  readonly userId: string;
  readonly res: ServerResponse;
  /** Events that arrive while the connection's opening events are still being written wait here, in order. */
  queue: string[] | null;
}

export function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The server-sent events hub: one open stream per browser connection, filtered per user. */
export class EventHub {
  private readonly connections = new Set<Connection>();

  /**
   * Counts a user's unread inbox items. The alerts and inbox module replaces this; until then nobody has any.
   */
  countUnread: (userId: string) => Promise<number> = async () => 0;

  constructor(private readonly heartbeatMs: number) {}

  /**
   * Opens a stream for `userId`. `opening` produces the first events (clock, extracts, inbox) and is awaited
   * before any later event is let through, so the order on every connection is the same.
   */
  open(userId: string, res: ServerResponse, opening: () => Promise<string[]>): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const connection: Connection = { userId, res, queue: [] };
    this.connections.add(connection);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), this.heartbeatMs);
    res.on('close', () => {
      clearInterval(beat);
      this.connections.delete(connection);
    });
    void opening().then(
      (frames) => {
        for (const text of frames) res.write(text);
        for (const text of connection.queue ?? []) res.write(text);
        connection.queue = null;
      },
      () => res.end(),
    );
  }

  toUser(userId: string, name: string, data: unknown): void {
    this.send((connection) => connection.userId === userId, frame(name, data));
  }

  toUsers(userIds: readonly string[], name: string, data: unknown): void {
    const wanted = new Set(userIds);
    this.send((connection) => wanted.has(connection.userId), frame(name, data));
  }

  toAll(name: string, data: unknown): void {
    this.send(() => true, frame(name, data));
  }

  /** Tells one user their unread count. */
  async inbox(userId: string): Promise<void> {
    this.toUser(userId, 'inbox', { unread: await this.countUnread(userId) });
  }

  private send(wanted: (connection: Connection) => boolean, text: string): void {
    for (const connection of this.connections) {
      if (!wanted(connection)) continue;
      if (connection.queue) connection.queue.push(text);
      else connection.res.write(text);
    }
  }
}
