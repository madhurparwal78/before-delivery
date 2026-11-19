import type { ServerResponse } from "node:http";
import type { AccessEndedEvent, StreamEventName, StreamEvents } from "../shared/types";

/** One open `/api/stream` response. */
export interface Connection {
  res: ServerResponse;
  accountId: string;
  sessionHash: string;
}

/** A client past this many open streams loses its oldest, so one account cannot hold unbounded memory. */
const MAX_STREAMS_PER_ACCOUNT = 20;

/** The open streams, by account. In-process only: one instance serves everyone. */
const connections = new Map<string, Set<Connection>>();

/** How long a sent event stays replayable: longer than a page waits between loading and opening its stream. */
const REPLAY_MS = 30_000;
/** At most this many replayable events are kept, whatever their age. */
const REPLAY_MAX = 5_000;

interface Sent { sequence: number; at: number; accountIds: Set<string>; chunk: string }

/** Every event sent in the last REPLAY_MS, oldest first, so a page that opens its stream late still receives it. */
const recent: Sent[] = [];
let sequence = 0;

/** The number of the newest event sent; a stream opened with `?after=` this number misses nothing sent since. */
export function streamSequence(): number {
  return sequence;
}

/** Numbers the event (its `id:`, which the browser sends back as Last-Event-ID on a reconnect) and keeps it for replay. */
function remember<N extends StreamEventName>(accountIds: Set<string>, name: N, data: StreamEvents[N]): string {
  sequence += 1;
  const chunk = `id: ${sequence}\n${eventChunk(name, data)}`;
  const now = Date.now();
  recent.push({ sequence, at: now, accountIds, chunk });
  while (recent.length > REPLAY_MAX || (recent.length > 0 && now - (recent[0]?.at ?? now) > REPLAY_MS)) recent.shift();
  return chunk;
}

/** Writes every remembered event of this connection's account sent after `after`, in order. */
export function replay(connection: Connection, after: number): void {
  for (const sent of recent) if (sent.sequence > after && sent.accountIds.has(connection.accountId)) write(connection, sent.chunk);
}

export function register(connection: Connection): void {
  const open = connections.get(connection.accountId) ?? new Set<Connection>();
  open.add(connection);
  connections.set(connection.accountId, open);
  for (const stale of [...open].slice(0, Math.max(0, open.size - MAX_STREAMS_PER_ACCOUNT))) {
    open.delete(stale);
    stale.res.end();
  }
  connection.res.once("close", () => {
    open.delete(connection);
    if (open.size === 0 && connections.get(connection.accountId) === open) connections.delete(connection.accountId);
  });
}

/** Writes to a stream unless it has already been ended (a write after end would raise an unhandled error). */
export function write(connection: Connection, chunk: string): void {
  if (!connection.res.writableEnded) connection.res.write(chunk);
}

function eventChunk<N extends StreamEventName>(name: N, data: StreamEvents[N]): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function writeEvent<N extends StreamEventName>(connection: Connection, name: N, data: StreamEvents[N]): void {
  write(connection, eventChunk(name, data));
}

/** Sends an event to every open tab of each account. */
export function publish<N extends StreamEventName>(accountIds: Iterable<string>, name: N, data: StreamEvents[N]): void {
  const to = new Set(accountIds);
  const chunk = remember(to, name, data);
  for (const accountId of to) {
    for (const connection of connections.get(accountId) ?? []) write(connection, chunk);
  }
}

/** Tells an account its access ended, then closes all of its streams. */
export function endAccountStreams(accountId: string, ended?: AccessEndedEvent): void {
  const chunk = ended ? remember(new Set([accountId]), "access-ended", ended) : null;
  for (const connection of [...connections.get(accountId) ?? []]) {
    if (chunk) write(connection, chunk);
    connection.res.end();
  }
}

export function endSessionStreams(sessionHash: string): void {
  for (const open of connections.values()) {
    for (const connection of open) if (connection.sessionHash === sessionHash) connection.res.end();
  }
}

export function endAllStreams(): void {
  for (const open of connections.values()) for (const connection of [...open]) connection.res.end();
}
