// The change stream. Change events cross every process sharing the database through
// LISTEN/NOTIFY (the payload is read back from `changes`); status events are this process's own.

import type { ServerResponse } from "node:http";
import pg from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";

const clients = new Set<ServerResponse>();

export const openStream = (res: ServerResponse): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 1000\n: connected\n\n");
  clients.add(res);
  res.on("close", () => clients.delete(res));
};

// One SSE frame to every open stream: `id` is the change's seq, left out for status events.
export const broadcast = (event: string, data: unknown, id?: number): void => {
  const text = `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(text);
};

setInterval(() => {
  for (const res of clients) res.write(": still here\n\n");
}, 10_000).unref();

let delivery: Promise<void> = Promise.resolve();

const deliver = (seq: number): void => {
  delivery = delivery
    .then(async () => {
      const { rows } = await pool.query<{ event: unknown }>("SELECT event FROM changes WHERE seq = $1", [seq]);
      if (rows[0]) broadcast("change", rows[0].event, seq);
    })
    .catch((error: Error) => console.error("change delivery failed:", error.message));
};

export const listenForChanges = async (): Promise<void> => {
  const listener = new pg.Client({ connectionString: config.databaseUrl });
  const retry = (): void => {
    listener.removeAllListeners();
    listener.end().catch(() => undefined);
    setTimeout(() => void listenForChanges().catch(retry), 1000);
  };
  listener.on("error", retry);
  listener.on("notification", (message) => deliver(Number(message.payload)));
  await listener.connect();
  await listener.query("LISTEN promptside_change");
};
