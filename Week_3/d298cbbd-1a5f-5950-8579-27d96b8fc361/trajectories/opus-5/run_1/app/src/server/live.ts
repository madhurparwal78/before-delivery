import type { ServerResponse } from 'node:http';

export class LiveConnection {
  private readonly res: ServerResponse;
  readonly sessionToken: string | null;
  readonly typistId: string | null;
  private readonly closers: (() => void)[] = [];
  private open = true;

  constructor(res: ServerResponse, sessionToken: string | null, typistId: string | null) {
    this.res = res;
    this.sessionToken = sessionToken;
    this.typistId = typistId;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    // A dropped connection comes back within a couple of seconds.
    res.write('retry: 2000\n: open\n\n');
    const heartbeat = setInterval(() => {
      if (this.open) res.write(': beat\n\n');
    }, 15000);
    heartbeat.unref();
    const finish = (): void => {
      if (!this.open) return;
      this.open = false;
      clearInterval(heartbeat);
      for (const closer of this.closers) closer();
    };
    res.on('close', finish);
    res.on('error', finish);
  }

  send(event: string, data: unknown): void {
    if (!this.open) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  onClose(callback: () => void): void {
    this.closers.push(callback);
  }

  close(): void {
    if (!this.open) return;
    this.res.end();
    this.open = false;
    for (const closer of this.closers) closer();
  }
}

const connections = new Set<LiveConnection>();

export function registerConnection(connection: LiveConnection): void {
  connections.add(connection);
  connection.onClose(() => connections.delete(connection));
}

/** Closes every live connection opened by one of the given, now ended, sessions. */
export function closeConnectionsForSessions(tokens: readonly string[]): void {
  const ended = new Set(tokens);
  for (const connection of [...connections]) {
    if (connection.sessionToken !== null && ended.has(connection.sessionToken)) {
      connection.close();
    }
  }
}
