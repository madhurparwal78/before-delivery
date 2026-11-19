// Live events hub: one same-origin SSE stream per page, pushing within 2 seconds.

import { IncomingMessage, ServerResponse } from "http";
import { Db } from "./db";

export interface LiveEvent {
  world: string;
  kind: string;
  payload: unknown;
}

type Listener = (event: LiveEvent) => void;

interface Hub {
  subscribe(world: string, fn: Listener): () => void;
  publish(event: LiveEvent): void;
}

const hub: Hub = (() => {
  const byWorld = new Map<string, Set<Listener>>();
  return {
    subscribe(world, fn) {
      let set = byWorld.get(world);
      if (!set) { set = new Set(); byWorld.set(world, set); }
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0) byWorld.delete(world);
      };
    },
    publish(event) {
      const set = byWorld.get(event.world);
      if (set) for (const fn of set) fn(event);
    }
  };
})();

export function subscribeLive(world: string, fn: Listener): () => void {
  return hub.subscribe(world, fn);
}

export function publishLive(event: LiveEvent): void {
  hub.publish(event);
}

export function openSse(req: IncomingMessage, res: ServerResponse, world: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`retry: 1000\n\n`);
  const unsubscribe = hub.subscribe(world, event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(`: hb\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

export async function readWorldOf(db: Db, playerId: string): Promise<string> {
  const r = await db.query<{ world_id: string }>("SELECT world_id FROM players WHERE id = $1", [playerId]);
  return r.rows[0].world_id;
}
