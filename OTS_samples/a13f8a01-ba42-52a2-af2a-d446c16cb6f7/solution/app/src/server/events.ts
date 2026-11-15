import type { ServerResponse } from "node:http";
import type { LiveCounts, LiveHead, User } from "../shared/types.js";
import { canSee } from "./access.js";
import { findPen, type PenRow } from "./pens.js";

interface Subscriber {
  res: ServerResponse;
  viewer: User | null;
  pens: Set<string>;
}

const subscribers = new Set<Subscriber>();

const HEARTBEAT_MS = 15000;

setInterval(() => {
  for (const subscriber of subscribers) subscriber.res.write(": ping\n\n");
}, HEARTBEAT_MS).unref();

function send(subscriber: Subscriber, event: string, data: unknown): void {
  subscriber.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function countsOf(row: PenRow): LiveCounts {
  return { pen_id: row.id, likes: row.likes, forks: row.forks };
}

function headOf(row: PenRow): LiveHead {
  return { pen_id: row.id, head: row.head };
}

export async function subscribe(res: ServerResponse, viewer: User | null, penIds: readonly string[]): Promise<void> {
  const visible: PenRow[] = [];
  for (const id of new Set(penIds)) {
    const row = await findPen(id);
    if (row !== null && canSee(row, viewer)) visible.push(row);
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const subscriber: Subscriber = { res, viewer, pens: new Set(visible.map((row) => row.id)) };
  subscribers.add(subscriber);
  res.on("close", () => subscribers.delete(subscriber));
  res.write(": ready\n\n");
  for (const row of visible) {
    send(subscriber, "counts", countsOf(row));
    send(subscriber, "head", headOf(row));
  }
}

async function publishPen(penId: string, event: "counts" | "head"): Promise<void> {
  const row = await findPen(penId);
  if (row === null) return;
  for (const subscriber of subscribers) {
    if (subscriber.pens.has(penId) && canSee(row, subscriber.viewer)) {
      send(subscriber, event, event === "counts" ? countsOf(row) : headOf(row));
    }
  }
}

export const publishCounts = (penId: string): Promise<void> => publishPen(penId, "counts");
export const publishHead = (penId: string): Promise<void> => publishPen(penId, "head");

export function publishAccount(userId: string): void {
  for (const subscriber of subscribers) {
    if (subscriber.viewer?.id === userId) send(subscriber, "account", { verified: true });
  }
}
