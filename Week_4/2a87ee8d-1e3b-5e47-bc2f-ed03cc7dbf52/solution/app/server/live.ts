// Live board updates: Postgres NOTIFY fans each committed change out to every open stream on every instance.
import type http from "node:http";
import { db, listen, type LiveEvent } from "./db.js";
import { ACTIVE_SESSION_SQL, actorKey, linkExpiresAt, type Actor } from "./auth.js";
import type { Req } from "./http.js";
import { resolve } from "./board.js";
import { findWorkshop } from "./store.js";

interface Stream {
  res: http.ServerResponse;
  workshopId: string;
  viewer: Actor;
  key: string;
  lastSent: number;
  expiresAt: number | null;
}

const streams = new Set<Stream>();
const statuses = new Map<string, string>();

function sendBoard(stream: Stream, version: number) {
  if (version <= stream.lastSent) return;
  stream.lastSent = version;
  stream.res.write(`event: board\nid: ${version}\ndata: ${JSON.stringify({ version })}\n\n`);
}

function end(stream: Stream) {
  streams.delete(stream);
  stream.res.write("event: ended\ndata: \n\n");
  stream.res.end();
}

async function refreshStatus(workshopId: string) {
  const row = await db.one<{ status: string }>("SELECT status FROM workshops WHERE id = $1", [workshopId]);
  if (row) statuses.set(workshopId, row.status);
}

async function checkSessions(workshopId: string | null) {
  const watched = [...streams].filter((s) => s.viewer.kind === "participant" && (workshopId === null || s.workshopId === workshopId));
  if (!watched.length) return;
  const rows = await db.rows<{ id: string; active: boolean }>(
    `SELECT p.id, ${ACTIVE_SESSION_SQL} AS active FROM participants p JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id
     WHERE p.id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [watched.map((s) => s.viewer.id)],
  );
  const active = new Set(rows.filter((r) => r.active).map((r) => r.id));
  for (const s of watched) if (!active.has(s.viewer.id)) end(s);
}

function onEvent(event: LiveEvent) {
  const targets = [...streams].filter((s) => s.workshopId === event.w);
  if (event.t === "board") {
    for (const s of targets) sendBoard(s, event.v);
    if (targets.length) void refreshStatus(event.w);
  } else if (event.t === "presence") {
    const silent = statuses.get(event.w) === "silent_round";
    for (const s of targets) {
      if (s.key === event.from || (silent && s.viewer.kind === "participant")) continue;
      const data = { cursorId: event.cursorId, hue: event.hue, x: event.x, y: event.y, ...(s.viewer.kind === "facilitator" ? { name: event.name } : {}) };
      s.res.write(`event: presence\ndata: ${JSON.stringify(data)}\n\n`);
    }
  } else if (targets.length) {
    void checkSessions(event.w);
  }
}

async function catchUp() {
  for (const s of streams) {
    const w = await findWorkshop(db, s.workshopId);
    if (w) sendBoard(s, w.version);
  }
  await checkSessions(null);
}

export function startLive(): void {
  listen(onEvent, () => void catchUp());
  setInterval(() => {
    const now = Date.now();
    for (const s of streams) if (s.expiresAt !== null && now >= s.expiresAt) end(s);
  }, 500).unref();
  setInterval(() => {
    for (const s of streams) s.res.write(": keep-alive\n\n");
  }, 15_000).unref();
}

export async function openStream(req: Req, res: http.ServerResponse, p: Record<string, string>): Promise<void> {
  const { actor, w } = await resolve(req, "workshop", p.id ?? "");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
    ...req.extraHeaders,
  });
  res.write(": open\n\n");
  const stream: Stream = {
    res,
    workshopId: w.id,
    viewer: actor,
    key: actorKey(actor),
    lastSent: 0,
    expiresAt: actor.kind === "participant" ? linkExpiresAt(w.end_at).getTime() : null,
  };
  const header = req.headers["last-event-id"];
  const last = typeof header === "string" && /^\d+$/.test(header) ? Number(header) : null;
  stream.lastSent = last ?? w.version;
  streams.add(stream);
  statuses.set(w.id, w.status);
  res.on("close", () => streams.delete(stream));
  if (last !== null) sendBoard(stream, (await findWorkshop(db, w.id))?.version ?? w.version);
}
