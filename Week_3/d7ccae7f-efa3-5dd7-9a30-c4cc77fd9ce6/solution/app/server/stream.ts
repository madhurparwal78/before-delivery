import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { StoredEvent } from "../shared/schemas.js";
import { currentQuizmaster, hashSession, sessionToken } from "./auth.js";
import { nowMs } from "./clock.js";
import { pool } from "./db.js";
import { validationFailed } from "./errors.js";
import { isLive, liveUnavailable, subscribeRoom, trackClient, type ChannelMessage } from "./live/valkey.js";
import { polled, streamClosed, streamOpened } from "./presence.js";
import { ownedRoomId } from "./rooms/access.js";
import { resolveClient } from "./rooms/clients.js";
import { eventsAfter, replayAfter, waitForEvents } from "./rooms/events.js";
import { presenceMayHaveChanged } from "./rooms/presenceEvents.js";

const HEARTBEAT_MS = 15_000;
const POLL_WAIT_MS = 25_000;
const POLL_RECHECK_MS = 1000;

type StreamClient = { roomId: string; seatId: string | null; clientId: string | null; presenceKey: string };

// A phone names its client; the stage is the signed-in quizmaster who owns the room.
async function authorize(req: IncomingMessage, roomId: string, query: URLSearchParams, forPoll: boolean): Promise<StreamClient> {
  if (query.get("role") === "stage") {
    const quizmaster = await currentQuizmaster(req);
    await ownedRoomId(quizmaster.id, roomId);
    return { roomId, seatId: null, clientId: null, presenceKey: forPoll ? `stage:${hashSession(sessionToken(req) as string)}` : `stage-${randomBytes(12).toString("base64url")}` };
  }
  const client = await resolveClient(query.get("clientId"), roomId);
  return { roomId, seatId: client.seatId, clientId: client.clientId, presenceKey: client.clientId };
}

const openStreams = new Set<() => void>();

// Valkey went away: every open stream ends and its client falls back to polling.
export function closeAllStreams(): void {
  for (const close of [...openStreams]) close();
}

const frame = (event: StoredEvent): string => `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

export async function openStream(req: IncomingMessage, res: ServerResponse, roomId: string, query: URLSearchParams): Promise<void> {
  const client = await authorize(req, roomId, query, false);
  if (!isLive()) throw liveUnavailable();
  const header = Number(req.headers["last-event-id"]);
  let closed = false;
  let lastSent = Number.isInteger(header) ? header : -1;
  let chain: Promise<void> = Promise.resolve();
  const buffered: ChannelMessage[] = [];
  let replaying = true;

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    openStreams.delete(close);
    release();
    streamClosed(roomId, client.presenceKey);
    void trackClient(roomId, client.presenceKey, false);
    presenceMayHaveChanged(roomId);
    res.end();
  };

  const send = (event: StoredEvent): void => {
    if (closed || event.id <= lastSent) return;
    res.write(frame(event));
    lastSent = event.id;
    if (event.type === "ended") close();
  };

  const handle = async (message: ChannelMessage): Promise<void> => {
    if (message.kind === "superseded") {
      if (message.clientId === client.clientId && !closed) {
        res.write("event: superseded\ndata: {}\n\n");
        close();
      }
      return;
    }
    if (message.event.id > lastSent + 1) for (const missed of await eventsAfter(roomId, lastSent, message.event.id - 1)) send(missed);
    send(message.event);
  };

  const onMessage = (message: ChannelMessage): void => {
    if (replaying) buffered.push(message);
    else chain = chain.then(() => handle(message)).catch(() => close());
  };

  const release = await subscribeRoom(roomId, onMessage);
  if (req.destroyed) {
    release();
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), HEARTBEAT_MS);
  res.on("close", close);
  res.on("error", close);
  openStreams.add(close);
  streamOpened(roomId, client.presenceKey, client.seatId);
  void trackClient(roomId, client.presenceKey, true);
  presenceMayHaveChanged(roomId);

  try {
    if (lastSent < 0) {
      const latest = await pool.query<{ last_event_id: string }>("SELECT last_event_id FROM rooms WHERE id = $1", [roomId]);
      lastSent = Number(latest.rows[0]?.last_event_id ?? 0);
    } else {
      for (const event of await replayAfter(roomId, lastSent)) send(event);
    }
    replaying = false;
    for (const message of buffered) onMessage(message);
    res.write(": live\n\n");
  } catch {
    close();
  }
}

export async function pollEvents(req: IncomingMessage, res: ServerResponse, roomId: string, query: URLSearchParams): Promise<StoredEvent[]> {
  const client = await authorize(req, roomId, query, true);
  const after = Number(query.get("after") ?? 0);
  if (!Number.isInteger(after) || after < 0) throw validationFailed({ after: "after must be an event id" });
  const gone = new AbortController();
  res.on("close", () => gone.abort());
  const deadline = nowMs() + POLL_WAIT_MS;
  for (;;) {
    polled(roomId, client.presenceKey, client.seatId);
    presenceMayHaveChanged(roomId);
    const events = await eventsAfter(roomId, after);
    if (events.length > 0 || gone.signal.aborted || nowMs() >= deadline) return events;
    await waitForEvents(roomId, Math.min(POLL_RECHECK_MS, deadline - nowMs()), gone.signal);
  }
}
