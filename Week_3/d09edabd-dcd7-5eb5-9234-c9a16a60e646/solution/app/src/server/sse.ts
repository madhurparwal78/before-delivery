import type { ServerResponse } from 'node:http';

const HEARTBEAT_MS = 15_000;

interface EventWriter {
  send(event: string, data: unknown): void;
  onClose(cleanup: () => void): void;
}

/** Turns a response into a text/event-stream writer with a heartbeat. */
export function openEventStream(res: ServerResponse): EventWriter {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': stream open\n\n');
  const cleanups: (() => void)[] = [];
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(beat);
    for (const cleanup of cleanups) cleanup();
  });
  return {
    send: (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose: (cleanup) => void cleanups.push(cleanup),
  };
}
