import type { ServerResponse } from 'node:http';

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

/** Member ids, or every connected member. */
export type Audience = string[] | 'all';

export interface LiveConnection {
  id: number;
  memberId: string;
  /** Job id when this stream belongs to an open job editor. */
  editorJobId: string | null;
  response: ServerResponse;
}

type Listener = (connection: LiveConnection) => void;

const connections = new Map<number, LiveConnection>();
const opened: Listener[] = [];
const closed: Listener[] = [];
let nextId = 1;

export function onConnectionOpened(listener: Listener): void {
  opened.push(listener);
}

export function onConnectionClosed(listener: Listener): void {
  closed.push(listener);
}

function write(connection: LiveConnection, event: LiveEvent): void {
  connection.response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function publish(to: Audience, event: LiveEvent): void {
  for (const connection of connections.values()) {
    if (to === 'all' || to.includes(connection.memberId)) write(connection, event);
  }
}

/** Sends to the open editors of one job, optionally skipping one member. */
export function publishToEditors(jobId: string, event: LiveEvent, exceptMemberId?: string): void {
  for (const connection of connections.values()) {
    if (connection.editorJobId === jobId && connection.memberId !== exceptMemberId) write(connection, event);
  }
}

export function attach(memberId: string, editorJobId: string | null, response: ServerResponse): LiveConnection {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': connected\n\n');
  const connection: LiveConnection = { id: nextId++, memberId, editorJobId, response };
  connections.set(connection.id, connection);
  const beat = setInterval(() => response.write(': keep-alive\n\n'), 15_000);
  response.on('close', () => {
    clearInterval(beat);
    connections.delete(connection.id);
    for (const listener of closed) listener(connection);
  });
  for (const listener of opened) listener(connection);
  return connection;
}
