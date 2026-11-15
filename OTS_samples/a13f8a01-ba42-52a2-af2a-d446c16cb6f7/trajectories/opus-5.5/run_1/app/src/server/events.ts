import type { ServerResponse } from "node:http";
import type { LiveEvent, Visibility } from "../shared/types";
import { canView, penCounts } from "./access";
import { one, pool } from "./db";
import type { Context, Reply } from "./http";

interface Stream {
  res: ServerResponse;
  userId: string | null;
  pens: Set<string>;
}

const streams = new Set<Stream>();

function write(stream: Stream, event: LiveEvent): void {
  stream.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

export function openEventStream(ctx: Context): Reply {
  const pens = new Set((ctx.url.searchParams.get("pens") ?? "").split(",").map((id) => id.trim()).filter((id) => /^[a-z0-9]{10}$/.test(id)));
  const stream: Stream = { res: ctx.res, userId: ctx.user?.id ?? null, pens };
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  ctx.res.write("retry: 1000\n\n");
  streams.add(stream);
  const heartbeat = setInterval(() => ctx.res.write(": keep-alive\n\n"), 15000);
  ctx.req.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(stream);
  });
  return { kind: "handled" };
}

async function listeners(penId: string): Promise<{ stream: Stream; visible: boolean }[]> {
  const interested = [...streams].filter((stream) => stream.pens.has(penId));
  if (interested.length === 0) return [];
  const pen = await one<{ owner_id: string; visibility: Visibility }>(pool, "SELECT owner_id, visibility FROM pens WHERE id = $1", [penId]);
  return interested.map((stream) => ({ stream, visible: pen !== undefined && canView(pen, stream.userId) }));
}

export async function publishCounts(penId: string): Promise<void> {
  const targets = (await listeners(penId)).filter((target) => target.visible);
  if (targets.length === 0) return;
  const counts = await penCounts(pool, penId);
  for (const { stream } of targets) write(stream, { type: "counts", data: { pen_id: penId, ...counts } });
}

export async function publishHead(penId: string, head: number): Promise<void> {
  for (const { stream, visible } of await listeners(penId)) {
    if (visible) write(stream, { type: "head", data: { pen_id: penId, head } });
  }
}

export function publishAccountVerified(userId: string): void {
  for (const stream of streams) {
    if (stream.userId === userId) write(stream, { type: "account", data: { verified: true } });
  }
}

export function announce(task: Promise<void>): void {
  task.catch((error: unknown) => console.error("live update failed", error));
}
