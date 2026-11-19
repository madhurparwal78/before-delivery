import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import type { BoardLiveEvent, Role, StaffLiveEvent } from "../shared/api";
import { boardRooms } from "./board";
import { divide } from "../shared/money";
import { config } from "./config";
import { database, type Queryable } from "./db";

const CHANNEL = "nightroll_change";
const RECONNECT_MS = 2000;
const PING_MS = 15_000;

interface Emission { hotelId: string; staff: StaffLiveEvent; roomIds: string[] }
interface Subscriber { res: ServerResponse; role: Role; hotelId: string }

const subscribers = new Set<Subscriber>();

/** Queues a change inside the transaction; Postgres delivers it to every app copy on commit. */
export async function emit(from: Queryable, hotelId: string, staff: StaffLiveEvent, roomIds: string[] = []): Promise<void> {
  const emission: Emission = { hotelId, staff, roomIds };
  await from.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(emission)]);
}

function write(res: ServerResponse, event: StaffLiveEvent | BoardLiveEvent): void {
  res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
}

async function deliver(emission: Emission): Promise<void> {
  const here = [...subscribers].filter((subscriber) => subscriber.hotelId === emission.hotelId);
  for (const subscriber of here) if (subscriber.role !== "housekeeper") write(subscriber.res, emission.staff);
  const keepers = here.filter((subscriber) => subscriber.role === "housekeeper");
  if (keepers.length === 0 || emission.roomIds.length === 0) return;
  for (const roomId of emission.roomIds) {
    const [room] = await boardRooms(database(), emission.hotelId, roomId);
    if (!room) continue;
    const event: BoardLiveEvent = {
      type: "room", roomId: room.roomId, number: room.number, status: room.status,
      arrival: room.arrival, departure: room.departure,
      notice: emission.staff.type === "room" ? emission.staff.notice : null,
    };
    for (const subscriber of keepers) write(subscriber.res, event);
  }
}

/** Keeps one LISTEN connection alive for this app copy. */
export function listenForChanges(): void {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    const retry = (): void => {
      client.removeAllListeners();
      client.end().catch(() => undefined);
      setTimeout(() => void connect(), RECONNECT_MS).unref();
    };
    client.on("error", retry);
    client.on("end", retry);
    client.on("notification", (message) => {
      if (message.channel === CHANNEL && message.payload) void deliver(JSON.parse(message.payload) as Emission);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch {
      retry();
    }
  };
  void connect();
}

export function openStream(req: IncomingMessage, res: ServerResponse, role: Role, hotelId: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: ${divide(config.liveMaxDelayMs, 2).quotient}\n: ready\n\n`);
  const subscriber: Subscriber = { res, role, hotelId };
  subscribers.add(subscriber);
  const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
  req.on("close", () => {
    clearInterval(ping);
    subscribers.delete(subscriber);
  });
}
