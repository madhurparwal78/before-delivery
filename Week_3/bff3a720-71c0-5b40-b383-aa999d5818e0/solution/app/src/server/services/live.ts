import { isoBrussels } from "../../shared/time";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LiveEvent } from "../../shared/events";
import { pool } from "../db";
import { markOffline, markOnline, EVENTS_CHANNEL, subscriber, valkey } from "../valkey";
import { now } from "../clock";


const HEARTBEAT_MS = 15_000;

interface Audience {
  members?: string[];
  /** Everyone connected with `ride=<id>`. */
  ride?: string;
  /** Participants of a booking thread connected with `thread=<id>`. */
  thread?: { id: string; members: string[] };
  all?: boolean;
}

interface Envelope {
  event: LiveEvent;
  audience: Audience;
  /** Wall-clock milliseconds at publication, so a stream that opens late can ask for what it missed. */
  at?: number;
}

/** A page opens its stream a moment after it loads; what was published in between is replayed from here. */
const REPLAY_MS = 30_000;
const recent: Envelope[] = [];

interface Connection {
  res: ServerResponse;
  memberId: string | null;
  rideId: string | null;
  threadId: string | null;
  threadAllowed: boolean;
}

const connections = new Set<Connection>();

function wants(connection: Connection, audience: Audience): boolean {
  if (audience.all) return true;
  if (connection.memberId && audience.members?.includes(connection.memberId)) return true;
  if (audience.ride && connection.rideId === audience.ride) return true;
  const thread = audience.thread;
  return Boolean(thread && connection.threadAllowed && connection.threadId === thread.id && connection.memberId && thread.members.includes(connection.memberId));
}

function write(connection: Connection, event: LiveEvent): void {
  connection.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

export async function publish(envelope: Envelope): Promise<void> {
  await valkey.publish(EVENTS_CHANNEL, JSON.stringify({ ...envelope, at: Date.now() })).catch(() => undefined);
}

/** Every instance listens on the shared channel and hands events to its own connections. */
export async function startFanOut(): Promise<void> {
  await subscriber.subscribe(EVENTS_CHANNEL);
  subscriber.on("message", (_channel, payload) => {
    const envelope = JSON.parse(payload) as Envelope;
    recent.push(envelope);
    while (recent[0] && (recent[0].at ?? 0) < Date.now() - REPLAY_MS) recent.shift();
    for (const connection of connections) if (wants(connection, envelope.audience)) write(connection, envelope.event);
  });
}

async function threadMembers(threadId: string): Promise<string[] | null> {
  const { rows } = await pool.query<{ passenger_id: string; driver_id: string; state: string }>(
    "SELECT b.passenger_id, r.driver_id, b.state FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1",
    [threadId],
  );
  const row = rows[0];
  return row && row.state !== "held" ? [row.passenger_id, row.driver_id] : null;
}

function stillConnected(threadId: string, memberId: string): boolean {
  for (const connection of connections) {
    if (connection.threadAllowed && connection.threadId === threadId && connection.memberId === memberId) return true;
  }
  return false;
}

export function openStream(req: IncomingMessage, res: ServerResponse, memberId: string | null, rideId: string | null, threadId: string | null, from: number | null): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const connection: Connection = { res, memberId, rideId, threadId, threadAllowed: false };
  connections.add(connection);
  write(connection, { type: "hello", data: { server_now: isoBrussels(now()) } });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const missed = from === null ? [] : recent.filter((envelope) => (envelope.at ?? 0) >= from);
  const replay = (): void => {
    for (const envelope of missed) if (!res.destroyed && wants(connection, envelope.audience)) write(connection, envelope.event);
  };

  if (!(memberId && threadId)) replay();
  if (memberId && threadId) {
    void threadMembers(threadId).then(async (members) => {
      if (!members || !members.includes(memberId) || res.destroyed) {
        replay();
        return;
      }
      connection.threadAllowed = true;
      replay();
      await markOnline(threadId, memberId);
      await publish({
        event: { type: "presence", data: { booking_id: threadId, member_id: memberId, online: true, last_seen_at: null } },
        audience: { thread: { id: threadId, members } },
      });
    }).catch(() => undefined);
  }

  req.on("close", () => {
    clearInterval(heartbeat);
    connections.delete(connection);
    if (!connection.threadAllowed || !memberId || !threadId || stillConnected(threadId, memberId)) return;
    const seenAt = isoBrussels(now());
    void (async () => {
      await markOffline(threadId, memberId, seenAt);
      const members = await threadMembers(threadId);
      if (members) {
        await publish({
          event: { type: "presence", data: { booking_id: threadId, member_id: memberId, online: false, last_seen_at: seenAt } },
          audience: { thread: { id: threadId, members } },
        });
      }
    })().catch(() => undefined);
  });
}
