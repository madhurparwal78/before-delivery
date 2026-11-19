import type { ServerResponse } from "node:http";
import { openCollection } from "../access.js";
import { db, notices } from "../db.js";
import { type Handler, route, STREAMED } from "../http.js";

/** The change feed: server-sent events per collection, resumable from a sequence number. */

interface Stream {
  res: ServerResponse;
  collectionId: string;
  projectId: string;
  userId: string;
  last: number;
  pumping: boolean;
  again: boolean;
}

const streams = new Set<Stream>();
const KEEPALIVE_MS = 15_000;
const BATCH = 500;

async function pump(stream: Stream): Promise<void> {
  if (stream.pumping) {
    stream.again = true;
    return;
  }
  stream.pumping = true;
  try {
    do {
      stream.again = false;
      const result = await db.query<{ seq: string; op: string; doc_id: string; document: string | null; version: number | null }>(
        "SELECT seq, op, doc_id, document, version FROM changes WHERE collection_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
        [stream.collectionId, stream.last, BATCH],
      );
      for (const row of result.rows) {
        const data = `{"seq":${row.seq},"op":${JSON.stringify(row.op)},"_id":${JSON.stringify(row.doc_id)},"document":${row.document ?? "null"},"version":${row.version ?? "null"}}`;
        stream.res.write(`id: ${row.seq}\nevent: change\ndata: ${data}\n\n`);
        stream.last = Number(row.seq);
      }
      if (result.rows.length === BATCH) stream.again = true;
    } while (stream.again);
  } catch (error) {
    console.error("feed:", error instanceof Error ? error.message : String(error));
  } finally {
    stream.pumping = false;
  }
}

async function announceRole(stream: Stream): Promise<void> {
  const result = await db.query<{ role: string }>("SELECT role FROM members WHERE project_id = $1 AND user_id = $2", [stream.projectId, stream.userId]);
  const role = result.rows[0]?.role;
  if (role === undefined) stream.res.end();
  else stream.res.write(`event: role\ndata: ${JSON.stringify({ role })}\n\n`);
}

notices.on("notice", (payload: string) => {
  const [kind, first, second] = payload.split(":");
  for (const stream of streams) {
    if (kind === "c" && stream.collectionId === first) void pump(stream);
    else if (kind === "r" && stream.projectId === first && stream.userId === second) void announceRole(stream).catch(() => undefined);
    else if (payload === "reconnected") void pump(stream);
  }
});

const events: Handler = async (ctx) => {
  const { user, project, collection } = await openCollection(ctx);
  const header = ctx.req.headers["last-event-id"];
  const given = typeof header === "string" ? header : ctx.query.get("after");
  const resumed = given === null ? Number.NaN : Number(given);
  const stream: Stream = {
    res: ctx.res,
    collectionId: collection.id,
    projectId: project.id,
    userId: user.id,
    last: Number.isInteger(resumed) && resumed >= 0 ? resumed : collection.sequence,
    pumping: false,
    again: false,
  };
  ctx.res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
  ctx.res.write(": connected\n\n");
  streams.add(stream);
  const heartbeat = setInterval(() => ctx.res.write(": keep-alive\n\n"), KEEPALIVE_MS);
  ctx.res.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(stream);
  });
  void pump(stream);
  return STREAMED;
};

route("GET", "/api/projects/:pid/collections/:cid/events", events);
