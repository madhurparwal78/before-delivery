// GET /api/events: a server-sent event stream per signed-in user, fed by Postgres NOTIFY so every app
// instance sharing the database sees every change. Commission events go only to the producer and the
// client who owns the commission; a sponsor sees only their own share, which needs no live events.
import type { ServerResponse } from "node:http";
import pg from "pg";
import type { Caller } from "./auth.js";
import { config } from "./config.js";
import { one } from "./db.js";

interface Stream {
  caller: Caller;
  res: ServerResponse;
}

const streams = new Set<Stream>();

export function attachStream(caller: Caller, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": connected\n\n");
  const stream = { caller, res };
  streams.add(stream);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(stream);
  });
}

const FIELDS: Record<string, readonly string[]> = {
  "commission.updated": ["commissionId", "state"],
  "payment.confirmed": ["commissionId", "payerName", "amountCents", "label"],
  "render.updated": ["renderId", "state", "progress"],
  "job.updated": ["jobId", "status"],
  "hold.updated": ["commissionId", "status"],
};

async function deliver(raw: string): Promise<void> {
  const message = JSON.parse(raw) as Record<string, unknown> & { event: string; commissionId?: string };
  const fields = FIELDS[message.event];
  if (!fields || !streams.size) return;
  const owner = message.commissionId ? await one<{ client_id: string }>("SELECT client_id FROM commissions WHERE id = $1", [message.commissionId]) : null;
  const data = JSON.stringify({ ...Object.fromEntries(fields.map((f) => [f, message[f] ?? null])), commissionId: message.commissionId ?? null });
  for (const { caller, res } of streams) {
    const visible = caller.roles.includes("producer") || owner?.client_id === caller.id;
    if (visible) res.write(`event: ${message.event}\ndata: ${data}\n\n`);
  }
}

/** Keeps one LISTEN connection open, reconnecting when the database comes back. */
export async function listen(onJobs: () => void): Promise<void> {
  for (;;) {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    try {
      await client.connect();
      await client.query("LISTEN spindrift_events");
      await client.query("LISTEN spindrift_jobs");
      client.on("notification", (n) => {
        if (n.channel === "spindrift_jobs") onJobs();
        else if (n.payload) deliver(n.payload).catch(() => undefined);
      });
      await new Promise<void>((resolve) => {
        client.on("error", () => resolve());
        client.on("end", () => resolve());
      });
    } catch {
      // Postgres is unreachable; retry below.
    }
    await client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
